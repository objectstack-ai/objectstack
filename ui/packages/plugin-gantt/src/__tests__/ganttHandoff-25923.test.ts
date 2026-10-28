/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25923 — `ObjectGantt`'s node is the published schema plus the two
 * search keys `ListView` writes at runtime, and nothing flat.
 *
 * `ComponentPropsMap['object-gantt']` refuses every `GanttConfig` key written
 * flat on the node, plus the legacy `dependencyField` alias and the
 * `search` / `searchableFields` pair only `ListView`'s toolbar writes. The card
 * first moved all 32 off the published `ObjectGanttSchema` and its mirror onto a
 * package-local hand-off type here, beside the one reader (ui/AGENTS.md
 * Commandment #0.1); `@object-ui/types` pins the absence
 * (`gantt-flat-config-declared-keys.test.ts` and siblings). It then retired
 * `getGanttConfig`'s flat fallback read, once the stored-row census found no
 * stored flat row, so the 30 config keys left the hand-off type too. This file
 * pins what is left:
 *
 *   1. the hand-off adds exactly `search` / `searchableFields`, with their types;
 *   2. neither is a member of the published interface (no double home);
 *   3. the renderer's prop is typed with the hand-off, so the fetch path's read
 *      compiles without a cast;
 *   4. no `GanttConfig` key and no `dependencyField` is typed on the node, and
 *      the source reads neither the alias nor a flat config key off the node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ObjectGanttSchema } from '@object-ui/types';
import type {
  KnownGanttConfigKey,
  ObjectGanttHandoff,
  ObjectGanttProps,
  ObjectGanttSearchFields,
} from '../ObjectGantt';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionHandoffIsTheSearchPair = [
  // 1. exactly the two host-written keys, each with its type
  Expect<Equal<keyof ObjectGanttSearchFields, 'search' | 'searchableFields'>>,
  Expect<Equal<ObjectGanttSearchFields['search'], string | undefined>>,
  Expect<Equal<ObjectGanttSearchFields['searchableFields'], string[] | undefined>>,
  // 2. no double home: the published interface declares neither
  Expect<Equal<Extract<keyof ObjectGanttSearchFields, keyof ObjectGanttSchema>, never>>,
  // 3. the renderer reads the hand-off
  Expect<Equal<ObjectGanttProps['schema'], ObjectGanttHandoff>>,
  // 4. no flat config key and no alias is typed on the node
  Expect<Equal<Extract<keyof ObjectGanttHandoff, KnownGanttConfigKey | 'dependencyField'>, never>>,
];

/** Non-vacuity: the derivation the absence row reads is not `never`/`string`. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<KnownGanttConfigKey, never>, false>>,
  Expect<Equal<Equal<KnownGanttConfigKey, string>, false>>,
  Expect<'startDateField' extends KnownGanttConfigKey ? true : false>,
  // the `gantt` block, the one spelling, IS on the node
  Expect<'gantt' extends keyof ObjectGanttHandoff ? true : false>,
];

const SRC = readFileSync(fileURLToPath(new URL('../ObjectGantt.tsx', import.meta.url)), 'utf8');

describe('objectstack#25923 — the flat fallback read is retired', () => {
  it('the source reads neither the alias nor a flat date key off the node', () => {
    expect(SRC).not.toContain('schema.dependencyField');
    expect(SRC).not.toContain('schema.startDateField');
    expect(SRC).not.toContain('schema.endDateField');
    // Control: the fetch path's read of the hand-off key is spelled the same way.
    expect(SRC).toContain('schema.search');
  });

  it('the two keep their types — wrong values are refused, right ones compile', () => {
    // @ts-expect-error — `search` is `string | undefined`
    const badSearch: ObjectGanttSearchFields = { search: 5 };
    // @ts-expect-error — `searchableFields` is `string[] | undefined`
    const badFields: ObjectGanttSearchFields = { searchableFields: 'name' };
    const flat: ObjectGanttHandoff = {
      type: 'object-gantt',
      objectName: 'task',
      // @ts-expect-error — a flat config key is no member of the node; write `gantt.startDateField`
      startDateField: 'start',
    };
    // Counter-probe: a narrowing to `never` would satisfy the directives above.
    const ok: ObjectGanttHandoff = {
      type: 'object-gantt',
      objectName: 'task',
      gantt: { startDateField: 'start', endDateField: 'end', titleField: 'name' },
      search: 'needle',
      searchableFields: ['name'],
    };
    expect([badSearch, badFields, flat]).toHaveLength(3);
    expect(ok.search).toBe('needle');
  });
});
