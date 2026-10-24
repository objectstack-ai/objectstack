// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Public Forms page lists a form as published by the server's one rule,
 * on the shape the server serves (objectui#11545).
 *
 * ## The defect
 *
 * The anonymous form routes serve a form only when its `sharing` declares
 * `enabled === true`, `allowAnonymous === true` and a `publicLink` slug
 * (`anonymousFormIntakeCandidates`, `@objectstack/spec/ui`). The page decided
 * "published" on `allowAnonymous` and a parseable link alone, so a form
 * withdrawn by clearing `enabled`, which the routes answer with a 404, still
 * read as published. It also looked for the form at the item's top level,
 * while `GET /meta/view` serves `ViewItem`s with the form under `config`, so on
 * served data it listed no form at all; and its two writers put `sharing` and
 * `submitBehavior` at the top level, which `ViewItemSchema` refuses.
 *
 * ## The fixture is the served shape, from a real producer
 *
 * The showcase app's `inquiry.view.ts` authors `formViews.contact`, the one
 * fully opted-in public form an example app ships. `FIXTURE` below copies that
 * entry and runs it through `defineView` and `expandViewContainer`, the spec's
 * own composer, which is what turns a `defineView` container into the
 * `ViewItem`s the list serves. Two siblings share its body: one withdrawn by
 * `enabled: false`, and one runtime-authored with only `allowAnonymous` and
 * `publicLink` (its raw body, so `enabled` is absent rather than defaulted).
 *
 * ## What these pins hold
 *
 *   - a form withdrawn under the rule is not listed as published; it is
 *     offered for publishing instead;
 *   - the fully opted-in form is listed, under the slug the rule yields;
 *   - the Publish and Edit writers write `config.sharing` (and Edit
 *     `config.submitBehavior`), `ViewItemSchema` accepts what they write, and
 *     the rule opens the written body under the slug the dialog was given.
 *
 * The rule is the oracle wherever a published set is compared, so these pins
 * follow the spec when it moves. Replacing the page's call to the rule with
 * the old `allowAnonymous && slug && link` reading, kept on `config`, turns the
 * withdrawn pin red; that ablation was run once for the pull request and is
 * recorded there, not re-run here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
// The page asks the router where the anonymous route is served (objectui#11769),
// so it renders inside one, as it does in the app.
import { MemoryRouter } from 'react-router-dom';
import {
  ViewItemSchema,
  anonymousFormIntakeCandidates,
  anonymousFormIntakeSlugs,
  defineView,
  expandViewContainer,
} from '@objectstack/spec/ui';

/** What `GET /meta/view` answers, set per test; and the writes the page sends. */
const { served, saveItem, ADAPTER } = vi.hoisted(() => {
  const served: { items: unknown[] } = { items: [] };
  const saveItem = vi.fn(async () => ({ ok: true }));
  // A STABLE singleton: a fresh object per render loops the page's load effect.
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) => (type === 'view' ? { type, items: served.items } : { type, items: [] }),
        saveItem,
      },
    }),
  };
  return { served, saveItem, ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported AFTER the mocks so the page picks them up.
import { PublicFormsPage } from './PublicFormsPage';

const data = { provider: 'object' as const, object: 'showcase_inquiry' };

/** The showcase's `inquiry.view.ts` `formViews.contact`, as that file authors it. */
const contact = {
  type: 'simple' as const,
  data,
  sections: [
    {
      name: 'tell_us_about_yourself',
      label: 'Tell us about yourself',
      columns: 1 as const,
      fields: [
        { field: 'name', required: true },
        { field: 'email', required: true },
        { field: 'company' },
        { field: 'message', required: true },
      ],
    },
  ],
  sharing: {
    enabled: true,
    allowAnonymous: true,
    publicLink: '/forms/contact-us',
  },
  submitBehavior: {
    kind: 'thank-you' as const,
    title: 'Thanks!',
    message: 'We received your message and a specialist will reach out shortly.',
  },
};

/** The parts of a served `ViewItem`, and of its form under `config`, these pins read. */
interface Served {
  name: string;
  config: {
    sharing?: { enabled?: boolean; allowAnonymous?: boolean; publicLink?: string };
    sections?: unknown;
    submitBehavior?: unknown;
  };
}

/** The served `ViewItem`s, composed by the spec's own expansion (module header). */
const FIXTURE = [
  ...expandViewContainer(
    'showcase_inquiry',
    defineView({
      list: { label: 'Inquiries', type: 'grid', data, columns: [{ field: 'name' }] },
      formViews: {
        contact,
        withdrawn: {
          ...contact,
          sharing: { ...contact.sharing, enabled: false, publicLink: '/forms/inquiry-withdrawn' },
        },
      },
    }),
  ),
  // Runtime-authored and unparsed: `enabled` is absent, not defaulted.
  ...expandViewContainer('showcase_inquiry', {
    formViews: {
      two_keys: { ...contact, sharing: { allowAnonymous: true, publicLink: '/forms/inquiry-two-keys' } },
    },
  }),
] as unknown as Served[];

const CONTACT = 'showcase_inquiry.contact';
const WITHDRAWN = 'showcase_inquiry.withdrawn';
const TWO_KEYS = 'showcase_inquiry.two_keys';

beforeEach(() => {
  served.items = structuredClone(FIXTURE);
  saveItem.mockClear();
});
afterEach(cleanup);

/** The names of the forms the page lists as published, in table order. */
function publishedNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelector('td code')?.textContent ?? '',
  );
}

