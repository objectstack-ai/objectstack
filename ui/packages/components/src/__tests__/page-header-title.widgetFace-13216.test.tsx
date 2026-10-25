/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page H1 draws a widget-hinted `nameField` through its face
 * (objectui#13216).
 *
 * ## The defect
 *
 * `sys_record_share` declares `nameField: 'recipient_id'`, and that field
 * declares `widget: 'recipient-picker'` with `dependsOn: ['recipient_type']`.
 * `page:header`'s declared-pointer rung printed the field's stored text, so a
 * record share's H1 was the recipient's raw user id while every list column
 * drew the same value through the registry's face as the user's name.
 *
 * ## What is pinned
 *
 * The heading asks the field-face seam (`setFieldReadFaceResolver` /
 * `resolveFieldReadFace`) for the pointer field's face, the slot
 * `@object-ui/fields` fills when it loads. This package cannot load that
 * registry, so these pins install a resolver standing in for it, one that
 * answers a face only for a declared `recipient-picker` widget and names a
 * user id from the row's `recipient_type`, as the registry's face does.
 *
 * - THE CARD: the pointer field declares the widget, so the H1 draws the face's
 *   text (the user's name), never the stored id; the face gets the field's
 *   declaration and the whole record, so `recipient_type` reaches it.
 * - CONTROLS, each heading exactly as before: a plain text `nameField`, a
 *   select `nameField` (objectui#13103), a title template, a record with no
 *   `nameField`, an explicit `title`, an empty pointer value, and a host where
 *   no resolver is installed.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope, NOT inside a `beforeAll` (see
// page-header-title.oneInterpolator-10447.test.tsx).
import '../renderers';
import { setFieldReadFaceResolver, type FieldReadFaceProps } from '../lib/field-face';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

/** Render the real `page:header` for one record and return its H1. */
function h1Of(objectSchema: any, record: any, schema: any = { type: 'page:header' }): HTMLElement | null {
  const { container } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName={objectSchema.name}
        recordId={record.id}
        data={record}
        objectSchema={objectSchema}
      >
        <PageHeader schema={schema} />
      </RecordContextProvider>
    </ActionProvider>,
  );
  return container.querySelector('h1');
}

/** The user directory the stand-in face names a `user` recipient from. */
const USERS: Record<string, string> = { usr_9f3: 'Ada Lovelace' };

/** Every call the stand-in face received, so a pin can read its inputs. */
const faceCalls: FieldReadFaceProps[] = [];

/** Stands in for the registry's `recipient-picker` face. */
function RecipientFace(props: FieldReadFaceProps) {
  faceCalls.push(props);
  const kind = props.dependentValues?.recipient_type;
  const label = kind === 'user' ? USERS[String(props.value)] : undefined;
  return <span data-testid="recipient-face">{label ?? String(props.value)}</span>;
}

/** Stands in for `@object-ui/fields`' resolver: a face for the one widget only. */
const resolveRecipientFace = (field: any) =>
  field?.widget === 'recipient-picker' ? RecipientFace : undefined;

afterEach(() => {
  cleanup();
  setFieldReadFaceResolver(undefined);
  faceCalls.length = 0;
});

const recordShare = (extra: Record<string, unknown> = {}) => ({
  name: 'sys_record_share',
  label: 'Record Share',
  nameField: 'recipient_id',
  fields: {
    record_id: { type: 'text', label: 'Record' },
    recipient_type: {
      type: 'select',
      label: 'Recipient Type',
      options: [
        { value: 'user', label: 'User' },
        { value: 'group', label: 'Group' },
      ],
    },
    recipient_id: {
      type: 'text',
      label: 'Recipient',
      widget: 'recipient-picker',
      dependsOn: ['recipient_type'],
    },
  },
  ...extra,
});

const share = { id: 'shr_1', record_id: 'acc_7', recipient_type: 'user', recipient_id: 'usr_9f3' };

describe('page:header H1 — a widget-hinted nameField heads the page through its face (#13216)', () => {
  it("THE CARD — a `recipient-picker` nameField heads with the face's name, not the stored id", () => {
    setFieldReadFaceResolver(resolveRecipientFace);

    const h1 = h1Of(recordShare(), share);

    expect(h1?.textContent).toBe('Ada Lovelace');
    expect(h1?.textContent).not.toContain('usr_9f3');
    expect(h1?.querySelector('[data-testid="recipient-face"]')).not.toBeNull();
  });

  it('the face gets the stored value, the field declaration and the whole record', () => {
    setFieldReadFaceResolver(resolveRecipientFace);

    h1Of(recordShare(), share);

    expect(faceCalls.length).toBeGreaterThan(0);
    const props = faceCalls[faceCalls.length - 1];
    expect(props.value).toBe('usr_9f3');
    expect(props.field).toMatchObject({ name: 'recipient_id', widget: 'recipient-picker', dependsOn: ['recipient_type'] });
    // The sibling the face's `dependsOn` names, read off the whole record.
    expect(props.dependentValues).toMatchObject({ recipient_type: 'user', record_id: 'acc_7' });
  });

  it('the array form of `fields` resolves the same face', () => {
    setFieldReadFaceResolver(resolveRecipientFace);
    const schema = recordShare();
    const arrayFields = Object.entries(schema.fields).map(([name, def]) => ({ name, ...def }));

    expect(h1Of({ ...schema, fields: arrayFields }, share)?.textContent).toBe('Ada Lovelace');
  });

  it('the face draws over a titleFormat too: the declared pointer still outranks the template', () => {
    setFieldReadFaceResolver(resolveRecipientFace);

    expect(h1Of(recordShare({ titleFormat: '{record_id}' }), share)?.textContent).toBe('Ada Lovelace');
  });

  it('CONTROL — no resolver installed (a host that never loads the registry) heads with the stored text', () => {
    expect(h1Of(recordShare(), share)?.textContent).toBe('usr_9f3');
  });

  it('CONTROL — a plain text nameField heads with its value; the resolver answers no face', () => {
    setFieldReadFaceResolver(resolveRecipientFace);
    const schema = {
      name: 'ticket',
      label: 'Ticket',
      nameField: 'subject',
      fields: { subject: { type: 'text', label: 'Subject' } },
    };

    const h1 = h1Of(schema, { id: 't-1', subject: 'Printer jam' });

    expect(h1?.textContent).toBe('Printer jam');
    expect(faceCalls).toHaveLength(0);
  });

  it('CONTROL — a select nameField still heads with its option label (#13103)', () => {
    setFieldReadFaceResolver(resolveRecipientFace);
    const schema = {
      name: 'audit_log',
      label: 'Audit Log',
      nameField: 'action',
      fields: {
        action: {
          type: 'select',
          label: 'Action',
          options: [{ value: 'config_change', label: 'Config change' }],
        },
      },
    };

    expect(h1Of(schema, { id: 'a-1', action: 'config_change' })?.textContent).toBe('Config change');
    expect(faceCalls).toHaveLength(0);
  });

  it('CONTROL — a title template on an object with no nameField heads with the template', () => {
    setFieldReadFaceResolver(resolveRecipientFace);
    const schema = {
      name: 'deal',
      label: 'Deal',
      titleFormat: '{deal_no} · {stage}',
      fields: { deal_no: { type: 'text' }, stage: { type: 'text' } },
    };

    expect(h1Of(schema, { id: 'd-1', deal_no: 'Q3-042', stage: 'Won' })?.textContent).toBe('Q3-042 · Won');
    expect(faceCalls).toHaveLength(0);
  });

  it('CONTROL — a record with no nameField heads as before (derived title)', () => {
    setFieldReadFaceResolver(resolveRecipientFace);
    const schema = { name: 'note', label: 'Note', fields: { name: { type: 'text' } } };

    expect(h1Of(schema, { id: 'n-1', name: 'Kickoff notes' })?.textContent).toBe('Kickoff notes');
    expect(faceCalls).toHaveLength(0);
  });

  it('CONTROL — an explicit `title` outranks the pointer and its face', () => {
    setFieldReadFaceResolver(resolveRecipientFace);

    const h1 = h1Of(recordShare(), share, { type: 'page:header', title: 'Share {record_id}' });

    expect(h1?.textContent).toBe('Share acc_7');
    expect(faceCalls).toHaveLength(0);
  });

  it('CONTROL — an empty pointer value falls through to the next rung, not to the face', () => {
    setFieldReadFaceResolver(resolveRecipientFace);

    const h1 = h1Of(recordShare({ titleFormat: 'Share of {record_id}' }), { ...share, recipient_id: '' });

    expect(h1?.textContent).toBe('Share of acc_7');
    expect(faceCalls).toHaveLength(0);
  });
});
