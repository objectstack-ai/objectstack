// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Does the CLI hold metadata to the SAME schema the write path does? (#5000)
 *
 * #5000 measured that `os build` / `os validate` "never parse page metadata by
 * `PageSchema`": an undeclared key on a page component was said to pass both
 * commands and land in `dist/objectstack.json`, which would make the #4001
 * acceptance line — "all three example apps `validate` clean" — empty evidence
 * on the page surface, because nothing on that path ever parsed a page.
 *
 * Re-measured against `origin/main`, the claim does not hold. Both commands
 * parse the WHOLE stack through `ObjectStackDefinitionSchema`, and its `pages`
 * element is the very object `getMetadataTypeSchema('page')` returns — the same
 * gate `MetadataManager.validate` and `GET /api/v1/meta` use. The issue's own
 * repro and its own negative control both exit non-zero today.
 *
 * So this file is not the gate the issue asked for; it is the evidence the
 * issue found missing. Nothing pinned either half of the claim, which is why a
 * stale `packages/spec/dist` (AGENTS.md §9) or a refactor onto a lenient
 * publish shape could reopen it without a single test turning red. Two claims,
 * because they fail independently:
 *
 *   A. the CLI parses through the registry's schemas — one undeclared key, the
 *      same verdict from both gates, for every registered metadata type. Three
 *      carriers are structurally different and are asserted at their real
 *      positions. The one type that was NOT closed when this file was written
 *      (`api`) closed at **#5384**, so its weaker claim — AGREEMENT plus "the
 *      author is still told" — has been replaced by the full one, both gates
 *      REJECT, and the not-yet-closed table is now empty;
 *   B. the commands GATE on that parse — the issue's undeclared-key repro and
 *      the #4001 batch-13 `responsiveStyles.large` → `.lg` negative control,
 *      run through the real binary: non-zero exit, prescription in the output,
 *      and `os build` writes no artifact.
 *
 * (A) without (B) is a strict schema whose verdict a command swallows — the
 * #3782 shape. (B) without (A) is a command that gates on a schema nobody
 * checked is the canonical one. Both have happened here before: #3782 wired
 * four lints into `os build` alone, and #4409 found 23 of 26 rules running on
 * a strict subset of the three authoring commands.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackDefinitionSchema, lintUnknownAuthoringKeys, formatUnknownAuthoringKey } from '@objectstack/spec';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '@objectstack/spec/kernel';

const cliBin = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'run-dev.js');

/** The key #5000 injected. Kept verbatim so the repro reads as the issue wrote it. */
const INJECTED_KEY = 'aKeyPageComponentHasRejectedSinceADR0089';

/**
 * Registered metadata type → the stack-root collection the CLI parses it in.
 *
 * Asserted behaviourally (same undeclared key, same verdict on both gates)
 * rather than by schema-instance identity: `@objectstack/spec` ships one bundle
 * per entry point, so `@objectstack/spec/kernel`'s `getMetadataTypeSchema('page')`
 * and the `PageSchema` embedded in the root entry's `ObjectStackDefinitionSchema`
 * are equal-by-source copies that are never `===`. Identity is unobservable
 * across that boundary; the verdict is what the author actually meets.
 */
const GATED_AT: Readonly<Record<string, string>> = {
  object: 'objects',
  hook: 'hooks',
  seed: 'data',
  mapping: 'mappings',
  page: 'pages',
  dashboard: 'dashboards',
  app: 'apps',
  action: 'actions',
  report: 'reports',
  dataset: 'datasets',
  flow: 'flows',
  job: 'jobs',
  datasource: 'datasources',
  email_template: 'emailTemplates',
  doc: 'docs',
  book: 'books',
  permission: 'permissions',
  position: 'positions',
  // [#5961] `capability` joined the registry as a CLOSED shape, so it goes
  // straight into the gated set rather than into NOT_YET_CLOSED below: the
  // stack authors it at `capabilities:` as a flat array of the registry's own
  // shape (`stack.zod.ts`: `z.array(CapabilityDeclarationSchema)`), and that
  // shape is `.strict()`, so both gates reject an undeclared key identically.
  capability: 'capabilities',
  agent: 'agents',
  tool: 'tools',
  skill: 'skills',
  // [#5384] `api` GRADUATED here from NOT_YET_CLOSED — the deliberate ratchet
  // step this file's own note asked for. `ApiEndpointSchema` is `strictObject`
  // as of #5384, so the stack's `apis:` array and the registry schema now reject
  // an undeclared key identically, and "both gates agree, and the author is
  // still told" is no longer the strongest claim available: "both gates REJECT"
  // is. The blocker was never this vocabulary — #5309 (PR #6576) moved the
  // stored envelope (`packageId` / `state` / …) off the body first, which is
  // what made the closure a vocabulary change instead of a storage compromise.
  api: 'apis',
};

