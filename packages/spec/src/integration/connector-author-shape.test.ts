// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — compiles the package type graph once: every probe (the two SYNC_ARCHITECTURE.md connector examples, the retired keys a Connector must refuse, the Connector / ConnectorParsed pair, and their controls) is compiled in one ts.createProgram over the spec entry barrels it imports, the first read pays that program's type-graph resolution and every later probe reads the same program; slowest of 9 executed hourly CI readings on 2026-10-16, 21.8 s (run 38904808867), x 1.25, rounded up

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConnectorSchema } from './connector.zod';

// ─── [#5515] the L3 `Connector` example in SYNC_ARCHITECTURE.md ──────────────
//
// `automation/etl-author-shape.test.ts` (#4963 / PR #5514) put the same
// document's three L2 `ETLPipeline` blocks behind a compiler-API gate and, in
// the same breath, measured the L3 `sapConnector` block and left it red: four
// diagnostics, three of them keys or values `integration/connector.zod.ts`
// REJECTS. It was filed as #5515 rather than fixed there because the owner
// schema is this file's, not `automation/etl.zod.ts`'s. This is that gate.
//
// ⚠️ That sibling gate is GONE as of #6414: the L2 ETL layer it guarded was
// retired under ADR-0049 (no executor, ever), and a gate over a deleted schema
// has nothing left to assert. This is now the document's ONLY compile gate, so
// it absorbed the one assertion of the sibling's that was not about ETL — the
// TOTAL ```typescript block count, which is what makes adding a block to
// SYNC_ARCHITECTURE.md a deliberate act. The ~40-line harness below stays
// exactly where it was; it was a near-copy of the sibling's, and with the
// sibling gone it is simply the harness.
//
// ## Why the compiler API instead of type-level pins
//
// #4642 established that a conditional-type pin in a `packages/spec` test used
// to be a NO-OP (`tsconfig.json` excludes `**/*.test.ts`; vitest never enables
// `typecheck`). #5286 put the test layer back in front of tsc via
// `tsconfig.test.json`, so a `@ts-expect-error` written here IS read now — but
// only about THIS file's own text. It still cannot say anything about a
// snippet that lives in a markdown fence. So the pins below drive
// `ts.createProgram` over the fence contents themselves, verbatim, and assert
// on real diagnostics — with anti-vacuity guards, because a harness that
// resolves nothing reports zero errors and looks exactly like success.
//
// ## What "the four diagnostics" were
//
//   TS2353  `sourceField` does not exist in `{ source: string; target: string; … }`
//   TS2322  `'custom'` is not assignable to
//           `'map' | 'lookup' | 'constant' | 'cast' | 'javascript'`
//   TS2353  `retryPolicy` does not exist in the webhook shape
//   TS2322  `string` is not assignable to `{ dialect: 'cel'|'cron'|'template'; … }`
//
// The first three are the example teaching keys and values the schema turns
// down; they are fixed in the document. The fourth is an ANNOTATION fact —
// the annotation named the PARSED state, in which `syncConfig.schedule` is the
// post-transform `{ dialect, source }` envelope and a bare cron string is
// correctly rejected. When this gate was written that state sat on the bare
// `Connector` and the author state on `ConnectorInput`, and this comment called
// flipping them "a real but separate appetite". ADR-0122 phase 2 (commit 53068c130) did it:
// the bare `Connector` is now `z.input` — the shape the document annotates with
// — and `ConnectorParsed` carries the parse result. The pinned FACT is
// unchanged; the two names swapped sides, which is what the last describe block
// in this file now measures. #16320 then retired `syncConfig.schedule` itself
// (ADR-0049 — nothing evaluated it), the one key whose TYPE differed between
// the two sides, so that block now measures the flip on the defaults alone.
//
// Protocol 18 then retired `syncConfig` and `fieldMappings` themselves
// (ADR-0049 — no engine ever ran a connector-attached sync; the definition
// moved to the target `mapping`'s `connectorSource`). The three `fieldMappings`
// probes below therefore measure the strongest fact left: the KEY is refused
// whatever it holds, and the document's second example now teaches the
// target-side binding instead of a connector `syncConfig`.

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SYNC_ARCHITECTURE = resolve(SPEC_DIR, 'docs/SYNC_ARCHITECTURE.md');

