// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack build` ships every authored `functions` name under its own name,
 * bound to its own code, and every hook's and action's ref resolves to its own
 * code, whatever name or function two slots share.
 *
 * ## The defect, measured before the fix (on 2e11d9006c)
 *
 * The runtime resolves a hook's `handler`, an action's `target` and a
 * `functions` key against ONE merged namespace, `bundle.functions`, filled from
 * the runtime module's `functions` export. Two sides named the entries of that
 * namespace, and they disagreed:
 *
 *   - `lowerCallables` minted refs in walk order (hooks, actions, then
 *     `functions`), deduplicated by function identity, and re-keyed each
 *     `functions` entry by the ref it got;
 *   - the runtime-module template re-derived names from the config: it keyed
 *     hooks by `name` and `functions` entries by their authored key, and never
 *     reached an action's `target` at all.
 *
 * Through `objectstack build` and then `loadArtifactBundle`:
 *
 *   - a `functions` key sharing its function with a hook or an action was gone
 *     (`functions: { kc_fn: shared }` shipped as `{ kc_hook: 'kc_hook' }`), and
 *     two keys sharing one function shipped as one;
 *   - a `functions` key equal to a hook's name (or an action's
 *     `<owner>_<action>` ref) shipped as `kc_same__2`, a bare string, while the
 *     hook's ref `kc_same` resolved to the `functions` entry's code;
 *   - an action's ref never resolved, collision or not (the CONTROL below).
 *
 * ## The pin
 *
 * The kinds are DERIVED from `lowerCallables`' own registration sites: the
 * census reads every `register…(` call and every `lowerActionCallable(` call
 * site off `src/utils/lower-callables.ts`, and each kind it finds must carry a
 * fixture here. A site added there without a row here fails the census by
 * name; a row whose site is gone fails it too.
 *
 * Each kind's fixture carries both collisions against an authored `functions`
 * entry (a shared function; an equal name) under disjoint names, round-trips
 * through `objectstack build` (`bin/run-dev.js`, source via tsx) and then the
 * runtime's own `loadArtifactBundle`, and asserts that each authored name ships
 * under itself and answers its own code, and that each hook or action ref
 * answers its own code. Every callable names a module-scope constant, so no
 * hook or action is lowered to a `body`: the ref is the path that runs.
 *
 * CONTROL: a stack with no collision ships the refs it shipped before the fix,
 * byte for byte (measured on 2e11d9006c), and every one of them now resolves.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadArtifactBundle } from '@objectstack/runtime';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';
import { locateCallables } from '../src/utils/build-runtime.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const LOWER_CALLABLES = resolve(HERE, '../src/utils/lower-callables.ts');
/** A cold `tsx` spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;

// ── The census ──────────────────────────────────────────────────────────────

/**
 * Every registration site in `lowerCallables`, read off its source in code
 * position: each call whose callee is named `register…`, by its slot argument,
 * and each `lowerActionCallable(` call, by its owner argument.
 */