/**
 * The three types the stack does NOT carry as a flat collection of the
 * registry's own shape. Each is a structural difference between "how an app
 * authors it" and "what a stored row looks like" — not a hole — so each gets
 * its own placement in the assertion below rather than the generic one.
 */
const STRUCTURAL_EXCEPTIONS: Readonly<Record<string, string>> = {
  field: 'authored INSIDE its object (`objects[].fields`), never as a stack-root collection; '
    + 'ObjectSchema carries FieldSchema for it.',
  translation: 'the stack authors locale → data BUNDLES (`TranslationBundleSchema`, a record); '
    + 'the registry carries `TranslationItemSchema`, the per-row shape the runtime metadata API stores.',
  view: 'the registry schema is the #3095 union over all three persisted view shapes (wire ViewItem, '
    + 'defineView container, flattened personalization overlay); the stack authors the container '
    + 'member, `ViewSchema`.',
};

/**
 * Registered types whose SCHEMA is not closed yet, so "both gates reject" is
 * not the claim to make — "both gates agree, and the author is still told" is.
 *
 * **EMPTY as of #5384, and that is a hard zero rather than a gap.** `api` was
 * the one live row: #5312 registered the type and the stack authors it at
 * `apis:` (ADR-0121; note the neighbouring singular `api:` block, which is
 * server-facing REST config, not metadata), while `ApiEndpointSchema` was still
 * a plain `z.object` — an undeclared key on an endpoint was DROPPED on both the
 * write path and here, identically. What this table asserted for it was the
 * weaker pair: the CLI is no looser than the write path, and the #3786
 * pre-parse layer still names the key, so the author is not left with silence.
 *
 * That row is GONE, in the direction the note above it predicted: #5384 closed
 * the shape with `strictObject`, the agreement assertions went red, and `api`
 * moved into `GATED_AT` — the deliberate ratchet step, not a surprise. The
 * blocker was never the endpoint vocabulary; #5309 (PR #6576) split the stored
 * envelope off the authored body first, and only then was closing it a
 * vocabulary change.
 *
 * The table and its assertions STAY, for the next type that registers ahead of
 * its closure — which is how `api` arrived in the first place. While it is
 * empty the case below asserts the emptiness explicitly, because a loop over
 * nothing is a green that proves nothing.
 */
const NOT_YET_CLOSED: Readonly<Record<string, { collection: string; tracking: string }>> = {};

/** Every `unrecognized_keys` issue naming `INJECTED_KEY`, with its path. */
function undeclaredKeyRejections(result: { success: boolean; error?: any }): string[] {
  if (result.success) return [];
  return (result.error.issues as any[])
    .filter((i) => i.code === 'unrecognized_keys' && Array.isArray(i.keys) && i.keys.includes(INJECTED_KEY))
    .map((i) => i.path.join('.'));
}

const MANIFEST = {
  id: 'gate_probe',
  name: 'Gate Probe',
  namespace: 'gate_probe',
  version: '1.0.0',
  type: 'app',
} as const;

/** The issue's page, with `injected` deciding whether the defect is planted. */
const pageWith = (component: Record<string, unknown>) => ({
  name: 'gate_probe_page',
  label: 'Gate Probe',
  type: 'app',
  template: 'default',
  kind: 'full',
  regions: [{ name: 'main', components: [component] }],
});

const CLEAN_COMPONENT = {
  id: 'styling_root',
  type: 'flex',
  responsiveStyles: { large: { display: 'flex' } },
  properties: { children: [] },
};

