// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Public Forms dialogs pick with the shared `Select` (objectui#11865).
 *
 * *Publish a FormView* asked for the view, and the edit dialog for what happens
 * after submit, with browser-native selects, beside the shared Radix `Select`
 * the rest of the console picks with. The card asks for one control for one
 * kind of choice, surface by surface; this suite covers this page's two
 * pickers.
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows the
 *     dialog's value, and no native select is left;
 *   - each picker keeps the name its `<Label htmlFor>` gave the native control;
 *   - every option writes the `meta.saveItem` call the native control led to,
 *     compared as JSON text, "— Select a FormView —" (value `''`) included;
 *   - a stored kind no option carries is what the trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * Read-only: neither dialog has such a state; both open only from this page's
 * own Publish and Edit buttons.
 *
 * DIRECTION, observed against the native controls: every pin here but the name
 * pin is red there, because each one reads the pickers as the primitive's
 * triggers. The name pin is green there too: it pins what the conversion kept.
 * What makes the write pins guards of "the conversion changed nothing the page
 * saves" is the literal each compares against: a `change` event on the
 * pre-conversion page's native control, then the same Publish or Save click,
 * led to that same `saveItem` JSON, read once on that page with these
 * fixtures. The names and the stored-kind reading were taken there the same
 * way. objectui#11545 then moved the fixtures and both writers to the
 * `ViewItem` shape `GET /meta/view` serves, so each literal below is that same
 * write with the form under `config`: the same view, the same values.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// The page asks the router where the anonymous route is served (objectui#11769),
// so it renders inside one, as it does in the app.
import { MemoryRouter } from 'react-router-dom';

/**
 * One published public form (whose stored `submitBehavior` each case sets) and
 * two FormViews that are not public yet: one with a label and an object, one
 * with neither. All three are on the `ViewItem` shape `GET /meta/view` serves,
 * the form under `config` (objectui#11545). `ViewItemSchema` requires `object`,
 * so the survey is not a valid ViewItem: it pins how the picker labels a
 * served item that names neither.
 */