/**
 * Compile a set of probe files against this package's real source and return
 * each one's diagnostics, keyed by probe name.
 *
 * `@objectstack/spec/<entry>` is mapped through `paths` to the entry barrel in
 * `src/`, which is what lets a documentation snippet be compiled VERBATIM —
 * import line included — rather than rewritten into a relative import no reader
 * of the docs would ever type.
 *
 * `types: ['node']` is present because the L3 example reads
 * `process.env.SAP_CLIENT_ID!`, which is exactly what a real connector does
 * with a credential; without it the snippet would fail on `process` and say
 * nothing about the connector literal. `noUnusedLocals` is off for the sibling
 * gate's reason: a documentation snippet declares a `const` and stops, and
 * TS6133 is an opinion about the snippet's framing. Everything else runs at the
 * repo's real strictness (`strict: true`).
 *
 * Diagnostics are asked of each PROBE file only, never of the whole program:
 * every assertion below reads a probe's own diagnostics, and a whole-program
 * request type-checks the body of every `packages/spec` source file the probes
 * reach, for diagnostics a filter then discarded. A probe's diagnostics still
 * reflect every type it reaches (`Connector`, its tombstones, `ConnectorParsed`);
 * only the bodies nobody reads are skipped.
 * `shared/retired-key-tsc-diagnostic.test.ts` asks the same way.
 */
function compileProbes(probes: Readonly<Record<string, string>>): Map<string, ts.Diagnostic[]> {
  const dir = resolve(SPEC_DIR, 'src/__connector_author_shape_probes__');
  const paths = new Map<string, string>();
  for (const [name, text] of Object.entries(probes)) paths.set(resolve(dir, `${name}.ts`), text);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    types: ['node'],
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
  for (const name of Object.keys(probes)) {
    const path = resolve(dir, `${name}.ts`);
    const file = program.getSourceFile(path);
    if (file === undefined) throw new Error(`probe ${name} did not enter the program`);
    out.set(name, ts.getPreEmitDiagnostics(program, file).filter((d) => d.file !== undefined && resolve(d.file.fileName) === path));
  }
  return out;
}

/**
 * Every probe this file compiles, by name — registered while the describe
 * blocks below are COLLECTED, and compiled together in ONE program the first
 * time any case reads a result.
 *
 * Each probe is its own module (an `import` line opens every one), so a probe
 * cannot see another's declarations and its diagnostics do not depend on which
 * probes share the program; what three programs did here — each re-parsing and
 * re-checking the same `Connector` types — one program does once. A name
 * registered twice must carry the same text, and a case reading a probe the
 * program never saw fails rather than reading an empty answer.
 */
const REGISTERED = new Map<string, string>();
let compiled: Map<string, ts.Diagnostic[]> | undefined;

function registerProbes(probes: Readonly<Record<string, string>>): () => Map<string, ts.Diagnostic[]> {
  for (const [name, text] of Object.entries(probes)) {
    const prior = REGISTERED.get(name);
    if (prior !== undefined && prior !== text) throw new Error(`probe ${name} is registered twice with different text`);
    REGISTERED.set(name, text);
  }
  return () => {
    compiled ??= compileProbes(Object.fromEntries(REGISTERED));
    const out = new Map<string, ts.Diagnostic[]>();
    for (const name of Object.keys(probes)) {
      const diagnostics = compiled.get(name);
      if (diagnostics === undefined) throw new Error(`probe ${name} was registered after the program was built`);
      out.set(name, diagnostics);
    }
    return out;
  };
}

/** One diagnostic per line, `TS<code>: <message>`, for readable assertions. */
function render(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    .join('\n');
}

