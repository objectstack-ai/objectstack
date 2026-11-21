// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment-membership judgment — ONE function, asked by every door that
 * serves a request a multi-environment host resolved into an environment: the
 * runtime dispatcher (`HttpDispatcher`) and the REST server
 * (`@objectstack/rest`). A door supplies the principal it resolved and the
 * engine of the request's kernel; the verdict, the exemptions, the
 * applicability and the refusal are decided here and nowhere else.
 *
 * ⛔ Never re-spell any part of it at a door. A second copy is how two doors on
 * the same host come to answer the same caller differently.
 *
 * ## The verdict, in order
 *
 *  1. No environment, or the well-known system environment ⇒ the judgment
 *     does not apply (`null`). The system environment is reachable by any
 *     signed-in caller. Which ids a door counts as an environment at all is
 *     the door's own vocabulary (REST's `'platform'` names its control plane,
 *     not an environment) and is decided before it asks.
 *  2. A caller acting in the platform organization ⇒ admitted (`null`).
 *  3. NO ENGINE ⇒ {@link AuthzStoreUnavailableError}. The read cannot be made;
 *     an absent engine where a host resolved an environment and an auth
 *     service signed the caller in is a fault, not a composition.
 *  4. `sys_environment_member` NOT REGISTERED on that engine ⇒ the judgment
 *     does not apply (`null`). A composition that holds no environment
 *     membership has none to judge. The question is the registry's own
 *     `getObject`, never a caught throw; an engine whose registry cannot be
 *     asked is asked, and a fault refuses.
 *  5. The membership read, as the platform (the caller's id is the `where`,
 *     not the reader), on EVERY request — an admission is never reused, so a
 *     removal takes effect on the caller's next request. A read that throws ⇒
 *     {@link AuthzStoreUnavailableError}: fail closed, loud and retriable,
 *     never "allowed" and never the membership refusal.
 *  6. A row ⇒ admitted (`null`); none ⇒ the refusal: `403`,
 *     `PROJECT_MEMBERSHIP_REQUIRED`, with the environment and the user as
 *     context.
 *
 * Whether a door asks at all is the host's switch
 * ({@link resolveEnvironmentMembershipEnforcement}) — the same switch for every
 * door, so a door refuses only callers its sibling doors refuse.
 */

import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';

/** The control-plane object that records who is a member of which environment. */
export const ENVIRONMENT_MEMBER_OBJECT = 'sys_environment_member';

/** The well-known system environment — reachable by any signed-in caller. */
const SYSTEM_ENVIRONMENT_ID = '00000000-0000-0000-0000-000000000001';

/** The well-known platform organization — its members pass every environment. */
const PLATFORM_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';

/** The ADR-0112 code of the refusal. */
export const ENVIRONMENT_MEMBERSHIP_REQUIRED_CODE = 'PROJECT_MEMBERSHIP_REQUIRED';

/** The HTTP status of the refusal. */
export const ENVIRONMENT_MEMBERSHIP_REQUIRED_STATUS = 403;

/** The refusal a door writes in its own envelope. */
export interface EnvironmentMembershipRefusal {
  readonly status: typeof ENVIRONMENT_MEMBERSHIP_REQUIRED_STATUS;
  readonly code: typeof ENVIRONMENT_MEMBERSHIP_REQUIRED_CODE;
  readonly message: string;
  readonly environmentId: string;
  readonly userId: string;
}

/** The slice of an ObjectQL engine the membership read needs. */
export interface EnvironmentMembershipEngine {
  registry?: { getObject?: (name: string) => unknown };
  find(object: string, query: unknown): Promise<unknown>;
}

export interface EnvironmentMembershipInput {
  /** The environment the host resolved this request into. */
  environmentId: string | undefined;
  /** The principal the door resolved. */
  userId: string;
  /** The organization the door's resolution vetted for that principal. */
  activeOrganizationId: string | undefined;
  /** The engine of the request's own kernel; `undefined` when none resolved. */
  engine: EnvironmentMembershipEngine | null | undefined;
}

/**
 * The host's switch: explicit `enforceProjectMembership` wins, else on exactly
 * when environment scoping is on. Every door reads it from this one function,
 * so `api.enforceProjectMembership: false` turns the judgment off at every
 * door at once (ADR-0135 D9: a host whose environment-native auth IS the
 * membership opts out).
 */
export function resolveEnvironmentMembershipEnforcement(input: {
  enforceProjectMembership?: boolean;
  enableProjectScoping?: boolean;
}): boolean {
  return input.enforceProjectMembership ?? (input.enableProjectScoping ?? false);
}

/**
 * Whether `environmentId` is one the judgment applies to at all — cheap and
 * read-free, so a door can skip resolving a principal it would not judge.
 */
export function isMembershipJudgedEnvironment(environmentId: string | undefined): environmentId is string {
  return !!environmentId && environmentId !== SYSTEM_ENVIRONMENT_ID;
}

/**
 * The verdict on one principal for one environment — `null` when admitted or
 * when the judgment does not apply, the refusal otherwise; throws
 * {@link AuthzStoreUnavailableError} when an input it needs cannot be read.
 */
export async function judgeEnvironmentMembership(
  input: EnvironmentMembershipInput,
): Promise<EnvironmentMembershipRefusal | null> {
  const { environmentId, userId, activeOrganizationId, engine } = input;
  if (!isMembershipJudgedEnvironment(environmentId)) return null;

  if (activeOrganizationId === PLATFORM_ORGANIZATION_ID) return null;

  if (!engine) {
    throw new AuthzStoreUnavailableError(
      ENVIRONMENT_MEMBER_OBJECT,
      new Error('no ObjectQL engine resolved on this request\'s kernel'),
    );
  }
  if (typeof engine.registry?.getObject === 'function' && !engine.registry.getObject(ENVIRONMENT_MEMBER_OBJECT)) {
    return null;
  }

  let rows: unknown;
  try {
    rows = await engine.find(ENVIRONMENT_MEMBER_OBJECT, {
      where: { environment_id: environmentId, user_id: userId },
      limit: 1,
      context: { isSystem: true },
    });
  } catch (err) {
    throw new AuthzStoreUnavailableError(ENVIRONMENT_MEMBER_OBJECT, err);
  }
  if (rows && (rows as { value?: unknown }).value) rows = (rows as { value?: unknown }).value;
  if (Array.isArray(rows) && rows.length > 0) return null;

  return {
    status: ENVIRONMENT_MEMBERSHIP_REQUIRED_STATUS,
    code: ENVIRONMENT_MEMBERSHIP_REQUIRED_CODE,
    message: `Forbidden: user ${userId} is not a member of project ${environmentId}`,
    environmentId,
    userId,
  };
}
