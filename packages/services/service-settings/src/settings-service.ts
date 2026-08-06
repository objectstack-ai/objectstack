// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FieldError } from '@objectstack/spec/api';
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
  SettingsForbiddenError,
  SettingsLockedError,
  SettingsValidationError,
  UnknownKeyError,
  UnknownNamespaceError,
} from './settings-service.types.js';
import { evaluateVisibility, referencedKeys } from './visibility-eval.js';

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

/**
 * Specifier types whose stored value must be a member of the declared
 * `options` table.
 *
 * THE list is the spec's, not a judgement call made here: `SpecifierSchema`'s
 * superRefine (`settings-manifest.zod.ts`) rejects a manifest that authors one
 * of exactly these three types without a non-empty `options`. So "the types
 * that must declare an option table" and "the types whose value is checked
 * against it" name the same set — declared IS enforced, with no third list to
 * drift. `radio` and `multiselect` have no producer manifest today; they are
 * covered anyway because the alternative is that the first manifest to author
 * one silently re-opens this exact hole.
 */
const OPTION_BEARING_TYPES = new Set(['select', 'radio', 'multiselect']);

/**
 * The declared option values, in string form.
 *
 * String form because a stored value has been through JSON (and, over the REST
 * boundary, a form post): an option declared `value: 30` is legitimately read
 * back as `'30'`, and rejecting that would be enforcing the transport rather
 * than the enumeration. Same rule the record validator applies to
 * `select`/`multiselect` field options (objectui#2729).
 */
function declaredOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const out: string[] = [];
  for (const opt of options) {
    if (!opt || typeof opt !== 'object') continue;
    const v = (opt as Record<string, unknown>).value;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push(String(v));
    }
  }
  return out;
}

/**
 * The first member of `value` that the declared table does not admit, or
 * `null` when every member is admissible.
 *
 * ONE comparison, shared by both paths that produce an effective value — the
 * save path ({@link SettingsService.validatePatch}) and the env path
 * ({@link SettingsService.get} / `reportRejectedEnvOverride`). #5204 exists
 * precisely because one of those two checked the option table and the other
 * did not; two open-coded copies of this comparison would be the same defect
 * deferred rather than fixed.
 *
 * `multiselect` stores an array, `select`/`radio` a scalar; both are checked
 * element-wise against the one table. A scalar arriving at a multiselect is
 * wrapped rather than rejected — policing the value's SHAPE is a different
 * constraint (`invalid_type`) with a different owner, and inventing it here
 * would reject writes this check was never asked to touch.
 *
 * Returns a WRAPPER, not the offending value itself: a bare return cannot
 * distinguish "nothing was rejected" from "the rejected member WAS
 * `undefined`", and the latter would slip through the check. Same reason the
 * implementation uses `findIndex` rather than `find`.
 */
