// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SettingsService — the runtime implementation of ADR-0007.
 *
 * Responsibilities:
 *  - Maintain an in-memory registry of `SettingsManifest` instances.
 *  - Read/write values from the shared `sys_setting` K/V table via the
 *    `objectql` data engine, with an in-memory fallback so the service
 *    is usable before a real persistence layer is wired up (e.g. unit
 *    tests, bootstrap, control-plane mock).
 *  - Resolve effective values with `OS_* env > Tenant > User > Default`
 *    precedence and tag every value with provenance.
 *  - Encrypt-at-rest for `encrypted: true` specifiers using a pluggable
 *    {@link CryptoAdapter}.
 *  - Emit `sys_audit_log` rows for every successful write (encrypted
 *    values are masked).
 *  - Dispatch `runAction` for `action_button` specifiers — used by
 *    "Test connection" / "Send test email" etc.
 *
 * The service is intentionally framework-agnostic: it doesn't import
 * the HTTP server, the plugin context, or the audit object schema. The
 * plugin wires those pieces up.
 */

import type { FieldError } from '@objectstack/spec/api';
import type { SettingsActionResult, SpecifierScope } from '@objectstack/spec/system';
import { type CryptoAdapter } from './crypto-adapter.js';

/** Caller identity used by the resolver and audit log. */
export interface SettingsContext {
  /** Calling user id, when known. Required for `scope: 'user'` reads. */
  userId?: string;
  /** Tenant / project id. Reserved for multi-tenant deployments. */
  tenantId?: string;
  /** Permissions held by the caller (used by REST authz). */
  permissions?: string[];
  /** Source IP / request id for audit correlation. */
  requestId?: string;
  /**
   * [Finding-1] Marks a context that arrived across the HTTP trust boundary
   * (set by the settings routes) as opposed to a trusted in-process/boot caller.
   * When true, the service ENFORCES the manifest's `readPermission` /
   * `writePermission` and drops the "empty permissions ⇒ pass-through" escape —
   * so an unauthenticated request can neither enumerate protected namespaces nor
   * write. In-process callers (seed/boot/kernel.getService('settings')) leave it
   * unset and keep full trusted access.
   */
  enforced?: boolean;
}

/** Storage row shape used by both the engine and the in-memory store. */
export interface SettingsRow {
  namespace: string;
  key: string;
  scope: SpecifierScope;
  user_id: string | null;
  value: unknown | null;
  value_enc: string | null;
  encrypted: boolean;
  /**
   * When true, lower-scope rows for the same (namespace, key) are
   * read-only — the resolver still returns this row's value and the
   * mutation API throws `SettingsLockedError`. Only meaningful on
   * upper-scope rows (`global`, `tenant`). (Phase 2)
   */
  locked?: boolean;
  /** Human-readable reason the lock was applied (UI tooltip). */
  locked_reason?: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

/**
 * Minimal data-engine surface used by the SettingsService. Mirrors the
 * methods we actually call so we can stub it cleanly in tests without
 * pulling the whole `IDataEngine`.
 */
export interface SettingsEngine {
  find(
    objectName: string,
    opts: { where?: Record<string, unknown>; limit?: number; bypassTenantAudit?: boolean },
  ): Promise<any[]>;
  insert(
    objectName: string,
    data: Record<string, unknown>,
    opts?: { bypassTenantAudit?: boolean },
  ): Promise<any>;
  update(
    objectName: string,
    opts: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
      bypassTenantAudit?: boolean;
      /**
       * Execution context for the write, forwarded VERBATIM to the data
       * engine's `options.context` (#8030).
       *
       * `SettingsService` sends `{ isSystem: true }` here for its own row
       * writes, because `sys_setting.value_enc` and `updated_by` are declared
       * `readonly: true` and the engine strips author-declared read-only
       * columns from a NON-system caller's UPDATE payload
       * (`stripReadonlyFields`). Without it a secret rotation inserts the new
       * ciphertext, answers 200 with a correctly redacted body, and leaves
       * `value_enc` pointing at the OLD handle — the rotated-away credential
       * stays in force.
       *
       * ⛔ An adapter over `IDataEngine` MUST forward this. Dropping it
       * restores the defect silently, with every visible signal still saying
       * the write landed.
       */
      context?: Record<string, unknown>;
    },
  ): Promise<any>;
  delete?(objectName: string, opts: { where: Record<string, unknown> }): Promise<any>;
}

/** Optional audit hook — service-settings won't crash if absent. */
export interface SettingsAuditSink {
  record(entry: {
    namespace: string;
    key: string;
    scope: SpecifierScope;
    userId?: string;
    actor?: string;
    action: 'set' | 'reset';
    valueDigest: string;
    encrypted: boolean;
    requestId?: string;
  }): Promise<void> | void;
}

