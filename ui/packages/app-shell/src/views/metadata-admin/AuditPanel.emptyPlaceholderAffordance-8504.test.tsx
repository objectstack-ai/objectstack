// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Audit tab's Lock column draws the shared `EmptyValue` (objectui#8504).
 *
 * ## The defect
 *
 * An unlocked row took `<span className="text-muted-foreground">—</span>` — no
 * `data-slot`, no `aria-label`, and none of the shared component's
 * `select-none` / `no-underline` / `pointer-events-none`. A screen reader
 * reaching that cell heard a naked punctuation mark, in a column headed "Lock".
 * `EmptyValue` from `@object-ui/components` answers exactly this, and
 * `@object-ui/app-shell` already depends on that package.
 *
 * ## What each case can and cannot discriminate — MEASURED
 *
 * The caricature was RUN, not predicted: `AuditPanel`'s lock cell rewritten to
 * `<EmptyValue />` unconditionally, locked rows included. All three cases go
 * red, but on different assertions, and the difference is the point:
 *
 *   - `keeps the em-dash branch for a null lockState` fails on "CONTROL: the
 *     locked sibling is still not a placeholder" — the ONE assertion here that
 *     fails BECAUSE a filled cell gained a placeholder.
 *   - `NON-REGRESSION` fails one assertion earlier, on "the lock state reaches
 *     the cell": under the caricature the column stops printing states at all,
 *     so its own `no placeholder` half is never reached.
 *   - `THE DEFECT` fails ONLY on its control. Its headline claim — "the empty
 *     cell has an accessible name" — is TRUE of a column that has given up on
 *     lock states, which is exactly why the control is not optional.
 *
 * Reverting the fix instead (the hand-rolled span restored) turns `THE DEFECT`
 * and the null-lockState case red on their headline assertions, and leaves
 * `NON-REGRESSION` green — the correct shape for a non-regression case.
 *
 * ## A deliberate visual change
 *
 * The retired span was `text-muted-foreground` (full opacity); the shared
 * component is `text-muted-foreground/50`. The placeholder is now one step more
 * muted than it was, which is the shared typography this card adopts, not an
 * accident. `NON-REGRESSION` pins that the surviving glyph is still an em dash,
 * so the change is opacity only.
 *
 * Every assertion below is scoped to ONE cell of ONE row (objectui#8495: a
 * container-wide "no placeholder anywhere" assertion fails against the correct
 * implementation as soon as some other column legitimately renders one).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  MetadataAuditEntry,
  MetadataClient,
} from '@object-ui/data-objectstack';
import { AuditPanel } from './AuditPanel';
import { t, translateConsoleValue } from './i18n';

afterEach(cleanup);

const LOCALE = 'en-US';
const EM_DASH = '—';

function auditRow(over: Partial<MetadataAuditEntry> = {}): MetadataAuditEntry {
  return {
    id: 'a_1',
    occurredAt: '2026-08-17T10:00:00.000Z',
    actor: 'admin@objectos.ai',
    source: 'protocol.saveMetaItem',
    operation: 'save',
    outcome: 'denied',
    code: 'item_locked',
    lockState: 'full',
    lockOverridden: false,
    requestId: null,
    note: null,
    ...over,
  };
}

/** Minimal stand-in — the panel only calls `audit()` on its client. */
function clientWith(events: MetadataAuditEntry[]): MetadataClient {
  const stub: Pick<MetadataClient, 'audit'> = { audit: async () => ({ events }) };
  return stub as MetadataClient;
}

async function renderPanel(rows: MetadataAuditEntry[]) {
  const { container } = render(
    <AuditPanel type="object" name="a_account" client={clientWith(rows)} locale={LOCALE} />,
  );
  // The panel loads in an effect; wait for the first row's actor cell to land.
  await screen.findByText(rows[0].actor);

  const headers = () =>
    Array.from(container.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());

  /** The cell under `header` within ONE row — never a container-wide lookup. */
  const cell = (rowIndex: number, header: string): HTMLElement => {
    const idx = headers().indexOf(header);
    expect(idx, `the ${header} column is present — headers were ${JSON.stringify(headers())}`)
      .toBeGreaterThanOrEqual(0);
    const tr = container.querySelectorAll('tbody tr')[rowIndex];
    expect(tr, `row ${rowIndex} rendered`).toBeTruthy();
    const td = tr.querySelectorAll('td')[idx];
    expect(td, `row ${rowIndex} has a cell under ${header}`).toBeTruthy();
    return td as HTMLElement;
  };
  return { cell };
}

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

const LOCK_HEADER = t('engine.edit.auditColLock', LOCALE);

describe('AuditPanel lock cell draws the shared EmptyValue (objectui#8504)', () => {
  it('THE DEFECT — an unlocked row carries an accessible name', async () => {
    const { cell } = await renderPanel([
      auditRow({ id: 'a_1', lockState: 'none' }),
      auditRow({ id: 'a_2', actor: 'ops@objectos.ai', lockState: 'no-delete' }),
    ]);
    const placeholder = emptyIn(cell(0, LOCK_HEADER));

    expect(placeholder, 'the unlocked cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    // CONTROL — without this, a column that renders NO lock states passes above.
    expect(
      within(cell(1, LOCK_HEADER)).queryByText(
        translateConsoleValue('lock', 'no-delete', LOCALE),
      ),
      'CONTROL: the sibling row still prints its lock state',
    ).not.toBeNull();
  });

  it('NON-REGRESSION — a LOCKED row prints its state and NO placeholder', async () => {
    const { cell } = await renderPanel([
      auditRow({ id: 'a_1', lockState: 'none' }),
      auditRow({ id: 'a_2', actor: 'ops@objectos.ai', lockState: 'full' }),
    ]);
    const locked = cell(1, LOCK_HEADER);

    expect(
      within(locked).queryByText(translateConsoleValue('lock', 'full', LOCALE)),
      'the lock state reaches the cell',
    ).not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(locked), 'a locked cell carries NO placeholder').toBeNull();
    // The visual delta is opacity only — the glyph itself did not change.
    // Guarded first: an unguarded dereference fails with a bare TypeError and
    // the message below never reaches the summary (measured on the revert leg).
    const unlocked = emptyIn(cell(0, LOCK_HEADER));
    expect(unlocked, 'the unlocked sibling still draws a placeholder').not.toBeNull();
    expect(
      (unlocked as HTMLElement).textContent,
      'the unlocked cell still reads as an em dash',
    ).toBe(EM_DASH);
  });

  it('keeps the em-dash branch for a null lockState', async () => {
    const { cell } = await renderPanel([
      auditRow({ id: 'a_1', lockState: null }),
      auditRow({ id: 'a_2', actor: 'ops@objectos.ai', lockState: 'full' }),
    ]);
    expect(emptyIn(cell(0, LOCK_HEADER)), 'a null lockState is empty too').not.toBeNull();
    expect(
      emptyIn(cell(1, LOCK_HEADER)),
      'CONTROL: the locked sibling is still not a placeholder',
    ).toBeNull();
  });
});
