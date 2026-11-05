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
const api = (route) =>
  JSON.parse(gh(["api", route, "-H", "Cache-Control: no-cache"]));
function remaining(deadline, cap) {
  const value = Math.min(cap, deadline - Date.now());
  if (value <= 0) {
    const error = Error("Public verification deadline exhausted");
    error.retryable = true;
    throw error;
  }
  return value;
}
async function registryFetch(url, deadline) {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(remaining(deadline, 30000)),
    });
  } catch (error) {
    error.retryable = true;
    throw error;
  }
}
async function read(url, deadline = Date.now() + 300000) {
  const response = await registryFetch(url, deadline);
  if (response.status !== 200) {
    const error = Error(`Registry read failed: ${response.status}`);
    error.retryable = [404, 408, 429, 500, 502, 503, 504].includes(
      response.status
    );
    throw error;
  }
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
      let release;
      try {
        release = api(`${BASE}/releases/tags/${encodeURIComponent(tag)}`);
      } catch (error) {
        let response;
        try {
          response = JSON.parse(error.stdout?.toString() || "null");
        } catch {
          throw error;
        }
        if (
          error.status !== 1 ||
          response?.message !== "Not Found" ||
          !/\(HTTP 404\)/.test(error.stderr?.toString() || "")
        )
          throw error;
        // Confirm absence with a readable inventory; other access failures refuse.
        const pages = JSON.parse(
          gh([
            "api",
            "--paginate",
            "--slurp",
            `${BASE}/releases?per_page=100`,
            "-H",
            "Cache-Control: no-cache",
          ])
        );
        assert.ok(
          !pages.flat().some((item) => item.tag_name === tag),
          "Release is listed but its exact tag lookup is unavailable"
        );
        return null;
      }
      assert.ok(
        release && typeof release === "object" && !Array.isArray(release),
        "Invalid release response"
      );
      assert.equal(release.tag_name, tag, "Release tag identity differs");
      assert.ok(
        Number.isSafeInteger(release.id) && release.id > 0,
        "Invalid release ID"
      );
      assert.equal(
        typeof release.prerelease,
        "boolean",
        "Missing prerelease status"
      );
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
          "-H",
          "Cache-Control: no-cache",
        ])
      );
      assert.ok(
        pages.flat().length <= 1000,
        "Too many release evidence assets"
      );
      for (const asset of pages.flat()) {
        if (
          !/^(intent\.json|danielbaars-anthracite\.tgz|SHA256SUMS|tests\.json|assessment\.json|practice\.json|beta-intent\.json|beta-verification\.json|(?:attempt|verification|observation)-[1-9]\d*-[1-9]\d*\.json)$/.test(
            asset.name
          )
        )
          continue;
        assert.ok(!assets[asset.name], "Duplicate durable asset name");
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
    retain: async ({
      tag,
      source,
      prerelease,
      assets,
      initialRetention = false,
    }) => {
      const existingTag = await github.tag(tag);
      assert.ok(
        existingTag === null || existingTag === source,
        "Refusing conflicting release tag"
      );
      async function readBack(requiredAssets) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const observed = await github.release(tag);
          if (observed) {
            assert.equal(
              observed.source,
              source,
              "Release tag must bind the source commit"
            );
            assert.equal(observed.prerelease, prerelease);
            for (const [name, bytes] of Object.entries(requiredAssets)) {
              if (observed.assets[name])
                assert.ok(
                  Buffer.from(observed.assets[name]).equals(bytes),
                  `Conflicting durable ${name}`
                );
            }
            if (
              Object.keys(requiredAssets).every((name) => observed.assets[name])
            )
              return observed;
          }
          if (attempt < 4)
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw Error(
          "Release evidence is not yet readable; readback retries did not repeat writes. Inspect release and npm state before retrying publication."
        );
      }
      let release = await github.release(tag);
      if (!prerelease)
        assert.ok(
          release,
          "Existing stable GitHub release required; do not create it during publication"
        );
      if (!release) {
        assert.ok(
          prerelease && initialRetention,
          "Missing release; append-only retention cannot recreate it"
        );
        for (const name of [
          "intent.json",
          "danielbaars-anthracite.tgz",
          "SHA256SUMS",
          "tests.json",
        ])
          assert.ok(
            assets[name],
            `Initial retention requires complete ${name}`
          );
        const intent = require("./release-channels.cjs").validateRecord(
          JSON.parse(assets["intent.json"])
        );
        assert.equal(intent.channel, "beta");
        assert.equal(tag, `v${intent.version}`);
        assert.equal(source, intent.source.commit);
        assert.equal(
          require("node:crypto")
            .createHash("sha256")
            .update(assets["danielbaars-anthracite.tgz"])
            .digest("hex"),
          intent.artifact.sha256
        );
        assert.equal(
          Buffer.from(assets.SHA256SUMS).toString(),
          `${intent.artifact.sha256}  danielbaars-anthracite.tgz\n`
        );
        assert.deepEqual(JSON.parse(assets["tests.json"]), intent.tests);
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
        release = await readBack({});
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
        await readBack(assets);
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
        assert.ok(
          ["beta", "latest"].includes(channel),
          "Explicit supported publication channel required"
        );
        assert.match(
          version,
          channel === "beta"
            ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)$/
            : /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
        );
        try {
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
        } catch (error) {
          const diagnostic = [error.message, error.stdout, error.stderr].join(
            "\n"
          );
          if (/\bcode\s+(?:E400|E401|E403|E409)\b/.test(diagnostic))
            error.definiteRejection = true;
          throw error;
        }
      },
      inspect: async (version, { deadline = Date.now() + 300000 } = {}) => {
        assert.match(
          version,
          /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/
        );
        const response = await registryFetch(
          `https://registry.npmjs.org/@danielbaars%2fanthracite/${version}`,
          deadline
        );
        if (response.status === 404) return null;
        if (response.status !== 200) {
          const error = Error(
            `Cannot inspect published version: ${response.status}`
          );
          error.retryable = [408, 429, 500, 502, 503, 504].includes(
            response.status
          );
          throw error;
        }
        const manifest = await response.json();
        assert.equal(manifest.name, "@danielbaars/anthracite");
        assert.equal(manifest.version, version);
        const bytes = Buffer.from(
          await (await read(registryTarball(manifest), deadline)).arrayBuffer()
        );
        assert.equal(
          manifest.dist.integrity,
          `sha512-${createHash("sha512").update(bytes).digest("base64")}`
        );
        if (!manifest.dist.attestations?.url) {
          const error = Error("Published provenance is not yet visible");
          error.retryable = true;
          throw error;
        }
        const attestationUrl = new URL(manifest.dist.attestations.url);
        assert.equal(attestationUrl.origin, "https://registry.npmjs.org");
        let verified;
        try {
          verified = isolatedNpm((temporary, env) => {
            const prefix = path.join(temporary, "install");
            const options = {
              cwd: temporary,
              env,
              encoding: "utf8",
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
              { ...options, timeout: remaining(deadline, 120000) }
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
                { ...options, timeout: remaining(deadline, 120000) }
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
        } catch (error) {
          if (
            error.code === "ETIMEDOUT" ||
            // The version endpoint can lead npm install metadata during propagation.
            /(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|ETARGET|E404|E429|E50[0234])/.test(
              [error.stdout, error.stderr].join("\n")
            )
          )
            error.retryable = true;
          throw error;
        }
        const bundle = verified.find(
          (item) => item.predicateType === "https://slsa.dev/provenance/v1"
        );
        if (!bundle) {
          const error = Error("Verified SLSA provenance is not yet visible");
          error.retryable = true;
          throw error;
        }
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
      snapshot: async ({ deadline = Date.now() + 300000 } = {}) => {
        const metadata = await (
          await read(
            "https://registry.npmjs.org/@danielbaars%2fanthracite",
            deadline
          )
        ).json();
        const latest = metadata.versions?.[metadata["dist-tags"]?.latest];
        assert.equal(latest?.name, "@danielbaars/anthracite");
        assert.ok(
          latest.dist.tarball.startsWith(
            "https://registry.npmjs.org/@danielbaars/anthracite/-/"
          )
        );
        const bytes = Buffer.from(
          await (await read(latest.dist.tarball, deadline)).arrayBuffer()
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
