/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `TextSchema.value` is REFUSED on both published faces and
 * no longer READ by the renderer (objectui#6951 A1 / objectui#7016, ADR-0049
 * enforce-or-remove). Maintainer ruling A1 of 2026-09-04: retire `value`, keep
 * `content`, immediately, no deprecation window.
 *
 * ## What was measured before the retirement
 *
 * `TextSchema` declared two spellings for its one content slot — `content`
 * (read first) and `value` (the fallback limb of
 * `{schema.content || schema.value}` at `renderers/basic/text.tsx`). Both were
 * declared by objectui#6150, whose own docblock called the pair "a dialect, not
 * a design" and left the choice to an ADR-0049 ruling. The ruling's premise —
 * that `value` is the MINORITY spelling — was measured on the four roots it
 * named (`examples/`, `apps/`, the `examples/` directories under `packages/`,
 * `content/docs/**`) before any edit: 776 `content`-only `text` nodes, 25
 * `value`-only, 0 authoring both. Every `value`-only node in the repository
 * was rewritten to `content` in the retiring PR; the absence leg below is
 * tree-scoped over the catalog so a new one cannot creep back in.
 *
 * ## Why a tombstone and not a deletion
 *
 * `BaseSchema` is `.passthrough()` on the Zod side and carried a
 * `[key: string]: any` index signature on the TS side until objectui#8347 (a
 * widened value still skips the excess-property check), and the renderer no
 * longer reads `value` at all. Deleting the member would therefore hand an
 * authored `value` the WORST outcome available: accepted, unvalidated, and
 * rendered as a blank. `?: never` / `retirementTombstone()` is this package's
 * convention (`MarkdownSchema.sanitize`, objectui#6972; `DataTableSchema.toolbar`,
 * objectui#6881) and is lockstep: both faces or neither. The "deleted" row is
 * pinned live below as a control.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive. A green `vitest` run is
 * NOT evidence about them — type assertions are erased before it runs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { TextSchema, TextSpanSchema } from '../zod/layout.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';
import type { TextSchema as TextSchemaTS, TextSpanSchema as TextSpanSchemaTS } from '../layout.js';

const ROOT = resolve(__dirname, '../../../..');

/**
 * The FULL guidance string, pinned as a literal so the derived assertions below
 * cannot all drift together. The first sentence is the contract an author acts
 * on: the retired key, and the spelling to write instead.
 */
const GUIDANCE =
  'RETIRED (ADR-0049) — `value` is no longer part of TextSchema; write `content`. It was a second '
  + 'spelling of the one content slot, read only as the fallback limb of `schema.content || schema.value`, '
  + 'and was retired under ADR-0049 enforce-or-remove with no deprecation window (maintainer ruling A1, '
  + '2026-09-04). The renderer reads `content` alone now, so an authored `value` would render nothing. '
  + 'Rename the key; the string is unchanged.';
const PRESCRIPTIVE = '`value` is no longer part of TextSchema; write `content`.';

/** The values an author would plausibly have written on the retired key. */
const RETIRED_VALUES = ['Hello', '', '${data.total}'] as const;

/** A minimal document that is valid TODAY and stays valid — the inside of the boundary. */
const VALID_TEXT = { type: 'text', content: 'Hello' } as const;

const describeOf = (schema: unknown, key: string): string | undefined =>
  ((schema as { shape: Record<string, { description?: string }> }).shape[key])?.description;

/** Flatten a union refusal so the arm-level issues are addressable by path. */
type Issue = { code: string; path: PropertyKey[]; message: string; expected?: string; errors?: Issue[][] };
const flatIssues = (issues: Issue[]): Issue[] =>
  issues.flatMap((i) => (i.code === 'invalid_union' && i.errors ? i.errors.flat().flatMap((e) => flatIssues([e])) : [i]));

/* ── the Zod half: refused BY NAME, with the guidance in the message ─────── */

describe('TextSchema.value is RETIRED — the Zod half of the tombstone (objectui#6951)', () => {
  it.each(RETIRED_VALUES.map((v) => [JSON.stringify(v), v] as const))(
    'REFUSES `value: %s`, naming the retired key in the path — every value, not one spelling',
    (_label, value) => {
      // The pin. Before the retirement this document parsed GREEN (`value` was
      // `z.string().optional()`, measured ACCEPTED on the retiring PR's base).
      // Asserting the ENVELOPE — not merely `success:false` — so the pin cannot
      // be satisfied by an unrelated rejection.
      const result = TextSchema.safeParse({ type: 'text', value });
      expect(result.success, `an authored \`value: ${JSON.stringify(value)}\` was ACCEPTED`).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => i.path[0] === 'value');
      expect(issue, 'parse failed, but not on the `value` path').toBeTruthy();
      // The accept-set contract: same address, same code a bare `z.never()`
      // reports — `retirementTombstone()` customises the MESSAGE only.
      expect(issue?.code).toBe('invalid_type');
      expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
      expect(issue?.path).toEqual(['value']);
    },
  );

  it('the refusal CARRIES the guidance — it names `content`, not zod\'s generic message', () => {
    const result = TextSchema.safeParse({ type: 'text', value: 'Hello' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'value');
    expect(issue?.message).not.toContain('Invalid input: expected never, received ');
    expect(issue?.message).toContain(PRESCRIPTIVE);
    expect(issue?.message).toContain('write `content`');
    expect(issue?.message).toBe(GUIDANCE);
    // ONE string, BOTH channels — asserted derived, so the parse message and
    // the generated-docs metadata cannot drift apart (objectui#6931).
    expect(issue?.message).toBe(describeOf(TextSchema, 'value'));
  });

  it('is refused through `safeValidateSchema` too — the `AnyComponentSchema` union arm carries the tombstone', () => {
    // The entry point a validating host actually calls. `AnyComponentSchema`
    // is a plain `z.union`, so a document every arm refuses surfaces as
    // `invalid_union`; the `TextSchema` arm's own issue — path `value`, the
    // guidance — must be inside it, otherwise the refusal an author reads
    // through this door would not say what to write.
    const result = safeValidateSchema({ type: 'text', value: 'Hello' });
    expect(result.success, 'a `text` node authoring `value` validated GREEN through the union').toBe(false);
    if (result.success) return;

    const named = flatIssues(result.error.issues as Issue[]).find((i) => i.path[0] === 'value');
    expect(named, 'the union refusal does not name the `value` path').toBeTruthy();
    expect(named?.message).toBe(GUIDANCE);

    // Positive control on the same door: the migrated document validates.
    expect(safeValidateSchema({ ...VALID_TEXT }).success).toBe(true);
  });

  it('keeps the key DECLARED — a tombstone, not a deletion', () => {
    // The route guard. `BaseSchema` is `.passthrough()`, so removing the key
    // from the mirror would make the authored spelling parse green again — and
    // with the renderer no longer reading it, render as a BLANK.
    expect(
      Object.keys(TextSchema.shape),
      'value left the mirror — under .passthrough() the retired key becomes a silent blank',
    ).toContain('value');
    expect(describeOf(TextSchema, 'value')).toContain('RETIRED (ADR-0049)');
  });
});

/* ── the inside of the boundary: everything else is untouched ────────────── */

describe('the retirement narrows exactly `value` and nothing else (objectui#6951)', () => {
  it('`content` still parses and its value SURVIVES the parse', () => {
    const result = TextSchema.safeParse(VALID_TEXT);
    expect(result.success ? null : result.error.issues).toBe(null);
    if (result.success) expect(result.data.content).toBe('Hello');
  });

  it('a document that never wrote `value` parses GREEN — `absent` stays valid', () => {
    // `.optional()` on the tombstone. A bare `{ type: "text" }` was legal
    // before (#6150's own control document) and stays legal.
    const result = TextSchema.safeParse({ type: 'text' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still REFUSES a wrong-typed `content` — the mirror did not stop validating', () => {
    // Counter-probe in the other direction: the schema is not `z.any()` in
    // disguise, so the green results above are readings.
    const result = TextSchema.safeParse({ type: 'text', content: 42 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === 'content')).toBeTruthy();
  });

  it('control: `TextSpanSchema.value` — the sibling member — is still ACCEPTED and survives', () => {
    // `value?: string` appears on three interfaces in `layout.ts`; only
    // `TextSchema`'s is retired. The `span` renderer still reads its own
    // `value` (`basic/span.tsx`), so this member must keep parsing — the pin
    // that the retirement was located by SYMBOL, not by grep hit.
    const result = TextSpanSchema.safeParse({ type: 'span', value: 'inline' });
    expect(result.success ? null : result.error.issues).toBe(null);
    if (result.success) expect(result.data.value).toBe('inline');
  });

  it('an UNDECLARED key still rides `.passthrough()` — the DELETED row, measured live', () => {
    // This is the contrast that justifies `?: never` over deletion, pinned
    // rather than argued: a key the mirror does not declare is neither refused
    // nor stripped, it is KEPT. Had `value` been deleted instead of tombstoned,
    // an authored value would sit exactly where this one sits — green, kept,
    // and read by nothing.
    const result = TextSchema.safeParse({ ...VALID_TEXT, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveProperty('notAKeyAtAll', 'anything');
  });
});

/* ── the corpus: no shipped fixture authors the retired spelling ─────────── */

/**
 * Keys whose arrays hold DESCRIPTORS, not component nodes: a filter-builder's
 * `fields[]` entry is `{ value, label, type: "text" }`, where `type` is a FIELD
 * type and `value` is the field key — the same three keys as a retired `text`
 * node and a different vocabulary. The census that sized this retirement
 * excluded them by kind (14 in the catalog); the walk below excludes them by
 * position, so the pin measures `text` NODES and not every object that spells
 * `type: "text"`.
 */
const DESCRIPTOR_SLOTS = new Set(['fields', 'columns', 'filters', 'options']);

/** Every `text` node (an object whose OWN `type` is `"text"`, reached through a node slot) in a parsed JSON document. */
function* textNodes(node: unknown, path: string): Generator<[string, Record<string, unknown>]> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* textNodes(node[i], `${path}[${i}]`);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'text') yield [path, obj];
  for (const [k, v] of Object.entries(obj)) {
    if (DESCRIPTOR_SLOTS.has(k)) continue;
    yield* textNodes(v, `${path}.${k}`);
  }
}

function* jsonFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* jsonFiles(full);
    else if (entry.endsWith('.json')) yield full;
  }
}

describe('no shipped JSON fixture authors `text.value` any more (objectui#6951) — tree-scoped', () => {
  // Tree-scoped on purpose: a file-scoped pin sees only the files its author
  // knew about, and the nine catalog entries rewritten by the retiring PR
  // (`components-data-display-kbd/inline-usage` ×2, `components-feedback-spinner/
  // loading-button`, `components-form-date-picker/date-range-selector`,
  // `components-form-input-otp/verification-form`, `components-overlay-hover-card/
  // basic-hover-card`, `components-overlay-sheet/{basic-sheet,left-side,right-side}`)
  // were found by census, not by memory. Nested nodes are validated per node
  // because `SchemaNodeSchema` does not descend into `AnyComponentSchema`.
  const CATALOG = resolve(ROOT, 'examples/schema-catalog/src/schemas');
  const TYPES_EXAMPLES = resolve(ROOT, 'packages/types/examples');

  it('every `text` node in the catalog and the types examples spells `content`, and parses green', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const dir of [CATALOG, TYPES_EXAMPLES]) {
      for (const file of jsonFiles(dir)) {
        const doc = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        for (const [path, node] of textNodes(doc, '$')) {
          seen++;
          if ('value' in node) offenders.push(`${file.slice(ROOT.length + 1)} ${path}`);
          const result = TextSchema.safeParse(node);
          if (!result.success) offenders.push(`${file.slice(ROOT.length + 1)} ${path}: ${JSON.stringify(result.error.issues)}`);
        }
      }
    }
    // Non-vacuity: the catalog carried 688 `text` nodes at the retirement; a
    // walk that finds none is a broken walk, not a clean corpus.
    expect(seen).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });
});

