import fs from 'fs';
import path from 'path';
import type { LandPlan } from '../../actions/land';
import {
  InspectionGitResult,
  assertNoBranchConditionalLandingConfiguration,
  landingTransportArgs,
  withLandingInspection,
} from './landing_inspection_process';

export type LandingReplayAssessment =
  | { readonly status: 'clean' }
  | {
      readonly status: 'conflict';
      readonly branch: string;
      readonly paths: readonly string[];
    }
  | { readonly status: 'unavailable'; readonly reason: string };

type CommandOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowFailure?: boolean;
};
type ReplayRepository = {
  localConfigurationReady: boolean;
  readonly source: string;
  readonly directory: string;
  readonly hooks: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly originalEnvironment: NodeJS.ProcessEnv;
  readonly run: (
    args: readonly string[],
    options?: CommandOptions
  ) => Promise<InspectionGitResult>;
  readonly read: (args: readonly string[], cwd?: string) => Promise<string>;
};

async function assertSupportedInputs(
  plan: LandPlan,
  git: ReplayRepository
): Promise<void> {
  assertLandingGraph(plan);
  if (
    await git.read(
      ['for-each-ref', '--format=%(refname)', 'refs/replace'],
      git.source
    )
  )
    throw new Error(
      'Replay inspection cannot safely reproduce replacement history.'
    );
}

const replayConfigKeys = new Set([
  'merge.conflictstyle',
  'merge.renames',
  'merge.renamelimit',
  'merge.directoryrenames',
  'merge.renormalize',
  'diff.renames',
  'diff.renamelimit',
  'diff.algorithm',
  'core.autocrlf',
  'core.eol',
  'core.safecrlf',
  'rebase.backend',
  'rebase.autostash',
  'rebase.autosquash',
  'rebase.rebasemerges',
  'rebase.stat',
  'rebase.abbreviatecommands',
  'rebase.reschedulefailedexec',
  'rebase.missingcommitscheck',
  'rebase.instructionformat',
]);

function assertSafeAttributes(content: string): void {
  for (const line of content.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    for (const token of line.split(/\s+/)) {
      if (token === 'filter' || token.startsWith('filter='))
        throw new Error(
          'Replay inspection cannot safely reproduce executable filter attributes.'
        );
      if (
        token.startsWith('merge=') &&
        !['text', 'binary', 'union'].includes(token.slice(6))
      )
        throw new Error(
          'Replay inspection cannot safely reproduce custom merge attributes.'
        );
    }
  }
}

function readAttributeFile(file: string): string {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024)
    throw new Error(
      'Replay inspection cannot safely read nonregular or oversized attribute rules.'
    );
  const content = fs.readFileSync(file, 'utf8');
  assertSafeAttributes(content);
  return content;
}

type ReplayConfiguration = {
  readonly key: string;
  readonly value: string | null;
  readonly scope: string;
  readonly origin: string;
};

async function effectiveReplayConfiguration(
  git: ReplayRepository
): Promise<ReplayConfiguration[]> {
  const configured = await git.run(
    [
      'config',
      '--null',
      '--show-origin',
      '--show-scope',
      '--get-regexp',
      '^(merge\\.|filter\\.|rebase\\.|diff\\.|rerere\\.|core\\.(attributesfile|autocrlf|eol|safecrlf)|extensions\\.objectformat)',
    ],
    { cwd: git.source, env: git.originalEnvironment, allowFailure: true }
  );
  if (configured.code !== 0 && configured.code !== 1)
    throw new Error('Replay inspection could not read replay configuration.');
  const fields = configured.stdout.split('\0');
  if (fields.pop() !== '' || fields.length % 3 !== 0)
    throw new Error('Replay inspection received invalid configuration.');
  const effective = new Map<string, ReplayConfiguration>();
  for (let index = 0; index < fields.length; index += 3) {
    const entry = fields[index + 2];
    const separator = entry.indexOf('\n');
    const key = (
      separator < 0 ? entry : entry.slice(0, separator)
    ).toLowerCase();
    effective.set(key, {
      key,
      value: separator < 0 ? null : entry.slice(separator + 1),
      scope: fields[index],
      origin: fields[index + 1],
    });
  }
  return [...effective.values()];
}