/**
 * Persistence hook for the `sys_secret` object — used by the secret
 * split introduced in Phase 3. When provided, `SettingsService` writes
 * encrypted specifier values via `ICryptoProvider` into `sys_secret`
 * and stores only the handle id in `sys_setting.value_enc`. When
 * absent, the legacy inline `crypto.encrypt → value_enc` path is used.
 */
export interface SettingsSecretStore {
  /** Insert a new secret row; returns the row id (handle id). */
  insert(row: {
    id: string;
    namespace: string;
    key: string;
    kms_key_id: string;
    alg: string;
    version: number;
    ciphertext: string;
  }): Promise<{ id: string }>;
  /** Look up the latest ciphertext for a handle id; null when missing. */
  get(id: string): Promise<{
    id: string;
    namespace: string;
    key: string;
    kms_key_id: string;
    alg: string;
    version: number;
    ciphertext: string;
  } | null>;
  /** Replace an existing secret row (used by rotateKey). */
  update(id: string, patch: {
    kms_key_id?: string;
    alg?: string;
    version?: number;
    ciphertext?: string;
  }): Promise<void>;
  /**
   * Destroy the row a rotated-away handle names (#8030) — OPTIONAL.
   *
   * Called after a write has repointed `sys_setting.value_enc`, so the row
   * being deleted is unreferenced by construction. The point is security, not
   * housekeeping: a rotation exists to make the previous credential stop
   * existing, and an orphan `sys_secret` row is a decryptable copy of exactly
   * the value the admin retired — one more per rotation, forever.
   *
   * Optional so that a store which genuinely cannot delete (and every
   * pre-existing test double) keeps working: absence means the orphans are
   * accepted, and the rotation itself still lands. A throw is swallowed and
   * reported — it must never turn a successful rotation into an error.
   */
  delete?(id: string): Promise<void>;
}

/**
 * Append-only writer for the `sys_setting_audit` object — Phase 3
 * audit trail. Distinct from `SettingsAuditSink` (which still writes
 * to the generic `sys_audit_log`) so audit consumers can subscribe
 * to settings activity without scanning the firehose.
 */
export interface SettingsAuditWriter {
  write(entry: {
    namespace: string;
    key: string;
    scope: SpecifierScope;
    action: 'set' | 'reset' | 'lock' | 'unlock' | 'rotate';
    source?: 'ui' | 'api' | 'migration' | 'import' | 'system';
    actorId?: string;
    oldHash?: string | null;
    newHash?: string | null;
    encrypted: boolean;
    requestId?: string;
    reason?: string;
  }): Promise<void> | void;
}

/** Action handler signature for `Specifier.type === 'action_button'`. */
export type SettingsActionHandler = (input: {
  namespace: string;
  actionId: string;
  values: Record<string, unknown>;
  payload?: unknown;
  ctx: SettingsContext;
}) => Promise<SettingsActionResult> | SettingsActionResult;

/**
 * Minimal logging surface the service needs: just the loud channel.
 *
 * Deliberately a structural minimum rather than the full `Logger` contract or
 * `PluginContext['logger']` — this service is framework-agnostic by design (it
 * must not learn about the plugin context, see the file header), and a caller
 * can hand over `ctx.logger`, a spec `Logger`, or a two-line test double
 * interchangeably. `error` is optional so the lean test kernels that already
 * call `ctx.logger?.info?.()` defensively are assignable unchanged.
 *
 * One string parameter, and no `...rest`: the service deliberately passes no
 * structured `meta` (a meta field name containing `key` would be redacted away
 * — see `reportRejectedEnvOverride`), and a `...rest: unknown[]` tail would not
 * even accept the spec `Logger` it is meant to accept — its `error(message,
 * error?: Error, meta?)` is narrower than `unknown` in those positions, so the
 * assignment fails contravariantly. Declaring only what is actually called
 * keeps `Logger`, `ctx.logger`, `console.error` and a one-line spy all
 * assignable.
 */
export interface SettingsDiagnosticsLogger {
  error?: (message: string) => void;
}

