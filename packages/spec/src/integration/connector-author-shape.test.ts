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
// The two gates are deliberately SEPARATE — same document, different owning
// schema — and so is the ~40-line harness below, which is a near-copy of the
// sibling's. Sharing it would mean a third module imported by both; at two
// call sites the duplication is cheaper than the indirection, and each gate
// stays readable end to end. A third such gate is the point to extract.
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
// `Connector` is `z.infer` here, so it is the shape a `.parse()` RETURNS, in
// which `syncConfig.schedule` is the post-transform `{ dialect, source }`
// envelope and a bare cron string is correctly rejected. The document now
// annotates with `ConnectorInput` (`z.input`), which is what an author writes.
// Flipping this file's 20 bare `z.infer` aliases to the house `X` / `XParsed`
// convention the way #4963 did for `etl.zod.ts` is a real but separate
// appetite (this file's migration surface is not empty) and is NOT done here.

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

describe('[#5515] SYNC_ARCHITECTURE.md L3 connector example compiles', () => {
  const markdown = readFileSync(SYNC_ARCHITECTURE, 'utf8');
  const connectorBlocks = typescriptBlocks(markdown).filter((b) => b.includes('Connector'));
  const sketches = connectorBlocks.filter((b) => ELISION.test(b));
  const compilable = connectorBlocks.filter((b) => !ELISION.test(b));

  it('finds the example this gate exists for, and classifies the ones it skips', () => {
    // Anti-vacuity, in both directions: a selector that matched nothing would
    // make the compile assertion below pass over an empty program (the way a
    // gate goes dormant), and a sketch counted as compilable would fail it for
    // a reason that is not about the schema.
    expect(connectorBlocks.length, '`Connector` examples in SYNC_ARCHITECTURE.md').toBe(3);
    // The two skipped ones are the Migration Guide's "Before (L3 `syncConfig`)"
    // and "After (L3)" fragments, which elide with a bare `...`. They are
    // exempt on their FORM (not TypeScript), never on their merits — the whole
    // lesson of #5515 is that "it's only a doc snippet" is how four rejected
    // spellings survived in a file authors copy from.
    expect(sketches.length, 'Migration-Guide sketches that elide with `...`').toBe(2);
    expect(compilable.length, 'the full `sapConnector` example').toBe(1);
    // The document's TOTAL ```typescript count is pinned by the sibling gate
    // (`automation/etl-author-shape.test.ts`), which is what makes ADDING a
    // block a deliberate act; this gate pins the `Connector` slice of it.
  });

  it('compiles the `sapConnector` example verbatim, import line included', () => {
    const probes: Record<string, string> = { 'doc-l3-connector': compilable[0]! };
    // The harness's own control: a probe that MUST fail. Without it a
    // resolution failure (paths mapping wrong, host overlay not applied) would
    // report zero diagnostics and read as a green example.
    probes['harness-self-test'] = [
      "import type { ConnectorInput } from '@objectstack/spec/integration';",
      "const broken: ConnectorInput = { label: 'no name, no type' };",
    ].join('\n');

    const results = compileProbes(probes);
    expect(render(results.get('harness-self-test')!), 'the harness must be able to report an error')
      .toContain('TS2739');
    expect(render(results.get('doc-l3-connector')!), 'the L3 example must compile clean').toBe('');
  });
});

describe('[#5515] the four spellings the example used to carry are rejected', () => {
  // Reverse verification, direction stated BEFORE running: each probe below
  // restores one defect into an otherwise-fixed literal, and each must go RED
  // with a named diagnostic. Not "some diagnostic" — a bare non-empty check
  // would still pass if the probe broke for an unrelated reason, which is
  // precisely the failure mode a documentation gate is prone to.
  //
  // Each probe is a whole `ConnectorInput` rather than a bare mapping or
  // webhook literal, because that is the shape the document actually teaches —
  // and because this file publishes no `*Input` alias for the nested schemas,
  // so reaching them any other way would mean measuring something the barrel
  // does not export.
  const HEAD = "import type { ConnectorInput } from '@objectstack/spec/integration';";
  const probes = {
    'alias-source-field': `${HEAD}
      const c: ConnectorInput = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{ sourceField: 'customer_number', targetField: 'customer_id' }],
      };
      void c;
    `,
    'transform-custom': `${HEAD}
      const c: ConnectorInput = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{
          source: 'order_value', target: 'order_total',
          transform: { type: 'custom', function: 'value => parseFloat(value) / 100' },
        }],
      };
      void c;
    `,
    'webhook-retry-policy': `${HEAD}
      const c: ConnectorInput = {
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
      const c: ConnectorInput = {
        name: 'sap_erp_connector', label: 'SAP ERP Integration', type: 'saas',
        fieldMappings: [{
          source: 'order_value', target: 'order_total',
          transform: { type: 'javascript', expression: 'value / 100' },
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

  it("`transform.type: 'custom'` is not a member of the transform union", () => {
    const message = render(results.get('transform-custom')!);
    expect(message).toContain('"custom"');
    // The five real members, named, so that adding or removing one is a
    // decision that surfaces here rather than silently widening the doc's claim.
    for (const member of ['constant', 'cast', 'lookup', 'javascript', 'map']) {
      expect(message, `the union must still offer ${member}`).toContain(member);
    }
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

  it("`transform.type: 'custom'` is a VALUE verdict, and the message lists the five real members", () => {
    const result = ConnectorFieldMappingSchema.safeParse({
      source: 'order_value',
      target: 'order_total',
      transform: { type: 'custom', function: 'value => parseFloat(value) / 100' },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain("Expected 'constant' | 'cast' | 'lookup' | 'javascript' | 'map'");
  });

  it('the corrected mapping parses, and a bare expression string is wrapped into its envelope', () => {
    const parsed = ConnectorFieldMappingSchema.parse({
      source: 'order_value',
      target: 'order_total',
      dataType: 'number',
      transform: { type: 'javascript', expression: 'value / 100' },
      syncMode: 'bidirectional',
    });
    // `ExpressionInputSchema` shorthand: the string the document writes is the
    // INPUT, the envelope is what a parse returns. Stated here so the doc's
    // one-line form is known to be the schema's own shorthand and not a guess.
    expect(parsed.transform).toEqual({
      type: 'javascript',
      expression: { dialect: 'cel', source: 'value / 100' },
    });
  });
});

describe('[#5515] `ConnectorInput` is the author shape; `Connector` is the parse result', () => {
  // The fourth diagnostic, pinned as an ANNOTATION fact rather than fixed by
  // renaming this file's aliases. Direction stated before running: the SAME
  // literal is green under `ConnectorInput` and red under `Connector`, because
  // `z.infer` is the post-parse shape — `syncConfig.schedule` becomes the
  // `{ dialect, source }` envelope and every `.default()` key becomes required.
  const literal = `{
    name: 'sap_erp_connector',
    label: 'SAP ERP Integration',
    type: 'saas',
    syncConfig: { schedule: '*/15 * * * *' },
  }`;
  const probes = {
    'author-connector': `
      import type { ConnectorInput } from '@objectstack/spec/integration';
      const c: ConnectorInput = ${literal};
      void c;
    `,
    'parsed-connector': `
      import type { Connector } from '@objectstack/spec/integration';
      const c: Connector = ${literal};
      void c;
    `,
  } as const;

  const results = compileProbes(probes);

  it('accepts the bare cron string and the omitted defaults under `ConnectorInput`', () => {
    expect(render(results.get('author-connector')!)).toBe('');
  });

  it('rejects the same literal under `Connector`, on the cron envelope and the defaults', () => {
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
