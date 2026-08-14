// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// System Overview tile label/query agreement (#7531, extended by #7613).
//
// All four Row 1 tiles on the shipped board reported something other than what
// their labels promised, and three of them for one reason: the dashboard's
// `created_at` global filter is broadcast into EVERY widget's analytics query
// (#2501), and a `created_at` column happens to exist on `sys_user`,
// `sys_organization` and `sys_package_installation` alike — so each "Total"
// quietly became a 7-day count. "Active Sessions" was the fourth and carried a
// second cause of its own: the dataset is a bare count and the widget had no
// predicate at all. Every number was LIVE and correct for the query issued —
// the query was answering a different question from the one on the card.
//
// #7531 fixed "Total Users" and "Active Sessions". #7613 fixed the two left on
// the same row, "Organizations" and "Packages Installed", and extended this
// file with their fixtures and blocks.
//
// # What this file pins, and what it deliberately does not
//
// ⛔ NOT a snapshot. A test that freezes today's numbers goes green again on the
// day the label drifts back, which is the one failure this card exists to stop.
// What is pinned is the PROPERTY: the question a tile's label asks and the
// question its effective query answers are the same question.
//
//   - a TOTAL is invariant under the date bar — the same rows whatever window
//     is selected, and none at all when it is cleared;
//   - an ACTIVE count equals an active-only count computed independently from
//     the fixture, and equals it at NOW rather than within a window;
//   - a tile's OWN predicate is orthogonal to that opt-out and survives it —
//     opting out of the date bar decides HOW MANY rows count, never WHICH.
//
// Each assertion carries its OPPOSITE DIRECTION in the same block, because
// every one of them has a way to pass vacuously:
//
//   - "the total does not move" also holds if the harness never applies a
//     window at all ⇒ a control widget on the same board (an audit tile, which
//     the date bar legitimately scopes) must MOVE across the same two windows;
//   - "the total does not move" also holds if the fixture has no rows outside
//     the window ⇒ the same tile computed WITHOUT its opt-out must report a
//     strictly smaller number on this fixture, so deleting `filterBindings`
//     turns the first assertion red;
//   - "the sessions count is active-only" also holds if the predicate matched
//     nothing, or everything ⇒ the kept set is named row by row, and both the
//     expired and the revoked row must be dropped while an OLD-but-live session
//     is kept;
//   - "the `status` predicate still applies" also holds if the date bar had
//     already removed the rows it was supposed to drop ⇒ the fixture carries a
//     non-installed row INSIDE the 7-day window as well as outside it, and the
//     claim is checked with the bar set and with it cleared.
//
// ⛔ Every "still bound" control in this file is an AUDIT widget, and that is a
// deliberate choice rather than an arbitrary pick. An audit tile is *correctly*
// windowed — scoping rows 2-4 is what the date bar was added for — so it stays
// bound by intent and is a legitimate control. A Row 1 tile is not: before
// #7613, `widget_organizations` was "still bound" too, and would have served as
// a control here perfectly well, which is exactly the problem — pinning it that
// way would have written this bug into the suite as the expected behaviour.
// Need another control? Take another audit widget.
//
// # Why the query is composed here rather than imported
//
// The broadcast itself lives in objectui (`DashboardRenderer` merges each
// dashboard-level filter into a widget's `DatasetSelection`), so no code in
// THIS repo performs it. `composeWidgetQuery` below applies the precedence the
// contract states on `DashboardWidgetSchema.filterBindings` — string re-targets,
// `false` opts out, absent inherits the filter's own `field` — the same rule
// `@objectstack/lint`'s `effectiveFilterField` mirrors for the static gate.
//
// Everything downstream of that composition is the REAL machinery, not a
// re-implementation: `resolveFilterTokens` is the shipped resolver the analytics
// dataset executor applies to a widget's `runtimeFilter`, and
// `matchesFilterCondition` is one of the backends the repo holds to the shared
// `FILTER_LOGIC_CASES` table. So a `{now}` that stopped resolving, or a `$gt`
// that stopped meaning `$gt`, fails here.

import { describe, it, expect } from 'vitest';
import { resolveFilterTokens } from '@objectstack/core';
import { matchesFilterCondition } from '@objectstack/formula';
import type { FilterCondition } from '@objectstack/spec/data';
import { SystemOverviewDashboard } from './system_overview.dashboard.js';