/* ── the renderer half: the retired key is no longer READ ────────────────── */

describe('the `text` renderer no longer reads `schema.value` (objectui#6951, enforce-or-remove)', () => {
  it('both read sites render `{schema.content}` alone — the read set, off disk', () => {
    // Enforce-or-remove: a retired key must stop being READ, not only stop
    // being declared. Both arms of `text.tsx` — the wrapped element and the
    // bare fragment — rendered `{schema.content || schema.value}`; the
    // fallback limb is gone from both. Read off disk so a renderer-side
    // re-widening cannot pass while the schema faces still refuse.
    const src = readFileSync(resolve(ROOT, 'packages/components/src/renderers/basic/text.tsx'), 'utf8');
    expect(src.match(/schema\.value\b/g)).toBeNull();
    expect(src.match(/\{schema\.content\}/g)).toHaveLength(2);
  });

  it('the one in-package producer of the dialect spells `content` too (`context-menu` fallback trigger)', () => {
    // `renderers/overlay/context-menu.tsx` authors a `text` node itself as the
    // default trigger; under the retirement a `value` there would render a
    // blank click area. Pinned so the producer cannot drift back.
    const src = readFileSync(resolve(ROOT, 'packages/components/src/renderers/overlay/context-menu.tsx'), 'utf8');
    expect(src).toContain("{ type: 'text', content: \"Right click here\" }");
    expect(src).not.toMatch(/type: 'text', value:/);
  });
});

