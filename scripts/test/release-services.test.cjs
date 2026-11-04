const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");
const shim = `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const state=JSON.parse(fs.readFileSync(process.env.RELEASE_SERVICE_STATE));
state.calls.push(args);
let response;
if(args[0]==='api') {
 const route=args.find(value=>value.startsWith('repos/'));
 if(route.includes('matching-refs')) response=state.release ? [{ref:'refs/tags/v0.7.0-beta.1',object:{type:'commit',sha:'a'.repeat(40)}}] : [];
 else if(route.endsWith('/assets?per_page=100')) response=[Object.entries(state.assets).map(([name,bytes],index)=>({name,id:index+1}))];
 else if(route.includes('/releases/assets/')) {const id=Number(route.split('/').pop());response=Buffer.from(Object.values(state.assets)[id-1],'base64');}
 else if(route.includes('/releases?per_page=100')) response=[state.release ? [{id:1,tag_name:'v0.7.0-beta.1',prerelease:!state.changed,draft:false}] : []];
 else throw Error('Unexpected read '+route);
} else if(args[0]==='release' && args[1]==='upload') {
 const file=args[3];state.uploads++;state.assets[require('node:path').basename(file)]=fs.readFileSync(file).toString('base64');if(state.changeAfterUpload)state.changed=true;
} else throw Error('Forbidden mutation '+args.join(' '));
fs.writeFileSync(process.env.RELEASE_SERVICE_STATE,JSON.stringify(state));
if(Buffer.isBuffer(response))process.stdout.write(response);else if(response!==undefined)process.stdout.write(JSON.stringify(response));
`;
test("durable adapter never recreates missing releases on append and preserves conflicting assets", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "anthracite-release-adapter-")
  );
  try {
    fs.writeFileSync(path.join(temporary, "gh"), shim, { mode: 0o755 });
    const statePath = path.join(temporary, "state.json");
    const invoke = (state, request) => {
      fs.writeFileSync(
        statePath,
        JSON.stringify({ calls: [], uploads: 0, assets: {}, ...state })
      );
      fs.writeFileSync(
        path.join(temporary, "request.json"),
        JSON.stringify(request)
      );
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `const fs=require('node:fs');const value=JSON.parse(fs.readFileSync(process.argv[1]));value.assets=Object.fromEntries(Object.entries(value.assets).map(([name,bytes])=>[name,Buffer.from(bytes)]));require(process.argv[2]).services().github.retain(value).catch(error=>{console.error(error.message);process.exitCode=1});`,
          path.join(temporary, "request.json"),
          path.join(root, "scripts/release-services.cjs"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: temporary + path.delimiter + process.env.PATH,
            RELEASE_SERVICE_STATE: statePath,
          },
        }
      );
      return { result, state: JSON.parse(fs.readFileSync(statePath)) };
    };
    const request = {
      tag: "v0.7.0-beta.1",
      source: "a".repeat(40),
      prerelease: true,
      assets: { "verification-1234-1.json": "observed" },
    };
    for (const [changes, pattern] of [
      [{}, /append-only retention cannot recreate/],
      [{ prerelease: false }, /Existing stable GitHub release required/],
      [
        { initialRetention: true },
        /Initial retention requires complete intent/,
      ],
    ]) {
      const answer = invoke({}, { ...request, ...changes });
      assert.notEqual(answer.result.status, 0);
      assert.match(answer.result.stderr, pattern);
      assert.equal(answer.state.uploads, 0);
      assert.ok(answer.state.calls.every((args) => args[0] === "api"));
    }
    const conflict = invoke(
      {
        release: true,
        assets: { "intent.json": Buffer.from("original").toString("base64") },
      },
      { ...request, assets: { "intent.json": "changed" } }
    );
    assert.notEqual(conflict.result.status, 0);
    assert.match(conflict.result.stderr, /Conflicting durable intent/);
    assert.equal(conflict.state.uploads, 0);
    assert.equal(
      Buffer.from(conflict.state.assets["intent.json"], "base64").toString(),
      "original"
    );
    const appended = invoke({ release: true }, request);
    assert.equal(appended.result.status, 0, appended.result.stderr);
    assert.equal(appended.state.uploads, 1);
    const moved = invoke({ release: true, changeAfterUpload: true }, request);
    assert.notEqual(moved.result.status, 0);
    assert.equal(moved.state.uploads, 1);
    assert.ok(
      moved.state.calls
        .filter((args) => args[0] !== "api")
        .every((args) => args[1] === "upload")
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
