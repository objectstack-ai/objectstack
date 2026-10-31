// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector, RetryConfigParsed } from './connector.zod';
import type { ResolvedConnectorAuth } from '../shared/connector-auth.zod';

/**
 * Connector **provider** contract (ADR-0097).
 *
 * A provider is a *generic executor* — `openapi` (ADR-0023), `mcp` (ADR-0024),
 * `rest`, … — contributed by a connector plugin as a **factory**. At boot the
 * automation service resolves each declarative provider-bound `connectors:`
 * entry by invoking the matching factory, which turns the entry's declarative
 * inputs into the same `{ def, handlers }` bundle a hand-written connector hands
 * to `registerConnector`. The registry, the `connector_action` node, and the
 * `GET /connectors` discovery route then see a finished connector — they never
 * know it was materialized from stack metadata (ADR-0097 §2).
 *
 * These are pure types (no logic — Prime Directive #2) so a connector plugin can
 * implement a provider factory depending only on `@objectstack/spec`, with no
 * runtime coupling to `@objectstack/service-automation` (mirrors how the plugins
 * already avoid importing the engine, using a structural registry surface).
 */

// ============================================================================
// Per-dispatch credential handle (ADR-0143 D4, D7)
//
// A grant-bearing credential (`oauth2`, `app-credential`) is not resolved once
// at materialization: its access token expires, is refreshed on expiry and
// once on an upstream `401`, and a rotating refresh token must never be spent
// twice. So a consumer does not receive a value — it receives a HANDLE it asks
// on every request. ADR-0143 D7: "a provider receives a credential source
// answered per dispatch, an interface rather than a schema", separate from the
// `CredentialResolver` that keeps resolving `credentialRef`s.
//
// These types were first declared in `@objectstack/types`
// (`connector-credential-source.ts`) for the datasource borrow path (ADR-0015
// amendment D7), which re-exports them from here unchanged. They live in the
// spec now because a connector package depends on `@objectstack/spec` only, and
// `ConnectorProviderContext` below hands a provider the same handle.
//
// ⛔ A credential value crosses this seam only as the return of `get` /
// `refresh`, into the request it authenticates; nothing here logs, stores or
// echoes it.
// ============================================================================

/**
 * The credential a consumer presents on one request — the resolved form of a
 * connector instance's `auth`, never its reference. A grant-bearing kind's
 * access token takes one of these forms too: `bearer` for an OAuth2 token, and
 * the header or query parameter a vendor's app-credential exchange documents
 * (`api-key` with `headerName` / `paramName`).
 */
export type BorrowedConnectorAuth =
  | { type: 'bearer'; token: string }
  | { type: 'api-key'; key: string; headerName: string; paramName?: string }
  | { type: 'basic'; username: string; password: string };

/** One answer of a {@link ConnectorCredentialHandle}. */
export interface BorrowedConnectorCredential {
  /** What to send. */
  readonly auth: BorrowedConnectorAuth;
  /**
   * When the credential stops being valid, in epoch milliseconds. Absent for
   * a credential with no known lifetime (the static kinds). A credential at
   * or past `expiresAt` minus the skew margin is refreshed before it is sent.
   */
  readonly expiresAt?: number;
}

/** What a credential is asked in the name of. */
export interface ConnectorCredentialRequest {
  /**
   * The organization of the request the credential is for (ADR-0143 Q1 = A,
   * an organization-shared connection). Absent for a read that carries none
   * — a boot-time drift check, a schedule — which ADR-0143 D4 answers from
   * the instance's connection only when exactly one exists. A static
   * credential is environment-level and answers the same either way.
   */
  readonly organizationId?: string;
}

/**
 * A credential bound to one connector instance, asked on every request. The
 * datasource borrow path receives one from `IConnectorCredentialSource.borrow`
 * (`@objectstack/types`); a provider factory receives one as
 * {@link ConnectorProviderContext.credentialHandle}.
 */