function registrationSites(): string[] {
  const text = readFileSync(LOWER_CALLABLES, 'utf8');
  const sf = ts.createSourceFile(LOWER_CALLABLES, text, ts.ScriptTarget.Latest, true);
  const argText = (e: ts.Expression): string => (ts.isAsExpression(e) ? e.expression : e).getText(sf);
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      const args = node.arguments;
      if (/^register/.test(callee) && args.length > 0) sites.push(`${callee}(${argText(args[0])})`);
      else if (callee === 'lowerActionCallable' && args.length > 0) {
        sites.push(`lowerActionCallable(owner: ${argText(args[args.length - 1])})`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

type Kind =
  | 'hook'
  | 'object-action'
  | 'global-action'
  | 'functions-map'
  | 'functions-map-declared'
  | 'functions-array-named'
  | 'functions-array-nameless';

/**
 * Each registration site → the kind it registers. `register(fn)` is the action
 * slot inside `lowerActionCallable`; its kinds are that function's call sites.
 */
const SITE_KIND: Readonly<Record<string, Kind | 'action-slot'>> = {
  'register(hook.handler)': 'hook',
  'register(fn)': 'action-slot',
  "lowerActionCallable(owner: `${String(obj.name ?? 'object')}`)": 'object-action',
  "lowerActionCallable(owner: 'global')": 'global-action',
  'registerAuthored(value)': 'functions-map',
  'registerAuthored(value.handler)': 'functions-map-declared',
  'registerAuthored(next.handler)': 'functions-array-named',
  'register(next.handler)': 'functions-array-nameless',
};

const SITES = registrationSites();
const KINDS = [...new Set(SITES.map((site) => SITE_KIND[site]))].filter(
  (kind): kind is Kind => kind !== undefined && kind !== 'action-slot',
);

// ── The fixtures ────────────────────────────────────────────────────────────

/** `MARK` keeps every callable off the extractor: each one runs from the module. */
const HEAD = `import { defineStack } from '@objectstack/spec';

const MARK = 'kc';
const sharedFn = async () => 'shared:' + MARK;
const hookFn = async () => 'hook:' + MARK;
const actionFn = async () => 'action:' + MARK;
const entryFn = async () => 'function:' + MARK;
const otherFn = async () => 'other:' + MARK;

const manifest = { id: 'com.example.kc', name: 'kc', version: '1.0.0', type: 'app', namespace: 'kc' };
const doc = (actions) => ({
  name: 'kc_doc', label: 'Doc', sharingModel: 'private',
  fields: { title: { type: 'text', label: 'Title' } },
  ...(actions ? { actions } : {}),
});
const hook = (name, handler) => ({ name, object: 'kc_doc', events: ['beforeInsert'], handler });
const action = (name, target) => ({ name, label: name, type: 'script', locations: [], target });
`;

type Artifact = Record<string, any>;

interface Fixture {
  /** The `defineStack` argument, over the helpers in {@link HEAD}. */
  stack: string;
  /** The authored-or-minted names the artifact's `functions` declares, in order. */
  declared: string[];
  /** Each authored `functions` name → what its own code answers. */
  authored: Record<string, string>;
  /** Each hook / action / nameless-entry slot → where its ref sits, and what its own code answers. */
  slots: Record<string, [(artifact: Artifact) => unknown, string]>;
  /** Why this kind has no equal-name fixture, when it cannot have one. */
  noEqualName?: string;
}

const FIXTURES: Readonly<Record<Kind, Fixture>> = {
  hook: {
    stack: `{
  manifest, objects: [doc()],
  hooks: [hook('kc_shared_hook', sharedFn), hook('kc_same', hookFn)],
  functions: { kc_shared_fn: sharedFn, kc_same: entryFn },
}`,
    declared: ['kc_shared_fn', 'kc_same'],
    authored: { kc_shared_fn: 'shared:kc', kc_same: 'function:kc' },
    slots: {
      'shared function: hook kc_shared_hook': [(a) => a.hooks[0].handler, 'shared:kc'],
      'equal name: hook kc_same': [(a) => a.hooks[1].handler, 'hook:kc'],
    },
  },
  'object-action': {
    stack: `{
  manifest, objects: [doc([action('share', sharedFn), action('same', actionFn)])],
  functions: { kc_shared_fn: sharedFn, kc_doc_same: entryFn },
}`,
    declared: ['kc_shared_fn', 'kc_doc_same'],
    authored: { kc_shared_fn: 'shared:kc', kc_doc_same: 'function:kc' },
    slots: {
      'shared function: action kc_doc.share': [(a) => a.objects[0].actions[0].target, 'shared:kc'],
      'equal name: action kc_doc.same': [(a) => a.objects[0].actions[1].target, 'action:kc'],
    },
  },
  'global-action': {
    stack: `{
  manifest, objects: [doc()],
  actions: [action('share', sharedFn), action('same', actionFn)],
  functions: { kc_shared_fn: sharedFn, global_same: entryFn },
}`,
    declared: ['kc_shared_fn', 'global_same'],
    authored: { kc_shared_fn: 'shared:kc', global_same: 'function:kc' },
    slots: {
      'shared function: action share': [(a) => a.actions[0].target, 'shared:kc'],
      'equal name: action same': [(a) => a.actions[1].target, 'action:kc'],
    },
  },
  'functions-map': {
    stack: `{ manifest, objects: [doc()], functions: { kc_a: sharedFn, kc_b: sharedFn } }`,
    declared: ['kc_a', 'kc_b'],
    authored: { kc_a: 'shared:kc', kc_b: 'shared:kc' },
    slots: {},
    noEqualName: "a map's keys are unique; a key equal to a hook's or an action's ref is those kinds' fixture",
  },
  'functions-map-declared': {
    stack: `{ manifest, objects: [doc()], functions: { kc_a: sharedFn, kc_b: { handler: sharedFn, effect: 'writes' } } }`,
    declared: ['kc_a', 'kc_b'],
    authored: { kc_a: 'shared:kc', kc_b: 'shared:kc' },
    slots: {},
    noEqualName: "a map's keys are unique; a key equal to a hook's or an action's ref is those kinds' fixture",
  },
  'functions-array-named': {
    stack: `{ manifest, objects: [doc()], functions: [{ name: 'kc_a', handler: sharedFn }, { name: 'kc_b', handler: sharedFn }] }`,
    declared: ['kc_a', 'kc_b'],
    authored: { kc_a: 'shared:kc', kc_b: 'shared:kc' },
    slots: {},
    noEqualName:
      'two entries authoring one `name` is one name for two codes in a flat namespace, not a collision between kinds; ' +
      'the array form accepting it is reported apart from this pin',
  },
  'functions-array-nameless': {
    stack: `{
  manifest, objects: [doc()],
  functions: [{ handler: sharedFn }, { name: 'kc_fn', handler: sharedFn }, { handler: otherFn }, { name: 'anon_fn', handler: entryFn }],
}`,
    declared: ['kc_fn', 'kc_fn', 'anon_fn__2', 'anon_fn'],
    authored: { kc_fn: 'shared:kc', anon_fn: 'function:kc' },
    slots: {
      'shared function: nameless entry 0': [(a) => a.functions[0].handler, 'shared:kc'],
      'equal name: nameless entry 2': [(a) => a.functions[2].handler, 'other:kc'],
    },
  },
};

/** No collision anywhere: one callable per kind, each under its own name. */
const CONTROL = `{
  manifest, objects: [doc([action('go', actionFn)])],
  actions: [action('go', otherFn)],
  hooks: [hook('kc_hook', hookFn)],
  functions: { kc_fn: entryFn, kc_w: { handler: sharedFn, effect: 'writes' } },
}`;

// ── The door ────────────────────────────────────────────────────────────────

interface Run {
  code: number;
  out: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolvePromise({ code, out: `${String(stdout)}${String(stderr)}` });
      },
    );
  });
}

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-callable-names-'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Build `stack` in a fresh project dir, then load the artifact through the runtime's own loader. */
async function buildAndLoad(label: string, stack: string): Promise<{ artifact: Artifact; loaded: Artifact }> {
  const dir = join(root, label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'objectstack.config.ts'), `${HEAD}\nexport default defineStack(${stack.trim()}, { strict: false });\n`);
  linkSpec(dir);
  const run = await runCli(['build'], dir);
  expect(run.code, run.out).toBe(0);
  const artifactPath = join(dir, 'dist', 'objectstack.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Artifact;
  expect(artifact.runtimeModule, run.out).toMatch(/^\.\/objectstack-runtime\.[a-f0-9]+\.mjs$/);
  const loaded = (await loadArtifactBundle(artifactPath)) as Artifact;
  return { artifact, loaded };
}

