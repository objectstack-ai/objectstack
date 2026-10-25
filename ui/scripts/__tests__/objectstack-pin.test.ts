/**
 * objectui#12957 — `scripts/objectstack-pin.mjs`, the pinned build of `@objectstack/*`.
 *
 * Three layers:
 *   1. the contract readers and the override-set check, on literals — every
 *      refusal paired with the accepted shape beside it;
 *   2. the REAL tree: the root manifest's overrides cover every `@objectstack/*`
 *      name the workspace declares, so none can resolve from npm;
 *   3. the stand-in path end to end (`OBJECTSTACK_ROOT`), over a throwaway
 *      objectstack-shaped workspace packed by the real `pnpm pack` — the input
 *      objectstack#24306 consumes. No network: nothing is fetched or installed.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CACHE_DIR,
  ENTRY_FILE,
  OVERRIDE_PREFIX,
  PIN_DIR,
  PinRefusal,
  RECIPE,
  STAMP_FILE,
  STORE_ENV,
  build,
  canonicalManifest,
  check,
  checkOverrideSet,
  checkoutPin,
  declaredObjectstackNames,
  dependencyDrift,
  entryTargets,
  hashTree,
  judgeStamp,
  lockfileDependencyNames,
  materialize,
  objectstackEnv,
  publishToStore,
  pruneStore,
  storeDir,
  storeKey,
  takeFromStore,
  annotation,
  tailLines,
  readOverrides,
  readPin,
  readWorkspace,
  runtimeClosure,
  workspaceGlobs,
} from '../objectstack-pin.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = '0123456789abcdef0123456789abcdef01234567';

// Anchored on the OS temp directory at module scope, so no path below can be
// read as relative to the process cwd (`pnpm check:test-path-roots`).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'objectstack-pin-test-'));
// No build in this file reaches the machine's real store (objectui#12972), whatever a regression does.
vi.stubEnv(STORE_ENV, path.join(scratch, 'machine-store'));
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const override = (dir: string) => `${OVERRIDE_PREFIX}${dir}`;

describe('the contract readers (objectui#12957)', () => {
  it('readPin takes one full sha with or without a trailing newline, and refuses anything else', () => {
    const dir = fs.mkdtempSync(path.join(scratch, 'pin-'));
    const pinFile = path.join(dir, '.objectstack-sha');
    fs.writeFileSync(pinFile, `${SHA}\n`);
    expect(readPin(dir)).toBe(SHA);
    fs.writeFileSync(pinFile, SHA);
    expect(readPin(dir)).toBe(SHA);
    for (const bad of [`${SHA.slice(0, 12)}\n`, `${SHA}\n\n`, `${SHA.toUpperCase()}\n`, ` ${SHA}\n`, '']) {
      fs.writeFileSync(pinFile, bad);
      expect(() => readPin(dir), JSON.stringify(bad)).toThrow(PinRefusal);
    }
    fs.rmSync(pinFile);
    expect(() => readPin(dir)).toThrow(/is missing/);
  });

  it('readOverrides accepts only the pinned-build form for @objectstack/* and ignores other overrides', () => {
    const ok = readOverrides({ pnpm: { overrides: { react: '19.2.8', '@objectstack/spec': override('spec') } } });
    expect([...ok]).toEqual([['@objectstack/spec', 'spec']]);
    expect(() => readOverrides({ pnpm: { overrides: { '@objectstack/spec': '^18.0.0-next.3' } } })).toThrow(/must be "file:\.objectstack-pin\/spec"/);
    expect(() => readOverrides({ pnpm: { overrides: { '@objectstack/spec': override('core') } } })).toThrow(PinRefusal);
    expect(() => readOverrides({ pnpm: { overrides: { '@objectstack/spec@<18': override('spec') } } })).toThrow(/no version selector/);
    expect(() => readOverrides({ pnpm: { overrides: { react: '19.2.8' } } })).toThrow(/no @objectstack\/\* override/);
  });

  it('workspaceGlobs reads the packages list only, through quotes and comments', () => {
    const yaml = "packages:\n  - 'packages/*'\n  - \"apps/*\"   # apps\n  - docs\n\nonlyBuiltDependencies:\n  - esbuild\n";
    expect(workspaceGlobs(yaml)).toEqual(['packages/*', 'apps/*', 'docs']);
  });

  it('declaredObjectstackNames reads every dependency field, and nothing outside the scope', () => {
    const names = declaredObjectstackNames([
      { manifest: { dependencies: { '@objectstack/spec': '^1', react: '1' } } },
      { manifest: { devDependencies: { '@objectstack/lint': '^1' }, peerDependencies: { '@objectstack/client': '^1' } } },
      { manifest: { optionalDependencies: { '@objectstack/formula': '^1' } } },
    ]);
    expect([...names].sort()).toEqual(['@objectstack/client', '@objectstack/formula', '@objectstack/lint', '@objectstack/spec']);
  });

  it('runtimeClosure follows runtime edges and NOT devDependencies', () => {
    const p = (deps: Record<string, string>, dev: Record<string, string> = {}) => ({ dir: 'x', manifest: { dependencies: deps, devDependencies: dev } });
    const byName = new Map<string, ReturnType<typeof p>>([
      ['@objectstack/spec', p({ zod: '^4' })],
      ['@objectstack/types', p({ '@objectstack/spec': 'workspace:*' })],
      ['@objectstack/core', p({ '@objectstack/spec': 'workspace:*', '@objectstack/types': 'workspace:*' }, { '@objectstack/runtime': 'workspace:*' })],
      ['@objectstack/client', p({ '@objectstack/core': 'workspace:*' })],
      ['@objectstack/runtime', p({})],
    ]);
    expect([...runtimeClosure(byName, ['@objectstack/client'])].sort()).toEqual([
      '@objectstack/client',
      '@objectstack/core',
      '@objectstack/spec',
      '@objectstack/types',
    ]);
    expect(() => runtimeClosure(byName, ['@objectstack/nope'])).toThrow(/not a package of the objectstack workspace/);
  });

  it('checkOverrideSet requires the overrides to EQUAL the closure of what objectui declares', () => {
    const byName = new Map([
      ['@objectstack/spec', { dir: 'packages/spec', manifest: {} }],
      ['@objectstack/types', { dir: 'packages/types', manifest: { dependencies: { '@objectstack/spec': 'workspace:*' } } }],
      ['@objectstack/core', { dir: 'packages/core', manifest: { dependencies: { '@objectstack/types': 'workspace:*' } } }],
    ]);
    const all = new Map([['@objectstack/spec', 'spec'], ['@objectstack/types', 'types'], ['@objectstack/core', 'core']]);
    expect(checkOverrideSet({ overrides: all, declared: new Set(['@objectstack/core']), byName })).toEqual([
      '@objectstack/core',
      '@objectstack/spec',
      '@objectstack/types',
    ]);
    // A declared package with no override would resolve from npm.
    expect(() =>
      checkOverrideSet({ overrides: new Map([['@objectstack/spec', 'spec']]), declared: new Set(['@objectstack/core']), byName }),
    ).toThrow(/declares @objectstack\/core but the root package\.json does not override it/);
    // A package the closure needs with no override would resolve from npm.
    expect(() =>
      checkOverrideSet({ overrides: new Map([['@objectstack/core', 'core'], ['@objectstack/spec', 'spec']]), declared: new Set(['@objectstack/core']), byName }),
    ).toThrow(/need @objectstack\/types at this objectstack commit/);
    // An override nothing reaches is refused too.
    expect(() =>
      checkOverrideSet({ overrides: all, declared: new Set(['@objectstack/spec']), byName }),
    ).toThrow(/names @objectstack\/core, @objectstack\/types, which nothing objectui uses reaches/);
  });

  it('entryTargets collects main/module/types and every non-pattern exports leaf', () => {
    expect(
      entryTargets({
        main: './dist/index.cjs',
        types: 'dist/index.d.ts',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.cjs' },
          './openapi.json': './json-schema/openapi.json',
          './*': './dist/*.mjs',
        },
      }),
    ).toEqual(['dist/index.cjs', 'dist/index.d.ts', 'dist/index.mjs', 'json-schema/openapi.json']);
  });

  it('judgeStamp trusts a cache only when it is the pin, this recipe, and these packages', () => {
    const root = fs.mkdtempSync(path.join(scratch, 'stamp-'));
    writeJson(path.join(root, CACHE_DIR, 'spec/package.json'), { name: '@objectstack/spec' });
    const overrides = new Map([['@objectstack/spec', 'spec']]);
    const good = { recipe: RECIPE, source: 'pin', sha: SHA, packages: { '@objectstack/spec': '1.0.0' } };
    expect(judgeStamp(good, { pin: SHA, overrides, root }).current).toBe(true);
    expect(judgeStamp(null, { pin: SHA, overrides, root }).current).toBe(false);
    expect(judgeStamp({ ...good, sha: 'f'.repeat(40) }, { pin: SHA, overrides, root }).why).toMatch(/the pin is 0123456789ab/);
    expect(judgeStamp({ ...good, recipe: RECIPE + 1 }, { pin: SHA, overrides, root }).current).toBe(false);
    expect(judgeStamp({ ...good, source: 'external', root: '/x' }, { pin: SHA, overrides, root }).why).toMatch(/stand-in/);
    expect(judgeStamp(good, { pin: SHA, overrides: new Map([...overrides, ['@objectstack/core', 'core']]), root }).current).toBe(false);
    fs.rmSync(path.join(root, CACHE_DIR, 'spec'), { recursive: true });
    expect(judgeStamp(good, { pin: SHA, overrides, root }).why).toMatch(/does not hold @objectstack\/spec/);
  });

  it('hashTree moves with any byte and ignores the stamp itself', () => {
    const dir = fs.mkdtempSync(path.join(scratch, 'hash-'));
    fs.mkdirSync(path.join(dir, 'spec/dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec/dist/index.mjs'), 'a');
    const first = hashTree(dir);
    fs.writeFileSync(path.join(dir, STAMP_FILE), '{}');
    expect(hashTree(dir)).toBe(first);
    fs.writeFileSync(path.join(dir, 'spec/dist/index.mjs'), 'b');
    expect(hashTree(dir)).not.toBe(first);
  });
});

describe('the lockfile must record what the build declares (objectui#12957)', () => {
  // A frozen install links a directory dependency's files but resolves its
  // dependencies from the lockfile alone — measured: a manifest given a dependency
  // the lockfile lacks installed with exit 0 and without it.
  const LOCK = [
    'lockfileVersion: \'9.0\'',
    '',
    'snapshots:',
    '',
    "  '@objectstack/core@file:.objectstack-pin/core(ai@7.0.65(zod@4.6.7))':",
    '    dependencies:',
    "      '@objectstack/spec': file:.objectstack-pin/spec(ai@7.0.65(zod@4.6.7))",
    '      zod: 4.6.7',
    '    transitivePeerDependencies:',
    '      - ai',
    '',
    "  '@objectstack/spec@file:.objectstack-pin/spec(ai@7.0.65(zod@4.6.7))':",
    '    dependencies:',
    '      zod: 4.6.7',
    '    optionalDependencies:',
    '      ai: 7.0.65(zod@4.6.7)',
    '',
    "  '@objectstack/sdui-parser@file:.objectstack-pin/sdui-parser': {}",
    '',
    '  zod@4.6.7: {}',
    '',
  ].join('\n');

  it('reads the recorded names per pinned-build package, and nothing else', () => {
    const recorded = lockfileDependencyNames(LOCK);
    expect([...recorded.keys()].sort()).toEqual(['@objectstack/core', '@objectstack/sdui-parser', '@objectstack/spec']);
    expect([...recorded.get('@objectstack/core')!].sort()).toEqual(['@objectstack/spec', 'zod']);
    expect([...recorded.get('@objectstack/spec')!].sort()).toEqual(['ai', 'zod']);
    expect(recorded.get('@objectstack/sdui-parser')!.size).toBe(0);
  });

  it('agrees with manifests that declare what it records — a peer the lockfile installs included', () => {
    const manifests = new Map<string, Record<string, unknown>>([
      ['@objectstack/core', { dependencies: { '@objectstack/spec': '18.0.0', zod: '^4.6.5' } }],
      ['@objectstack/spec', { dependencies: { zod: '^4.6.5' }, peerDependencies: { ai: '^7.0.0' } }],
      ['@objectstack/sdui-parser', {}],
    ]);
    expect(dependencyDrift(lockfileDependencyNames(LOCK), manifests)).toEqual([]);
  });

  it('names a dependency the lockfile lacks, one it records that nothing declares, and a package it has no entry for', () => {
    const manifests = new Map<string, Record<string, unknown>>([
      ['@objectstack/core', { dependencies: { '@objectstack/spec': '18.0.0', zod: '^4.6.5', 'left-pad': '^1.3.0' } }],
      ['@objectstack/spec', { peerDependencies: { ai: '^7.0.0' } }],
      ['@objectstack/types', { dependencies: { '@objectstack/spec': '18.0.0' } }],
    ]);
    expect(dependencyDrift(lockfileDependencyNames(LOCK), manifests)).toEqual([
      { name: '@objectstack/core', missing: ['left-pad'], extra: [], absent: false },
      { name: '@objectstack/spec', missing: [], extra: ['zod'], absent: false },
      { name: '@objectstack/types', missing: ['@objectstack/spec'], extra: [], absent: true },
    ]);
  });
});

describe('the committed manifests, and the build beside them (objectui#13008)', () => {
  const sha256 = (text: string) => `sha256-${crypto.createHash('sha256').update(text).digest('hex')}`;
  const PACKED = `${JSON.stringify({ name: '@objectstack/spec', version: '1.0.0', exports: { '.': './dist/index.mjs' }, dependencies: { a: '1', b: '1' } }, null, 2)}\n`;
  const overrides = new Map([['@objectstack/spec', 'spec']]);
  /** A packed build to link from, and a root whose committed manifest is `committed` (absent when null). */
  function layout(name: string, committed: string | null, packed = PACKED) {
    const base = fs.mkdtempSync(path.join(scratch, `${name}-`));
    const from = path.join(base, 'build');
    fs.mkdirSync(path.join(from, 'spec/dist'), { recursive: true });
    fs.writeFileSync(path.join(from, 'spec/package.json'), packed);
    fs.writeFileSync(path.join(from, 'spec/dist/index.mjs'), 'export {};\n');
    const root = path.join(base, 'objectui');
    writeJson(path.join(root, 'package.json'), { name: 'fake-objectui', pnpm: { overrides: { '@objectstack/spec': override('spec') } } });
    if (committed !== null) {
      fs.mkdirSync(path.join(root, PIN_DIR, 'spec'), { recursive: true });
      fs.writeFileSync(path.join(root, PIN_DIR, 'spec/package.json'), committed);
    }
    return { from, root, target: path.join(root, PIN_DIR, 'spec') };
  }

  it('links the build beside a manifest that is the pin\'s, and the install check passes only then', () => {
    const { from, root, target } = layout('equal', PACKED);
    expect(() => check({ root })).toThrow(PinRefusal);
    expect(() => check({ root }), 'the refusal names the hollow package').toThrow(/@objectstack\/spec/);
    fs.mkdirSync(path.join(target, 'stale'));
    expect(materialize(root, overrides, { from, mode: 'pin' })).toEqual({ '@objectstack/spec': sha256(PACKED) });
    // A hard link: pnpm links these same files at install time.
    expect(fs.statSync(path.join(target, 'dist/index.mjs')).ino).toBe(fs.statSync(path.join(from, 'spec/dist/index.mjs')).ino);
    expect(fs.readdirSync(target).sort(), 'what an older build left is gone').toEqual(['dist', 'package.json']);
    expect(() => check({ root })).not.toThrow();
  });

  it('REFUSES at the pin a committed manifest that differs or is missing, and writes nothing', () => {
    const { from, root, target } = layout('differs', PACKED.replace('1.0.0', '0.9.0'));
    expect(() => materialize(root, overrides, { from, mode: 'pin' })).toThrow(PinRefusal);
    expect(() => materialize(root, overrides, { from, mode: 'pin' }), 'the refusal names the manifest').toThrow(/\.objectstack-pin\/spec\/package\.json/);
    expect(fs.readdirSync(target)).toEqual(['package.json']);
    expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toContain('0.9.0');
    const missing = layout('missing', null);
    expect(() => materialize(missing.root, overrides, { from: missing.from, mode: 'pin' })).toThrow(PinRefusal);
    expect(fs.existsSync(missing.target)).toBe(false);
  });

  it('compares manifests with dependency maps sorted -- pnpm pack orders them by completion -- and nothing else', () => {
    const reordered = PACKED.replace('"a": "1",\n    "b": "1"', '"b": "1",\n    "a": "1"');
    expect(reordered, 'the reorder landed').not.toBe(PACKED);
    expect(canonicalManifest(reordered)).toBe(PACKED);
    // Equal in canonical form: accepted at the pin, and the committed bytes are left alone.
    const { from, root, target } = layout('reordered', reordered);
    materialize(root, overrides, { from, mode: 'pin' });
    expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe(reordered);
    // The order of exports conditions is meaning, not noise.
    const conditions = (first: string, second: string) => `${JSON.stringify({ name: 'x', exports: { '.': { [first]: './a', [second]: './b' } } })}\n`;
    expect(canonicalManifest(conditions('types', 'import'))).not.toBe(canonicalManifest(conditions('import', 'types')));
  });

  it('writes the packed manifest with --write-manifests and for a stand-in, and the pin restores exactly what a stand-in replaced', () => {
    const { from, root, target } = layout('write', PACKED.replace('1.0.0', '0.9.0'));
    materialize(root, overrides, { from, mode: 'write' });
    expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe(PACKED);
    // A stand-in replaces the committed manifest with its own and reports what was there.
    const standIn = layout('stand-in', PACKED, PACKED.replace('1.0.0', '2.0.0-dev'));
    const replaced = materialize(standIn.root, overrides, { from: standIn.from, mode: 'stand-in' });
    expect(fs.readFileSync(path.join(standIn.target, 'package.json'), 'utf8')).toContain('2.0.0-dev');
    // Back at the pin: the stand-in's manifest differs from the pin's, and the pin's is the one it replaced.
    const pin = layout('pin-again', null);
    expect(() => materialize(standIn.root, overrides, { from: pin.from, mode: 'pin' }), 'without the record it is drift').toThrow(PinRefusal);
    materialize(standIn.root, overrides, { from: pin.from, mode: 'pin', replaced });
    expect(fs.readFileSync(path.join(standIn.target, 'package.json'), 'utf8')).toBe(PACKED);
    // ...and nothing else: a record of other bytes does not let a different manifest through.
    const other = layout('other', PACKED.replace('1.0.0', '0.9.0'));
    expect(() => materialize(other.root, overrides, { from: other.from, mode: 'pin', replaced: { '@objectstack/spec': sha256('{}') } })).toThrow(PinRefusal);
  });
});

