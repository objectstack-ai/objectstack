// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#26843 — the form page draws a form view's
 * `type: 'tabbed'` and `layout: 'horizontal'`, which it never read.
 *
 *   - `type: 'tabbed'`: one tab per section, the form view's `defaultTab` open
 *     first and `tabPosition` placing the strip — the semantics of the app's
 *     tabbed form. A submit carries every section's fields, the closed tabs'
 *     included, and a refused submit opens the tab holding the field it names.
 *   - `layout: 'horizontal'`: each row draws its label beside the control from
 *     `sm` up, the arrangement the form renderer gives the same key.
 *
 * CONTROLS: a `type: 'simple'` view, and a tabbed view with one section, draw
 * stacked sections and no tab strip; no `layout` draws no grid row.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage, resolveActiveTab, sectionTabKey } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OBJECT_SCHEMA = {
  name: 'showcase_ticket',
  label: 'Ticket',
  fields: {
    title: { type: 'text', label: 'Title' },
    notes: { type: 'text', label: 'Notes' },
    channel: { type: 'text', label: 'Channel' },
  },
};

const THREE_SECTIONS = [
  { name: 'main', label: 'Main', fields: ['title'] },
  { name: 'more', label: 'More', fields: ['notes'] },
  { name: 'routing', label: 'Routing', fields: ['channel'] },
];

