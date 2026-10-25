// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Public Forms table's Object column draws the shared `EmptyValue`
 * (objectui#8504).
 *
 * ## The defect
 *
 * A form declaring no `object` fell to `<span
 * className="text-muted-foreground">—</span>` — no `data-slot`, no
 * `aria-label`, none of the shared component's `select-none` / `no-underline` /
 * `pointer-events-none`. In a column headed "Object", a screen-reader user
 * heard a naked punctuation mark while the row above announced "showcase_task".
 *
 * ## Reachability was CHECKED before the swap, not assumed
 *
 * This is the one carrier on the card that lives in `apps/`, not `packages/` —
 * an app's dependency tier, not a library's, and outside the packages-only
 * `git grep` pathspec every census in the thread used (a glob rooted at
 * `packages`, which never sees `apps`). Measured: `@object-ui/components`
 * is on `apps/console`'s `devDependencies` (`workspace:*`) and 29 files under
 * `apps/console/src` already import from it — this page among them. `EmptyValue`
 * joins an import list that was already there; no manifest edge was added, and
 * none was needed.
 *
 * ## Which case DISCRIMINATES — MEASURED, not predicted
 *
 * The caricature was RUN: the Object cell rewritten to `<EmptyValue />`
 * unconditionally, objects included. Every case goes red, on a different
 * assertion:
 *
 *   - `exactly ONE of the two rows draws a placeholder` fails on "and the
 *     filled row does NOT" — the assertion that fails BECAUSE a filled cell
 *     gained a placeholder.
 *   - `NON-REGRESSION` fails one assertion earlier, on "the object reaches the
 *     cell": the caricature also stops the column printing objects, so its own
 *     `no placeholder` half is never reached.
 *   - `THE DEFECT` fails ONLY on its control. Its headline claim — "the
 *     objectless row has an accessible name" — is equally true of a table that
 *     has stopped printing objects.
 *
 * Reverting the fix turns `THE DEFECT` and the one-of-two case red on their
 * headline assertions and leaves `NON-REGRESSION` green.
 *
 * ## The visual delta
 *
 * `text-muted-foreground` (full opacity) becomes the shared
 * `text-muted-foreground/50` — one deliberate step more muted, plus the three
 * affordances and the accessible name. The glyph is unchanged.
 *
 * Assertions are scoped to ONE cell of ONE row (objectui#8495).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
// The page asks the router where the anonymous route is served (objectui#11769),
// so it renders inside one, as it does in the app.
import { MemoryRouter } from 'react-router-dom';

/**
 * Two published public forms — one declaring an `object`, one not — on the
 * `ViewItem` shape `GET /meta/view` serves: the form under `config`, opened to
 * anonymous intake by the server's rule (`sharing.enabled`, `allowAnonymous`
 * and a `publicLink`; objectui#11545).
 *
 * `ViewItemSchema` requires `object`, so the objectless row is not a valid
 * ViewItem: it pins how the page draws a served item that names no object,
 * which is what the shared placeholder is for.
 */
const { ADAPTER } = vi.hoisted(() => {
  const form = (name: string, slug: string, object?: string) => ({
    name,
    label: name,
    ...(object ? { object } : {}),
    viewKind: 'form',
    config: {
      type: 'simple',
      sections: [{ label: 'Task', fields: ['title'] }],
      sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${slug}` },
    },
  });
  // A STABLE singleton: a fresh object per render loops the page's load effect.
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) =>
          type === 'view'
            ? [
                form('objectless_form', 'objectless'),
                form('showcase_task.task_form', 'log-time', 'showcase_task'),
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

afterEach(cleanup);

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

async function mount() {
  const { container } = render(<PublicFormsPage />, { wrapper: MemoryRouter });
  // `queryByText` THROWS on multiple matches, and the Name cell prints the
  // label and the name — so a single-match query never resolves here.
  await waitFor(() =>
    expect(screen.queryAllByText('objectless_form').length).toBeGreaterThan(0),
  );

  const headers = () =>
    Array.from(container.querySelectorAll('thead th')).map((th) =>
      (th.textContent ?? '').trim(),
    );

  /** The cell under `header` in the row whose Name cell reads `name`. */
  const cell = (name: string, header: string): HTMLElement => {
    const idx = headers().indexOf(header);
    expect(idx, `the ${header} column is present — headers were ${JSON.stringify(headers())}`)
      .toBeGreaterThanOrEqual(0);
    const tr = Array.from(container.querySelectorAll('tbody tr')).find((r) =>
      (r.textContent ?? '').includes(name),
    );
    expect(tr, `the row for ${name} rendered`).toBeTruthy();
    const td = (tr as HTMLElement).querySelectorAll('td')[idx];
    expect(td, `the ${name} row has a cell under ${header}`).toBeTruthy();
    return td as HTMLElement;
  };
  return { cell };
}

describe('PublicFormsPage object cell uses the shared EmptyValue (objectui#8504)', () => {
  it('THE DEFECT — a form declaring no object carries an accessible name', async () => {
    const { cell } = await mount();
    const placeholder = emptyIn(cell('objectless_form', 'Object'));

    expect(placeholder, 'the objectless cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    expect((placeholder as HTMLElement).textContent, 'the glyph is unchanged').toBe('—');
    // CONTROL — without this, a table printing NO objects passes above.
    expect(
      within(cell('task_form', 'Object')).queryByText('showcase_task'),
      'CONTROL: the sibling row still prints its object',
    ).not.toBeNull();
  });

  it('NON-REGRESSION — a form WITH an object renders its badge and NO placeholder', async () => {
    const { cell } = await mount();
    const filled = cell('task_form', 'Object');

    expect(within(filled).queryByText('showcase_task'), 'the object reaches the cell')
      .not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(filled), 'a cell with an object carries NO placeholder').toBeNull();
  });

  it('exactly ONE of the two rows draws a placeholder', () => {
    // The assertion order matters, and it was measured. `NON-REGRESSION` above
    // fails on its FIRST assertion under the caricature — the object stops
    // reaching the cell — so its `no placeholder` half never runs. This case
    // reaches that half: the empty row still has one, the filled row must not,
    // and the second assertion is the one that fails BECAUSE a filled cell
    // gained a placeholder.
    return mount().then(({ cell }) => {
      expect(emptyIn(cell('objectless_form', 'Object')), 'the empty row has one')
        .not.toBeNull();
      expect(emptyIn(cell('task_form', 'Object')), 'and the filled row does NOT')
        .toBeNull();
    });
  });
});