describe('the objectstack tree is configured by its own .npmrc (objectui#12957)', () => {
  it('drops this repository\'s npm_config_* settings and keeps the machine\'s network ones', () => {
    const env = objectstackEnv({
      PATH: '/bin',
      npm_config_engine_strict: 'true',
      npm_config_auto_install_peers: 'true',
      npm_config_https_proxy: 'http://proxy',
      npm_config_noproxy: 'localhost',
      npm_config_registry: 'https://registry.npmjs.org/',
      HTTPS_PROXY: 'http://proxy',
    });
    expect(Object.keys(env).sort()).toEqual(['HTTPS_PROXY', 'PATH', 'npm_config_https_proxy', 'npm_config_noproxy', 'npm_config_registry']);
  });
});

describe('a refusal reaches the checks API (objectui#12957)', () => {
  it('encodes a multi-line refusal as one GitHub error annotation', () => {
    expect(annotation('a 100% fail\nline two\r')).toBe('::error title=objectstack-pin::a 100%25 fail%0Aline two%0D');
  });

  it('keeps the last lines of a command\'s output', () => {
    expect(tailLines('1\n2\n3\n4\n', 2)).toBe('3\n4');
  });
});

describe('the pinned checkout is hermetic (objectui#12957)', () => {
  it('fetches exactly the pinned commit and then drops the remote, so no build script can read a moving main', () => {
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
      });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const upstream = path.join(scratch, 'hermetic-upstream');
    fs.mkdirSync(upstream, { recursive: true });
    git(upstream, 'init', '-q', '-b', 'main');
    git(upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    fs.writeFileSync(path.join(upstream, 'a.txt'), 'pinned\n');
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-qm', 'pinned');
    const pinned = git(upstream, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(upstream, 'a.txt'), 'later on main\n');
    git(upstream, 'commit', '-qam', 'later');

    const dir = path.join(scratch, 'hermetic-checkout');
    checkoutPin(dir, pinned, `file://${upstream}`, path.join(scratch, 'hermetic-fetch.log'));
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(pinned);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('pinned\n');
    expect(git(dir, 'remote')).toBe('');
  });
});

