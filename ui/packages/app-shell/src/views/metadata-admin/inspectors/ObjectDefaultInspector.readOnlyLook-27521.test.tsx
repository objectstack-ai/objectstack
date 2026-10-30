// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27521 (Studio row 34) — on a read-only package the inspectors'
 * text areas look disabled, the way their inputs do.
 *
 * Measured in a Studio browser pass on the read-only showcase package: the
 * object's Description and a field's Description were `disabled` but kept the
 * editable look beside greyed inputs. Those text areas are plain elements, so
 * they carried none of the `disabled:` utilities the shared primitives wear.
 * The expected look is read off the primitive, as the Validations panel's pin
 * (objectui#11781) reads it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Textarea } from '@object-ui/components';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectDefaultInspector } from './ObjectDefaultInspector';
import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

/** The `disabled:` utilities the shared Textarea primitive wears. */
function primitiveDisabledLook(): string[] {
  const { container, unmount } = render(<Textarea disabled />);
  const tokens = (container.querySelector('textarea') as HTMLTextAreaElement).className
    .split(/\s+/)
    .filter((c) => c.startsWith('disabled:'));
  unmount();
  return tokens;
}

const draft = {
  name: 'probe_widget',
  label: 'Probe widget',
  description: 'An object',
  fields: { notes: { type: 'textarea', label: 'Notes', description: 'Free text' } },
};

function expectDisabledLook(container: HTMLElement) {
  const look = primitiveDisabledLook();
  expect(look.length).toBeGreaterThan(0);
  const areas = [...container.querySelectorAll('textarea')];
  // A vacuous pass is not one: the inspector draws at least one text area.
  expect(areas.length).toBeGreaterThan(0);
  for (const el of areas) {
    expect(el).toBeDisabled();
    for (const token of look) expect(el.className.split(/\s+/)).toContain(token);
  }
}

describe('read-only inspector text areas look disabled (objectstack#27521)', () => {
  it('the object inspector’s Description', () => {
    const { container } = render(
      <ObjectDefaultInspector type="object" name="probe_widget" draft={draft} onPatch={() => {}} readOnly locale="en-US" />,
    );
    expectDisabledLook(container);
  });

  it('the field inspector’s text areas', () => {
    const { container } = render(
      <ObjectFieldInspector
        type="object"
        name="probe_widget"
        draft={draft}
        selection={{ kind: 'field', id: 'notes' }}
        onPatch={() => {}}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly
        locale="en-US"
      />,
    );
    expectDisabledLook(container);
  });
});
