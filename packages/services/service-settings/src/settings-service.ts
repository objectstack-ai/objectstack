// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  SettingsManifest,
  ResolvedSettingValue,
  SettingsNamespacePayload,
  SettingsActionResult,
  SpecifierScope,
  SettingsChangeEvent,
  SettingsChangeHandler,
  SettingsUnsubscribe,
} from '@objectstack/spec/system';
import {
  type CryptoAdapter,
  NoopCryptoAdapter,
} from './crypto-adapter.js';
import {
  type SettingsActionHandler,
  type SettingsAuditSink,
  type SettingsContext,
  type SettingsEngine,
  type SettingsRow,
  type SettingsServiceOptions,
  envKeyOf,
  SettingsLockedError,
  UnknownKeyError,
  UnknownNamespaceError,
} from './settings-service.types.js';

const DEFAULT_OBJECT = 'sys_setting';

/**
 * Value-bearing specifier types — drives which entries we expect to
 * find in the K/V store. Keeps the resolver in sync with the spec
 * without importing the (large) Zod enum at runtime.
 */
const LAYOUT_ONLY_TYPES = new Set([
  'group',
  'info_banner',
  'child_pane',
  'title_value',
  'action_button',
]);

interface RegisteredManifest {
  manifest: SettingsManifest;
  /** Resolved specifier scopes for fast lookup. */
  scopes: Map<string, SpecifierScope>;
  /** Specifiers marked encrypted (or implicit for `password`). */
  encryptedKeys: Set<string>;
  /** Default values from the manifest, keyed by specifier key. */
  defaults: Map<string, unknown>;
  /** Action handlers registered alongside this manifest. */
  actions: Map<string, SettingsActionHandler>;
}

/**
 * Concrete SettingsService. See `src/settings-service.types.ts` for
 * the supporting types and `README.md` for the high-level contract.
 */
export class SettingsService {
  private engine?: SettingsEngine;
  private readonly crypto: CryptoAdapter;
  private cryptoProvider?: import('@objectstack/spec/contracts').ICryptoProvider;
  private secretStore?: import('./settings-service.types.js').SettingsSecretStore;
  private audit?: SettingsAuditSink;
  private auditWriter?: import('./settings-service.types.js').SettingsAuditWriter;
  private readonly env: Record<string, string | undefined>;
  private readonly objectName: string;
  private readonly registry = new Map<string, RegisteredManifest>();
  /** In-memory fallback when no engine is wired. */
  private readonly memory: SettingsRow[] = [];
  /** Change subscribers, optionally scoped to a namespace. */
  private readonly subscribers = new Set<{
    ns?: string;
    handler: SettingsChangeHandler;
  }>();

  constructor(opts: SettingsServiceOptions = {}) {
    this.engine = opts.engine;
    this.crypto = opts.crypto ?? new NoopCryptoAdapter();
    this.cryptoProvider = opts.cryptoProvider;
    this.secretStore = opts.secretStore;
    this.audit = opts.audit;
    this.auditWriter = opts.auditWriter;
    this.env = opts.env ?? (typeof process !== 'undefined' ? process.env : {});
    this.objectName = opts.objectName ?? DEFAULT_OBJECT;
  }

