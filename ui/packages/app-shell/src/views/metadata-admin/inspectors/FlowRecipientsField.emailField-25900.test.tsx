// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25900 — the notify recipients editor and the email-field
 * recipient, `{ emailField: 'FIELD' }`.
 *
 * The spec's `NotifyConfigSchema` takes that form as the WHOLE `recipients`
 * value, naming an `email`-typed field of the trigger record, on a node whose
 * only channel is `email`. The runtime refuses the other way to the same
 * address on such a node — a Record field row's `record.FIELD` envelope that
 * evaluates to an address no user holds.
 *
 * What is pinned:
 *   1. a stored `{ emailField }` reads as one row and is written back as read:
 *      the editor used to read it as no recipients, so the first edit replaced
 *      it (data loss);
 *   2. the Email field row suggests only `email`-typed fields of the trigger
 *      object and stores the whole value, which the installed spec accepts —
 *      together with `channels: ['email']` in the same commit when the node
 *      does not already name email alone;
 *   3. it is the whole value: it is not offered beside another row, and no row
 *      is added beside it;
 *   4. on a node that sends email, the Record field row does not suggest an
 *      `email`-typed field, and a stored one says why it may fail;
 *   5. the inspector writes both keys in one patch.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyConfigSchema } from '@objectstack/spec/automation';

const state = vi.hoisted(() => ({
  adapter: null as unknown,
  metadataClient: { list: async () => [] as unknown[] },
  configSchemas: {} as Record<string, unknown>,
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => state.adapter,
  subscribeDataChanges: () => () => {},
}));
vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => state.configSchemas,
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName?: string) => ({
    fields:
      objectName === 'ticket'
        ? [
            { name: 'owner', label: 'Owner', type: 'lookup', hidden: false },
            { name: 'requester_email', label: 'Requester email', type: 'email', hidden: false },
            { name: 'backup_email', label: 'Backup email', type: 'email', hidden: false },
            { name: 'subject', label: 'Subject', type: 'text', hidden: false },
          ]
        : [],
    loading: false,
    error: null,
  }),
}));

import { FlowRecipientsField, readRecipients, writeRecipients } from './FlowRecipientsField';
import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

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

beforeEach(() => {
  state.configSchemas = {};
});

afterEach(() => {
  cleanup();
  state.adapter = null;
});

const START = { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'ticket' } };
const cel = (source: string) => ({ dialect: 'cel' as const, source });

interface Commit {
  value: unknown;
  alongside: unknown;
}

/** The editor loop over a notify node holding `channels`: each commit becomes the value rendered next. */
function mount(initial: unknown, channels?: unknown) {
  const commits: Commit[] = [];
  const node = { id: 'tell', type: 'notify', label: 'Tell', config: channels === undefined ? {} : { channels } };
  const context = { draft: { nodes: [START, node], edges: [] }, node };
  function Host() {
    const [value, setValue] = React.useState<unknown>(initial);
    return (
      <FlowRecipientsField
        label="Recipients"
        value={value}
        onCommit={(v, alongside) => {
          commits.push({ value: v, alongside });
          setValue(v);
        }}
        locale="en-US"
        context={context}
      />
    );
  }
  render(<Host />);
  return { commits, last: () => commits[commits.length - 1] };
}

const row = (i: number) => document.querySelector(`[data-recipient-row="${i}"]`) as HTMLElement;
const suggestions = () => Array.from(document.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value);
const notifyAccepts = (config: Record<string, unknown>) => NotifyConfigSchema.safeParse({ title: 'Ticket done', ...config }).success;

async function pickKind(i: number, name: string) {
  await userEvent.click(within(row(i)).getByRole('combobox', { name: 'Recipient type' }));
  await userEvent.click(await screen.findByRole('option', { name }));
}

describe('objectstack#25900 — a stored { emailField } survives the editor', () => {
  it('reads as one Email field row and writes back as read', () => {
    const stored = { emailField: 'requester_email' };
    const entries = readRecipients(stored);
    expect(entries).toEqual([{ kind: 'emailField', value: 'requester_email', stored }]);
    expect(writeRecipients(entries, true)).toBe(stored);
    // The whole value whatever the stored shape was: it is never a list entry.
    expect(writeRecipients(entries, false)).toBe(stored);
  });

  it('draws the stored row, and a blur commits it unchanged with no channel write', () => {
    const stored = { emailField: 'requester_email' };
    const { commits } = mount(stored, ['email']);
    expect(row(0)).not.toBeNull();
    expect(within(row(0)).getByRole('combobox', { name: 'Recipient type' }).textContent).toBe('Email field');
    const box = within(row(0)).getByDisplayValue('requester_email');
    fireEvent.blur(box);
    expect(commits).toEqual([{ value: stored, alongside: undefined }]);
    expect(screen.queryByText('No recipients yet.')).toBeNull();
  });

  it('adds no row beside it: an email-field recipient is the whole value', () => {
    mount({ emailField: 'requester_email' }, ['email']);
    expect(screen.getByRole('button', { name: 'Add recipient' })).toBeDisabled();
  });
});

