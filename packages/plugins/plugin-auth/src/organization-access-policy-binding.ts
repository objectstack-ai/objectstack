// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0069 TL;DR 6] Wires each organization's own access policy
 * (`organization-access-policy.ts` holds the rule) into a running deployment:
 *
 *  1. the one-off moves of the two toggle-era values onto the three levels
 *     (ruling 「可以，按三档做（推荐）」, objectstack-ai/cloud#3668), run before
 *     the settings pass so the pass reads levels:
 *     - a stored `auth.mfa_required` toggle becomes `everyone` (on) or `off`;
 *     - an organization whose `sys_organization.require_mfa` is on gets
 *       `access_policy.mfa_required = everyone`, unless it already set a level,
 *       and its column is cleared once that row has landed;
 *     each is convergent and idempotent: a second boot finds nothing to move,
 *     and a move that fails is retried at the next boot, its source untouched;
 *  2. the reader the manager asks per request
 *     (`AuthManager.setOrganizationAccessPolicySource`);
 *  3. the save checks of every `access_policy` key — the floor
 *     (`accessPolicyFloorRefusal`), the self-lock-out check of the
 *     organization's own IP list (the deployment list's check, per
 *     organization), and the multi-factor enrollment check;
 *  4. a change listener that drops the manager's cached policies.
 *
 * A settings service without the `access_policy` namespace (a host that
 * registers its own manifest set) has no organization policy to read or save:
 * that is said once at `info`, and the deployment's values alone hold.
 */

import type { AuthManager } from './auth-manager.js';
import { allowedIpRangesWritePredicate } from './allowed-ip-ranges.js';
import { FORWARDED_CLIENT_ADDRESS_HEADERS } from './client-address-forwarding.js';
import {
  ACCESS_POLICY_KEYS,
  ACCESS_POLICY_NAMESPACE,
  accessPolicyWritePredicate,
  isMfaRequirementLevel,
  readMfaRequirementLevel,
} from './organization-access-policy.js';
import { organizationMfaEnrollmentPredicate } from './organization-mfa-enrollment-guard.js';

/** The settings service as this binding reads it — structural, like `SettingsReadSurface` in `auth-plugin.ts`. */
export interface AccessPolicySettingsSurface {
  get(namespace: string, key: string, ctx?: Record<string, unknown>): Promise<{ value?: unknown; source?: string } | undefined>;
  getNamespace(
    namespace: string,
    ctx?: Record<string, unknown>,
  ): Promise<{ values: Record<string, { value?: unknown; source?: string } | undefined> }>;
  set?(namespace: string, key: string, value: unknown, ctx?: Record<string, unknown>): Promise<unknown>;
  subscribe?(namespace: string | undefined, handler: (...args: any[]) => void): unknown;
  registerWritePredicate?(
    namespace: string,
    key: string,
    predicate: (input: unknown) => unknown,
    options?: { requestHeaders?: readonly string[] },
  ): void;
}

/**
 * The `security` service member the delegated-administrator check asks
 * (plugin-security's registered security service). Structural: plugin-auth
 * does not depend on plugin-security.
 */
export interface OrganizationAccessPolicySecuritySurface {
  resolvePermissionSetsForContext(context: Record<string, unknown>): Promise<unknown[]>;
}

