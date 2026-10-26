/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// GUARD — a create-form `object` field must render as the object PICKER
// (`widget: 'ref:object'`), never a bare text input. Regression guard for
// objectui#2322: the View createSchema declared `object` as a plain
// `type: 'string'` (no widget), so the create form showed a typo-prone text box
// instead of the object dropdown the Page create form already offered. Reads the
// ACTUAL createSchema from the registry so it can't drift from what the form
// renders, and covers every authorable type at once so the same asymmetry
// (one type gets the picker, a sibling silently doesn't) can't reappear.

import { describe, it, expect } from 'vitest';
import { registerBuiltinAnchors } from './anchors';
import { listMetadataResources } from './registry';

registerBuiltinAnchors();

type SchemaProp = { widget?: unknown };

// Every create form that binds a new record to an existing object exposes that
// choice as an `object` create field. Collect them straight from the registry.
const withObjectCreateField = listMetadataResources()
  .map((cfg) => {
    const props = (cfg.createSchema as { properties?: Record<string, SchemaProp> } | undefined)
      ?.properties;
    return { type: cfg.type, objectProp: props?.object };
  })
  .filter((r): r is { type: string; objectProp: SchemaProp } => r.objectProp !== undefined);

describe("createSchema `object` field uses the ref:object picker (objectui#2322)", () => {
  it('discovers the object-binding create forms (no silent cap)', () => {
    const types = withObjectCreateField.map((r) => r.type).sort();
    console.log(`[create-object-widget] object-binding create forms: ${types.join(', ')}`);
    // page + view both bind to an object — the guard below must actually cover them.
    expect(types).toEqual(expect.arrayContaining(['page', 'view']));
  });

  for (const { type, objectProp } of withObjectCreateField) {
    it(`${type}: createSchema.object declares widget 'ref:object'`, () => {
      expect(
        objectProp.widget,
        `${type} create form renders 'object' as a plain text input — add widget: 'ref:object' so it picks from existing objects`,
      ).toBe('ref:object');
    });
  }
});
