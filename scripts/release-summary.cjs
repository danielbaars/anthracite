const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash } = require("node:crypto");

// Display only: callers must first complete the release process's verification.
function summarize(result, intentBytes) {
  assert.equal(result.status, "verified", "Publication is not verified");
  assert.equal(
    createHash("sha256").update(intentBytes).digest("hex"),
    result.intentSha256,
    "Retained intent digest differs from verified publication"
  );
  const intent = JSON.parse(intentBytes);
  for (const field of ["channel", "version", "package", "repository"])
    assert.equal(
      intent[field],
      result[field],
      `Verified ${field} differs from intent`
    );
  assert.equal(
    intent.source.commit,
    result.source,
    "Verified source differs from intent"
  );
  assert.deepEqual(
    intent.artifact,
    result.artifact,
    "Verified artifact differs from intent"
  );
  const assessment = intent.assessment;
  const operatorSummary = {
    channel: result.channel,
    version: result.version,
    source: result.source,
    selectedBeta:
      assessment?.beta ||
      (result.channel === "beta"
        ? {
            version: intent.version,
            source: intent.source.commit,
            artifact: intent.artifact,
          }
        : null),
    sourceEquivalent: assessment?.sourceEquivalent ?? null,
    artifact: result.artifact,
    checks: {
      ...intent.tests,
      basis: "validated retained intent; original artifact gate",
      rerunByDisplay: false,
    },
    practice: assessment?.practice || {
      disposition: result.channel === "beta" ? "pending" : "unavailable",
    },
    actualPublishingRun: result.run,
    actualTags: result.tags,
    confirmedWrites: result.confirmedWrites,
    npmWritesThisInvocation: result.npmWrites,
    publishOutcome: result.publishOutcome,
    next: result.next,
  };
  const lines = [
    `Channel / version: ${result.channel} / ${result.version}`,
    `Source: ${result.source}`,
    `Selected beta: ${
      operatorSummary.selectedBeta?.version ?? "unavailable"
    } (${operatorSummary.selectedBeta?.source ?? "unavailable"})`,
    `Source equivalence: ${
      operatorSummary.sourceEquivalent === null
        ? "not assessed"
        : operatorSummary.sourceEquivalent
    }`,
    `Artifact SHA256: ${result.artifact.sha256}`,
    `Checks: ${
      intent.tests?.passed === true ? "passed" : "unavailable"
    }; validated retained intent, not rerun by display; ${(
      intent.tests?.checks || []
    ).join(", ")}`,
    `Practice disposition: ${
      operatorSummary.practice.disposition
    }; reference: ${operatorSummary.practice.reference || "pending"}`,
    `Actual publishing run / attempt: ${result.run.id} / ${result.run.attempt}`,
    `Actual tags: ${JSON.stringify(result.tags)}`,
    `Confirmed writes: ${JSON.stringify(
      result.confirmedWrites
    )}; npm writes this invocation: ${result.npmWrites ?? "unavailable"}`,
    `Publication outcome: ${
      result.publishOutcome || "retained verified record"
    }`,
    `Next action: ${
      result.next || "Inspect retained verification before further action"
    }`,
  ];
  // A fenced block keeps external strings from becoming Markdown links or directives.
  const markdown =
    "## npm publication verified\n\n```text\n" +
    lines.join("\n").replaceAll("```", "''' ") +
    "\n```\n";
  return { operatorSummary, markdown };
}
module.exports = { summarize };
if (require.main === module) {
  try {
    console.log(
      JSON.stringify(
        summarize(
          JSON.parse(fs.readFileSync(0)),
          fs.readFileSync(process.argv[2])
        ),
        null,
        2
      )
    );
  } catch (error) {
    console.error(`Release summary unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