export interface OrganizationAccessPolicyBindingDeps {
  settings: AccessPolicySettingsSurface;
  manager: AuthManager;
  /** The data engine, for the cross-organization MFA probe and the column move. */
  engine: () => any;
  /** The `security` service, when plugin-security is composed. */
  security: () => OrganizationAccessPolicySecuritySurface | undefined;
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** The legacy organization column the multi-factor level replaced. */
export const LEGACY_REQUIRE_MFA_FIELD = 'require_mfa';

/** Does a permission set (as `resolvePermissionSetsForContext` answers it) carry an ADR-0090 D12 `adminScope`? */
function carriesAdminScope(set: unknown): boolean {
  const record = set as { adminScope?: unknown; admin_scope?: unknown } | null;
  let raw = record?.adminScope ?? record?.admin_scope;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  return !!raw && typeof raw === 'object' && typeof (raw as { businessUnit?: unknown }).businessUnit === 'string';
}

/**
 * The deployment's stored `auth.mfa_required` toggle, rewritten as a level.
 * An env-sourced value is not a stored row and is left to the settings pass,
 * which reads its toggle spelling and says so.
 */
export async function migrateLegacyMfaRequiredSetting(deps: OrganizationAccessPolicyBindingDeps): Promise<'moved' | 'none'> {
  const { settings, logger } = deps;
  if (typeof settings.set !== 'function') return 'none';
  let resolved: { value?: unknown; source?: string } | undefined;
  try {
    resolved = await settings.get('auth', 'mfa_required');
  } catch {
    return 'none';
  }
  if (!resolved || resolved.source === 'env' || resolved.source === 'default') return 'none';
  const read = readMfaRequirementLevel(resolved.value);
  if (!read || !read.legacy) return 'none';
  try {
    await settings.set('auth', 'mfa_required', read.level, {});
    logger.info(`[auth] auth.mfa_required: the stored toggle (${String(resolved.value)}) is now the level '${read.level}'.`);
    return 'moved';
  } catch (err: any) {
    logger.error(
      `[auth] auth.mfa_required: the stored toggle (${String(resolved.value)}) was NOT rewritten as the level `
        + `'${read.level}' (${String(err?.message ?? err)}). The settings pass still reads it as '${read.level}', so `
        + 'the requirement stays in force, but the Authentication settings page cannot show it as a level. Remedy: '
        + `save auth.mfa_required as '${read.level}'; the move is retried at the next boot.`,
    );
    return 'none';
  }
}

/**
 * Every organization whose legacy `require_mfa` column is on gets
 * `access_policy.mfa_required = everyone` — the requirement it had — unless it
 * already set a level, and then has the column cleared. The column is cleared
 * only after the settings row landed, so a failed move leaves the source for
 * the next boot, and is reported at `error`: until it lands, that
 * organization's members are held only by the deployment's level.
 */
export async function migrateLegacyOrganizationRequireMfa(
  deps: OrganizationAccessPolicyBindingDeps,
): Promise<{ moved: number; failed: number }> {
  const { settings, logger } = deps;
  const out = { moved: 0, failed: 0 };
  const engine = deps.engine();
  if (!engine || typeof engine.find !== 'function' || typeof settings.set !== 'function') return out;
  let rows: any[] = [];
  try {
    rows = await engine.find('sys_organization', {
      where: { [LEGACY_REQUIRE_MFA_FIELD]: true },
      fields: ['id', LEGACY_REQUIRE_MFA_FIELD],
      limit: 5000,
      context: SYSTEM_CTX,
    });
  } catch {
    return out; // no organization table, or no such column: nothing to move
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const organizationId = row?.id;
    if (typeof organizationId !== 'string' || !organizationId) continue;
    if (!(row[LEGACY_REQUIRE_MFA_FIELD] === true || row[LEGACY_REQUIRE_MFA_FIELD] === 1)) continue;
    try {
      const current = await settings.get(ACCESS_POLICY_NAMESPACE, ACCESS_POLICY_KEYS.mfaRequired, { tenantId: organizationId });
      const alreadySet = current?.source && current.source !== 'default' && isMfaRequirementLevel(current.value);
      if (!alreadySet) {
        await settings.set(ACCESS_POLICY_NAMESPACE, ACCESS_POLICY_KEYS.mfaRequired, 'everyone', { tenantId: organizationId });
      }
      await engine.update(
        'sys_organization',
        { id: organizationId, [LEGACY_REQUIRE_MFA_FIELD]: false },
        { context: SYSTEM_CTX },
      );
      out.moved += 1;
    } catch (err: any) {
      out.failed += 1;
      logger.error(
        `[auth] organization ${organizationId}: its "Require Multi-Factor Auth" setting was NOT moved to its access `
          + `policy (${String(err?.message ?? err)}). Until it is, its members are held only by the deployment's `
          + 'multi-factor level, and nothing else looks wrong. Remedy: set the organization\'s Access policy → '
          + 'Multi-factor requirement to "everyone"; the move is retried at the next boot.',
      );
    }
  }
  if (out.moved > 0) {
    logger.info(
      `[auth] ${out.moved} organization(s) that required multi-factor authentication now carry it as their access `
        + 'policy\'s multi-factor requirement "everyone".',
    );
  }
  return out;
}

/** Bind the organization access policy; see the module header. */
export async function bindOrganizationAccessPolicy(deps: OrganizationAccessPolicyBindingDeps): Promise<void> {
  const { settings, manager, logger } = deps;

  // The deployment's own toggle moves even where organizations set nothing.
  await migrateLegacyMfaRequiredSetting(deps);

  try {
    await settings.getNamespace(ACCESS_POLICY_NAMESPACE);
  } catch {
    logger.info(
      `[auth] the settings service registers no '${ACCESS_POLICY_NAMESPACE}' namespace, so organizations set no `
        + 'access policy of their own; the deployment\'s values (the auth settings) apply to every organization.',
    );
    return;
  }

  await migrateLegacyOrganizationRequireMfa(deps);

  manager.setOrganizationAccessPolicySource({
    read: async (organizationId) => {
      const payload = await settings.getNamespace(ACCESS_POLICY_NAMESPACE, { tenantId: organizationId });
      const values: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(payload.values ?? {})) values[key] = entry?.value;
      return values;
    },
    anyOrganizationRequiresMfa: async () => {
      const engine = deps.engine();
      if (!engine || typeof engine.find !== 'function') return false;
      const rows = await engine.find('sys_setting', {
        where: { namespace: ACCESS_POLICY_NAMESPACE, key: ACCESS_POLICY_KEYS.mfaRequired },
        fields: ['value'],
        limit: 10000,
        context: SYSTEM_CTX,
      });
      return (Array.isArray(rows) ? rows : []).some((row: any) => {
        let value = row?.value;
        if (typeof value === 'string' && value.startsWith('"')) {
          try {
            value = JSON.parse(value);
          } catch {
            /* the raw text is judged below */
          }
        }
        return isMfaRequirementLevel(value) && value !== 'off';
      });
    },
    isDelegatedAdministrator: async (userId, organizationId, grants) => {
      const security = deps.security();
      if (typeof security?.resolvePermissionSetsForContext !== 'function') return false;
      const sets = await security.resolvePermissionSetsForContext({
        userId,
        ...(organizationId ? { tenantId: organizationId } : {}),
        positions: [...grants.positions],
        permissions: [...grants.permissions],
      });
      return (Array.isArray(sets) ? sets : []).some(carriesAdminScope);
    },
  });

