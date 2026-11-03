// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/auth/admin/list-platform-admins` — who holds platform-admin
 * standing in this environment, answered from Setup → Users (the `sys_user`
 * `list_platform_admins` action).
 *
 * ## One enumerator, one predicate (ADR-0095 D3)
 *
 * Platform-admin standing is a per-user derivation (`hasPlatformAdminStanding`,
 * `@objectstack/core`), not a stored column, so the Users list cannot show it
 * without evaluating that predicate for every row of every page. This answer
 * asks the population question once instead, through the two readings that
 * already exist and nothing else:
 *
 *  1. the CANDIDATES come from the last-admin guard's own enumerator
 *     (`resolveAdminUserIds`, `standing: 'platform-admins'`): the in-window
 *     `admin_full_access` grants the Default Organization owns, and the
 *     verified `sys_user` rows on the `OS_PLATFORM_OWNER_EMAIL` list;
 *  2. each candidate is CONFIRMED by `hasPlatformAdminStanding`, the one
 *     predicate every platform-admin gate asks.
 *
 * So the roster can only ever be narrower than the predicate, never wider: an
 * id the enumeration names and the predicate refuses is left out. The
 * enumerator's sources are pinned against `ADMIN_STANDING_PLATFORM_ENUMERATION`
 * (`@objectstack/core`, `admin-standing-surface.ts`), so a third source of
 * standing that this enumeration does not read reds that pin instead of being
 * left out of this answer silently.
 *
 * ## Who may read it
 *
 * Only a caller who holds platform-admin standing. The mount's shared gate
 * (`judgePlatformAdmin`) answers anonymous, held and non-admin callers first;
 * this handler then confirms the caller through `hasPlatformAdminStanding`
 * as well, because the gate still honours the legacy `role` scalar as a
 * fallback and the roster names platform operators. An organization owner or
 * administrator is refused with the gate's own 403 body and learns nothing.
 *
 * The answer is deployment-wide: platform standing belongs to no
 * organization, so the body (the console adds the active `organizationId` to
 * every auth action) is not read.
 */

import { hasPlatformAdminStanding } from '@objectstack/core';
import type { BaseEngineOptions } from '@objectstack/spec/data';
import { SystemObjectName } from '@objectstack/spec/system';

import { resolveAdminUserIds, type LastAdminGuardEngine } from './last-admin-guard.js';
import { PLATFORM_ADMIN_REFUSAL_MESSAGES, type PlatformAdminActor } from './platform-admin-gate.js';

/** The engine surface the roster reads through. */
export type PlatformAdminRosterEngine = Pick<LastAdminGuardEngine, 'find'>;

export interface PlatformAdminRosterDeps {
  getDataEngine: () => PlatformAdminRosterEngine | null | undefined;
}

/** One platform administrator, as the roster serves them. */
export interface PlatformAdminRosterEntry {
  id: string;
  name?: string;
  email?: string;
}

export interface PlatformAdminRosterResult {
  status: 200 | 403 | 503;
  body:
    | {
        success: true;
        data: {
          count: number;
          admins: PlatformAdminRosterEntry[];
          /** One line per administrator, for the result dialog's list. */
          entries: string[];
        };
      }
    | { success: false; error: { code: string; message: string } };
}

const SYSTEM_READ: BaseEngineOptions = { context: { isSystem: true } };

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Every user who holds platform-admin standing, ordered by id: the
 * enumerator's candidates, each confirmed through `hasPlatformAdminStanding`.
 *
 * ⚠️ No authorization of its own: the caller has already decided the asker
 * may see platform operators ({@link runPlatformAdminRoster}).
 */
export async function resolvePlatformAdminRoster(
  engine: PlatformAdminRosterEngine,
): Promise<PlatformAdminRosterEntry[]> {
  const candidates = [...(await resolveAdminUserIds(engine, { standing: 'platform-admins' }))].sort();
  const confirmed: string[] = [];
  for (const id of candidates) {
    if (await hasPlatformAdminStanding(engine, id)) confirmed.push(id);
  }
  if (confirmed.length === 0) return [];
  const rows = await engine.find(
    SystemObjectName.USER,
    { where: { id: { $in: confirmed } }, fields: ['id', 'name', 'email'] },
    SYSTEM_READ,
  );
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  return confirmed.map((id) => {
    const row = byId.get(id);
    return { id, name: asText(row?.name), email: asText(row?.email) };
  });
}

/** The line the result dialog shows for one administrator. */
export function rosterEntryLine(entry: PlatformAdminRosterEntry): string {
  if (entry.name && entry.email) return `${entry.name} <${entry.email}>`;
  return entry.email ?? entry.name ?? entry.id;
}

/**
 * The route body. `actor` is the caller the mount's platform-admin gate
 * admitted; the roster is served only once `hasPlatformAdminStanding`
 * confirms that caller too.
 */
export async function runPlatformAdminRoster(
  deps: PlatformAdminRosterDeps,
  actor: PlatformAdminActor,
): Promise<PlatformAdminRosterResult> {
  const engine = deps.getDataEngine();
  if (!engine) {
    return {
      status: 503,
      body: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Data engine unavailable' } },
    };
  }
  if (!(await hasPlatformAdminStanding(engine, actor.id))) {
    return {
      status: 403,
      body: { success: false, error: { code: 'PERMISSION_DENIED', message: PLATFORM_ADMIN_REFUSAL_MESSAGES[403] } },
    };
  }
  let admins: PlatformAdminRosterEntry[];
  try {
    admins = await resolvePlatformAdminRoster(engine);
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown; message?: unknown } | null;
    if (e?.code === 'SERVICE_UNAVAILABLE' && e.status === 503) {
      return {
        status: 503,
        body: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: String(e.message) } },
      };
    }
    throw err;
  }
  return {
    status: 200,
    body: { success: true, data: { count: admins.length, admins, entries: admins.map(rosterEntryLine) } },
  };
}
