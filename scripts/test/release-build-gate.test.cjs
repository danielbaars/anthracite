const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { fixture } = require("./fixtures/release-stable-setup.cjs");

test(
  "release build refusal identifies the failed package gate and its exit status",
  { timeout: 180000 },
  () => {
    const f = fixture();
    try {
      fs.writeFileSync(
        path.join(f.checkout, "scripts/test-npm-package.cjs"),
        "process.stderr.write('deliberate package gate failure\\n'); process.exit(7);\n"
      );
      const source = f.commit("Capture failing package gate fixture");
      f.state.main = source;
      f.write(f.state);
      const result = f.invoke({ source, dispatcher: source });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /scripts\/test-npm-package\.cjs/);
      assert.match(result.stderr, /exit(?: code)? 7/);
      assert.match(result.stderr, /deliberate package gate failure/);
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
      assert.equal(
        fs.existsSync(path.join(f.request.output, "intent.json")),
        false
      );
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);

test(
  "release preparation allows a successful package gate beyond the former three-minute cap",
  { timeout: 420000 },
  () => {
    const f = fixture();
    try {
      // Real child delay exercises the parent process timer, not a mocked timeout value.
      fs.writeFileSync(
        path.join(f.checkout, "scripts/test-npm-package.cjs"),
        "setTimeout(() => console.log('delayed fixture package gate completed'), 185000);\n"
      );
      const source = f.commit("Capture delayed package gate fixture");
      f.state.main = source;
      f.write(f.state);
      const result = f.invoke({ source, dispatcher: source });
      assert.equal(result.status, 0, result.stderr);
      const prepared = JSON.parse(
        result.stdout.slice(result.stdout.indexOf("{"))
      );
      assert.equal(prepared.status, "prepared");
      assert.equal(JSON.parse(fs.readFileSync(f.statePath)).writes.length, 0);
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
);
