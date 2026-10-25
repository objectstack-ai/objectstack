// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's default cell draws the shared `EmptyValue`
 * (objectui#8504).
 *
 * ## The defect
 *
 * `defaultCell` — the renderer every column without its own `render` falls back
 * to — spelled `<span className="text-muted-foreground">—</span>` for a null or
 * empty value: no `data-slot`, no `aria-label`, and none of the shared
 * component's `select-none` / `no-underline` / `pointer-events-none`. A screen
 * reader crossing an empty Description cell heard a naked punctuation mark.
 *
 * The `pointer-events-none` half is not cosmetic here. `defaultCell`'s output
 * for column 0 is rendered INSIDE the row's `<Link>`, so a hand-rolled span
 * inherited the link colour and stayed selectable — a missing value that looked
 * clickable, the same affordance bug PR #8503 named in the grid's link cells.
 *
 * ## Which case DISCRIMINATES — MEASURED, not predicted
 *
 * The caricature was RUN: `defaultCell` rewritten to `return <EmptyValue />`
 * for every value, filled cells included.
 *
 *   - `exactly ONE of the two rows draws a placeholder` fails on "and the
 *     filled row does NOT" — the assertion that fails BECAUSE a filled cell
 *     gained a placeholder.
 *   - `NON-REGRESSION` fails one assertion earlier, on "the value reaches the
 *     cell": the caricature also stops the Description column printing
 *     descriptions, so its own `no placeholder` half is never reached.
 *   - `THE DEFECT` fails ONLY on its control. Its headline claim is equally
 *     true of a table that has stopped printing values.
 *   - The `SCOPE DECLARATION` case SURVIVES the caricature entirely — the one
 *     survivor in this PR's 21 cases — which is why it is labelled rather than
 *     quoted as proof.
 *
 * A first run of the caricature failed all three on the HARNESS instead — the
 * row lookup read column 0, which `defaultCell` also renders, so the name the
 * row was found by disappeared. The lookup now reads the row link's `href`.
 *
 * Reverting the fix turns `THE DEFECT` red on "the empty cell draws the shared
 * placeholder" and leaves `NON-REGRESSION` green.
 *
 * ## The visual delta
 *
 * `text-muted-foreground` (full opacity) becomes the shared
 * `text-muted-foreground/50`: one deliberate step more muted, plus the three
 * affordances and the accessible name. The glyph is unchanged.
 *
 * ## Harness notes
 *
 * The type is a name no `registry.ts` entry claims, so `resolveResourceConfig`
 * returns the bare default — no `ListPage`, no `listColumns`, no `listFilter` —
 * which is exactly the path `defaultCell` serves. `useMetadataLocale` is pinned
 * to `en-US` so the column lookup does not depend on the host's
 * `navigator.language`.
 *
 * Assertions are scoped to ONE cell of ONE row (objectui#8495: a table-wide
 * "no placeholder anywhere" assertion would fail against the correct
 * implementation the moment any other column is legitimately empty).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'proj_pkg';
const TYPE = 'demo_thing';

/** Rows the fake metadata client hands back for `list(TYPE)`. */
const mockItems: Record<string, unknown>[] = [
  { name: 'alpha', label: 'Alpha', description: 'A real description', _packageId: PKG },
  { name: 'beta', label: 'Beta', description: '', _packageId: PKG },
];

/**
 * A STABLE singleton, deliberately. The page's load effect keys on the client
 * identity, so a fresh object per render re-enters `setLoading(true)` forever:
 * measured as a page stuck on "Loading demo_thing…" whose header row never
 * exists, while the stats strip already reads "Filtered 2".
 */
const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [{ manifest: { id: PKG, scope: 'project', name: 'Project' } }]
      : type === TYPE
        ? mockItems
        : [],
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { t } from './i18n';

afterEach(cleanup);

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

const DESCRIPTION_HEADER = t('engine.list.col.description', 'en-US');

async function mount() {
  const { container } = render(
    <MemoryRouter initialEntries={[`/apps/studio/component/developer/${TYPE}`]}>
      <MetadataResourceListPage type={TYPE} />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(container.querySelectorAll('thead th').length).toBeGreaterThan(0),
  );
  await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(2));

  const headers = () =>
    Array.from(container.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

  /**
   * The cell under `header` in the row whose edit link points at `name`.
   *
   * The lookup deliberately reads the row LINK's `href`, not column 0's text.
   * Column 0 is itself rendered through `defaultCell`, so an
   * `EmptyValue`-everywhere implementation erases the name the row would be
   * found by — measured: all three cases went red on "the row for beta
   * rendered", i.e. on the harness, before any assertion about placeholders
   * could run. `href` is built from `name` independently of `defaultCell`, so
   * the caricature now has to be refused by the cases themselves.
   */
  const cell = (name: string, header: string): HTMLElement => {
    const idx = headers().indexOf(header);
    expect(idx, `the ${header} column is present — headers were ${JSON.stringify(headers())}`)
      .toBeGreaterThanOrEqual(0);
    const tr = Array.from(container.querySelectorAll('tbody tr')).find(
      (r) => r.querySelector(`a[href*="${name}"]`) !== null,
    );
    expect(tr, `the row for ${name} rendered`).toBeTruthy();
    const td = (tr as HTMLElement).querySelectorAll('td')[idx];
    expect(td, `the ${name} row has a cell under ${header}`).toBeTruthy();
    return td as HTMLElement;
  };
  return { cell };
}

describe('metadata list defaultCell uses the shared EmptyValue (objectui#8504)', () => {
  it('THE DEFECT — an empty cell carries an accessible name', async () => {
    const { cell } = await mount();
    const placeholder = emptyIn(cell('beta', DESCRIPTION_HEADER));

    expect(placeholder, 'the empty cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    expect((placeholder as HTMLElement).textContent, 'the glyph is unchanged').toBe('—');
    // CONTROL — without this, a table that renders NO values passes above.
    expect(
      within(cell('alpha', DESCRIPTION_HEADER)).queryByText('A real description'),
      'CONTROL: the sibling row still prints its description',
    ).not.toBeNull();
  });

  it('NON-REGRESSION — a FILLED cell renders its value and NO placeholder', async () => {
    const { cell } = await mount();
    const filled = cell('alpha', DESCRIPTION_HEADER);

    expect(within(filled).queryByText('A real description'), 'the value reaches the cell')
      .not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(filled), 'a filled cell carries NO placeholder').toBeNull();
  });

  it('exactly ONE of the two rows draws a placeholder', async () => {
    // Assertion order, measured: `NON-REGRESSION` above fails on its FIRST
    // assertion under the caricature — the description stops reaching the cell
    // — so its `no placeholder` half never runs. This case reaches it, and its
    // second assertion is the one that fails BECAUSE a filled cell gained a
    // placeholder.
    const { cell } = await mount();
    expect(emptyIn(cell('beta', DESCRIPTION_HEADER)), 'the empty row has one').not.toBeNull();
    expect(emptyIn(cell('alpha', DESCRIPTION_HEADER)), 'and the filled row does NOT').toBeNull();
  });

  it('SCOPE DECLARATION — the placeholder is inert inside the row link', async () => {
    // Column 0's cell is rendered inside the row's `<Link>`. The shared
    // component's `pointer-events-none` / `no-underline` / `select-none` are
    // what stop a missing value from reading as clickable there; the
    // hand-rolled span had none of them.
    //
    // ⚠️ Labelled a SCOPE DECLARATION because it was MEASURED as the one case
    // in this PR that the caricature survives: "the placeholder carries
    // pointer-events-none" is true of an implementation that draws `EmptyValue`
    // over every cell in the table. It goes red on the REVERT leg (there is no
    // placeholder to read a class off), so it holds what the hand-rolled span
    // lacked — it is not evidence that the placeholder is drawn CONDITIONALLY.
    // That evidence is `NON-REGRESSION`'s.
    const { cell } = await mount();
    const placeholder = emptyIn(cell('beta', DESCRIPTION_HEADER));
    // Guarded: an unguarded dereference fails with a bare TypeError and the
    // messages below never reach the summary (measured on the revert leg).
    expect(placeholder, 'the empty cell drew a placeholder to read classes off')
      .not.toBeNull();
    for (const cls of ['pointer-events-none', 'no-underline', 'select-none']) {
      expect((placeholder as HTMLElement).className, `the placeholder carries ${cls}`)
        .toContain(cls);
    }
  });
});