async function assertSupportedReplayControls(
  git: ReplayRepository,
  settings: readonly ReplayConfiguration[]
): Promise<void> {
  for (const key of ['rebase.updaterefs', 'rerere.enabled']) {
    const setting = settings.find((item) => item.key === key);
    if (!setting) {
      if (key !== 'rerere.enabled') continue;
      const cache = await git.read(
        ['rev-parse', '--path-format=absolute', '--git-path', 'rr-cache'],
        git.source
      );
      if (!fs.existsSync(cache)) continue;
      throw new Error(
        `Replay inspection cannot reproduce local replay with implicit rerere.enabled=true from ${cache}. Use an effective rerere.enabled=false for this local replay, then preview again.`
      );
    }
    const result = await git.run(['config', '--type=bool', '--get', key], {
      cwd: git.source,
      env: git.originalEnvironment,
      allowFailure: true,
    });
    if (result.code === 0 && result.stdout.trim() === 'false') continue;
    const value = result.code === 0 ? 'true' : 'invalid boolean';
    throw new Error(
      `Replay inspection cannot reproduce local replay with effective ${key}=${value} (${setting.scope}, ${setting.origin}). Use an effective ${key}=false for this local replay, then preview again.`
    );
  }
}

async function copyReplayConfiguration(git: ReplayRepository): Promise<void> {
  await assertNoBranchConditionalLandingConfiguration(git, git.source);
  const settings = await effectiveReplayConfiguration(git);
  await assertSupportedReplayControls(git, settings);
  for (const { key, value, scope, origin } of settings) {
    if (replayConfigKeys.has(key) && value !== null)
      await git.run(['config', key, value]);
    else if (
      key === 'merge.default' &&
      value !== null &&
      ['text', 'binary', 'union'].includes(value)
    )
      await git.run(['config', key, value]);
    else if (
      key === 'core.attributesfile' ||
      key.startsWith('filter.') ||
      key.startsWith('diff.') ||
      /^merge\..+\.(driver|recursive|name)$/.test(key) ||
      [
        'merge.tool',
        'merge.guitool',
        'merge.log',
        'merge.branchdesc',
        'rebase.updaterefs',
        'rerere.enabled',
        'rerere.autoupdate',
      ].includes(key)
    )
      continue;
    else
      throw new Error(
        `Replay inspection cannot safely reproduce replay configuration ${key} (${scope}, ${origin}).`
      );
  }
  const inherited: string[] = [];
  for (const variable of ['GIT_ATTR_SYSTEM', 'GIT_ATTR_GLOBAL']) {
    if (
      variable === 'GIT_ATTR_SYSTEM' &&
      git.originalEnvironment.GIT_ATTR_NOSYSTEM
    )
      continue;
    const result = await git.run(['var', variable], {
      cwd: git.source,
      env: git.originalEnvironment,
      allowFailure: true,
    });
    if (result.code !== 0)
      throw new Error(
        'Replay inspection cannot locate inherited attribute rules safely.'
      );
    const file = result.stdout.trim();
    if (file && fs.existsSync(file)) {
      inherited.push(readAttributeFile(file));
    }
  }
  const attributes = path.join(git.directory, '.git', 'inspection-attributes');
  fs.writeFileSync(attributes, inherited.join('\n'));
  await git.run(['config', 'core.attributesFile', attributes]);
  const info = await git.read(
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/attributes'],
    git.source
  );
  if (fs.existsSync(info)) {
    const content = readAttributeFile(info);
    fs.mkdirSync(path.join(git.directory, '.git', 'info'), { recursive: true });
    fs.writeFileSync(
      path.join(git.directory, '.git', 'info', 'attributes'),
      content
    );
  }
}

