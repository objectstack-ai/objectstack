// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#37615) — `os init -t app` places its item's fields the way
 * `os g object` and the `npm create objectstack` starter do: through the
 * `details` group's own `fields` list, after the field map, and never through
 * a per-field `group`.
 *
 * #32153 promised a newcomer one field-placement dialect. After `os g object`
 * moved to the group's `fields` list, the `app` template's item object still
 * wrote `fieldGroups: [{ key: 'details', label: 'Details' }]` and
 * `group: 'details'` on each field, so the CLI wrote two dialects. Both
 * spellings mean the same placement; this file pins the one the scaffolds
 * teach.
 */

import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/commands/init';

const ITEM_OBJECT = 'src/objects/__name___item.object.ts';

function renderItemObject(): string {
  const render = TEMPLATES.app.srcFiles[ITEM_OBJECT];
  expect(render, `the app template renders ${ITEM_OBJECT}`).toBeTypeOf('function');
  return render('my-app', 'my_app');
}

describe('[#37615] `os init -t app` item object field placement', () => {
  it('writes no per-field `group`', () => {
    expect(renderItemObject()).not.toMatch(/^ +group: '/m);
  });

  it("lists every declared field in the details group's `fields`, after the field map", () => {
    const source = renderItemObject();
    const declared = [...source.matchAll(/^ {4}([a-z_][a-z0-9_]*): Field\./gm)].map((m) => m[1]);
    expect(declared).toEqual(['name', 'description', 'status']);

    const group = source.match(/\{ key: 'details', label: 'Details', fields: \[([^\]]*)\] \}/);
    expect(group, 'the details group carries a `fields` list').not.toBeNull();
    const listed = [...group![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed).toEqual(declared);

    expect(source.indexOf('fieldGroups:')).toBeGreaterThan(source.indexOf('fields: {'));
  });
});