/* ── the TS half: the `tsc` channel ──────────────────────────────────────── */

describe('TextSchema.value is RETIRED — the TS half of the tombstone (objectui#6951)', () => {
  it('refuses the retired key at compile time', () => {
    // On the pre-fix tree `value` is `string | undefined`, so the assignment
    // is LEGAL, the directive below is unused, and `tsc` fails the build with
    // TS2578 naming the key — this leg is red before the fix in `type-check`,
    // not in vitest, which strips types.

    // @ts-expect-error — `value` is RETIRED (objectui#6951): declared `?: never`, so no value is authorable.
    const retired: TextSchemaTS['value'] = 'Hello';

    // Counter-probe on the same surface: the live sibling still accepts its
    // value, so the directive above pins the KEY's retirement and not a
    // blanket narrowing of the interface.
    const sibling: TextSchemaTS['content'] = 'Hello';

    expect([retired, sibling]).toHaveLength(2);
  });

  it('refuses the retired key in the form authors actually write', () => {
    // The leg that proved the tombstone survives `BaseSchema`'s
    // `[key: string]: any` while it stood (objectui#8347 removed it): if the
    // index signature had won, `value` would have widened back to `any`
    // here and the directive would have gone unused (TS2578).
    const retiredDocument: TextSchemaTS = {
      type: 'text',
      // @ts-expect-error — `value` is RETIRED (objectui#6951); write `content`.
      value: 'Hello',
    };

    // The migrated document — the key renamed — still type-checks.
    const migratedDocument: TextSchemaTS = {
      type: 'text',
      content: 'Hello',
      variant: 'body',
    };

    expect([retiredDocument, migratedDocument]).toHaveLength(2);
  });

  it('refuses it through a WIDENED value too — the half a deletion would have missed', () => {
    // Excess-property checking only reaches a FRESH literal (objectui#7654
    // measured the contrast): a deleted key would ride a widened value
    // silently. The declared `never` makes the assignment itself ill-typed,
    // so freshness stops mattering.
    const raw = { type: 'text' as const, value: 'Hello' };
    // @ts-expect-error — `value` is RETIRED (objectui#6951), reached through a non-fresh value.
    const document: TextSchemaTS = raw;
    expect(document.type).toBe('text');
  });

  it('control: `TextSpanSchema.value` still type-checks — retired by symbol, not by grep', () => {
    const span: TextSpanSchemaTS = { type: 'span', value: 'inline' };
    expect(span.value).toBe('inline');
  });
});
