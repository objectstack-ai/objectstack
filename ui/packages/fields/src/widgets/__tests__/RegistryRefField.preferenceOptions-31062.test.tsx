/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `notification-topic` / `notification-channel` — the fillable arm of
 * `RegistryRefField` (#30208 row 6, ruling E on #30527).
 *
 * A notification preference's topic and channel are free text the server
 * stores as written; the preference options door only SUGGESTS values. These
 * pins hold what the arm promises:
 *
 *  - the list renders from the door, in its order, `*` first;
 *  - a failed or empty answer gives the plain text box, with no notice;
 *  - a value outside the list is committed as typed and shown marked
 *    "not in the list";
 *  - a channel the door marks not configured is listed, labelled, selectable.
 *
 * The door is reached through the host's fetch on `SchemaRendererContext`,
 * stubbed here with the door's own success envelope.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { NotificationTopicField, NotificationChannelField } from '../RegistryRefField';
import { PREFERENCE_OPTIONS_URL } from '../preferenceOptions';

const ANSWER = {
  success: true,
  data: {
    topics: [
      { value: '*', wildcard: true, sources: [] },
      { value: 'approval.requested', wildcard: false, sources: ['platform', 'stored'] },
      { value: 'invoice.paid', wildcard: false, sources: ['flow'] },
    ],
    channels: [
      { value: '*', wildcard: true, configured: true },
      { value: 'inbox', wildcard: false, configured: true },
      { value: 'push', wildcard: false, configured: false },
    ],
  },
};

function door(answer: () => Promise<Response>) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => answer());
}

const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

function mount(
  Widget: typeof NotificationTopicField,
  {
    apiFetch,
    value = '',
    onChange = vi.fn(),
    readonly = false,
  }: { apiFetch: ReturnType<typeof door>; value?: string; onChange?: any; readonly?: boolean },
) {
  render(
    <SchemaRendererProvider dataSource={null} apiFetch={apiFetch}>
      <Widget
        value={value}
        onChange={onChange}
        readonly={readonly}
        field={{ name: 'topic', type: 'text', label: 'Topic' } as any}
        id="f-topic"
      />
    </SchemaRendererProvider>,
  );
  return { onChange };
}

function optionTexts(): string[] {
  return within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
}

afterEach(() => cleanup());

