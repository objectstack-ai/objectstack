// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ETL, ETLPipelineSchema } from './etl.zod';

// ─── [#4963] `ETLPipeline` is the AUTHOR shape — proved with the compiler ───
//
// Until 17 all nine `etl.zod.ts` type aliases were `z.infer` under the bare
// name with no `*Parsed` counterpart, against the house convention (bare name =
// `z.input` = what an author writes; `XParsed` = `z.infer` = what a parse
// returns — written up on `shared/retry-policy.zod.ts`, followed by every
// sibling automation config). On this file that was not cosmetic: six defaulted
// keys and a transform-typed `schedule` were all REQUIRED under `z.infer`, so
// `const p: ETLPipeline = { … }` — the file's only authoring door, there being
// no parse site in objectstack / objectui / cloud — did not compile.
// `SYNC_ARCHITECTURE.md` carried three examples that proved it.
//
// ## Why this file uses the compiler API instead of type-level pins
//
// #4642 established that a conditional-type pin in a `packages/spec` test is a
// NO-OP: `tsconfig.json` excludes `**/*.test.ts` (the package's measured
// `TEST_DEBT` entry in `scripts/check-type-check-coverage.mjs`) and vitest never
// enables `typecheck`. A `@ts-expect-error` or `expectTypeOf` written here would
// be read by nothing. So the pins below drive `ts.createProgram` themselves and
// assert on real diagnostics, the way `sync-retirement.test.ts` does — and, like
// it, they carry anti-vacuity guards, because a harness that resolves nothing
// reports zero errors and looks exactly like success.

const SPEC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SYNC_ARCHITECTURE = resolve(SPEC_DIR, 'docs/SYNC_ARCHITECTURE.md');

/**
 * Compile a set of probe files against this package's real source and return
 * each one's diagnostics, keyed by probe name.
 *
 * `@objectstack/spec/<entry>` is mapped through `paths` to the entry barrel in
 * `src/`, which is what lets a documentation snippet be compiled VERBATIM —
 * import line included — rather than rewritten into a relative import that no
 * reader of the docs would ever type.
 *
 * `noUnusedLocals` is deliberately off: a documentation snippet declares a
 * `const` and stops, and TS6133 is a lint opinion about the snippet's framing,
 * not a statement about whether the pipeline literal is well-typed. Everything
 * else runs at the repo's real strictness (`strict: true`).
 */