async function prepareReplayObjects(
  plan: LandPlan,
  remote: string,
  git: ReplayRepository
): Promise<void> {
  if (!plan.remoteTrunk)
    throw new Error('Remote trunk is unavailable for replay inspection.');
  const objects = await git.read(
    ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
    git.source
  );
  await git.run(['init', '--quiet', '--template=', git.directory], {
    cwd: path.dirname(git.directory),
  });
  fs.writeFileSync(
    path.join(git.directory, '.git', 'objects', 'info', 'alternates'),
    objects + '\n'
  );
  for (const [key, value] of [
    ['user.name', 'Anthracite replay inspection'],
    ['user.email', 'replay@example.invalid'],
    ['core.hooksPath', git.hooks],
    ['core.attributesFile', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['commit.gpgSign', 'false'],
    ['rebase.updateRefs', 'false'],
    ['rerere.enabled', 'false'],
  ])
    await git.run(['config', key, value]);
  fs.copyFileSync(
    path.join(git.directory, '.git', 'config'),
    path.join(git.directory, '.git', 'inspection-server-config')
  );
  if (
    (
      await git.run(['cat-file', '-e', `${plan.remoteTrunk}^{commit}`], {
        allowFailure: true,
      })
    ).code !== 0
  ) {
    const url = (
      await git.run(['remote', 'get-url', remote], {
        cwd: git.source,
        env: git.originalEnvironment,
      })
    ).stdout.trim();
    const fetchEnvironment: NodeJS.ProcessEnv = {
      ...git.originalEnvironment,
      GIT_TERMINAL_PROMPT: '0',
    };
    for (const key of Object.keys(fetchEnvironment))
      if (
        key === 'GIT_CONFIG_PARAMETERS' ||
        key === 'GIT_CONFIG_COUNT' ||
        key.startsWith('GIT_CONFIG_KEY_') ||
        key.startsWith('GIT_CONFIG_VALUE_')
      )
        delete fetchEnvironment[key];
    await git.run(
      [
        '-c',
        `core.hooksPath=${git.hooks}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'maintenance.auto=false',
        '-c',
        'gc.auto=0',
        '-c',
        'fetch.recurseSubmodules=false',
        ...(await landingTransportArgs(git, git.source)),
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        url,
        `refs/heads/${plan.trunk}`,
      ],
      { env: fetchEnvironment }
    );
    await git.run(['cat-file', '-e', `${plan.remoteTrunk}^{commit}`]);
  }
  const commits = new Set<string>([plan.remoteTrunk]);
  for (const member of [...plan.merges, ...plan.maintenance]) {
    commits.add(member.base);
    for (const commit of (
      await git.read(['rev-list', `${member.base}..${member.head}`])
    )
      .split('\n')
      .filter(Boolean))
      commits.add(commit);
  }
  for (const commit of commits) {
    const files = (
      await git.run(['ls-tree', '-r', '--name-only', '-z', commit])
    ).stdout.split('\0');
    for (const file of files.filter(
      (name) => path.posix.basename(name) === '.gitattributes'
    ))
      assertSafeAttributes(
        (await git.run(['show', `${commit}:${file}`])).stdout
      );
  }
}

async function replayCommits(
  git: ReplayRepository,
  input: {
    readonly branch: string;
    readonly onto: string;
    readonly from: string;
    readonly head: string;
    readonly force: boolean;
  }
): Promise<string | LandingReplayAssessment> {
  if (!input.force && !git.localConfigurationReady) {
    await copyReplayConfiguration(git);
    git.localConfigurationReady = true;
  }
  const config = path.join(git.directory, '.git', 'config');
  const attributes = path.join(git.directory, '.git', 'info', 'attributes');
  const localConfig = input.force ? fs.readFileSync(config) : undefined;
  const localAttributes =
    input.force && fs.existsSync(attributes)
      ? fs.readFileSync(attributes)
      : undefined;
  try {
    if (input.force) {
      // GitHub's rebase does not inherit local replay settings or private attributes.
      fs.copyFileSync(
        path.join(git.directory, '.git', 'inspection-server-config'),
        config
      );
      fs.rmSync(attributes, { force: true });
    }
    await git.run(['checkout', '--quiet', '--force', '--detach', input.head]);
    const result = await git.run(
      [
        'rebase',
        ...(input.force ? ['--force-rebase'] : []),
        '--onto',
        input.onto,
        input.from,
      ],
      { allowFailure: true }
    );
    if (result.code === 0) return git.read(['rev-parse', 'HEAD']);
    if (result.code !== 1)
      throw new Error(
        'Replay inspection failed without a completed conflict assessment.'
      );
    const paths = (
      await git.run(['diff', '--name-only', '--diff-filter=U', '-z'])
    ).stdout
      .split('\0')
      .filter(Boolean);
    if (paths.length)
      return { status: 'conflict', branch: input.branch, paths };
    throw new Error(
      'Replay inspection failed without verified conflict paths.'
    );
  } finally {
    if (localConfig) fs.writeFileSync(config, localConfig);
    if (localAttributes) fs.writeFileSync(attributes, localAttributes);
  }
}

function assertLandingGraph(plan: LandPlan): void {
  const first = plan.merges[0];
  if (!first) throw new Error('Replay merge scope is unavailable.');
  let parent = plan.trunk;
  for (const member of plan.merges) {
    if (member.parent !== parent)
      throw new Error('Replay merge chain changed its captured parent.');
    parent = member.branch;
  }
  const known = new Set([plan.trunk]);
  for (const member of [...plan.merges, ...plan.maintenance]) {
    if (
      known.has(member.branch) ||
      !known.has(member.parent) ||
      (member !== first && member.parent === plan.trunk)
    )
      throw new Error(
        'Replay mandatory participant graph is unavailable or inconsistent.'
      );
    known.add(member.branch);
  }
}

function capturedSurvivors(
  plan: LandPlan,
  position: number
): LandPlan['maintenance'] {
  const current = plan.merges[position];
  if (!current) throw new Error('Replay merge scope is unavailable.');
  const affected = new Set([current.branch]);
  const survivors: LandPlan['merges'][number][] = [];
  for (const member of [
    ...plan.merges.slice(position + 1),
    ...plan.maintenance,
  ]) {
    if (!affected.has(member.parent)) continue;
    affected.add(member.branch);
    survivors.push(member);
  }
  return survivors;
}

async function simulateLandingGraph(
  plan: LandPlan,
  git: ReplayRepository
): Promise<LandingReplayAssessment> {
  if (!plan.remoteTrunk)
    throw new Error('Remote trunk is unavailable for replay inspection.');
  const members = [...plan.merges, ...plan.maintenance];
  const reached = new Map(
    members.map((member) => [
      member.branch,
      { head: member.head, base: member.base, parent: member.parent },
    ])
  );
  for (const member of members) {
    if (
      member.mergedResult &&
      (
        await git.run(
          [
            'merge-base',
            '--is-ancestor',
            member.mergedResult,
            plan.remoteTrunk,
          ],
          { allowFailure: true }
        )
      ).code !== 0
    )
      throw new Error(
        'Replay cleanup-only result is not verified in captured remote trunk.'
      );
  }
  let trunk = plan.remoteTrunk;
  for (const [index, target] of plan.merges.entries()) {
    const current = reached.get(target.branch);
    if (!current) throw new Error('Replay participant is unavailable.');
    if (!target.mergedResult) {
      const merged = await replayCommits(git, {
        branch: target.branch,
        onto: trunk,
        from:
          index === 0 ? target.pr?.baseRefOid ?? current.base : current.base,
        head: current.head,
        force: true,
      });
      if (typeof merged !== 'string') return merged;
      trunk = merged;
    }
    const survivors = capturedSurvivors(plan, index);
    const landedParents = new Set([
      target.branch,
      ...survivors
        .filter((member) => member.mergedResult)
        .map((member) => member.branch),
    ]);
    for (const member of survivors) {
      const next = reached.get(member.branch);
      if (!next) throw new Error('Replay participant is unavailable.');
      if (landedParents.has(next.parent)) next.parent = plan.trunk;
    }
    for (const member of survivors) {
      if (member.mergedResult) continue;
      const next = reached.get(member.branch);
      if (!next) throw new Error('Replay participant is unavailable.');
      const onto =
        next.parent === plan.trunk ? trunk : reached.get(next.parent)?.head;
      if (!onto) throw new Error('Replay parent is unavailable.');
      if (next.base === onto) continue;
      const value = await replayCommits(git, {
        branch: member.branch,
        onto,
        from: next.base,
        head: next.head,
        force: false,
      });
      if (typeof value !== 'string') return value;
      next.head = value;
      next.base = onto;
    }
  }
  return { status: 'clean' };
}

/** Simulate only in owned disposable storage; generated OIDs never authorize effects. */
export async function inspectLandingReplay(
  plan: LandPlan,
  remote: string
): Promise<LandingReplayAssessment> {
  try {
    return await withLandingInspection(
      'an-land-replay-',
      async (inspection) => {
        const directory = path.join(inspection.temporary, 'replay');
        const git: ReplayRepository = {
          ...inspection,
          localConfigurationReady: false,
          source: process.cwd(),
          directory,
          run: (args, options = {}) =>
            inspection.run(args, { ...options, cwd: options.cwd ?? directory }),
          read: async (args, cwd = directory) =>
            (await inspection.run(args, { cwd })).stdout.trim(),
        };
        await assertSupportedInputs(plan, git);
        await prepareReplayObjects(plan, remote, git);
        return await simulateLandingGraph(plan, git);
      }
    );
  } catch (error: unknown) {
    return {
      status: 'unavailable',
      reason:
        error instanceof Error
          ? error.message
          : 'Replay inspection is unavailable.',
    };
  }
}
