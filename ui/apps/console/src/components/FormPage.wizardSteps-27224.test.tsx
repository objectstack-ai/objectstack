// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27224 — the form page draws a form view's
 * `type: 'wizard'`, which it drew as stacked sections.
 *
 * One step per section, with the semantics of the app's wizard form: a step
 * indicator (unless `showStepIndicator: false`), Next checks the current
 * step's fields before the next step opens, Back is free, a later step opens
 * from the indicator only once completed or under `allowSkip`, the final
 * submit carries every step's fields, and a refused submit opens the step
 * holding the field it names. `layout: 'horizontal'` holds on every step.
 *
 * CONTROLS: a single-section wizard draws its section stacked with no
 * indicator, and a `type: 'simple'` view is unchanged.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage, canOpenWizardStep } from './FormPage';

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

const withRequired = (name: keyof typeof OBJECT_SCHEMA.fields) => ({
  ...OBJECT_SCHEMA,
  fields: { ...OBJECT_SCHEMA.fields, [name]: { ...OBJECT_SCHEMA.fields[name], required: true } },
});

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
          config: { type: 'wizard', sections: THREE_SECTIONS, ...form },
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
const step = (key: string) => screen.queryByTestId(`form-step:${key}`) as HTMLButtonElement | null;
const panel = (key: string) => screen.queryByTestId(`form-step-panel:${key}`);
const isCurrent = (key: string) => step(key)?.getAttribute('aria-current') === 'step';
const button = (name: string) => screen.queryByRole('button', { name });

/** The page is drawn and every step's (lazy) widget has arrived. */
async function drawn() {
  await waitFor(() => expect(step('main')).not.toBeNull());
  await waitFor(() => {
    for (const name of ['title', 'notes', 'channel']) expect(input(name), name).not.toBeNull();
  });
}

