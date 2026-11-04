const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
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
      for (const asset of release.assets) {
        if (
          ![
            "intent.json",
            "danielbaars-anthracite.tgz",
            "SHA256SUMS",
            "tests.json",
          ].includes(asset.name)
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