/** The declared names of a `functions` map or array. */
function declaredNames(functions: unknown): string[] {
  if (Array.isArray(functions)) return functions.map((entry) => (entry as { name: string }).name);
  return Object.keys((functions ?? {}) as Record<string, unknown>);
}

/** What the loaded artifact's `functions` entry `ref` answers when called, or why it cannot be called. */
async function answer(loaded: Artifact, ref: unknown): Promise<unknown> {
  if (typeof ref !== 'string') return `not a ref: ${JSON.stringify(ref)}`;
  const fns = loaded.functions;
  const entry = Array.isArray(fns) ? fns.find((e: { name?: unknown }) => e?.name === ref) : fns?.[ref];
  const fn = typeof entry === 'function' ? entry : entry?.handler;
  return typeof fn === 'function' ? await fn({}) : `unresolved: ${JSON.stringify(entry)}`;
}

// ── The pins ────────────────────────────────────────────────────────────────

describe('the callable kinds are lowerCallables\' own registration sites', () => {
  it('every registration site is classified, and every classified site still exists', () => {
    expect(SITES.length, 'the census read no registration site at all').toBeGreaterThan(0);
    const unclassified = SITES.filter((site) => SITE_KIND[site] === undefined);
    expect(unclassified, 'a registration site with no kind: give it a SITE_KIND row and a fixture').toEqual([]);
    const gone = Object.keys(SITE_KIND).filter((site) => !SITES.includes(site));
    expect(gone, 'a SITE_KIND row whose site is gone from lower-callables.ts').toEqual([]);
  });

  it('every kind the census derives carries a fixture, and every fixture is a derived kind', () => {
    expect([...KINDS].sort()).toEqual(Object.keys(FIXTURES).sort());
  });
});