/** Every ```typescript fence in a markdown file. */
function typescriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```typescript\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/**
 * A bare `...` used as an elision — `{ type: 'api-key', ... }`, `webhooks: [...]`
 * — as opposed to a real spread, which is always `...` followed by an
 * identifier. A block containing one is a prose sketch, not TypeScript.
 */
const ELISION = /\.\.\.\s*[,}\]]/;

describe('SYNC_ARCHITECTURE.md L3 connector examples compile', () => {
  const markdown = readFileSync(SYNC_ARCHITECTURE, 'utf8');
  const allBlocks = typescriptBlocks(markdown);
  const connectorBlocks = allBlocks.filter((b) => b.includes('Connector'));
  const sketches = connectorBlocks.filter((b) => ELISION.test(b));
  const compilable = connectorBlocks.filter((b) => !ELISION.test(b));

  it('finds the examples this gate exists for, and classifies the ones it skips', () => {
    // Anti-vacuity, in both directions: a selector that matched nothing would
    // make the compile assertion below pass over an empty program (the way a
    // gate goes dormant), and a sketch counted as compilable would fail it for
    // a reason that is not about the schema.
    //
    // ⚠️ This block ABSORBED the total-count pin at #6414. It used to end with
    // "the document's TOTAL ```typescript count is pinned by the sibling gate
    // (`automation/etl-author-shape.test.ts`)" — and that sibling was deleted
    // with the L2 layer it guarded. A deleted gate takes its assertions with it
    // silently, which is the one way a documentation gate fails without anyone
    // seeing red, so the total-count pin moves HERE rather than lapsing. That
    // is what still makes adding a block to this document a deliberate act.
    expect(allBlocks.length, 'total ```typescript blocks — classify any new one').toBe(2);
    expect(connectorBlocks.length, '`Connector` examples in SYNC_ARCHITECTURE.md').toBe(2);
    // Zero sketches TODAY, and the classifier is kept anyway. The two it used
    // to exempt were the Migration Guide's "Before (L3 `syncConfig`)" / "After
    // (L3)" fragments, which #6414 replaced when the guide's direction reversed
    // (there is no longer an L2 to migrate to). They were exempt on their FORM
    // (not TypeScript), never on their merits — the lesson of #5515 is that
    // "it's only a doc snippet" is how four rejected spellings survived in a
    // file authors copy from, so a re-introduced sketch must still be
    // classified rather than silently compiled.
    expect(sketches.length, 'Migration-Guide sketches that elide with `...`').toBe(0);
    expect(compilable.length, 'full, compilable connector examples').toBe(2);
    // Also pinned deliberately: the L2 "Before" snippet in the Migration Guide
    // is fenced as PLAIN text, not `typescript`, because `ETLPipeline` no
    // longer exists and the snippet is shown precisely as the thing that no
    // longer compiles. If someone re-fences it as `typescript`, the total above
    // goes to 3 and this gate says so.
    expect(markdown).toContain("const pipeline: ETLPipeline = {");
    expect(markdown).not.toContain("```typescript\nimport type { ETLPipeline }");
  });

  const probes: Record<string, string> = {};
  compilable.forEach((block, i) => { probes[`doc-l3-connector-${i}`] = block; });
  // The harness's own control: a probe that MUST fail. Without it a
  // resolution failure (paths mapping wrong, host overlay not applied) would
  // report zero diagnostics and read as a green example.
  probes['harness-self-test'] = [
    "import type { Connector } from '@objectstack/spec/integration';",
    "const broken: Connector = { label: 'no name, no type' };",
  ].join('\n');
  const compile = registerProbes(probes);

  // This `it` carries its OWN timeout instead of the package's 60 s default
  // (`vitest.config.ts`): it is the first case to read a compile result, so it
  // builds the file's one `ts.createProgram` over the spec's types (every
  // probe registered above and below, at `strict`), and that was more work
  // than the default is sized for. The readings that follow are of the harness
  // before it shared one program and asked only the probe files for
  // diagnostics; the timeout is left where they put it. CI readings, `Test Core
  // (1/6)`: 55,680 ms on `main` (commit 85b4ac634e; the same figure appears at
  // 018b077fbf and eab7236ff7 because turbo replayed one cached run, so it is
  // one reading, not three) and 61,767 ms on a cold spec re-run (PR head
  // 63710c5572), which timed out at 60,000 ms. A local run (2 workers) reads
  // 13,796 ms. 180_000 ms is about 2.9x the cold CI reading: room for a slower
  // runner, still short enough that a hung compile fails inside three minutes,
  // and the figure `shared/alias-integrity.test.ts` already gives its own
  // import-everything `beforeAll`. Only this `it` is widened: raising the
  // global `testTimeout` would hide the next slow test as well.
  it('compiles every full connector example verbatim, import line included', () => {
    const results = compile();
    expect(render(results.get('harness-self-test')!), 'the harness must be able to report an error')
      .toContain('TS2739');
    compilable.forEach((_, i) => {
      expect(
        render(results.get(`doc-l3-connector-${i}`)!),
        `L3 example #${i} must compile clean`,
      ).toBe('');
    });
  }, 180_000);
});