/** Run a CLI command in `dir`; returns its exit code and combined output. */
function runCli(command: string, dir: string, args: string[] = []): { exitCode: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [cliBin, command, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { exitCode: 0, output };
  } catch (error: any) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/**
 * A config written as a plain literal — no `defineStack` / `definePage`.
 *
 * Load-bearing: those factories parse eagerly, so a config authored through
 * them is rejected before the command's own gate is ever consulted. #5000's
 * repro edited `examples/app-showcase`, where every page goes through
 * `definePage`, so its exit code could not distinguish "the CLI gates" from
 * "the factory threw". A literal isolates the command's own parse.
 */
function withConfig<T>(stack: Record<string, unknown>, body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'os-metadata-gate-'));
  try {
    writeFileSync(join(dir, 'objectstack.config.mjs'), `export default ${JSON.stringify(stack, null, 2)};\n`);
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the CLI parses metadata through the registry schemas (#5000)', () => {
  it('classifies every registered metadata type', () => {
    // A newly registered type with no classification fails here rather than
    // quietly acquiring no CLI-side gate — the generalized form of #5000's
    // worry, which was about exactly one type nobody had checked.
    const classified = new Set([
      ...Object.keys(GATED_AT),
      ...Object.keys(STRUCTURAL_EXCEPTIONS),
      ...Object.keys(NOT_YET_CLOSED),
    ]);
    const registered = listMetadataTypeSchemaTypes();
    const unclassified = registered.filter((t) => !classified.has(t));
    expect(
      unclassified,
      'a registered metadata type is in none of the three tables — decide which it is (gated, structurally '
        + 'different, or a schema #4001 has not closed yet), so `os validate` cannot silently stop gating it. '
        + 'This is the row `api` needed when #5312 registered it mid-flight.',
    ).toEqual([]);
    // And the reverse: a table row for a type nobody registers any more is a
    // guard describing a surface that no longer exists.
    const stale = [...classified].filter((t) => !registered.includes(t));
    expect(stale, 'the table names metadata types that are no longer registered').toEqual([]);
  });

  it('reaches the same verdict as the write path on an undeclared key, per type', () => {
    // Left: the gate `MetadataManager.validate` / `GET /api/v1/meta` / the
    // Studio form use. Right: the schema `os validate` and `os build` parse
    // the whole stack through. #5000's claim was that the right-hand column
    // is blank for `page`; it is blank for nothing.
    const writePathAccepts: string[] = [];
    const cliAccepts: string[] = [];

    for (const [type, collectionKey] of Object.entries(GATED_AT)) {
      const registry = getMetadataTypeSchema(type);
      expect(registry, `no registered schema for '${type}'`).toBeDefined();
      if (undeclaredKeyRejections(registry!.safeParse({ [INJECTED_KEY]: 1 })).length === 0) {
        writePathAccepts.push(type);
      }
      const viaCli = undeclaredKeyRejections(
        ObjectStackDefinitionSchema.safeParse({ manifest: MANIFEST, [collectionKey]: [{ [INJECTED_KEY]: 1 }] }),
      );
      if (!viaCli.includes(`${collectionKey}.0`)) cliAccepts.push(`${type} (stack '${collectionKey}')`);
    }

    // Guard the guard: the detector must be able to say NO. A collection the
    // stack does not declare is silently DROPPED (the root object is not
    // strict — that is what the #3786 warning layer exists for), so an
    // ungated type produces zero rejections here. If this ever came back
    // non-empty, every row above would be passing on a detector that always
    // says yes.
    expect(
      undeclaredKeyRejections(
        ObjectStackDefinitionSchema.safeParse({ manifest: MANIFEST, notAStackCollection: [{ [INJECTED_KEY]: 1 }] }),
      ),
      'the undeclared-key detector reported a rejection for a collection the stack never declares',
    ).toEqual([]);

    expect(writePathAccepts, 'the metadata-type registry stopped rejecting undeclared keys for these types').toEqual([]);
    expect(
      cliAccepts,
      'the stack schema `os validate` / `os build` parse through no longer rejects an undeclared key for these '
        + 'types — either the collection is gone from the stack root (silently dropped, since the root is not '
        + 'strict) or it now parses through a looser shape than the write path. That divergence is #5000.',
    ).toEqual([]);
  });

  it('rejects an undeclared key on each structurally-different carrier', () => {
    // `field` — inside its object.
    expect(
      undeclaredKeyRejections(
        ObjectStackDefinitionSchema.safeParse({
          manifest: MANIFEST,
          objects: [{ name: 'gate_obj', label: 'Gate', fields: { title: { type: 'text', label: 'T', [INJECTED_KEY]: 1 } } }],
        }),
      ),
    ).toContain('objects.0.fields.title');

    // `translation` — inside a locale of the bundle.
    expect(
      undeclaredKeyRejections(
        ObjectStackDefinitionSchema.safeParse({
          manifest: MANIFEST,
          translations: [{ 'en-US': { [INJECTED_KEY]: 1 } }],
        }),
      ),
    ).toContain('translations.0.en-US');

    // `view` — the container member of the registry union.
    expect(
      undeclaredKeyRejections(
        ObjectStackDefinitionSchema.safeParse({
          manifest: MANIFEST,
          views: [{ name: 'gate_view', label: 'Gate', object: 'gate_obj', [INJECTED_KEY]: 1 }],
        }),
      ),
    ).toContain('views.0');
  });

  it('is no looser than the write path on a type #4001 has not closed, and still names the key', () => {
    // [#5384] The table is EMPTY, so the loop below runs zero times — and a
    // green from a loop over nothing proves nothing. Assert the zero itself, so
    // the state is pinned rather than assumed: if a type is ever added back
    // here, this line is the one that must be consciously edited, and the loop
    // resumes covering it.
    expect(
      Object.keys(NOT_YET_CLOSED),
      'a registered type is back on the not-yet-closed list — the loop below now covers it, and '
        + 'this expectation records the regression deliberately rather than passing vacuously',
    ).toEqual([]);

    for (const [type, { collection, tracking }] of Object.entries(NOT_YET_CLOSED)) {
      const registry = getMetadataTypeSchema(type);
      expect(registry, `no registered schema for '${type}'`).toBeDefined();

      // Agreement, both directions. If the registry schema closes (that is
      // what `tracking` is for), the first expectation flips and this row
      // moves into GATED_AT — a deliberate step, not a surprise.
      expect(
        undeclaredKeyRejections(registry!.safeParse({ [INJECTED_KEY]: 1 })),
        `${type}'s schema now rejects undeclared keys (${tracking} closed it?) — move it into GATED_AT`,
      ).toEqual([]);
      expect(
        undeclaredKeyRejections(
          ObjectStackDefinitionSchema.safeParse({ manifest: MANIFEST, [collection]: [{ [INJECTED_KEY]: 1 }] }),
        ),
        `the CLI rejects on '${collection}' while the write path accepts — a divergence in the other direction`,
      ).toEqual([]);

      // Not rejected is not the same as not reported: the #3786 pre-parse diff
      // is what stands between the author and silence while the shape is open.
      const reported = lintUnknownAuthoringKeys({ manifest: MANIFEST, [collection]: [
        { name: 'gate_endpoint', path: '/api/v1/apps/gate_probe/things', method: 'GET', type: 'proxy', target: 'https://example.test', [INJECTED_KEY]: 1 },
      ] } as Record<string, unknown>).map(formatUnknownAuthoringKey);
      expect(
        reported.join('\n'),
        `an undeclared key on a '${type}' item is neither rejected nor reported — that is silent metadata loss`,
      ).toContain(INJECTED_KEY);
    }
  });
});

