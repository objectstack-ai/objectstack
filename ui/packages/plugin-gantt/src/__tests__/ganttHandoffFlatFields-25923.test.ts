/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25923 — the flat `object-gantt` keys live on THIS package's
 * hand-off type, `ObjectGanttFlatFields`, and nowhere on the published faces.
 *
 * `ComponentPropsMap['object-gantt']` refuses every `GanttConfig` key written
 * flat on the node, plus the legacy `dependencyField` alias and the
 * `search` / `searchableFields` pair only `ListView`'s toolbar writes. Before
 * this card `@object-ui/types` published all 32 on `ObjectGanttSchema` and its
 * mirror; they moved here, beside the one reader (`getGanttConfig`'s flat
 * branch and the fetch path), per ui/AGENTS.md Commandment #0.1. `@object-ui/types`
 * pins the absence (`gantt-flat-config-declared-keys.test.ts` and siblings);
 * this file pins the other half:
 *
 *   1. the hand-off's keys are exactly the `GanttConfig` keys plus the three,
 *      DERIVED, so the flat and block spellings cannot fork;
 *   2. none of them is a member of the published interface (no double home);
 *   3. the renderer's prop is typed with the hand-off, so the flat read compiles
 *      without a cast;
 *   4. the alias keeps its `@deprecated` tag naming the canonical key, and each
 *      of the three keeps its type (the guards `gantt-dependency-field-deprecated-
 *      alias.test.ts` and `gantt-search-keys-10250.test.ts` used to give on the
 *      published face).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { GanttConfig, ObjectGanttSchema } from '@object-ui/types';
import type {
  KnownGanttConfigKey,
  ObjectGanttFlatFields,
  ObjectGanttHandoff,
  ObjectGanttProps,
} from '../ObjectGantt';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type HostOnlyKey = 'dependencyField' | 'search' | 'searchableFields';

export type assertionHandoffIsDerived = [
  // 1. exactly the block's declared keys plus the three host-only ones
  Expect<Equal<keyof ObjectGanttFlatFields, KnownGanttConfigKey | HostOnlyKey>>,
  // …and each block key keeps the block's own type
  Expect<Equal<ObjectGanttFlatFields['colorField'], GanttConfig['colorField'] | undefined>>,
  Expect<Equal<ObjectGanttFlatFields['viewMode'], GanttConfig['viewMode'] | undefined>>,
  // 2. no double home: the published interface declares none of them
  Expect<Equal<Extract<keyof ObjectGanttFlatFields, keyof ObjectGanttSchema>, never>>,
  // 3. the renderer reads the hand-off
  Expect<Equal<ObjectGanttProps['schema'], ObjectGanttHandoff>>,
  // 4. the three keep their types
  Expect<Equal<ObjectGanttFlatFields['dependencyField'], string | undefined>>,
  Expect<Equal<ObjectGanttFlatFields['search'], string | undefined>>,
  Expect<Equal<ObjectGanttFlatFields['searchableFields'], string[] | undefined>>,
];

/** Non-vacuity: the derivation is not `never`/`string`, and the instrument fires. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<KnownGanttConfigKey, never>, false>>,
  Expect<Equal<Equal<KnownGanttConfigKey, string>, false>>,
  Expect<'startDateField' extends KnownGanttConfigKey ? true : false>,
  Expect<Equal<Equal<keyof ObjectGanttFlatFields, KnownGanttConfigKey>, false>>,
];

const SRC = readFileSync(fileURLToPath(new URL('../ObjectGantt.tsx', import.meta.url)), 'utf8');

/** The JSDoc block immediately preceding `member`, or `null`. */
function docBlockBefore(member: string): string | null {
  const at = SRC.indexOf(member);
  if (at === -1) return null;
  const before = SRC.slice(0, at);
  const close = before.lastIndexOf('*/');
  if (close === -1 || before.slice(close + 2).trim() !== '') return null;
  const open = before.lastIndexOf('/**', close);
  return open === -1 ? null : before.slice(open, close + 2);
}

describe('objectstack#25923 — the hand-off type carries the flat keys', () => {
  it('the alias is declared once, tagged @deprecated, naming the canonical key', () => {
    const alias = 'dependencyField?: string;';
    expect(SRC.split(alias)).toHaveLength(2);
    const doc = docBlockBefore(alias);
    expect(doc).toContain('@deprecated');
    expect(doc).toContain('dependenciesField');
  });

  it('the flat branch still reads the alias, after the canonical key', () => {
    expect(SRC).toContain('schema.dependenciesField || schema.dependencyField');
  });

  it('the three keep their types — wrong values are refused, right ones compile', () => {
    // @ts-expect-error — `dependencyField` is `string | undefined`
    const badAlias: ObjectGanttFlatFields = { dependencyField: 5 };
    // @ts-expect-error — `search` is `string | undefined`
    const badSearch: ObjectGanttFlatFields = { search: 5 };
    // @ts-expect-error — `searchableFields` is `string[] | undefined`
    const badFields: ObjectGanttFlatFields = { searchableFields: 'name' };
    // Counter-probe: a narrowing to `never` would satisfy the three directives.
    const ok: ObjectGanttHandoff = {
      type: 'object-gantt',
      objectName: 'task',
      startDateField: 'start',
      endDateField: 'end',
      dependencyField: 'preds',
      search: 'needle',
      searchableFields: ['name'],
    };
    expect([badAlias, badSearch, badFields]).toHaveLength(3);
    expect(ok.dependencyField).toBe('preds');
  });
});