/** The table row the page lists for `name`. */
function rowOf(container: HTMLElement, name: string): HTMLElement {
  const row = Array.from(container.querySelectorAll('tbody tr')).find(
    (tr) => tr.querySelector('td code')?.textContent === name,
  );
  expect(row, `the page lists ${name}`).toBeTruthy();
  return row as HTMLElement;
}

async function mount() {
  const view = render(<PublicFormsPage />, { wrapper: MemoryRouter });
  // All rows, not one: a page listing more than it should must fail on the
  // pins below, not on this wait.
  await screen.findAllByRole('button', { name: /Edit sharing & post-submit behavior/i });
  return view;
}

/** Open the Publish dialog's FormView picker and return the options it lists. */
async function openPublishPicker(): Promise<HTMLElement[]> {
  fireEvent.click(screen.getByRole('button', { name: /Publish form/i }));
  fireEvent.keyDown(await screen.findByRole('combobox', { name: 'FormView' }), { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

describe('the fixture is the served shape (objectui#11545)', () => {
  it('every item is a ViewItem the authoring schema accepts, and the rule opens exactly one', () => {
    for (const item of FIXTURE) {
      expect(ViewItemSchema.safeParse(item).success, `${item.name} is a valid ViewItem`).toBe(true);
    }
    expect(FIXTURE.map((i) => i.name)).toEqual([
      'showcase_inquiry.default',
      CONTACT,
      WITHDRAWN,
      TWO_KEYS,
    ]);
    // CONTROL: the two siblings carry the keys the old reading accepted.
    for (const name of [WITHDRAWN, TWO_KEYS]) {
      const sharing = FIXTURE.find((i) => i.name === name)?.config.sharing;
      expect(sharing?.allowAnonymous, `${name} still allows anonymous access`).toBe(true);
      expect(sharing?.publicLink, `${name} still names a link`).toMatch(/^\/forms\//);
    }
    expect(FIXTURE.filter((i) => anonymousFormIntakeCandidates(i).length > 0).map((i) => i.name)).toEqual([
      CONTACT,
    ]);
  });
});

describe('Public Forms lists a form as published by the server’s rule (objectui#11545)', () => {
  it('a form withdrawn under the rule is not listed as published', async () => {
    const { container } = await mount();
    const listed = publishedNames(container);

    expect(listed, 'a form withdrawn by enabled: false').not.toContain(WITHDRAWN);
    expect(listed, 'a form with only allowAnonymous and publicLink').not.toContain(TWO_KEYS);
    expect(container.querySelector('tbody')?.textContent ?? '').not.toMatch(/inquiry-(withdrawn|two-keys)/);
    // The published set is the rule's answer, item by item.
    expect(listed).toEqual(
      FIXTURE.filter((i) => anonymousFormIntakeCandidates(i).length > 0).map((i) => i.name),
    );
  });

  it('a fully opted-in form is listed, under the slug the rule yields', async () => {
    const { container } = await mount();

    const row = rowOf(container, CONTACT);
    expect(within(row).getByText('contact-us')).toBeInTheDocument();
    expect(within(row).getByText('showcase_inquiry')).toBeInTheDocument();
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      `${window.location.origin}/f/contact-us`,
    );
    expect(publishedNames(container), 'and nothing else is').toEqual([CONTACT]);
  });

  it('offers the forms the rule does not open for publishing, and no list view', async () => {
    await mount();
    const options = (await openPublishPicker()).map((o) => o.textContent);

    expect(options).toEqual([
      '— Select a FormView —',
      `${WITHDRAWN} (${WITHDRAWN}) · showcase_inquiry`,
      `${TWO_KEYS} (${TWO_KEYS}) · showcase_inquiry`,
    ]);
  });
});

describe('the Publish and Edit writers write the form under config (objectui#11545)', () => {
  it('Publish writes config.sharing, and the rule opens what it wrote', async () => {
    await mount();
    const option = (await openPublishPicker()).find((o) => o.textContent?.startsWith(WITHDRAWN));
    fireEvent.click(option as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('URL slug'), { target: { value: 'Inquiry Again' } });
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    const [type, name, body] = saveItem.mock.calls[0] as unknown as [string, string, Served];
    expect([type, name]).toEqual(['view', WITHDRAWN]);
    expect(body).not.toHaveProperty('sharing');
    expect(body.config.sharing).toEqual({
      enabled: true,
      allowAnonymous: true,
      publicLink: '/forms/inquiry-again',
    });
    // The rest of the form is what was served.
    const servedItem = FIXTURE.find((i) => i.name === WITHDRAWN) as Served;
    expect(body.config.sections).toEqual(servedItem.config.sections);
    expect(body.config.submitBehavior).toEqual(servedItem.config.submitBehavior);

    const parsed = ViewItemSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(anonymousFormIntakeSlugs(body)).toEqual(['inquiry-again']);
  });

  it('Edit reads and writes config.submitBehavior and config.sharing, and the rule opens what it wrote', async () => {
    const { container } = await mount();
    fireEvent.click(
      within(rowOf(container, CONTACT)).getByRole('button', { name: /Edit sharing & post-submit behavior/i }),
    );
    const dialog = await screen.findByRole('dialog');

    // The stored behaviour is read from config, where the producer wrote it.
    expect(within(dialog).getByLabelText('URL slug')).toHaveValue('contact-us');
    expect(within(dialog).getByLabelText(/^Title$/)).toHaveValue('Thanks!');
    fireEvent.change(within(dialog).getByLabelText('URL slug'), { target: { value: 'contact' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    const [type, name, body] = saveItem.mock.calls[0] as unknown as [string, string, Served];
    expect([type, name]).toEqual(['view', CONTACT]);
    expect(body).not.toHaveProperty('sharing');
    expect(body).not.toHaveProperty('submitBehavior');
    expect(body.config.sharing).toEqual({ enabled: true, allowAnonymous: true, publicLink: '/forms/contact' });
    expect(body.config.submitBehavior).toEqual(contact.submitBehavior);

    const parsed = ViewItemSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(anonymousFormIntakeSlugs(body)).toEqual(['contact']);
  });
});
