/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-model-designer` DRAWS the members objectui#11434 ruled READ.
 *
 * The card's measurement found `DataModelField`'s `label`, `unique`,
 * `defaultValue` and `description` declared on both faces of `@object-ui/types`
 * and drawn by nothing, and the relationship line drawn centre to centre
 * whatever `sourceField` / `targetField` said. The seat ruled each READ (the
 * mainstream ER designers draw all of them), and ruled
 * `DataModelRelationship.onDelete` RESPELLED as `deleteBehavior`, in
 * `@objectstack/spec`'s vocabulary.
 *
 * "Read" is measured the way the card measured "unread": a render probe
 * through the real `SchemaRenderer` and the real registry, one document with
 * the member and one without it, compared as drawn markup. A member the
 * component does not draw renders identical markup both ways. On top of that
 * diff, each row names WHAT is drawn, so a change that draws the member
 * somewhere meaningless still fails.
 *
 * `sourceField` and `targetField` are REQUIRED, so they have no "unset"
 * document: their probe moves the value from one field to another and pins
 * the line's end at that field's row, and the unresolved-name row pins the
 * fallback.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import '../index';

type Doc = Record<string, unknown>;

afterEach(() => cleanup());

const ACCOUNT = {
  id: 'account',
  name: 'account',
  label: 'Account',
  position: { x: 40, y: 40 },
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'name', type: 'text' },
    { name: 'code', type: 'text' },
  ],
};
const CONTACT = {
  id: 'contact',
  name: 'contact',
  label: 'Contact',
  position: { x: 400, y: 40 },
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'email', type: 'email' },
    { name: 'account_id', type: 'lookup' },
  ],
};
const RELATIONSHIP = {
  id: 'r1',
  sourceEntity: 'account',
  sourceField: 'id',
  targetEntity: 'contact',
  targetField: 'account_id',
  type: 'one-to-many',
  label: 'has',
};

function doc(overrides: { field?: Doc; relationship?: Doc } = {}): Doc {
  const account = {
    ...ACCOUNT,
    fields: ACCOUNT.fields.map((f, i) => (i === 1 ? { ...f, ...overrides.field } : f)),
  };
  return {
    type: 'data-model-designer',
    entities: [account, CONTACT],
    relationships: [{ ...RELATIONSHIP, ...overrides.relationship }],
  };
}

function mount(node: Doc) {
  return render(<SchemaRenderer schema={node as never} />);
}

/** The drawn markup, with React's generated ids normalised away. */
function drawn(node: Doc): string {
  const { container, unmount } = mount(node);
  const html = container.innerHTML.replace(/:r[0-9a-z]+:/g, ':rID:').replace(/«r[0-9a-z]+»/g, '«rID»');
  unmount();
  return html;
}

const byTestId = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`);
const linePath = (root: ParentNode) => byTestId(root, 'relationship-r1')?.querySelector('path')?.getAttribute('d');
const lineTitle = (root: ParentNode) => byTestId(root, 'relationship-r1')?.querySelector('title')?.textContent;

/*
 * Geometry the expected line ends are computed from — the card's fixed-height
 * classes: a 2px border, a 36px header, 4px of list padding and 24px rows. A
 * row's centre is y + 2 + 36 + 4 + 24·i + 12 = y + 54 + 24·i; the header's is
 * y + 2 + 18 = y + 20. Account sits at x 40 (right edge 280), Contact at x 400.
 */
const ROW = (i: number) => 40 + 54 + 24 * i;
const HEADER = 40 + 20;

