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
 * ## ⏱ objectstack#25923 — both spellings LEFT the published faces
 *
 * `ComponentPropsMap['object-gantt']` refuses `dependenciesField` and
 * `dependencyField` written flat on the node, so neither stays a member of the
 * published interface or its mirror. The alias then lived on `plugin-gantt`'s
 * package-local hand-off type until the same card retired the flat fallback
 * read, and the alias with it: no reader is left, so failure mode (2) above has
 * nothing left to guard (`plugin-gantt`'s `ganttHandoff-25923.test.ts` pins the
 * absence there). What this file pins now is the absence on both published
 * faces, which is the narrowing the card shipped.
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

/** The alias member, as `objectql.ts` spelled it until objectstack#25923. */
const ALIAS = 'dependencyField?: string;';
/** The canonical member, as `objectql.ts` spelled it until objectstack#25923. */
const CANONICAL = "dependenciesField?: GanttConfig['dependenciesField'];";

const MINIMAL = { type: 'object-gantt', objectName: 'task' } as const;

describe('ObjectGanttSchema — neither dependencies spelling is published flat (objectstack#25923)', () => {
  it('the TS face declares neither member', () => {
    expect(OBJECTQL_SRC).not.toContain(ALIAS);
    expect(OBJECTQL_SRC).not.toContain(CANONICAL);
    // CONTROL: the block that now carries the canonical key is declared, and
    // the source read is the real file.
    expect(OBJECTQL_SRC).toContain('export interface ObjectGanttSchema');
    expect(OBJECTQL_SRC).toMatch(/\bgantt\?: GanttConfig;/);
  });

  it('the zod mirror declares neither key, and declares the block', () => {
    const shape = Object.keys(ObjectGanttSchema.shape);
    expect(shape).not.toContain('dependencyField');
    expect(shape).not.toContain('dependenciesField');
    expect(shape).toContain('gantt');
  });

  it('the tolerant mirror no longer examines the alias: `dependencyField: 5` rides `.passthrough()`', () => {
    // Stated so nobody reads the mirror as judging it still (objectui#5155).
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, dependencyField: 5 });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('the canonical key is validated inside the `gantt` block, the one spelling left', () => {
    const block = { startDateField: 'start', endDateField: 'end', titleField: 'name' };
    const good = ObjectGanttSchema.safeParse({ ...MINIMAL, gantt: { ...block, dependenciesField: 'preds' } });
    expect(good.success ? null : good.error.issues).toBe(null);
    const bad = ObjectGanttSchema.safeParse({ ...MINIMAL, gantt: { ...block, dependenciesField: 5 } });
    expect(bad.success).toBe(false);
  });

  it('the TS face refuses either spelling on a fresh literal', () => {
    // @ts-expect-error — `dependencyField` is no member of the published interface
    const alias: ObjectGanttSchemaTS = { ...MINIMAL, dependencyField: 'preds' };
    // @ts-expect-error — `dependenciesField` is written in the `gantt` block
    const canonical: ObjectGanttSchemaTS = { ...MINIMAL, dependenciesField: 'preds' };
    // Counter-probe: the same key inside the block compiles.
    const ok: ObjectGanttSchemaTS = {
      ...MINIMAL,
      gantt: { startDateField: 'start', endDateField: 'end', titleField: 'name', dependenciesField: 'preds' },
    };
    expect([alias.type, canonical.type, ok.gantt?.dependenciesField]).toEqual(['object-gantt', 'object-gantt', 'preds']);
  });
});
