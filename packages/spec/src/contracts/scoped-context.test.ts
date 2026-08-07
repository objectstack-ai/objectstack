// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IScopedContext, IScopedObjectRepository } from './scoped-context';

// ─── [#5945] `HookContext.api` is typed — proved with the compiler ──────────
//
// Ruling C (maintainer, 2026-08-07): `api` stops being `z.unknown()` and gains
// the minimum `IScopedContext` the corpus actually teaches. The fact under test
// is therefore a COMPILE fact, and it has two halves that fail in opposite
// directions:
//
//   1. the documented calls COMPILE (they reported `TS18046: 'ctx.api' is of
//      type 'unknown'` before), and
//   2. a member the contract does NOT declare is a NAMED type error, so the
//      evidence bar is enforced rather than merely written down.
//
// ## REVERSE VERIFICATION — predicted first, then MEASURED, and the prediction
// ## was half wrong in a way that changed these assertions
//
// Predicted: restore `api: z.unknown()` and every `legal-*` probe goes red with
// `TS18046: 'ctx.api' is of type 'unknown'`, while the `rejects-*` probes stay
// green for the wrong reason (a different code satisfying a bare "did it
// error?"). Ran it. What actually happens, on `api: z.unknown().optional()`:
//
//     no-chain        ctx.api.object('x')   TS18046: 'ctx.api' is of type 'unknown'.
//     chain-legal     ctx.api?.object('x')  TS2339: Property 'object' does not exist on type '{}'.
//     rejects-upsert  ctx.api?.object(…)    TS2339: Property 'object' does not exist on type '{}'.
//     rejects-sudo    ctx.api?.sudo()       TS2339: Property 'sudo' does not exist on type '{}'.
//
// TS18046 is the issue's reported symptom and it reproduces EXACTLY — but only
// without optional chaining. `?.` strips `null | undefined` from `unknown` and
// leaves `{}`, so the chained form (which is how the corpus writes it, `api`
// being optional) fails as TS2339 instead. Which means asserting the CODE is
// NOT enough: `rejects-*` kept reporting TS2339 across the revert, and an
// assertion of `toContain('TS2339')` passed over the reverted contract — a
// phantom check, caught only by running the reversal instead of reasoning
// about it. So the negative probes assert the diagnostic names the OWNER TYPE
// (`IScopedContext` / `IScopedObjectRepository`); `'{}'` can no longer satisfy
// them. Direction, corrected and measured:
//   - `legal-*` → RED (TS2339 on `{}`, TS18046 where unchained);
//   - `rejects-*` → RED, because the type named in the message is gone.
// Deleting a single member from `IScopedObjectRepository` is the narrower
// probe: only the `legal-*` line calling it goes red, with TS2339.
//
// ## Why the compiler API rather than `@ts-expect-error`
//
// `@ts-expect-error` is satisfied by ANY error on the next line, so it cannot
// tell "this member is undeclared" from "this literal is malformed" — and this
// file's whole subject is which diagnostic a call gets. #5286 did put
// `src/**/*.test.ts` in front of `tsc` (via `tsconfig.test.json`), so a
// directive here would at least be read — but it would be read imprecisely.
// The probes below drive `ts.createProgram` and assert on codes, the way
// `automation/etl-author-shape.test.ts` does, with the same anti-vacuity
// control: a harness that resolves nothing reports zero diagnostics and looks
// exactly like success.

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK_ZOD = resolve(SPEC_DIR, 'src/data/hook.zod.ts');

/**
 * Compile a set of probe files against this package's real source and return
 * each one's diagnostics, keyed by probe name.
 *
 * `@objectstack/spec/<entry>` is mapped through `paths` to the entry barrel in
 * `src/`, so a probe can be written the way a hook author would actually type
 * it — import line included — instead of through relative paths no reader of
 * the docs would ever use.
 */
function compileProbes(probes: Readonly<Record<string, string>>): Map<string, ts.Diagnostic[]> {
  const dir = resolve(SPEC_DIR, 'src/__scoped_context_probes__');
  const paths = new Map<string, string>();
  for (const [name, text] of Object.entries(probes)) paths.set(resolve(dir, `${name}.ts`), text);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    // A snippet declares a `const` and stops; TS6133 is an opinion about the
    // snippet's framing, not about whether the call is well-typed.
    noUnusedLocals: false,
    noUnusedParameters: false,
    baseUrl: SPEC_DIR,
    paths: { '@objectstack/spec/*': [resolve(SPEC_DIR, 'src/*/index.ts')] },
  };

  const host = ts.createCompilerHost(options, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const overlay = paths.get(resolve(fileName));
    return overlay === undefined
      ? realGetSourceFile(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, overlay, languageVersion, true);
  };
  host.fileExists = (fileName) => paths.has(resolve(fileName)) || realFileExists(fileName);
  host.readFile = (fileName) => paths.get(resolve(fileName)) ?? realReadFile(fileName);

  const program = ts.createProgram([...paths.keys()], options, host);
  const out = new Map<string, ts.Diagnostic[]>();
  for (const name of Object.keys(probes)) out.set(name, []);
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const file = d.file?.fileName ? resolve(d.file.fileName) : undefined;
    for (const name of Object.keys(probes)) {
      if (file === resolve(dir, `${name}.ts`)) out.get(name)!.push(d);
    }
  }
  return out;
}