describe('DataModelField members are drawn on their row (objectui#11434)', () => {
  it('`label` is drawn beside the field name', () => {
    expect(drawn(doc({ field: { label: 'Display name' } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ field: { label: 'Display name' } }));
    expect(byTestId(container, 'field-label-account-1')?.textContent).toBe('Display name');
    cleanup();
    expect(byTestId(mount(doc()).container, 'field-label-account-1')).toBeNull();
  });

  it('`unique` is drawn as a UQ badge', () => {
    expect(drawn(doc({ field: { unique: true } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ field: { unique: true } }));
    expect(byTestId(container, 'field-unique-account-1')?.textContent).toBe('UQ');
    cleanup();
    expect(byTestId(mount(doc({ field: { unique: false } })).container, 'field-unique-account-1')).toBeNull();
  });

  it('`defaultValue` is drawn after the type, as JSON', () => {
    expect(drawn(doc({ field: { defaultValue: 'draft' } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ field: { defaultValue: 'draft' } }));
    expect(byTestId(container, 'field-default-account-1')?.textContent).toBe('= "draft"');
    expect(byTestId(container, 'field-row-account-1')?.getAttribute('title')).toBe('Default: "draft"');
    cleanup();
    // `null` is a value, and it is drawn; only an absent default draws nothing.
    expect(byTestId(mount(doc({ field: { defaultValue: null } })).container, 'field-default-account-1')?.textContent).toBe('= null');
    cleanup();
    expect(byTestId(mount(doc()).container, 'field-default-account-1')).toBeNull();
  });

  it('`description` is the row tooltip', () => {
    expect(drawn(doc({ field: { description: 'Legal name' } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ field: { description: 'Legal name', defaultValue: 0 } }));
    expect(byTestId(container, 'field-row-account-1')?.getAttribute('title')).toBe('Legal name\nDefault: 0');
    cleanup();
    expect(byTestId(mount(doc()).container, 'field-row-account-1')?.hasAttribute('title')).toBe(false);
  });
});

describe('the relationship line runs between the rows its fields name (objectui#11434)', () => {
  it('anchors at the `sourceField` and `targetField` rows', () => {
    const { container } = mount(doc());
    expect(linePath(container)).toBe(`M 280 ${ROW(0)} L 400 ${ROW(2)}`);
    expect(lineTitle(container)).toBe('Account.id → Contact.account_id');
  });

  it('moving `sourceField` moves the line\'s source end to that row', () => {
    expect(drawn(doc({ relationship: { sourceField: 'code' } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ relationship: { sourceField: 'code' } }));
    expect(linePath(container)).toBe(`M 280 ${ROW(2)} L 400 ${ROW(2)}`);
  });

  it('moving `targetField` moves the line\'s target end to that row', () => {
    expect(drawn(doc({ relationship: { targetField: 'email' } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ relationship: { targetField: 'email' } }));
    expect(linePath(container)).toBe(`M 280 ${ROW(0)} L 400 ${ROW(1)}`);
  });

  it('a field name the entity does not declare anchors at its header, and the tooltip says so', () => {
    const { container } = mount(doc({ relationship: { sourceField: 'nope' } }));
    expect(linePath(container)).toBe(`M 280 ${HEADER} L 400 ${ROW(2)}`);
    expect(lineTitle(container)).toContain('Account has no field "nope"');
  });

  it('renaming a field on the canvas renames it in the relationship, so the line stays on the row', () => {
    const { container } = mount(doc());
    const nameCell = byTestId(container, 'field-row-account-0')?.querySelector('[title="Click to edit field name"]');
    expect(nameCell).toBeTruthy();
    act(() => {
      fireEvent.click(nameCell as Element);
    });
    const input = byTestId(container, 'field-row-account-0')?.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      fireEvent.change(input, { target: { value: 'account_key' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(linePath(container)).toBe(`M 280 ${ROW(0)} L 400 ${ROW(2)}`);
    expect(lineTitle(container)).toBe('Account.account_key → Contact.account_id');
  });
});

describe('`deleteBehavior` is drawn; the respelled `onDelete` is not (objectui#11434)', () => {
  it('`deleteBehavior` is drawn beside the label and in the line tooltip', () => {
    expect(drawn(doc({ relationship: { deleteBehavior: 'cascade' } }))).not.toBe(drawn(doc()));
    const { container } = mount(doc({ relationship: { deleteBehavior: 'cascade' } }));
    expect(byTestId(container, 'relationship-delete-behavior-r1')?.textContent).toBe('on delete: cascade');
    expect(lineTitle(container)).toBe('Account.id → Contact.account_id · on delete: cascade');
  });

  it('`onDelete` reaches the component as a prop and draws nothing — no alias reads the old spelling', () => {
    expect(drawn(doc({ relationship: { onDelete: 'cascade' } }))).toBe(drawn(doc()));
  });
});