let submits: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubFetch(form: Record<string, unknown>, objectSchema: unknown = OBJECT_SCHEMA) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (init?.method === 'POST') {
      submits.push({ url: path, body: JSON.parse(String(init.body)) });
    }
    const body = path.includes('/meta/view/')
      ? {
          name: 'showcase_ticket.intake',
          object: 'showcase_ticket',
          viewKind: 'form',
          label: 'Intake',
          config: { type: 'tabbed', sections: THREE_SECTIONS, ...form },
        }
      : path.includes('/meta/object/')
        ? objectSchema
        : path.includes('/data/showcase_ticket')
          ? { object: 'showcase_ticket', id: 't1', record: { id: 't1' } }
          : null;
    if (!body) throw new Error(`unstubbed fetch: ${path}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forms/showcase_ticket.intake']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const input = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
const tab = (key: string) => screen.queryByTestId(`form-tab:${key}`);
const panel = (key: string) => screen.queryByTestId(`form-tab-panel:${key}`);
const isOpen = (key: string) => tab(key)?.getAttribute('data-state') === 'active';

beforeEach(() => {
  submits = [];
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormPage draws a tabbed form view as tabs (#26843)', () => {
  it('one tab per section, named by its heading, every panel mounted', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderPage();
    await waitFor(() => expect(tab('main')).not.toBeNull());
    const strip = screen.getByRole('tablist');
    expect(within(strip).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Main', 'More', 'Routing']);
    // No stacked section card beside the strip.
    expect(document.querySelector('form section')).toBeNull();
    // Force-mounted: a closed tab's control exists, only CSS-hidden. (The
    // widgets are lazy, so they arrive after the strip.)
    await waitFor(() => {
      for (const name of ['title', 'notes', 'channel']) expect(input(name), name).not.toBeNull();
    });
    expect(panel('more')?.getAttribute('data-state')).toBe('inactive');
    expect(panel('more')?.className).toContain('data-[state=inactive]:hidden');
    // With no `defaultTab`, the first tab opens.
    expect(isOpen('main')).toBe(true);
  });

  it('the form view\'s defaultTab opens first', async () => {
    vi.stubGlobal('fetch', stubFetch({ defaultTab: 'routing' }));
    renderPage();
    await waitFor(() => expect(tab('routing')).not.toBeNull());
    expect(isOpen('routing')).toBe(true);
    expect(isOpen('main')).toBe(false);
  });

  it('a tab click switches the open panel', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderPage();
    await waitFor(() => expect(tab('more')).not.toBeNull());
    await userEvent.click(tab('more')!);
    expect(isOpen('more')).toBe(true);
    expect(panel('main')?.getAttribute('data-state')).toBe('inactive');
  });

  it('tabPosition: left draws a vertical strip', async () => {
    vi.stubGlobal('fetch', stubFetch({ tabPosition: 'left' }));
    renderPage();
    await waitFor(() => expect(tab('main')).not.toBeNull());
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('a submit carries every section\'s fields, the closed tabs\' included', async () => {
    vi.stubGlobal('fetch', stubFetch({ defaults: { channel: 'web' } }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    await userEvent.type(input('title')!, 'Printer jam');
    await userEvent.click(tab('more')!);
    await userEvent.type(input('notes')!, 'Third floor');
    // `routing` is never opened: its field carries the form view's default.
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submits).toHaveLength(1));
    expect(submits[0].body).toMatchObject({ title: 'Printer jam', notes: 'Third floor', channel: 'web' });
  });

  it('a refused submit opens the tab holding the field it names', async () => {
    const schema = {
      ...OBJECT_SCHEMA,
      fields: { ...OBJECT_SCHEMA.fields, channel: { type: 'text', label: 'Channel', required: true } },
    };
    vi.stubGlobal('fetch', stubFetch({}, schema));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    expect(isOpen('main')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(isOpen('routing')).toBe(true));
    expect(submits).toHaveLength(0);
  });

  it('CONTROL: a single-section tabbed view draws its section stacked, no strip', async () => {
    vi.stubGlobal('fetch', stubFetch({ sections: [THREE_SECTIONS[0]] }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelectorAll('form section')).toHaveLength(1);
  });

  it('CONTROL: a simple view draws every section stacked, no strip', async () => {
    vi.stubGlobal('fetch', stubFetch({ type: 'simple', defaultTab: 'routing' }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    expect(screen.queryByRole('tablist')).toBeNull();
    expect([...document.querySelectorAll('form section h2')].map((h) => h.textContent)).toEqual([
      'Main',
      'More',
      'Routing',
    ]);
  });
});

describe('FormPage draws layout: horizontal rows (#26843)', () => {
  const LABELS: Record<string, string> = { title: 'Title', notes: 'Notes', channel: 'Channel' };
  /** The row a field's `<label>` sits in. */
  const row = (name: string) => screen.getByText(LABELS[name]).closest('label')!.parentElement!;

  it('each row puts its label beside the control at sm, stacked below', async () => {
    vi.stubGlobal('fetch', stubFetch({ type: 'simple', layout: 'horizontal' }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    const classes = row('title').className.split(/\s+/);
    expect(classes).toContain('sm:grid');
    expect(classes).toContain('sm:[&>:not(label)]:col-start-2');
    // Below sm nothing changes: every class the row carries is sm:-prefixed.
    expect(classes.filter((c) => !c.startsWith('sm:'))).toEqual([]);
    expect(row('title').firstElementChild?.tagName).toBe('LABEL');
    // The label still names its control.
    expect(screen.getByLabelText('Title')).toBe(input('title'));
  });

  it('a tabbed view keeps it on every tab', async () => {
    vi.stubGlobal('fetch', stubFetch({ layout: 'horizontal' }));
    renderPage();
    await waitFor(() => expect(input('notes')).not.toBeNull());
    for (const name of ['title', 'notes', 'channel']) {
      expect(row(name).className.split(/\s+/), name).toContain('sm:grid');
    }
  });

  it('CONTROL: no layout, and vertical — no grid row', async () => {
    for (const layout of [undefined, 'vertical']) {
      vi.stubGlobal('fetch', stubFetch({ type: 'simple', ...(layout ? { layout } : {}) }));
      renderPage();
      await waitFor(() => expect(input('title')).not.toBeNull());
      expect(row('title').className.split(/\s+/), String(layout)).not.toContain('sm:grid');
      cleanup();
    }
  });
});

describe('the tab rules (#26843)', () => {
  it('a section\'s tab is its name, else its heading, else its position — TabbedForm\'s rule', () => {
    expect(sectionTabKey({ name: 'main', label: 'Main' }, 0)).toBe('main');
    expect(sectionTabKey({ label: 'Main' }, 0)).toBe('Main');
    expect(sectionTabKey({}, 2)).toBe('tab-2');
  });

  it('the open tab is the pick, else defaultTab, else the first — each only if drawn', () => {
    const drawn = ['a', 'b', 'c'];
    expect(resolveActiveTab(drawn, 'c', 'b')).toBe('c');
    expect(resolveActiveTab(drawn, null, 'b')).toBe('b');
    expect(resolveActiveTab(drawn, 'gone', 'b')).toBe('b');
    expect(resolveActiveTab(drawn, null, 'hidden')).toBe('a');
    expect(resolveActiveTab([], null, 'b')).toBeUndefined();
  });
});