describe('the real tree (objectui#12957)', () => {
  it('overrides every @objectstack/* package the workspace declares, so none resolves from npm', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const overrides = readOverrides(manifest);
    const declared = declaredObjectstackNames(readWorkspace(repoRoot));
    expect(declared.size, 'the workspace scan found no @objectstack/* declaration at all').toBeGreaterThan(0);
    expect([...declared].filter((n) => !overrides.has(n))).toEqual([]);
  });

  it('pins one full objectstack sha', () => {
    expect(readPin(repoRoot)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('commits a manifest for every override, under the name it overrides (objectui#13008)', () => {
    const overrides = readOverrides(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')));
    for (const [name, dir] of overrides) {
      expect(JSON.parse(fs.readFileSync(path.join(repoRoot, PIN_DIR, dir, 'package.json'), 'utf8')).name, dir).toBe(name);
    }
  });
});

describe('OBJECTSTACK_ROOT stands an existing tree in (objectui#12957, objectstack#24306)', () => {
  /** A minimal objectstack-shaped workspace: spec, and core depending on it by workspace protocol. */
  function makeObjectstack(name: string, { built = true } = {}) {
    const tree = path.join(scratch, name, 'objectstack');
    writeJson(path.join(tree, 'package.json'), { name: 'fake-objectstack-root', private: true });
    fs.writeFileSync(path.join(tree, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeJson(path.join(tree, 'packages/spec/package.json'), {
      name: '@objectstack/spec',
      version: '9.9.9-test.1',
      files: ['dist'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
      dependencies: { zod: '^4.0.0' },
    });
    writeJson(path.join(tree, 'packages/core/package.json'), {
      name: '@objectstack/core',
      version: '9.9.9-test.1',
      files: ['dist'],
      exports: { '.': { import: './dist/index.mjs' } },
      dependencies: { '@objectstack/spec': 'workspace:*' },
    });
    // What `pnpm install` leaves behind: core's workspace link to spec. `pnpm pack`
    // reads the linked version to rewrite `workspace:*`, so a stand-in tree is an
    // INSTALLED tree (ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL without it).
    fs.mkdirSync(path.join(tree, 'packages/core/node_modules/@objectstack'), { recursive: true });
    fs.symlinkSync('../../../spec', path.join(tree, 'packages/core/node_modules/@objectstack/spec'));
    if (built) {
      for (const pkg of ['spec', 'core']) {
        fs.mkdirSync(path.join(tree, 'packages', pkg, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(tree, 'packages', pkg, 'dist/index.mjs'), `export const name = '${pkg}';\n`);
      }
      fs.writeFileSync(path.join(tree, 'packages/spec/dist/index.d.ts'), 'export declare const name: string;\n');
    }
    return tree;
  }

  function makeObjectui(name: string) {
    const root = path.join(scratch, name, 'objectui');
    writeJson(path.join(root, 'package.json'), {
      name: 'fake-objectui',
      private: true,
      dependencies: { '@objectstack/core': '^9.0.0' },
      pnpm: { overrides: { '@objectstack/core': override('core'), '@objectstack/spec': override('spec') } },
    });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    fs.writeFileSync(path.join(root, '.objectstack-sha'), `${SHA}\n`);
    // What `pnpm install` records for the two packages above.
    fs.writeFileSync(
      path.join(root, 'pnpm-lock.yaml'),
      [
        'snapshots:',
        "  '@objectstack/core@file:.objectstack-pin/core':",
        '    dependencies:',
        "      '@objectstack/spec': file:.objectstack-pin/spec",
        "  '@objectstack/spec@file:.objectstack-pin/spec':",
        '    dependencies:',
        '      zod: 4.6.7',
        '',
      ].join('\n'),
    );
    return root;
  }

  it('packs the tree into the pinned-build directories, publish-shaped, and stamps it as a stand-in', () => {
    const tree = makeObjectstack('stand-in');
    const root = makeObjectui('stand-in');
    const store = path.join(scratch, 'stand-in', 'store');
    const result = build({ root, env: { ...process.env, OBJECTSTACK_ROOT: tree, [STORE_ENV]: store } });
    expect(result.skipped).toBe(false);
    expect(fs.existsSync(store), 'a stand-in is not the pin: it never reaches the machine-wide store (objectui#12972)').toBe(false);
    const cache = path.join(root, CACHE_DIR);
    const core = JSON.parse(fs.readFileSync(path.join(cache, 'core/package.json'), 'utf8'));
    expect(core.dependencies['@objectstack/spec'], 'pnpm pack rewrote the workspace protocol').toBe('9.9.9-test.1');
    expect(fs.readFileSync(path.join(cache, 'spec/dist/index.mjs'), 'utf8')).toContain("'spec'");
    const stamp = JSON.parse(fs.readFileSync(path.join(cache, STAMP_FILE), 'utf8'));
    expect(stamp).toMatchObject({ recipe: RECIPE, source: 'external', root: tree, packages: { '@objectstack/core': '9.9.9-test.1', '@objectstack/spec': '9.9.9-test.1' } });
    expect(stamp.contentHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    // Linked beside its own manifests, where the overrides point; nothing was committed there before.
    expect(JSON.parse(fs.readFileSync(path.join(root, PIN_DIR, 'core/package.json'), 'utf8'))).toEqual(core);
    expect(fs.readFileSync(path.join(root, PIN_DIR, 'spec/dist/index.mjs'), 'utf8')).toContain("'spec'");
    expect(stamp.replaced).toEqual({});
    // Nothing was written into the stand-in tree.
    expect(fs.readdirSync(path.join(tree, 'packages/spec')).sort()).toEqual(['dist', 'package.json']);
    expect(fs.readdirSync(path.join(tree, 'packages/core')).sort()).toEqual(['dist', 'node_modules', 'package.json']);
    // A stand-in is never mistaken for the pin.
    expect(judgeStamp(stamp, { pin: SHA, overrides: readOverrides(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))), root }).current).toBe(false);
  });

  it('REFUSES an unbuilt tree, names the command that builds it, and keeps the previous cache', () => {
    const builtTree = makeObjectstack('unbuilt-control');
    const root = makeObjectui('unbuilt');
    build({ root, env: { ...process.env, OBJECTSTACK_ROOT: builtTree } });
    const before = fs.readFileSync(path.join(root, CACHE_DIR, STAMP_FILE), 'utf8');
    const tree = makeObjectstack('unbuilt', { built: false });
    expect(() => build({ root, env: { ...process.env, OBJECTSTACK_ROOT: tree } })).toThrow(
      /@objectstack\/core is not built in .*dist\/index\.mjs.*pnpm --filter-prod @objectstack\/core\.\.\. --filter-prod @objectstack\/spec\.\.\. run build/s,
    );
    expect(fs.readFileSync(path.join(root, CACHE_DIR, STAMP_FILE), 'utf8')).toBe(before);
    expect(fs.readdirSync(path.dirname(path.join(root, CACHE_DIR))).filter((n) => n.includes('staging'))).toEqual([]);
  });

  it('prints a remedy that builds WITH declarations whatever OS_SKIP_DTS the shell exported', () => {
    // Run verbatim under an exported OS_SKIP_DTS, a remedy without the unset builds typeless again
    // and the same refusal repeats. The unset is part of the command, so it holds in both states.
    const command = /\(cd [^\n]+ && env -u OS_SKIP_DTS pnpm --filter-prod @objectstack\/core\.\.\. --filter-prod @objectstack\/spec\.\.\. run build\)/;
    const refusal = (name: string, skipDts: string | undefined) => {
      const tree = makeObjectstack(name, { built: false });
      const root = makeObjectui(name);
      const env: NodeJS.ProcessEnv = { ...process.env, OBJECTSTACK_ROOT: tree };
      if (skipDts === undefined) delete env.OS_SKIP_DTS;
      else env.OS_SKIP_DTS = skipDts;
      try {
        build({ root, env });
      } catch (error) {
        expect(error).toBeInstanceOf(PinRefusal);
        return (error as Error).message;
      }
      throw new Error('the unbuilt tree was not refused');
    };
    const unset = refusal('remedy-skip-dts-unset', undefined);
    expect(unset).toMatch(command);
    expect(unset, 'the shell did not export it, so there is nothing to name').not.toMatch(/OS_SKIP_DTS is set/);
    const set = refusal('remedy-skip-dts-set', '1');
    expect(set).toMatch(command);
    expect(set, 'the shell exported it: the refusal names the variable').toMatch(/OS_SKIP_DTS is set in this shell/);
  });

  it('REFUSES, after the write, a tree whose packages declare dependencies the lockfile does not record', () => {
    const tree = makeObjectstack('drift');
    const specPath = path.join(tree, 'packages/spec/package.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    spec.dependencies['left-pad'] = '^1.3.0';
    writeJson(specPath, spec);
    const root = makeObjectui('drift');
    expect(() => build({ root, env: { ...process.env, OBJECTSTACK_ROOT: tree } })).toThrow(
      /@objectstack\/spec: declares left-pad, which the lockfile does not record;.*run `pnpm install`/s,
    );
    // The build stays in place: the remedy reads it.
    expect(JSON.parse(fs.readFileSync(path.join(root, CACHE_DIR, 'spec/package.json'), 'utf8')).dependencies['left-pad']).toBe('^1.3.0');
  });

  it('REFUSES a tree whose packages need an @objectstack/* package with no override', () => {
    const tree = makeObjectstack('needs-more');
    writeJson(path.join(tree, 'packages/types/package.json'), { name: '@objectstack/types', version: '9.9.9-test.1' });
    const corePath = path.join(tree, 'packages/core/package.json');
    const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
    core.dependencies['@objectstack/types'] = 'workspace:*';
    writeJson(corePath, core);
    const root = makeObjectui('needs-more');
    expect(() => build({ root, env: { ...process.env, OBJECTSTACK_ROOT: tree } })).toThrow(/need @objectstack\/types/);
    expect(fs.existsSync(path.join(root, CACHE_DIR))).toBe(false);
  });

  it('is what `pnpm pack` publishes: the pnpm on PATH answers', () => {
    // The stand-in cases above are only meaningful if they reached the real packer.
    const r = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});

describe('one build per machine, outside every checkout (objectui#12972)', () => {
  const MANIFEST = `${JSON.stringify({ name: '@objectstack/spec', version: '1.0.0', exports: { '.': './dist/index.mjs' }, dependencies: { a: '1' } })}\n`;
  const BUILT = 'export const pinned = true;\n';
  /** A checkout at the pin with no build, a cache as `build` leaves one, and the store's entry for it. */
  function machine(name: string) {
    const base = fs.mkdtempSync(path.join(scratch, `${name.replace(/ /g, '-')}-`));
    const root = path.join(base, 'objectui');
    writeJson(path.join(root, 'package.json'), { name: 'x', dependencies: { '@objectstack/spec': '1' }, pnpm: { overrides: { '@objectstack/spec': override('spec') } } });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    fs.writeFileSync(path.join(root, '.objectstack-sha'), `${SHA}\n`);
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), "snapshots:\n  '@objectstack/spec@file:.objectstack-pin/spec':\n    dependencies:\n      a: 1.0.0\n");
    const [cache, store] = [path.join(base, 'cache'), path.join(base, 'store')];
    for (const [file, text] of [[path.join(root, PIN_DIR, 'spec/package.json'), MANIFEST], [path.join(cache, 'spec/package.json'), MANIFEST], [path.join(cache, 'spec/dist/index.mjs'), BUILT]]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    writeJson(path.join(cache, STAMP_FILE), { recipe: RECIPE, source: 'pin', sha: SHA, packages: { '@objectstack/spec': '1.0.0' } });
    // Offline: a build the store does not satisfy fails fast, at the fetch.
    const env = { ...process.env, OBJECTSTACK_ROOT: '', [STORE_ENV]: store, OBJECTSTACK_REPO_URL: `file://${base}/no-such-repo` };
    return { root, cache, store, entry: path.join(store, storeKey(SHA)), env };
  }

  it('lives at an overridable path outside any checkout, keyed by the pin and this script', () => {
    expect(storeDir({ [STORE_ENV]: '/srv/pins' })).toBe('/srv/pins');
    expect(storeDir({ XDG_CACHE_HOME: '/c' })).toBe('/c/objectstack-pin');
    expect(storeDir({})).toBe(path.join(os.homedir(), '.cache', 'objectstack-pin'));
    const other = path.join(scratch, 'other-script.mjs');
    fs.writeFileSync(other, 'another script');
    expect(storeKey(SHA)).toMatch(new RegExp(`^${SHA}-[0-9a-f]{16}$`));
    expect(storeKey(SHA, other), 'another script never reuses the entry').not.toBe(storeKey(SHA));
  });

  it('publishes once, and a fresh checkout COPIES the entry -- a write into the checkout never reaches it', () => {
    const { root, cache, store, entry, env } = machine('reuse');
    expect([publishToStore(cache, entry), publishToStore(cache, entry)]).toEqual(['published', 'present']);
    expect(fs.readdirSync(store), 'nothing temporary is left').toEqual([path.basename(entry)]);
    expect(build({ root, env })).toMatchObject({ skipped: false, reused: true, stamp: { source: 'pin', sha: SHA } });
    const linked = path.join(root, PIN_DIR, 'spec/dist/index.mjs');
    expect(fs.statSync(linked).ino, 'beside the manifest').toBe(fs.statSync(path.join(root, CACHE_DIR, 'spec/dist/index.mjs')).ino);
    expect(fs.statSync(linked).ino, 'a copy, not a link').not.toBe(fs.statSync(path.join(entry, 'spec/dist/index.mjs')).ino);
    expect(() => check({ root })).not.toThrow();
    fs.appendFileSync(linked, 'export const marker = 1;\n');
    expect(fs.readFileSync(path.join(entry, 'spec/dist/index.mjs'), 'utf8')).toBe(BUILT);
  });

  it.each<[string, (entry: string) => void, RegExp]>([
    ['another pin', (e) => writeJson(path.join(e, STAMP_FILE), { recipe: RECIPE, source: 'pin', sha: 'f'.repeat(40), packages: { '@objectstack/spec': '1.0.0' } }), /not the pin: the cache holds f{12}, /],
    ['a package gone', (e) => fs.rmSync(path.join(e, 'spec'), { recursive: true }), /not the pin: .*does not hold @objectstack\/spec/],
    ['a file gone', (e) => fs.rmSync(path.join(e, 'spec/dist/index.mjs')), /not the ones it was published with/],
    ['a byte changed', (e) => fs.appendFileSync(path.join(e, 'spec/dist/index.mjs'), ' '), /not the ones it was published with/],
    ['no record', (e) => fs.rmSync(path.join(e, ENTRY_FILE)), /could not be read/],
  ])('never takes an entry with %s: the reason is said, staging is emptied, the pin is built', (label, spoil, reason) => {
    const { root, cache, entry, env } = machine(label);
    publishToStore(cache, entry);
    spoil(entry);
    const staging = fs.mkdtempSync(path.join(scratch, 'staging-'));
    expect(takeFromStore(entry, staging, { pin: SHA, overrides: new Map([['@objectstack/spec', 'spec']]) })).toMatch(reason);
    expect(fs.readdirSync(staging)).toEqual([]);
    expect(() => build({ root, env })).toThrow(/git fetch .*exited/);
    expect(fs.existsSync(path.join(root, CACHE_DIR))).toBe(false);
  });

  it('drops its own copy when a concurrent run renamed its entry into place first', () => {
    const { cache, store, entry } = machine('race');
    publishToStore(cache, entry);
    fs.writeFileSync(path.join(cache, 'spec/dist/index.mjs'), 'export const second = true;\n');
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false); // both runs looked before either renamed
    try {
      expect(publishToStore(cache, entry)).toBe('present');
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(path.join(entry, 'spec/dist/index.mjs'), 'utf8')).toBe(BUILT);
    expect(fs.readdirSync(store)).toEqual([path.basename(entry)]);
  });

  it('keeps the current entry and the most recently used others, and clears what a dead run left', () => {
    const store = fs.mkdtempSync(path.join(scratch, 'prune-'));
    for (const [name, age] of [['current', 9e4], ['newest', 1], ['newer', 2], ['old', 3], ['.tmp-live', 1], ['.tmp-dead', 7200]] as const) {
      fs.mkdirSync(path.join(store, name));
      fs.utimesSync(path.join(store, name), Date.now() / 1000 - age, Date.now() / 1000 - age);
    }
    pruneStore(store, 3, 'current');
    expect(fs.readdirSync(store).sort()).toEqual(['.tmp-live', 'current', 'newer', 'newest']);
  });
});
