import { spawnSync } from 'child_process';
import fs from 'fs';
import { z } from 'zod';
import path from 'path';
import { runAbsorbGit as git } from './absorb_git';
import { getAbsorbRoot, readAbsorbGit } from './absorb_git';
import { runGitCommand } from '../lib/git/runner';
import { readIndex } from '../lib/git/index_state';
import { PreconditionsFailedError } from '../lib/errors';

type SavedFile = {
  readonly file: string;
  readonly kind: 'file' | 'link' | 'absent';
  readonly data: string;
  readonly mode: number;
};
export type AbsorbInput = {
  readonly directory: string;
  readonly tree: string;
  readonly files: readonly SavedFile[];
};

/** Literal restoration is bounded to repositories without byte conversions. */
export function assertAbsorbInputSupported(revisions: readonly string[]): void {
  const autocrlf = readAbsorbGit([
    'config',
    '--default',
    'false',
    '--get',
    'core.autocrlf',
  ]).trim();
  if (autocrlf && autocrlf !== 'false')
    throw new PreconditionsFailedError(
      'Absorb does not yet support working-tree conversions.'
    );
  const indexed = readAbsorbGit(['ls-files', '-s', '-z']);
  if (indexed.split('\0').some((entry) => entry.startsWith('160000 ')))
    throw new PreconditionsFailedError(
      'Absorb does not yet support submodule working trees.'
    );
  const paths = readAbsorbGit(['ls-files', '-z']);
  const attributes = readAbsorbGit(
    [
      'check-attr',
      '--cached',
      '-z',
      '--stdin',
      'filter',
      'text',
      'eol',
      'working-tree-encoding',
      'ident',
    ],
    paths
  ).split('\0');
  for (let i = 2; i < attributes.length; i += 3)
    if (attributes[i] !== 'unspecified' && attributes[i] !== 'unset')
      throw new PreconditionsFailedError(
        'Absorb does not yet support working-tree conversions.'
      );
  for (const revision of revisions) {
    const files = readAbsorbGit([
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      revision,
    ]).split('\0');
    for (const file of files.filter(
      (name) => name === '.gitattributes' || name.endsWith('/.gitattributes')
    )) {
      const contents = readAbsorbGit(['show', revision + ':' + file]);
      if (
        /(?:^|[ \t])(?:filter|text|eol|working-tree-encoding|ident)(?:[= \t]|$)/m.test(
          contents
        )
      )
        throw new PreconditionsFailedError(
          'Absorb does not yet support working-tree conversions in replay history.'
        );
    }
  }
}

