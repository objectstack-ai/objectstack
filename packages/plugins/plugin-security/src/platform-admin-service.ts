// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platformAdmin — the read-only platform-administrator AUDIT surface
 * (#11663 pin #3, leg L4; design comment 5394453215 §P3).
 *
 * Under walled postures the bootstrap no longer mints the unscoped
 * `admin_full_access` grant row (#11974), so the inverse question — "who are
 * this deployment's platform administrators?" — loses its only row-based
 * implementation. This service is the config-derived replacement: it answers
 * from `OS_PLATFORM_OWNER_EMAIL` (the ONE parser in `@objectstack/core`) plus
 * the stored `sys_user` rows, exactly the two inputs the authorization
 * derivation reads (`resolve-authz-context.ts` §6b-config).
 *
 * **Read-only, deliberately and permanently.** There is no runtime path that
 * changes who a platform administrator is (#11663 Choice 3A rejected the
 * mutation endpoint outright): revocation is a config change + process roll.
 * The service object is frozen so a consumer cannot even monkey-patch a
 * mutator onto it.
 *
 * The standing answer mirrors the DERIVATION, not the retired elevation gate:
 * rows are matched by the config's own normalization
 * (`normalizePlatformAdminEmail`) and verified by the shared fail-closed
 * predicate (`isEmailVerifiedUserRow`). No humanness filter is applied — the
 * derivation applies none either (a `usr_system` row holding a configured
 * address cannot authenticate, but if an operator declares such an address the
 * audit surface should SHOW the match rather than quietly hide it).
 *
 * Consumers: the walled bootstrap's standing log (`bootstrap-platform-admin.ts`
 * — the operator's first sight of the answer), and any Setup / discovery /
 * health surface that needs the resolved admin list. Both go through
 * {@link resolvePlatformAdminStanding} so the log and the service can never
 * disagree.
 */

import { isEmailVerifiedUserRow } from '@objectstack/types';
import {
  normalizePlatformAdminEmail,
  resolvePlatformAdminEmails,
  type PlatformAdminEmailConfig,
} from '@objectstack/core';

const SYSTEM_CTX = { isSystem: true };

/** One configured administrator address, resolved against the stored users. */
export interface PlatformAdminStandingEntry {
  /** The normalized address (the derivation's comparison key). */
  email: string;
  /** The address as the operator typed it (trimmed, never lowercased). */
  declaredSpelling: string;
  /** Does any `sys_user` row hold this address? */
  registered: boolean;
  /**
   * Does a row holding this address read VERIFIED under the shared fail-closed
   * predicate? Only a verified match confers standing at derivation time.
   */
  verified: boolean;
  /** The oldest VERIFIED matching account — the one that holds standing. */
  userId?: string;
}

/** The parsed state of the config source, shaped for a read-only audit panel. */
export interface PlatformAdminConfiguredEmails {
  /** Was `OS_PLATFORM_OWNER_EMAIL` set to anything non-blank at all? */
  declared: boolean;
  /**
   * Declared but REFUSED (an unparseable entry fails the whole variable
   * closed — #11663 Choice 2B). `emails` is empty in that case.
   */
  refused: boolean;
  /** Normalized, de-duplicated administrator addresses, declaration order. */
  emails: readonly string[];
}

/**
 * The `platformAdmin` service contract — registered by `security-plugin.ts`.
 * Read-only by design; see the module header.
 */
export interface PlatformAdminService {
  configuredEmails(): PlatformAdminConfiguredEmails;
  standing(): Promise<PlatformAdminStandingEntry[]>;
}

async function tryFind(ql: any, object: string, where: any, limit: number): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Resolve per-entry standing for every configured administrator address.
 *
 * The lookup queries BOTH the normalized and the as-typed spelling of each
 * entry (a driver `where` is an exact match, and an imported/legacy row may
 * not be stored lowercased) and then matches by the config's own
 * normalization — the same two-spelling discipline the elevation gate used,
 * now serving the audit answer instead of a write.
 */
export async function resolvePlatformAdminStanding(
  ql: any,
  config: PlatformAdminEmailConfig,
): Promise<PlatformAdminStandingEntry[]> {
  const entries: PlatformAdminStandingEntry[] = [];
  for (let i = 0; i < config.emails.length; i++) {
    const email = config.emails[i]!;
    const declaredSpelling = config.declaredSpellings[i] ?? email;
    const byId = new Map<string, any>();
    for (const spelling of new Set([email, declaredSpelling])) {
      for (const u of await tryFind(ql, 'sys_user', { email: spelling }, 5)) {
        if (u && typeof u === 'object' && u.id) byId.set(String(u.id), u);
      }
    }
    const matching = [...byId.values()].filter(
      (u) => normalizePlatformAdminEmail(u.email) === email,
    );
    const verified = matching
      .filter((u) => isEmailVerifiedUserRow(u))
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      });
    entries.push({
      email,
      declaredSpelling,
      registered: matching.length > 0,
      verified: verified.length > 0,
      ...(verified[0]?.id ? { userId: String(verified[0].id) } : {}),
    });
  }
  return entries;
}

/**
 * Build the frozen read-only service. `getQl` is resolved lazily at call time
 * so registration in `init()` does not depend on the engine's start order.
 */
export function createPlatformAdminService(getQl: () => any): PlatformAdminService {
  return Object.freeze({
    configuredEmails(): PlatformAdminConfiguredEmails {
      const config = resolvePlatformAdminEmails();
      return {
        // `raw` is present only when the variable was set to something
        // non-blank — blank is undeclared, matching the bootstrap's pin.
        declared: config.raw !== undefined,
        refused: config.refusal !== undefined,
        emails: config.emails,
      };
    },
    async standing(): Promise<PlatformAdminStandingEntry[]> {
      const ql = getQl();
      if (!ql || typeof ql.find !== 'function') {
        // Loud, not empty: an audit surface answering [] for "engine missing"
        // would read as "no administrators", which is a different (and scarier)
        // fact than "cannot answer right now".
        throw new Error('[security] platformAdmin.standing(): objectql service unavailable');
      }
      return resolvePlatformAdminStanding(ql, resolvePlatformAdminEmails());
    },
  });
}