describe('the authoring commands gate on that parse (#5000)', () => {
  // Reverse verification, direction declared up front: the SAME stack without
  // the planted key must exit 0. Without this control the three cases below
  // would also pass if the stack failed for some unrelated reason — a green
  // that proves nothing, which is the failure mode #5000 itself ran into.
  it('accepts the control stack (no planted key)', () => {
    const { exitCode, output } = withConfig({ manifest: MANIFEST, pages: [pageWith(CLEAN_COMPONENT)] }, (dir) =>
      runCli('validate', dir),
    );
    expect(exitCode, `os validate rejected the CONTROL stack:\n${output}`).toBe(0);
  }, 120_000);

  it('os validate rejects an undeclared key on a page component, with the prescription', () => {
    const { exitCode, output } = withConfig(
      { manifest: MANIFEST, pages: [pageWith({ ...CLEAN_COMPONENT, [INJECTED_KEY]: 1 })] },
      (dir) => runCli('validate', dir),
    );
    expect(exitCode, `os validate exited 0 on #5000's repro:\n${output}`).not.toBe(0);
    expect(output).toContain(INJECTED_KEY);
    // A rejection that does not say WHICH schema refused, and what changed,
    // sends the author to the wrong file. ADR-0089 D3a is the decision.
    expect(output).toContain('ADR-0089 D3a');
  }, 120_000);

  it('os build rejects the same stack and writes no artifact', () => {
    const { exitCode, output, wroteArtifact } = withConfig(
      { manifest: MANIFEST, pages: [pageWith({ ...CLEAN_COMPONENT, [INJECTED_KEY]: 1 })] },
      (dir) => ({ ...runCli('build', dir), wroteArtifact: existsSync(join(dir, 'dist', 'objectstack.json')) }),
    );
    expect(exitCode, `os build exited 0 on #5000's repro:\n${output}`).not.toBe(0);
    expect(output).toContain(INJECTED_KEY);
    // #5000's second complaint: the artifact carried the bad value onward.
    // The build emits from `result.data`, so a rejected parse emits nothing.
    expect(wroteArtifact, 'os build wrote an artifact for a stack it rejected').toBe(false);
  }, 120_000);

  it("os validate turns red on #4001 batch 13's own negative control (`large` → `lg`)", () => {
    // The control that did NOT turn red when #5000 was filed, which is what
    // made the batch reach for a slot-tracing probe instead. It is red now:
    // `ResponsiveStylesSchema` closed, and the CLI parses through it.
    const { exitCode, output } = withConfig(
      {
        manifest: MANIFEST,
        pages: [pageWith({ ...CLEAN_COMPONENT, responsiveStyles: { lg: { display: 'flex' } } })],
      },
      (dir) => runCli('validate', dir),
    );
    expect(exitCode, `os validate exited 0 on a page styled under the wrong breakpoint vocabulary:\n${output}`).not.toBe(0);
    expect(output).toContain('responsiveStyles');
    expect(output).toContain('large');
  }, 120_000);
});