beforeEach(() => {
  submits = [];
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormPage draws a wizard form view as steps (#27224)', () => {
  it('one step per section, named by its heading; only the current step is drawn', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderPage();
    await drawn();
    const nav = screen.getByRole('navigation', { name: 'Progress' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1Main',
      '2More',
      '3Routing',
    ]);
    expect(isCurrent('main')).toBe(true);
    // Every step is mounted; only the current one is drawn.
    expect(panel('main')!.hidden).toBe(false);
    expect(panel('more')!.hidden).toBe(true);
    expect(panel('routing')!.hidden).toBe(true);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    // The first step offers Next, no Back, and no Submit yet.
    expect(button('Next')).not.toBeNull();
    expect(button('Back')).toBeNull();
    expect(button('Submit')).toBeNull();
    // No later step opens from the indicator before it is reached.
    expect(step('more')!.disabled).toBe(true);
  });

  it('Next opens the next step, Back the previous one, and the last step submits', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderPage();
    await drawn();
    await userEvent.click(button('Next')!);
    expect(isCurrent('more')).toBe(true);
    expect(panel('more')!.hidden).toBe(false);
    expect(panel('main')!.hidden).toBe(true);
    expect(step('main')!.getAttribute('data-state')).toBe('complete');
    await userEvent.click(button('Back')!);
    expect(isCurrent('main')).toBe(true);
    // A completed step stays open from the indicator.
    expect(step('more')!.disabled).toBe(false);
    await userEvent.click(step('more')!);
    await userEvent.click(button('Next')!);
    expect(isCurrent('routing')).toBe(true);
    expect(button('Next')).toBeNull();
    expect(button('Submit')).not.toBeNull();
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
  });

  it('Next refuses a step with a required field outstanding, and nothing is written', async () => {
    vi.stubGlobal('fetch', stubFetch({}, withRequired('title')));
    renderPage();
    await drawn();
    await userEvent.click(button('Next')!);
    expect(isCurrent('main')).toBe(true);
    expect(step('main')!.getAttribute('data-state')).toBe('invalid');
    expect(screen.getByText(/Title/, { selector: 'div' })).toBeTruthy();
    await userEvent.type(input('title')!, 'Printer jam');
    await userEvent.click(button('Next')!);
    expect(isCurrent('more')).toBe(true);
    expect(step('main')!.getAttribute('data-state')).toBe('complete');
    expect(submits).toHaveLength(0);
  });

  it('Enter in a field before the last step is that step\'s Next', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    renderPage();
    await drawn();
    await userEvent.type(input('title')!, 'Printer jam{Enter}');
    expect(isCurrent('more')).toBe(true);
    expect(submits).toHaveLength(0);
  });

  it('a submit carries every step\'s fields', async () => {
    vi.stubGlobal('fetch', stubFetch({ defaults: { channel: 'web' } }));
    renderPage();
    await drawn();
    await userEvent.type(input('title')!, 'Printer jam');
    await userEvent.click(button('Next')!);
    await userEvent.type(input('notes')!, 'Third floor');
    await userEvent.click(button('Next')!);
    await userEvent.click(button('Submit')!);
    await waitFor(() => expect(submits).toHaveLength(1));
    expect(submits[0].body).toMatchObject({ title: 'Printer jam', notes: 'Third floor', channel: 'web' });
  });

  it('allowSkip opens any step from the indicator; a refused submit opens the step holding the field', async () => {
    vi.stubGlobal('fetch', stubFetch({ allowSkip: true }, withRequired('notes')));
    renderPage();
    await drawn();
    expect(step('routing')!.disabled).toBe(false);
    await userEvent.click(step('routing')!);
    expect(isCurrent('routing')).toBe(true);
    await userEvent.click(button('Submit')!);
    await waitFor(() => expect(isCurrent('more')).toBe(true));
    expect(step('more')!.getAttribute('data-state')).toBe('invalid');
    expect(submits).toHaveLength(0);
  });

  it('showStepIndicator: false draws no indicator, and the steps still move', async () => {
    vi.stubGlobal('fetch', stubFetch({ showStepIndicator: false }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(panel('main')!.hidden).toBe(false);
    await userEvent.click(button('Next')!);
    expect(panel('more')!.hidden).toBe(false);
  });

  it('layout: horizontal holds on every step', async () => {
    vi.stubGlobal('fetch', stubFetch({ layout: 'horizontal' }));
    renderPage();
    await drawn();
    const LABELS: Record<string, string> = { title: 'Title', notes: 'Notes', channel: 'Channel' };
    for (const name of ['title', 'notes', 'channel']) {
      const row = screen.getByText(LABELS[name]).closest('label')!.parentElement!;
      expect(row.className.split(/\s+/), name).toContain('sm:grid');
    }
  });

  it('CONTROL: a single-section wizard draws its section stacked, no indicator', async () => {
    vi.stubGlobal('fetch', stubFetch({ sections: [THREE_SECTIONS[0]] }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.querySelectorAll('form section')).toHaveLength(1);
    expect(button('Next')).toBeNull();
    expect(button('Submit')).not.toBeNull();
  });

  it('CONTROL: a simple view draws every section stacked, with Submit and no steps', async () => {
    vi.stubGlobal('fetch', stubFetch({ type: 'simple', allowSkip: true }));
    renderPage();
    await waitFor(() => expect(input('title')).not.toBeNull());
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(step('main')).toBeNull();
    expect([...document.querySelectorAll('form section h2')].map((h) => h.textContent)).toEqual([
      'Main',
      'More',
      'Routing',
    ]);
    expect([...document.querySelectorAll('form section')].every((s) => !(s as HTMLElement).hidden)).toBe(true);
    expect(button('Next')).toBeNull();
    expect(button('Submit')).not.toBeNull();
  });
});

describe('the wizard step gate (#27224)', () => {
  it('opens any step up to the current one, and a later one once completed or under allowSkip', () => {
    const none = new Set<number>();
    expect(canOpenWizardStep(0, 1, none, false)).toBe(true);
    expect(canOpenWizardStep(1, 1, none, false)).toBe(true);
    expect(canOpenWizardStep(2, 1, none, false)).toBe(false);
    expect(canOpenWizardStep(2, 1, new Set([2]), false)).toBe(true);
    expect(canOpenWizardStep(2, 1, none, true)).toBe(true);
  });
});