describe('objectstack#25900 — the Email field row', () => {
  it('suggests only email-typed fields, and stores { emailField } with channels: [email] in the same commit', async () => {
    const { last } = mount(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await pickKind(0, 'Email field');
    expect(suggestions()).toEqual(['requester_email', 'backup_email']);
    const box = within(row(0)).getByPlaceholderText('Email field of the trigger record');
    fireEvent.change(box, { target: { value: 'requester_email' } });
    fireEvent.blur(box);
    expect(last()).toEqual({ value: { emailField: 'requester_email' }, alongside: { channels: ['email'] } });
    expect(notifyAccepts({ recipients: last().value, ...(last().alongside as object) })).toBe(true);
  });

  it('writes no channels on a node that already names email alone, in either spelling', async () => {
    for (const channels of ['email', ['email']]) {
      const { last } = mount(undefined, channels);
      fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
      await pickKind(0, 'Email field');
      const box = within(row(0)).getByPlaceholderText('Email field of the trigger record');
      fireEvent.change(box, { target: { value: 'backup_email' } });
      fireEvent.blur(box);
      expect(last(), JSON.stringify(channels)).toEqual({ value: { emailField: 'backup_email' }, alongside: undefined });
      cleanup();
    }
  });

  it('is not offered beside another recipient', async () => {
    mount(['usr_ada']);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await userEvent.click(within(row(1)).getByRole('combobox', { name: 'Recipient type' }));
    await screen.findByRole('option', { name: 'User' });
    expect(screen.queryByRole('option', { name: 'Email field' })).toBeNull();
  });

  it('a stored { emailField } on a node that does not name email alone says so, and one click sets channels: [email]', () => {
    const stored = { emailField: 'requester_email' };
    const { last } = mount(stored, ['inbox', 'email']);
    expect(within(row(0)).getByRole('note').textContent).toMatch(/email alone/);
    fireEvent.click(within(row(0)).getByRole('button', { name: 'Send by email only' }));
    expect(last()).toEqual({ value: stored, alongside: { channels: ['email'] } });
  });

  it('names a field the catalog types as something other than email', () => {
    mount({ emailField: 'subject' }, ['email']);
    expect(within(row(0)).getByRole('note').textContent).toMatch(/not an email field/i);
  });
});

describe('objectstack#25900 — the Record field row on a node that sends email', () => {
  it('does not suggest an email-typed field there, and still does on a node that does not mail', async () => {
    mount(undefined, ['email']);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    expect(suggestions()).toEqual(['owner', 'subject']);
    cleanup();
    mount(undefined, ['inbox']);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    expect(suggestions()).toEqual(['owner', 'requester_email', 'backup_email', 'subject']);
  });

  it('a stored record.EMAIL_FIELD row there says the address must be a user\'s, and is kept as read', () => {
    const stored = [cel('record.requester_email')];
    mount(stored, ['email']);
    expect(within(row(0)).getByRole('note').textContent).toMatch(/must belong to a user/);
    cleanup();
    mount(stored, ['inbox']);
    expect(within(row(0)).queryByRole('note')).toBeNull();
  });
});

describe('objectstack#25900 — the inspector writes recipients and channels in one patch', () => {
  const META_PREFIX = '/api/v1/meta/';
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
        const route = url.split('?')[0];
        if (!route.startsWith(META_PREFIX)) return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }) };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an Email field pick stores { emailField } and channels: [email], the title kept', async () => {
    const notify = { id: 'tell', type: 'notify', label: 'Tell', config: { title: 'Ticket done', channels: ['inbox'] } };
    const patches: unknown[] = [];
    let current: Record<string, unknown> = notify;
    function Host() {
      const [draft, setDraft] = React.useState<{ nodes: Array<Record<string, unknown>>; edges: unknown[] }>({
        nodes: [START, notify],
        edges: [],
      });
      return (
        <FlowNodeInspector
          type="flow"
          name="tell_requester"
          draft={draft}
          selection={{ kind: 'node', id: 'tell' } as MetadataSelection}
          onPatch={(patch) => {
            patches.push(patch);
            setDraft((d) => {
              const next = { ...d, ...(patch as Partial<typeof d>) };
              current = next.nodes.find((n) => n.id === 'tell') ?? current;
              return next;
            });
          }}
          onClearSelection={vi.fn()}
          readOnly={false}
          locale="en-US"
        />
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await pickKind(0, 'Email field');
    const box = within(row(0)).getByPlaceholderText('Email field of the trigger record');
    fireEvent.change(box, { target: { value: 'requester_email' } });
    patches.length = 0;
    fireEvent.blur(box);
    expect(patches).toHaveLength(1);
    expect(current.config).toEqual({ title: 'Ticket done', channels: ['email'], recipients: { emailField: 'requester_email' } });
    expect(notifyAccepts(current.config as Record<string, unknown>)).toBe(true);
  });
});