describe('the spellings the example used to carry are rejected', () => {
  // Reverse verification, direction stated BEFORE running: each probe below
  // restores one retired key into an otherwise-valid literal, and each must go
  // RED with a named diagnostic. Not "some diagnostic" — a bare non-empty check
  // would still pass if the probe broke for an unrelated reason, which is
  // precisely the failure mode a documentation gate is prone to.
  //
  // #5515 pinned four VALUE-level defects here (`sourceField` for `source`, a
  // `custom` transform, a webhook `retryPolicy`, a bare cron string). Every
  // container they lived in has since been retired whole — `fieldMappings`
  // and `syncConfig` in protocol 18, `webhooks` before them — so each probe now
  // measures the stronger fact: the KEY is refused, whatever it holds, even
  // when what it holds would once have been well-formed.
  const HEAD = "import type { Connector } from '@objectstack/spec/integration';";
  const probes = {
    // The example's former field map, in its CANONICAL spelling: refused anyway.
    'field-mappings-retired': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{ source: 'customer_number', target: 'customer_id' }],
      };
      void c;
    `,
    // The example's former sync block, trimmed to one key: refused anyway.
    'sync-config-retired': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        syncConfig: { strategy: 'incremental' },
      };
      void c;
    `,
    'webhooks-retired': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        webhooks: [{
          name: 'order_created_webhook',
          url: 'https://api.objectstack.com/webhooks/sap/orders',
        }],
      };
      void c;
    `,
    // A live sibling key in the same literal, as one control: if this were red
    // the reds above would say nothing about the RETIRED keys.
    'live-key-control': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        retryConfig: { maxAttempts: 3 },
      };
      void c;
    `,
  } as const;

  const compile = registerProbes(probes);

  // ⚠ Measured, not assumed — and it is the one place the two tombstone
  // channels are NOT equally good. `retiredKey()` types the key as its
  // tombstone mark (an object whose one property is named by the `[REMOVED]`
  // sentence and typed `never`), so tsc reports the assignment failure against
  // that mark, worded by the value's kind: TS2741 for the two arrays, TS2353
  // for the `syncConfig` object. The compile channel therefore REFUSES the key
  // and says it was retired, pointing at `os validate`, while only the parse
  // channel (the runtime block below) carries the key's own prescription.
  for (const probe of ['field-mappings-retired', 'sync-config-retired', 'webhooks-retired'] as const) {
    it(`\`${probe}\`: the key no longer type-checks, whatever it holds`, () => {
      const results = compile();
      const message = render(results.get(probe)!);
      expect(message).toMatch(/^TS(2741|2353): /);
      expect(message).toContain('[REMOVED]');
      expect(message).toContain('`os validate`');
    });
  }

  it('…while a live sibling key in the same literal compiles', () => {
    const results = compile();
    expect(render(results.get('live-key-control')!)).toBe('');
  });
});