export interface ConnectorCredentialHandle {
  /** The connector instance this handle answers for. */
  readonly connector: string;
  /**
   * The credential to send now. Throws a refusal carrying `code` and
   * `status` when none can be answered (the credential is not set, the
   * store cannot be read, the instance was disabled, the grant was revoked):
   * `503 SERVICE_UNAVAILABLE`, since each clears without a change to the
   * consumer's own declaration.
   */
  get(request?: ConnectorCredentialRequest): Promise<BorrowedConnectorCredential>;
  /**
   * A credential obtained again, for the request that was refused with the
   * one {@link get} answered (a `401`) or that would send an expired one.
   * Concurrent calls on one handle share one refresh, so a rotating grant is
   * never spent twice. Throws as {@link get} does.
   */
  refresh(request?: ConnectorCredentialRequest): Promise<BorrowedConnectorCredential>;
}

// ============================================================================
// Per-request signer (ADR-0143 D2.3, D4)
//
// A `signed` instance has no token: every outgoing request is signed with the
// key its `credentialRef` names, by the vendor's canonical-request algorithm.
// ADR-0143 D4 answers such an instance per dispatch with "a signer bound to its
// key", so the key never crosses this seam — the host resolves the reference,
// binds a signer to it, and hands the provider only the signer. A provider asks
// it on EVERY attempt it sends, retries included: a signature carries a
// timestamp and a nonce, and an upstream refuses one replayed.
//
// The seam carries the optional response-verification step from the start
// (ADR-0143 Q4 condition 2): a scheme whose vendor signs its responses
// implements `verifyResponse`, and a provider runs it over the raw body before
// it parses or returns anything.
//
// ⛔ Nothing here logs, stores or echoes a signature or the key behind it.
// ============================================================================

/** The request a {@link ConnectorRequestSigner} signs — exactly what is sent. */
export interface ConnectorSignableRequest {
  /** The HTTP method, upper case. */
  readonly method: string;
  /** The absolute URL, query string included, as it would be sent. */
  readonly url: string;
  /** The request's own headers, as they would be sent, before the signer's. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body as sent, or `undefined` when the request carries none. */
  readonly body?: string;
}

/** What a signer adds to one request. */
export interface ConnectorRequestSignature {
  /**
   * Headers to set on the request, each replacing any header of the same name
   * (compared case-insensitively): the signature itself and every value the
   * scheme signs that the signer chose (a timestamp, a nonce, a body digest).
   */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The URL to send in place of the request's own, when the scheme signs the
   * query string in a canonical encoding: the same resource and the same
   * parameters, spelled the way the signature covers them. Absent ⇒ the
   * request's own URL is sent.
   */
  readonly url?: string;
}

/** The response a verifying signer checks, its body read raw before any parse. */
export interface ConnectorSignedResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** The body exactly as received. */
  readonly body: string;
}

/**
 * A request signer bound to one connector instance's key (ADR-0143 D2.3, D4).
 * A provider factory receives one as {@link ConnectorProviderContext.requestSigner}
 * and applies it to every upstream request it sends.
 */
export interface ConnectorRequestSigner {
  /** The connector instance this signer signs for. */
  readonly connector: string;
  /** The scheme it implements — a member of `ConnectorSigningSchemeSchema`. */
  readonly scheme: string;
  /**
   * Sign one request. Called once per attempt, so a retried request carries a
   * fresh signature. Throws when the request cannot be signed (a body that is
   * not text); the request is then not sent.
   */
  sign(request: ConnectorSignableRequest): Promise<ConnectorRequestSignature>;
  /**
   * Verify the upstream's signature over a response, for a scheme whose vendor
   * signs its responses; absent for a scheme whose vendor does not. Resolves
   * when the response is authentic and throws when it is not — the response
   * is then treated as the dispatch's failure and its body is never returned.
   * Which responses the vendor signs (every status, or 2xx only) is the
   * scheme's to decide, so a provider passes every response.
   */
  verifyResponse?(response: ConnectorSignedResponse): Promise<void>;
}

/**
 * A single materialized connector action handler. Receives the input the
 * `connector_action` node mapped from the flow, ignores the dispatch context
 * (materialized handlers close over their own transport), and returns the
 * action output. Structurally identical to the handler map the generator APIs
 * already produce (`createOpenApiConnector` / `createRestConnector` / MCP).
 */
export type ConnectorMaterializationHandler = (
  input: Record<string, unknown>,
  ctx: unknown,
) => Promise<Record<string, unknown>>;

/**
 * The result of materializing a provider-bound instance: the validated
 * {@link Connector} definition, a handler per action, and an optional `close`
 * for connectors that hold a live resource (an MCP connection, a pooled client)
 * so the automation service can tear it down on shutdown.
 */