/** Owned copies survive Git abort and legacy continuation cleanup. */
export function retainAbsorbInput(source: string): AbsorbInput {
  const root = getAbsorbRoot();
  const directory = fs.mkdtempSync(
    path.resolve(
      root,
      readAbsorbGit(['rev-parse', '--git-path', 'an-absorb-']).trim()
    )
  );
  const tree = runGitCommand({
    args: ['write-tree'],
    onError: 'throw',
    resource: 'absorbInput',
  });
  const paths = [
    ...new Set(
      [
        ...readAbsorbGit(['ls-files', '-z']).split('\0'),
        ...readAbsorbGit(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split(
          '\0'
        ),
      ].filter(Boolean)
    ),
  ];
  const files = paths.map((file): SavedFile => {
    assertOrdinaryParents(root, file);
    const location = path.join(root, file);
    const stat = fs.lstatSync(location, { throwIfNoEntry: false });
    if (!stat) return { file, kind: 'absent', data: '', mode: 0 };
    if (stat.isSymbolicLink())
      return {
        file,
        kind: 'link',
        data: fs.readlinkSync(location),
        mode: stat.mode,
      };
    if (!stat.isFile())
      throw new PreconditionsFailedError(`Cannot retain non-file ${file}.`);
    return {
      file,
      kind: 'file',
      data: fs.readFileSync(location).toString('base64'),
      mode: stat.mode,
    };
  });
  const originalHead = readAbsorbGit(['rev-parse', 'HEAD']).trim();
  const originalTree = readAbsorbGit(['rev-parse', 'HEAD^{tree}']).trim();
  const scratch = path.join(directory, 'working-index');
  const env = { ...process.env, GIT_INDEX_FILE: scratch };
  let workingTree: string;
  try {
    git(['read-tree', tree], { env });
    for (const saved of files) {
      if (saved.kind === 'absent')
        git(['update-index', '--force-remove', '--', saved.file], { env });
      else {
        const oid = git(['hash-object', '-w', '--stdin'], {
          input:
            saved.kind === 'link'
              ? saved.data
              : Buffer.from(saved.data, 'base64'),
        });
        git(
          [
            'update-index',
            '--add',
            '--cacheinfo',
            saved.kind === 'link'
              ? '120000'
              : saved.mode & 0o111
              ? '100755'
              : '100644',
            oid,
            saved.file,
          ],
          { env }
        );
      }
    }
    workingTree = git(['write-tree'], { env });
  } finally {
    fs.rmSync(scratch, { force: true });
  }
  fs.writeFileSync(path.join(directory, 'index'), readIndex());
  runGitCommand({
    args: ['pack-objects', '--revs', path.join(directory, 'index-objects')],
    options: { input: [tree, originalTree, workingTree].join('\n') + '\n' },
    onError: 'throw',
    resource: 'absorbInputObjects',
  });
  // The self-contained pack keeps every index blob recoverable after Git pruning.
  fs.writeFileSync(
    path.join(directory, 'input.json'),
    JSON.stringify({
      root,
      source,
      tree,
      files,
      originalHead,
      originalTree,
      workingTree,
    })
  );
  fs.writeFileSync(path.join(directory, 'restore.cjs'), restoreScript);
  return { directory, tree, files };
}

export function assertAbsorbInputUnchanged(input: AbsorbInput): void {
  const root = getAbsorbRoot();
  if (
    runGitCommand({
      args: ['write-tree'],
      onError: 'throw',
      resource: 'absorbInputCheck',
    }) !== input.tree
  )
    throw new PreconditionsFailedError(
      'Absorb source work changed during construction. Retained input is available; inspect hook effects.'
    );
  for (const saved of input.files) {
    assertOrdinaryParents(root, saved.file);
    const location = path.join(root, saved.file);
    const stat = fs.lstatSync(location, { throwIfNoEntry: false });
    const same =
      saved.kind === 'absent'
        ? !stat
        : saved.kind === 'link'
        ? stat?.isSymbolicLink() && fs.readlinkSync(location) === saved.data
        : stat?.isFile() &&
          fs.readFileSync(location).toString('base64') === saved.data &&
          (stat.mode & 0o111) === (saved.mode & 0o111);
    if (!same)
      throw new PreconditionsFailedError(
        'Absorb source work changed during construction. Retained input is available; inspect hook effects.'
      );
  }
}

export function restoreAbsorbInput(input: AbsorbInput): void {
  // The standalone path performs the same collision checks during manual recovery.
  const result = spawnSync(
    process.execPath,
    [path.join(input.directory, 'restore.cjs')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(process.versions.bun ? { BUN_BE_BUN: '1' } : {}),
      },
    }
  );
  if (result.error || result.status !== 0)
    throw new PreconditionsFailedError(
      result.stderr || result.error?.message || 'Input restoration failed.'
    );
}