export interface SettingsServiceOptions {
  /** Persistence engine. When undefined, an in-memory store is used. */
  engine?: SettingsEngine;
  /** Crypto adapter for `encrypted` values. Defaults to NoopCryptoAdapter. */
  crypto?: CryptoAdapter;
  /**
   * Phase 3 ICryptoProvider used together with `secretStore`. When both
   * are wired, encrypted writes flow to `sys_secret` and `value_enc`
   * holds the handle id. When omitted, the legacy inline `crypto`
   * adapter path remains in effect (back-compat).
   */
  cryptoProvider?: import('@objectstack/spec/contracts').ICryptoProvider;
  /** Phase 3 secret store backing the `sys_secret` object. */
  secretStore?: SettingsSecretStore;
  /** Audit sink. When undefined, writes still succeed but are not logged. */
  audit?: SettingsAuditSink;
  /** Phase 3 dedicated writer for `sys_setting_audit`. */
  auditWriter?: SettingsAuditWriter;
  /**
   * `process.env`-like map. Defaults to `process.env`. Injected so
   * unit tests can simulate locked values without polluting the host
   * environment.
   */
  env?: Record<string, string | undefined>;
  /** Object name backing the K/V store. Defaults to 'sys_setting'. */
  objectName?: string;
  /**
   * Sink for the loud-but-non-fatal diagnostics the service emits — today
   * exactly one: an `OS_*` override whose value the specifier's `options`
   * table does not declare (#5204). Optional; falls back to `console.error`
   * so a service built without a kernel (unit tests, control-plane mock,
   * bootstrap before the logger exists) still reports rather than going
   * silent, which is the failure mode #5204 is about.
   */
  logger?: SettingsDiagnosticsLogger;
}

/**
 * Convert `(namespace, key)` to the ObjectStack-owned env var convention:
 * `OS_` prefix, uppercase, dots → underscores, hyphens → underscores.
 */
export function envKeyOf(namespace: string, key: string): string {
  const slug = `${namespace}_${key}`.replace(/[.-]/g, '_').toUpperCase();
  return `OS_${slug}`;
}

/** Thrown when a caller tries to write a value pinned by env. */
export class SettingsLockedError extends Error {
  readonly code = 'SETTINGS_LOCKED' as const;
  constructor(
    readonly namespace: string,
    readonly key: string,
    readonly reason = 'locked-by-env',
  ) {
    super(`Setting '${namespace}.${key}' is locked (${reason}).`);
  }
}

/** Thrown when the requested namespace has no registered manifest. */
export class UnknownNamespaceError extends Error {
  readonly code = 'SETTINGS_UNKNOWN_NAMESPACE' as const;
  constructor(readonly namespace: string) {
    super(`No settings manifest registered for namespace '${namespace}'.`);
  }
}

/** Thrown when a key isn't declared by the namespace's manifest. */
export class UnknownKeyError extends Error {
  readonly code = 'SETTINGS_UNKNOWN_KEY' as const;
  constructor(readonly namespace: string, readonly key: string) {
    super(`Key '${key}' is not declared in manifest '${namespace}'.`);
  }
}

/**
 * [Finding-1] Thrown when an ENFORCED (HTTP-boundary) caller lacks the
 * capability a manifest declares for the operation — `readPermission` for
 * reads, `writePermission` for writes/actions. Maps to HTTP 403. Trusted
 * in-process callers (no `enforced` flag) never hit this.
 */
export class SettingsForbiddenError extends Error {
  readonly code = 'SETTINGS_FORBIDDEN' as const;
  constructor(
    readonly namespace: string,
    readonly required: string,
    readonly operation: 'read' | 'write',
  ) {
    super(
      `Access denied: ${operation === 'read' ? 'reading' : 'writing to'} settings namespace ` +
        `'${namespace}' requires the '${required}' capability`,
    );
  }
}

/**
 * Thrown when a write would leave the namespace in an invalid state —
 * a `required` field that is visible under the post-write values is
 * empty (e.g. provider=cloudflare saved without an API key), a value
 * that does not match its specifier's declared `pattern`, or a value a
 * `select`/`radio`/`multiselect` specifier does not list in its declared
 * `options` (#5131 — those enumerations used to be a front-end
 * convention that the write path never checked). The whole
 * batch is rejected; `fields` carries one entry per offending key, which
 * the UI can render inline against the input it addresses.
 *
 * Since #7169 it also carries the one MANIFEST-side fault this surface refuses:
 * a specifier whose `visible` predicate the save-time evaluator cannot parse
 * (`invalid_value`, with the predicate in `constraint.visible`). Every other
 * entry names something wrong with a submitted value; that one names something
 * wrong with the manifest, and is here rather than in an error class of its own
 * because it is refused on the same write, on the same envelope, and renders
 * against the same input.
 *
 * `fields` is `FieldError[]` — the field-level vocabulary ADR-0114 closed
 * (#3977) — rather than the `Record<key, message>` map it was until #4224.
 * The map predated that catalog and named the constraint only in prose, so
 * a consumer could render the sentence but not branch on *which* constraint
 * failed; `code` (`required` / `invalid_format` / `invalid_option`) now
 * says it in the one spelling every other validator in the platform uses. `label` and
 * `constraint` carry what the message interpolates, so a form can compose
 * its own text instead of parsing ours.
 */
export class SettingsValidationError extends Error {
  readonly code = 'SETTINGS_VALIDATION' as const;
  constructor(
    readonly namespace: string,
    readonly fields: FieldError[],
  ) {
    super(
      `Settings for '${namespace}' are incomplete: ` +
        fields.map((f) => `${f.field} — ${f.message}`).join('; '),
    );
  }
}
