const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runRelease, version, REPOSITORY } = require("./release-channels.cjs");

async function runDispatch(
  environment = process.env,
  services = require("./release-services.cjs").services()
) {
  assert.equal(
    environment.GITHUB_EVENT_NAME,
    "workflow_dispatch",
    "Manual workflow_dispatch required"
  );
  assert.equal(
    environment.GITHUB_ACTIONS,
    "true",
    "GitHub Actions execution required"
  );
  assert.equal(
    environment.GITHUB_REPOSITORY,
    REPOSITORY,
    "Wrong dispatch repository"
  );
  assert.equal(
    environment.GITHUB_REF,
    "refs/heads/main",
    "Dispatch requires the default-branch ref"
  );
  assert.equal(
    environment.GITHUB_WORKFLOW_REF,
    `${REPOSITORY}/.github/workflows/release.yml@refs/heads/main`,
    "Wrong executing workflow"
  );
  assert.match(
    environment.GITHUB_SHA || "",
    /^[a-f0-9]{40}$/,
    "Expected immutable dispatcher commit"
  );
  assert.equal(
    environment.GITHUB_WORKFLOW_SHA,
    environment.GITHUB_SHA,
    "Executing workflow must match the dispatcher commit"
  );
  assert.match(
    environment.GITHUB_RUN_ID || "",
    /^[1-9]\d*$/,
    "Invalid actual run ID"
  );
  assert.match(
    environment.GITHUB_RUN_ATTEMPT || "",
    /^[1-9]\d*$/,
    "Invalid actual run attempt"
  );
  for (const key of ["GITHUB_ACTOR", "GITHUB_TRIGGERING_ACTOR"])
    assert.match(
      environment[key] || "",
      /^[A-Za-z0-9][A-Za-z0-9-]*$/,
      "Invalid actual actor"
    );
  for (const key of ["GITHUB_WORKSPACE", "RUNNER_TEMP", "GITHUB_EVENT_PATH"])
    assert.ok(
      typeof environment[key] === "string" && path.isAbsolute(environment[key]),
      `Absolute ${key} required`
    );
  const event = JSON.parse(fs.readFileSync(environment.GITHUB_EVENT_PATH));
  assert.equal(
    event.repository?.full_name,
    REPOSITORY,
    "Wrong event repository"
  );
  assert.equal(
    event.repository?.default_branch,
    "main",
    "Wrong event repository default branch"
  );
  assert.equal(
    event.sender?.login,
    environment.GITHUB_ACTOR,
    "Event actor differs from original actor"
  );
  const inputs = event.inputs;
  assert.ok(
    inputs && typeof inputs === "object" && !Array.isArray(inputs),
    "Manual inputs required"
  );
  const fields = [
    "operation",
    "beta_source",
    "beta_version",
    "stable_tag",
    "practice",
    "confirmation",
  ];
  for (const [key, value] of Object.entries(inputs)) {
    assert.ok(fields.includes(key), `Unsupported input: ${key}`);
    assert.equal(
      typeof value,
      "string",
      `Literal string input required: ${key}`
    );
  }
  assert.ok(
    ["beta", "stable"].includes(inputs.operation),
    "Explicit beta or stable operation required"
  );
  const beta = version(inputs.beta_version, true);
  let source;
  let intendedVersion;
  if (inputs.operation === "beta") {
    assert.match(
      inputs.beta_source || "",
      /^[a-f0-9]{40}$/,
      "Expected immutable beta source commit"
    );
    for (const field of ["stable_tag", "practice", "confirmation"])
      assert.ok(!inputs[field], `Contradictory beta input: ${field}`);
    source = inputs.beta_source;
    intendedVersion = inputs.beta_version;
  } else {
    assert.ok(!inputs.beta_source, "Contradictory stable input: beta_source");
    assert.match(
      inputs.stable_tag || "",
      /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
      "Canonical existing stable tag required"
    );
    intendedVersion = inputs.stable_tag.slice(1);
    assert.equal(
      inputs.confirmation,
      intendedVersion,
      "Stable confirmation must equal the intended stable version"
    );
    assert.equal(
      beta.target,
      intendedVersion,
      "Selected beta target differs from stable version"
    );
    assert.equal(
      inputs.practice,
      `release:v${inputs.beta_version}/practice.json`,
      "Supported exact-beta practice reference required"
    );
  }
  assert.equal(
    environment.NPM_TRUSTED_PUBLISHING,
    "true",
    "Trusted publication is disabled"
  );
  // The tag resolves once here; core checks detect movement rather than selecting a new source.
  if (inputs.operation === "stable") {
    source = await services.github.tag(inputs.stable_tag);
    assert.match(
      source || "",
      /^[a-f0-9]{40}$/,
      "Existing stable tag must resolve to an immutable commit"
    );
  }
  const request = {
    operation: inputs.operation,
    repository: REPOSITORY,
    checkout: environment.GITHUB_WORKSPACE,
    output: path.join(environment.RUNNER_TEMP, `release-${intendedVersion}`),
    source,
    dispatcher: environment.GITHUB_SHA,
    version: intendedVersion,
    run: {
      id: environment.GITHUB_RUN_ID,
      attempt: environment.GITHUB_RUN_ATTEMPT,
      actor: environment.GITHUB_TRIGGERING_ACTOR,
      originalActor: environment.GITHUB_ACTOR,
      triggeringActor: environment.GITHUB_TRIGGERING_ACTOR,
    },
    ...(inputs.operation === "stable"
      ? {
          tag: inputs.stable_tag,
          betaVersion: inputs.beta_version,
          practice: inputs.practice,
          confirmation: inputs.confirmation,
        }
      : {}),
  };
  if (inputs.operation === "beta")
    await runRelease({ ...request, operation: "prepare-beta" }, services);
  const result = await runRelease(request, services);
  // Verification decisions remain in core; a display failure cannot undo a confirmed write.
  try {
    const { summarize } = require("./release-summary.cjs");
    const display = summarize(
      result,
      fs.readFileSync(path.join(request.output, "intent.json"))
    );
    if (environment.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, display.markdown);
    return { ...result, operatorSummary: display.operatorSummary };
  } catch (error) {
    console.error(
      `Release summary unavailable: ${error.message}; inspect the verified result and retained records`
    );
    return result;
  }
}
module.exports = { runDispatch };
if (require.main === module) {
  runDispatch()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`Release refused: ${error.message}`);
      process.exitCode = 1;
    });
}