  /**
   * Late-bind a data engine and (optionally) an audit sink. Plugins
   * call this from `kernel:ready` once `objectql` is wired so the
   * SettingsService swaps from its in-memory fallback to the real
   * `sys_setting` table without re-registering the service.
   */
  bindEngine(
    engine: SettingsEngine,
    audit?: SettingsAuditSink,
    extras?: {
      secretStore?: import('./settings-service.types.js').SettingsSecretStore;
      auditWriter?: import('./settings-service.types.js').SettingsAuditWriter;
      cryptoProvider?: import('@objectstack/spec/contracts').ICryptoProvider;
    },
  ): void {
    this.engine = engine;
    if (audit) this.audit = audit;
    if (extras?.secretStore) this.secretStore = extras.secretStore;
    if (extras?.auditWriter) this.auditWriter = extras.auditWriter;
    if (extras?.cryptoProvider) this.cryptoProvider = extras.cryptoProvider;

    // Notify subscribers that the persistent store is now available so
    // late-binders (e.g. AIServicePlugin's adapter rebuild on saved
    // provider settings) can re-fetch with real DB-backed values rather
    // than only the in-memory defaults that were visible at
    // `kernel:ready` ordering before the engine was wired.
    for (const ns of this.registry.keys()) {
      this.emitChange({
        namespace: ns,
        key: '*',
        scope: 'global',
        action: 'set',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * Cascade priority ranks for lock comparisons (lower = higher
   * precedence). env<global<tenant<user<default. A locked row at a
   * lower rank blocks writes at all higher ranks.
   */
  private scopeRank(scope: SpecifierScope | 'env' | 'default'): number {
    switch (scope) {
      case 'global':  return 1;
      case 'tenant':  return 2;
      case 'user':    return 3;
      default:        return 99;
    }
  }

  // ---------------------------------------------------------------------
  // Change events (Phase 1)
  // ---------------------------------------------------------------------

  /**
   * Subscribe to `settings:changed` events. When `namespace` is set the
   * handler only fires for that namespace, otherwise it fires for every
   * mutation across the service.
   *
   * Returns an idempotent unsubscribe handle — call it from the
   * consumer's shutdown hook to avoid leaks.
   */
  subscribe(
    namespace: string | undefined,
    handler: SettingsChangeHandler,
  ): SettingsUnsubscribe {
    const entry = { ns: namespace, handler };
    this.subscribers.add(entry);
    return () => {
      this.subscribers.delete(entry);
    };
  }

  /**
   * Dispatch a change event to all matching subscribers. Errors thrown
   * by a handler are swallowed to keep the bus crash-safe — handlers
   * are expected to enqueue async work themselves.
   */
  private emitChange(event: SettingsChangeEvent): void {
    if (this.subscribers.size === 0) return;
    for (const sub of this.subscribers) {
      if (sub.ns && sub.ns !== event.namespace) continue;
      try {
        sub.handler(event);
      } catch {
        // Swallow — never break the writer because a listener misbehaves.
      }
    }
  }

  // ---------------------------------------------------------------------
  // Manifest registry
  // ---------------------------------------------------------------------

  /** Register (or replace) a manifest. Idempotent. */
  registerManifest(manifest: SettingsManifest): void {
    const scopes = new Map<string, SpecifierScope>();
    const encryptedKeys = new Set<string>();
    const defaults = new Map<string, unknown>();
    const defaultScope = manifest.scope ?? 'tenant';
    for (const spec of manifest.specifiers) {
      if (!spec.key || LAYOUT_ONLY_TYPES.has(spec.type)) continue;
      scopes.set(spec.key, spec.scope ?? defaultScope);
      if (spec.encrypted || spec.type === 'password') encryptedKeys.add(spec.key);
      if (typeof spec.default !== 'undefined') defaults.set(spec.key, spec.default);
    }
    const prev = this.registry.get(manifest.namespace);
    const actions = prev?.actions ?? new Map<string, SettingsActionHandler>();
    this.registry.set(manifest.namespace, { manifest, scopes, encryptedKeys, defaults, actions });
  }

  /** Look up a manifest, or throw `UnknownNamespaceError`. */
  getManifest(namespace: string): SettingsManifest {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    return reg.manifest;
  }

  /** List all registered manifests, optionally filtered by permission. */
  listManifests(ctx: SettingsContext = {}): SettingsManifest[] {
    const perms = new Set(ctx.permissions ?? []);
    const all = Array.from(this.registry.values()).map((r) => r.manifest);
    // Empty permissions ⇒ pass-through (server-side trust, e.g. boot tests).
    if (perms.size === 0) return all;
    return all.filter((m) => perms.has(m.readPermission ?? 'setup.access'));
  }

  /** Register a handler for an `action_button` declared in a manifest. */
  registerAction(namespace: string, actionId: string, handler: SettingsActionHandler): void {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    reg.actions.set(actionId, handler);
  }

  // ---------------------------------------------------------------------
  // Resolver
  // ---------------------------------------------------------------------

  /** Resolve a single key. */
  async get<T = unknown>(
    namespace: string,
    key: string,
    ctx: SettingsContext = {},
  ): Promise<ResolvedSettingValue<T>> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    if (!reg.scopes.has(key)) throw new UnknownKeyError(namespace, key);

    // 1. OS_* env
    const envName = envKeyOf(namespace, key);
    const envRaw = this.env[envName];
    if (typeof envRaw === 'string') {
      const def = reg.defaults.get(key);
      const value = coerceEnvValue(envRaw, def);
      return {
        value: value as T,
        source: 'env',
        locked: true,
        lockedReason: `Set via env: ${envName}`,
        cascadeChain: [
          { scope: 'env', value, locked: true, lockedReason: `Set via env: ${envName}`, effective: true },
        ],
      };
    }

    const scope = reg.scopes.get(key)!;
    // For 'user' scope we pre-filter by user_id; for 'tenant' and 'global'
    // we load everything for the namespace and pick the right row below.
    const rows = await this.loadRows(namespace, scope === 'user' ? ctx.userId ?? null : null);

    // 2. cascade walk — OS_* env (handled above) > global > tenant > user > default
    //
    // Build the full chain in declared order so the UI can render
    // "Inherited from Global / Locked by Global / Overrides tenant"
    // badges. The first non-null entry wins as `source`.
    const chain: NonNullable<ResolvedSettingValue['cascadeChain']> = [];

    const globalRow = rows.find((r) => r.key === key && r.scope === 'global');
    if (globalRow) {
      const value = await this.materialiseRow(globalRow);
      chain.push({
        scope: 'global',
        value,
        locked: !!globalRow.locked,
        lockedReason: globalRow.locked_reason ?? undefined,
      });
    }

    if (scope === 'tenant' || scope === 'user') {
      const tenantRow = rows.find((r) => r.key === key && r.scope === 'tenant');
      if (tenantRow) {
        chain.push({
          scope: 'tenant',
          value: await this.materialiseRow(tenantRow),
          locked: !!tenantRow.locked,
          lockedReason: tenantRow.locked_reason ?? undefined,
        });
      }
    }

    if (scope === 'user') {
      const userRow = rows.find((r) => r.key === key && r.scope === 'user');
      if (userRow) {
        chain.push({
          scope: 'user',
          value: await this.materialiseRow(userRow),
        });
      }
    }

    const def = reg.defaults.get(key);
    chain.push({ scope: 'default', value: def ?? null });

    // Effective row: highest priority entry. Lock anywhere up the chain
    // locks the effective value (lower scopes can't shadow it).
    const lockedEntry = chain.find((e) => e.locked === true);
    const effective = chain.find((e) => e.value !== null && e.value !== undefined) ?? chain[chain.length - 1];
    effective.effective = true;

    return {
      value: effective.value as T,
      source: effective.scope as ResolvedSettingValue['source'],
      locked: !!lockedEntry,
      lockedReason: lockedEntry?.lockedReason,
      cascadeChain: chain,
    };
  }

  /** Resolve every value in a namespace + return the manifest. */
  async getNamespace(
    namespace: string,
    ctx: SettingsContext = {},
  ): Promise<SettingsNamespacePayload> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);

    const values: Record<string, ResolvedSettingValue> = {};
    for (const [key] of reg.scopes) {
      values[key] = await this.get(namespace, key, ctx);
    }
    return { manifest: reg.manifest, values };
  }

  // ---------------------------------------------------------------------
  // Reactive client (Phase 1)
  // ---------------------------------------------------------------------

  /**
   * Build a reactive `ISettingsClient` for a namespace.
   *
   * The client maintains an internal snapshot of the resolved values,
   * refreshing on every `settings:changed` event for the namespace.
   * Consumers call `current` / `get(key)` for synchronous reads and
   * register handlers via `onChange()`.
   *
   * `schema` is optional. When supplied, the snapshot is parsed (and
   * defaulted) through the Zod schema on each refresh — this gives
   * plugins strong types and runtime validation in one call. When
   * absent, raw resolved values flow through unchanged (used by the
   * dynamic console UI which validates per-field).
   */
  async createClient<T extends Record<string, unknown> = Record<string, unknown>>(
    namespace: string,
    opts: {
      ctx?: SettingsContext;
      parse?: (raw: Record<string, unknown>) => T;
    } = {},
  ): Promise<{
    readonly namespace: string;
    readonly current: T;
    get<K extends keyof T>(key: K): T[K];
    onChange(handler: SettingsChangeHandler): SettingsUnsubscribe;
    refresh(): Promise<void>;
    dispose(): void;
  }> {
    const ctx = opts.ctx ?? {};
    let snapshot: T = await this.snapshotOf<T>(namespace, ctx, opts.parse);

    const off = this.subscribe(namespace, () => {
      // Fire-and-forget refresh; new readers see the latest snapshot.
      void this.snapshotOf<T>(namespace, ctx, opts.parse).then((next) => {
        snapshot = next;
      });
    });

    return {
      namespace,
      get current() {
        return snapshot;
      },
      get<K extends keyof T>(key: K): T[K] {
        return snapshot[key];
      },
      onChange: (handler) => this.subscribe(namespace, handler),
      refresh: async () => {
        snapshot = await this.snapshotOf<T>(namespace, ctx, opts.parse);
      },
      dispose: off,
    };
  }

  private async snapshotOf<T>(
    namespace: string,
    ctx: SettingsContext,
    parse?: (raw: Record<string, unknown>) => T,
  ): Promise<T> {
    const payload = await this.getNamespace(namespace, ctx);
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload.values)) raw[k] = v.value;
    return parse ? parse(raw) : (raw as T);
  }

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  /** Persist a single key. Throws SettingsLockedError when env-locked. */
  async set(
    namespace: string,
    key: string,
    value: unknown,
    ctx: SettingsContext = {},
  ): Promise<ResolvedSettingValue> {
    return (await this.setMany(namespace, { [key]: value }, ctx))[key];
  }

  /** Persist multiple keys atomically (best-effort). */
  async setMany(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: SettingsContext = {},
  ): Promise<Record<string, ResolvedSettingValue>> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);

    // Pre-flight: reject the whole batch if any key is locked or unknown.
    for (const key of Object.keys(patch)) {
      if (!reg.scopes.has(key)) throw new UnknownKeyError(namespace, key);
      const envRaw = this.env[envKeyOf(namespace, key)];
      if (typeof envRaw === 'string') throw new SettingsLockedError(namespace, key);

      // Phase 2 lock: a row at an upper scope marked locked=true
      // refuses writes at this (lower) scope. Writing AT the same
      // scope as the lock is still permitted (i.e. a platform admin
      // can edit a globally-locked value; a tenant admin cannot).
      const scope = reg.scopes.get(key)!;
      const rows = await this.loadRows(namespace, scope === 'user' ? ctx.userId ?? null : null);
      const upper = rows.find(
        (r) =>
          r.key === key &&
          r.locked === true &&
          this.scopeRank(r.scope) < this.scopeRank(scope),
      );
      if (upper) {
        throw new SettingsLockedError(namespace, key, `locked-by-${upper.scope}`);
      }
    }

    for (const [key, rawValue] of Object.entries(patch)) {
      const scope = reg.scopes.get(key)!;
      // global rows are platform-wide (tenant_id=null, user_id=null);
      // user rows pin to ctx.userId; tenant rows leave user_id null and
      // let the engine's tenant scoping fill in tenant_id from ctx.
      const userId = scope === 'user' ? ctx.userId ?? null : null;
      const isEncrypted = reg.encryptedKeys.has(key);
      const isNull = rawValue === null || typeof rawValue === 'undefined';

      let storedValue: unknown | null = null;
      let storedEnc: string | null = null;
      let digest = '';

      if (!isNull) {
        if (isEncrypted) {
          const plain = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
          // Phase 3 split: when a sys_secret store + ICryptoProvider are
          // wired, persist the ciphertext in sys_secret and keep the
          // handle id in sys_setting.value_enc. Otherwise fall back to
          // the legacy inline crypto adapter path for back-compat.
          if (this.cryptoProvider && this.secretStore) {
            const handle = await this.cryptoProvider.encrypt(plain, {
              namespace,
              key,
              tenantId: ctx.tenantId,
            });
            await this.secretStore.insert({
              id: handle.id,
              namespace,
              key,
              kms_key_id: handle.kmsKeyId,
              alg: handle.alg,
              version: handle.version,
              ciphertext: handle.ciphertext,
            });
            storedEnc = handle.id;
            digest = this.cryptoProvider.digest(plain);
          } else {
            storedEnc = await this.crypto.encrypt(plain, { namespace, key });
            digest = this.crypto.digest(plain);
          }
        } else {
          storedValue = rawValue;
          digest = this.crypto.digest(stableStringify(rawValue));
        }
      }

      await this.upsertRow({
        namespace,
        key,
        scope,
        user_id: userId,
        value: storedValue,
        value_enc: storedEnc,
        encrypted: isEncrypted,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId ?? null,
      });

      if (this.audit) {
        await this.audit.record({
          namespace,
          key,
          scope,
          userId: ctx.userId,
          action: isNull ? 'reset' : 'set',
          valueDigest: isEncrypted ? '<encrypted:' + digest + '>' : digest,
          encrypted: isEncrypted,
          requestId: ctx.requestId,
        });
      }

      if (this.auditWriter) {
        try {
          await this.auditWriter.write({
            namespace,
            key,
            scope,
            action: isNull ? 'reset' : 'set',
            source: 'api',
            actorId: ctx.userId,
            oldHash: null,
            newHash: isNull ? null : digest,
            encrypted: isEncrypted,
            requestId: ctx.requestId,
          });
        } catch {
          // never fail a write because the audit table is unhappy.
        }
      }

      this.emitChange({
        namespace,
        key,
        scope,
        action: isNull ? 'reset' : 'set',
        at: new Date().toISOString(),
      });
    }

    // Re-resolve so callers see the post-write effective values.
    const out: Record<string, ResolvedSettingValue> = {};
    for (const key of Object.keys(patch)) {
      out[key] = await this.get(namespace, key, ctx);
    }
    return out;
  }

  /** Invoke a declared action (test connection, rotate, …). */
  async runAction(
    namespace: string,
    actionId: string,
    payload: unknown,
    ctx: SettingsContext = {},
  ): Promise<SettingsActionResult> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    const handler = reg.actions.get(actionId);
    if (!handler) {
      return {
        ok: false,
        severity: 'error',
        message: `No handler registered for action '${actionId}' in '${namespace}'.`,
      };
    }
    const values: Record<string, unknown> = {};
    for (const [key] of reg.scopes) {
      values[key] = (await this.get(namespace, key, ctx)).value;
    }
    try {
      return await handler({ namespace, actionId, values, payload, ctx });
    } catch (err: any) {
      return {
        ok: false,
        severity: 'error',
        message: err?.message ?? 'Action handler threw.',
      };
    }
  }

  // ---------------------------------------------------------------------
  // Persistence helpers (engine or in-memory)
  // ---------------------------------------------------------------------

  private async loadRows(namespace: string, userId: string | null): Promise<SettingsRow[]> {
    if (this.engine) {
      const where: Record<string, unknown> = { namespace };
      if (userId !== null) where.user_id = userId;
      // Settings rows include platform-wide (`global` scope, tenant_id=null)
      // entries; bypass the tenant-scoping audit warning so loads work
      // uniformly across global/tenant/user without log noise. Per-tenant
      // isolation for `tenant`-scope rows is still enforced by the engine
      // once an ExecutionContext.tenantId is plumbed through (Phase 2+).
      const rows = await this.engine.find(this.objectName, {
        where,
        bypassTenantAudit: true,
      } as any);
      return rows.map((r) => ({
        namespace: r.namespace,
        key: r.key,
        scope: r.scope as SpecifierScope,
        user_id: r.user_id ?? null,
        value: r.value ?? null,
        value_enc: r.value_enc ?? null,
        encrypted: Boolean(r.encrypted),
        locked: Boolean(r.locked),
        locked_reason: r.locked_reason ?? null,
        updated_at: r.updated_at,
        updated_by: r.updated_by ?? null,
      }));
    }
    return this.memory.filter(
      (r) =>
        r.namespace === namespace &&
        (userId === null || r.user_id === userId || r.scope === 'tenant' || r.scope === 'global'),
    );
  }

  private async upsertRow(row: SettingsRow): Promise<void> {
    if (this.engine) {
      const where: Record<string, unknown> = {
        namespace: row.namespace,
        key: row.key,
        scope: row.scope,
        user_id: row.user_id ?? null,
      };
      // global rows are platform-wide — bypass the tenant audit warning
      // (we intentionally write tenant_id=null). tenant/user rows still
      // benefit from the warning when ctx.tenantId is missing.
      const bypass = row.scope === 'global' ? { bypassTenantAudit: true } : {};
      const existing = await this.engine.find(this.objectName, {
        where,
        limit: 1,
        ...bypass,
      } as any);
      if (existing[0]) {
        await this.engine.update(this.objectName, {
          where,
          data: { ...row },
          ...bypass,
        } as any);
      } else {
        await this.engine.insert(this.objectName, { ...row }, bypass as any);
      }
      return;
    }
    const idx = this.memory.findIndex(
      (r) =>
        r.namespace === row.namespace &&
        r.key === row.key &&
        r.scope === row.scope &&
        (r.user_id ?? null) === (row.user_id ?? null),
    );
    if (idx >= 0) this.memory[idx] = row;
    else this.memory.push(row);
  }

  private async materialiseRow(row: SettingsRow): Promise<unknown> {
    if (row.encrypted) {
      if (!row.value_enc) return null;
      let plain: string;
      try {
        // Phase 3: when the value_enc looks like a sys_secret handle and
        // both the secretStore + cryptoProvider are wired, dereference
        // through sys_secret. Otherwise (legacy rows or in-memory tests)
        // fall back to inline crypto-adapter decryption.
        if (
          this.cryptoProvider &&
          this.secretStore &&
          typeof row.value_enc === 'string' &&
          row.value_enc.startsWith('sec_')
        ) {
          const secret = await this.secretStore.get(row.value_enc);
          if (!secret) return null;
          plain = await this.cryptoProvider.decrypt(
            {
              id: secret.id,
              kmsKeyId: secret.kms_key_id,
              alg: secret.alg,
              version: secret.version,
              ciphertext: secret.ciphertext,
            },
            { namespace: row.namespace, key: row.key },
          );
        } else {
          plain = await this.crypto.decrypt(row.value_enc, {
            namespace: row.namespace,
            key: row.key,
          });
        }
      } catch (err) {
        // Decrypt failures are almost always operational: the crypto
        // provider's data key changed (e.g. InMemoryCryptoProvider
        // generated a fresh ephemeral key after a restart) and the
        // stored AES-GCM auth tag no longer verifies. Bubbling the
        // raw Node error would 500 the entire `getNamespace` request
        // and lock the operator out of the settings UI — including
        // the very inputs they'd use to re-enter the secret. Instead,
        // log once and surface `null` so the field renders as empty
        // and remains editable.
        console.warn(
          `[SettingsService] failed to decrypt ${row.namespace}.${row.key}: ${(err as Error)?.message ?? err}. ` +
            `Returning null so the namespace remains readable; re-save the field to repair.`,
        );
        return null;
      }
      // Try JSON parse so non-string secrets round-trip.
      try {
        return JSON.parse(plain);
      } catch {
        return plain;
      }
    }
    return row.value ?? null;
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Stable stringify so the audit digest is order-independent. */
function stableStringify(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return '[' + input.map(stableStringify).join(',') + ']';
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** Re-typed env coercer (the canonical one lives in settings-service.types). */
function coerceEnvValue(raw: string, hint: unknown): unknown {
  if (typeof hint === 'boolean') return raw === 'true' || raw === '1' || raw === 'yes';
  if (typeof hint === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (Array.isArray(hint) || (hint && typeof hint === 'object')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
