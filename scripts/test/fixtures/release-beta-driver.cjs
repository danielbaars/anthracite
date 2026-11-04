const fs = require("node:fs");
const path = require("node:path");
const input = JSON.parse(fs.readFileSync(process.argv[2]));
const state = JSON.parse(fs.readFileSync(input.state));
const save = () => fs.writeFileSync(input.state, JSON.stringify(state));
const services = {
  github: {
    repository: async () => ({
      full_name: "danielbaars/anthracite",
      default_branch: "main",
    }),
    main: async () => state.main,
    tag: async () => state.tag || null,
    release: async () =>
      state.release
        ? {
            ...state.release,
            assets: Object.fromEntries(
              Object.entries(state.release.assets).map(([name, value]) => [
                name,
                Buffer.from(value, "base64"),
              ])
            ),
          }
        : null,
    retain: async ({ tag, source, prerelease, assets }) => {
      if (!state.release)
        state.release = { tag, source, prerelease, assets: {} };
      state.tag = source;
      for (const [name, bytes] of Object.entries(assets)) {
        if (
          state.release.assets[name] &&
          state.release.assets[name] !== bytes.toString("base64")
        )
          throw Error("Conflicting durable asset");
        state.release.assets[name] = bytes.toString("base64");
      }
      save();
    },
  },
  registry: {
    snapshot: async () => {
      state.snapshots = (state.snapshots || 0) + 1;
      if (state.mutateArtifactBeforeWrite && state.snapshots === 2)
        fs.appendFileSync(
          path.join(input.request.output, "danielbaars-anthracite.tgz"),
          "changed after verification"
        );
      return state.registry;
    },
    publish: async ({ tarball, channel, version }) => {
      state.writes.push({
        channel,
        version,
        bytes: fs.readFileSync(tarball).toString("base64"),
      });
      state.registry["dist-tags"].beta = version;
      if (state.moveLatest) state.registry["dist-tags"].latest = "0.6.10";
      state.registry.versions[version] = {
        name: "@danielbaars/anthracite",
        version,
        dist: { integrity: input.intent.artifact.integrity },
      };
      save();
    },
    inspect: async (version) => {
      if (state.missingReadback || !state.registry.versions[version])
        return null;
      return {
        manifest: state.registry.versions[version],
        bytes: Buffer.from(state.writes[0].bytes, "base64"),
        signaturesVerified: !state.invalidSignature,
        signerIdentity: state.foreignSigner
          ? "https://github.com/foreign/repository/.github/workflows/release.yml@refs/heads/main"
          : "https://github.com/danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main",
        statement: state.statement,
      };
    },
  },
};
require(input.process)
  .runRelease(input.request, services)
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
