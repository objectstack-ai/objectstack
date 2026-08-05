// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Boot-path contract: importing @objectstack/lint must NOT load its heavy,
// gate-only dependencies. The package sits on the kernel boot path, while each
// dep below serves gates that only run when a particular, uncommon piece of
// metadata is actually validated — so each must load lazily, on first use:
//   - `typescript` (~9 MB, and has been pruned from production images before
//     — see validate-react-page-props.ts), loaded by the react-props gate AND
//     by the L2 body write-set gates (validate-hook-body-writes.ts since
//     #4271, validate-action-body-writes.ts since #4345);
//   - `sucrase` (~1.5 MB), loaded by the react syntax gate
//     (validate-react-pages.ts);
//   - `ajv` (~2.4 MB installed), loaded by the #4762 publish gate
//     (validate-rule-compilability.ts) only when a stack declares a
//     `json_schema` validation rule — the one rule type whose static artifact
//     needs a JSON-Schema compiler to judge;
//   - `ajv-formats`, loaded by the same gate for the same trigger (#5029). Small
//     on its own, but it `require`s `ajv/dist/compile/codegen`, so an eager
//     import of it would drag ajv onto the boot path through the back door —
//     i.e. it must be listed here even though its own weight would not justify
//     it.
//
// #5178 added a second consumer of both — `validate-rule-schema-formats.ts`,
// which asks that same ajv environment which `format` names it registered. It
// is LAZIER than the compile gate on purpose: the registered set is only needed
// once a schema actually names a `format`, so a `json_schema` rule that names
// none pays nothing, which is the case pinned below.
//
// "A react page" was the whole story when this file was written; it is not any
// more, and the cases below say which trigger they are pinning. Keep them
// named that way — a test called "until a react page is validated" that also
// covers hook and action bodies is a test nobody can read against its subject.
//
// Guarded at three levels because vitest inlines static imports through its
// transform (they never hit the native require cache), so an in-worker
// require.cache probe alone CANNOT catch a reintroduced eager import:
//   1. structural — no src file may eagerly `import ... from` a lazy dep
//      (only `import type`, which erases at build);
//   2. built dist — child `node` processes import both dist formats and prove
//      each dep is absent until the metadata that needs it is validated (skipped when dist
//      has not been built);
//   3. behavioral — each lazy path really loads its dep on demand and the
//      gate still produces findings.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(srcDir, '..', 'dist');

// Deps that must never load at import time. Extend this list when another
// heavy, rarely-hit dependency joins the package.
const LAZY_DEPS = ['typescript', 'sucrase', 'ajv', 'ajv-formats'];

const depLoaded = (cache: Record<string, unknown> | undefined, dep: string) =>
  Object.keys(cache ?? {}).some((p) => p.split(/[/\\]/).join('/').includes(`/node_modules/${dep}/`));

// Every case below cold-loads sucrase + typescript (~1.5 MB / ~9 MB) — in-process
// for the behavioral case, in a spawned child `node` for the dist probes. On a
// loaded runner (dozens of parallel turbo tasks) that alone takes >5s, so vitest's
// default 5s timeout flakes while the assertion set is pure contract, not latency.
const COLD_LOAD_TIMEOUT_MS = 30_000;