const { saveItem, stored, ADAPTER } = vi.hoisted(() => {
  const stored: { submitBehavior: unknown } = { submitBehavior: undefined };
  const published = () => ({
    name: 'showcase_task.public',
    label: 'Log Time',
    object: 'showcase_task',
    viewKind: 'form',
    config: {
      type: 'simple',
      sections: [{ label: 'Task', fields: ['title'] }],
      sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/log-time' },
      ...(stored.submitBehavior ? { submitBehavior: stored.submitBehavior } : {}),
    },
  });
  const lead = {
    name: 'lead.intake',
    label: 'Lead intake',
    object: 'lead',
    viewKind: 'form',
    config: { type: 'simple', sections: [{ label: 'Lead', fields: ['name'] }] },
  };
  const survey = { name: 'survey.form', viewKind: 'form', config: { sections: [] } };
  const saveItem = vi.fn(async () => ({ ok: true }));
  // A STABLE singleton: a fresh object per render loops the page's load effect.
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) =>
          type === 'view' ? [published(), lead, survey] : [],
        saveItem,
      },
    }),
  };
  return { saveItem, stored, ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported AFTER the mocks so the page picks them up.
import { PublicFormsPage } from './PublicFormsPage';

afterEach(() => {
  cleanup();
  saveItem.mockClear();
  stored.submitBehavior = undefined;
});

const PLACEHOLDER = '— Select a FormView —';
const LEAD = 'Lead intake (lead.intake) · lead';
// The native option's text, trailing space and all: the label has no object to append.
const SURVEY = 'survey.form (survey.form) ';
const THANK_YOU = 'Show a thank-you panel';
const REDIRECT = 'Redirect to a URL';
const CONTINUE = 'Reset for another response';
const NEXT_RECORD = 'Advance to next record (internal queues)';

async function openPublish(): Promise<HTMLElement> {
  render(<PublicFormsPage />, { wrapper: MemoryRouter });
  await screen.findByRole('button', { name: /Edit sharing/i });
  fireEvent.click(screen.getByRole('button', { name: /Publish form/i }));
  return screen.findByRole('combobox', { name: 'FormView' });
}

async function openEdit(submitBehavior?: unknown): Promise<HTMLElement> {
  stored.submitBehavior = submitBehavior;
  render(<PublicFormsPage />, { wrapper: MemoryRouter });
  fireEvent.click(await screen.findByRole('button', { name: /Edit sharing/i }));
  return screen.findByRole('combobox', { name: 'After submit' });
}

/** Open a picker from the keyboard and return the options it lists, in order. */
async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`no "${label}" listed: ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('the Public Forms pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, showing the dialog’s value', async () => {
    const view = await openPublish();
    expect(view.tagName).toBe('BUTTON');
    expect(view).toHaveTextContent(PLACEHOLDER);
    expect(document.querySelector('select')).toBeNull();
    cleanup();

    const behavior = await openEdit({ kind: 'continue' });
    expect(behavior.tagName).toBe('BUTTON');
    expect(behavior).toHaveTextContent(CONTINUE);
    expect(document.querySelector('select')).toBeNull();
  });

  // Green against the native controls too, by design: it pins what the conversion kept.
  it('each picker keeps the name its label gave the native control', async () => {
    expect(await openPublish()).toHaveAttribute('id', 'publish-view');
    cleanup();
    expect(await openEdit()).toHaveAttribute('id', 'edit-behavior');
  });

  it('each picker lists its options in the order the native control did', async () => {
    expect((await openPicker(await openPublish())).map((o) => o.textContent)).toEqual([
      PLACEHOLDER,
      LEAD,
      SURVEY,
    ]);
    cleanup();
    expect((await openPicker(await openEdit())).map((o) => o.textContent)).toEqual([
      THANK_YOU,
      REDIRECT,
      CONTINUE,
      NEXT_RECORD,
    ]);
  });
});

/** The `saveItem` call publishing a view at slug `contact-us`, as the native control led to it. */
const PUBLISH_WRITES: ReadonlyArray<readonly [label: string, json: string]> = [
  [
    LEAD,
    '["view","lead.intake",{"name":"lead.intake","label":"Lead intake","object":"lead","viewKind":"form","config":{"type":"simple","sections":[{"label":"Lead","fields":["name"]}],"sharing":{"enabled":true,"allowAnonymous":true,"publicLink":"/forms/contact-us"}}}]',
  ],
  [
    SURVEY,
    '["view","survey.form",{"name":"survey.form","viewKind":"form","config":{"sections":[],"sharing":{"enabled":true,"allowAnonymous":true,"publicLink":"/forms/contact-us"}}}]',
  ],
];

/** The published item's own keys, and its form (`config`) up to `submitBehavior`. */
const SAVED_ITEM = '"name":"showcase_task.public","label":"Log Time","object":"showcase_task","viewKind":"form"';
const SAVED_FORM =
  '"type":"simple","sections":[{"label":"Task","fields":["title"]}],"sharing":{"enabled":true,"allowAnonymous":true,"publicLink":"/forms/log-time"}';

/** [the stored submitBehavior, option label, the `submitBehavior` JSON Save wrote]. */
const BEHAVIOR_WRITES: ReadonlyArray<readonly [from: unknown, label: string, json: string]> = [
  [undefined, THANK_YOU, '{"kind":"thank-you"}'],
  [undefined, REDIRECT, '{"kind":"redirect","url":"/thanks"}'],
  [undefined, CONTINUE, '{"kind":"continue"}'],
  [undefined, NEXT_RECORD, '{"kind":"next-record"}'],
  [{ kind: 'redirect', url: '/done' }, THANK_YOU, '{"kind":"thank-you"}'],
  [{ kind: 'redirect', url: '/done' }, REDIRECT, '{"kind":"redirect","url":"/done"}'],
  [{ kind: 'redirect', url: '/done' }, CONTINUE, '{"kind":"continue"}'],
  [{ kind: 'redirect', url: '/done' }, NEXT_RECORD, '{"kind":"next-record"}'],
  [{ kind: 'continue' }, THANK_YOU, '{"kind":"thank-you"}'],
  [{ kind: 'continue' }, REDIRECT, '{"kind":"redirect","url":"/thanks"}'],
  [{ kind: 'continue' }, CONTINUE, '{"kind":"continue"}'],
  [{ kind: 'continue' }, NEXT_RECORD, '{"kind":"next-record"}'],
];

describe('every option writes what the native control wrote', () => {
  it.each(PUBLISH_WRITES)('publishing %s', async (label, json) => {
    const view = await openPublish();
    await pick(view, label);
    expect(view).toHaveTextContent(label.trim());
    fireEvent.change(screen.getByLabelText('URL slug'), { target: { value: 'Contact Us' } });
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(saveItem.mock.calls[0])).toBe(json);
  });

  it('"— Select a FormView —" puts the dialog back on no view, and nothing can be published', async () => {
    const view = await openPublish();
    await pick(view, LEAD);
    await pick(view, PLACEHOLDER);
    expect(view).toHaveTextContent(PLACEHOLDER);
    fireEvent.change(screen.getByLabelText('URL slug'), { target: { value: 'Contact Us' } });
    expect(screen.getByRole('button', { name: /^Publish$/ })).toBeDisabled();
    expect(saveItem).not.toHaveBeenCalled();
  });

  it.each(
    BEHAVIOR_WRITES.map(
      ([from, label, json]) => [`after submit ${JSON.stringify(from) ?? 'unset'} → ${label}`, from, label, json] as const,
    ),
  )('%s', async (_name, from, label, json) => {
    const behavior = await openEdit(from);
    await pick(behavior, label);
    expect(behavior).toHaveTextContent(label);
    const url = screen.queryByLabelText('Redirect URL');
    if (url && (url as HTMLInputElement).value === '') fireEvent.change(url, { target: { value: '/thanks' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(saveItem.mock.calls[0])).toBe(
      `["view","showcase_task.public",{${SAVED_ITEM},"config":{${SAVED_FORM},"submitBehavior":${json}}}]`,
    );
  });
});

describe('a value no option carries is what the trigger shows', () => {
  it('a stored kind none of the four options names: shown and listed first, and re-picking it writes nothing', async () => {
    // The native control showed "Show a thank-you panel" here while the dialog
    // held `bogus`, and rendered none of the thank-you fields it names.
    const behavior = await openEdit({ kind: 'bogus' });
    expect(behavior).toHaveTextContent('bogus');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    const listed = (await openPicker(behavior)).map((o) => o.textContent);
    expect(listed).toEqual(['bogus', THANK_YOU, REDIRECT, CONTINUE, NEXT_RECORD]);
    fireEvent.click(screen.getAllByRole('option')[0]);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(behavior).toHaveTextContent('bogus');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Redirect URL')).not.toBeInTheDocument();
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens "After submit" and Enter on an option selects it', async () => {
    const behavior = await openEdit();
    fireEvent.keyDown(behavior, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: REDIRECT }), { key: 'Enter' });
    expect(await screen.findByLabelText('Redirect URL')).toBeInTheDocument();
    expect(behavior).toHaveTextContent(REDIRECT);
  });
});