describe('notification-topic — the list renders from the door (#30208 row 6)', () => {
  it('reads the preference options door through the host fetch and lists its topics, `*` first', async () => {
    const apiFetch = door(ok(ANSWER));
    mount(NotificationTopicField, { apiFetch });

    fireEvent.click(await screen.findByTestId('preference-option-topics'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(String(apiFetch.mock.calls[0][0])).toBe(PREFERENCE_OPTIONS_URL);
    // The door's order, kept: the wildcard leads, by its words and its value.
    expect(optionTexts()).toEqual(['All topics (*)', 'approval.requested', 'invoice.paid']);
  });

  it('stores the picked value, the wildcard included', async () => {
    const apiFetch = door(ok(ANSWER));
    const { onChange } = mount(NotificationTopicField, { apiFetch });

    fireEvent.click(await screen.findByTestId('preference-option-topics'));
    fireEvent.click(screen.getByText('All topics (*)'));
    expect(onChange).toHaveBeenCalledWith('*');
  });

  it('shows a stored listed value by its own face, unmarked', async () => {
    const apiFetch = door(ok(ANSWER));
    mount(NotificationTopicField, { apiFetch, value: 'invoice.paid' });

    const trigger = await screen.findByTestId('preference-option-topics');
    expect(trigger).toHaveTextContent('invoice.paid');
    expect(trigger).not.toHaveAttribute('data-not-in-list');
  });

  it('a topic field and a channel field share one read of the door', async () => {
    const apiFetch = door(ok(ANSWER));
    render(
      <SchemaRendererProvider dataSource={null} apiFetch={apiFetch}>
        <NotificationTopicField value="" onChange={vi.fn()} field={{ name: 'topic' } as any} />
        <NotificationChannelField value="" onChange={vi.fn()} field={{ name: 'channel' } as any} />
      </SchemaRendererProvider>,
    );
    expect(await screen.findByTestId('preference-option-topics')).toBeInTheDocument();
    expect(await screen.findByTestId('preference-option-channels')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('notification-topic — the plain text box when there is no list (#30208 row 6)', () => {
  it('a failed read gives the text box, with no notice, writing exactly what is typed', async () => {
    const apiFetch = door(async () => new Response('{}', { status: 500 }));
    const { onChange } = mount(NotificationTopicField, { apiFetch, value: 'approval.requested' });

    const box = await screen.findByRole('textbox');
    await vi.waitFor(() => expect(box).toBeEnabled());
    expect(box).toHaveValue('approval.requested');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByTestId('preference-option-topics')).toBeNull();

    fireEvent.change(box, { target: { value: 'invoices.paid' } });
    expect(onChange).toHaveBeenCalledWith('invoices.paid');
  });

  it('a rejected fetch gives the same text box', async () => {
    const apiFetch = door(async () => {
      throw new TypeError('Failed to fetch');
    });
    mount(NotificationTopicField, { apiFetch });

    const box = await screen.findByRole('textbox');
    await vi.waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('an empty list gives the same text box', async () => {
    const apiFetch = door(ok({ success: true, data: { topics: [], channels: [] } }));
    mount(NotificationTopicField, { apiFetch });

    const box = await screen.findByRole('textbox');
    await vi.waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByTestId('preference-option-topics')).toBeNull();
  });
});

describe('notification-topic — a value outside the list (#30208 row 6)', () => {
  it('commits the typed text as written', async () => {
    const apiFetch = door(ok(ANSWER));
    const { onChange } = mount(NotificationTopicField, { apiFetch });

    fireEvent.click(await screen.findByTestId('preference-option-topics'));
    fireEvent.change(screen.getByTestId('preference-option-topics-search'), {
      target: { value: 'Invoices.Paid' },
    });
    fireEvent.click(screen.getByTestId('preference-option-topics-use-typed'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Invoices.Paid');
  });

  it('keeps a stored value the list lacks, marked "not in the list", and writes nothing', async () => {
    const apiFetch = door(ok(ANSWER));
    const { onChange } = mount(NotificationTopicField, { apiFetch, value: 'invoices.paid' });

    const trigger = await screen.findByTestId('preference-option-topics');
    expect(trigger).toHaveTextContent('invoices.paid (not in the list)');
    expect(trigger).toHaveAttribute('data-not-in-list', 'true');
    expect(onChange).not.toHaveBeenCalled();

    // It stays an option of its own, ahead of the listed values.
    fireEvent.click(trigger);
    expect(optionTexts()[0]).toBe('invoices.paid (not in the list)');
  });

  it('marks it on the read face too', async () => {
    const apiFetch = door(ok(ANSWER));
    mount(NotificationTopicField, { apiFetch, value: 'invoices.paid', readonly: true });

    expect(await screen.findByText('invoices.paid (not in the list)')).toHaveAttribute('data-not-in-list', 'true');
  });
});

describe('notification-channel — a channel that is not configured (#30208 row 6)', () => {
  it('is listed, labelled not configured, and selectable', async () => {
    const apiFetch = door(ok(ANSWER));
    const { onChange } = mount(NotificationChannelField, { apiFetch });

    fireEvent.click(await screen.findByTestId('preference-option-channels'));
    expect(optionTexts()).toEqual(['All channels (*)', 'inbox', 'push (not configured)']);

    const push = screen.getByText('push (not configured)').closest('[role="option"]')!;
    expect(push).toHaveAttribute('data-not-configured', 'true');
    expect(push).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(push);
    expect(onChange).toHaveBeenCalledWith('push');
  });
});
