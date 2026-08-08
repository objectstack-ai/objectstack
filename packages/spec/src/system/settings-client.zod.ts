/**
 * SettingsClient — reactive consumer contract for runtime settings.
 *
 * Background. Phase 0 introduced the cascade scope (`env > global >
 * tenant > user > default`) and made `SettingsService.get()` resolve
 * across the chain. Consumers (e.g. EmailServicePlugin, BrandingPlugin)
 * still pull values once at boot, which means saved changes never take
 * effect without a process restart.
 *
 * This module defines the contract that fixes that:
 *
 *   const mail = ctx.settings.bind('mail', MailSettingsSchema);
 *   mail.current.smtp_host;                 // current effective value
 *   const off = mail.onChange(() => rebuild());
 *
 *   service.set('mail', 'smtp_host', '…')   //  ↳ fires settings:changed
 *                                            //    → handler runs → transport rebuilt
 *
 * Design rules:
 *
 *  1. **Spec-only.** This package emits types and Zod shapes. No runtime
 *     wiring (event bus, in-memory cache) lives here — that is
 *     `@objectstack/service-settings`'s job. Keeping the contract pure
 *     lets non-Node consumers (RN, edge workers) re-implement it.
 *
 *  2. **Snapshot semantics.** `current` is an immutable snapshot of the
 *     namespace at the moment of the last refresh. After a change event
 *     fires, the next read of `current` returns the new snapshot — old
 *     references stay stable (good for React useSyncExternalStore).
 *
 *  3. **No fetching here.** A `SettingsClient` does not know how to fetch
 *     itself; it is constructed by an authority (the service) that owns
 *     the persistence layer. That keeps cycles out of the dependency
 *     graph and lets us mock the client trivially in tests.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { SpecifierScopeSchema } from './settings-manifest.zod';

// ---------------------------------------------------------------------------
// Change event
// ---------------------------------------------------------------------------

/**
 * Emitted on the `settings:changed` channel each time `SettingsService.set`
 * mutates a row. The event is the minimum payload a consumer needs to
 * decide whether to refresh — full resolved values are obtained by
 * re-reading `client.current`.
 *
 * `source` mirrors `ResolvedSettingValue.source` and tells the consumer
 * which scope row was actually mutated; this allows finer-grained reaction
 * (a user-scope change shouldn't rebuild a global transport, etc.).
 */
export const SettingsChangeEventSchema = lazySchema(() => z.object({
  /** Namespace whose value changed (matches `SettingsManifest.namespace`). */
  namespace: z.string().min(1).describe('Settings namespace, e.g. "mail"'),

  /** Specifier key that changed (matches `Specifier.key`). */
  key: z.string().min(1).describe('Specifier key, e.g. "smtp_host"'),

  /** Scope of the row that was written (where the mutation happened). */
  scope: SpecifierScopeSchema.describe('Scope of the mutated row'),

  /**
   * `'set'` when a value was written or replaced; `'reset'` when the row
   * was cleared (the cascade chain now resolves to the next layer down).
   */
  action: z.enum(['set', 'reset']).describe('Mutation kind'),

  /** Wall-clock timestamp (ISO 8601) when the mutation completed. */
  at: z.string().describe('ISO 8601 mutation timestamp'),
}));
export type SettingsChangeEvent = z.input<typeof SettingsChangeEventSchema>;

/**
 * Bus identifier on which `SettingsChangeEvent`s are published.
 * Exported as a constant so consumers and the service agree on the channel.
 */
export const SETTINGS_CHANGE_EVENT = 'settings:changed' as const;
export type SettingsChangeEventName = typeof SETTINGS_CHANGE_EVENT;

/** Unsubscribe handle returned by `onChange`. Idempotent. */
export type SettingsUnsubscribe = () => void;

/**
 * Handler signature for change subscribers. Sync-only by contract —
 * use the handler to enqueue async work yourself (e.g. queue a
 * `rebuildTransport()` task) so the bus stays cheap.
 */
export type SettingsChangeHandler = (event: SettingsChangeEvent) => void;

// ---------------------------------------------------------------------------
// Reactive client
// ---------------------------------------------------------------------------

/**
 * Reactive view over a single settings namespace.
 *
 * Lifecycle:
 *  - obtained via `ctx.settings.bind(ns, schema)` (Phase 1 capability)
 *  - `current` is hydrated synchronously from the service's in-memory cache
 *  - `onChange(handler)` registers for `settings:changed` events scoped to `ns`
 *  - the returned `SettingsUnsubscribe` MUST be called by the plugin's
 *    `shutdown` hook to avoid leaks
 *
 * The generic `T` is the inferred shape of the namespace's Zod schema
 * (see `bind` below). All getters return validated, defaulted values.
 */
export interface ISettingsClient<T extends Record<string, unknown>> {
  /** Namespace this client is bound to. Immutable. */
  readonly namespace: string;

  /**
   * The current effective snapshot. Reading is O(1); the underlying
   * map is replaced atomically on every change so prior references
   * stay valid (use the latest `current` to read fresh state).
   */
  readonly current: T;

  /** Resolve a single key. Equivalent to `client.current[key]`. */
  get<K extends keyof T>(key: K): T[K];

  /**
   * Subscribe to changes within this namespace. The handler fires
   * after `current` has been swapped, so reading `current` inside the
   * handler observes the new value.
   */
  onChange(handler: SettingsChangeHandler): SettingsUnsubscribe;
}

/**
 * Factory / capability shape exposed to plugins as `ctx.settings`.
 *
 * Why a factory and not just `getClient(ns)`? Binding ties a Zod schema
 * to the namespace so consumers get strong types and runtime validation
 * for free; the service can also cache the parser per namespace.
 */
export interface ISettingsCapability {
  /**
   * Bind a namespace to a Zod schema and return a typed reactive client.
   *
   * @param namespace Settings namespace (matches `SettingsManifest.namespace`)
   * @param schema    Zod schema for the namespace's full value object
   */
  bind<S extends z.ZodTypeAny>(
    namespace: string,
    schema: S,
  ): ISettingsClient<z.infer<S> & Record<string, unknown>>;
}
