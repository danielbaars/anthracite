import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('pager and completion policy through the public CLI', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    for (const key of ['CH_PAGER', 'TEST_CH_PAGER', 'GIT_PAGER', 'PAGER'])
      fixture.env[key] = '';
    delete fixture.env.GRAPHITE_INTERACTIVE;
  });
  function relevantEnvironment() {
    return Object.fromEntries(
      Object.entries(fixture.env).filter(([key]) =>
        /^(CH_PAGER|TEST_CH_PAGER|GIT_PAGER|PAGER|LESS|LV|GRAPHITE_INTERACTIVE|GRAPHITE_USER_CONFIG_PATH|GIT_CONFIG_GLOBAL|GIT_CONFIG_NOSYSTEM|NO_COLOR|PATH|XDG_CONFIG_HOME)$/.test(
          key
        )
      )
    );
  }
  afterEach(() => {
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence) {
      const directory = path.join(evidence, path.basename(fixture.root));
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'explicit-environment.json'),
        JSON.stringify(relevantEnvironment(), null, 2)
      );
      for (const name of [
        'policy-pager.js',
        'pager-log',
        'pager-input',
        'separate-stderr',
      ]) {
        const file = path.join(fixture.root, name);
        if (fs.existsSync(file))
          fs.copyFileSync(file, path.join(directory, name));
      }
    }
    fixture?.cleanup();
  });

  function pager(mode = 'consume') {
    const script = path.join(fixture.root, 'policy-pager.js');
    const log = path.join(fixture.root, 'pager-log');
    const input = path.join(fixture.root, 'pager-input');
    fs.writeFileSync(
      script,
      [
        "const fs = require('fs');",
        `fs.appendFileSync(${JSON.stringify(
          log
        )}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),less:process.env.LESS,lv:process.env.LV})+'\\n');`,
        ...(mode === 'consume'
          ? [
              `fs.writeFileSync(${JSON.stringify(input)}, fs.readFileSync(0));`,
              "process.stdout.write('PAGED_ONCE\\n');",
            ]
          : [
              "process.stdout.write('PAGER_STOPPED\\n');",
              `process.exitCode=${mode === 'fail' ? 23 : 0};`,
            ]),
      ].join('\n')
    );
    return {
      command: `'${process.execPath}' '${script}' --policy-argument`,
      log,
      input,
    };
  }

  function terminal(args: ReadonlyArray<string>, descriptor = 'both') {
    const command = getTestCliCommand(args);
    const wrapper = `
import os, subprocess, sys, json
command=json.loads(sys.argv[1])
mode=sys.argv[2]
if mode == 'stdin-pipe':
    result=subprocess.run(command,input=b'',timeout=10)
elif mode == 'stdout-pipe':
    result=subprocess.run(command,stdout=subprocess.PIPE,timeout=10)
    sys.stdout.buffer.write(result.stdout)
elif mode == 'stderr-file':
    with open(sys.argv[3],'wb') as output:
        result=subprocess.run(command,stderr=output,timeout=10)
else:
    result=subprocess.run(command,preexec_fn=lambda:os.close(0),timeout=10)
sys.exit(result.returncode)
`;
    const argv =
      descriptor === 'both'
        ? command
        : [
            '/usr/bin/python3',
            '-c',
            wrapper,
            JSON.stringify(command),
            descriptor,
            path.join(fixture.root, 'separate-stderr'),
          ];
    const result = runCliInPty(argv, { cwd: fixture.repo, env: fixture.env });
    fixture.savePty(result);
    const evidence = process.env.CHARCOAL_TEST_EVIDENCE_DIR;
    if (evidence)
      fs.appendFileSync(
        path.join(evidence, 'pager-commands.jsonl'),
        JSON.stringify({
          environment: relevantEnvironment(),
          tools: Object.fromEntries(
            [
              'policy-pager.js',
              'pager-log',
              'pager-input',
              'separate-stderr',
            ].map((name) => {
              const file = path.join(fixture.root, name);
              return [
                name,
                fs.existsSync(file)
                  ? fs.readFileSync(file).toString('base64')
                  : null,
              ];
            })
          ),
          command,
          argv,
          cwd: fixture.repo,
          descriptor,
          result,
        }) + '\n'
      );
    return result;
  }

  it('writes logs directly to pipes without starting a configured pager', () => {
    const selected = pager();
    fixture.env.CH_PAGER = selected.command;
    for (const route of [['log'], ['log', 'short'], ['ls']]) {
      const result = fixture.run([...route, '--interactive']);
      expect(result.status, result.stderr).to.equal(0);
      expect(result.stdout).to.include('base').and.include('main');
      expect(result.stderr).to.equal('');
      expect(fs.existsSync(selected.log)).to.equal(false);
    }
  });
  it('reports a real pager failure without repeating log content', () => {
    const selected = pager('fail');
    fixture.env.CH_PAGER = selected.command;
    const result = terminal(['log', 'short', '--interactive']);
    expect(result.status, result.output).to.equal(1);
    expect(result.output).to.include('PAGER_STOPPED').and.include('ERROR:');
    expect(result.output).not.to.include('base').and.not.to.include('main');
    expect(
      fs.readFileSync(selected.log, 'utf8').trim().split('\n')
    ).to.have.length(1);
  });

  it('applies the same paging and quiet rules to the internal Git log and ll', () => {
    const selected = pager();
    fixture.env.CH_PAGER = selected.command;
    fixture.env.GIT_PAGER = selected.command;
    for (const route of [['log', 'long'], ['ll']]) {
      const direct = fixture.run([...route, '--interactive']);
      expect(direct.status, direct.stderr).to.equal(0);
      expect(direct.stdout).to.include('base').and.include('main');
      expect(fs.existsSync(selected.log)).to.equal(false);
      const quiet = fixture.run([...route, '--quiet', '--interactive']);
      expect(quiet.status, quiet.stderr).to.equal(0);
      expect(quiet.stdout).to.equal('');
      const paged = terminal([...route, '--interactive']);
      expect(paged.status, paged.output).to.equal(0);
      expect(paged.output).to.include('PAGED_ONCE');
      expect(fs.readFileSync(selected.input, 'utf8'))
        .to.include('base')
        .and.include('main');
      fs.unlinkSync(selected.log);
    }
  });

  it('returns explicitly requested completion data under quiet without a pager', () => {
    const selected = pager();
    fixture.env.CH_PAGER = selected.command;
    for (const route of [
      ['fish'],
      ['completion'],
      ['--get-yargs-completions', 'an', 'checkout', ''],
    ]) {
      const direct = fixture.run([...route, '--quiet']);
      expect(direct.status, direct.stderr).to.equal(0);
      expect(direct.stdout, route.join(' ')).not.to.equal('');
      expect(direct.stderr).to.equal('');
      expect(fs.existsSync(selected.log)).to.equal(false);
    }
    for (const flags of [['--quiet', '--interactive'], ['--interactive']]) {
      const fish = terminal(['fish', ...flags]);
      expect(fish.status, fish.output).to.equal(0);
      expect(fish.output).to.include('function __an_command_completions');
    }
    expect(fs.existsSync(selected.log)).to.equal(false);
  });

  it('requires both terminal descriptors for log paging, even with explicit interaction', () => {
    const selected = pager();
    fixture.env.CH_PAGER = selected.command;
    fixture.env.GIT_PAGER = selected.command;
    for (const route of [['log'], ['ls'], ['ll']]) {
      for (const descriptor of ['stdin-pipe', 'stdout-pipe', 'stdin-closed']) {
        const result = terminal([...route, '--interactive'], descriptor);
        expect(result.status, result.output).to.equal(0);
        expect(result.output).to.include('base').and.include('main');
        expect(fs.existsSync(selected.log), descriptor).to.equal(false);
      }
    }
  });

  it('pages the exact short log once and obeys quiet, no-interactive and legacy restrictions', () => {
    const selected = pager();
    fixture.env.CH_PAGER = selected.command;
    const direct = fixture.run(['ls', '--no-interactive']);
    expect(direct.status, direct.stderr).to.equal(0);
    const paged = terminal(['ls']);
    expect(paged.status, paged.output).to.equal(0);
    expect(fs.readFileSync(selected.input, 'utf8')).to.equal(
      direct.stdout.replace(/\n$/, '')
    );
    const invocation = JSON.parse(fs.readFileSync(selected.log, 'utf8').trim());
    expect(invocation.args).to.deep.equal(['--policy-argument']);
    expect(invocation.cwd).to.equal(fs.realpathSync(fixture.repo));
    fs.unlinkSync(selected.log);
    for (const route of [['log'], ['ls'], ['ll']]) {
      const quiet = terminal([...route, '--quiet', '--interactive']);
      expect(quiet.status, quiet.output).to.equal(0);
      expect(quiet.output).to.equal('');
      const disabled = terminal([...route, '--no-interactive']);
      expect(disabled.status, disabled.output).to.equal(0);
      expect(disabled.output).to.include('base');
      fixture.env.GRAPHITE_INTERACTIVE = '1';
      const legacy = terminal([...route, '--interactive']);
      expect(legacy.status, legacy.output).to.equal(0);
      expect(legacy.output).to.include('base');
      delete fixture.env.GRAPHITE_INTERACTIVE;
      expect(fs.existsSync(selected.log)).to.equal(false);
    }
    const restored = terminal(['ls', '--quiet=false']);
    expect(restored.status, restored.output).to.equal(0);
    expect(restored.output).to.include('PAGED_ONCE');
  });

  it('treats an early successful pager quit as success and sends failure diagnostics to stderr', () => {
    for (const route of [['log'], ['ls'], ['ll']]) {
      const quit = pager('quit');
      fixture.env.CH_PAGER = quit.command;
      const success = terminal([...route, '--interactive']);
      expect(success.status, success.output).to.equal(0);
      expect(success.output)
        .to.include('PAGER_STOPPED')
        .and.not.include('ERROR:');
      fs.unlinkSync(quit.log);
      const failed = pager('fail');
      fixture.env.CH_PAGER = failed.command;
      const failure = terminal([...route, '--interactive'], 'stderr-file');
      expect(failure.status, failure.output).to.equal(1);
      expect(failure.output)
        .to.include('PAGER_STOPPED')
        .and.not.include('ERROR:')
        .and.not.include('base');
      expect(
        fs.readFileSync(path.join(fixture.root, 'separate-stderr'), 'utf8')
      )
        .to.include('ERROR:')
        .and.include('23');
      fs.unlinkSync(failed.log);
    }
  });

  it('preserves stored, environment and Git pager resolution with explicit empty disabling', () => {
    const selected = pager();
    const stored = terminal(['user', 'pager', '--set', selected.command]);
    expect(stored.status, stored.output).to.equal(0);
    delete fixture.env.CH_PAGER;
    const configured = terminal(['ls']);
    expect(configured.status, configured.output).to.equal(0);
    expect(configured.output).to.include('PAGED_ONCE');
    fs.unlinkSync(selected.log);
    fixture.env.CH_PAGER = '';
    expect(terminal(['ls']).output).to.include('base');
    expect(fs.existsSync(selected.log)).to.equal(false);
    delete fixture.env.CH_PAGER;
    fixture.ok(['user', 'pager', '--unset']);
    fixture.env.TEST_CH_PAGER = selected.command;
    expect(terminal(['ls']).output).to.include('PAGED_ONCE');
    fs.unlinkSync(selected.log);
    delete fixture.env.TEST_CH_PAGER;
    fixture.env.GIT_CONFIG_GLOBAL = path.join(
      fixture.root,
      'global-git-config'
    );
    fixture.git(['config', '--global', 'core.pager', selected.command]);
    expect(terminal(['ls']).output).to.include('PAGED_ONCE');
    fs.unlinkSync(selected.log);
    fixture.git(['config', '--global', '--unset', 'core.pager']);
    fixture.env.GIT_PAGER = selected.command;
    expect(terminal(['ls']).output).to.include('PAGED_ONCE');
    fs.unlinkSync(selected.log);
    delete fixture.env.GIT_PAGER;
    fixture.env.PAGER = selected.command;
    expect(terminal(['ls']).output).to.include('PAGED_ONCE');
    fs.unlinkSync(selected.log);
    fixture.ok(['user', 'pager', '--disable']);
    expect(terminal(['ls']).output).to.include('base');
    expect(fs.existsSync(selected.log)).to.equal(false);
  });
});
