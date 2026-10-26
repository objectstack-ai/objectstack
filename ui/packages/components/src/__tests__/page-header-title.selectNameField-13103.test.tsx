/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page H1's declared-pointer rung labels a select `nameField`
 * (objectui#13103).
 *
 * ## The defect
 *
 * `page:header`'s first record rung reads the declared `nameField` off the
 * record as served, while the `titleFormat` rung one step down reads the
 * record through `withOptionLabels`. So one select field headed the page as
 * its option label through the template and as its stored value through the
 * pointer, and the pointer outranks the template. The card's case: an audit
 * row whose object declares `nameField: 'action'` read `config_change`.
 *
 * ## What is pinned
 *
 * - THE CARD: a select `nameField` heads the page with its option label, with
 *   and without a `titleFormat` beside it (the pointer rung answers first).
 * - CONTROLS: a text `nameField` heads the page with its value unchanged, even
 *   when another select field on the object declares that same string as an
 *   option value; a value no option declares renders raw; the `titleFormat`
 *   rung still labels a select token.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope, NOT inside a `beforeAll` (see
// page-header-title.oneInterpolator-10447.test.tsx).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

/** Render the real `page:header` for one record and return its H1 text. */
function h1Of(objectSchema: any, record: any): string | null | undefined {
  const { container } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName={objectSchema.name}
        recordId={record.id}
        data={record}
        objectSchema={objectSchema}
      >
        <PageHeader schema={{ type: 'page:header' }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
  return container.querySelector('h1')?.textContent;
}

afterEach(() => {
  cleanup();
});

const actionOptions = [
  { value: 'config_change', label: 'Config change' },
  { value: 'login', label: 'Sign in' },
];

const auditLog = (extra: Record<string, unknown> = {}) => ({
  name: 'audit_log',
  label: 'Audit Log',
  nameField: 'action',
  fields: {
    action: { type: 'select', label: 'Action', options: actionOptions },
    actor: { type: 'text', label: 'Actor' },
  },
  ...extra,
});

describe('page:header H1 — the declared-pointer rung labels a select nameField (#13103)', () => {
  it('THE CARD — a select nameField heads the page with its option label', () => {
    const record = { id: 'rec-1', action: 'config_change', actor: 'ada' };

    expect(h1Of(auditLog(), record)).toBe('Config change');
  });

  it('the pointer rung still outranks a titleFormat, and answers with the label', () => {
    const record = { id: 'rec-2', action: 'login', actor: 'ada' };

    expect(h1Of(auditLog({ titleFormat: '{actor}' }), record)).toBe('Sign in');
  });

  it('the array form of `fields` labels the same way', () => {
    const record = { id: 'rec-3', action: 'config_change' };
    const schema = auditLog();
    const arrayFields = Object.entries(schema.fields).map(([name, def]) => ({ name, ...def }));

    expect(h1Of({ ...schema, fields: arrayFields }, record)).toBe('Config change');
  });

  it('CONTROL — a value no option declares renders raw', () => {
    const record = { id: 'rec-4', action: 'purge' };

    expect(h1Of(auditLog(), record)).toBe('purge');
  });

  it('CONTROL — a text nameField heads the page with its value unchanged', () => {
    // `status` declares `config_change` as an option value; the pointer names
    // the text field `subject`, whose value is that same string, and it stays.
    const schema = {
      name: 'ticket',
      label: 'Ticket',
      nameField: 'subject',
      fields: {
        subject: { type: 'text', label: 'Subject' },
        status: { type: 'select', label: 'Status', options: actionOptions },
      },
    };
    const record = { id: 'rec-5', subject: 'config_change', status: 'login' };

    expect(h1Of(schema, record)).toBe('config_change');
  });

  it('CONTROL — the titleFormat rung still labels a select token', () => {
    const schema = {
      name: 'ticket',
      label: 'Ticket',
      titleFormat: '{deal_no} · {status}',
      fields: {
        deal_no: { type: 'autonumber', label: 'Deal No' },
        status: { type: 'select', label: 'Status', options: actionOptions },
      },
    };
    const record = { id: 'rec-6', deal_no: 'Q3-042', status: 'login' };

    expect(h1Of(schema, record)).toBe('Q3-042 · Sign in');
  });
});