describe('the schema rejects them at RUNTIME too, and how it says so', () => {
  // The compile probes above guard the TYPE surface. These guard the PARSE
  // surface, and they are not redundant with it: what an author is told when
  // they get it wrong is the difference between a fixable mistake and a
  // mysterious one.

  it('`webhooks` on a connector is a KEY verdict carrying the retirement prescription', () => {
    const result = ConnectorSchema.safeParse({
      name: 'sap_erp_connector',
      label: 'SAP ERP Integration',
      type: 'saas',
      webhooks: [{
        name: 'order_created_webhook',
        url: 'https://api.objectstack.com/webhooks/sap/orders',
        events: ['record.created'],
      }],
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'webhooks');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(/`connector\.webhooks` was removed/);
    expect(issue!.message).toContain('top-level `webhooks:` collection');
  });

  it('the example\'s former `syncConfig` / `fieldMappings` are KEY verdicts pointing at the target-side binding', () => {
    // What an author copying an older revision of the document meets: both
    // keys refused BY NAME, and the prescription naming the surface the
    // document now teaches — the target `mapping` and its `connectorSource`.
    const result = ConnectorSchema.safeParse({
      name: 'sap_erp_connector',
      label: 'SAP ERP Integration',
      type: 'saas',
      syncConfig: { strategy: 'incremental', conflictResolution: 'latest_wins', deleteMode: 'soft_delete' },
      fieldMappings: [{ source: 'customer_number', target: 'customer_id', syncMode: 'bidirectional' }],
    });
    expect(result.success).toBe(false);
    for (const key of ['syncConfig', 'fieldMappings']) {
      const issue = result.error!.issues.find((i) => i.path.join('.') === key);
      expect(issue, `${key} must be refused at its own path`).toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.message).toMatch(new RegExp(`^\`connector\\.${key}\` was removed`));
      expect(issue!.message).toContain('`connectorSource`');
    }
  });
});

describe('the bare `Connector` is the author shape; `ConnectorParsed` is the parse result', () => {
  // The fourth diagnostic, pinned as an ANNOTATION fact rather than fixed by
  // renaming this file's aliases. Direction stated before running: the SAME
  // literal is green under the bare `Connector` and red under `ConnectorParsed`,
  // because `z.infer` is the post-parse shape — every `.default()` key becomes
  // required. Before ADR-0122 phase 2 these two probes read `ConnectorInput`
  // and `Connector`; only which name sits on which side moved, which is the
  // whole claim of the flip as a test.
  //
  // The literal used to carry `syncConfig: { strategy: 'incremental' }`, and
  // the flip was measured on `syncConfig`'s defaults. Protocol 18 retired that
  // key (ADR-0049), so it is measured on the connector's OWN defaults —
  // `enabled`, `requestTimeoutMs` and `authentication` — which were always the
  // other half of it.
  const literal = `{
    name: 'sap_erp_connector',
    label: 'SAP ERP Integration',
    type: 'saas',
  }`;
  const probes = {
    'author-connector': `
      import type { Connector } from '@objectstack/spec/integration';
      const c: Connector = ${literal};
      void c;
    `,
    'parsed-connector': `
      import type { ConnectorParsed } from '@objectstack/spec/integration';
      const c: ConnectorParsed = ${literal};
      void c;
    `,
  } as const;

  const compile = registerProbes(probes);

  it('accepts the omitted defaults under the bare `Connector`', () => {
    const results = compile();
    expect(render(results.get('author-connector')!)).toBe('');
  });

  it('rejects the same literal under `ConnectorParsed`, on the defaults it left out', () => {
    const results = compile();
    const message = render(results.get('parsed-connector')!);
    expect(message).toMatch(/TS2739: .* is missing the following properties/);
    expect(message).toContain('enabled');
    expect(message).toContain('requestTimeoutMs');
  });

  it('a parse turns the one into the other — the annotation is the only difference', () => {
    const parsed = ConnectorSchema.parse({
      name: 'sap_erp_connector',
      label: 'SAP ERP Integration',
      type: 'saas',
    });
    // The defaults the author left out, supplied by the parse. This is what
    // makes annotating the example with the parsed alias wrong rather than
    // merely inconvenient: it would demand the author write them all out.
    expect(parsed.enabled).toBe(true);
    expect(parsed.requestTimeoutMs).toBe(30000);
    expect(parsed.authentication).toEqual({ type: 'none' });
    // `status` used to be supplied here as `'inactive'`, and `syncConfig`'s
    // defaults with it; both keys are retired (ADR-0049) and a parse emits
    // neither.
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('syncConfig');
  });
});