const restoreScript = `const fs=require('fs'),path=require('path'),cp=require('child_process');
const dir=__dirname, input=JSON.parse(fs.readFileSync(path.join(dir,'input.json'),'utf8'));
const git=(args,options={})=>cp.execFileSync('git',['--no-optional-locks','--literal-pathspecs','-C',input.root,...args],options);
const safePath=file=>{ const parts=file.split('/'); if(path.isAbsolute(file)||parts.includes('..')) throw Error('Invalid retained path.'); let parent=input.root; for(const part of parts.slice(0,-1)) {parent=path.join(parent,part); const stat=fs.lstatSync(parent,{throwIfNoEntry:false}); if(stat&&(stat.isSymbolicLink()||!stat.isDirectory())) throw Error('Restoration parent collision at '+file); } return path.join(input.root,file); };
try {
 if(git(['branch','--show-current']).toString().trim()!==input.source) throw Error('Switch to original source '+input.source+' before restoration.');
 for(const name of ['rebase-merge','rebase-apply','MERGE_HEAD','CHERRY_PICK_HEAD']) {
  if(fs.existsSync(path.resolve(input.root,git(['rev-parse','--git-path',name]).toString().trim()))) throw Error('Finish or abort active Git operation before restoring input.');
 }
 const guardFile=path.join(dir,'guard.json');
 const guard=fs.existsSync(guardFile)?JSON.parse(fs.readFileSync(guardFile,'utf8')):undefined;
 const expectedHead=guard?.expected.find(entry=>entry.ref==='refs/heads/'+input.source)?.oid??input.originalHead;
 if(git(['rev-parse','HEAD']).toString().trim()!==expectedHead) throw Error('Source HEAD changed; inspect saved input and preserve newer commits before restoration.');
 for(const file of fs.readdirSync(dir).filter(name=>(name.startsWith('index-objects-')||name.startsWith('replay-objects-')||name.startsWith('restoration-objects-'))&&name.endsWith('.pack'))) git(['unpack-objects','-q'],{input:fs.readFileSync(path.join(dir,file))});
 const matchesTree=tree=>cp.spawnSync('git',['--no-optional-locks','-C',input.root,'diff-index','--cached','--quiet','--no-ext-diff','--no-textconv',tree,'--']).status===0;
 if(!matchesTree(input.tree)&&!matchesTree(expectedHead)) throw Error('New staged work exists; save it separately before restoration.');
 const reachedTree=git(['rev-parse','HEAD^{tree}']).toString().trim();
 if(input.nominalTree && reachedTree!==input.nominalTree && reachedTree!==input.originalTree) {
  if(!matchesTree(expectedHead)||git(['diff-files','--name-only','-z']).length) throw Error('New source work exists; save it separately before restoration.');
  const scratch=path.join(dir,'remainder-index'), env={...process.env,GIT_INDEX_FILE:scratch};
  const scratchGit=(args,options={})=>git(args,{...options,env});
  const applyDelta=(from,to)=>{
   const patch=git(['diff','--binary','--full-index','--no-ext-diff','--no-textconv','--no-renames','--no-color','--no-relative','--diff-algorithm=myers','--no-indent-heuristic','--src-prefix=a/','--dst-prefix=b/',from,to]);
   if(patch.length) scratchGit(['apply','--cached','--3way','--whitespace=nowarn'],{input:patch});
   return scratchGit(['write-tree']).toString().trim();
  };
  try {
   scratchGit(['read-tree',expectedHead]);
   const staged=applyDelta(input.nominalTree,input.tree);
   const working=applyDelta(input.tree,input.workingTree);
   const paths=git(['diff-tree','--no-commit-id','--name-only','-r','-z',expectedHead,working]).toString().split('\\0').filter(Boolean);
   for(const file of paths) {
    const indexed=git(['ls-files','-z','--',file]).length;
    if(!indexed&&fs.lstatSync(safePath(file),{throwIfNoEntry:false})) throw Error('Restoration collision at '+file);
   }
   // All merge checks happened in an owned index; only a clean reached checkout is published.
   if(!matchesTree(expectedHead)||git(['diff-files','--name-only','-z']).length) throw Error('Source changed during restoration.');
   git(['read-tree','--reset','-u',working]);
   git(['read-tree',staged]);
  } finally { fs.rmSync(scratch,{force:true}); }
  return;
 }
 const current=git(['ls-files','-z']).toString().split('\\0').filter(Boolean);
 const wanted=new Set(input.files.map(f=>f.file));
 if(current.some(file=>!wanted.has(file))) throw Error('New indexed work exists; save it separately before restoration.');
 for(const f of input.files) {
  const location=safePath(f.file), stat=fs.lstatSync(location,{throwIfNoEntry:false});
  const original=f.kind==='absent'?!stat:f.kind==='file'?stat?.isFile()&&fs.readFileSync(location).toString('base64')===f.data&&(stat.mode&73)===(f.mode&73):stat?.isSymbolicLink()&&fs.readlinkSync(location)===f.data;
  if(original) continue;
  const entry=git(['ls-tree','HEAD','--',f.file]).toString();
  if(!entry) { if(!stat) continue; throw Error('Restoration collision at '+f.file); }
  if(!stat) throw Error('New deletion at '+f.file+'; save it separately before restoration.');
  const expected=git(['show','HEAD:'+f.file]);
  const same=entry.startsWith('120000')?stat.isSymbolicLink()&&fs.readlinkSync(location)===expected.toString():stat.isFile()&&fs.readFileSync(location).equals(expected)&&!!(stat.mode&73)===entry.startsWith('100755');
  if(!same) throw Error('New work at '+f.file+'; save it separately before restoration.');
 }

 const index=path.resolve(input.root,git(['rev-parse','--git-path','index']).toString().trim());
 const lock=index+'.lock'; fs.writeFileSync(lock,fs.readFileSync(path.join(dir,'index')),{flag:'wx'});
 try {
  for(const f of input.files) {
   const location=safePath(f.file);
   if(fs.existsSync(location)||fs.lstatSync(location,{throwIfNoEntry:false})) fs.unlinkSync(location);
   if(f.kind!=='absent') fs.mkdirSync(path.dirname(location),{recursive:true});
   if(f.kind==='link') fs.symlinkSync(f.data,location);
   if(f.kind==='file') { fs.writeFileSync(location,Buffer.from(f.data,'base64')); fs.chmodSync(location,f.mode); }
  }
  fs.renameSync(lock,index);
 } catch(error) { if(fs.existsSync(lock)) fs.unlinkSync(lock); throw error; }
} catch(error) { console.error(error.message); process.exitCode=1; }
`;

