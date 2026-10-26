// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11788 — the notify node's recipients are picked, not typed: a field
 * of the trigger record, a user, a team or an email address.
 *
 * What is pinned:
 *   1. the stored spellings are the ones the platform reads — a CEL value
 *      envelope over `record.FIELD`, a bare user id, `team:ID`, an address, a
 *      CEL expression — and every value the picker writes passes the installed
 *      spec's `NotifyConfigSchema` (objectui#11824: `recipients` is a value
 *      slot, so the Record field row no longer writes `{record.FIELD}`);
 *   2. reading a stored value and writing it back never rewrites it, including
 *      the values that are none of the types ("Other": a `role:` or
 *      `owner_of:` selector, a `user:ID`, a stored single-brace token);
 *   3. a stored single value reads as one recipient (the free-text list read
 *      it as none) and stays single while it holds one;
 *   4. each type commits through its own picker: the trigger object's field
 *      catalog, the `sys_user` / `sys_team` record lookups, an email box that
 *      warns on a value without an email's shape.
 *
 * The record lookups' own behaviour belongs to `@object-ui/fields`; as in
 * `FlowReferenceField.lookup.test.tsx`, `LookupField` is a stub here that names
 * the object it was bound to and picks a fixed row.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyConfigSchema } from '@objectstack/spec/automation';

const state = vi.hoisted(() => ({
  adapter: null as unknown,
  metadataClient: { list: async () => [] as unknown[] },
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => state.adapter,
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: (props: { field?: { reference?: string; idField?: string }; onChange: (v: unknown) => void }) => (
    <button
      type="button"
      data-testid="record-lookup"
      data-object={props.field?.reference}
      data-value-field={props.field?.idField}
      onClick={() => props.onChange(props.field?.reference === 'sys_team' ? 'team_ops' : 'usr_ada')}
    >
      pick
    </button>
  ),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName?: string) => ({
    fields:
      objectName === 'ticket'
        ? [
            { name: 'owner', label: 'Owner', type: 'lookup', hidden: false },
            { name: 'requester_email', label: 'Requester email', type: 'email', hidden: false },
          ]
        : [],
    loading: false,
    error: null,
  }),
}));

import {
  FlowRecipientsField,
  readRecipient,
  readRecipients,
  writeRecipient,
  writeRecipients,
} from './FlowRecipientsField';

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  state.adapter = null;
});

/** A ticket-triggered flow: the record `{record.*}` binds is a `ticket`. */
const DRAFT = {
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'ticket' } },
    { id: 'tell', type: 'notify', label: 'Tell', config: {} },
  ],
  edges: [],
};
const CONTEXT = { draft: DRAFT, node: DRAFT.nodes[1] };

/** The editor loop: each commit becomes the value the field renders next. */
function mount(initial: unknown) {
  const commits: unknown[] = [];
  function Host() {
    const [value, setValue] = React.useState<unknown>(initial);
    return (
      <FlowRecipientsField
        label="Recipients"
        value={value}
        onCommit={(v) => {
          commits.push(v);
          setValue(v);
        }}
        locale="en-US"
        context={CONTEXT}
      />
    );
  }
  render(<Host />);
  return { commits, last: () => commits[commits.length - 1] };
}

const row = (i: number) => document.querySelector(`[data-recipient-row="${i}"]`) as HTMLElement;
const notifyAccepts = (recipients: unknown) =>
  NotifyConfigSchema.safeParse({ recipients, title: 'Ticket done' }).success;

const cel = (source: string) => ({ dialect: 'cel' as const, source });

describe('objectui#11788 — the stored spellings', () => {
  const CASES: Array<[string, string, string]> = [
    ['usr_ada', 'user', 'usr_ada'],
    ['team:team_ops', 'team', 'team_ops'],
    ['ops@example.com', 'email', 'ops@example.com'],
    // "Other": kept as typed.
    ['role:admin', 'custom', 'role:admin'],
    ['owner_of:ticket:t1', 'custom', 'owner_of:ticket:t1'],
    ['user:usr_ada', 'custom', 'user:usr_ada'],
  ];

  for (const [stored, kind, value] of CASES) {
    it(`${stored} reads as ${kind} and writes back byte for byte`, () => {
      const entry = readRecipient(stored);
      expect(entry).toEqual({ kind, value });
      expect(writeRecipient(entry)).toBe(stored);
    });
  }

  it('a Record field row is a CEL value envelope over record.FIELD, and any other envelope is an Expression row (objectui#11824)', () => {
    expect(writeRecipient({ kind: 'field', value: 'owner' })).toEqual(cel('record.owner'));
    expect(readRecipient(cel('record.owner'))).toMatchObject({ kind: 'field', value: 'owner' });
    expect(writeRecipient({ kind: 'expression', value: 'ownerId' })).toEqual(cel('ownerId'));
    expect(readRecipient(cel('record.owner.manager'))).toMatchObject({ kind: 'expression', value: 'record.owner.manager' });
    // An unedited envelope is written back as read, keys the row does not edit included.
    const withMeta = { ...cel('task.owner'), meta: { rationale: 'the assignee' } };
    expect(writeRecipient(readRecipient(withMeta))).toBe(withMeta);
  });

  it('every value the picker writes is one the spec\'s NotifyConfigSchema accepts (objectui#11824)', () => {
    const written = writeRecipients(
      [
        { kind: 'field', value: 'owner' },
        { kind: 'expression', value: 'ownerId' },
        ...readRecipients(CASES.map(([stored]) => stored)),
      ],
      false,
    );
    expect(written).toEqual([cel('record.owner'), cel('ownerId'), ...CASES.map(([stored]) => stored)]);
    expect(notifyAccepts(written)).toBe(true);
  });

  it('a stored single-brace token is Other, kept as typed — the spec refuses it, and no conversion rewrites it', () => {
    for (const stored of ['{record.owner}', '{ownerId}', '{task.owner}', '{record.owner.manager}']) {
      expect(readRecipient(stored), stored).toEqual({ kind: 'custom', value: stored });
      expect(writeRecipient(readRecipient(stored)), stored).toBe(stored);
      expect(notifyAccepts([stored]), stored).toBe(false);
    }
  });

  it('a single stored value stays single while it holds one recipient; none writes no key', () => {
    expect(writeRecipients(readRecipients('usr_ada'), true)).toBe('usr_ada');
    expect(writeRecipients(readRecipients(cel('record.owner')), true)).toEqual(cel('record.owner'));
    expect(writeRecipients([...readRecipients('usr_ada'), { kind: 'team', value: 't' }], true)).toEqual([
      'usr_ada',
      'team:t',
    ]);
    expect(writeRecipients([], false)).toBeUndefined();
    expect(writeRecipients([{ kind: 'email', value: '  ' }], false)).toBeUndefined();
  });
});