function compileProbes(probes: Readonly<Record<string, string>>): Map<string, ts.Diagnostic[]> {
  const dir = resolve(SPEC_DIR, 'src/__etl_author_shape_probes__');
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

describe('[#4963] SYNC_ARCHITECTURE.md pipeline examples compile', () => {
  const markdown = readFileSync(SYNC_ARCHITECTURE, 'utf8');
  const blocks = typescriptBlocks(markdown);
  const pipelineBlocks = blocks.filter((b) => b.includes('ETLPipeline'));

  it('finds the examples this gate exists for, and counts the ones it skips', () => {
    // Anti-vacuity: a selector that matched nothing would make the compile
    // assertion below pass over an empty program — the way a gate goes dormant.
    expect(pipelineBlocks.length, 'ETLPipeline examples in SYNC_ARCHITECTURE.md').toBe(3);
    // The other three are the L3 `Connector` examples, out of this gate's scope
    // because they belong to `integration/connector.zod.ts`. Two of them are
    // Migration-Guide sketches that elide with a bare `...`, which is not
    // TypeScript. The third — the full `sapConnector` example — is NOT exempt on
    // its merits: run through this same harness it reports four diagnostics, and
    // three of them are keys or values the schema REJECTS (`sourceField` /
    // `targetField` for `source` / `target`, `transform.type: 'custom'`,
    // `webhooks[].retryPolicy`). That is filed as #5515, not fixed here, because
    // the fourth diagnostic is `Connector` being `z.infer` — this issue's twin
    // on a file whose migration surface is NOT empty, so it needs its own ruling.
    // The total is pinned rather than left open so that ADDING a block to this
    // document is a decision someone has to make on purpose: a new ETL example
    // is picked up automatically by the selector above, and anything else
    // turns this red until it is classified here.
    expect(blocks.length, 'total ```typescript blocks — classify any new one').toBe(6);
  });

  it('compiles all three verbatim, import line included, with zero diagnostics', () => {
    const probes: Record<string, string> = {};
    pipelineBlocks.forEach((block, i) => { probes[`doc-example-${i}`] = block; });
    // The harness's own control: a probe that MUST fail. Without it, a
    // resolution failure (paths mapping wrong, host overlay not applied) would
    // report zero diagnostics for every block and read as three green examples.
    probes['harness-self-test'] = [
      "import type { ETLPipeline } from '@objectstack/spec/automation';",
      "const broken: ETLPipeline = { name: 'no_source_no_destination' };",
    ].join('\n');

    const results = compileProbes(probes);
    expect(render(results.get('harness-self-test')!), 'the harness must be able to report an error')
      .toContain('TS2739');

    for (const [name, diagnostics] of results) {
      if (name === 'harness-self-test') continue;
      expect(render(diagnostics), `${name} must compile clean`).toBe('');
    }
  });
});

describe('[#4963] the bare name is the author shape; `*Parsed` is the parse result', () => {
  /**
   * The load-bearing pin, written as ONE program so the positive and the
   * negative share a document: the same literal, the same keys, only the
   * annotation differs. A red `parsed-*` probe therefore cannot be a literal
   * that was wrong for an unrelated reason — its `author-*` twin just compiled.
   */
  const probes = {
    // ── author shape: every defaulted key omitted, cron written bare ──
    'author-pipeline': `
      import type { ETLPipeline } from '@objectstack/spec/automation';
      const p: ETLPipeline = {
        name: 'customer_360',
        source: { type: 'api', connector: 'salesforce', config: { object: 'Account' } },
        destination: { type: 'warehouse', config: { table: 'customers' } },
        transformations: [{ type: 'filter', config: { condition: 'active' } }],
        schedule: '0 2 * * *',
      };
    `,
    'author-source': `
      import type { ETLSource } from '@objectstack/spec/automation';
      const s: ETLSource = { type: 'api', config: {}, incremental: { cursorField: 'updated_at' } };
    `,
    'author-destination': `
      import type { ETLDestination } from '@objectstack/spec/automation';
      const d: ETLDestination = { type: 'database', config: { table: 't' } };
    `,
    'author-transformation': `
      import type { ETLTransformation } from '@objectstack/spec/automation';
      const t: ETLTransformation = { type: 'map', config: {} };
    `,
    'author-run': `
      import type { ETLPipelineRun } from '@objectstack/spec/automation';
      const r: ETLPipelineRun = {
        id: 'run-1', pipelineName: 'customer_360', status: 'succeeded',
        startedAt: '2024-01-01T02:00:00Z', stats: {},
      };
    `,

    // ── parsed shape: the SAME literals, which must now be rejected ──
    'parsed-pipeline': `
      import type { ETLPipelineParsed } from '@objectstack/spec/automation';
      const p: ETLPipelineParsed = {
        name: 'customer_360',
        source: { type: 'api', connector: 'salesforce', config: { object: 'Account' } },
        destination: { type: 'warehouse', config: { table: 'customers' } },
        transformations: [{ type: 'filter', config: { condition: 'active' } }],
        schedule: '0 2 * * *',
      };
    `,
    // Everything a parse WOULD have filled in is present except `syncMode` and
    // `enabled`, so the top-level omission is the only thing left to report.
    // The probe above cannot say this on its own: TypeScript reports the
    // deepest mismatch it finds and stops, so with `writeMode` /
    // `continueOnError` / the cron envelope also missing, the two top-level
    // keys never appear in its message at all.
    'parsed-pipeline-top-level-only': `
      import type { ETLPipelineParsed } from '@objectstack/spec/automation';
      const p: ETLPipelineParsed = {
        name: 'customer_360',
        source: {
          type: 'api', connector: 'salesforce', config: { object: 'Account' },
          incremental: { enabled: true, cursorField: 'updated_at' },
        },
        destination: { type: 'warehouse', config: { table: 'customers' }, writeMode: 'upsert' },
        transformations: [{ type: 'filter', config: { condition: 'active' }, continueOnError: false }],
        schedule: { dialect: 'cron', source: '0 2 * * *' },
      };
    `,
    'parsed-destination': `
      import type { ETLDestinationParsed } from '@objectstack/spec/automation';
      const d: ETLDestinationParsed = { type: 'database', config: { table: 't' } };
    `,
    'parsed-transformation': `
      import type { ETLTransformationParsed } from '@objectstack/spec/automation';
      const t: ETLTransformationParsed = { type: 'map', config: {} };
    `,
    'parsed-run': `
      import type { ETLPipelineRunParsed } from '@objectstack/spec/automation';
      const r: ETLPipelineRunParsed = {
        id: 'run-1', pipelineName: 'customer_360', status: 'succeeded',
        startedAt: '2024-01-01T02:00:00Z', stats: {},
      };
    `,
  } as const;

  const results = compileProbes(probes);

  it.each(['author-pipeline', 'author-source', 'author-destination', 'author-transformation', 'author-run'])(
    '%s compiles with the defaulted keys left out',
    (name) => {
      expect(render(results.get(name)!)).toBe('');
    },
  );

  it('rejects the same pipeline literal under `ETLPipelineParsed`', () => {
    // The direction stated before it was run: under the PARSED alias the
    // defaulted keys are facts about a document that has already been through
    // `.parse()`, so omitting them is an error. Each missing key is named
    // rather than asserting "some diagnostic", because a bare non-empty check
    // would still pass if the alias were quietly pointed back at `z.input` and
    // the literal broke for an unrelated reason.
    const message = render(results.get('parsed-pipeline')!);
    expect(message).toContain('writeMode');
    expect(message).toContain('continueOnError');
    // The transform half: a bare cron string is the input, never the output.
    expect(message).toContain("Type 'string' is not assignable");
  });

  it('requires `syncMode` and `enabled` on `ETLPipelineParsed` — the top-level defaults', () => {
    const message = render(results.get('parsed-pipeline-top-level-only')!);
    expect(message).toContain('TS2739');
    expect(message).toContain('syncMode');
    expect(message).toContain('enabled');
    // …and the author-shape twin of this exact literal is clean, which is what
    // makes the red above a statement about the ANNOTATION and nothing else.
    expect(render(results.get('author-pipeline')!)).toBe('');
  });

  it('rejects the same destination / transformation / run literals under `*Parsed`', () => {
    expect(render(results.get('parsed-destination')!)).toContain('writeMode');
    expect(render(results.get('parsed-transformation')!)).toContain('continueOnError');
    // `stats: {}` is complete under the input shape and missing four counters
    // under the parsed one — the wire half follows the same rule as the seven
    // authoring shapes, deliberately (see the alias note in `etl.zod.ts`).
    expect(render(results.get('parsed-run')!)).toContain('recordsRead');
  });

  it('accepts a bare cron string only on the author side', () => {
    // `schedule` is the second half of why the old aliases did not compile:
    // `CronExpressionInputSchema` is a transform, so `z.infer` is the
    // `{ dialect, source }` envelope and the string every doc example writes
    // was rejected. This is asserted through the pipeline probes above rather
    // than a fourth pair, because `schedule` has no standalone ETL alias.
    expect(render(results.get('author-pipeline')!)).toBe('');
    expect(render(results.get('parsed-pipeline')!)).toContain("Type 'string' is not assignable");
  });
});

describe('[#4963] all nine aliases carry the pair', () => {
  const NAMES = [
    'ETLEndpointType', 'ETLSource', 'ETLDestination', 'ETLTransformationType',
    'ETLTransformation', 'ETLSyncMode', 'ETLPipeline', 'ETLRunStatus', 'ETLPipelineRun',
  ] as const;

  it('exports `X` and `XParsed` from `@objectstack/spec/automation` for every one of them', () => {
    const program = ts.createProgram([resolve(SPEC_DIR, 'src/automation/index.ts')], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const sf = program.getSourceFile(resolve(SPEC_DIR, 'src/automation/index.ts'));
    const moduleSym = sf && checker.getSymbolAtLocation(sf);
    // Without this the `toContain`s below would assert over an empty list.
    expect(moduleSym, 'the ./automation barrel must resolve').toBeTruthy();
    const exported = checker.getExportsOfModule(moduleSym!).map((s) => s.getName());
    expect(exported.length).toBeGreaterThan(50);

    for (const name of NAMES) {
      expect(exported, `${name} must still be exported`).toContain(name);
      expect(exported, `${name}Parsed must exist — the pair is the convention`).toContain(`${name}Parsed`);
    }
  });

  it('leaves the four enum aliases mutually assignable — the pair is a deliberate synonym', () => {
    // Stated as a compile probe rather than a comment so that an enum which
    // later gains a `.transform()` or `.catch()` turns this red instead of
    // silently making `X` and `XParsed` disagree behind four identical-looking
    // declarations.
    const enums = ['ETLEndpointType', 'ETLTransformationType', 'ETLSyncMode', 'ETLRunStatus'];
    const probes: Record<string, string> = {};
    for (const name of enums) {
      probes[`enum-${name}`] = [
        `import type { ${name}, ${name}Parsed } from '@objectstack/spec/automation';`,
        `declare const a: ${name}; declare const b: ${name}Parsed;`,
        `const toParsed: ${name}Parsed = a; const toInput: ${name} = b;`,
        'void toParsed; void toInput;',
      ].join('\n');
    }
    const results = compileProbes(probes);
    for (const [name, diagnostics] of results) {
      expect(render(diagnostics), `${name} must be assignable in both directions`).toBe('');
    }
  });
});

describe('[#4963] the ETL factories stopped working around their own return type', () => {
  it('passes a bare cron string straight through instead of pre-wrapping it', () => {
    // Pre-17 the helpers normalized `'0 * * * *'` into `{ dialect: 'cron',
    // source }` because `z.infer` of `CronExpressionInputSchema` is the
    // post-transform envelope and would not accept the string. Returning the
    // AUTHOR shape moves that normalization back to where it belongs: the parse.
    const pipeline = ETL.databaseSync({
      name: 'users_sync', sourceTable: 'src', destTable: 'dst', schedule: '0 * * * *',
    });
    expect(pipeline.schedule).toBe('0 * * * *');

    const parsed = ETLPipelineSchema.parse(pipeline);
    expect(parsed.schedule).toEqual({ dialect: 'cron', source: '0 * * * *' });
  });

  it('no longer spells out `enabled`, and the parse still supplies it', () => {
    // `enabled: true` restated the schema's own default and existed only
    // because `z.infer` made the key required. Dropping it must not change what
    // a parsed pipeline says — that is the whole claim of the flip.
    const pipeline = ETL.apiToDatabase({ name: 'api_ingest', apiConnector: 'stripe', destTable: 'payments' });
    expect(pipeline).not.toHaveProperty('enabled');
    expect(ETLPipelineSchema.parse(pipeline).enabled).toBe(true);
  });

  it('still states what each helper DECIDES, not what the schema defaults to', () => {
    // The keys that survived are the ones carrying intent: the two helpers are
    // a contrast (incremental+upsert vs full+append) and a reader must see it
    // without looking up two defaults.
    const sync = ETL.databaseSync({ name: 'users_sync', sourceTable: 'src', destTable: 'dst' });
    expect(sync.syncMode).toBe('incremental');
    expect(sync.destination.writeMode).toBe('upsert');
    const ingest = ETL.apiToDatabase({ name: 'api_ingest', apiConnector: 'stripe', destTable: 'payments' });
    expect(ingest.syncMode).toBe('full');
    expect(ingest.destination.writeMode).toBe('append');
    for (const p of [sync, ingest]) expect(ETLPipelineSchema.safeParse(p).success).toBe(true);
  });
});