  if (typeof settings.registerWritePredicate === 'function') {
    const floor = () => manager.getDeploymentAccessFloor();
    // The saving request's own address must be admitted — unless the saver is
    // a tenant-level administrator, whom an organization's list never holds
    // (break-glass): refusing their save would guard against a lock-out that
    // cannot happen to them.
    const addressCheck = allowedIpRangesWritePredicate(() => manager, { recovery: false });
    const selfLockOut = async (input: unknown) => {
      const refusal = addressCheck(input);
      if (!refusal || !('clientAddress' in refusal.constraint)) return refusal;
      const userId = (input as { ctx?: { userId?: unknown } } | undefined)?.ctx?.userId;
      if (typeof userId === 'string' && userId && (await manager.isTenantLevelAdministrator(userId))) return undefined;
      return refusal;
    };
    const enrollment = organizationMfaEnrollmentPredicate(() => manager.isTwoFactorEnabled());
    for (const key of Object.values(ACCESS_POLICY_KEYS)) {
      const base = accessPolicyWritePredicate(floor, key === ACCESS_POLICY_KEYS.allowedIpRanges ? selfLockOut : undefined);
      const predicate =
        key === ACCESS_POLICY_KEYS.mfaRequired ? async (input: unknown) => (await base(input)) ?? enrollment(input) : base;
      try {
        settings.registerWritePredicate(
          ACCESS_POLICY_NAMESPACE,
          key,
          predicate,
          key === ACCESS_POLICY_KEYS.allowedIpRanges ? { requestHeaders: FORWARDED_CLIENT_ADDRESS_HEADERS } : {},
        );
      } catch (err: any) {
        logger.warn(
          `[auth] ${ACCESS_POLICY_NAMESPACE}.${key}: the save-time check was NOT registered `
            + `(${String(err?.message ?? err)}), so an organization can save a value weaker than the deployment's. `
            + 'The deployment\'s value is still enforced: the weaker value is not honoured.',
        );
      }
    }
  }

  if (typeof settings.subscribe === 'function') {
    settings.subscribe(ACCESS_POLICY_NAMESPACE, () => manager.clearOrganizationAccessPolicyCache());
  }
}
