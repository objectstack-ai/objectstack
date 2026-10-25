/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5896 — the console record page stops DROPPING an unmapped
 * `sys_activity.type`, and stops building its own `FeedItem`.
 *
 * ## What the defect did
 *
 * `RecordDetailView`'s `sys_activity` merge read the shared type table
 * (objectui#5878) and then built the item itself:
 *
 * ```ts
 * const feedType = ACTIVITY_TYPE_TO_FEED_TYPE[row.type];
 * if (!feedType) continue;
 * ```
 *
 * One `continue`, two completely different situations. A type the table maps
 * to `undefined` is a DECISION (`commented` / `mentioned` / `login` /
 * `logout`); a type the table does not contain at all is an AUTHOR-EXTENDED
 * value — `sys_activity.type` is author-extensible (objectstack#11507
 * direction 4, ruled 2026-08-24), every column on that table is `readonly` so
 * objectql never validates a write, and ADR-0052 §5b.2 forwards an author's
 * `activityMilestones[].type` into it verbatim. Both fell out of the loop the
 * same way, with nothing logged anywhere.
 *
 * So what the user saw was NOTHING: an activity that happened, was written,
 * and is queryable simply had no row on the record page, with no empty state,
 * no placeholder and no console message to explain the gap. That is
 * objectui#5840's failure mode reached by another route, and objectui#5969
 * (PR #6112) had already removed it from the BLOCK side — leaving the two
 * surfaces disagreeing about the same row of the same table.
 *
 * ## What it does now, and whose convention that is
 *
 * Not a new one. {@link activityRowToFeedItem} — the block's constructor,
 * shipped since #6112 — renders an unmapped type through
 * `UNMAPPED_ACTIVITY_FEED_TYPE` (`'system'`, the generic bucket, because
 * `FeedItemType` is a CLOSED spec enum and minting a kind for "we don't know"
 * is a platform change) and warns ONCE per distinct value. This card makes the
 * console surface CALL that constructor instead of paraphrasing it, so the
 * behaviour arrives as a consequence of there being one reading rather than as
 * a second decision.
 *
 * ## Why an identity leg, on top of the behaviour legs
 *
 * Every behavioural assertion below is also satisfied by inlining the fallback
 * and the warning into this view — i.e. by re-forking the constructor with
 * today's semantics, which is the drift this card exists to close and which
 * would pass ON that defect a release later. So the file also pins that the
 * merge goes THROUGH the exported function: a delegating spy installed over
 * the `@object-ui/plugin-detail` barrel, which records nothing at all if this
 * view builds its own item.
 *
 * The deliberate exclusions are the counter-probe in the same run: they must
 * still vanish, and still SILENTLY. Without them "everything renders" could be
 * reached by deleting the drop entirely, and a warning about a decision is the
 * noise that teaches authors to ignore the channel.
 *
 * ⛔ Out of scope, deliberately: objectui#5877 (the `FeedItemType` kinds no
 * objectui surface produces) reads the same construction site and is held back
 * as its own card. Nothing here censuses producers.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';

/**
 * The delegating spy over the SHARED constructor.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports. The
 * wrapper delegates to the real implementation — this is an identity probe,
 * never a behaviour stub, so every other leg in this file measures the real
 * `activityRowToFeedItem` running inside the real view.
 */
const shared = vi.hoisted(() => ({
  calls: [] as Array<{ row: any; label: string; item: unknown }>,
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-detail')>();
  return {
    ...actual,
    activityRowToFeedItem: (row: any, systemActorLabel: string) => {
      const item = actual.activityRowToFeedItem(row, systemActorLabel);
      shared.calls.push({ row, label: systemActorLabel, item });
      return item;
    },
  };
});

import {
  UNMAPPED_ACTIVITY_FEED_TYPE,
  resetUnknownActivityTypeWarnings,
} from '@object-ui/plugin-detail';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — stubbed so the only asynchrony in this file is the feed.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_account';
const RECORD_ID = 'rec-1';

/**
 * A value no table entry can plausibly acquire, shaped like something an
 * author would really write: ADR-0052 `activityMilestones[].type` lands here
 * verbatim, which is how `completed` is produced and how anything else can be.
 */
const AUTHOR_EXTENDED_TYPE = 'contract_countersigned';

/** Body text names the activity type, so a failure message says which row moved. */
const summaryFor = (type: string) => `activity row of type ${type}`;

const activityRow = (type: string, index: number, extra: Record<string, any> = {}) => ({
  id: `a-${index}`,
  type,
  actor_name: 'Grace',
  summary: summaryFor(type),
  timestamp: `2026-01-0${index + 1}T00:00:00.000Z`,
  ...extra,
});

function makeDataSource(activityRows: Array<Record<string, any>>) {
  return {
    find: vi.fn((objectName: string) =>
      Promise.resolve({ data: objectName === 'sys_activity' ? activityRows : [] }),
    ),
    create: vi.fn(async (_o: string, row: any) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({
      id: recordId,
      name: `Record ${recordId}`,
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Account',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

function makeMetadata() {
  return {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

/** Render the console record page over the seeded `sys_activity` rows. */
const renderWith = (rows: Array<Record<string, any>>) =>
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <RecordDetailView
          dataSource={makeDataSource(rows)}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );

/**
 * Only this file's diagnostic, so unrelated React noise cannot pad the count.
 *
 * Typed structurally rather than as `ReturnType<typeof vi.spyOn>`: that alias
 * erases the call signature, which leaves `c` and `m` implicitly `any` under
 * this package's `noImplicitAny`.
 */
const activityWarnings = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[record:activity]'));

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cleanup();
  shared.calls.length = 0;
  // Module-level warn-once bucket: without this a second test in the file
  // would measure the first test's silence and read as a regression.
  resetUnknownActivityTypeWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Unrelated chrome (approvals, favourites…) reaches for the platform API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetUnknownActivityTypeWarnings();
});

describe('an author-extended activity type is VISIBLE on the console record page (objectui#5896)', () => {
  it('SUBJECT — the row renders instead of vanishing', async () => {
    renderWith([activityRow('updated', 0), activityRow(AUTHOR_EXTENDED_TYPE, 1)]);

    // The defect, stated as the thing the user was denied: the row exists.
    expect(await screen.findByText(summaryFor(AUTHOR_EXTENDED_TYPE))).toBeTruthy();
    // Live control on the same read — a mapped row still arrives, so a missing
    // row above would mean "dropped", not "harness silent".
    expect(screen.getByText(summaryFor('updated'))).toBeTruthy();
  });

  it('carries the row, not a husk — the summary and the actor are the row\'s own', async () => {
    renderWith([activityRow(AUTHOR_EXTENDED_TYPE, 0)]);

    expect(await screen.findByText(summaryFor(AUTHOR_EXTENDED_TYPE))).toBeTruthy();
    const built = shared.calls.find((c) => c.row.type === AUTHOR_EXTENDED_TYPE)?.item as FeedItem;
    expect(built).toBeTruthy();
    expect(built).toMatchObject({
      id: 'a-0',
      type: UNMAPPED_ACTIVITY_FEED_TYPE,
      actor: 'Grace',
      body: summaryFor(AUTHOR_EXTENDED_TYPE),
    });
    // COUNTER-PROBE — the fallback is a FLOOR under the table, never a
    // replacement for it: a built-in still gets its own presentation, so
    // "everything renders" cannot be reached by bucketing the whole map.
    expect(UNMAPPED_ACTIVITY_FEED_TYPE).not.toBe('field_change');
  });

  it('says so — the drop is replaced by a rendered row PLUS a diagnostic', async () => {
    renderWith([activityRow(AUTHOR_EXTENDED_TYPE, 0)]);
    await screen.findByText(summaryFor(AUTHOR_EXTENDED_TYPE));

    const messages = activityWarnings(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(AUTHOR_EXTENDED_TYPE);
    // It reports a MISSING DECISION (the row is shown; what it lacks is its own
    // presentation), so it must name where the decision gets made.
    expect(messages[0]).toContain('ACTIVITY_TYPE_TO_FEED_TYPE');
  });

  it('warns ONCE per distinct type, however many rows carry it', async () => {
    renderWith([
      activityRow(AUTHOR_EXTENDED_TYPE, 0),
      activityRow(AUTHOR_EXTENDED_TYPE, 1),
      activityRow(AUTHOR_EXTENDED_TYPE, 2),
    ]);
    // `findAllByText` — three DISTINCT rows (ids `a-0`..`a-2`) carrying one
    // type, so they share a summary. All three must be on the page: the
    // dedupe below is over the DIAGNOSTIC, never over the rows.
    expect(await screen.findAllByText(summaryFor(AUTHOR_EXTENDED_TYPE))).toHaveLength(3);

    // A 200-row page of one unmapped type is ONE authoring mistake, not 200.
    await waitFor(() => expect(shared.calls).toHaveLength(3));
    expect(activityWarnings(warn)).toHaveLength(1);
  });

  it('gives the row a STRING `createdAt` when neither timestamp column is usable', async () => {
    // Divergence #2 of the card: the inline copy assigned `when = row.created_at`
    // and could hand `mergeFeedRows` an `undefined`; the shared constructor
    // yields `String(row.created_at ?? '')`. Measured on the item this surface
    // actually merged, which is the helper's — one constructor, one fallback.
    renderWith([activityRow('updated', 0, { timestamp: 'NOW()', created_at: undefined })]);

    await waitFor(() => expect(shared.calls).toHaveLength(1));
    expect((shared.calls[0].item as FeedItem).createdAt).toBe('');
  });
});

describe('the deliberate exclusions are untouched — still dropped, still silent', () => {
  it('a type mapped to `undefined` still produces no row and no warning', async () => {
    // Counter-probe for the whole file. `commented` / `mentioned` / `login` /
    // `logout` are DECISIONS (comment content lives in `sys_comment`; the other
    // two are account events, not record activity). The ruling that unmapped
    // types must be visible does not touch them, and warning about a decision
    // is what teaches authors to ignore the channel.
    renderWith([
      activityRow('updated', 0),
      activityRow('commented', 1),
      activityRow('mentioned', 2),
      activityRow('login', 3),
      activityRow('logout', 4),
    ]);

    expect(await screen.findByText(summaryFor('updated'))).toBeTruthy();
    await waitFor(() => {
      for (const type of ['commented', 'mentioned', 'login', 'logout']) {
        expect(screen.queryByText(summaryFor(type)), type).toBeNull();
      }
    });
    expect(activityWarnings(warn)).toHaveLength(0);
  });
});

describe('ONE constructor — the pin a re-fork cannot pass', () => {
  it('IDENTITY — the merge builds its items with the exported `activityRowToFeedItem`', async () => {
    // Independent of the behaviour legs on purpose: those are equally
    // satisfied by a second copy of today's semantics living in this view,
    // which is the drift this card closes. A copy never reaches this function,
    // so `shared.calls` stays empty however correct the rendering looks.
    renderWith([activityRow('updated', 0), activityRow(AUTHOR_EXTENDED_TYPE, 1)]);

    // Live control first: the merge definitely ran.
    expect(await screen.findByText(summaryFor('updated'))).toBeTruthy();
    await waitFor(() => {
      expect(
        shared.calls.map((c) => c.row.type),
        'RecordDetailView never called activityRowToFeedItem — it is building the FeedItem itself',
      ).toEqual(['updated', AUTHOR_EXTENDED_TYPE]);
    });
  });

  it('hands the constructor this surface\'s own system-actor label', async () => {
    // Divergence #3 of the card: two independently authored i18n lookups for
    // one fallback. There is one lookup now, and it is passed IN — so the
    // console page keeps its own localisation while sharing the construction.
    renderWith([activityRow('updated', 0, { actor_name: null })]);

    await waitFor(() => expect(shared.calls).toHaveLength(1));
    expect(shared.calls[0].label).toBe('System');
    expect((shared.calls[0].item as FeedItem).actor).toBe('System');
  });
});
