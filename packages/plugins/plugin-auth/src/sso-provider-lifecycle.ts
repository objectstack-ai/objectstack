// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SSO provider lifecycle: what deleting an identity provider does to the
 * people and grants that depend on it, and the one provider an email domain is
 * routed to.
 *
 * ## Deleting a provider
 *
 * `@better-auth/sso`'s `/sso/delete-provider` (1.7.12) deletes the provider row
 * and, in the same transaction, every `account` row of that provider: each user
 * who signed in through it is unlinked. Delete stays possible, because an
 * administrator retiring an identity provider must be able to (server seat 2's
 * ruling on #32085). What changes is that nobody deletes it blind:
 *
 *   - **before**, the confirmation reads {@link readSsoProviderDeleteImpact}
 *     through `GET /admin/sso/delete-impact` (the delete action's preflight):
 *     how many users the delete unlinks, how many of them have no other sign-in
 *     method linked (no password, no other provider) and so lose access, and
 *     the group mappings and projected grants that go with it;
 *   - **on the door itself**, the global before-hook counts the same, after the
 *     sign-in method floor and before the vendor's first write
 *     ({@link stageSsoProviderDeleteImpact}), so every caller of the vendor
 *     route is counted, not only the console. A count that cannot be read
 *     refuses the delete `503`: the answer names what was unlinked, and an
 *     unlink cannot be taken back;
 *   - **after** a delete the vendor answered `success`, the after-hook removes
 *     what the provider left behind ({@link removeSsoProviderDependents}): its
 *     `sys_idp_group_mapping` rows (`source_kind: 'sso'`, `source_id` = the
 *     provider id) and the `sys_user_permission_set` grants whose `reason` is
 *     exactly the provider's projection marker (`ssoGroupProjectionReason`),
 *     never a grant by permission-set name, so a grant made by hand or by SCIM
 *     is never touched; then it adds the counts to the answer
 *     ({@link settleSsoProviderDelete}).
 *
 * A delete the vendor refuses (`403` not the provider's manager, `404` no such
 * provider) runs no cleanup and gets no counts: the counts are only ever
 * handed to a caller the vendor admitted.
 *
 * ## One domain, one provider
 *
 * Sign-in routes an email address to a provider by its domain
 * (`/sign-in/sso`: the provider whose `domain` equals the address's domain,
 * else the first whose comma-separated list matches it), so a second provider
 * registered for a domain another already serves can never be reached by
 * address. {@link findSsoDomainClaim} finds the provider already serving any
 * of the requested domains, and the before-hook refuses the register (and a
 * domain edit on `/sso/update-provider`) with `409 RESOURCE_CONFLICT` naming
 * it. Only an exact domain entry collides: a provider for `eng.acme.com` beside
 * one for `acme.com` is a working configuration (the exact match wins for
 * `eng.acme.com`, the parent serves every other subdomain), so it is accepted.
 */

import type { IDataEngine } from '@objectstack/core';
import { withSystemContext } from './objectql-adapter.js';
import {
  IDP_GROUP_MAPPING_OBJECT,
  SSO_MAPPING_SOURCE_KIND,
  ssoGroupProjectionReason,
} from './scim-group-projection.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';

/** The better-auth endpoints whose bodies carry a provider's `domain`. */
export const SSO_PROVIDER_REGISTER_PATH = '/sso/register';
export const SSO_PROVIDER_UPDATE_PATH = '/sso/update-provider';

const ACCOUNT_OBJECT = 'sys_account';
const GRANT_OBJECT = 'sys_user_permission_set';

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function registered(engine: IDataEngine, object: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (name: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, object));
}

// ── Domains ─────────────────────────────────────────────────────────────────

/** One domain entry as a bare lower-case host: `https://Acme.com/x` and `acme.com:443` are both `acme.com`. */
function bareDomain(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * The email domains a provider's `domain` value serves: its comma-separated
 * entries, each as a bare lower-case host, blanks dropped, each once.
 */
export function providerDomains(domain: unknown): string[] {
  if (typeof domain !== 'string') return [];
  return [...new Set(domain.split(',').map(bareDomain).filter(Boolean))];
}

/** A domain another provider already serves: the provider and the domain. */
export interface SsoDomainClaim {
  providerId: string;
  domain: string;
}

/**
 * The first provider other than `exceptProviderId` that already serves one of
 * `domains`, or `undefined`. One read per domain, narrowed in the store by a
 * case-insensitive substring and decided here on the parsed entries, so a
 * provider for `eng.acme.com` does not claim `acme.com`.
 */
export async function findSsoDomainClaim(
  engine: IDataEngine,
  domains: readonly string[],
  exceptProviderId?: string,
): Promise<SsoDomainClaim | undefined> {
  const reader = withSystemContext(engine);
  for (const domain of domains) {
    const rows = rowsOf(
      await reader.find(SSO_PROVIDER_OBJECT, { where: { domain: { $icontains: domain } }, fields: ['provider_id', 'domain'] } as never),
    );
    for (const row of rows) {
      const providerId = text(row.provider_id);
      if (!providerId || providerId === exceptProviderId) continue;
      if (providerDomains(row.domain).includes(domain)) return { providerId, domain };
    }
  }
  return undefined;
}

/** The refusal of a register or a domain edit onto a domain another provider serves; thrown as better-auth's `APIError`. */
export interface SsoDomainClaimedRefusal {
  status: 'CONFLICT';
  code: 'RESOURCE_CONFLICT';
  message: string;
  field: 'domain';
  /** The provider that serves the domain; named only to a caller who may read every provider. */
  heldBy?: string;
}

/**
 * The located `409` for `claim`. `nameHolder` is false for a caller who is not
 * a platform administrator: such a caller learns only that the domain is
 * served, which `/sign-in/sso` already answers anyone, and not by which row.
 */
export function ssoDomainClaimedRefusal(claim: SsoDomainClaim, nameHolder: boolean): SsoDomainClaimedRefusal {
  const holder = nameHolder ? `SSO provider '${claim.providerId}'` : 'another SSO provider';
  return {
    status: 'CONFLICT',
    code: 'RESOURCE_CONFLICT',
    field: 'domain',
    message:
      `The email domain '${claim.domain}' is already served by ${holder}. Sign-in routes an address to one provider `
      + 'by its domain, so a second provider for it could never be reached. Use a domain no other provider lists, '
      + `or remove '${claim.domain}' from that provider first.`,
    ...(nameHolder ? { heldBy: claim.providerId } : {}),
  };
}

// ── Deleting a provider ─────────────────────────────────────────────────────

/** What deleting one provider removes, counted before the vendor writes anything. */
export interface SsoProviderDeleteImpact {
  providerId: string;
  /** Users with an account linked through the provider: the vendor's delete unlinks each one. */
  linkedUsers: number;
  /** Of those, the users with no other account linked (no password, no other provider): they lose access. */
  usersWithoutOtherSignIn: number;
  /** The provider's `sys_idp_group_mapping` rows. */
  groupMappings: number;
  /** The grants the provider's sign-ins projected (`reason` = its projection marker). */
  projectedGrants: number;
}

/** Count what deleting `providerId` removes. Throws when a read fails: the caller decides what an unreadable count means. */
export async function readSsoProviderDeleteImpact(engine: IDataEngine, providerId: string): Promise<SsoProviderDeleteImpact> {
  const reader = withSystemContext(engine);
  const linked = new Set<string>();
  if (registered(engine, ACCOUNT_OBJECT)) {
    for (const row of rowsOf(await reader.find(ACCOUNT_OBJECT, { where: { provider_id: providerId }, fields: ['user_id'] } as never))) {
      const userId = text(row.user_id);
      if (userId) linked.add(userId);
    }
  }
  const withOther = new Set<string>();
  if (linked.size > 0) {
    const accounts = rowsOf(
      await reader.find(ACCOUNT_OBJECT, { where: { user_id: { $in: [...linked] } }, fields: ['user_id', 'provider_id'] } as never),
    );
    for (const row of accounts) {
      if (text(row.provider_id) !== providerId) withOther.add(text(row.user_id));
    }
  }
  const groupMappings = registered(engine, IDP_GROUP_MAPPING_OBJECT)
    ? rowsOf(
      await reader.find(IDP_GROUP_MAPPING_OBJECT, { where: { source_kind: SSO_MAPPING_SOURCE_KIND, source_id: providerId }, fields: ['id'] } as never),
    ).length
    : 0;
  const projectedGrants = registered(engine, GRANT_OBJECT)
    ? rowsOf(await reader.find(GRANT_OBJECT, { where: { reason: ssoGroupProjectionReason(providerId) }, fields: ['id'] } as never)).length
    : 0;
  return {
    providerId,
    linkedUsers: linked.size,
    usersWithoutOtherSignIn: [...linked].filter((id) => !withOther.has(id)).length,
    groupMappings,
    projectedGrants,
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The unlink half of the sentence: how many users, and how many of them lose access. */
function unlinkSentence(impact: SsoProviderDeleteImpact, done: boolean): string {
  const head = `Deleting SSO provider '${impact.providerId}' ${done ? 'unlinked' : 'unlinks'} ${plural(impact.linkedUsers, 'user')} from it`;
  if (impact.linkedUsers === 0) return `${head}.`;
  const n = impact.usersWithoutOtherSignIn;
  const lose = done ? 'lost' : n === 1 ? 'loses' : 'lose';
  return `${head}; ${n} of them ${n === 1 ? 'has' : 'have'} no password or other sign-in method linked and ${lose} access.`;
}

/** One English sentence naming what a delete removes (or removed); the counts themselves ride beside it. */
export function ssoProviderDeleteSummary(impact: SsoProviderDeleteImpact, done: boolean): string {
  return `${unlinkSentence(impact, done)} ${done ? 'It removed' : 'It also removes'} ${plural(impact.groupMappings, 'IdP group mapping')} `
    + `and the ${plural(impact.projectedGrants, 'permission-set grant')} they gave.`;
}

/** Where the before-hook leaves the count for the after-hook, on the request's better-auth context. */
export const SSO_PROVIDER_DELETE_IMPACT_STASH = '__osSsoProviderDeleteImpact';

/** The `503` a delete gets when its count cannot be read; thrown as better-auth's `APIError`. */
export interface SsoProviderDeleteImpactUnreadable {
  status: 'SERVICE_UNAVAILABLE';
  code: 'SERVICE_UNAVAILABLE';
  message: string;
}

/**
 * The before-hook half: count what deleting `providerId` removes and leave it
 * on `ctx.context` for {@link settleSsoProviderDelete}. With no data engine
 * there is nothing to count and nothing to clean, and nothing is staged. A
 * failed read is answered with the refusal to throw: the delete is not run.
 */
export async function stageSsoProviderDeleteImpact(
  ctx: any,
  engine: IDataEngine | undefined,
  providerId: string,
): Promise<SsoProviderDeleteImpactUnreadable | undefined> {
  if (!engine || !ctx?.context) return undefined;
  try {
    ctx.context[SSO_PROVIDER_DELETE_IMPACT_STASH] = await readSsoProviderDeleteImpact(engine, providerId);
    return undefined;
  } catch {
    return {
      status: 'SERVICE_UNAVAILABLE',
      code: 'SERVICE_UNAVAILABLE',
      message:
        `SSO provider '${providerId}' was not deleted: the users linked to it could not be counted, and deleting it `
        + 'unlinks every one of them. Nothing was changed; try again.',
    };
  }
}

/** What the after-hook removed. */
export interface SsoProviderDependentsRemoved {
  removedGroupMappings: number;
  removedGrants: number;
}

/**
 * Remove what a deleted provider leaves behind: its group mapping rows, and
 * the grants whose `reason` is exactly its projection marker. Each grant is
 * deleted with its own organization as the write's tenant, as the sign-in
 * that projected it wrote it. Throws on the first failed write.
 */
export async function removeSsoProviderDependents(engine: IDataEngine, providerId: string): Promise<SsoProviderDependentsRemoved> {
  const reader = withSystemContext(engine);
  const writer = withSystemContext(engine);
  let removedGrants = 0;
  if (registered(engine, GRANT_OBJECT)) {
    const grants = rowsOf(
      await reader.find(GRANT_OBJECT, { where: { reason: ssoGroupProjectionReason(providerId) }, fields: ['id', 'organization_id'] } as never),
    );
    for (const grant of grants) {
      const tenantId = text(grant.organization_id);
      await writer.delete(GRANT_OBJECT, {
        where: { id: text(grant.id) },
        ...(tenantId ? { context: { isSystem: true, tenantId } } : {}),
      } as never);
      removedGrants++;
    }
  }
  let removedGroupMappings = 0;
  if (registered(engine, IDP_GROUP_MAPPING_OBJECT)) {
    const mappings = rowsOf(
      await reader.find(IDP_GROUP_MAPPING_OBJECT, { where: { source_kind: SSO_MAPPING_SOURCE_KIND, source_id: providerId }, fields: ['id'] } as never),
    );
    for (const mapping of mappings) {
      await writer.delete(IDP_GROUP_MAPPING_OBJECT, { where: { id: text(mapping.id) } } as never);
      removedGroupMappings++;
    }
  }
  return { removedGroupMappings, removedGrants };
}

/** The answer a successful delete carries under `data`. */
export interface SsoProviderDeleteAnswer {
  providerId: string;
  unlinkedUsers: number;
  usersWithoutOtherSignIn: number;
  removedGroupMappings: number;
  removedGrants: number;
  /** False when removing the mappings and grants failed: they are still there. */
  dependentsRemoved: boolean;
  message: string;
}

function isVendorError(returned: unknown): boolean {
  return returned instanceof Error || (Boolean(returned) && typeof returned === 'object' && 'statusCode' in (returned as object));
}

/**
 * The after-hook half, on `/sso/delete-provider` only: when the before-hook
 * staged a count and the vendor answered `{ success: true }`, remove the
 * provider's dependents and add `data` (the counts and one sentence) to that
 * answer, in place. A refused delete, or one nothing was staged for, is left
 * as the vendor answered it.
 *
 * A failed removal is delivered in the answer (`dependentsRemoved: false`,
 * the sentence says what is left) and said once at `error`: the provider is
 * gone, its grants are not, and nothing else would show it.
 */
export async function settleSsoProviderDelete(
  ctx: any,
  engine: IDataEngine | undefined,
  logError: (message: string) => void,
): Promise<void> {
  const impact = ctx?.context?.[SSO_PROVIDER_DELETE_IMPACT_STASH] as SsoProviderDeleteImpact | undefined;
  if (ctx?.context) delete ctx.context[SSO_PROVIDER_DELETE_IMPACT_STASH];
  if (!impact || !engine) return;
  const returned = ctx?.context?.returned;
  if (!returned || typeof returned !== 'object' || Array.isArray(returned) || isVendorError(returned)) return;
  if ((returned as { success?: unknown }).success !== true) return;

  let removed: SsoProviderDependentsRemoved = { removedGroupMappings: 0, removedGrants: 0 };
  let dependentsRemoved = true;
  let failure = '';
  try {
    removed = await removeSsoProviderDependents(engine, impact.providerId);
  } catch (error) {
    dependentsRemoved = false;
    failure = (error as Error)?.message ?? String(error);
    logError(
      `[auth] SSO provider '${impact.providerId}' was DELETED, but removing its IdP group mappings and the permission-set `
        + 'grants they projected FAILED; they are still in place. '
        + `Remedy: delete the sys_user_permission_set rows whose reason is "${ssoGroupProjectionReason(impact.providerId)}" `
        + `and the sys_idp_group_mapping rows of source_id '${impact.providerId}' (POST /admin/scim/delete-group-mapping). Cause: ${failure}`,
    );
  }
  const done: SsoProviderDeleteImpact = {
    ...impact,
    groupMappings: removed.removedGroupMappings,
    projectedGrants: removed.removedGrants,
  };
  const message = dependentsRemoved
    ? ssoProviderDeleteSummary(done, true)
    : `${unlinkSentence(impact, true)} Its ${plural(impact.groupMappings, 'IdP group mapping')} and `
      + `${plural(impact.projectedGrants, 'projected grant')} could NOT be removed and are still in place: ${failure}`;
  const data: SsoProviderDeleteAnswer = {
    providerId: impact.providerId,
    unlinkedUsers: impact.linkedUsers,
    usersWithoutOtherSignIn: impact.usersWithoutOtherSignIn,
    removedGroupMappings: removed.removedGroupMappings,
    removedGrants: removed.removedGrants,
    dependentsRemoved,
    message,
  };
  (returned as Record<string, unknown>).data = data;
}
