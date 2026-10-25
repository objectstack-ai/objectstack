/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form renderer hands data-source widgets the LABELS of the sibling fields
 * whose VALUES it already hands them — objectstack#5407.
 *
 * A dependency-gated lookup has to name its controlling field in user-visible
 * copy ("Select Account first"), but the widget only ever sees `dependsOn`,
 * which holds API names. Only the form knows the label. It already resolves
 * exactly this map for the fixed-option widgets (`emptyHint`); the lookup side
 * had no equivalent, so the gate sentence interpolated `crm_account` into every
 * locale, English included.
 *
 * This pins the PLUMBING (form → widget prop). The widget's own use of the map
 * is pinned in `packages/fields`' `LookupField.gateHintLabel.test.tsx`; the two
 * halves are asserted separately because `@object-ui/components` cannot import
 * `@object-ui/fields` (that is the dependency direction, not a test shortcut).
 *
 * The strip half matters as much as the pass half: `stripRegisteredFieldProps`
 * allow-lists these props precisely so an unknown object prop cannot reach a
 * DOM node through a widget's `...props` spread — a React warning, and the
 * reason `emptyHint` is allow-listed rather than passed unconditionally.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
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

beforeAll(() => {
  // `field:lookup` is contributed by `@object-ui/fields`, which this package
  // does not (and must not) depend on — so registering a stub here shadows
  // nothing and leaks into no other suite.
  ComponentRegistry.register('field:lookup', makeStub('lookup'));
  ComponentRegistry.register('field:tags', makeStub('tags'));
});

afterEach(() => cleanup());

const fields = [
  { name: 'crm_account', label: 'Account', type: 'input' },
  {
    name: 'contact',
    label: 'Contact',
    type: 'lookup',
    field: { name: 'contact', reference: 'crm_contact', dependsOn: ['crm_account'] },
  },
  // A widget outside the data-source family, to pin the strip half.
  { name: 'topics', label: 'Topics', type: 'tags' },
];

function renderForm() {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
  );
}

describe('form renderer — dependsOnLabels plumbing (objectstack#5407)', () => {
  it('passes a data-source widget the sibling field name → label map', () => {
    renderForm();

    expect(seen.lookup.dependsOnLabels).toEqual(
      expect.objectContaining({ crm_account: 'Account', contact: 'Contact' }),
    );
  });

  it('keys the map by API name, so the widget can resolve its own dependsOn', () => {
    renderForm();

    // The exact lookup the widget performs. Written as the resolution rather
    // than as a shape assertion, because the shape is only useful if this
    // reads back the label.
    const depends = 'crm_account';
    expect(seen.lookup.dependsOnLabels[depends]).toBe('Account');
  });

  it('falls back to the field name for a field that declared no label', () => {
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            { name: 'crm_account', type: 'input' },
            {
              name: 'contact',
              type: 'lookup',
              field: { name: 'contact', dependsOn: ['crm_account'] },
            },
          ],
        }}
      />,
    );

    // No label authored → the map still answers, with the name. The widget's
    // own `|| d.field` fallback therefore never has to fire for a field the
    // form knows about.
    expect(seen.lookup.dependsOnLabels.crm_account).toBe('crm_account');
  });

  it('strips the map for widgets outside the data-source family', () => {
    renderForm();

    // `tags` spreads its leftover props onto a DOM node; an object-valued
    // `dependsOnLabels` attribute there is a React warning.
    expect(seen.tags).toBeDefined();
    expect(seen.tags.dependsOnLabels).toBeUndefined();
  });

  it('strips the map before the BUILTIN branch reaches the DOM', () => {
    // The builtin types (`input`/`textarea`/`checkbox`/`switch`/`select`) never
    // pass through `stripRegisteredFieldProps` — they render their control
    // directly and spread what is left onto it. `stripRendererOnlyProps` is the
    // strip that covers them, and it was the one this prop was first missing:
    // every plain text field on every form logged "React does not recognize the
    // `dependsOnLabels` prop on a DOM element".
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    try {
      const Form = ComponentRegistry.get('form')!;
      const { container } = render(
        <Form
          schema={{
            type: 'form',
            showSubmit: false,
            showCancel: false,
            fields: [{ name: 'subject', label: 'Subject', type: 'input' }],
          }}
        />,
      );

      const input = container.querySelector('input')!;
      expect(input).not.toBeNull();
      expect(input.getAttributeNames().map((n) => n.toLowerCase())).not.toContain(
        'dependsonlabels',
      );
      expect(
        errors.filter((e) => e.some((a) => String(a).includes('dependsOnLabels'))),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
