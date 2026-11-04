const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, X509Certificate } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const REPO = "danielbaars/anthracite";
const BASE = `repos/${REPO}`;
function gh(args, encoding = "utf8") {
  return execFileSync("gh", args, { encoding, maxBuffer: 20 * 1024 * 1024 });
}
const api = (route) => JSON.parse(gh(["api", route]));
async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(
    response.status,
    200,
    `Registry read failed: ${response.status}`
  );
  return response;
}
function isolatedNpm(operation) {
  const temporary = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "anthracite-registry-check-"))
  );
  const config = path.join(temporary, "npmrc");
  const globalConfig = path.join(temporary, "global-npmrc");
  fs.writeFileSync(config, "");
  fs.writeFileSync(globalConfig, "");
  const env = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: config,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    npm_config_cache: path.join(temporary, "cache"),
  };
  for (const key of Object.keys(env))
    if (
      ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].includes(
        key
      ) ||
      /^npm_config_.*(?:auth|token|password)/i.test(key)
    )
      delete env[key];
  try {
    return operation(temporary, env);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function registryTarball(manifest) {
  const url = new URL(manifest.dist.tarball);
  assert.equal(url.origin, "https://registry.npmjs.org");
  assert.ok(url.pathname.startsWith("/@danielbaars/anthracite/-/"));
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  return url.href;
}
function services() {
  const github = {
    repository: async () => api(BASE),
    main: async () => api(`${BASE}/git/ref/heads/main`).object.sha,
    tag: async (tag) => {
      const refs = api(`${BASE}/git/matching-refs/tags/${tag}`);
      const ref = refs.find((item) => item.ref === `refs/tags/${tag}`);
      if (!ref) return null;
      let object = ref.object;
      for (let depth = 0; object.type === "tag"; depth++) {
        assert.ok(depth < 5, "Nested release tag is unsupported");
        object = api(`${BASE}/git/tags/${object.sha}`).object;
      }
      assert.equal(object.type, "commit");
      return object.sha;
    },
    release: async (tag) => {
      // The exact tag lookup distinguishes absence from inaccessible releases.
      const releases = JSON.parse(
        gh(["api", "--paginate", "--slurp", `${BASE}/releases?per_page=100`])
      );
      const release = releases.flat().find((item) => item.tag_name === tag);
      if (!release) return null;
      assert.equal(
        release.draft,
        false,
        "Draft release evidence is unsupported"
      );
      const assets = {};
      const pages = JSON.parse(
        gh([
          "api",
          "--paginate",
          "--slurp",
          `${BASE}/releases/${release.id}/assets?per_page=100`,
        ])
      );
      for (const asset of pages.flat()) {
        if (
          !/^(intent\.json|danielbaars-anthracite\.tgz|SHA256SUMS|tests\.json|verification-[0-9]+-[0-9]+\.json)$/.test(
            asset.name
          )
        )
          continue;
        assets[asset.name] = gh(
          [
            "api",
            `${BASE}/releases/assets/${asset.id}`,
            "-H",
            "Accept: application/octet-stream",
          ],
          "buffer"
        );
      }
      return {
        tag,
        source: await github.tag(tag),
        prerelease: release.prerelease,
        assets,
      };
    },
    evidence: async (reference) => {
      const match =
        typeof reference === "string" &&
        reference.match(
          /^release:(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.[1-9]\d*)\/practice\.json$/
        );
      assert.ok(match, "Unsupported practice evidence reference");
      const tag = match[1];
      const pages = JSON.parse(
        gh(["api", "--paginate", "--slurp", `${BASE}/releases?per_page=100`])
      );
      const release = pages.flat().find((value) => value.tag_name === tag);
      assert.ok(
        release && !release.draft && release.prerelease,
        "Missing beta practice release"
      );
      const assetPages = JSON.parse(
        gh([
          "api",
          "--paginate",
          "--slurp",
          `${BASE}/releases/${release.id}/assets?per_page=100`,
        ])
      );
      const assets = assetPages
        .flat()
        .filter((value) => value.name === "practice.json");
      assert.equal(
        assets.length,
        1,
        "Missing or ambiguous practice evidence asset"
      );
      const asset = assets[0];
      const bytes = gh(
        [
          "api",
          `${BASE}/releases/assets/${asset.id}`,
          "-H",
          "Accept: application/octet-stream",
        ],
        "buffer"
      );
      assert.ok(bytes.length <= 1024 * 1024, "Practice evidence is too large");
      return { reference, bytes, author: asset.uploader?.login };
    },
    retain: async ({ tag, source, prerelease, assets }) => {
      const existingTag = await github.tag(tag);
      assert.ok(
        existingTag === null || existingTag === source,
        "Refusing conflicting release tag"
      );
      let release = await github.release(tag);
      if (!release) {
        gh([
          "release",
          "create",
          tag,
          "--repo",
          REPO,
          "--target",
          source,
          "--title",
          tag,
          "--notes",
          "Prepared release evidence; npm publication is not yet verified.",
          ...(prerelease ? ["--prerelease"] : []),
        ]);
        release = await github.release(tag);
      }
      assert.equal(
        release.source,
        source,
        "Release tag must bind the source commit"
      );
      assert.equal(release.prerelease, prerelease);
      const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "anthracite-release-assets-")
      );
      try {
        for (const [name, bytes] of Object.entries(assets)) {
          assert.ok(/^[A-Za-z0-9.-]+$/.test(name), "Unsafe release asset name");
          if (release.assets[name]) {
            assert.ok(
              Buffer.from(release.assets[name]).equals(bytes),
              `Conflicting durable ${name}`
            );
            continue;
          }
          const filename = path.join(temporary, name);
          fs.writeFileSync(filename, bytes, { flag: "wx" });
          gh(["release", "upload", tag, filename, "--repo", REPO]);
        }
        const saved = await github.release(tag);
        assert.equal(saved.source, source);
        for (const [name, bytes] of Object.entries(assets))
          assert.ok(
            saved.assets[name] && Buffer.from(saved.assets[name]).equals(bytes),
            `Durable evidence verification failed: ${name}`
          );
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
  return {
    github,
    registry: {
      publish: async ({ tarball, channel, version }) => {
        assert.equal(
          process.env.NPM_TRUSTED_PUBLISHING,
          "true",
          "Trusted publication is disabled"
        );
        assert.equal(
          process.env.GITHUB_ACTIONS,
          "true",
          "Publication requires the approved GitHub workflow"
        );
        assert.equal(
          process.env.GITHUB_EVENT_NAME,
          "workflow_dispatch",
          "Publication requires explicit manual dispatch"
        );
        assert.equal(process.env.GITHUB_REPOSITORY, REPO);
        assert.equal(process.env.GITHUB_REF, "refs/heads/main");
        assert.equal(channel, "beta");
        assert.match(
          version,
          /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)$/
        );
        isolatedNpm((temporary, env) =>
          execFileSync(
            "npm",
            [
              "publish",
              tarball,
              "--tag",
              channel,
              "--access",
              "public",
              "--provenance",
              "--registry=https://registry.npmjs.org",
            ],
            {
              cwd: temporary,
              env,
              encoding: "utf8",
              timeout: 120000,
              maxBuffer: 2 * 1024 * 1024,
            }
          )
        );
      },
      inspect: async (version) => {
        assert.match(
          version,
          /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/
        );
        const response = await fetch(
          `https://registry.npmjs.org/@danielbaars%2fanthracite/${version}`,
          { signal: AbortSignal.timeout(30000) }
        );
        if (response.status === 404) return null;
        assert.equal(response.status, 200, "Cannot inspect published version");
        const manifest = await response.json();
        assert.equal(manifest.name, "@danielbaars/anthracite");
        assert.equal(manifest.version, version);
        const bytes = Buffer.from(
          await (await read(registryTarball(manifest))).arrayBuffer()
        );
        assert.equal(
          manifest.dist.integrity,
          `sha512-${createHash("sha512").update(bytes).digest("base64")}`
        );
        const attestationUrl = new URL(manifest.dist.attestations.url);
        assert.equal(attestationUrl.origin, "https://registry.npmjs.org");
        const verified = isolatedNpm((temporary, env) => {
          const prefix = path.join(temporary, "install");
          const options = {
            cwd: temporary,
            env,
            encoding: "utf8",
            timeout: 120000,
            maxBuffer: 20 * 1024 * 1024,
          };
          execFileSync(
            "npm",
            [
              "install",
              "--prefix",
              prefix,
              "--ignore-scripts",
              "--no-audit",
              "--no-fund",
              "--registry=https://registry.npmjs.org",
              `@danielbaars/anthracite@${version}`,
            ],
            options
          );
          const lock = JSON.parse(
            fs.readFileSync(path.join(prefix, "package-lock.json"))
          );
          assert.equal(
            lock.packages["node_modules/@danielbaars/anthracite"].integrity,
            manifest.dist.integrity,
            "Installed registry bytes disagree"
          );
          const audit = JSON.parse(
            execFileSync(
              "npm",
              [
                "audit",
                "signatures",
                "--prefix",
                prefix,
                "--json",
                "--include-attestations",
                "--registry=https://registry.npmjs.org",
              ],
              options
            )
          );
          assert.deepEqual(audit.invalid, []);
          assert.deepEqual(audit.missing, []);
          const entry = audit.verified.find(
            (item) =>
              item.name === manifest.name &&
              item.version === version &&
              item.registry === "https://registry.npmjs.org/"
          );
          assert.ok(
            entry,
            "Missing cryptographically verified package attestation"
          );
          return entry.attestationBundles;
        });
        const bundle = verified.find(
          (item) => item.predicateType === "https://slsa.dev/provenance/v1"
        );
        assert.ok(bundle, "Missing verified SLSA provenance");
        const material = bundle.bundle.verificationMaterial;
        const direct = material?.certificate;
        const chain = material?.x509CertificateChain;
        assert.ok(
          material && !material.publicKey && Boolean(direct) !== Boolean(chain),
          "Missing or unsupported verified provenance certificate"
        );
        assert.ok(
          !chain ||
            (Array.isArray(chain.certificates) &&
              chain.certificates.length === 1),
          "Unsupported verified provenance certificate chain"
        );
        const raw = direct?.rawBytes ?? chain?.certificates[0]?.rawBytes;
        assert.ok(
          typeof raw === "string" && raw.length > 0,
          "Missing verified provenance certificate"
        );
        const certificate = new X509Certificate(Buffer.from(raw, "base64"));
        const signerIdentity =
          "https://github.com/danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main";
        assert.equal(
          certificate.subjectAltName,
          `URI:${signerIdentity}`,
          "Provenance signer is not the trusted release workflow"
        );
        const statement = JSON.parse(
          Buffer.from(bundle.bundle.dsseEnvelope.payload, "base64").toString()
        );
        return {
          manifest,
          bytes,
          statement,
          signaturesVerified: true,
          signerIdentity,
        };
      },
      snapshot: async () => {
        const metadata = await (
          await read("https://registry.npmjs.org/@danielbaars%2fanthracite")
        ).json();
        const latest = metadata.versions?.[metadata["dist-tags"]?.latest];
        assert.equal(latest?.name, "@danielbaars/anthracite");
        assert.ok(
          latest.dist.tarball.startsWith(
            "https://registry.npmjs.org/@danielbaars/anthracite/-/"
          )
        );
        const bytes = Buffer.from(
          await (await read(latest.dist.tarball)).arrayBuffer()
        );
        assert.equal(
          latest.dist.integrity,
          `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
          "Latest stable artifact integrity failed"
        );
        return metadata;
      },
    },
  };
}
module.exports = { services };