export interface ConnectorMaterialization {
  def: Connector;
  handlers: Record<string, ConnectorMaterializationHandler>;
  close?: () => void | Promise<void>;
  /**
   * `true` when the upstream accepted the instance's resolved `auth` while
   * materializing — the credential travelled with a request the upstream
   * answered (an MCP handshake over http). The automation service then records
   * the credential as verified, and a stored one marked `rejected` returns to
   * `set`. Leave it unset when materializing sends no credential (a provider
   * that first presents it on a call): a call answered `2xx` is not proof,
   * since the endpoint may not check the credential, so such a provider's
   * `rejected` credential stays so until it is set again.
   */
  credentialVerified?: boolean;
  /**
   * `true` when the factory applies {@link ConnectorProviderContext.requestSigner}
   * to every upstream request its handlers send (and runs its
   * `verifyResponse`, when present, on every response). The host serves a
   * `signed` instance only on a materialization that says so: a factory that
   * ignores the member — one that predates it, or a provider whose upstream
   * does not sign, such as MCP — would otherwise call the upstream unsigned,
   * a declared-but-unenforced credential (ADR-0049). Leave it unset when the
   * context carried no signer.
   */
  requestSignerApplied?: boolean;
}

/**
 * Context handed to a {@link ConnectorProviderFactory} for one declarative
 * entry. Carries the entry's identity — the materialized def MUST adopt `name`
 * so the registry, `connector_action`, and the conflict rule all agree — the
 * provider-specific `providerConfig` (the factory validates its own shape), and
 * the `auth` already **resolved** from the entry's `credentialRef` through the
 * secrets/env layer, so the factory receives a usable static credential rather
 * than a raw reference (`undefined` when the entry declares no auth).
 *
 * It also carries the entry's **resilience policy** — `retryConfig` and
 * `requestTimeoutMs` — so a provider that performs its own I/O can honour what
 * the author declared. Before that, those keys were parsed and then reached
 * nothing: a factory was never handed them and had no way to honour them, which
 * is what `packages/spec/liveness/connector.json` recorded as `dead`.
 *
 * ⚠️ `connectionTimeoutMs` was a third member and is **removed** with the spec
 * key (ADR-0049) — see the comment at its former position below. Being handed a
 * value is not the same as honouring it, and nothing ever did.
 */
