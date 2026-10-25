// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The last two hand-rolled empty states under `metadata-admin/previews/`
 * (objectui#8570). PR #8569 migrated the block-level family and its scope cut
 * short of these two; the card that follows it described both as "a word
 * standing in for an absent SCALAR". Reading their predicates and their
 * non-empty arms says otherwise, and that reading is what these pins hold:
 *
 *   DatasourcePreview  `Object.keys(value).length > 0`  → populated arm: a <dl>
 *   ValidationPreview  `fields.length === 0`            → populated arm: a chip row
 *
 * Both are empty-COLLECTION statements. Only their LAYOUT was inline, never
 * their semantics — so both take the family's block-level text slot, and the
 * `EmptyValue` field-value placeholder (whose accessible name says "No value",
 * false about a collection) stays out of it.
 *
 * ⚠️ What is deliberately NOT pinned: the words. A pin on the string "not
 * configured" reddens the next time someone rewords the sentence and protects
 * nothing about the structure that was actually ruled on. These assert what
 * REACHES THE DOM — the shared carrier's `data-slot`.
 *
 * ⚠️ The lit control is the populated leg, and it is not decoration. Fed a
 * NON-empty input the same component must render the collection and NO
 * empty-description at all. Without it, "the empty state was not drawn" and
 * "the test never reached the component" are the same green.
 *
 * ⚠️ Navigation vs. assertion (the discipline `emptyCollection-8526.test.tsx`
 * establishes, and the reason it is repeated rather than referenced): every
 * harness reaches the CONTAINER by a title the container itself renders, never
 * by anything the empty state renders and never by a child index. A pin that
 * navigated by `data-slot="empty-description"` would die on any caricature
 * that erases the description and read as a strong refusal while measuring
 * nothing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, within, cleanup } from '@testing-library/react';

vi.mock('../external/ExternalDatasourcePanel', () => ({
  ExternalDatasourcePanel: () => <div data-testid="mock-external-panel" />,
}));

import { DatasourcePreview } from './DatasourcePreview';
import { ValidationPreview } from './ValidationPreview';

afterEach(cleanup);

const ED = '[data-slot="empty-description"]';
const EV = '[data-slot="empty-value"]';

/** The block that owns a site, reached by the TITLE it renders. See the docblock. */
function blockByTitle(title: string): HTMLElement {
  const titleEl = within(document.body).getByText(title);
  const header = titleEl.tagName === 'SPAN' ? titleEl.parentElement! : titleEl;
  const block = header.parentElement as HTMLElement | null;
  expect(block, `the block titled "${title}"`).toBeTruthy();
  return block!;
}

// ───────────────────────── DatasourcePreview — the side rail ─────────────────────────

describe('DatasourcePreview side rail: an unconfigured key group', () => {
  const DS = {
    name: 'warehouse',
    driver: 'postgres',
    config: { host: 'db.internal' },
    ssl: { enabled: true },
  };
  const render_ = (draft: Record<string, unknown>) =>
    render(<DatasourcePreview type="datasource" name="warehouse" draft={draft} />);

  it('no pool keys is the shared empty-description slot, not an EmptyValue glyph', () => {
    render_(DS); // `pool` absent
    const block = blockByTitle('Pool');
    expect(block.querySelector(ED), 'the shared EmptyDescription slot').toBeTruthy();
    expect(block.querySelector(EV)).toBeNull();
    expect(block.querySelector('dl'), 'no definition list in the empty branch').toBeNull();
  });

  it('carries THIS rail\'s 11px, not the 12px of the site 66 lines above it', () => {
    // The one thing the migration had to decide, so the one styling fact worth
    // holding. The shared base ships `text-sm/relaxed`; `cn()` is
    // `twMerge(clsx(…))`, so a size passed in COLLAPSES it — and a size not
    // passed leaves the word at 14px, non-italic, in a rail body that renders
    // at 11px. Asserting the collapse happened is asserting the word did not
    // silently grow.
    render_(DS);
    const cls = blockByTitle('Pool').querySelector(ED)!.className;
    expect(cls).toContain('text-[11px]');
    expect(cls).toContain('italic');
    expect(cls).not.toContain('text-sm');
  });

  it('LIT CONTROL — declared pool keys render the <dl> and no empty-description', () => {
    render_({ ...DS, pool: { min: 2, max: 10 } });
    const block = blockByTitle('Pool');
    expect(block.querySelector('dl'), 'the populated definition list').toBeTruthy();
    expect(within(block).getByText('min:')).toBeTruthy();
    expect(block.querySelector(ED)).toBeNull();
  });

  it('the two rail groups move independently — SSL populated while Pool is empty', () => {
    render_(DS);
    expect(blockByTitle('SSL').querySelector('dl')).toBeTruthy();
    expect(blockByTitle('SSL').querySelector(ED)).toBeNull();
    expect(blockByTitle('Pool').querySelector(ED)).toBeTruthy();
  });
});

// ──────────────────── ValidationPreview — the cross_field chip row ────────────────────

describe('ValidationPreview cross_field: a rule involving no fields', () => {
  const BASE = {
    name: 'date_order',
    label: 'End after start',
    message: 'end_date must follow start_date.',
    severity: 'error',
    active: true,
    type: 'cross_field',
    condition: 'record.end_date < record.start_date',
  };
  const render_ = (draft: Record<string, unknown>) =>
    render(<ValidationPreview type="validation" name="date_order" draft={draft} />);

  it('an empty field list is the shared empty-description slot, not an EmptyValue glyph', () => {
    render_({ ...BASE, fields: [] });
    const block = blockByTitle('Fields involved');
    expect(block.querySelector(ED), 'the shared EmptyDescription slot').toBeTruthy();
    expect(block.querySelector(EV)).toBeNull();
  });

  it('the slot sits INSIDE the flex chip row, which is what keeps the layout put', () => {
    render_({ ...BASE, fields: [] });
    const slot = blockByTitle('Fields involved').querySelector(ED)!;
    // A flex container blockifies its children, so the shared <div> occupies
    // the same box the hand-rolled <span> did. Assert the parenthood that
    // makes that true, not the pixels: a slot hoisted out of the row would
    // still be found by the query above.
    expect(slot.parentElement!.className).toContain('flex');
    expect(slot.parentElement!.className).toContain('flex-wrap');
  });

  it('LIT CONTROL — involved fields render their chips and no empty-description', () => {
    render_({ ...BASE, fields: ['start_date', 'end_date'] });
    const block = blockByTitle('Fields involved');
    expect(within(block).getByText('start_date')).toBeTruthy();
    expect(within(block).getByText('end_date')).toBeTruthy();
    expect(block.querySelector(ED)).toBeNull();
  });
});
