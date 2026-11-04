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
      if (
        state.failFinalRetention &&
        Object.keys(assets).some((name) => name.startsWith("verification-"))
      )
        throw Error("Durable verification upload unavailable");
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
      if (
        state.changeDurableBeforeWrite &&
        Object.keys(assets).some((name) => name.startsWith("attempt-"))
      )
        state.releases[tag].assets["tests.json"] = Buffer.from(
          "changed by another actor"
        ).toString("base64");
      save();
    },
  },
  registry: {
    snapshot: async () => {
      state.snapshots = (state.snapshots || 0) + 1;
      if (state.snapshots === 2) {
        if (state.moveLatestBeforeWrite)
          state.registry["dist-tags"].latest = "0.6.10";
        if (state.moveBetaBeforeWrite)
          state.registry["dist-tags"].beta = "0.7.0-beta.3";
        if (state.changePracticeBeforeWrite)
          state.practice.maintainer.disposition = "pending";
        if (state.invalidateBetaBeforeWrite) state.invalidSignature = true;
        if (state.changeArtifactBeforeWrite)
          fs.appendFileSync(
            require("node:path").join(
              input.request.output,
              "danielbaars-anthracite.tgz"
            ),
            "changed"
          );
      }
      return structuredClone(state.registry);
    },
    publish: async ({ tarball, channel, version }) => {
      if (state.publishDelayMs) {
        state.publishEntered = true;
        save();
        await new Promise((resolve) =>
          setTimeout(resolve, state.publishDelayMs)
        );
      }
      if (state.rejectPublish) {
        state.rejections = (state.rejections || 0) + 1;
        save();
        const error = Error("Registry definitely rejected publication");
        error.code = "E403";
        throw error;
      }
      const bytes = fs.readFileSync(tarball);
      const intent =
        input.intent ||
        JSON.parse(
          fs.readFileSync(
            require("node:path").join(input.request.output, "intent.json")
          )
        );
      if (channel === "latest") {
        const release = state.releases[`v${version}`];
        for (const name of [
          "intent.json",
          "danielbaars-anthracite.tgz",
          "SHA256SUMS",
          "tests.json",
          "assessment.json",
          "practice.json",
          "beta-intent.json",
          "beta-verification.json",
        ])
          if (!release.assets[name])
            throw Error(`Missing stable evidence before write: ${name}`);
      }
      if (channel === "latest" || input.dispatch) {
        state.statements ||= {};
        state.statements[version] = {
          predicateType: "https://slsa.dev/provenance/v1",
          subject: [
            {
              name: `pkg:npm/%40danielbaars/anthracite@${version}`,
              digest: {
                sha512: require("node:crypto")
                  .createHash("sha512")
                  .update(bytes)
                  .digest("hex"),
              },
            },
          ],
          predicate: {
            buildDefinition: {
              externalParameters: {
                workflow: {
                  ref: "refs/heads/main",
                  repository: "https://github.com/danielbaars/anthracite",
                  path: ".github/workflows/release.yml",
                },
              },
              resolvedDependencies: [
                { digest: { gitCommit: input.request.dispatcher } },
              ],
            },
            runDetails: {
              metadata: {
                invocationId: `https://github.com/danielbaars/anthracite/actions/runs/${input.request.run.id}/attempts/${input.request.run.attempt}`,
              },
            },
          },
        };
      }
      state.writes.push({ channel, version, bytes: bytes.toString("base64") });
      state.registry["dist-tags"][channel] = version;
      state.registry.versions[version] = {
        name: "@danielbaars/anthracite",
        version,
        dist: { integrity: intent.artifact.integrity },
      };
      if (state.moveLatestAfterBeta && channel === "beta")
        state.registry["dist-tags"].latest = "0.6.10";
      if (state.moveTagAfterWrite) state.tags[`v${version}`] = "a".repeat(40);
      if (state.moveBetaAfterWrite && channel === "latest")
        state.registry["dist-tags"].beta = "0.7.0-beta.3";
      if (state.wrongLatestAfterWrite && channel === "latest")
        state.registry["dist-tags"].latest = "0.6.9";
      save();
      if (state.lostResponse)
        throw Error("Connection lost after accepted publication");
    },
    inspect: async (version, options = {}) => {
      if (!state.registry.versions[version]) return null;
      if (version === input.request.version) {
        state.inspectCalls = (state.inspectCalls || 0) + 1;
        state.deadlines ||= [];
        state.deadlines.push(options.deadline - Date.now());
        save();
        if (state.delayedManifest > 0) {
          state.delayedManifest--;
          save();
          return null;
        }
        if (state.delayedProvenance > 0) {
          state.delayedProvenance--;
          save();
          const error = Error("Provenance not yet visible");
          error.retryable = true;
          throw error;
        }
        if (state.registryUnavailableAfterWrite) {
          const error = Error("Registry read unavailable");
          error.retryable = true;
          throw error;
        }
      }
      if (state.moveLatestDuringInspect && version === input.request.version) {
        state.registry["dist-tags"].latest = "0.6.10";
        state.registry.versions["0.6.10"] = {
          name: "@danielbaars/anthracite",
          version: "0.6.10",
          dist: { integrity: "sha512-external-stable" },
        };
        save();
      }
      return state.registry.versions[version]
        ? {
            manifest: state.registry.versions[version],
            bytes: Buffer.from(
              state.writes.find((item) => item.version === version).bytes,
              "base64"
            ),
            statement: state.statements?.[version] || state.statement,
            signaturesVerified: !state.invalidSignature,
            signerIdentity: state.foreignSigner
              ? "https://github.com/foreign/repository/.github/workflows/release.yml@refs/heads/main"
              : "https://github.com/danielbaars/anthracite/.github/workflows/release.yml@refs/heads/main",
          }
        : null;
    },
  },
};
(input.dispatch
  ? require(input.process).runDispatch(process.env, services)
  : require(input.process).runRelease(input.request, services)
)
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error.message);
    if (error.cause)
      console.error(
        "Release gate cause:",
        JSON.stringify({
          code: error.cause.code,
          signal: error.cause.signal,
          message: error.cause.message,
        })
      );
    process.exitCode = 1;
  });