/** One diagnostic per line, `TS<code>: <message>`, for readable assertions. */
function render(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    .join('\n');
}

/** A hook handler wrapper, so a probe body reads like the documented code. */
function hook(body: string): string {
  return [
    "import type { HookContext } from '@objectstack/spec/data';",
    'export const handler = async (ctx: HookContext) => {',
    body,
    '};',
  ].join('\n');
}

/**
 * The `Usage in hooks` example out of `hook.zod.ts`'s own JSDoc, read from the
 * source rather than copied — the issue's headline complaint was that THAT
 * example did not compile, so the pin has to be the real text. Extraction:
 * everything after the first blank comment line following `Usage in hooks`,
 * while the lines stay indented three spaces past the ` * `.
 */
function jsdocUsageExample(): string {
  const lines = readFileSync(HOOK_ZOD, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes('Usage in hooks'));
  if (start < 0) throw new Error('`Usage in hooks` marker vanished from hook.zod.ts');
  let i = start;
  while (i < lines.length && !/^\s*\*\s*$/.test(lines[i])) i += 1;
  i += 1;
  const body: string[] = [];
  for (; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*\*\s{3}(.*)$/);
    if (!m) break;
    body.push(m[1]);
  }
  return body.join('\n');
}

describe('[#5945] the `HookContext.api` JSDoc example compiles', () => {
  const example = jsdocUsageExample();

  it('extracts a real example from hook.zod.ts (anti-vacuity)', () => {
    // Without this, a marker rename would yield an empty probe — and an empty
    // file compiles clean, so the pin below would report success over nothing.
    expect(example).toContain('ctx.api');
    expect(example).toContain('findOne');
    expect(example.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('compiles verbatim, with zero diagnostics', () => {
    const results = compileProbes({
      'jsdoc-usage': hook(example),
      // The harness's own control: a probe that MUST fail. A resolution failure
      // reports zero diagnostics for every probe and reads as green.
      'harness-self-test': hook("const x: number = ctx.api?.object('user');"),
    });
    expect(render(results.get('harness-self-test')!), 'the harness must be able to report an error')
      .toContain('TS2322');
    expect(render(results.get('jsdoc-usage')!), 'the JSDoc example must compile').toBe('');
  });
});

describe('[#5945] every corpus-measured call compiles', () => {
  /**
   * One probe per declared member, each written the way the corpus writes it,
   * so a failure names the member rather than "the big probe went red". The
   * evidence for each is recorded in `scoped-context.ts`'s module header.
   */
  const legal: Record<string, string> = {
    'legal-findOne': "const rec = await ctx.api?.object('candidate').findOne({ where: { id: ctx.input.id } });",
    'legal-find': "const rows = await ctx.api?.object('candidate').find({ where: { stage: 'hired' } });",
    'legal-count': "const n = await ctx.api?.object('invoice').count({ where: { amount: { $gte: 1000 } } });",
    'legal-insert': "await ctx.api?.object('audit_log').insert({ action: 'created' });",
    'legal-update-single': "await ctx.api?.object('position').update({ id: 'p1', status: 'filled' });",
    'legal-update-bulk': "await ctx.api?.object('contact').update({ industry: 'tech' }, { where: { account_id: 'a1' }, multi: true });",
    'legal-updateById': "await ctx.api?.object('task').updateById('t1', { ai_suggested_tags: ['x'] });",
    // `filter` is a documented, engine-folded alias of `where`
    // (`RPC_QUERY_ALIAS_SLOTS`), and `data-hooks.md` has a live snippet using
    // it. Typing the query bag as `EngineQueryOptions` would reject this by
    // excess-property checking — a compile error over a call that works. This
    // probe is why the parameter is an open object; see the module header.
    'legal-filter-alias': "const n = await ctx.api?.object('opportunity').count({ filter: { account_id: ctx.input.id } });",
    // The transaction shape `error-handling-server.mdx` teaches: reach objects
    // through the callback's context, not the outer one.
    'legal-transaction': [
      'await ctx.api?.transaction(async (tx) => {',
      "  await tx.object('task').insert({ title: 'kickoff' });",
      "  await tx.object('project').update({ id: 'p1', task_count: 1 });",
      '});',
    ].join('\n'),
    // Contravariance: the corpus writes zero- and one-argument callbacks, and
    // the two-argument form the engine actually calls must work too.
    'legal-transaction-no-args': 'await ctx.api?.transaction(async () => undefined);',
    'legal-transaction-info': 'await ctx.api?.transaction(async (_tx, info) => info.owned);',
  };

  it('compiles all of them clean', () => {
    const probes: Record<string, string> = {};
    for (const [name, body] of Object.entries(legal)) probes[name] = hook(body);
    probes['harness-self-test'] = hook("const x: number = ctx.api?.object('user');");

    const results = compileProbes(probes);
    expect(render(results.get('harness-self-test')!), 'the harness must be able to report an error')
      .toContain('TS2322');

    for (const [name, diagnostics] of results) {
      if (name === 'harness-self-test') continue;
      expect(render(diagnostics), `${name} must compile clean`).toBe('');
    }
    // Anti-vacuity: the probe set is the declared surface, not a subset that
    // drifted. Six repo members + `object` reached three ways + transaction's
    // three callback arities.
    expect(Object.keys(legal).length).toBe(11);
  });
});

describe('[#5945] the evidence bar is enforced, not just documented', () => {
  /**
   * An undeclared member is TS2339 — a NAMED refusal, which is the point:
   * before this contract every one of these was TS18046 ("`ctx.api` is of type
   * 'unknown'"), i.e. the same undifferentiated wall for legal and illegal
   * calls alike.
   *
   * The repo members below are REAL on ObjectQL's `ObjectRepository` and
   * deliberately off the contract — they appear in the corpus only in method /
   * capability TABLES, and a table never goes through a compiler. Each joins
   * the contract the day a call site does. This test is therefore also the
   * ledger of that decision: adding one without adding its evidence turns this
   * red.
   */
  /** probe name → [call, the type the message must name]. */
  const rejected: Record<string, readonly [string, string]> = {
    'rejects-invented-member': ['await (ctx.api as IScopedContext).deleteEverything();', 'IScopedContext'],
    'rejects-upsert': ["await ctx.api?.object('candidate').upsert({ id: 'c1' });", 'IScopedObjectRepository'],
    'rejects-delete': ["await ctx.api?.object('candidate').delete({ where: { id: 'c1' } });", 'IScopedObjectRepository'],
    'rejects-aggregate': ["await ctx.api?.object('invoice').aggregate({ groupBy: ['status'] });", 'IScopedObjectRepository'],
    'rejects-sudo': ['ctx.api?.sudo();', 'IScopedContext'],
    'rejects-top-level-insert': ["await ctx.api?.insert('task', { title: 't' });", 'IScopedContext'],
  };

  it('reports TS2339 naming the contract type — not merely "some error"', () => {
    const probes: Record<string, string> = {};
    for (const [name, [body]] of Object.entries(rejected)) {
      probes[name] = name === 'rejects-invented-member'
        ? [
          "import type { HookContext } from '@objectstack/spec/data';",
          "import type { IScopedContext } from '@objectstack/spec/contracts';",
          'export const handler = async (ctx: HookContext) => {',
          body,
          '};',
        ].join('\n')
        : hook(body);
    }
    const results = compileProbes(probes);

    for (const [name, diagnostics] of results) {
      const text = render(diagnostics);
      const owner = rejected[name][1];
      expect(text, `${name} must fail as an undeclared property`).toContain('TS2339');
      // The OWNER TYPE, not just the code. Measured on the reversal (see the
      // header): with `api: z.unknown()` these same probes still report TS2339
      // — `Property 'x' does not exist on type '{}'` — so a code-only
      // assertion passed over the reverted contract. Naming the type is what
      // makes the refusal a statement about THIS contract.
      expect(text, `${name} must name the contract type it was refused by`).toContain(`type '${owner}'`);
    }
    expect(Object.keys(rejected).length).toBe(6);
  });
});

describe('[#5945] IScopedContext is implementable', () => {
  it('accepts a minimal implementation', async () => {
    const rows = [{ id: 'c1', stage: 'hired', position_id: 'p1' }];

    const repo: IScopedObjectRepository = {
      find: async () => rows,
      findOne: async () => rows[0] ?? null,
      count: async () => rows.length,
      insert: async (data) => data,
      update: async (data) => data,
      updateById: async (id, data) => ({ id, ...data }),
    };

    const api: IScopedContext = {
      object: () => repo,
      // The engine always passes `info`; an implementation is free to ignore
      // `opts` when its driver has no transaction support (the documented
      // degrade), which is why the parameter is optional.
      transaction: async (callback) => callback(api, { owned: true }),
    };

    expect(await api.object('candidate').findOne({ where: { id: 'c1' } })).toEqual(rows[0]);
    expect(await api.object('candidate').count()).toBe(1);
    expect(
      await api.transaction(async (tx) => tx.object('position').updateById('p1', { status: 'filled' })),
    ).toEqual({ id: 'p1', status: 'filled' });
  });

  it('is what ObjectQL declares it implements — checked at objectql build, not here', () => {
    // `packages/objectql`'s `ScopedContext` / `ObjectRepository` carry
    // `implements IScopedContext` / `implements IScopedObjectRepository`, so
    // drift between this contract and the object the engine actually binds is a
    // compile error over THERE. Spec must not depend on the engine, so this
    // file cannot assert it — recorded here so the next reader knows where the
    // other half of the guard lives rather than adding a second, weaker copy.
    expect(true).toBe(true);
  });
});
