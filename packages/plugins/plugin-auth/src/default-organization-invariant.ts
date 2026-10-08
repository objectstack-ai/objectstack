// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3] The Default Organization as a BOOT INVARIANT under the
 * `single` tenancy posture — the find-or-create `AuthPlugin.start()` runs
 * before any application seed loads and before the server accepts a request.
 *
 * ⛔ Internal on purpose: this module is NOT re-exported from the package
 * barrel. Its one caller is `AuthPlugin`; the owner bind it hands over to stays
 * with `ensureDefaultOrganization` (`ensure-default-organization.ts`), which is
 * the published helper.
 */

const SYSTEM_CTX = { isSystem: true };

/** The logger channel this module writes; `AuthPlugin` passes its kernel logger. */
interface InvariantLogger {
  info: (message: string, meta?: Record<string, any>) => void;
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

/** A find result as rows, whichever envelope the engine answered with. */
function rowsOf(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const records = (result as { records?: unknown } | null | undefined)?.records;
  return Array.isArray(records) ? records : [];
}

/** The Default Organization boot invariant's answer ({@link ensureDefaultOrganizationExists}). */
export interface DefaultOrganizationInvariantResult {
  /** The organization a `single` install derives every owner from; absent only when `ambiguous`. */
  organizationId?: string;
  /** Whether this call created it. */
  created: boolean;
  /**
   * Several organizations and none with `slug='default'`: there is no single
   * Default Organization to name. Nothing is created (a further organization
   * would deepen the ambiguity); the `tenancy` service's organization census
   * reports the topology at boot, and ADR-0131 D9 refuses every write that
   * would need an owner derived from it.
   */
  ambiguous?: { organizationCount: number };
}

/**
 * [ADR-0131 D3] The Default Organization as a BOOT INVARIANT under the
 * `single` tenancy posture: find it, or create it — with or without a platform
 * admin, who may not exist yet.
 *
 * Under `single` the organization is the environment and owns every row the
 * deployment writes, so it must exist before the first write that needs an
 * owner: before the application seed datasets load (`AppPlugin.start()`) and
 * before the server accepts a request (`kernel:listening`). AuthPlugin calls
 * this from its own `start()`, which the kernel orders ahead of every
 * `AppPlugin` (its `optionalDependencies`).
 *
 * ⛔ Unlike {@link ensureDefaultOrganization}, nothing here is best-effort.
 * A read that fails PROPAGATES — an unreadable store is not an empty one, and
 * reading it as empty would mint a second organization — and a failed insert
 * THROWS, naming the consequence and the remedy. The caller lets either fail
 * the boot. Binding the platform admin as `owner` stays with
 * {@link ensureDefaultOrganization}, which finds this organization and binds
 * (or promotes) them when they appear.
 */
export async function ensureDefaultOrganizationExists(
  ql: any,
  options: { logger?: InvariantLogger } = {},
): Promise<DefaultOrganizationInvariantResult> {
  const read = async (where: Record<string, unknown>, limit: number) =>
    rowsOf(await ql.find('sys_organization', { where, limit }, { context: SYSTEM_CTX }));

  const bySlug = await read({ slug: 'default' }, 1);
  if (bySlug[0]?.id) return { organizationId: String(bySlug[0].id), created: false };
  const existing = await read({}, 2);
  if (existing.length === 1 && existing[0]?.id) {
    return { organizationId: String(existing[0].id), created: false };
  }
  if (existing.length > 1) return { created: false, ambiguous: { organizationCount: existing.length } };

  const newOrgId = genId('org');
  let row: any;
  try {
    row = await ql.insert(
      'sys_organization',
      { id: newOrgId, name: 'Default Organization', slug: 'default', logo: null, metadata: null },
      { context: SYSTEM_CTX },
    );
  } catch (e) {
    throw Object.assign(
      new Error(
        '[default-org] BOOT REFUSED: the Default Organization could not be created. Under the \'single\' '
          + 'tenancy posture it owns every row this deployment writes (ADR-0131 D3), so it must exist '
          + 'before the application seeds load and before the server accepts a request; booting without it '
          + 'would serve writes that are refused for want of an owner. Remedy: make the sys_organization '
          + 'insert land — check the datasource\'s write permission and connectivity, and whether a legacy '
          + `unique index on \`slug\` refuses 'default'. Cause: ${(e as Error)?.message ?? String(e)}`,
      ),
      { cause: e },
    );
  }
  const organizationId = String(row?.id ?? newOrgId);
  options.logger?.info(
    `[default-org] created the Default Organization (${organizationId}) — the owner of every row under the 'single' tenancy posture`,
    { defaultOrgId: organizationId },
  );
  return { organizationId, created: true };
}
