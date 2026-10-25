/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which widgets the form renderer threads `dataSource` / `dependentValues` /
 * `dependsOnLabels` to — objectui#4790.
 *
 * The rule has two halves and only one of them belongs to this package:
 *
 *  - the reference-bearing field family, which is `EXPANDABLE_FIELD_TYPES` in
 *    `@object-ui/core` — the same set the `$expand` builder and predicate-record
 *    projection read;
 *  - three widget-hint-only pickers (`object-ref` / `filter-condition` /
 *    `recipient-picker`) that no object schema can ever declare as a field
 *    `type`, so they cannot live in the core set.
 *
 * This renderer used to restate the first half as a private `Set`, with the core
 * side's TSDoc claiming the two "mirror" each other. They stopped mirroring on
 * 2026-07-13 and no gate could say so: `user` was in core only, the three picker
 * names here only. The membership assertions below pass against ANY set holding
 * the right members — including a re-inlined private copy — so they cannot
 * report that failure mode on their own. The identity pin at the bottom is what
 * does, exactly as in objectui#4770 / PR #4789.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry, EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

/** Props each stub widget saw on its last render, keyed by registry type. */
const seen: Record<string, any> = {};

function makeStub(type: string) {
  return function Stub(props: any) {
    seen[type] = props;
    return <div data-testid={`stub-${type}`} />;
  };
}

/** Widget-hint-only pickers — the form-specific half of the rule. */
const PICKER_WIDGET_TYPES = [
  'object-ref', 'filter-condition', 'recipient-picker',
  // objectui#7611: the registry-name pickers.
  'position-ref', 'permission-ref',
];

/**
 * Stubs for the whole rule, DERIVED from the core set rather than retyped: a
 * member added to `EXPANDABLE_FIELD_TYPES` tomorrow is covered here without
 * anyone remembering to add it, which is the point of the exercise.
 */
beforeAll(() => {
  // These `field:*` ids are contributed by `@object-ui/fields`, which this
  // package does not (and must not) depend on — so the stubs shadow nothing.
  for (const type of [...EXPANDABLE_FIELD_TYPES, ...PICKER_WIDGET_TYPES]) {
    ComponentRegistry.register(`field:${type}`, makeStub(type));
  }
  // A widget outside the family, to pin the strip half.
  ComponentRegistry.register('field:tags', makeStub('tags'));
});

afterEach(() => cleanup());

const dataSource = { find: async () => ({ data: [] }) };

/**
 * The renderer takes the `DataSource` from `SchemaRendererContext`, not from a
 * prop on the form (`form.tsx`: `schemaCtx?.dataSource ?? null`) — so the
 * provider is the realistic wiring, and rendering without it would assert
 * `null === null` and pass for the wrong reason.
 */
function renderWith(fieldTypes: string[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <SchemaRendererContext.Provider value={{ dataSource } as any}>
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            { name: 'parent', label: 'Parent', type: 'input' },
            ...fieldTypes.map((t) => ({
              name: `f_${t}`,
              label: `F ${t}`,
              type: `field:${t}`,
              field: { name: `f_${t}`, dependsOn: ['parent'] },
            })),
          ],
        }}
      />
    </SchemaRendererContext.Provider>,
  );
}

describe('form renderer — data-source wiring covers the core reference family', () => {
  it('threads all three props to every EXPANDABLE_FIELD_TYPES member', () => {
    const members = [...EXPANDABLE_FIELD_TYPES];
    renderWith(members);

    for (const type of members) {
      expect(seen[type], `${type} never rendered`).toBeDefined();
      expect(seen[type].dataSource, `${type} lost dataSource`).toBe(dataSource);
      expect(seen[type].dependentValues, `${type} lost dependentValues`).toBeDefined();
      expect(seen[type].dependsOnLabels, `${type} lost dependsOnLabels`).toEqual(
        expect.objectContaining({ parent: 'Parent' }),
      );
    }
  });

  it('threads them to `user` — the member the private copy never had', () => {
    // Before objectui#4790 a `user` field received NONE of the three. ONE of
    // them — `dataSource` — has a `SchemaRendererContext` fallback inside the
    // widget, so the person picker limped along; `dependentValues` and
    // `dependsOnLabels` have none, so a dependency-gated user picker was left
    // unscoped AND interpolated the raw API name into its "select … first" hint
    // — the leak objectstack#5407 closed for lookups and left open here.
    //
    // ⚠️ This used to credit two of the three with a context fallback. The
    // widgets spelled one for `dependentValues` (`?? ctx.formValues ?? ctx.data`)
    // while `SchemaRendererContextType` declares exactly `dataSource` / `debug` /
    // `debugFlags` / `apiFetch`, so it was unconditionally empty and has since
    // been retired (objectui#7206). `user` is also named in the widget contract's own
    // `dataSource` doc (`fields/src/widgets/types.ts`) as a type this renderer
    // injects for, so the omission contradicted the published contract too.
    expect(EXPANDABLE_FIELD_TYPES.has('user')).toBe(true);
    renderWith(['user']);

    expect(seen.user.dataSource).toBe(dataSource);
    expect(seen.user.dependentValues).toBeDefined();
    expect(seen.user.dependsOnLabels).toEqual(expect.objectContaining({ parent: 'Parent' }));
  });

  it('still threads them to the widget-hint-only pickers', () => {
    // The form-specific half. These are reached only through a `widget:` hint
    // (`widgetHintOnly: true`, `app-shell/src/utils/paramValueShape.ts`), so
    // they can never move into the core schema-type set.
    renderWith(PICKER_WIDGET_TYPES);

    for (const type of PICKER_WIDGET_TYPES) {
      expect(seen[type], `${type} never rendered`).toBeDefined();
      expect(seen[type].dataSource, `${type} lost dataSource`).toBe(dataSource);
      expect(seen[type].dependentValues, `${type} lost dependentValues`).toBeDefined();
    }
  });

  it('strips all three for a widget outside the family', () => {
    // `tags` spreads its leftover props onto a DOM node, where an object-valued
    // prop is a React warning — which is why this is an allow-list, not a
    // blanket pass-through.
    renderWith(['tags']);

    expect(seen.tags).toBeDefined();
    expect(seen.tags.dataSource).toBeUndefined();
    expect(seen.tags.dependentValues).toBeUndefined();
    expect(seen.tags.dependsOnLabels).toBeUndefined();
  });
});

describe('form renderer — the reference half is the SHARED object (objectui#4790)', () => {
  it('asks @object-ui/core EXPANDABLE_FIELD_TYPES which fields get a dataSource', () => {
    // Identity, not membership — the same pin shape the cascade allow-table
    // carries (`form-dependent-values.test.tsx`, objectui#4770). Every
    // assertion above is satisfied by a private copy holding the same seven
    // strings, which is precisely the state objectui#4790 closed. The spy is
    // installed on the Set object exported by `@object-ui/core`; it records a
    // call only if this renderer consulted THAT object.
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      renderWith(['lookup']);
      // The form normalizes `field:lookup` to `lookup` BEFORE the lookup, so
      // the key reaching the shared set is the widget key, which coincides with
      // the schema-type spelling the set is defined on.
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });
});