describe('lazy dependency loading (kernel boot-path contract)', () => {
  it('no src file eagerly imports a lazy dep (import type only)', () => {
    // Static `import`/`export ... from '<dep>'` executes at module init in
    // both dist formats; `import type` erases. Dynamic import()/createRequire
    // inside functions are the sanctioned lazy forms and are not matched.
    const eagerImport = (dep: string) =>
      new RegExp(
        String.raw`^\s*(?:import\s+['"]${dep}['"]|(?:import|export)\s+(?!type[\s{])[^;]*?from\s*['"]${dep}['"]|import\s+\w+\s*=\s*require\(\s*['"]${dep}['"]\s*\))`,
        'm',
      );
    const offenders = readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .flatMap((f) => {
        const body = readFileSync(join(srcDir, f), 'utf8');
        return LAZY_DEPS.filter((dep) => eagerImport(dep).test(body)).map((dep) => `${f} eagerly imports ${dep}`);
      });
    expect(offenders).toEqual([]);
  });

  // Reused by both dist probes: import the dist entry, prove no lazy dep came
  // with it, then run each gate and prove exactly its own dep loads — and that
  // the gate still produces its finding.
  const reactStack = (source: string) => `{ pages: [{ name: 'r', kind: 'react', source: ${JSON.stringify(source)} }] }`;
  const childBody = `
    const probe = require('node:module').createRequire(process.cwd() + '/probe.js');
    const loaded = (dep) => Object.keys(probe.cache ?? {}).some((p) => p.split(/[/\\\\]/).join('/').includes('/node_modules/' + dep + '/'));
    const fail = (msg) => { console.error(msg); process.exit(1); };
    const check = (mod) => {
      for (const dep of ${JSON.stringify(LAZY_DEPS)}) {
        if (loaded(dep)) fail(dep + ' was loaded eagerly, at import time');
      }
      const jsHook = (source, language) => ({ objects: [{ name: 'a', fields: { amount: {} } }], hooks: [{ name: 'h', object: 'a', events: ['beforeInsert'], body: { language: language ?? 'js', source } }] });
      const jsAction = (source, language) => ({ objects: [{ name: 'a', fields: { amount: {} } }], actions: [{ name: 'act', label: 'Act', objectName: 'a', body: { language: language ?? 'js', source } }] });
      mod.validateHookBodyWrites(jsHook('input.x > 0', 'expression'));
      if (loaded('typescript')) fail('the hook-body write gate on an L1-only stack must not load typescript');
      mod.validateActionBodyWrites(jsAction('input.x > 0', 'expression'));
      mod.validateActionBodyWrites(jsAction('ctx.input.amout = 1;'));
      if (loaded('typescript')) fail('the action-body write gate must not load typescript for a body that reaches neither ctx.api nor ctx.record');
      const syntax = mod.validateReactPages(${reactStack('function Page(){ return <div>oops; }')});
      if (!loaded('sucrase')) fail('sucrase was not loaded by a react-page syntax validation');
      if (loaded('typescript')) fail('the syntax gate must not load typescript');
      if (!syntax.some((f) => f.rule === 'react-page-syntax')) fail('syntax gate produced no finding');
      const hookWrites = mod.validateHookBodyWrites(jsHook('ctx.input.amout = 1;'));
      if (!loaded('typescript')) fail('typescript was not loaded by an L2 hook-body write validation');
      if (!hookWrites.some((f) => f.rule === 'hook-body-write-unknown-field')) fail('hook-body write gate produced no finding');
      const actionWrites = mod.validateActionBodyWrites(jsAction("await ctx.api.object('a').update({ amout: 1 });"));
      if (!actionWrites.some((f) => f.rule === 'action-body-write-unknown-field')) fail('action-body write gate produced no finding');
      const recordWrites = mod.validateActionBodyWrites(jsAction("ctx.record.amount = 1;"));
      if (!recordWrites.some((f) => f.rule === 'action-record-write-discarded')) fail('action-body record-write gate produced no finding');
      const props = mod.validateReactPageProps(${reactStack('function Page(){ return <ObjectForm mode="edit" />; }')});
      if (!loaded('typescript')) fail('typescript was not loaded by a react-page props validation');
      if (!props.some((f) => f.rule === 'react-prop-missing-required')) fail('props gate produced no finding');
      // #4762 — the JSON-Schema compiler is the third lazy dep, and #5029 added
      // its formats plugin as the fourth. A stack whose validation rules are all
      // format rules never pays for either.
      const ruleStack = (validation) => ({ objects: [{ name: 'a', fields: { payload: {} }, validations: [validation] }] });
      mod.validateRuleCompilability(ruleStack({ type: 'format', name: 'f', field: 'payload', regex: '([', message: 'm' }));
      if (loaded('ajv')) fail('the rule-compilability gate must not load ajv to judge a format rule');
      if (loaded('ajv-formats')) fail('the rule-compilability gate must not load ajv-formats to judge a format rule');
      // #5178 — and the format-NAME gate asks for the registered set only when
      // a schema actually names a format, so this one costs nothing either.
      mod.validateRuleSchemaFormats(
        ruleStack({ type: 'json_schema', name: 'j0', field: 'payload', schema: { type: 'object' }, message: 'm' }),
      );
      if (loaded('ajv')) fail('the format-name gate must not load ajv for a schema that names no format (#5178)');
      const schemaFindings = mod.validateRuleCompilability(
        ruleStack({ type: 'json_schema', name: 'j', field: 'payload', schema: { type: 'not-a-type' }, message: 'm' }),
      );
      if (!loaded('ajv')) fail('ajv was not loaded by a json_schema validation-rule check');
      if (!loaded('ajv-formats')) fail('ajv-formats was not loaded by a json_schema validation-rule check (#5029 parity)');
      if (!schemaFindings.some((f) => f.rule === 'validation-rule-json-schema-uncompilable')) {
        fail('rule-compilability gate produced no finding');
      }
      const formatNameFindings = mod.validateRuleSchemaFormats(
        ruleStack({
          type: 'json_schema',
          name: 'jf',
          field: 'payload',
          schema: { type: 'object', properties: { e: { type: 'string', format: 'emial' } } },
          message: 'm',
        }),
      );
      if (!formatNameFindings.some((f) => f.rule === 'validation-rule-json-schema-unknown-format')) {
        fail('format-name gate produced no finding (#5178)');
      }
      console.log('OK');
    };
  `;

  it.skipIf(!existsSync(join(distDir, 'index.cjs')))('built CJS dist loads no lazy dep at import time, and each only on its own trigger', () => {
    const out = execFileSync(
      process.execPath,
      ['-e', `${childBody}; check(require(${JSON.stringify(join(distDir, 'index.cjs'))}));`],
      { encoding: 'utf8' },
    );
    expect(out).toContain('OK');
  }, COLD_LOAD_TIMEOUT_MS);

  it.skipIf(!existsSync(join(distDir, 'index.js')))('built ESM dist loads no lazy dep at import time, and each only on its own trigger', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { createRequire } from 'node:module';
         const require = createRequire(process.cwd() + '/probe.js');
         ${childBody};
         check(await import(${JSON.stringify(pathToFileURL(join(distDir, 'index.js')).href)}));`,
      ],
      { encoding: 'utf8' },
    );
    expect(out).toContain('OK');
  }, COLD_LOAD_TIMEOUT_MS);

  it('loads each dep lazily in-process and the gates still work', async () => {
    const req = createRequire(import.meta.url);
    const {
      validateReactPages,
      validateReactPageProps,
      validateHookBodyWrites,
      validateActionBodyWrites,
      validateRuleCompilability,
      validateRuleSchemaFormats,
    } = await import('./index.js');

    // Stacks without a react-source page never touch either dep.
    expect(validateReactPages({ pages: [{ name: 'p', kind: 'object' }] })).toEqual([]);
    expect(validateReactPageProps({ pages: [{ name: 'p', kind: 'object' }] })).toEqual([]);
    expect(validateReactPageProps({ pages: [{ name: 'r', kind: 'react', source: '   ' }] })).toEqual([]);
    // Nor do stacks whose hooks carry no L2 JS body — including a JS body that
    // never mentions `ctx`/`Object` (the prefilter skips the parse entirely).
    const hook = (body: unknown) => ({ name: 'h', object: 'a', events: ['beforeInsert'], body });
    expect(validateHookBodyWrites({ hooks: [hook(undefined)] })).toEqual([]);
    expect(validateHookBodyWrites({ hooks: [hook({ language: 'expression', source: 'input.x > 0' })] })).toEqual([]);
    expect(validateHookBodyWrites({ hooks: [hook({ language: 'js', source: 'return 1;' })] })).toEqual([]);
    // Action bodies narrow it further: both patterns the action rule carries
    // are rooted at `ctx.api` or `ctx.record`, so an L2 body that only writes
    // params never parses at all.
    const action = (body: unknown) => ({ name: 'act', label: 'Act', objectName: 'a', body });
    expect(validateActionBodyWrites({ actions: [action(undefined)] })).toEqual([]);
    expect(validateActionBodyWrites({ actions: [action({ language: 'expression', source: 'input.x > 0' })] })).toEqual([]);
    expect(
      validateActionBodyWrites({
        objects: [{ name: 'a', fields: { amount: {} } }],
        actions: [action({ language: 'js', source: 'ctx.input.amout = 1; return { ok: true };' })],
      }),
    ).toEqual([]);
    // #4762 — nor does judging a `format` rule's regex: that needs only the
    // JavaScript engine's own `new RegExp`, so a stack with no `json_schema`
    // validation rule never loads a JSON-Schema compiler.
    const ruleStack = (validation: unknown) => ({
      objects: [{ name: 'a', fields: { payload: {} }, validations: [validation] }],
    });
    expect(
      validateRuleCompilability(
        ruleStack({ type: 'format', name: 'f', field: 'payload', regex: '([', message: 'm' }),
      ).map((f) => f.rule),
    ).toEqual(['validation-rule-regex-uncompilable']);

    // #5178 — nor does the format-NAME gate on a `json_schema` rule that names
    // no `format`: it needs the registered vocabulary only when there is a name
    // to judge, so the vocabulary is fetched last, not first.
    expect(
      validateRuleSchemaFormats(
        ruleStack({ type: 'json_schema', name: 'j0', field: 'payload', schema: { type: 'object' }, message: 'm' }),
      ),
    ).toEqual([]);

    for (const dep of LAZY_DEPS) {
      expect(depLoaded(req.cache, dep), `${dep} loaded before any react-source or L2-body validation`).toBe(false);
    }

    // The first `json_schema` rule pays for ajv AND its formats plugin (#5029 —
    // the gate compiles in the runtime's environment, which now registers
    // formats) — and the gate still works.
    const schemaFindings = validateRuleCompilability(
      ruleStack({ type: 'json_schema', name: 'j', field: 'payload', schema: { type: 'not-a-type' }, message: 'm' }),
    );
    expect(depLoaded(req.cache, 'ajv')).toBe(true);
    expect(depLoaded(req.cache, 'ajv-formats')).toBe(true);
    expect(schemaFindings.map((f) => f.rule)).toEqual(['validation-rule-json-schema-uncompilable']);

    // …and the format-name gate, once a schema does name one, reaches the same
    // already-loaded environment and still produces its finding (#5178).
    expect(
      validateRuleSchemaFormats(
        ruleStack({
          type: 'json_schema',
          name: 'jf',
          field: 'payload',
          schema: { type: 'object', properties: { e: { type: 'string', format: 'emial' } } },
          message: 'm',
        }),
      ).map((f) => f.rule),
    ).toEqual(['validation-rule-json-schema-unknown-format']);

    // The first react page with source pays the cost of exactly its own gate's
    // dep — and the gates still work.
    const syntax = validateReactPages({
      pages: [{ name: 'r', kind: 'react', source: 'function Page(){ return <div>oops; }' }],
    });
    expect(depLoaded(req.cache, 'sucrase')).toBe(true);
    expect(depLoaded(req.cache, 'typescript'), 'the syntax gate must not load typescript').toBe(false);
    expect(syntax.some((f) => f.rule === 'react-page-syntax' && f.severity === 'error')).toBe(true);

    // The first hook with an L2 JS body pays the typescript load — and the
    // write-set gate works (#4271).
    const hookWrites = validateHookBodyWrites({
      objects: [{ name: 'a', fields: { amount: {} } }],
      hooks: [hook({ language: 'js', source: 'ctx.input.amout = 1;' })],
    });
    expect(depLoaded(req.cache, 'typescript')).toBe(true);
    expect(hookWrites.some((f) => f.rule === 'hook-body-write-unknown-field' && f.severity === 'warning')).toBe(true);

    // …and the action gate works on the same terms (#4271 follow-up).
    const actionWrites = validateActionBodyWrites({
      objects: [{ name: 'a', fields: { amount: {} } }],
      actions: [action({ language: 'js', source: "await ctx.api.object('a').update({ amout: 1 });" })],
    });
    expect(actionWrites.some((f) => f.rule === 'action-body-write-unknown-field' && f.severity === 'warning')).toBe(
      true,
    );
    const recordWrites = validateActionBodyWrites({
      objects: [{ name: 'a', fields: { amount: {} } }],
      actions: [action({ language: 'js', source: 'ctx.record.amount = 1;' })],
    });
    expect(recordWrites.some((f) => f.rule === 'action-record-write-discarded' && f.severity === 'warning')).toBe(
      true,
    );

    const props = validateReactPageProps({
      pages: [{ name: 'r', kind: 'react', source: 'function Page(){ return <ObjectForm mode="edit" />; }' }],
    });
    expect(depLoaded(req.cache, 'typescript')).toBe(true);
    expect(props.some((f) => f.rule === 'react-prop-missing-required' && /objectName/.test(f.message))).toBe(true);
  }, COLD_LOAD_TIMEOUT_MS);
});
