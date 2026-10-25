// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Audit tab's lock column speaks the UI language (objectui#5004).
 *
 * `AuditPanel` renders `MetadataAuditEntry.lockState` through
 * `translateConsoleValue('lock', …)`, and `CONSOLE_VALUE_ZH.lock` used to hold
 * `draft` / `locked` / `published` / `none` — a draft-status vocabulary, not the
 * ADR-0010 §3.6 four-state lock. Alignment was total, not partial:
 *
 *   - `draft` / `locked` / `published` matched NO value `lockState` can hold;
 *   - `none`, the one entry that did match, is excluded by the call site's own
 *     guard (an unlocked row renders an em dash), so it was unreachable;
 *   - the three values that DO reach the helper — `no-overlay` / `no-delete` /
 *     `full` — had no entry, so zh-CN fell through to the raw token.
 *
 * Hit rate 0/3: a zh-CN admin opening any locked item's Audit panel read bare
 * English in a column headed 锁状态.
 *
 * The state list below is bound to `MetadataAuditEntry['lockState']` itself
 * rather than spelled freely, so a fifth lock state is covered by these cases
 * the moment the vocabulary gains it. That field is `MetadataLockState` since
 * objectui#5024, derived from `GetMetaItemLayeredResponseSchema`'s `z.enum` —
 * so unlike what this comment first claimed, objectui#4982's overlay scopes are
 * NOT the odd one out: the spec declares this enum too (17.1.0). The
 * `satisfies`-checked key trick is kept over a runtime `.options` array because
 * it fails at `type-check` rather than at run time, which is the earlier of the
 * two; nothing about the derivation forces the choice either way. (The compile-time half of the coverage is
 * `LOCK_STATE_ZH` in `./i18n`, whose key type is that union: a new state with no
 * zh-CN label fails `type-check` before it can reach the column.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type {
  MetadataAuditEntry,
  MetadataClient,
} from '@object-ui/data-objectstack';
import { AuditPanel } from './AuditPanel';
import { translateConsoleValue } from './i18n';

afterEach(cleanup);

type LockState = NonNullable<MetadataAuditEntry['lockState']>;

/**
 * Every lock state the producer type can send. `satisfies` makes the record
 * exhaustive in both directions — a state added to the union leaves a key
 * missing, a state renamed leaves an extra one — so this list cannot drift from
 * `lockState` without failing `type-check`.
 */
const ALL_LOCK_STATES = Object.keys({
  none: 0,
  'no-overlay': 0,
  'no-delete': 0,
  full: 0,
} satisfies Record<LockState, 0>) as LockState[];

/** The states the column actually prints — `none` takes the em-dash branch. */
const RENDERED_LOCK_STATES = ALL_LOCK_STATES.filter((s) => s !== 'none');

/** The draft-status entries the table used to hold, none of them a lock state. */
const RETIRED_ENTRIES = ['draft', 'locked', 'published'];

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
  const stub: Pick<MetadataClient, 'audit'> = {
    audit: async () => ({ events }),
  };
  return stub as MetadataClient;
}

async function renderPanel(over: Partial<MetadataAuditEntry>, locale: string) {
  render(
    <AuditPanel
      type="object"
      name="a_account"
      client={clientWith([auditRow(over)])}
      locale={locale}
    />,
  );
  // The panel loads in an effect; wait for the row's actor cell to land.
  await screen.findByText('admin@objectos.ai');
}

describe('AuditPanel lock-state column (objectui#5004)', () => {
  it('every lock state the union can hold has a zh-CN label', () => {
    for (const state of ALL_LOCK_STATES) {
      expect(
        translateConsoleValue('lock', state, 'zh-CN'),
        `CONSOLE_VALUE_ZH.lock has no entry for lock state '${state}'`,
      ).not.toBe(state);
    }
  });

  it.each(RENDERED_LOCK_STATES)('renders the zh-CN label for lockState=%s', async (state) => {
    await renderPanel({ lockState: state }, 'zh-CN');
    const zh = translateConsoleValue('lock', state, 'zh-CN');
    expect(screen.getByText(zh)).toBeInTheDocument();
    // The raw producer token must not be on screen anywhere.
    expect(screen.queryByText(state)).toBeNull();
  });

  it('keeps the em-dash branch for an unlocked row', async () => {
    await renderPanel({ lockState: 'none' }, 'zh-CN');
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
    // `none` has a label, but the guard at the call site means the column never
    // asks for it — the em dash is the unlocked presentation, not a fallback.
    expect(screen.queryByText(translateConsoleValue('lock', 'none', 'zh-CN'))).toBeNull();
  });

  it('keeps the em-dash branch for a null lockState', async () => {
    await renderPanel({ lockState: null }, 'zh-CN');
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
  });

  it('keeps the override star next to the localized label', async () => {
    // `lockOverridden` appends ' *' as a sibling text node; pinned so the label
    // change did not disturb the forced-write marker.
    await renderPanel({ lockState: 'no-delete', lockOverridden: true }, 'zh-CN');
    const zh = translateConsoleValue('lock', 'no-delete', 'zh-CN');
    expect(screen.getByText(`${zh} *`)).toBeInTheDocument();
  });

  it('leaves the raw value alone outside zh — the helper has always done that', async () => {
    // `translateConsoleValue` returns the input verbatim for every non-zh
    // locale. Whether the other nine locale packs should gain these values is a
    // separate decision, deliberately not made here; this case pins that this
    // fix did not quietly make it.
    await renderPanel({ lockState: 'no-overlay' }, 'en-US');
    expect(screen.getByText('no-overlay')).toBeInTheDocument();
  });

  it('does not resurrect the draft-status entries as lock labels', async () => {
    // The three retired keys are values `lockState` cannot hold. Falling through
    // to the raw token is the correct answer for them now — an entry here would
    // be another 0-hit-rate row, which is the defect this file guards.
    for (const stale of RETIRED_ENTRIES) {
      expect(translateConsoleValue('lock', stale, 'zh-CN')).toBe(stale);
    }
  });
});