describe('objectstack build: each authored `functions` name ships under itself and answers its own code', () => {
  it.each(KINDS)('%s: a shared function and an equal name, through build and loadArtifactBundle', async (kind) => {
    const fixture = FIXTURES[kind];
    const { artifact, loaded } = await buildAndLoad(kind, fixture.stack);

    // Authored names ship under themselves: no suffix, nothing re-keyed or lost.
    expect(declaredNames(artifact.functions)).toEqual(fixture.declared);
    for (const [name, expected] of Object.entries(fixture.authored)) {
      expect(await answer(loaded, name), `authored \`functions\` name '${name}'`).toBe(expected);
    }
    // Every other slot's ref answers its own code, never an authored entry's.
    for (const [label, [refAt, expected]] of Object.entries(fixture.slots)) {
      expect(await answer(loaded, refAt(artifact)), label).toBe(expected);
    }
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: no collision ships the refs it shipped before, and every one resolves to its own code', async () => {
    const { artifact, loaded } = await buildAndLoad('control', CONTROL);
    // Byte for byte what 2e11d9006c shipped for this stack.
    expect(artifact.functions).toEqual({ kc_fn: 'kc_fn', kc_w: { handler: 'kc_w', effect: 'writes' } });
    expect(artifact.hooks.map((h: Artifact) => h.handler)).toEqual(['kc_hook']);
    expect(artifact.objects[0].actions.map((a: Artifact) => a.target)).toEqual(['kc_doc_go']);
    expect(artifact.actions.map((a: Artifact) => a.target)).toEqual(['global_go']);

    expect(await answer(loaded, 'kc_fn')).toBe('function:kc');
    expect(await answer(loaded, 'kc_w')).toBe('shared:kc');
    expect(await answer(loaded, 'kc_hook')).toBe('hook:kc');
    // Neither resolved before the fix: the module never carried an action's callable.
    expect(await answer(loaded, 'kc_doc_go')).toBe('action:kc');
    expect(await answer(loaded, 'global_go')).toBe('other:kc');
  }, SPAWN_TIMEOUT_MS);
});

describe('locateCallables: the module finds each ref\'s callable by identity', () => {
  it('answers the shortest path to each callable, and gives refs sharing a callable the same path', () => {
    const shared = (): number => 1;
    const own = (): number => 2;
    const config = {
      hooks: [{ name: 'h', handler: shared }],
      packages: [{ manifest: { hooks: [{ name: 'h', handler: shared }] } }],
      functions: { a: shared, b: { handler: own } },
    };
    expect(locateCallables({ h: shared, a: shared, b: own }, config)).toEqual({
      h: ['hooks', 0, 'handler'],
      a: ['hooks', 0, 'handler'],
      b: ['functions', 'b', 'handler'],
    });
  });

  it('throws, naming the refs, when a callable is not in the config: no module silently leaves one out', () => {
    const stray = (): number => 3;
    expect(() => locateCallables({ kc_stray: stray }, { functions: {} })).toThrow(/'kc_stray'/);
  });
});
