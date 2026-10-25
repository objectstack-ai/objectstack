// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Public Forms page offers the anonymous URL the console is served at
 * (objectui#11769).
 *
 * ## The defect
 *
 * The page built every anonymous URL as `${origin}/console/f/SLUG`: the copied
 * URL, the iframe snippet, the React snippet, and the `/console/f/` prefix
 * printed beside both slug fields. No host serves the console at `/console/`.
 * The framework CLI and cloud mount it at `/_console/` and inject
 * `<base href="/_console/">`, which `App.tsx` turns into the router's basename.
 * The anonymous route is `/f/:slug` under that basename. A framework-served
 * console (`@objectstack/cli` 17.7.0 `serve`) answers `GET /console/f/SLUG`
 * with a 404 `ENDPOINT_NOT_FOUND`, and `GET /_console/f/SLUG` with the
 * console's HTML. That was measured once, for this card. Nothing here
 * re-derives it.
 *
 * ## What these pins hold
 *
 * The page asks the router where `/f` lives. So the URL follows the basename it
 * renders under, and every surface that shows it shows the same value:
 *
 *   - under `/_console`, the page offers `ORIGIN/_console/f/SLUG`;
 *   - on a root-mounted console it offers `ORIGIN/f/SLUG`;
 *   - nested under the metadata-driven entry
 *     (`/apps/APP/component/developer/public-forms`), the URL does not take on
 *     that route's depth;
 *   - the link, the copied URL, the URL inside both snippets and the two
 *     slug-field prefixes agree.
 *
 * The router is `BrowserRouter`, as in `App.tsx`, so `useHref` resolves through
 * the same navigator the shipped app uses.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

/** One published public form, and one FormView not yet published (so the
 *  Publish dialog, which needs a candidate, can be opened), on the `ViewItem`
 *  shape `GET /meta/view` serves: the form under `config` (objectui#11545). */
const { ADAPTER } = vi.hoisted(() => {
  const form = (name: string, sharing?: Record<string, unknown>) => ({
    name,
    label: name,
    object: 'lead',
    viewKind: 'form',
    config: {
      type: 'simple',
      sections: [{ label: 'Lead', fields: ['email'] }],
      ...(sharing ? { sharing } : {}),
    },
  });
  // A STABLE singleton: a fresh object per render loops the page's load effect.
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) =>
          type === 'view'
            ? [
                form('lead.contact_us', {
                  enabled: true,
                  allowAnonymous: true,
                  publicLink: '/forms/contact-us',
                }),
                form('lead.internal'),
              ]
            : [],
        saveItem: async () => ({ ok: true }),
      },
    }),
  };
  return { ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported AFTER the mocks so the page picks them up.
import { PublicFormsPage } from './PublicFormsPage';

const SLUG = 'contact-us';

/**
 * Where the console is mounted. `basename` is what `App.tsx` resolves from the
 * injected `<base href>`; `at` is the route the page is reached through.
 */
const MOUNTS = [
  {
    name: 'a /_console mount (framework CLI and cloud)',
    basename: '/_console',
    at: '/developer/public-forms',
    nested: false,
    path: '/_console/f/contact-us',
    prefix: '/_console/f/',
  },
  {
    name: 'a root-mounted console',
    basename: '/',
    at: '/developer/public-forms',
    nested: false,
    path: '/f/contact-us',
    prefix: '/f/',
  },
  {
    name: 'a /_console mount, reached through the metadata-driven component route',
    basename: '/_console',
    at: '/apps/crm/component/developer/public-forms',
    nested: true,
    path: '/_console/f/contact-us',
    prefix: '/_console/f/',
  },
] as const;

type Mount = (typeof MOUNTS)[number];

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

async function renderUnder(mount: Mount) {
  const entry = `${mount.basename === '/' ? '' : mount.basename}${mount.at}`;
  window.history.replaceState({}, '', entry);
  render(
    <BrowserRouter basename={mount.basename}>
      {mount.nested ? (
        <Routes>
          <Route path="/apps/:app/component/*" element={<PublicFormsPage />} />
        </Routes>
      ) : (
        <PublicFormsPage />
      )}
    </BrowserRouter>,
  );
  // The row exists once the listing has loaded.
  await screen.findByRole('button', { name: /Edit sharing & post-submit behavior/i });
}

/** Click one copy action and return exactly what it put on the clipboard. */
async function copiedBy(title: string): Promise<string> {
  const before = writeText.mock.calls.length;
  fireEvent.click(screen.getByTitle(title));
  await waitFor(() => expect(writeText.mock.calls.length).toBe(before + 1));
  return writeText.mock.calls[before][0] as string;
}

/** The prefix printed beside the open dialog's slug field. */
function slugFieldPrefix(): string {
  const field = screen.getByLabelText('URL slug');
  return (field.parentElement?.textContent ?? '').trim();
}

describe.each(MOUNTS)('Public Forms URL under $name (objectui#11769)', (mount) => {
  it('offers ORIGIN + basename + /f/SLUG as the link and the copied URL', async () => {
    await renderUnder(mount);
    const expected = `${window.location.origin}${mount.path}`;

    const link = screen.getByText(expected).closest('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', expected);

    const url = await copiedBy('Copy URL');
    expect(url).toBe(expected);
    expect(new URL(url).pathname).toBe(mount.path);
  });

  it('puts exactly the copied URL inside both snippets', async () => {
    await renderUnder(mount);
    const url = await copiedBy('Copy URL');

    const iframe = await copiedBy('Copy <iframe> embed');
    expect([...iframe.matchAll(/src="([^"]*)"/g)].map((m) => m[1])).toEqual([url]);

    const react = await copiedBy('Copy React snippet');
    expect([...react.matchAll(/src=\{`([^`]*)`\}/g)].map((m) => m[1])).toEqual([url]);
  });

  it('prints the same basename-prefixed route beside both slug fields', async () => {
    await renderUnder(mount);

    fireEvent.click(screen.getByRole('button', { name: /Publish form/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(slugFieldPrefix()).toBe(mount.prefix);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Edit sharing & post-submit behavior/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('URL slug')).toHaveValue(SLUG);
    expect(slugFieldPrefix()).toBe(mount.prefix);
  });

  it('shows no /console/f/ address anywhere on the page', async () => {
    await renderUnder(mount);
    // `/_console/f/` does not contain this substring: the character before
    // `console` there is `_`, not `/`.
    expect(document.body.textContent ?? '').not.toContain('/console/f/');
  });
});