export function readRetainedAbsorbInput(directory: string): AbsorbInput {
  const saved = z
    .object({
      tree: z.string(),
      files: z.array(
        z.object({
          file: z.string(),
          kind: z.enum(['file', 'link', 'absent']),
          data: z.string(),
          mode: z.number(),
        })
      ),
    })
    .parse(
      JSON.parse(fs.readFileSync(path.join(directory, 'input.json'), 'utf8'))
    );
  return { directory, ...saved };
}

/** Retain nominal content and original ranges as real packed objects, including after pruning. */
// eslint-disable-next-line max-params
export function retainAbsorbRestorationBase(
  input: AbsorbInput,
  nominalTree: string,
  revisions: readonly string[],
  anchor: string
): void {
  const file = path.join(input.directory, 'input.json');
  const saved = z
    .object({
      originalHead: z.string(),
      originalTree: z.string(),
      workingTree: z.string(),
    })
    .passthrough()
    .parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify({ ...saved, nominalTree }));
  git(
    [
      'pack-objects',
      '--revs',
      path.join(input.directory, 'restoration-objects'),
    ],
    { input: nominalTree + '\n' }
  );
  git(
    ['pack-objects', '--revs', path.join(input.directory, 'replay-objects')],
    { input: [...revisions, '^' + anchor].join('\n') + '\n' }
  );
}

/** Read a tracked leaf literally, without traversing a replaced parent link. */
export function assertOrdinaryParents(root: string, file: string): void {
  let parent = root;
  for (const part of file.split('/').slice(0, -1)) {
    parent = path.join(parent, part);
    const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink())
      throw new PreconditionsFailedError(
        `Absorb cannot follow a parent-directory symlink for ${file}.`
      );
    if (!stat.isDirectory())
      throw new PreconditionsFailedError(
        `Absorb requires ordinary parent directories for ${file}.`
      );
  }
}