function firstRejectedOption(allowed: string[], value: unknown): { value: unknown } | null {
  const picked = Array.isArray(value) ? value : [value];
  const at = picked.findIndex((v) => !allowed.includes(String(v)));
  return at === -1 ? null : { value: picked[at] };
}

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
  /**
   * Declared option values (string form) for every option-bearing specifier
   * that actually declares a non-empty table, keyed by specifier key.
   *
   * Precomputed at registration because `get()` is the service's hottest path
   * — `getNamespace` calls it once per specifier on every settings page load —
   * and the alternative is re-scanning `manifest.specifiers` per read. A key
   * ABSENT from this map is a key with nothing to enforce (not option-bearing,
   * or an option-bearing type whose manifest declares no usable table), so
   * absence means "unchanged behaviour" at both call sites rather than
   * "check against an empty set", which would reject everything.
   */
  optionTables: Map<string, string[]>;
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
  private readonly logger?: import('./settings-service.types.js').SettingsDiagnosticsLogger;
  private readonly registry = new Map<string, RegisteredManifest>();
  /**
   * `OS_*` overrides already reported as rejected (#5204), keyed
   * `<envVar>=<offending value>`. See {@link reportRejectedEnvOverride} for why
   * the value is part of the key and not just the var name.
   */
  private readonly reportedEnvOverrides = new Set<string>();
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
    this.logger = opts.logger;
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

  /**
   * Register (or replace) a manifest. Idempotent.
   *
   * Registration is also where the deployment's `OS_*` overrides for this
   * namespace are audited against the manifest's option tables (#5204) — see
   * {@link auditEnvOverrides}. Registration REPORTS, it never rejects: a value
   * that was legal yesterday and left the table today must not keep an
   * existing deployment from booting.
   */
  registerManifest(manifest: SettingsManifest): void {
    const scopes = new Map<string, SpecifierScope>();
    const encryptedKeys = new Set<string>();
    const defaults = new Map<string, unknown>();
    const optionTables = new Map<string, string[]>();
    const defaultScope = manifest.scope ?? 'tenant';
    for (const spec of manifest.specifiers) {
      if (!spec.key || LAYOUT_ONLY_TYPES.has(spec.type)) continue;
      scopes.set(spec.key, spec.scope ?? defaultScope);
      if (spec.encrypted || spec.type === 'password') encryptedKeys.add(spec.key);
      if (typeof spec.default !== 'undefined') defaults.set(spec.key, spec.default);
      if (OPTION_BEARING_TYPES.has(spec.type)) {
        // A manifest with no option table cannot say what is legal. The spec
        // refuses that shape at parse time, but `registerManifest` takes
        // manifests as given (no Zod pass), so record nothing rather than
        // record an empty table — same leniency the save path takes, and the
        // reason the map's ABSENT key means "nothing to enforce".
        const allowed = declaredOptionValues((spec as { options?: unknown }).options);
        if (allowed.length > 0) optionTables.set(spec.key, allowed);
      }
    }
    const prev = this.registry.get(manifest.namespace);
    const actions = prev?.actions ?? new Map<string, SettingsActionHandler>();
    this.registry.set(manifest.namespace, {
      manifest,
      scopes,
      encryptedKeys,
      defaults,
      actions,
      optionTables,
    });
    this.auditEnvOverrides(manifest.namespace);
  }

  /**
   * #5204 — report every `OS_*` override in this namespace whose value the
   * specifier's declared `options` table does not admit.
   *
   * Why at registration and not only on read: an override that will never take
   * effect is a **misconfigured deployment**, and the operator should learn
   * that at boot, next to the rest of the startup output — not the first time
   * somebody happens to open the settings page, and not never (a key nobody
   * reads during the process's life would otherwise stay silent forever).
   *
   * Why it does NOT refuse to boot: the option tables move. #5094 retired
   * `sendgrid` and `ses` from `mail.provider`; a deployment pinning
   * `OS_MAIL_PROVIDER=sendgrid` was correct the day it was written, and turning
   * an upgrade into a crash-on-start would punish exactly the operator this
   * message is trying to help. The value is ignored either way (see `get`); the
   * difference is whether the rest of the platform still comes up around it.
   */
  private auditEnvOverrides(namespace: string): void {
    const reg = this.registry.get(namespace);
    if (!reg || reg.optionTables.size === 0) return;
    // Only the option-bearing keys can be rejected, so only they are worth
    // walking. `effectiveEnvOverride` does the judging (and the reporting);
    // the value it returns is of no interest here.
    for (const key of reg.optionTables.keys()) {
      this.effectiveEnvOverride(reg, namespace, key);
    }
  }

  /**
   * The `OS_*` override for this key **if it is actually in force**, else null.
   *
   * THE one place that answers "does env win here?", for every site that used to
   * ask in its own way. There were three, and #5204 is what having three costs:
   * `get()` coerced the value and returned it, `setMany` locked the key on the
   * mere PRESENCE of the variable, and neither consulted the `options` table
   * that the save path had been enforcing since #5131.
   *
   * Routing all three through one judgment is what keeps `locked` coherent. A
   * rejected override is not in force, so it must not pin the key either:
   * reporting `locked: false` from `get()` while `setMany` still threw
   * `SETTINGS_LOCKED` would leave the settings UI rendering the field as
   * editable and then failing the save — and, worse, would leave that key
   * configurable by NOTHING (env value rejected, UI refused), a lockout only an
   * env edit could clear. That is strictly worse than the hole #5204 closes,
   * and it is the same reasoning `validatePatch` already applies when it
   * refuses to lock a workspace out over historical drift.
   *
   * Reporting lives here rather than at the call sites so no future fourth
   * caller can read an override without the rejection being heard.
   */
  private effectiveEnvOverride(
    reg: RegisteredManifest,
    namespace: string,
    key: string,
  ): { envName: string; value: unknown } | null {
    const envName = envKeyOf(namespace, key);
    const envRaw = this.env[envName];
    if (typeof envRaw !== 'string') return null;

    const value = coerceEnvValue(envRaw, reg.defaults.get(key));
    // A key with no declared table has nothing to enforce — unchanged behaviour.
    const allowed = reg.optionTables.get(key);
    if (!allowed) return { envName, value };

    const rejected = firstRejectedOption(allowed, value);
    if (!rejected) return { envName, value };

    this.reportRejectedEnvOverride(reg, namespace, key, envName, allowed, rejected.value);
    return null;
  }

  /**
   * Emit the one loud line a rejected `OS_*` override owes its operator, at
   * most once per (env var, value) for the life of the service.
   *
   * **Level is `error`, deliberately.** AGENTS.md → "Degradation log levels"
   * decides this by one question: afterwards, does the system still look normal
   * from the outside while something it claims to honour has not landed? Here
   * it does — the read API answers with a perfectly plausible value tagged with
   * a perfectly plausible source, and nothing anywhere looks broken, while the
   * operator's declared intent is simply not in force. #5152 reached the same
   * verdict for `auth.membership_policy` in `bindAuthSettings` for the same
   * reason, and that case shows the stakes: a typo'd `invite_only` read as
   * `auto` leaves an operator believing the wall is up while every sign-up is
   * auto-bound.
   *
   * **Once, not once per read.** Same section: "Say it once, at the first
   * degradation, not once per failed write." `getNamespace` resolves every
   * specifier in the namespace on every settings page load, so a per-read line
   * would be a firehose — and training people to skim `error` is the
   * mirror-image failure AGENTS.md names in the very next paragraph. Keying the
   * dedupe on the VALUE as well as the var means a genuinely new bad value is
   * still reported: `this.env` may be a live `process.env` reference, so an
   * override can appear or change after registration and must not inherit an
   * earlier line's silence.
   *
   * **No structured `meta`.** Everything an operator needs is in the sentence,
   * and `Logger.redactSensitive` (`packages/core/src/logger.ts`) redacts any
   * meta field whose name merely CONTAINS `key`/`token`/`secret`/`password` —
   * so the obvious `{ key }` / `{ envKey }` field would arrive as
   * `***REDACTED***` and delete the diagnostic while looking complete (#5573).
   */
  private reportRejectedEnvOverride(
    reg: RegisteredManifest,
    namespace: string,
    key: string,
    envName: string,
    allowed: string[],
    offending: unknown,
  ): void {
    const dedupeAt = `${envName}=${String(offending)}`;
    if (this.reportedEnvOverrides.has(dedupeAt)) return;
    this.reportedEnvOverrides.add(dedupeAt);

    // An option value is not a secret, but `encrypted` is authorable on ANY
    // specifier — so never echo the rejected value for a key whose contents are
    // held encrypted, in a message that lands in logs. Same rule, same reason,
    // as the save path's `invalid_option` error.
    const secret = reg.encryptedKeys.has(key);
    const rejected = secret ? '' : ` Rejected value: '${String(offending)}'.`;
    const message =
      `[SettingsService] env override ${envName} is not a declared option for ` +
      `setting '${namespace}.${key}' — IGNORED.${rejected} Allowed values: ${allowed.join(', ')}. ` +
      `Consequence: this override does NOT take effect and nothing else looks wrong — ` +
      `'${namespace}.${key}' resolves from the next layer of the cascade instead ` +
      `(a stored global/tenant/user value, else the manifest default), and reads report ` +
      `THAT layer as the source rather than 'env'. ` +
      `Fix: set ${envName} to one of the allowed values, or unset it and configure ` +
      `'${namespace}.${key}' through the settings UI.`;

    if (this.logger?.error) this.logger.error(message);
    else console.error(message);
  }

  /** Look up a manifest, or throw `UnknownNamespaceError`. */
  getManifest(namespace: string): SettingsManifest {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    return reg.manifest;
  }

  /**
   * [Finding-1] Capability a manifest demands for an operation. Reads default to
   * `setup.access`; writes default to the manifest's `writePermission`, falling
   * back to its `readPermission`, then `setup.access` — so a write ALWAYS
   * requires at least as much as a read and is never ungated.
   */
  private requiredCapability(m: SettingsManifest, op: 'read' | 'write'): string {
    return op === 'read'
      ? (m.readPermission ?? 'setup.access')
      : (m.writePermission ?? m.readPermission ?? 'setup.access');
  }

  /**
   * [Finding-1] Enforce the manifest's capability for an ENFORCED (HTTP-boundary)
   * caller. Trusted in-process callers (`enforced` unset) are never gated — the
   * seed/boot paths that call the service directly keep full access.
   */
  private assertPermitted(m: SettingsManifest, op: 'read' | 'write', ctx: SettingsContext): void {
    if (!ctx.enforced) return;
    const required = this.requiredCapability(m, op);
    const held = new Set(ctx.permissions ?? []);
    if (!held.has(required)) {
      throw new SettingsForbiddenError(m.namespace, required, op);
    }
  }

  /** List all registered manifests, optionally filtered by permission. */
  listManifests(ctx: SettingsContext = {}): SettingsManifest[] {
    const perms = new Set(ctx.permissions ?? []);
    const all = Array.from(this.registry.values()).map((r) => r.manifest);
    // Empty permissions ⇒ pass-through ONLY for a trusted (non-enforced)
    // in-process caller. An ENFORCED HTTP caller with no capabilities sees only
    // the manifests it may read — never the whole set (Finding-1: an
    // unauthenticated request previously enumerated every namespace).
    if (perms.size === 0 && !ctx.enforced) return all;
    return all.filter((m) => perms.has(this.requiredCapability(m, 'read')));
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

    // 1. OS_* env — but only when the override is actually in force.
    //
    // #5204: the `options` table is an ENFORCEMENT surface on this side too.
    // `setMany` has checked it since #5131, yet an env override reached the
    // effective value without passing through that path at all, and did so at
    // the TOP of the cascade with `locked: true` — so `OS_MAIL_PROVIDER=sendgrid`
    // handed the mail plugin the exact value #5094 had just retired, through the
    // one door nobody was watching. `coerceEnvValue` only ever reshaped the
    // string by the default's type; it never consulted the enumeration.
    //
    // A rejected value is IGNORED rather than repaired: there is no honest way to
    // guess which declared option a typo meant, and guessing is worse than not
    // applying it (#5152, on `invite_only` silently read as `auto`). Ignored
    // means the env layer contributes NOTHING here — no value and, critically,
    // no `cascadeChain` entry: an `env` entry carrying `locked: true` would be
    // picked up by the `lockedEntry` scan below and reported as locking a value
    // it is not even providing, which is the opposite of what the read API owes
    // its caller.
    const envOverride = this.effectiveEnvOverride(reg, namespace, key);
    if (envOverride) {
      const { envName, value } = envOverride;
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
    // [Finding-1] Reading a namespace's values requires the manifest's read
    // capability for an enforced (HTTP) caller.
    this.assertPermitted(reg.manifest, 'read', ctx);

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
    // [Finding-1] Writing requires the manifest's write capability for an
    // enforced (HTTP) caller. Checked BEFORE any lock/validation work so an
    // unauthorized write is rejected outright (this is the gate that was
    // missing — the write path previously trusted a spoofable header identity).
    this.assertPermitted(reg.manifest, 'write', ctx);

    // Pre-flight: reject the whole batch if any key is locked or unknown.
    for (const key of Object.keys(patch)) {
      if (!reg.scopes.has(key)) throw new UnknownKeyError(namespace, key);
      // An env override pins the key against writes — but only one that is IN
      // FORCE (#5204). This used to trigger on the mere PRESENCE of the
      // variable, which after the read-side gate would have produced a key
      // configurable by nothing at all: the env value rejected and ignored, the
      // UI refused with `SETTINGS_LOCKED`, and `get()` reporting `locked: false`
      // to a settings page that would then fail its own save. See
      // `effectiveEnvOverride`.
      if (this.effectiveEnvOverride(reg, namespace, key)) {
        throw new SettingsLockedError(namespace, key);
      }

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

    // Reject writes that would leave the namespace in a known-broken
    // state (visible required field empty / pattern mismatch). See
    // validatePatch for the exact semantics.
    await this.validatePatch(namespace, patch, ctx);

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

  /**
   * Save-time validation for `setMany`, fulfilling the spec promise that
   * `required` is enforced server-side and hidden specifiers are not
   * validated. Semantics, tuned to reject broken configs without
   * breaking unrelated single-key writes:
   *
   * - The post-write value map is computed (current values overlaid
   *   with the patch; `null` patch entries fall back to the default).
   * - A specifier is checked only when the patch TOUCHES it — its own
   *   key is in the patch, or a key its `visible` expression references
   *   is (switching provider must validate that provider's fields).
   * - `required` + visible + empty → rejected.
   * - `pattern` (text fields) + non-empty value that mismatches → rejected.
   * - `options` (`select`/`radio`/`multiselect`) + non-empty value outside
   *   the declared table → rejected (`invalid_option`).
   * - All-null patches (namespace reset) and unparseable visibility
   *   expressions skip validation rather than block the write.
   *
   * The TOUCH gate is what keeps the options check from being a regression
   * for existing workspaces: a value that pre-dates a manifest's current
   * option table (a `mail.provider` of `sendgrid`, retired in #5094) only
   * fails the patch that writes that key. A patch changing `from_name`
   * alone is not rejected because a stale `provider` sits in the store —
   * otherwise every workspace carrying historical drift would be locked out
   * of its own settings page, unable to edit anything, which is worse than
   * the gap this closes.
   */
  private async validatePatch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: SettingsContext,
  ): Promise<void> {
    const reg = this.registry.get(namespace);
    if (!reg) return;
    const entries = Object.entries(patch);
    if (entries.length === 0) return;
    // An all-null patch is a reset — clearing values is never blocked.
    if (entries.every(([, v]) => v === null || typeof v === 'undefined')) return;

    // Post-write value map: resolved values overlaid with the patch.
    const data: Record<string, unknown> = {};
    for (const [key] of reg.scopes) {
      data[key] = (await this.get(namespace, key, ctx)).value;
    }
    for (const [key, value] of entries) {
      data[key] = value === null || typeof value === 'undefined'
        ? reg.defaults.get(key) ?? null
        : value;
    }

    const patchKeys = new Set(Object.keys(patch));
    // One `FieldError` per offending key (ADR-0114). The constraint kind is
    // known HERE and nowhere later — the route that serves this used to receive
    // a `key → message` map and could only re-emit the prose — so the code is
    // stamped at the point the check fails rather than inferred from the text.
    const errors: FieldError[] = [];

    for (const spec of (reg.manifest.specifiers ?? []) as Array<Record<string, unknown>>) {
      const key = spec.key as string | undefined;
      const type = String(spec.type ?? '');
      if (!key || LAYOUT_ONLY_TYPES.has(type)) continue;

      let visible = true;
      let deps: string[] = [];
      if (typeof spec.visible !== 'undefined') {
        try {
          visible = evaluateVisibility(spec.visible, data);
          deps = referencedKeys(spec.visible);
        } catch {
          continue; // can't determine visibility — stay lenient
        }
      }
      if (!visible) continue;
      if (!patchKeys.has(key) && !deps.some((d) => patchKeys.has(d))) continue;

      const value = data[key];
      const label = typeof spec.label === 'string' ? spec.label : key;
      const empty =
        value === null || typeof value === 'undefined' ||
        (typeof value === 'string' && value.trim() === '');

      if (spec.required === true && empty) {
        errors.push({
          field: key,
          code: 'required',
          message: `${label} is required for this configuration.`,
          label,
        });
        continue;
      }

      // A `select`/`radio`/`multiselect` value must be a member of the option
      // table the manifest declares. Until this check existed the `options`
      // list was a front-end convention only — the console dropdown emitted
      // legal values, but `PUT /api/settings/:ns` accepted any string at all,
      // so a script, a migration or AI-authored bootstrap code could write
      // `provider: 'sendgrid'` into a namespace that has no such provider and
      // the write would succeed silently, leaving each consumer to improvise.
      if (!empty && OPTION_BEARING_TYPES.has(type)) {
        const allowed = declaredOptionValues(spec.options);
        // A manifest with no option table cannot say what is legal. The spec
        // refuses that shape at parse time, but `registerManifest` takes
        // manifests as given (no Zod pass), so skip rather than reject every
        // write to a hand-built manifest — same leniency the unparseable
        // `visible` and invalid `pattern` branches already take.
        if (allowed.length > 0) {
          // Shared with the env path (#5204) — see `firstRejectedOption` for the
          // array/scalar handling and why the result is wrapped.
          const rejected = firstRejectedOption(allowed, value);
          if (rejected) {
            const offending = rejected.value;
            // An option value is not a secret, but `encrypted` is authorable on
            // any specifier — so never echo the rejected value for a key whose
            // contents are held encrypted, in a message that lands in logs.
            const secret = reg.encryptedKeys.has(key);
            const got = secret ? '' : ` Received '${String(offending)}'.`;
            errors.push({
              field: key,
              code: 'invalid_option',
              message: `${label} must be one of: ${allowed.join(', ')}.${got}`,
              label,
              // The allowed set as a discrete constraint, so a client composes
              // its own sentence instead of parsing ours (`FieldError.
              // constraint`, ADR-0114). Key and comma-joined form are the ones
              // the spec's own `{ allowed: 'draft, sent' }` example documents
              // and the record validator already emits for this same code.
              constraint: { allowed: allowed.join(', ') },
              ...(secret ? {} : { value: String(offending) }),
            });
            continue;
          }
        }
      }

      if (!empty && typeof spec.pattern === 'string' && typeof value === 'string') {
        let re: RegExp | undefined;
        try {
          re = new RegExp(spec.pattern);
        } catch {
          re = undefined; // invalid manifest pattern — don't block writes
        }
        if (re && !re.test(value)) {
          const hint = typeof spec.description === 'string' ? ` ${spec.description}` : '';
          errors.push({
            field: key,
            code: 'invalid_format',
            message: `${label} does not match the expected format.${hint}`,
            label,
            // The declared pattern, so a client can format its own message
            // rather than parsing ours (`FieldError.constraint`, ADR-0114).
            constraint: { pattern: spec.pattern },
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new SettingsValidationError(namespace, errors);
    }
  }

  /**
   * Clear every persisted row in a namespace so values fall back to
   * env/defaults. Env-locked keys are untouched (env wins over rows
   * anyway and refuses writes). Persisted rows are nulled rather than
   * deleted so the audit trail records the reset per key.
   *
   * Returns the number of cleared keys.
   */
  async resetNamespace(namespace: string, ctx: SettingsContext = {}): Promise<number> {
    const payload = await this.getNamespace(namespace, ctx);
    const patch: Record<string, null> = {};
    for (const [key, v] of Object.entries(payload.values)) {
      if (v.source === 'global' || v.source === 'tenant' || v.source === 'user') {
        patch[key] = null;
      }
    }
    const keys = Object.keys(patch);
    if (keys.length > 0) await this.setMany(namespace, patch, ctx);
    return keys.length;
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
    // [Finding-1] Settings actions (test-connection, rotate, reset, …) are
    // mutating/side-effecting operations — gate them like a write for an
    // enforced (HTTP) caller.
    this.assertPermitted(reg.manifest, 'write', ctx);
    const handler = reg.actions.get(actionId);
    if (!handler) {
      // Built-in fallback: every namespace gets a `reset` action that
      // clears persisted rows (back to env/defaults). Plugins may
      // override it via registerAction for richer behaviour (e.g. the
      // AI plugin re-runs env adapter detection after the clear).
      if (actionId === 'reset') {
        const cleared = await this.resetNamespace(namespace, ctx);
        return {
          ok: true,
          severity: 'info',
          message: cleared > 0
            ? `Cleared ${cleared} saved value(s); environment/default configuration is back in effect.`
            : 'No saved values to clear — already using environment/default configuration.',
        };
      }
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
