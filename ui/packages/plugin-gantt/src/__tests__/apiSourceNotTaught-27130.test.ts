/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27130 — the `object-gantt` registration teaches no view-level
 * `api` record source.
 *
 * The view-level `api` data source is retired in `@objectstack/spec`
 * (objectstack#23082): the spec refuses `data: { provider: 'api', … }` by name,
 * and `resolveDataSource` has no `api` arm, so a gantt still carrying one never
 * requests its `read` / `write` URLs (behaviour pinned by
 * `recordSourceInputs-10394.test.tsx`, its "retired api block" row). The
 * registration's `data` and `filter` descriptions still named it as a live
 * record source, and that published text is what an author copied. Rows a
 * server computes reach the gantt as an object behind a plugin driver.
 *
 * The pin reads the registered inputs, which feed `sdui.manifest.json` and the
 * generated component reference, so one row covers all three.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

/** `provider: 'api'` in any quoting, or an `api` request/source named in code font. */
const TEACHES_API_SOURCE = /provider:\s*\\?['"]api\\?['"]|`api`/;

const descriptions = (): Array<[string, string]> =>
  (((ComponentRegistry.getConfig('object-gantt', 'plugin-gantt') as any)?.inputs ?? []) as any[]).map(
    (input) => [input.name, String(input.description ?? '')],
  );

describe('objectstack#27130 — object-gantt teaches no retired api record source', () => {
  it('control: the matcher fires on the text it replaced', () => {
    expect("`{ provider: \\'api\\', read }` reads through that request").toMatch(TEACHES_API_SOURCE);
    expect("`{ provider: 'api', read }` reads through that request").toMatch(TEACHES_API_SOURCE);
    expect('the object, an `api` request, or inline rows').toMatch(TEACHES_API_SOURCE);
  });

  it('no input description names a provider: api record source', () => {
    const rows = descriptions();
    expect(rows.map(([name]) => name)).toEqual(expect.arrayContaining(['data', 'filter']));
    expect(rows.filter(([, text]) => TEACHES_API_SOURCE.test(text)).map(([name]) => name)).toEqual([]);
  });

  it('positive control: data still names the object and value providers', () => {
    const data = new Map(descriptions()).get('data') ?? '';
    expect(data).toContain("`{ provider: 'object', object }`");
    expect(data).toContain("`{ provider: 'value', items }`");
  });
});
