// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * assembleExecutionContext — the SINGLE assembly of an inbound request's
 * {@link ExecutionContext}, shared by every transport entry point.
 *
 * `resolveAuthzContext` (next door) already made AUTHORIZATION resolution
 * single-sourced. The step AFTER it — turning the resolved
 * {@link ResolvedAuthzContext} into the `ExecutionContext` envelope that
 * reaches enforcement — stayed hand-written per transport, and that duplication
 * produced a measured defect family:
 *
 *  - **#6071 — field drift.** The REST copy never set `principalKind`, so every
 *    enforcement judgment reading it (explain's guest⇒EXTERNAL floor, the
 *    security plugin's agent baseline, the perf-disclosure gate) was silently
 *    never-true on that face.
 *  - **#6206 / #6551 — dropped fields.** The share-link copies omitted
 *    `accessible_org_ids`, and the `group` posture's Layer 0 wall reads it
 *    directly: real 403s for callers who should have been let through. Both
 *    surfaces were since converted to pass the WHOLE envelope through.
 *
 * Both defects are the same shape: a field exists on `ExecutionContext`, one
 * copy carries it, another silently does not. This module makes that shape
 * unrepresentable by CLOSING the field set with a type
 * ({@link ExecutionContextEntryFields}) — every field a transport entry point
 * decides must be decided HERE, explicitly, and a new `ExecutionContext` field
 * fails to compile until it is either assembled or listed as
 * non-entry-resolved.
 *
 * ## Two named entries — the anonymous face is genuinely divergent (#6216)
 *
 * The maintainer ruling of 2026-08-08 on #6216 (Option A) settled the one
 * question that blocked convergence: what an anonymous request yields.
 *
 *  - {@link assembleExecutionContext} — the DEFAULT, fail-closed entry. No
 *    resolved principal → `undefined`, and the surface answers 401. This is the
 *    REST face's contract, unchanged.
 *  - {@link assembleExecutionContextOrGuest} — the EXPLICIT guest entry. No
 *    resolved principal → a first-class guest envelope
 *    (`principalKind: 'guest'`, `positions: ['guest']`), which the runtime /
 *    MCP dispatcher has always produced and whose consumers are live
 *    (`plugin-security/explain-engine.ts`: guest ⇒ `EXTERNAL` posture). A
 *    surface adopts this entry ONLY when its product semantics serve anonymous
 *    principals.
 *
 * Neither surface's runtime behaviour changes. What changes is that the
 * divergence is now NAMED API rather than drift — and the same is true of the
 * per-face values below (`accessToken`, `oauth`, `localization`): they are
 * REQUIRED inputs, so a face cannot silently omit one, and what a face chooses
 * to withhold it withholds on the record.
 *
 * Options B (guest everywhere — turns REST's anonymous 401s into authz-shaped
 * denials and makes anonymous-serving the DEFAULT posture of a new surface) and
 * C (no-ctx everywhere — deletes the guest principal, the `guest` position and
 * explain's `EXTERNAL` floor) were both considered and rejected: each breaks a
 * live consumer side.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { scopesToAgentPermissionSets, MCP_OAUTH_SCOPE_ACTIONS } from '@objectstack/spec/ai';

import type { ResolvedAuthzContext } from './resolve-authz-context.js';

/**
 * `ExecutionContext` fields a transport ENTRY POINT does not resolve — they are
 * per-operation flags, engine internals, or attribution supplied further down
 * the stack. Listing one here is a deliberate, reviewable statement that no
 * request-identity resolution produces it; everything NOT listed is part of the
 * closed entry set below and must be assembled.
 *
 * - `actor` / `attributedUserId` — audit attribution, set by the host or the
 *   hook layer (ADR-0014 D2, #4586), never by identity resolution.
 * - `rlsMembership` — engine-side RLS scoping cache.
 * - `transaction` / `traceId` — per-operation handles.
 * - `flowRunId`, `skipTriggers`, `skipAutomations`, `seedReplay`,
 *   `skipStateMachine`, `preserveAudit` — per-write behaviour flags,
 *   server-constructed at the call site.
 */
type NonEntryExecutionContextField =
  | 'actor'
  | 'attributedUserId'
  | 'rlsMembership'
  | 'transaction'
  | 'traceId'
  | 'flowRunId'
  | 'skipTriggers'
  | 'skipAutomations'
  | 'seedReplay'
  | 'skipStateMachine'
  | 'preserveAudit';

/**
 * The CLOSED field set every transport entry point must decide. Derived from
 * `ExecutionContext` itself, so adding a field to `ExecutionContextSchema`
 * widens this union automatically — and the assembly below stops compiling
 * until the new field is either assembled or declared non-entry-resolved.
 */
export type EntryExecutionContextField = Exclude<
  keyof ExecutionContext,
  NonEntryExecutionContextField
>;

/**
 * One value per closed field. Every key is REQUIRED (`-?`) while the VALUE may
 * be `undefined` — the decision may not be omitted, only made explicitly. This
 * is the type that makes the #6071 drift class unrepresentable.
 */
export type ExecutionContextEntryFields = {
  [K in EntryExecutionContextField]-?: ExecutionContext[K];
};

/**
 * Emission order of the assembled envelope, and a second, independent
 * exhaustiveness bite: `satisfies` rejects a stale name, and
 * `_ENTRY_FIELDS_EXHAUSTIVE` below rejects a missing one.
 */
export const ENTRY_EXECUTION_CONTEXT_FIELDS = [
  'positions',
  'permissions',
  'systemPermissions',
  'isSystem',
  'principalKind',
  'onBehalfOf',
  'audience',
  'userId',
  'tenantId',
  'email',
  'accessToken',
  'tabPermissions',
  'posture',
  'org_user_ids',
  'accessible_org_ids',
  'oauthScopes',
  'timezone',
  'locale',
  'currency',
] as const satisfies readonly EntryExecutionContextField[];

/**
 * Compile-time proof that {@link ENTRY_EXECUTION_CONTEXT_FIELDS} covers the
 * whole closed set. A new `ExecutionContext` field that is neither assembled
 * nor listed as non-entry-resolved makes this `never`, and the initializer
 * below fails to compile.
 */
type MissingEntryField = Exclude<
  EntryExecutionContextField,
  (typeof ENTRY_EXECUTION_CONTEXT_FIELDS)[number]
>;
const _ENTRY_FIELDS_EXHAUSTIVE: [MissingEntryField] extends [never] ? true : never = true;
void _ENTRY_FIELDS_EXHAUSTIVE;

/**
 * OAuth 2.1 access-token provenance. Reaches the assembler from the `/mcp`
 * dispatch door ALONE (`acceptOAuthAccessToken`) — OAuth bearers carry coarse
 * tool-family scopes enforced at MCP tool dispatch, so honouring them on
 * another surface would bypass that scope model entirely.
 */
export interface OAuthTokenProvenance {
  /** The human `sub` the token was issued for. */
  userId: string;
  /** Granted scopes — the agent's own permission CEILING. */
  scopes: string[];
  /**
   * The authorized client (`azp`). Present ⇒ this is an AI AGENT acting on
   * behalf of the human `userId`; absent ⇒ the token names no client and the
   * principal stays human (the scopes are still surfaced).
   */
  clientId?: string;
}

/** Reference localization for an authenticated principal (@see resolveLocalizationContext). */
export interface EntryLocalization {
  timezone?: string;
  locale?: string;
  currency?: string;
}

/**
 * Everything the shared assembly needs. Every key is REQUIRED so a face cannot
 * silently omit one — a face that has no value for an input passes `undefined`
 * on the record, which is what turns the remaining divergences into named API.
 */
export interface ExecutionContextAssemblyInput {
  /** The shared authorization envelope (@see resolveAuthzContext). */
  authz: ResolvedAuthzContext;
  /**
   * OAuth access-token provenance, or `undefined` on a face that does not
   * accept one. Only the `/mcp` dispatch door passes a value; REST passes
   * `undefined` — which is why `principalKind: 'agent'`, `onBehalfOf` and
   * `oauthScopes` are not representable there.
   */
  oauth: OAuthTokenProvenance | undefined;
  /**
   * Resolved reference localization, or `undefined` when the face resolved
   * none (anonymous requests have no scope to resolve against).
   */
  localization: EntryLocalization | undefined;
  /**
   * The request's OWN locale preference (`Accept-Language`, `?locale`, …),
   * which wins over the workspace default; `undefined` when the caller
   * expresses none. Each face extracts it its own way — the PRECEDENCE lives
   * here so the two cannot disagree about it (#3957).
   */
  requestLocale: string | undefined;
  /**
   * The session bearer to carry on the envelope, surfaced to hooks as
   * `session.accessToken` (`objectql/engine.ts` `buildSession`,
   * `spec/data/hook.zod.ts`).
   *
   * A NAMED per-face divergence, preserved deliberately (#6216): the runtime /
   * MCP dispatcher passes `authz.accessToken`; the REST face has never carried
   * it and passes `undefined`, because widening a published hook surface to
   * expose the session token on a second transport is a product decision, not a
   * refactor. Being a required input, the choice is on the record at each face
   * instead of being an omission nobody can see.
   */
  accessToken: string | undefined;
}

/** Drop `undefined`-valued keys, emitting in the closed set's declared order. */
function emit(fields: ExecutionContextEntryFields): ExecutionContext {
  const ctx: Record<string, unknown> = {};
  for (const key of ENTRY_EXECUTION_CONTEXT_FIELDS) {
    const value = fields[key];
    if (value !== undefined) ctx[key] = value;
  }
  return ctx as ExecutionContext;
}

/**
 * Decide every field of the closed set. The one branch is the principal's
 * PROVENANCE (agent / human / guest); everything else is a single expression
 * shared by every face.
 */
function entryFields(
  input: ExecutionContextAssemblyInput,
  anonymous: boolean,
): ExecutionContextEntryFields {
  const { authz, oauth, localization, requestLocale, accessToken } = input;

  // [ADR-0090 D10 — agent principal] An OAuth access token naming an authorized
  // client (`azp`) is an AI agent acting ON BEHALF OF the human `sub`. The
  // agent's OWN grants are its scope-derived CEILING, NOT the user's — so the
  // user-derived positions/permissions/systemPermissions are REPLACED with that
  // ceiling. The human stays the delegator (`onBehalfOf`), and the security
  // engine intersects the two so the agent can never exceed EITHER its
  // consented scope OR the user's own reach (confused-deputy prevention).
  // `userId` stays the human so owner-stamping and `current_user.*` RLS resolve
  // to them.
  const agent = !anonymous && oauth?.clientId ? oauth : undefined;

  return {
    // [ADR-0090 D9/D10] Principal taxonomy at the HTTP entry: a session-backed
    // request is a human principal; a sessionless one is a guest, holding the
    // built-in `guest` position implicitly and exclusively. Internal engine
    // calls that construct bare contexts never pass through here, so the
    // security plugin's empty-context skip path keeps its meaning.
    positions: agent ? [] : anonymous ? ['guest'] : authz.positions,
    permissions: agent ? scopesToAgentPermissionSets(agent.scopes) : authz.permissions,
    // [ADR-0090 D10] System capabilities on the agent principal gate business
    // ACTION invocation (`actionPermissionError` reads `ctx.systemPermissions`)
    // — a door SEPARATE from the object CRUD/FLS/RLS intersection, which is
    // driven by the resolved ceiling SETS (they carry no caps, so cap-gated
    // OBJECT access stays denied to the agent regardless of this line). The
    // `actions:execute` scope IS the user's consent to let this agent invoke
    // actions on their behalf; without it the agent holds none.
    systemPermissions: agent
      ? agent.scopes?.includes(MCP_OAUTH_SCOPE_ACTIONS)
        ? (authz.systemPermissions ?? [])
        : []
      : authz.systemPermissions,
    isSystem: false,
    principalKind: agent ? 'agent' : anonymous ? 'guest' : 'human',
    onBehalfOf: agent ? { userId: authz.userId!, principalKind: 'human' } : undefined,
    // [ADR-0090 D10/D11 — P1 shape] No transport resolves an external
    // (portal/partner) audience yet; `undefined` reads as 'internal'. Named
    // here rather than excluded so the gap is visible in the closed set instead
    // of being invisible outside it — when an external principal type lands,
    // this is the line that must change, on every face at once.
    audience: undefined,
    userId: authz.userId,
    tenantId: authz.tenantId,
    email: authz.email,
    accessToken,
    tabPermissions: authz.tabPermissions,
    // [ADR-0095 D2 / #2947] The derived posture rung, carried so every
    // transport presents enforcement the SAME value. Present only for an
    // authenticated principal (guest → absent).
    posture: authz.posture,
    /** Fellow-org user IDs for RLS scoping of identity tables. */
    org_user_ids: authz.org_user_ids,
    // [ADR-0105 D2] The caller's org access set — the `group` posture's Layer 0
    // wall reads it directly, so every transport must carry it (#6206).
    accessible_org_ids: authz.accessible_org_ids,
    // OAuth provenance: surface the token's granted scopes so the MCP
    // dispatcher can narrow the exposed tool families (undefined for every
    // other provenance = not scope-limited).
    oauthScopes: oauth && authz.userId === oauth.userId ? oauth.scopes : undefined,
    // Anonymous → no localization (no scope to resolve against); the engine
    // default stands. [#3957] The request's OWN language preference wins over
    // the workspace default, so a rejection message is not rendered in English
    // beside the Chinese label of the very field it names.
    timezone: anonymous ? undefined : localization?.timezone,
    locale: anonymous ? undefined : (requestLocale ?? localization?.locale),
    currency: anonymous ? undefined : localization?.currency,
  };
}

/**
 * The DEFAULT, fail-closed entry (#6216 Option A). An unauthenticated request
 * yields NO context — the surface answers 401. Every surface uses this one
 * unless serving anonymous principals is part of its product semantics.
 */
export function assembleExecutionContext(
  input: ExecutionContextAssemblyInput,
): ExecutionContext | undefined {
  if (!input.authz.userId) return undefined;
  return emit(entryFields(input, false));
}

/**
 * The EXPLICIT guest entry (#6216 Option A). An unauthenticated request becomes
 * a first-class guest principal — `principalKind: 'guest'`, `positions:
 * ['guest']` — which enforcement consumers read today
 * (`plugin-security/explain-engine.ts`: guest ⇒ `EXTERNAL` posture).
 *
 * Adopt this ONLY on a surface that genuinely serves anonymous principals: the
 * built-in `guest` position is the declared vocabulary for "what anonymous may
 * do", and handing a guest envelope to a surface that previously answered 401
 * converts an authentication failure into an authorization evaluation.
 */
export function assembleExecutionContextOrGuest(
  input: ExecutionContextAssemblyInput,
): ExecutionContext {
  return emit(entryFields(input, !input.authz.userId));
}
