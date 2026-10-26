#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const assets = path.resolve(process.argv[2] || 'release');
const version = require('../apps/cli/package.json').version;
const platform = `${os.platform()}-${os.arch()}`;
const asset = { 'darwin-arm64': 'an-macos-arm64', 'darwin-x64': 'an-macos-x64', 'linux-x64': 'an-linux-x64' }[platform];
assert.ok(asset, `Unsupported test platform: ${platform}`);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anthracite-install-'));
let cases = 0;
function run(script, home, expected = 0, directory = assets) {
  const environment = { ...process.env, HOME: home, ANTHRACITE_RELEASE_DIR: directory };
  delete environment.ZDOTDIR;
  delete environment.BUN_BE_BUN;
  const result = spawnSync('sh', [path.join(root, 'scripts', script), version], { env: environment, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result;
}
function directory(name) {
  const result = path.join(temporary, name);
  fs.mkdirSync(result, { recursive: true });
  return result;
}
try {
  const home = directory('fresh home');
  const shellConfig = 'export EXISTING_CONFIGURATION=kept\n';
  fs.writeFileSync(path.join(home, '.zshrc'), shellConfig);
  run('install.sh', home);
  for (const command of ['an', 'anthracite']) {
    const result = spawnSync(path.join(home, '.local/bin', command), ['--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), version);
  }
  assert.equal(fs.readFileSync(path.join(home, '.local/share/anthracite', version, 'zshrc.before'), 'utf8'), shellConfig);
  const completion = fs.readFileSync(path.join(home, '.local/share/anthracite/completion.zsh'), 'utf8');
  assert.match(completion, /compdef _an_yargs_completions an anthracite/);
  cases++;
  run('install.sh', home);
  const rc = fs.readFileSync(path.join(home, '.zshrc'), 'utf8');
  assert.equal((rc.match(/# >>> Anthracite local install >>>/g) || []).length, 1);
  assert.ok(rc.startsWith(shellConfig));
  cases++;
  const legacy = directory('managed previous version');
  fs.mkdirSync(path.join(legacy, '.local/bin'), { recursive: true });
  fs.mkdirSync(path.join(legacy, '.local/share/anthracite/0.1.0'), { recursive: true });
  for (const name of ['an', 'anthracite']) fs.symlinkSync(path.join(legacy, '.local/share/anthracite/0.1.0/an'), path.join(legacy, '.local/bin', name));
  fs.writeFileSync(path.join(legacy, '.zshrc'), shellConfig + '# >>> Anthracite local install >>>\nsource "$HOME/.local/share/anthracite/0.1.0/completion.zsh"\n# <<< Anthracite local install <<<\n');
  run('install.sh', legacy);
  assert.equal(fs.readlinkSync(path.join(legacy, '.local/bin/an')), path.join(legacy, '.local/share/anthracite', version, 'an'));
  assert.ok(!fs.readFileSync(path.join(legacy, '.zshrc'), 'utf8').includes('/0.1.0/'));
  cases++;
  const protectedHome = directory('protected command');
  fs.mkdirSync(path.join(protectedHome, '.local/bin'), { recursive: true });
  fs.writeFileSync(path.join(protectedHome, '.local/bin/an'), 'unrelated executable');
  run('install.sh', protectedHome, 1);
  assert.equal(fs.readFileSync(path.join(protectedHome, '.local/bin/an'), 'utf8'), 'unrelated executable');
  assert.ok(!fs.existsSync(path.join(protectedHome, '.local/share/anthracite', version)));
  cases++;
  const corrupt = directory('corrupt assets');
  for (const name of [asset, 'LICENSE', 'CREDITS.md', 'SHA256SUMS']) fs.copyFileSync(path.join(assets, name), path.join(corrupt, name));
  fs.appendFileSync(path.join(corrupt, asset), 'corrupted');
  const corruptHome = directory('rejected checksum');
  run('install.sh', corruptHome, 1, corrupt);
  assert.ok(!fs.existsSync(path.join(corruptHome, '.local/bin/an')));
  cases++;
  run('uninstall.sh', home);
  assert.ok(!fs.existsSync(path.join(home, '.local/bin/an')));
  assert.ok(!fs.existsSync(path.join(home, '.local/bin/anthracite')));
  assert.equal(fs.readFileSync(path.join(home, '.zshrc'), 'utf8'), shellConfig);
  assert.ok(fs.existsSync(path.join(home, '.local/share/anthracite', version, 'an')));
  run('uninstall.sh', protectedHome);
  assert.equal(fs.readFileSync(path.join(protectedHome, '.local/bin/an'), 'utf8'), 'unrelated executable');
  cases++;
  console.log(`${cases} installer scenarios passed using the actual native executable.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
