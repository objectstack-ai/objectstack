/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — `search` and `searchableFields` on `ObjectGanttSchema`
 * (objectui#10250).
 *
 * `ObjectGantt.reload` reads both off the node — the term as `$search`, the
 * field list as `$searchFields` alongside it — because a `ListView` gantt's
 * toolbar Search box can reach the chart's own query through no other door.
 * A key the renderer reads is declared on both faces, so it is validated:
 * `BaseSchema` is `.passthrough()`, so an undeclared key would parse unjudged
 * (and an undeclared read typed as `any` until objectui#8347 removed
 * `[key: string]: any`; it does not compile now).
 *
 * The compile-time half is the `@ts-expect-error` pair at the bottom, which
 * guards each member's TYPE. When written, a dropped declaration made its member
 * resolve to `any` and the unused directive failed `tsc -p tsconfig.test.json`
 * (TS2578); since objectui#8347 the indexed access itself errors, the directive
 * swallows that, and the well-typed counter-probe beside it fails instead.
 *
 * ## ⏱ objectstack#25923 — the pair moved to the hand-off type
 *
 * Only `ListView`'s toolbar writes the pair, at runtime, and
 * `ComponentPropsMap['object-gantt']` refuses both keys on the node: a key only
 * the host writes is typed on the package-local hand-off type, never on the
 * authoring face (ui/AGENTS.md Commandment #0.1). So both left this interface
 * and its mirror for `plugin-gantt`'s `ObjectGanttSearchFields`, where their
 * types are pinned now (`ganttHandoff-25923.test.ts`). The rows below pin
 * the absence; the paragraphs above are objectui#10250's reading, kept as written.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGanttSchema } from '../zod/objectql.zod.js';
import type { ObjectGanttSchema as ObjectGanttSchemaTS } from '../objectql.js';

const MINIMAL = { type: 'object-gantt', objectName: 'task' } as const;

describe('ObjectGanttSchema — the search pair is NOT published (objectstack#25923)', () => {
  it('the mirror declares neither key', () => {
    const shape = Object.keys(ObjectGanttSchema.shape);
    expect(shape).not.toContain('search');
    expect(shape).not.toContain('searchableFields');
    // CONTROL: the shape read is the real one.
    expect(shape).toContain('objectName');
  });

  it('the tolerant mirror no longer examines them: wrong-typed values ride `.passthrough()`', () => {
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, search: 5, searchableFields: 'name' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });
});

describe('ObjectGanttSchema (TS) — the pair is no member of the published interface', () => {
  it('refuses both keys on a fresh literal', () => {
    // @ts-expect-error — `search` lives on plugin-gantt's hand-off type
    const search: ObjectGanttSchemaTS = { ...MINIMAL, search: 'needle' };
    // @ts-expect-error — `searchableFields` lives on plugin-gantt's hand-off type
    const fields: ObjectGanttSchemaTS = { ...MINIMAL, searchableFields: ['name'] };
    // Counter-probe: the literal without them compiles.
    const ok: ObjectGanttSchemaTS = { ...MINIMAL };
    expect([search.type, fields.type, ok.type]).toEqual(['object-gantt', 'object-gantt', 'object-gantt']);
  });
});
