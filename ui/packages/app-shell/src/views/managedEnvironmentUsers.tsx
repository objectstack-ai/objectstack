// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Users on a managed environment (objectui#13330).
 *
 * The environment serves `features.cloudManaged: true` when the cloud's
 * control plane runs it (`isCloudManaged()` server-side; the
 * objectstack-ai/objectstack#25083 ruling, Q1 B and Q3 A). People arrive from
 * the hosting organisation through its identity provider and the server
 * refuses the doors that add people here, so the Users list:
 *
 * - says where to invite, in one line above the list (`ManagedUsersInviteLine`);
 * - marks a user who holds no permission set beyond the baseline
 *   (`UnauthorizedUserMarker`), so the admin sees who arrived with nothing
 *   granted yet. No default-set control lives on this page (the ruling).
 *
 * ## "Beyond the baseline", read from the server's rows
 *
 * Every signed-in human holds the baseline: the sets the `everyone` anchor
 * position lists (the platform's `member_default` and the defaults the
 * environment accepted). A user holds something BEYOND it when either is true,
 * for a grant active now (`valid_from` / `valid_until`, half-open, the window
 * the server enforces):
 *
 * - a `sys_user_permission_set` row of theirs names a set the anchor does not
 *   list;
 * - a `sys_user_position` row of theirs names a position, other than an anchor,
 *   whose registry definition lists such a set;
 * - or names a position that shares its name with such a set. The server still
 *   grants a position's holders the permission set of the same name though the
 *   definition does not list it (the deprecated name fold,
 *   objectstack-ai/objectstack#24757, removed in the next major), so the
 *   permission-set catalogue is read beside the positions.
 *
 * These are the reads the permission set's Assigned Users section makes
 * (`AssignedUsersSection`), asked by user instead of by set, batched: every
 * marker the list draws asks for its user, and one read per object answers a
 * whole page of them.
 *
 * ⛔ Unknown is never said as "not authorized". A refused read, a page of grant
 * rows the server reports as longer than one read, a position the registry
 * does not define, or a position held while the permission-set catalogue could
 * not be read (the name fold cannot be judged) all leave the user unmarked.
 *
 * @module
 */

import * as React from 'react';
import { Badge } from '@object-ui/components';
import { Info } from 'lucide-react';

/** The object whose list carries the line and the marker. */
export const MANAGED_USERS_OBJECT = 'sys_user';

/** Is this a managed environment, as `/auth/config` serves it? Absent ⇒ no. */
export function isManagedEnvironment(features: { cloudManaged?: unknown } | null | undefined): boolean {
  return features?.cloudManaged === true;
}

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** The one line above the Users list that says where people are invited. */
export function ManagedUsersInviteLine({ t }: { t: Translate }) {
  return (
    <div
      className="flex items-start gap-2 border-b bg-muted/30 px-3 sm:px-4 py-2 text-sm text-muted-foreground"
      data-testid="managed-users-invite-line"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        {t('console.objectView.managedUsers.inviteLine', {
          defaultValue:
            'This environment is managed from the cloud. Invite people to your organization there; they appear here when they first sign in. A user marked Not authorized holds nothing beyond the access every member has: give them a permission set or a position.',
        })}
      </p>
    </div>
  );
}

// ─── The grant read ──────────────────────────────────────────────────────────

/** The slice of a `DataSource` the read uses. */
export interface UserGrantReadSource {
  find(resource: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * The slice of the metadata store the read uses. `ensureType` answers `[]` on a
 * failed read, so `getTypeStatus` is what tells a refused catalogue from an
 * empty one; a store without it is taken at its answer.
 */
export interface PositionRegistrySource {
  ensureType(type: string): Promise<unknown[]>;
  getTypeStatus?(type: string): string;
}

/** The audience anchors: implicit memberships every user holds. */
const ANCHOR_POSITIONS = new Set(['everyone', 'guest']);
/** The anchor whose sets ARE the baseline every signed-in human holds. */
const BASELINE_ANCHOR = 'everyone';

/** How many users one batch asks about; with this, one read stays well under its row cap. */
const USERS_PER_READ = 50;
/** How many rows one read asks for; a longer answer leaves its users unknown. */
const ROWS_PER_READ = 1000;

/** What the read says of one user. */
export type UserGrantState = 'beyond-baseline' | 'baseline-only' | 'unknown';

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Did the server hold more rows than this answer carries? */
function truncatedAnswer(res: unknown, rows: readonly unknown[]): boolean {
  const r = (Array.isArray(res) ? null : res) as { hasMore?: unknown; total?: unknown } | null;
  if (r?.hasMore === true) return true;
  if (typeof r?.total === 'number' && r.total > rows.length) return true;
  return rows.length >= ROWS_PER_READ;
}

function instant(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value as string | number).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Is a grant row active at `now`? Half-open `[valid_from, valid_until)`, an
 * absent bound open. A bound that does not parse reads as active: the marker
 * says "nothing granted", and a row of uncertain standing is not nothing.
 */
export function isGrantActive(row: Record<string, unknown>, now: number): boolean {
  const from = instant(row.valid_from);
  const until = instant(row.valid_until);
  if (from !== null && !Number.isNaN(from) && from > now) return false;
  if (until !== null && !Number.isNaN(until) && until <= now) return false;
  return true;
}

/**
 * What each of `userIds` holds, beyond the baseline or not. Rejects when any
 * read is refused; the caller then leaves every one of them unmarked.
 */
export async function readUserGrantStates(
  source: UserGrantReadSource,
  registry: PositionRegistrySource,
  userIds: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, UserGrantState>> {
  const out = new Map<string, UserGrantState>();
  if (userIds.length === 0) return out;

  // The registry: which sets the anchor lists, which sets each position lists,
  // and which sets exist at all (for the name fold).
  const [positions, permissionSets] = await Promise.all([
    registry.ensureType('position'),
    registry.ensureType('permission'),
  ]);
  const catalogueRead = registry.getTypeStatus?.('permission') !== 'error';
  const setNames = new Set<string>();
  for (const raw of permissionSets) {
    const name = (raw as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name) setNames.add(name);
  }
  const setsByPosition = new Map<string, readonly unknown[]>();
  for (const raw of positions) {
    const p = raw as { name?: unknown; permissionSets?: unknown } | null;
    if (typeof p?.name !== 'string' || !p.name) continue;
    setsByPosition.set(p.name, Array.isArray(p.permissionSets) ? p.permissionSets : []);
  }
  const baseline = new Set((setsByPosition.get(BASELINE_ANCHOR) ?? []).filter((s): s is string => typeof s === 'string'));
  const beyondBaseline = (set: unknown) => typeof set === 'string' && set !== '' && !baseline.has(set);

  const [grantsRes, assignmentsRes] = await Promise.all([
    source.find('sys_user_permission_set', { $filter: { user_id: { $in: [...userIds] } }, $top: ROWS_PER_READ }),
    source.find('sys_user_position', { $filter: { user_id: { $in: [...userIds] } }, $top: ROWS_PER_READ }),
  ]);
  const grants = rowsOf(grantsRes);
  const assignments = rowsOf(assignmentsRes);

  const beyond = new Set<string>();
  const uncertain = new Set<string>();
  for (const g of grants) {
    const uid = g?.user_id;
    if (uid === undefined || uid === null || uid === '') continue;
    if (!isGrantActive(g, now)) continue;
    if (beyondBaseline(g.permission_set)) beyond.add(String(uid));
  }
  for (const a of assignments) {
    const uid = a?.user_id;
    const position = a?.position;
    if (uid === undefined || uid === null || uid === '' || typeof position !== 'string') continue;
    if (ANCHOR_POSITIONS.has(position) || !isGrantActive(a, now)) continue;
    const sets = setsByPosition.get(position);
    const folded = catalogueRead && setNames.has(position) && beyondBaseline(position);
    if (folded || sets?.some(beyondBaseline)) beyond.add(String(uid));
    else if (sets === undefined || !catalogueRead) uncertain.add(String(uid));
  }

  // A page longer than one read may hold a row of any user it did not return.
  const truncated = truncatedAnswer(grantsRes, grants) || truncatedAnswer(assignmentsRes, assignments);
  for (const id of userIds) {
    if (beyond.has(id)) out.set(id, 'beyond-baseline');
    else if (truncated || uncertain.has(id)) out.set(id, 'unknown');
    else out.set(id, 'baseline-only');
  }
  return out;
}

// ─── The batching loader the markers share ──────────────────────────────────

/**
 * One per Users list: every marker asks it for its user, and it answers a
 * page's worth of them with one read per object. Lives outside React state so
 * no correctness rests on a memoised identity (AGENTS.md #10).
 */
export class UserGrantLoader {
  private readonly states = new Map<string, UserGrantState>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private scheduled = false;

  constructor(
    private readonly source: UserGrantReadSource,
    private readonly registry: PositionRegistrySource,
  ) {}

  /** What is known of `userId` now; `undefined` while it is being read. */
  state(userId: string): UserGrantState | undefined {
    return this.states.get(userId);
  }

  /** Ask for `userId`; a user already read or in flight is not asked twice. */
  request(userId: string): void {
    if (!userId || this.states.has(userId) || this.pending.has(userId)) return;
    this.pending.add(userId);
    if (this.scheduled) return;
    this.scheduled = true;
    // One macrotask: every marker a render commits has asked by then.
    setTimeout(() => {
      this.scheduled = false;
      void this.flush();
    }, 0);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private async flush(): Promise<void> {
    const ids = [...this.pending];
    this.pending.clear();
    for (let i = 0; i < ids.length; i += USERS_PER_READ) {
      const batch = ids.slice(i, i + USERS_PER_READ);
      try {
        const states = await readUserGrantStates(this.source, this.registry, batch);
        for (const id of batch) this.states.set(id, states.get(id) ?? 'unknown');
      } catch {
        for (const id of batch) this.states.set(id, 'unknown');
      }
      for (const listener of this.listeners) listener();
    }
  }
}

/** The 「未授权」 marker beside one user's name; draws nothing unless the read says baseline only. */
export function UnauthorizedUserMarker({
  loader,
  userId,
  t,
}: {
  loader: UserGrantLoader;
  userId: string;
  t: Translate;
}) {
  React.useEffect(() => {
    loader.request(userId);
  }, [loader, userId]);
  const state = React.useSyncExternalStore(
    loader.subscribe,
    () => loader.state(userId),
    () => undefined,
  );
  if (state !== 'baseline-only') return null;
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      title={t('console.objectView.managedUsers.unauthorizedHint', {
        defaultValue:
          'Holds no permission set beyond the baseline every signed-in member has. Give them a permission set or a position.',
      })}
      data-testid="managed-users-unauthorized"
    >
      {t('console.objectView.managedUsers.unauthorized', { defaultValue: 'Not authorized' })}
    </Badge>
  );
}
