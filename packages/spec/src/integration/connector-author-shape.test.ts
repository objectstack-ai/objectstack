// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ConnectorFieldMappingSchema,
  ConnectorSchema,
  WebhookConfigSchema,
} from './connector.zod';

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
// flipping them "a real but separate appetite". ADR-0122 phase 2 (#6083) did it:
// the bare `Connector` is now `z.input` — the shape the document annotates with
// — and `ConnectorParsed` carries the parse result. The pinned FACT is
// unchanged; the two names swapped sides, which is what the last describe block
// in this file now measures.

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
  for (const name of Object.keys(probes)) out.set(name, []);
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const file = d.file?.fileName ? resolve(d.file.fileName) : undefined;
    for (const [name] of Object.entries(probes)) {
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

describe('[#5515] SYNC_ARCHITECTURE.md L3 connector examples compile', () => {
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

  it('compiles every full connector example verbatim, import line included', () => {
    const probes: Record<string, string> = {};
    compilable.forEach((block, i) => { probes[`doc-l3-connector-${i}`] = block; });
    // The harness's own control: a probe that MUST fail. Without it a
    // resolution failure (paths mapping wrong, host overlay not applied) would
    // report zero diagnostics and read as a green example.
    probes['harness-self-test'] = [
      "import type { Connector } from '@objectstack/spec/integration';",
      "const broken: Connector = { label: 'no name, no type' };",
    ].join('\n');

    const results = compileProbes(probes);
    expect(render(results.get('harness-self-test')!), 'the harness must be able to report an error')
      .toContain('TS2739');
    compilable.forEach((_, i) => {
      expect(
        render(results.get(`doc-l3-connector-${i}`)!),
        `L3 example #${i} must compile clean`,
      ).toBe('');
    });
  });
});

describe('[#5515] the four spellings the example used to carry are rejected', () => {
  // Reverse verification, direction stated BEFORE running: each probe below
  // restores one defect into an otherwise-fixed literal, and each must go RED
  // with a named diagnostic. Not "some diagnostic" — a bare non-empty check
  // would still pass if the probe broke for an unrelated reason, which is
  // precisely the failure mode a documentation gate is prone to.
  //
  // Each probe is a whole `Connector` rather than a bare mapping or
  // webhook literal, because that is the shape the document actually teaches —
  // and because the nested schemas publish no author-state name of their own,
  // so reaching them any other way would mean measuring something the barrel
  // does not export.
  const HEAD = "import type { Connector } from '@objectstack/spec/integration';";
  const probes = {
    'alias-source-field': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{ sourceField: 'customer_number', targetField: 'customer_id' }],
      };
      void c;
    `,
    // #5515 filed this as "`custom` is not a member of the union". #5552 then
    // retired the union outright, so the probe now measures the stronger fact:
    // the KEY is gone, and it is gone for `custom` and for every real member
    // alike. The probe body is unchanged on purpose — it is the same wrong
    // snippet an author copies out of the L3 document.
    'transform-retired': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{
          source: 'order_value', target: 'order_total',
          transform: { type: 'custom', function: 'value => parseFloat(value) / 100' },
        }],
      };
      void c;
    `,
    // The other half, and the one that would silently rot otherwise: a
    // previously-VALID member must now fail too. Without this, a regression that
    // restored the union would leave `transform-retired` red for the old reason
    // ("custom is not a member") and nothing would notice the retirement had
    // been undone.
    'transform-retired-valid-member': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{
          source: 'order_value', target: 'order_total',
          transform: { type: 'javascript', expression: 'value / 100' },
        }],
      };
      void c;
    `,
    'webhook-retry-policy': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        webhooks: [{
          name: 'order_created_webhook',
          url: 'https://api.objectstack.com/webhooks/sap/orders',
          retryPolicy: { maxRetries: 3, backoffStrategy: 'exponential', initialDelayMs: 1000 },
        }],
      };
      void c;
    `,
    // The canonical spellings of all three, as one control: if this were red
    // the three reds above would say nothing about the SPELLING.
    'canonical-control': `${HEAD}
      const c: Connector = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{
          source: 'order_value', target: 'order_total',
        }],
        webhooks: [{
          name: 'order_created_webhook',
          url: 'https://api.objectstack.com/webhooks/sap/orders',
          events: ['record.created'],
        }],
      };
      void c;
    `,
  } as const;

  const results = compileProbes(probes);

  it('`sourceField` / `targetField` are not the canonical `source` / `target`', () => {
    const message = render(results.get('alias-source-field')!);
    expect(message).toContain('TS2353');
    expect(message).toContain('sourceField');
  });

  // ⚠ Measured, not assumed — and it is the one place the two tombstone
  // channels are NOT equally good. `retiredKey()` is `z.never().optional()`, so
  // its `z.input` type is `undefined`, and tsc reports the assignment failure
  // against that type: "Type '{ … }' is not assignable to type 'undefined'".
  // The compile channel therefore REFUSES the key but does not NAME it, while
  // the parse channel (the `[#5515]`/`[#5552]` runtime block below) carries the
  // full prescription. Asserting `toContain('transform')` here was the first
  // draft and it was simply wrong about the diagnostic text; pinning the real
  // shape is what keeps this test honest about which channel says what.
  it('[#5552] `transform` is retired — the key no longer type-checks', () => {
    // Was: "`custom` is not a member of the transform union", asserting all five
    // member names appeared in the message. That assertion cannot be re-spelled
    // — the union it enumerated is gone — so it is replaced by the fact that
    // survived: the key itself fails to compile.
    const message = render(results.get('transform-retired')!);
    expect(message).toContain('TS2322');
    expect(message).toContain("not assignable to type 'undefined'");
  });

  it('[#5552] …and a member that used to be VALID fails identically', () => {
    // The guard against a silent restoration: if the union came back, this probe
    // would compile and go green, which is the only signal distinguishing "the
    // key is retired" from "that one value was never a member". Identical
    // diagnostic to the probe above — same key, same refusal, regardless of the
    // value's shape.
    const message = render(results.get('transform-retired-valid-member')!);
    expect(message).toContain('TS2322');
    expect(message).toContain("not assignable to type 'undefined'");
  });

  it('`webhooks[].retryPolicy` does not exist on the webhook shape', () => {
    const message = render(results.get('webhook-retry-policy')!);
    expect(message).toContain('TS2353');
    expect(message).toContain('retryPolicy');
  });

  it('…while the canonical spellings of all three compile', () => {
    expect(render(results.get('canonical-control')!)).toBe('');
  });
});

