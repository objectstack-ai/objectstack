// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * resolveRequestExecutionContext — the ONE composition that turns an inbound
 * request into the caller's {@link ExecutionContext}.
 *
 * ## Why it exists (ruling record 6227928430, letter A)
 *
 * Five platform doors each hand-rolled the same steps around the shared
 * pieces: read the session through the auth service, classify the tenancy
 * posture, call `resolveAuthzContext`, pick the anonymous entry, resolve the
 * localization, decide the ADR-0069 gate, and assemble the envelope. Each copy
 * was repaired separately when it omitted one input another copy had (the
 * tenancy posture, the in-process session read, six envelope fields). This
 * function is those steps, once. A door supplies the pieces it holds and
 * states its intentional differences as the named parameters below; ⛔ a door
 * never re-composes the steps beside it.
 *
 * ## The two choices, made here
 *
 * 1. **The anonymous entry** ({@link RequestExecutionContextInput.anonymous}).
 *    `'fail-closed'` is the default entry: a request that resolves no
 *    principal yields NO context, and the door answers 401
 *    (`assembleExecutionContext`). `'guest'` serves the request as the
 *    first-class guest principal and resolves the guest anchor's grants
 *    (`assembleExecutionContextOrGuest`, `resolveAuthzContext`'s
 *    `guestEntry`). A door takes `'guest'` only when serving anonymous
 *    principals is its product semantics (ADR-0138 D2 lists those doors).
 * 2. **The ADR-0069 authentication-policy gate**
 *    ({@link RequestExecutionContextInput.authGate}). The posture is decided
 *    for whichever credential admitted the caller, by the shared key-admission
 *    seam for an API key and from the session read for a session. A door either
 *    carries it on the envelope for a consumer that reads it there, or
 *    withholds it because it enforces the gate at its own seam.
 *
 * ## The named parameters, and the door each one exists for
 *
 * Every key is REQUIRED, the way `ExecutionContextAssemblyInput`'s are: a door
 * that has no value passes `undefined` or the withholding literal on the
 * record, so a door cannot drop an input by omission.
 *
 * | parameter | values, and the door that takes each |
 * |:--|:--|
 * | `anonymous` | `'guest'`: the runtime / MCP dispatcher. `'fail-closed'`: REST, settings, storage, the `/auth/me` endpoints |
 * | `authGate` | `'withhold'`: the dispatcher (its `enforceAuthGate` re-reads the session; a key's answer leaves through `onAdmission`) and the `/auth/me` endpoints (allow-listed for a gated user). `'resolved'`: settings and the storage download door. `'reread-when-active'`: REST. The storage family's ADR-0069 gate reader, which runs before every storage route, stays hand-written beside this function (#24366) |
 * | `credentials` | `'session-only'`: the `/auth/me` endpoints, which never opened an API-key door. `'api-key-and-session'`: every other door |
 * | `sessionApi` | `'required'`: REST and the `/auth/me` endpoints, which authenticate nobody without a session API. `'optional'`: the dispatcher, settings and storage, which still admit an API key |
 * | `session` | `'request'`: every door. `{ established }` / `'none'`: the dispatcher's `/mcp` face, for a verified / an unverifiable OAuth access token |
 * | `tenancy` | the door's own way to reach the `tenancy` service (#16013: the resolution stays at the door), or `undefined` where the door reads no posture (the `/auth/me` endpoints) |
 * | `localization` | the door's settings-service lookup (the dispatcher, REST), or `'withhold'` (the `/auth/me` endpoints read the cascade per endpoint) |
 * | `requestLocale` | the door's own parse: `Accept-Language` (the dispatcher), the header or `?locale` (REST), none (the `/auth/me` endpoints) |
 * | `accessToken` | `'carry'`: the dispatcher and the storage download door. `'withhold'`: REST and the `/auth/me` endpoints |
 * | `oauth` | the dispatcher's `/mcp` face, which alone speaks the OAuth scope vocabulary; `undefined` elsewhere |
 * | `onAdmission` | the dispatcher, whose gate needs the credential the envelope does not carry; `undefined` elsewhere |
 *
 * ## What stays at the door
 *
 * How the door reaches its services (a kernel per environment, a plugin
 * context, a registry slice), how it turns its transport's headers into a Web
 * `Headers`, how it answers a fault (this function PROPAGATES every
 * rejection: an unreadable permission store, an unreadable posture or gate, an
 * API key its own lifecycle refuses), and what it does with the context
 * afterwards. Those are transport facts, not the composition.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AuthSessionApi, IAuthService } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';

import { classifyAdmissionTenancyPosture, type TenancyServiceResolver } from './admission-tenancy-posture.js';
import { apiKeyLifecyclePolicySourceOf } from './api-key.js';
import {
  assembleExecutionContext,
  assembleExecutionContextOrGuest,
  type EntryLocalization,
  type ExecutionContextAssemblyInput,
  type OAuthTokenProvenance,
} from './assemble-execution-context.js';
import { normalizeAuthGate, userAuthGateSourceOf, type AuthGate } from './auth-gate.js';
import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';
import { resolveAuthzContext, resolveLocalizationContext, type ResolvedAuthzContext } from './resolve-authz-context.js';

/** The slice of the kernel's `auth` service this composition reads. */
export type RequestAuthService = Pick<
  IAuthService,
  'api' | 'getApi' | 'isAuthGateActive' | 'resolveUserAuthGates' | 'resolveApiKeyLifecyclePolicy'
>;

/**
 * A session a door has already established from a credential other than the
 * request's own session: the dispatcher's verified OAuth access token. The
 * organization is the one the token's consent bound, and the session arm vets
 * it as it vets a browser session's active organization (ADR-0090 D10).
 */
export interface EstablishedRequestSession {
  user: { id: string };
  session: { userId: string; activeOrganizationId?: string };
}

/** Which credential admitted the principal, and the ADR-0069 posture decided for it. */
export interface RequestAdmission {
  credential: 'api_key' | 'session';
  authGate: AuthGate | undefined;
}

/** Everything the composition reads. Every key is required; see the module docblock. */
export interface RequestExecutionContextInput {
  /** The request's headers, as a Web `Headers`. */
  headers: Headers;
  /** The data engine (ObjectQL), or `undefined` when the door has none. */
  ql: unknown;
  /** The kernel's `auth` service, or `undefined` when none is reachable. */
  authService: RequestAuthService | undefined;
  /**
   * How this door reaches the `tenancy` service, handed to
   * `classifyAdmissionTenancyPosture` (never registered: no posture; failed:
   * the 503 outage). `undefined`: this door reads no posture.
   */
  tenancy: TenancyServiceResolver | undefined;
  /** Choice 1: the anonymous entry. */
  anonymous: 'fail-closed' | 'guest';
  /**
   * Choice 2: the ADR-0069 gate on the envelope.
   *
   * - `'withhold'`: never on the envelope; the door enforces the gate itself.
   * - `'resolved'`: the posture `resolveAuthzContext` decided for whichever
   *   credential admitted the caller, from the read that admitted it.
   * - `'reread-when-active'`: an API key's posture as `'resolved'`; for the
   *   request's own session, read again only while the auth service says a
   *   gate is active (`isAuthGateActive()`, a probe that throws reads as
   *   inactive). A re-read that fails is `AuthzStoreUnavailableError('auth_gate')`:
   *   a gate the deployment declared active is never dropped silently.
   */
  authGate: 'withhold' | 'resolved' | 'reread-when-active';
  /** Which credential doors this door opens. `'session-only'` reads no API key. */
  credentials: 'api-key-and-session' | 'session-only';
  /**
   * `'required'`: with no auth service, or one exposing no session read, this
   * door authenticates nobody, the API-key door included. `'optional'`: the
   * API-key door still admits.
   */
  sessionApi: 'optional' | 'required';
  /**
   * Where the session arm reads its session. `'request'`: the auth service's
   * read of this request, under the in-process rule (a request carrying a
   * session cookie reads without renewal). `{ established }`: a session the
   * door established from another credential. `'none'`: the door's own
   * credential failed, and no session answers for it, ⛔ the cookie beside it
   * included.
   */
  session: 'request' | 'none' | { readonly established: EstablishedRequestSession };
  /**
   * For an authenticated principal, the door's settings-service lookup for the
   * reference localization (a lookup that rejects reads as no service), or
   * `'withhold'` to resolve none.
   */
  localization: 'withhold' | { readonly settings: () => unknown };
  /** The request's own locale preference, parsed by the door; wins over the workspace default. */
  requestLocale: string | undefined;
  /** Whether the session bearer rides the envelope to hooks (`session.accessToken`). */
  accessToken: 'carry' | 'withhold';
  /** OAuth access-token provenance, derived by the one door that accepts one. */
  oauth: OAuthTokenProvenance | undefined;
  /** Told which credential admitted the principal; not called for an anonymous request. */
  onAdmission: ((admission: RequestAdmission) => void) | undefined;
}

/** `.api` (the legacy direct mount) or `getApi()` (the lazy plugin). */
async function sessionApiOf(authService: RequestAuthService | undefined): Promise<AuthSessionApi | undefined> {
  let api = authService?.api;
  if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
  return api;
}

/** Choice 2, for a resolved principal. */
async function decideAuthGate(
  input: RequestExecutionContextInput,
  authz: ResolvedAuthzContext,
  sessionApi: () => Promise<AuthSessionApi | undefined>,
): Promise<AuthGate | undefined> {
  if (input.authGate === 'withhold') return undefined;
  if (input.authGate === 'resolved') return authz.authGate;
  // 'reread-when-active'. A key, or a session the door established from another
  // credential, is judged by the answer the admission already decided.
  if (authz.credential !== 'session' || input.session !== 'request') return authz.authGate;
  let active = false;
  try {
    active = input.authService?.isAuthGateActive?.() === true;
  } catch {
    // A probe that faults never declared a gate.
    active = false;
  }
  if (!active) return undefined;
  let gatedSession: Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;
  try {
    const api = await sessionApi();
    gatedSession = await api!.getSession!(inProcessSessionReadInput(input.headers));
  } catch (err) {
    throw new AuthzStoreUnavailableError('auth_gate', err);
  }
  return normalizeAuthGate(gatedSession?.user) ?? undefined;
}

/**
 * Resolve the request's {@link ExecutionContext}: the guest entry always
 * yields one; the fail-closed entry yields `undefined` for a request that
 * resolves no principal.
 *
 * @throws {AuthzStoreUnavailableError} an authorization input that exists and
 *   could not be read (the permission store, the `tenancy` service, an active
 *   gate's re-read).
 * @throws {ApiKeyLifecycleRefusalError} an API key its own lifecycle refuses.
 */
export function resolveRequestExecutionContext(
  input: RequestExecutionContextInput & { anonymous: 'guest' },
): Promise<ExecutionContext>;
export function resolveRequestExecutionContext(
  input: RequestExecutionContextInput,
): Promise<ExecutionContext | undefined>;
export async function resolveRequestExecutionContext(
  input: RequestExecutionContextInput,
): Promise<ExecutionContext | undefined> {
  const { headers, ql, authService } = input;

  // A door that requires a session API asks for it before any read, and
  // without one authenticates nobody. A door that does not asks lazily, from
  // the session read itself, so an API-key request never builds the auth
  // instance.
  let requiredApi: AuthSessionApi | undefined;
  let credentialsOpen = true;
  if (input.sessionApi === 'required') {
    requiredApi = await sessionApiOf(authService);
    if (typeof requiredApi?.getSession !== 'function') {
      if (input.anonymous === 'fail-closed') return undefined;
      credentialsOpen = false;
    }
  }
  const sessionApi = () => (input.sessionApi === 'required' ? Promise.resolve(requiredApi) : sessionApiOf(authService));

  const tenancyPosture = input.tenancy ? await classifyAdmissionTenancyPosture(input.tenancy) : undefined;

  const session = input.session;
  const readSession = async () => {
    if (session === 'none') return undefined;
    if (typeof session === 'object') return session.established;
    try {
      const api = await sessionApi();
      return await api?.getSession?.(inProcessSessionReadInput(headers));
    } catch {
      return undefined;
    }
  };

  const authz = await resolveAuthzContext({
    ql,
    headers: credentialsOpen && input.credentials === 'api-key-and-session' ? headers : undefined,
    getSession: credentialsOpen ? readSession : undefined,
    tenancyPosture,
    guestEntry: input.anonymous === 'guest' ? true : undefined,
    userAuthGates: userAuthGateSourceOf(authService),
    apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(authService),
  });
  if (authz.userId && authz.credential) {
    input.onAdmission?.({ credential: authz.credential, authGate: authz.authGate });
  }

  // An anonymous request has no scope to localize against and no session for a
  // gate to attach to: both are read only for a resolved principal.
  let localization: EntryLocalization | undefined;
  let authGate: AuthGate | undefined;
  if (authz.userId) {
    if (input.localization !== 'withhold') {
      const settings = await Promise.resolve(input.localization.settings()).catch(() => undefined);
      localization = await resolveLocalizationContext({ ql, settings, tenantId: authz.tenantId, userId: authz.userId });
    }
    authGate = await decideAuthGate(input, authz, sessionApi);
  }

  const assembly: ExecutionContextAssemblyInput = {
    authz,
    oauth: input.oauth,
    localization,
    requestLocale: input.requestLocale,
    accessToken: input.accessToken === 'carry' ? authz.accessToken : undefined,
    authGate,
  };
  return input.anonymous === 'guest' ? assembleExecutionContextOrGuest(assembly) : assembleExecutionContext(assembly);
}