describe('objectui#11788 — the picker', () => {
  it('reads a stored single envelope as one Record field row (the free-text list read it as none)', () => {
    mount(cel('record.owner'));
    expect(within(row(0)).getByRole('combobox', { name: 'Recipient type' }).textContent).toBe('Record field');
    expect(within(row(0)).getByDisplayValue('owner')).toBeInTheDocument();
    expect(row(1)).toBeNull();
  });

  it('a new row picks a field of the trigger object and stores it as a CEL value envelope over record.FIELD (objectui#11824)', () => {
    const { last } = mount(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    const options = Array.from(document.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['owner', 'requester_email']);
    const input = within(row(0)).getByPlaceholderText('Field of the trigger record');
    fireEvent.change(input, { target: { value: 'owner' } });
    fireEvent.blur(input);
    expect(last()).toEqual([cel('record.owner')]);
    expect(notifyAccepts(last())).toBe(true);
  });

  it('a Team row commits the picked sys_team row as team:ID', async () => {
    state.adapter = { find: vi.fn() };
    const { last } = mount([cel('record.owner')]);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await userEvent.click(within(row(1)).getByRole('combobox', { name: 'Recipient type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Team' }));
    const lookup = within(row(1)).getByTestId('record-lookup');
    expect(lookup.dataset.object).toBe('sys_team');
    expect(lookup.dataset.valueField).toBe('id');
    fireEvent.click(lookup);
    expect(last()).toEqual([cel('record.owner'), 'team:team_ops']);
  });

  it('a User row commits the picked sys_user row as its bare id', async () => {
    state.adapter = { find: vi.fn() };
    const { last } = mount([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await userEvent.click(within(row(0)).getByRole('combobox', { name: 'Recipient type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'User' }));
    const lookup = within(row(0)).getByTestId('record-lookup');
    expect(lookup.dataset.object).toBe('sys_user');
    fireEvent.click(lookup);
    expect(last()).toEqual(['usr_ada']);
  });

  it('an Email row warns on a value without an email\'s shape, and stores an address as typed', async () => {
    const { last } = mount([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await userEvent.click(within(row(0)).getByRole('combobox', { name: 'Recipient type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Email address' }));
    const box = within(row(0)).getByPlaceholderText('name@example.com');
    fireEvent.change(box, { target: { value: 'ops' } });
    expect(within(row(0)).getByRole('note').textContent).toMatch(/user id/);
    fireEvent.change(box, { target: { value: 'ops@example.com' } });
    expect(within(row(0)).queryByRole('note')).toBeNull();
    fireEvent.blur(box);
    expect(last()).toEqual(['ops@example.com']);
  });

  it('an Expression row commits a CEL value envelope, and its brace check is the CEL one (objectui#11824)', async () => {
    const { last } = mount([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await userEvent.click(within(row(0)).getByRole('combobox', { name: 'Recipient type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Expression' }));
    const box = within(row(0)).getByPlaceholderText('CEL, e.g. ownerId');
    fireEvent.change(box, { target: { value: '{ownerId}' } });
    expect(within(row(0)).getByRole('alert')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'ownerId' } });
    expect(within(row(0)).queryByRole('alert')).toBeNull();
    fireEvent.blur(box);
    expect(last()).toEqual([cel('ownerId')]);
    expect(notifyAccepts(last())).toBe(true);
  });

  it('a stored value that is none of the types stays as typed under Other, and a remove keeps the rest unchanged', () => {
    const { last } = mount(['role:admin', '{ownerId}', 'team:team_ops']);
    expect(within(row(0)).getByRole('combobox', { name: 'Recipient type' }).textContent).toBe('Other');
    expect(within(row(0)).getByDisplayValue('role:admin')).toBeInTheDocument();
    fireEvent.click(within(row(2)).getByRole('button', { name: 'Remove recipient' }));
    expect(last()).toEqual(['role:admin', '{ownerId}']);
  });
});