describe('[#5515] the schema rejects them at RUNTIME too, and how it says so', () => {
  // The compile probes above guard the TYPE surface. These guard the PARSE
  // surface, and they are not redundant with it: what an author is told when
  // they get it wrong is the difference between a fixable mistake and a
  // mysterious one — and the three keys are told three different ways.

  it('`retryPolicy` is a curated tombstone: the rejection names #3494 and says there is no replacement', () => {
    // A KEY verdict on a `strictObject` surface, so the assertion is about
    // `unrecognized_keys` and the guidance text attached to it.
    const result = WebhookConfigSchema.safeParse({
      name: 'order_created_webhook',
      url: 'https://api.objectstack.com/webhooks/sap/orders',
      events: ['record.created'],
      retryPolicy: { maxRetries: 3, backoffStrategy: 'exponential', initialDelayMs: 1000 },
    });
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.message).toContain('#3494');
    expect(issues[0]!.message).toContain('There is no replacement');
  });

  it('`sourceField` / `targetField` are STRIPPED, and the mapping then fails on the missing canonical keys', () => {
    // Pinned because it is the opposite of what #5515 first assumed, and the
    // difference matters for how the doc defect could survive: the curated
    // `sourceField` alias lives on `./data`'s `ImportFieldMappingSchema`
    // (a `strictObject`, see `connector.test.ts`), NOT on this one.
    // `ConnectorFieldMappingSchema` is a plain `z.object`, so the two foreign
    // keys vanish silently and the author is told only that `source` and
    // `target` are missing — never that the words they wrote were the problem.
    const result = ConnectorFieldMappingSchema.safeParse({
      sourceField: 'customer_number',
      targetField: 'customer_id',
      dataType: 'string',
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(['source', 'target']);
    expect(JSON.stringify(result.error!.issues)).not.toContain('sourceField');
  });

  it('[#5552] `transform` is now a KEY verdict carrying the retirement prescription', () => {
    // The verdict CHANGED CLASS here, and that is the point worth pinning.
    // #5515 measured a VALUE verdict — the key was real, `'custom'` was not a
    // member, and the message enumerated the five that were. #5552 retired the
    // key, so the same input is now refused one level up, by the key, and every
    // member is equally out. Both spellings below get the identical message,
    // which is what "the union is gone" means as opposed to "your value was
    // wrong".
    for (const transform of [
      { type: 'custom', function: 'value => parseFloat(value) / 100' },
      { type: 'javascript', expression: 'value / 100' },
    ]) {
      const result = ConnectorFieldMappingSchema.safeParse({
        source: 'order_value',
        target: 'order_total',
        transform,
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'transform');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/`FieldMapping\.transform`.*removed.*#5552/s);
      // It must point at the transform pipeline that DOES run, not just refuse.
      expect(issue!.message).toMatch(/mapping\.fieldMapping\[\]\.transform/s);
    }
  });

  it('the corrected mapping parses — with the transform dropped, not re-spelled', () => {
    // There is no replacement member to move to: the L3 connector surface never
    // transformed anything. What the author keeps is the plain source→target
    // mapping; what they must move elsewhere is the transformation itself.
    const parsed = ConnectorFieldMappingSchema.parse({
      source: 'order_value',
      target: 'order_total',
      dataType: 'number',
      syncMode: 'bidirectional',
    });
    expect(parsed).not.toHaveProperty('transform');
    expect(parsed.source).toBe('order_value');
    expect(parsed.dataType).toBe('number');
  });
});

describe('[#5515] the bare `Connector` is the author shape; `ConnectorParsed` is the parse result', () => {
  // The fourth diagnostic, pinned as an ANNOTATION fact rather than fixed by
  // renaming this file's aliases. Direction stated before running: the SAME
  // literal is green under the bare `Connector` and red under `ConnectorParsed`,
  // because `z.infer` is the post-parse shape — `syncConfig.schedule` becomes the
  // `{ dialect, source }` envelope and every `.default()` key becomes required.
  // Before ADR-0122 phase 2 these two probes read `ConnectorInput` and
  // `Connector`. The literal and both verdicts are unchanged; only which name
  // sits on which side moved, which is the whole claim of the flip as a test.
  const literal = `{
    name: 'sap_erp_connector',
    label: 'SAP ERP Integration',
    type: 'saas',
    syncConfig: { schedule: '*/15 * * * *' },
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

  const results = compileProbes(probes);

  it('accepts the bare cron string and the omitted defaults under the bare `Connector`', () => {
    expect(render(results.get('author-connector')!)).toBe('');
  });

  it('rejects the same literal under `ConnectorParsed`, on the cron envelope and the defaults', () => {
    const message = render(results.get('parsed-connector')!);
    expect(message).toContain("Type 'string' is not assignable");
    expect(message).toContain('dialect');
  });

  it('a parse turns the one into the other — the annotation is the only difference', () => {
    const parsed = ConnectorSchema.parse({
      name: 'sap_erp_connector',
      label: 'SAP ERP Integration',
      type: 'saas',
      syncConfig: { schedule: '*/15 * * * *' },
    });
    expect(parsed.syncConfig!.schedule).toEqual({ dialect: 'cron', source: '*/15 * * * *' });
    // The defaults the author left out, supplied by the parse. This is what
    // makes annotating the example with the parsed alias wrong rather than
    // merely inconvenient: it would demand the author write them all out.
    expect(parsed.syncConfig!.strategy).toBe('incremental');
    expect(parsed.enabled).toBe(true);
    expect(parsed.status).toBe('inactive');
  });
});
