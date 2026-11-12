/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32770 — which widgets the form renderer hands its sibling writer
 * (`onAutofill`) to, and on which form.
 *
 * `permission-ref` writes the package of the permission-set holder it picked
 * into the grant's package column, which the server takes from an insert
 * alone. So the renderer hands it the writer on a CREATE form only — a form
 * with no `previousValues` — and an edit form hands it none. The relationship
 * pickers (`lookup`, `master_detail`) keep theirs on every form, and every
 * other widget still gets no such prop at all.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — see
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

const STUBBED = ['permission-ref', 'position-ref', 'lookup', 'master_detail', 'tags'];

beforeAll(() => {
  // These `field:*` ids are contributed by `@object-ui/fields`, which this
  // package does not depend on — so the stubs shadow nothing.
  for (const type of STUBBED) ComponentRegistry.register(`field:${type}`, makeStub(type));
});

afterEach(() => {
  cleanup();
  for (const key of Object.keys(seen)) delete seen[key];
});

const dataSource = { find: async () => ({ data: [] }) };

function renderForm(previousValues?: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <SchemaRendererContext.Provider value={{ dataSource } as any}>
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          ...(previousValues ? { previousValues, defaultValues: previousValues } : {}),
          fields: STUBBED.map((t) => ({
            name: t === 'permission-ref' ? 'permission_set' : `f_${t.replace('-', '_')}`,
            label: `F ${t}`,
            type: `field:${t}`,
            field: { name: t === 'permission-ref' ? 'permission_set' : `f_${t.replace('-', '_')}` },
          })),
        }}
      />
    </SchemaRendererContext.Provider>,
  );
}

describe('form renderer — the create-only sibling writer (objectstack#32770)', () => {
  it('a create form hands permission-ref the writer, beside the relationship pickers', () => {
    renderForm();
    expect(typeof seen['permission-ref']?.onAutofill).toBe('function');
    expect(typeof seen.lookup?.onAutofill).toBe('function');
    expect(typeof seen.master_detail?.onAutofill).toBe('function');
  });

  it('an edit form hands permission-ref none, and the relationship pickers keep theirs (CONTROL)', () => {
    renderForm({ id: 'g1', permission_set: 'sales_user', permission_set_package: 'com.acme.crm' });
    expect(seen['permission-ref']).toBeDefined();
    expect('onAutofill' in seen['permission-ref']).toBe(false);
    expect(typeof seen.lookup?.onAutofill).toBe('function');
    expect(typeof seen.master_detail?.onAutofill).toBe('function');
  });

  it('every other widget gets no writer prop on either form (CONTROL)', () => {
    renderForm();
    expect('onAutofill' in seen['position-ref']).toBe(false);
    expect('onAutofill' in seen.tags).toBe(false);
    cleanup();

    renderForm({ id: 'g1' });
    expect('onAutofill' in seen['position-ref']).toBe(false);
    expect('onAutofill' in seen.tags).toBe(false);
  });

  it("the writer sets the sibling column, which the widget then reads back from the form's record", () => {
    renderForm();
    act(() => {
      seen['permission-ref'].onAutofill({ permission_set_package: 'com.acme.crm' });
    });
    expect(seen['permission-ref'].dependentValues).toEqual(
      expect.objectContaining({ permission_set_package: 'com.acme.crm' }),
    );

    act(() => {
      seen['permission-ref'].onAutofill({ permission_set_package: null });
    });
    expect(seen['permission-ref'].dependentValues?.permission_set_package ?? null).toBeNull();
  });

  it("an edit form reads the stored package back to the widget, which it cannot rewrite", () => {
    renderForm({ id: 'g1', permission_set: 'sales_user', permission_set_package: 'com.acme.crm' });
    expect(seen['permission-ref'].dependentValues).toEqual(
      expect.objectContaining({ permission_set_package: 'com.acme.crm' }),
    );
  });
});
