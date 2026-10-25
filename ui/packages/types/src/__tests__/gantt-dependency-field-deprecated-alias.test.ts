/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Deprecation pin — `ObjectGanttSchema.dependencyField` is a DECLARED legacy
 * alias, and both published faces now say so (objectui#6470).
 *
 * ## What was wrong, and what it was NOT
 *
 * `ObjectGanttSchema` declares two spellings of one thing. `dependenciesField`
 * is the spec's (`@objectstack/spec` `GanttConfigSchema.dependenciesField`);
 * `dependencyField`, the singular, has no spec counterpart at all — zero
 * occurrences across `packages/spec/src`, against a live positive control on the
 * plural. Until objectui#6051 declared the plural, the singular was the ONLY
 * dependencies spelling on this interface, so for the whole time the alias
 * existed the published type taught the non-spec key and hid the canonical one.
 *
 * The card was originally filed as commandment #0.1 — a lenient renderer
 * fallback to an UNDECLARED key. Triage's dissent measured that and it is not
 * this shape: the singular is declared outright, documented, and deliberately
 * retained, with the rationale written next to the canonical key. The honest
 * description is a types-vs-spec divergence, and the remedy re-scoped to match
 * (triage ruling 2026-08-26): mark it, keep it.
 *
 * ## Why the marker is the whole deliverable, and removal is not
 *
 * Two spellings declared as EQUALS is what a reader could not resolve. Nothing
 * on either face said which one to write, so an author — or an AI writing
 * metadata, which is the reader this project optimises for — had a coin flip
 * between a spec key and a pre-spec alias. A machine-readable marker turns the
 * coin flip into a fact the type itself carries.
 *
 * ⛔ Deleting the alias is deliberately NOT in this card. It would narrow the
 * accept set of a published surface — a breaking removal of a published
 * capability, which is a maintainer call on a future enforce-or-remove card once
 * the deprecation has sat a release. That is why the pins below assert the alias
 * is still THERE and still ACCEPTED as loudly as they assert it is tagged.
 *
 * ## The two failure modes, which are opposite
 *
 *   1. the tag is missing or nameless — the deprecation is cosmetic, no reader
 *      learns which spelling is canonical, and the card bought nothing;
 *   2. the alias is gone — the deprecation quietly became the removal that was
 *      explicitly excluded, breaking every author who wrote the singular.
 *
 * A test asserting only (1) passes on a tree where the alias was deleted; one
 * asserting only (2) passes on a tree where the tag never shipped. Both halves
 * are pinned.
 *
 * ## Why the TS face is read as SOURCE TEXT and the zod face at RUNTIME
 *
 * They carry the statement in different places, and each is checked where it
 * actually lives. A TS `@deprecated` exists only in the JSDoc — it reaches
 * consumers through `dist/*.d.ts` and their editor, and there is no runtime
 * value to interrogate, so the source is read (the idiom
 * `plugin-component-input-deprecation.test.ts` established, for the same reason
 * and with the same anchoring discipline). The zod mirror's `.describe()` IS a
 * runtime string on the parsed schema, so it is read off the schema object —
 * which is what makes the mirror half of this deprecation machine-readable
 * rather than merely human-readable.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ObjectGanttSchema } from '../zod/objectql.zod.js';
import type { ObjectGanttSchema as ObjectGanttSchemaTS } from '../objectql.js';

const OBJECTQL_SRC = readFileSync(
  fileURLToPath(new URL('../objectql.ts', import.meta.url)),
  'utf8',
);

/** The alias member, exactly as `objectql.ts` spells it. */
const ALIAS = 'dependencyField?: string;';
/** The canonical member, exactly as `objectql.ts` spells it. */
const CANONICAL = "dependenciesField?: GanttConfig['dependenciesField'];";

/**
 * The JSDoc block immediately preceding a member, or `null` when the member is
 * not preceded by one.
 *
 * Anchored to the member rather than searching the file for `@deprecated`:
 * `objectql.ts` carries fifteen unrelated deprecations, so a file-wide search
 * would go green on any of them and say nothing about this key.
 */
function docBlockBefore(member: string): string | null {
  const at = OBJECTQL_SRC.indexOf(member);
  if (at === -1) return null;
  const before = OBJECTQL_SRC.slice(0, at);
  const close = before.lastIndexOf('*/');
  // Only whitespace may sit between the block and the member, otherwise the
  // block belongs to some earlier member and says nothing about this one.
  if (close === -1 || before.slice(close + 2).trim() !== '') return null;
  const open = before.lastIndexOf('/**', close);
  if (open === -1) return null;
  return before.slice(open, close + 2);
}

