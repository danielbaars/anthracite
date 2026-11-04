const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(process.argv[2]));
const state = JSON.parse(fs.readFileSync(input.state));
const save = () => fs.writeFileSync(input.state, JSON.stringify(state));
const decode = (release) =>
  release
    ? {
        ...release,
        assets: Object.fromEntries(
          Object.entries(release.assets).map(([name, bytes]) => [
            name,
            Buffer.from(bytes, "base64"),
          ])
        ),
      }
    : null;
const services = {
  github: {
    repository: async () => ({
      full_name: "danielbaars/anthracite",
      default_branch: "main",
    }),
    main: async () => state.main,
    tag: async (tag) => state.tags?.[tag] || null,
    release: async (tag) => decode(state.releases?.[tag]),
    evidence: async (reference) => {
      if (reference !== state.practiceReference)
        throw Error("Missing supported practice evidence");
      return {
        reference,
        bytes: Buffer.from(JSON.stringify(state.practice)),
        author: state.practiceAuthor || "release-test",
      };
    },
    retain: async ({ tag, source, prerelease, assets }) => {
      state.releases ||= {};
      state.releases[tag] ||= { tag, source, prerelease, assets: {} };
      state.tags ||= {};
      state.tags[tag] = source;
      for (const [name, bytes] of Object.entries(assets)) {
        const previous = state.releases[tag].assets[name];
        if (previous && previous !== bytes.toString("base64"))
          throw Error("Conflicting durable asset");
        state.releases[tag].assets[name] = bytes.toString("base64");
      }
      save();
    },
  },
  registry: {
    snapshot: async () => state.registry,
    publish: async ({ tarball, channel, version }) => {
      const bytes = fs.readFileSync(tarball);
      state.writes.push({ channel, version, bytes: bytes.toString("base64") });
      state.registry["dist-tags"][channel] = version;
      state.registry.versions[version] = {
        name: "@danielbaars/anthracite",
        version,
        dist: { integrity: input.intent.artifact.integrity },
      };
      save();
    },
    inspect: async (version) =>
      state.registry.versions[version]
        ? {
            manifest: state.registry.versions[version],
            bytes: Buffer.from(
              state.writes.find((item) => item.version === version).bytes,
              "base64"
            ),
            statement: state.statement,
            signaturesVerified: !state.invalidSignature,
            signerIdentity: state.foreignSigner
              ? "https://github.com/foreign/repository/.github/workflows/release.yml@refs/heads/main"
              : "https://github.com/danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main",
          }
        : null,
  },
};
require(input.process)
  .runRelease(input.request, services)
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