export interface ConnectorProviderContext {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly type: string;
  readonly providerConfig: Record<string, unknown>;
  /**
   * The entry's static credential, resolved once from its `credentialRef`
   * (`none` / `bearer` / `api-key` / `basic`). `undefined` when the entry
   * declares no auth, and for a grant-bearing kind, which arrives as
   * {@link credentialHandle} instead.
   */
  readonly auth?: ResolvedConnectorAuth;
  /**
   * The per-dispatch credential of a grant-bearing instance — `auth: { type:
   * 'oauth2' }` or `{ type: 'app-credential' }` (ADR-0143 D4, D7). The host
   * sets it for those kinds, and only for them; {@link auth} is then
   * `undefined`. A factory asks it on every upstream request rather than
   * closing over one value, refreshes once on a `401` and retries once, and
   * treats a refusal from the handle as the dispatch's failure.
   *
   * `undefined` for the static kinds and on a host that predates this member;
   * a factory handed a grant-bearing entry without it fails the instance with
   * a clear message rather than calling the upstream unauthenticated.
   */
  readonly credentialHandle?: ConnectorCredentialHandle;
  /**
   * The request signer of a `signed` instance (ADR-0143 D2.3, D4), bound to the
   * key the entry's `credentialRef` resolved to — the key itself never reaches
   * the factory. The host sets it for that kind, and only for it; {@link auth}
   * is then `undefined`. A factory signs every attempt it sends with it (a
   * retry included), runs its `verifyResponse` over every response before
   * parsing it, and says so by returning
   * {@link ConnectorMaterialization.requestSignerApplied}; the host refuses to
   * serve a `signed` instance on a materialization that does not.
   */
  readonly requestSigner?: ConnectorRequestSigner;
  /**
   * The entry's declared retry policy, **resolved** — the host parses it so the
   * schema's defaults (`maxAttempts: 3`, `[408, 429, 500, 502, 503, 504]`, …)
   * are already applied and a factory reads real values rather than re-deriving
   * them. `undefined` when the entry declares none.
   *
   * A factory that performs its own I/O honours it by handing this (and
   * {@link requestTimeoutMs}) to `connectorFetchOptions()` →
   * `resilientFetch()`; the built-in HTTP providers do exactly that, which is
   * what makes the keys live rather than merely carried.
   */
  readonly retryConfig?: RetryConfigParsed;
  // `connectionTimeoutMs` — REMOVED (ADR-0049 enforce-or-remove). #18975 added
  // it here as a pure carry: "handed over so a custom provider on a transport
  // that CAN separate the phases could honour it". Measured before removal, no
  // provider did — the built-in `rest` and `openapi` factories read
  // `ctx.connectionTimeoutMs` only to deposit it back onto the def that
  // `GET /connectors` echoes, and `connectorFetchOptions()` was never handed it.
  // Carrying an inert number across a published interface is the same
  // parsed-unmarked-unenforced state on one more surface, so the carry is
  // withdrawn with the key. There is no source for a D2 conversion to rewrite
  // here — a factory is code — which is why the withdrawal is declared as the
  // D3 semantic entry `connector-provider-context-connection-timeout-ms-retired`
  // rather than a conversion. A factory that needs a connect bound reads it from
  // its own `providerConfig`, where the provider owns the vocabulary.
  /**
   * The entry's declared per-request deadline (ms). The built-in HTTP path
   * applies it as `resilientFetch`'s per-attempt timeout.
   */
  readonly requestTimeoutMs?: number;
  /**
   * Host-injected package file reader (#3016, ADR-0097 follow-up). Resolves a
   * **relative** path against the root of the stack/package that declared the
   * entry and returns the file's UTF-8 text, so a factory can support file-path
   * refs like `providerConfig.spec: './billing-openapi.json'` without owning
   * filesystem access itself. The host confines reads to the package root:
   * absolute paths and `..`-escaping paths are rejected (throws). Missing /
   * unreadable files also throw, which the materializer's reconcile policy
   * turns into a hard boot error (fatal) or a skipped entry (reload).
   * `undefined` on hosts without a filesystem (edge/browser kernels) — a
   * factory needing a file must then fail with a clear message.
   */
  readonly loadPackageFile?: (relativePath: string) => Promise<string>;
  /**
   * Host-injected package path resolver (ADR-0097 follow-up), the sibling of
   * {@link loadPackageFile} for a factory that needs a **location** rather than
   * file contents — e.g. a working directory for a process the provider
   * launches, so the declaring app's relative paths resolve against the app's
   * root and not against wherever the server happened to be started.
   *
   * Resolves a **relative** path against the root of the stack/package that
   * declared the entry and returns the absolute path. `'.'` returns the root
   * itself. It follows the same confinement rule as `loadPackageFile`, and the
   * host enforces both with one check: an empty path, an absolute path, and a
   * path that escapes the root after resolution (`../x`, `a/../../x`) are
   * rejected (throws). The check is on the normalized path, not on symlink
   * targets. It does not check that the path exists — what to do with a
   * missing location is the factory's call.
   *
   * `undefined` on hosts that cannot provide it (edge/browser kernels, or a
   * host that predates this member) — a factory then keeps the behaviour it
   * had without it, or fails with a clear message if it cannot.
   */
  readonly resolvePackagePath?: (relativePath: string) => Promise<string>;
}

/**
 * A provider factory contributed by a connector plugin under a provider key.
 * Invoked once per declarative instance at boot; may be async (loading a spec
 * document, opening a connection). Throwing is a **hard boot error** — invalid
 * `providerConfig`, an unresolvable credential, etc. surface loudly rather than
 * yielding a silently-dead connector (ADR-0097 §Decision). One exception
 * (#3017): a throw carrying the `CONNECTOR_UPSTREAM_UNAVAILABLE` code (see
 * `connector-provider-errors.ts`) marks an *operational* fault — the upstream
 * the factory must contact is temporarily unreachable — which the materializer
 * degrades and retries instead of failing boot.
 */
export type ConnectorProviderFactory = (
  ctx: ConnectorProviderContext,
) => ConnectorMaterialization | Promise<ConnectorMaterialization>;