describe('ObjectGanttSchema.dependencyField — the TS face declares the deprecation', () => {
  it('the member is unique in the file, so the anchor cannot drift onto a twin', () => {
    // Non-vacuity for every `docBlockBefore(ALIAS)` below: `indexOf` takes the
    // FIRST hit, so a second declaration of the same member would let this suite
    // report on the wrong one.
    expect(OBJECTQL_SRC.split(ALIAS)).toHaveLength(2);
  });

  it('is still declared — deprecating is not deleting', () => {
    expect(OBJECTQL_SRC).toContain(ALIAS);
  });

  it('carries a JSDoc block attached to the member itself', () => {
    expect(docBlockBefore(ALIAS)).not.toBeNull();
  });

  it('tags that block `@deprecated`', () => {
    expect(docBlockBefore(ALIAS)).toContain('@deprecated');
  });

  it('names the canonical spelling, so the marker is actionable', () => {
    // A bare `@deprecated` tells an author to stop, not what to write instead —
    // and "what to write instead" is the entire content of this card.
    expect(docBlockBefore(ALIAS)).toContain('dependenciesField');
  });

  it('says the alias is still READ, so nobody reads the tag as a removal notice', () => {
    expect(docBlockBefore(ALIAS)).toContain('dependenciesField || dependencyField');
  });

  it('does NOT deprecate the canonical key — the control', () => {
    // The tag must be attached to ONE member. If a future edit widened the
    // block, or moved it, the spec's own key would read as deprecated and this
    // card would have inverted its own result.
    const canonicalDoc = docBlockBefore(CANONICAL);
    expect(canonicalDoc).not.toBeNull();
    expect(canonicalDoc).not.toContain('@deprecated ');
    expect(canonicalDoc).toContain('CANONICAL');
  });
});

describe('ObjectGanttSchema.dependencyField — the zod mirror declares it too', () => {
  it('is still declared on the mirror', () => {
    expect(Object.keys(ObjectGanttSchema.shape)).toContain('dependencyField');
  });

  it('its description states the deprecation and names the replacement', () => {
    // Runtime-readable, which is the half a JSDoc cannot give: this string is on
    // the schema object, so a gate or a generated form can ask.
    const description = ObjectGanttSchema.shape.dependencyField.description;
    expect(description).toBeTruthy();
    expect(description).toMatch(/deprecated/i);
    expect(description).toContain('dependenciesField');
  });

  it('follows the ruled idiom rather than a third spelling of "deprecated"', () => {
    // `KanbanConfig`'s pre-#2231 aliases are the shape this adopts. If that
    // convention is ever restated differently, this pin makes the divergence a
    // decision instead of a drift.
    expect(ObjectGanttSchema.shape.dependencyField.description).toMatch(
      /^Deprecated alias for /,
    );
  });

  it('the canonical key is NOT described as deprecated — the control', () => {
    const canonical = ObjectGanttSchema.shape.dependenciesField.description;
    expect(canonical ?? '').not.toMatch(/deprecated/i);
  });
});

describe('ObjectGanttSchema.dependencyField — still ACCEPTED (removal was excluded)', () => {
  const MINIMAL = {
    type: 'object-gantt',
    objectName: 'task',
    startDateField: 'start',
    endDateField: 'end',
  } as const;

  it('parses green when the singular is authored alone', () => {
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, dependencyField: 'preds' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('parses green when both spellings are authored together', () => {
    const result = ObjectGanttSchema.safeParse({
      ...MINIMAL,
      dependencyField: 'preds',
      dependenciesField: 'predecessors',
    });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still TYPE-validates the alias — a deprecated key is not an unchecked one', () => {
    // Counter-probe for the two greens above: it must be the KEY that is
    // accepted, not everything. `dependencyField: 5` was refused before this
    // card and is refused after it.
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, dependencyField: 5 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === 'dependencyField')).toBeTruthy();
  });
});

describe('ObjectGanttSchema.dependencyField — the TS member is unchanged', () => {
  it('is still declared `string | undefined`', () => {
    // Real enforcement: `tsconfig.test.json` compiles this file. When written, a
    // deleted member resolved to `any` through `BaseSchema`'s
    // `[key: string]: any` index signature, the assignment below started
    // succeeding, and the directive failed the build as an unused
    // `@ts-expect-error` (TS2578) — NAMING the removal. Since objectui#8347 a
    // deletion makes the indexed access itself an error: the directive swallows
    // it, and the undirected counter-probe below fails instead. That is the pin against
    // the deprecation quietly becoming the excluded removal.

    // @ts-expect-error — `dependencyField` is declared `string | undefined`.
    const bad: ObjectGanttSchemaTS['dependencyField'] = 5;

    // Counter-probe: without this, a declaration narrowed to `never` would
    // satisfy the directive above while breaking every existing author.
    const good: ObjectGanttSchemaTS['dependencyField'] = 'dependent_task_ids';

    expect([bad, good]).toHaveLength(2);
  });
});