/** One fixed instant, so nothing in this file depends on the wall clock. */
const NOW = new Date('2026-08-11T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);
const daysAhead = (n: number): Date => new Date(NOW.getTime() + n * DAY_MS);

interface Widget {
  id?: string;
  filter?: FilterCondition;
  filterBindings?: Record<string, string | false>;
}
interface GlobalFilter {
  name?: string;
  field?: string;
}
const board = SystemOverviewDashboard as unknown as {
  widgets?: Widget[];
  globalFilters?: GlobalFilter[];
};

const widgetById = (id: string): Widget => {
  const w = (board.widgets ?? []).find((x) => x.id === id);
  if (!w) throw new Error(`no widget "${id}" on the System Overview board`);
  return w;
};

/**
 * The effective query a widget issues: every dashboard-level filter it is bound
 * to, ANDed with the widget's own presentation-scope `filter`, with `{token}`
 * placeholders resolved at {@link NOW}.
 *
 * `windowDays: null` models the date bar cleared. `ignoreOptOut` models the
 * PRE-#7531 board — the broadcast reaching a widget that today opts out — and
 * exists only so each invariance claim can be shown to be load-bearing on this
 * fixture rather than true by accident.
 */
function composeWidgetQuery(
  widgetId: string,
  windowDays: number | null,
  opts: { ignoreOptOut?: boolean } = {},
): FilterCondition | undefined {
  const widget = widgetById(widgetId);
  const conjuncts: FilterCondition[] = [];

  if (windowDays !== null) {
    for (const gf of board.globalFilters ?? []) {
      if (!gf.field) continue;
      const name = gf.name ?? gf.field;
      const binding = widget.filterBindings?.[name];
      if (binding === false && !opts.ignoreOptOut) continue;
      const field = typeof binding === 'string' ? binding : gf.field;
      conjuncts.push({
        [field]: { $gte: daysAgo(windowDays).toISOString(), $lte: NOW.toISOString() },
      } as FilterCondition);
    }
  }

  if (widget.filter) conjuncts.push(widget.filter);

  const merged =
    conjuncts.length === 0 ? undefined
      : conjuncts.length === 1 ? conjuncts[0]
        : ({ $and: conjuncts } as FilterCondition);

  return merged === undefined ? undefined : resolveFilterTokens(merged, { now: NOW });
}

const keep = <T extends Record<string, unknown>>(
  rows: T[],
  filter: FilterCondition | undefined,
): T[] => rows.filter((r) => matchesFilterCondition(r, filter));

// ── Fixtures ────────────────────────────────────────────────────────────────
// Every set deliberately straddles the 7-day window, because a fixture whose
// rows are all recent makes every assertion in this file pass for free — which
// is the exact trap the card describes ("on a fresh datastore this is
// indistinguishable from the true total").

const USERS = [
  { id: 'u_founding', created_at: daysAgo(400) },
  { id: 'u_last_quarter', created_at: daysAgo(200) },
  { id: 'u_this_week', created_at: daysAgo(2) },
];

const ORGANIZATIONS = [
  { id: 'o_founding', created_at: daysAgo(400) },
  { id: 'o_last_quarter', created_at: daysAgo(200) },
  { id: 'o_this_week', created_at: daysAgo(2) },
];

const AUDIT_EVENTS = [
  { id: 'e_ancient', action: 'login', created_at: daysAgo(400) },
  { id: 'e_old', action: 'login', created_at: daysAgo(200) },
  { id: 'e_recent', action: 'login', created_at: daysAgo(2) },
];

const PACKAGE_INSTALLATIONS = [
  // Installed long ago and still installed — the row the opt-out is FOR.
  { id: 'p_legacy', status: 'installed', created_at: daysAgo(400) },
  { id: 'p_last_quarter', status: 'installed', created_at: daysAgo(200) },
  { id: 'p_this_week', status: 'installed', created_at: daysAgo(2) },
  // Not installed. These must be dropped by the widget's own `status`
  // predicate, and one of them sits INSIDE the 7-day window on purpose: with
  // only the old one, "the predicate still applies" would also pass on a board
  // where the date bar had quietly removed it.
  { id: 'p_failed_this_week', status: 'failed', created_at: daysAgo(2) },
  { id: 'p_uninstalled_long_ago', status: 'uninstalled', created_at: daysAgo(400) },
];

/**
 * "Installed" computed from the fixture directly, with no reference to the
 * board — the same independence {@link ACTIVE_SESSIONS} has, and for the same
 * reason: deriving it from the widget's own filter would make the comparison a
 * tautology.
 */
const INSTALLED_PACKAGES = PACKAGE_INSTALLATIONS.filter((p) => p.status === 'installed');

const SESSIONS = [
  // Signed in this week, still valid — active by any reading.
  { id: 's_active', created_at: daysAgo(2), expires_at: daysAhead(1), revoked_at: null },
  // The row the date-bar opt-out is FOR: signed in long ago on a long-lived
  // token and still live right now. An "Active Sessions" tile that windows on
  // `created_at` drops it.
  { id: 's_old_active', created_at: daysAgo(400), expires_at: daysAhead(30), revoked_at: null },
  // Lapsed: never revoked, but the token is past its expiry.
  { id: 's_expired', created_at: daysAgo(2), expires_at: daysAgo(1), revoked_at: null },
  // Signed out (or revoked by idle/absolute/admin policy, ADR-0069 D4) while
  // the token itself is still within its expiry window.
  { id: 's_revoked', created_at: daysAgo(2), expires_at: daysAhead(1), revoked_at: daysAgo(0.125) },
];

/**
 * "Active" computed from the fixture directly, with no reference to the board.
 * This is the INDEPENDENT count the tile has to match — deriving it from the
 * widget's own filter would make the comparison a tautology.
 */
const ACTIVE_SESSIONS = SESSIONS.filter(
  (s) => s.revoked_at == null && s.expires_at.getTime() > NOW.getTime(),
);

// ── The date bar is still a date bar ─────────────────────────────────────────

describe('the dashboard filter the Row 1 inventory tiles opt out of', () => {
  // `filterBindings` is keyed by the filter's NAME, which defaults to its
  // `field`. Give the global filter an explicit `name` and every opt-out below
  // silently stops matching — the widgets go back to being windowed, with no
  // gate anywhere to say so. So the key is pinned, not assumed.
  it('is still named `created_at`', () => {
    const names = (board.globalFilters ?? []).map((gf) => gf.name ?? gf.field);
    expect(names).toContain('created_at');
  });

  // The opposite direction for the change as a whole: the fix must not have
  // disabled the date bar wholesale. The audit rows are what it exists to
  // scope, and they must all still inherit it.
  it('still reaches every audit widget', () => {
    const auditWidgets = [
      'widget_login_events',
      'widget_config_changes',
      'widget_events_by_type',
      'widget_events_by_user',
      'widget_recent_events',
    ];
    for (const id of auditWidgets) {
      expect(widgetById(id).filterBindings?.created_at, `${id} must stay windowed`).not.toBe(false);
    }
  });
});

// ── Tombstone: no tile filters on a retired action value ────────────────────
//
// The board carried a "Permission Changes" tile filtering
// `action: 'permission_change'` for its whole life. Nothing ever wrote that
// value — the only two `sys_audit_log` writers are plugin-audit's generic hook
// (`actionFor` maps afterInsert/Update/Delete to create/update/delete and
// nothing else) and plugin-auth's admin user-import — so the tile reported `0`
// on every deployment that has ever existed, and the value was then retired
// from the enum outright. `export` retired alongside it.
//
// This is the same defect class as the rest of this file, one level up: not "the
// query answers a different question from the label" but "the query can answer
// nothing at all, under a label that implies it did". On a COMPLIANCE board the
// empty tile is the more dangerous of the two — "Permission Changes: 0" reads as
// a negative finding, not as an absent feature.
//
// ⚠️ `import` is NOT on this list and must not be added. It was named in the
// same ruling but survives with a live writer (plugin-auth's admin user-import
// writes a run-level row) and a shipped list view that filters it. Retiring it
// from the UI while the platform still emits it would produce the inverse defect
// — an action that can be written but not found.
//
// Why hard-coded rather than diffed against the enum: `sys_audit_log` lives in
// `@objectstack/plugin-audit`, which this package does not depend on (the audit
// objects moved OUT of here under ADR-0029 K2/D8) — and it must not start
// depending on it for a test. Hard-coded ids checked one by one is the same
// disposition `setup-nav-dead-key-tombstone.test.ts` records for the same
// reason.
describe('retired `sys_audit_log.action` values are gone from the board', () => {
  const RETIRED_ACTIONS = ['permission_change', 'export'];

  const actionFilterOf = (w: { filter?: FilterCondition }): unknown =>
    (w.filter as Record<string, unknown> | undefined)?.action;

  it('no widget filters on one', () => {
    const offenders = (board.widgets ?? [])
      .filter((w) => RETIRED_ACTIONS.includes(String(actionFilterOf(w))))
      .map((w) => `${w.id} → action=${String(actionFilterOf(w))}`);
    expect(offenders, 'widgets filtering a retired audit action').toEqual([]);
  });

  it('and the removed tile itself is not back', () => {
    expect((board.widgets ?? []).map((w) => w.id)).not.toContain('widget_permission_changes');
  });

  // Opposite direction. Both assertions above also pass on a board with no
  // widgets, or if `filter.action` stopped being where a tile's action
  // predicate lives — in which case they would be pinning nothing at all. A
  // LIVE action filter must still be visible through exactly the same read.
  it('opposite direction — a live action filter is still found by the same read', () => {
    const live = (board.widgets ?? [])
      .map((w) => actionFilterOf(w))
      .filter((a): a is string => typeof a === 'string');
    expect(live, 'the board still filters on live actions').toContain('login');
    expect(live).toContain('config_change');
  });
});

// ── Tile 1: "Total Users" ───────────────────────────────────────────────────

describe('widget_total_users — "Total" means total', () => {
  it('reports the same users under any date-range window, and with none', () => {
    for (const windowDays of [7, 30, 365, null]) {
      expect(
        keep(USERS, composeWidgetQuery('widget_total_users', windowDays)).map((u) => u.id),
        `window=${windowDays}`,
      ).toEqual(['u_founding', 'u_last_quarter', 'u_this_week']);
    }
  });

  it('opposite direction — the harness really does apply the window (an audit tile moves)', () => {
    // Without this, "the total does not move" would also be satisfied by a
    // harness that never applied a date predicate to anything.
    expect(keep(AUDIT_EVENTS, composeWidgetQuery('widget_events_by_type', 7)).map((e) => e.id))
      .toEqual(['e_recent']);
    expect(keep(AUDIT_EVENTS, composeWidgetQuery('widget_events_by_type', 365)).map((e) => e.id))
      .toEqual(['e_old', 'e_recent']);
  });

  it('opposite direction — the opt-out is load-bearing on this fixture', () => {
    // The pre-#7531 board, on the same rows: two of the three users disappear
    // under a label that says "Total". If `filterBindings` is ever dropped, the
    // first assertion in this block goes red rather than quietly passing.
    const windowed = keep(USERS, composeWidgetQuery('widget_total_users', 7, { ignoreOptOut: true }));
    expect(windowed.map((u) => u.id)).toEqual(['u_this_week']);
    expect(windowed.length).toBeLessThan(USERS.length);
  });
});

// ── Tile 2: "Active Sessions" ───────────────────────────────────────────────

describe('widget_active_sessions — "Active" means active now', () => {
  it('matches an independently-computed active-only count, under any window', () => {
    expect(ACTIVE_SESSIONS.map((s) => s.id)).toEqual(['s_active', 's_old_active']);
    for (const windowDays of [7, 30, 365, null]) {
      expect(
        keep(SESSIONS, composeWidgetQuery('widget_active_sessions', windowDays)).map((s) => s.id),
        `window=${windowDays}`,
      ).toEqual(ACTIVE_SESSIONS.map((s) => s.id));
    }
  });

  it('opposite direction — the predicate drops the expired and the revoked row', () => {
    // "Equals the active-only count" would also hold if the predicate kept
    // everything and the fixture happened to be all-active. It does not:
    // the fixture carries one lapsed and one signed-out session, and the tile's
    // number must be strictly below the raw row count it used to report.
    const kept = keep(SESSIONS, composeWidgetQuery('widget_active_sessions', null));
    expect(SESSIONS).toHaveLength(4);
    expect(kept).toHaveLength(2);
    expect(kept.map((s) => s.id)).not.toContain('s_expired');
    expect(kept.map((s) => s.id)).not.toContain('s_revoked');
  });

  it('opposite direction — an old-but-live session is counted, and windowing would drop it', () => {
    // The half of this tile's fix that is about the date bar rather than the
    // predicate. `s_old_active` is unambiguously active; a tile that windows on
    // `created_at` reports it as gone.
    const windowed = keep(
      SESSIONS,
      composeWidgetQuery('widget_active_sessions', 7, { ignoreOptOut: true }),
    );
    expect(windowed.map((s) => s.id)).toEqual(['s_active']);
    expect(windowed.length).toBeLessThan(ACTIVE_SESSIONS.length);
  });
});

// ── Tile 3: "Organizations" ─────────────────────────────────────────────────
// #7613. The plainest instance of the #2501 fan-out on this row: no widget
// predicate of its own, no `{now}` token, nothing but a bare count that the
// date bar was silently narrowing.

describe('widget_organizations — "Total organizations" means total', () => {
  it('reports the same organizations under any date-range window, and with none', () => {
    for (const windowDays of [7, 30, 365, null]) {
      expect(
        keep(ORGANIZATIONS, composeWidgetQuery('widget_organizations', windowDays)).map((o) => o.id),
        `window=${windowDays}`,
      ).toEqual(['o_founding', 'o_last_quarter', 'o_this_week']);
    }
  });

  it('opposite direction — the harness really does apply the window (an audit tile moves)', () => {
    // Deliberately a DIFFERENT audit widget from the one the Total Users block
    // uses, and deliberately an audit widget at all: see the ⛔ note in the file
    // header — a Row 1 tile that is "still bound" is bound by the defect this
    // block exists to close, never by intent.
    expect(keep(AUDIT_EVENTS, composeWidgetQuery('widget_recent_events', 7)).map((e) => e.id))
      .toEqual(['e_recent']);
    expect(keep(AUDIT_EVENTS, composeWidgetQuery('widget_recent_events', 365)).map((e) => e.id))
      .toEqual(['e_old', 'e_recent']);
  });

  it('opposite direction — the opt-out is load-bearing on this fixture', () => {
    // The pre-#7613 board, on the same rows: two of the three organizations
    // disappear under a description that says "Total organizations on the
    // platform". Drop `filterBindings` and the first assertion goes red rather
    // than passing for free.
    const windowed = keep(
      ORGANIZATIONS,
      composeWidgetQuery('widget_organizations', 7, { ignoreOptOut: true }),
    );
    expect(windowed.map((o) => o.id)).toEqual(['o_this_week']);
    expect(windowed.length).toBeLessThan(ORGANIZATIONS.length);
  });
});

// ── Tile 4: "Packages Installed" ────────────────────────────────────────────
// #7613. The one tile on this row that already carried a predicate of its own,
// so it is also where "the opt-out is orthogonal to the widget filter" is
// pinned: the two decide different things and both must survive.

describe('widget_packages_installed — installed now, not installed this week', () => {
  it('matches an independently-computed installed-only count, under any window', () => {
    expect(INSTALLED_PACKAGES.map((p) => p.id)).toEqual([
      'p_legacy',
      'p_last_quarter',
      'p_this_week',
    ]);
    for (const windowDays of [7, 30, 365, null]) {
      expect(
        keep(PACKAGE_INSTALLATIONS, composeWidgetQuery('widget_packages_installed', windowDays))
          .map((p) => p.id),
        `window=${windowDays}`,
      ).toEqual(INSTALLED_PACKAGES.map((p) => p.id));
    }
  });

  it('the widget-level `status` filter still stands after the opt-out', () => {
    // Both stand: opting out of the date bar decides how many rows count, never
    // which. Checked with the bar set AND cleared, because with only the
    // window-7 leg this would also pass on a board that had simply windowed the
    // non-installed rows away — hence `p_failed_this_week`, which is inside the
    // window and must still be dropped.
    expect(widgetById('widget_packages_installed').filter).toEqual({ status: 'installed' });
    for (const windowDays of [7, null]) {
      const kept = keep(
        PACKAGE_INSTALLATIONS,
        composeWidgetQuery('widget_packages_installed', windowDays),
      ).map((p) => p.id);
      expect(kept, `window=${windowDays}`).not.toContain('p_failed_this_week');
      expect(kept, `window=${windowDays}`).not.toContain('p_uninstalled_long_ago');
      expect(kept, `window=${windowDays}`).toContain('p_legacy');
    }
  });

  it('opposite direction — the harness really does apply the window (an audit tile moves)', () => {
    // An audit widget that carries a predicate of its own, mirroring this
    // tile's shape: it keeps its `action: 'login'` filter AND moves with the
    // date bar, which is what a correctly-windowed tile looks like.
    expect(keep(AUDIT_EVENTS, composeWidgetQuery('widget_login_events', 7)).map((e) => e.id))
      .toEqual(['e_recent']);
    expect(keep(AUDIT_EVENTS, composeWidgetQuery('widget_login_events', 365)).map((e) => e.id))
      .toEqual(['e_old', 'e_recent']);
  });

  it('opposite direction — the opt-out is load-bearing on this fixture', () => {
    // The pre-#7613 board: "Active package installations across projects"
    // reports one of three, because the other two were installed before the
    // window opened — and they are still installed.
    const windowed = keep(
      PACKAGE_INSTALLATIONS,
      composeWidgetQuery('widget_packages_installed', 7, { ignoreOptOut: true }),
    );
    expect(windowed.map((p) => p.id)).toEqual(['p_this_week']);
    expect(windowed.length).toBeLessThan(INSTALLED_PACKAGES.length);
  });
});
