// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type {
  IDataEngine,
  IEmbedder,
  IRealtimeService,
} from '@objectstack/spec/contracts';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { EMBEDDER_SERVICE, KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import {
  OPENAI_COMPATIBLE_PRESETS,
  createOpenAIEmbedder,
  documentedMaxBatchSize,
  type OpenAICompatiblePreset,
} from '@objectstack/embedder-openai';
import { aiTestEmbedderActionHandler } from '@objectstack/service-settings';
import { RECORD_RESTORED_EVENT } from '@objectstack/spec/data';
import { KnowledgeService } from './knowledge-service.js';
import type { KnowledgeLogger } from './knowledge-service.js';
import type { KnowledgeFieldSecurity } from './knowledge-source-admission.js';
import { createKnowledgeReapGuard, guardedObjectsFor } from './knowledge-reap-guard.js';
import { contributeKnowledgeSettings } from './knowledge-settings-contribution.js';

/**
 * Whether `err` is the kernel's refusal for a service NOTHING registered under
 * `name` — the one miss a caller may read as absence.
 *
 * Both in-repo kernels answer a sync `getService` miss by throwing, and
 * `ObjectKernel` keeps the two faults that share that branch apart on purpose,
 * in their messages: `[Kernel] Service 'NAME' not found…` when nothing
 * registered the name, and `Service 'NAME' is async - use await` when a
 * factory registered it and the sync accessor cannot instantiate it
 * (`LiteKernel` answers only the first). The first is absence; the second, and
 * any other throw, is a service that exists and cannot be used.
 */
export function isServiceNotRegisteredError(err: unknown, name: string): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.startsWith(`[Kernel] Service '${name}' not found`);
}

/**
 * Where an operator configures the embedder, and why a saved change waits for
 * a restart — the tail of every "no embedder" answer below.
 */
const EMBEDDER_SETTINGS_REMEDY =
  'under Settings → AI & Embedder, then restart the server: the embedder settings are read when it starts';

/** The `ai.embedder_*` keys a complete provider needs, named in the "not saved" answer. */
const EMBEDDER_REQUIRED_KEYS =
  'ai.embedder_provider, ai.embedder_api_key and ai.embedder_model (ai.embedder_base_url for a custom or Azure endpoint)';

/** One resolved setting as the settings service answers it: the value and the layer it came from. */
interface ResolvedEmbedderSetting {
  value?: unknown;
  source?: string;
}

/** The slice of `SettingsService` this plugin reads at boot. */
interface EmbedderSettingsReader {
  getNamespace(namespace: string): Promise<{ values: Record<string, ResolvedEmbedderSetting | undefined> }>;
}

/** What the `ai.embedder_*` settings resolve to at boot. */
type EmbedderFromSettings =
  | {
      kind: 'configured';
      embedder: IEmbedder;
      provider: string;
      model: string | undefined;
      /** The batch cap passed to the embedder: the saved size, held to the model's documented cap. */
      batchSize: number | undefined;
      /** The saved size, when the documented cap lowered it. */
      savedBatchSize: number | undefined;
    }
  | {
      kind: 'unconfigured';
      reason: string;
      /**
       * `true` when nothing asked for an embedder (no provider saved, or `none`
       * saved): the boot line is `info`. `false` when the operator saved
       * something that does not build one: the boot line is `warn`.
       */
      quiet: boolean;
    };

/**
 * The `IEmbedder` registered when the settings configure none. Every use of it
 * — `embed()` with any input, or reading `dimensions` to size a vector column —
 * answers the same error, which names the missing settings and the restart, so
 * an adapter that embeds refuses indexing and search with that text instead of
 * a bare "service not found". Nothing is sent anywhere.
 */
class UnconfiguredEmbedder implements IEmbedder {
  readonly id = 'unconfigured';
  constructor(private readonly reason: string) {}
  get dimensions(): number {
    throw this.refusal();
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    throw this.refusal();
  }
  private refusal(): Error {
    return new Error(`No embedder is configured, so nothing was embedded and nothing was sent: ${this.reason}.`);
  }
}

/**
 * A setting's value when the operator SAVED it (any layer but the manifest
 * default, an `OS_*` override included), else `undefined`. The `ai.embedder_*`
 * defaults — `embedder_provider: 'none'`, `embedder_batch_size: 64` — are no
 * decision anybody made, so they never count as configuration.
 */
function savedValue(values: Record<string, ResolvedEmbedderSetting | undefined>, key: string): unknown {
  const entry = values[key];
  if (!entry || (entry.source ?? 'default') === 'default') return undefined;
  const { value } = entry;
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

/**
 * Build the embedder the saved `ai.embedder_*` settings describe, or say why
 * there is none. Completeness is judged by the settings page's own
 * "Test embedder" check (`aiTestEmbedderActionHandler`), handed only the SAVED
 * values, so the boot and the button agree on what "configured" means.
 */
async function embedderFromSettings(ctx: PluginContext): Promise<EmbedderFromSettings> {
  let settings: EmbedderSettingsReader | undefined;
  try {
    settings = ctx.getService<EmbedderSettingsReader | undefined>('settings') ?? undefined;
  } catch (err) {
    if (!isServiceNotRegisteredError(err, 'settings')) throw err;
  }
  if (!settings || typeof settings.getNamespace !== 'function') {
    return {
      kind: 'unconfigured',
      quiet: true,
      reason:
        'the settings service is not mounted, so the ai.embedder_* settings cannot be read — mount it and save ' +
        `the embedder ${EMBEDDER_SETTINGS_REMEDY}, or register an IEmbedder as the '${EMBEDDER_SERVICE}' service ` +
        "from a plugin's init() or start()",
    };
  }

  let values: Record<string, ResolvedEmbedderSetting | undefined>;
  try {
    values = (await settings.getNamespace('ai')).values ?? {};
  } catch (err) {
    return {
      kind: 'unconfigured',
      quiet: false,
      reason:
        `the ai settings could not be read (${err instanceof Error ? err.message : String(err)}) — ` +
        `check them ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }
  if (!('embedder_provider' in values)) {
    return {
      kind: 'unconfigured',
      quiet: true,
      reason:
        "the 'ai' settings namespace does not declare the embedder keys (ai.embedder_*) — declare them in the " +
        `host's 'ai' manifest, or register an IEmbedder as the '${EMBEDDER_SERVICE}' service from a plugin's ` +
        'init() or start()',
    };
  }

  const provider = savedValue(values, 'embedder_provider');
  if (provider === undefined) {
    return {
      kind: 'unconfigured',
      quiet: true,
      reason: `no embedder provider is saved — save ${EMBEDDER_REQUIRED_KEYS} ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }
  if (provider === 'none') {
    return {
      kind: 'unconfigured',
      quiet: true,
      reason: `ai.embedder_provider is saved as 'none' (embeddings disabled) — pick a provider ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }

  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    const value = savedValue(values, key);
    if (value !== undefined) saved[key] = value;
  }
  const check = await aiTestEmbedderActionHandler({ namespace: 'ai', actionId: 'test_embedder', values: saved, ctx: {} });
  if (!check.ok) {
    return {
      kind: 'unconfigured',
      quiet: false,
      reason: `the saved embedder settings are incomplete (${check.message ?? 'no detail'}) — complete them ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }

  const providerId = String(provider);
  const baseUrl = typeof saved.embedder_base_url === 'string' ? saved.embedder_base_url.trim() : undefined;
  const preset = Object.prototype.hasOwnProperty.call(OPENAI_COMPATIBLE_PRESETS, providerId)
    ? (providerId as OpenAICompatiblePreset)
    : undefined;
  const model = typeof saved.embedder_model === 'string' ? saved.embedder_model.trim() : undefined;
  const dimensions = typeof saved.embedder_dimensions === 'number' ? saved.embedder_dimensions : undefined;
  // Only a SAVED batch size is a batch cap; unsaved, the embedder batches at the
  // model's own documented cap (some providers accept 10, not the default 64).
  // A saved size is held to that documented cap when the saved model has one:
  // an explicit `maxBatchSize` would otherwise override it. A model the table
  // does not know, or no saved model, keeps the saved size as saved.
  const savedBatch = typeof saved.embedder_batch_size === 'number' ? saved.embedder_batch_size : undefined;
  const documentedCap = model ? documentedMaxBatchSize(model) : undefined;
  const batchSize =
    savedBatch !== undefined && documentedCap !== undefined ? Math.min(savedBatch, documentedCap) : savedBatch;
  // Ollama ignores the key, and the embedder requires a non-empty one.
  const apiKey =
    typeof saved.embedder_api_key === 'string' && saved.embedder_api_key !== ''
      ? saved.embedder_api_key
      : providerId === 'ollama'
        ? 'ollama'
        : '';
  if (!preset && !baseUrl) {
    return {
      kind: 'unconfigured',
      quiet: false,
      reason: `ai.embedder_provider '${providerId}' names no known endpoint and no ai.embedder_base_url is saved — save one ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }
  try {
    const embedder = createOpenAIEmbedder({
      preset,
      baseUrl: baseUrl || undefined,
      apiKey,
      model,
      dimensions,
      maxBatchSize: batchSize,
      id: providerId,
    });
    return {
      kind: 'configured',
      embedder,
      provider: providerId,
      model,
      batchSize,
      savedBatchSize: batchSize !== savedBatch ? savedBatch : undefined,
    };
  } catch (err) {
    // The embedder's own refusals name the option, never the key's value.
    return {
      kind: 'unconfigured',
      quiet: false,
      reason:
        `the saved embedder settings do not build an embedder (${err instanceof Error ? err.message : String(err)}) — ` +
        `correct them ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }
}

/**
 * Configuration options for the `KnowledgeServicePlugin`.
 */
export interface KnowledgeServicePluginOptions {
  /**
   * Knowledge sources to register at boot. Sources may also be
   * registered programmatically later via `service.registerSource`.
   */
  sources?: KnowledgeSource[];
  /**
   * Subscribe to ObjectQL `data.record.created` / `data.record.updated` /
   * `data.record.restored` / `data.record.deleted` events from
   * `IRealtimeService` for `object` sources. Defaults to `true`. Set to
   * `false` to disable inline event sync (e.g. when an external indexer drives
   * upserts).
   *
   * A created, updated or restored row is re-read against each source's
   * `where` (with a data engine bound): a matching row is indexed from the
   * re-read row, and a row that does not match has its document removed —
   * see `KnowledgeService.handleRecordUpsert`.
   *
   * The aggregate `data.records.updated` / `data.records.deleted` events a
   * predicate write (`multi: true`) publishes carry a count, not records:
   * they cannot be synced and only log a warning that the index may be stale.
   * @default true
   */
  enableEventSync?: boolean;
  /** Default top-K when callers omit it. @default 10 */
  defaultTopK?: number;
}

/**
 * `KnowledgeServicePlugin` — registers `IKnowledgeService` with the
 * kernel, binds it to `IDataEngine` for RLS-aware permission filtering,
 * and (optionally) subscribes to `IRealtimeService` so ObjectQL record
 * mutations automatically propagate to adapter backends.
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new KnowledgeServicePlugin({
 *   sources: [{
 *     id: 'task_notes', label: 'Task notes', adapter: 'memory',
 *     source: { kind: 'object', object: 'task', contentFields: ['notes'] },
 *   }],
 * }));
 * await kernel.bootstrap();
 *
 * const knowledge = kernel.getService('knowledge');
 * const hits = await knowledge.search('shopping list', { executionContext });
 * ```
 */
export class KnowledgeServicePlugin implements Plugin {
  name = 'com.objectstack.service.knowledge';
  version = '0.1.0';
  type = 'standard' as const;
  /**
   * init() resolves the `objectql` engine for RLS re-checks —
   * order-if-present so the resolution is deterministic (ADR-0116, #4471).
   * Soft, not hard: without an engine the service degrades on purpose
   * (pure-search mode with conservative RLS).
   *
   * The settings plugin is ordered ahead the same way: init() contributes the
   * knowledge settings to its `settings` service (`contributeKnowledgeSettings`),
   * so its absence there is a fact about the composition, never a guess.
   */
  // Literal ids: the boot-order gates read this array statically. The second
  // is `SETTINGS_PLUGIN_ID` from `@objectstack/service-settings`.
  optionalDependencies = ['com.objectstack.engine.objectql', 'com.objectstack.service.settings'];

  private service: KnowledgeService | null = null;
  private subscriptionId: string | undefined;
  /**
   * Captured where the subscription is taken out, not resolved at teardown:
   * `destroy()` — the hook the kernel actually calls — takes NO
   * `PluginContext` (`Plugin.destroy?(): Promise<void> | void`, core
   * `types.ts`). Holding the very service the subscription was placed with also
   * means the unsubscribe cannot miss it because the registry has already been
   * torn down around us.
   */
  private realtime: IRealtimeService | undefined;
  private logger: KnowledgeLogger | undefined;

  constructor(private readonly options: KnowledgeServicePluginOptions = {}) {}

  async init(ctx: PluginContext): Promise<void> {
    let engine: IDataEngine | undefined;
    try {
      engine = ctx.getService<IDataEngine>('objectql');
    } catch {
      // Data engine not wired — service still works in pure-search mode
      // but RLS re-checks will be conservative (drop object-source hits
      // when caller is non-system).
    }

    const logger: KnowledgeLogger = {
      info: (msg, ...rest) => {
        (ctx.logger as { info?: (m: string, ...r: unknown[]) => void }).info?.(msg, ...rest);
      },
      warn: (msg, ...rest) => {
        (ctx.logger as { warn?: (m: string, ...r: unknown[]) => void }).warn?.(msg, ...rest);
      },
      error: (msg, ...rest) => {
        (ctx.logger as { error?: (m: string, ...r: unknown[]) => void }).error?.(msg, ...rest);
      },
      debug: (msg, ...rest) => {
        (ctx.logger as { debug?: (m: string, ...r: unknown[]) => void }).debug?.(msg, ...rest);
      },
    };

    this.logger = logger;
    this.service = new KnowledgeService({
      dataEngine: engine,
      logger,
      defaultTopK: this.options.defaultTopK,
      // The field gate's `security` service, resolved per search so plugin
      // order is free (plugin-security registers it in its own start()).
      // Only a GENUINE absence reads as "no security service" (the contract's
      // fallback then applies: every field declaring a `maskingRule` is not
      // queryable): a lookup answering nothing, or the kernel's own
      // not-registered refusal. Any other throw — a registration that cannot
      // be used, such as a factory the sync accessor cannot instantiate —
      // propagates, and the service refuses the source fail-closed, as the
      // analytics door refuses an unusable security service.
      resolveSecurity: () => {
        try {
          return ctx.getService<KnowledgeFieldSecurity | undefined>('security') ?? undefined;
        } catch (err) {
          if (isServiceNotRegisteredError(err, 'security')) return undefined;
          throw err;
        }
      },
    });

    for (const source of this.options.sources ?? []) {
      this.service.registerSource(source);
    }

    ctx.registerService(KNOWLEDGE_SERVICE, this.service);

    // The knowledge settings page, the `ai` embedder section, both test
    // actions and the Setup entry are offered only where this service is
    // mounted — never by default (`@objectstack/service-settings`).
    contributeKnowledgeSettings(ctx, this.version);
    ctx.logger.info?.(
      `KnowledgeServicePlugin: registered '${KNOWLEDGE_SERVICE}' service (eventSync=${
        this.options.enableEventSync !== false
      }, dataEngine=${engine ? 'yes' : 'no'})`,
    );
  }

  async start(ctx: PluginContext): Promise<void> {
    // The embedder is provided at `kernel:bootstrapped`, after every
    // `kernel:ready` handler has settled: an embedder another plugin registers
    // in its init(), start() or `kernel:ready` (cloud `service-ai` reads its
    // settings there) is seen and kept, never doubled. A consumer resolves
    // `EMBEDDER_SERVICE` where it embeds, not at boot.
    ctx.hook('kernel:bootstrapped', async () => {
      await this.provideEmbedder(ctx);
    });

    if (this.options.enableEventSync === false) return;
    const service = this.service;
    if (!service) return;

    ctx.hook('kernel:ready', async () => {
      // Reap-path de-indexing first: it is independent of the realtime service,
      // and the branch below returns early when that one is absent.
      this.installReapGuards(ctx, service);

      let realtime: IRealtimeService | null = null;
      try {
        realtime = ctx.getService<IRealtimeService>('realtime');
      } catch {
        // realtime service not available — sync becomes opt-in via
        // explicit handleRecordUpsert / handleRecordDelete calls.
        ctx.logger.warn?.(
          'KnowledgeServicePlugin: IRealtimeService unavailable — event sync disabled. ' +
            'Adapters can still be driven manually via the service API.',
        );
        return;
      }

      this.realtime = realtime;
      this.subscriptionId = await realtime.subscribe('knowledge-event-sync', async (event) => {
        const object = event.object;
        if (!object) return;
        const type = event.type;
        const payload = (event.payload ?? {}) as Record<string, unknown>;

        // [#4626] `data.record.*` payloads ARE the spec's `DataEvent`
        // (`@objectstack/spec/api`): the record body lives in `after`, the id
        // in the required top-level `recordId`. The payload itself is the
        // ENVELOPE, never the row — reading it as a record indexes
        // `{ recordId, after }` as if it were the row (a document with none of
        // the record's fields), and a delete never resolves an id at all.
        //
        // These four are the only per-record names the ObjectQL engine
        // publishes: created, updated, deleted, and `data.record.restored`
        // (`RECORD_RESTORED_EVENT`, one per row a recycle-bin restore writes
        // back — a restore is never a create, ADR-0148 D2). A restored row
        // takes the upsert path: it is re-read against each source's `where`
        // like any other written row, so it re-enters the index only if it
        // matches. There is deliberately no `record.created|updated|deleted`
        // branch: no producer emits those names (the spec's `RealtimeEventType`
        // dropped them for the same reason), so a branch for them is dead code
        // plus a `payload.record ?? payload` fallback for a shape nobody sends.
        // An event type this handler does not name — those, and `metadata.*`
        // too — falls through without a sync.
        if (type === 'data.record.created' || type === 'data.record.updated' || type === RECORD_RESTORED_EVENT) {
          const record = payload.after as Record<string, unknown> | undefined;
          if (record && typeof record === 'object') {
            await service.handleRecordUpsert(object, record);
          }
          return;
        }
        if (type === 'data.record.deleted') {
          const recordId = payload.recordId;
          if (typeof recordId === 'string' && recordId !== '') {
            await service.handleRecordDelete(object, recordId);
          }
          return;
        }

        // [#4639] Aggregate events from a predicate write (`multi: true`).
        // A knowledge index is a PER-RECORD projection, and `matched: 40`
        // names no record — there is no upsert or delete this handler could
        // derive from it, and none of the adapters take a predicate. So the
        // index is now stale in a way this subscription cannot repair.
        //
        // Say so rather than falling through to the `return` below: a silent
        // no-op here reads identically to "nothing happened", which is how the
        // gap stayed invisible before #4639 gave bulk writes an event at all.
        //
        // [#4672] The warn STAYS, and it is deliberately still a warn about a
        // gap — but a narrower gap than it named before. The platform's own
        // predicate delete (the retention sweep's reap, and the source this
        // issue called out as the main one) no longer reaches this handler as a
        // stale index at all: `installReapGuards` de-indexes those rows before
        // they are deleted. What is left is APPLICATION-level predicate writes
        // — a caller's own `multi: true` update/delete — which no guard sits in
        // front of. That half is honestly uncovered rather than quietly
        // half-claimed, and stays so until a real object source justifies the
        // adapter-enumeration surface it would need (#4606's enforced-first
        // rule). Reporting it accurately is the whole job of this branch.
        // A complete reindexSource refreshes the rows that still exist and
        // match and, over an adapter that lists its documents, purges the
        // documents of rows that are gone or no longer match — the warning
        // says so, and names the adapter case it cannot repair.
        if (type === 'data.records.updated' || type === 'data.records.deleted') {
          const matched = payload.matched;
          ctx.logger.warn?.(
            `KnowledgeServicePlugin: '${object}' had a predicate write (${type}) affecting ` +
              `${typeof matched === 'number' ? matched : 'an unreported number of'} record(s). ` +
              'A bulk event carries a count, not records, so the knowledge index for this object ' +
              'may now be stale and cannot be repaired from the event stream. ' +
              'Retention-sweep deletes are covered separately: the lifecycle reap guard de-indexes those rows ' +
              'before they are deleted; ' +
              'application-level predicate writes are not. A complete reindexSource (no limit, no dryRun) refreshes ' +
              'the documents of rows that still exist and match, and purges the documents of rows that are gone or ' +
              'no longer match when the source\'s adapter lists its documents; over an adapter that does not, they ' +
              'stay in the index.',
            { object, type, matched },
          );
          return;
        }
      });
      ctx.logger.info?.('KnowledgeServicePlugin: event sync subscription active.');
    });
  }

  /**
   * Register `EMBEDDER_SERVICE` from the `ai.embedder_*` settings, unless an
   * embedder is already registered.
   *
   * - Already registered (cloud `service-ai`, or a host's own plugin) → kept,
   *   one `info` line, the settings are not applied. A registration this sync
   *   accessor cannot hand out (an async factory) is a registration too.
   * - Saved and complete → an `@objectstack/embedder-openai` embedder for the
   *   saved provider. The batch size is passed only when it was saved, and is
   *   held to the saved model's documented cap (`documentedMaxBatchSize`).
   * - Otherwise → an `UnconfiguredEmbedder`, whose every use answers an error
   *   naming the missing settings; the boot itself succeeds.
   *
   * Read once, at boot: a saved change takes effect on the next restart (the
   * settings page says so). Nothing is sent to a provider until the operator
   * has saved one, and the API key is never logged.
   */
  private async provideEmbedder(ctx: PluginContext): Promise<void> {
    let registered = true;
    let existing: unknown;
    try {
      existing = ctx.getService<unknown>(EMBEDDER_SERVICE);
    } catch (err) {
      if (isServiceNotRegisteredError(err, EMBEDDER_SERVICE)) registered = false;
    }
    if (registered) {
      const id = (existing as { id?: unknown } | undefined)?.id;
      ctx.logger.info?.(
        `KnowledgeServicePlugin: an embedder is already registered as '${EMBEDDER_SERVICE}'` +
          `${typeof id === 'string' ? ` (id=${id})` : ''} — kept; the ai.embedder_* settings are not applied.`,
      );
      return;
    }

    const outcome = await embedderFromSettings(ctx);
    if (outcome.kind === 'configured') {
      ctx.registerService(EMBEDDER_SERVICE, outcome.embedder);
      ctx.logger.info?.(
        `KnowledgeServicePlugin: registered '${EMBEDDER_SERVICE}' from the ai.embedder_* settings ` +
          `(provider=${outcome.provider}, model=${outcome.model ?? '(embedder default)'}, ` +
          `batch size=${outcome.batchSize ?? "the model's own cap"}` +
          `${outcome.savedBatchSize !== undefined ? ` — the saved ${outcome.savedBatchSize}, held to the model's documented cap` : ''}). ` +
          'A saved change takes effect on the next restart.',
      );
      return;
    }

    ctx.registerService(EMBEDDER_SERVICE, new UnconfiguredEmbedder(outcome.reason));
    const line =
      `KnowledgeServicePlugin: no embedder is configured (${outcome.reason}). The knowledge service is mounted; ` +
      'an adapter that embeds refuses indexing and search with this reason until an embedder is configured.';
    if (outcome.quiet) ctx.logger.info?.(line);
    else ctx.logger.warn?.(line);
  }

  /**
   * Register the lifecycle reap guard (#4672, ADR-0057 amendment) for every
   * object an `object` source projects.
   *
   * ## Why the guard rather than an event
   *
   * The retention sweep deletes rows by predicate, and ADR-0057 §3.3 forbids
   * fanning that out per record (the cleanup would re-feed the tables it is
   * draining). Without a guard the rows go and their documents stay: orphans,
   * keyed by a `sourceRecordId` that resolves to nothing. The ADR's own answer
   * to this shape is the guard — "a domain callback, not a second sweeper" —
   * and it arrives batched and interruptible for free (500 rows a batch, 20
   * batches a sweep), which is the cost bound this work would otherwise owe.
   *
   * ## Seams, all pre-existing
   *
   * Reached exactly as `service-storage` reaches it for `sys_file` byte
   * reclaim: duck-typed `ctx.getService('lifecycle')` +
   * `registerReapGuard(object, guard)`. No spec key, no `IKnowledgeAdapter`
   * member, no `packages/objectql` change (#4606's zero-addition boundary).
   * Guards compose by intersection (#5535), so registering here cannot displace
   * storage's byte-reclaim guard, nor it ours.
   *
   * Silent when there is no lifecycle service (a bare kernel): the sweep is
   * what deletes rows, so no sweeper means no orphans to prevent. Nothing is
   * concluded about the registry either — this runs at `kernel:ready`, and the
   * absence is neither cached nor asserted.
   *
   * One guard instance serves every object (it resolves its targets from the
   * `object` it is called with), and re-registering the identical function is a
   * documented no-op, so re-run wiring cannot double a de-index.
   *
   * ## Boundary, stated rather than implied
   *
   * The OBJECT SET is read once, here — every object declared by boot time,
   * which is every object the sources a host composes can name. A source
   * registered later through `registerSource` for an object that had none at
   * boot is therefore unguarded, while one for an already-guarded object is
   * picked up (the guard re-resolves its targets on each call). Making the set
   * itself dynamic would mean a new notification surface on the service, which
   * is precisely the addition #4606 rules out until a real `object` source
   * exists to justify it.
   */
  private installReapGuards(ctx: PluginContext, service: KnowledgeService): void {
    const objects = guardedObjectsFor(service.listSources());
    if (objects.length === 0) return;

    type LifecycleLike = {
      registerReapGuard?: (object: string, guard: ReturnType<typeof createKnowledgeReapGuard>) => void;
    };
    let lifecycle: LifecycleLike | undefined;
    try {
      lifecycle = ctx.getService<LifecycleLike>('lifecycle');
    } catch {
      return; // no lifecycle service — nothing reaps, nothing to guard.
    }
    if (!lifecycle || typeof lifecycle.registerReapGuard !== 'function') return;

    const guard = createKnowledgeReapGuard(service, this.logger);
    // Called AS A METHOD, never through a detached reference: the real
    // `LifecycleService.registerReapGuard` reads `this.reapGuards`, so
    // `const register = lifecycle.registerReapGuard` throws on the first call.
    for (const object of objects) lifecycle.registerReapGuard(object, guard);
    ctx.logger.info?.(
      `KnowledgeServicePlugin: reap guards registered with the lifecycle service for [${objects.join(', ')}] — ` +
        'rows are de-indexed before the retention sweep deletes them.',
    );
  }

  /**
   * The kernel's teardown hook (`Plugin.destroy?()`, core `types.ts`) — the
   * ONLY teardown entry point `ObjectKernel.performShutdown()` and
   * `LiteKernel.destroy()` invoke.
   *
   * [#10371] IT USED TO BE `stop()`, WHICH NOTHING CALLED. `Plugin` declares
   * `init()`, `start?()` and `destroy?()` and no `stop()`, so the kernel walked
   * past this plugin at shutdown and the `knowledge-event-sync` realtime
   * subscription outlived the kernel that created it. `start()` IS on the
   * interface, so the pair read as symmetric in review — that asymmetry is what
   * let the same shape survive in six packages at once.
   *
   * No timer here, so this member never cost a merge-queue eviction the way the
   * `plugin-reports` / `service-messaging` members did (#9371). The class is
   * the same one either way: a teardown the kernel does not reach.
   */
  async destroy(): Promise<void> {
    if (!this.subscriptionId) return;
    try {
      await this.realtime?.unsubscribe(this.subscriptionId);
    } catch {
      // best-effort
    }
    this.subscriptionId = undefined;
    this.realtime = undefined;
  }

  /**
   * Retained alias for {@link destroy}. Kept because it is public API of an
   * exported class, and removing it would break an embedder who learned to call
   * it directly precisely BECAUSE the kernel never did. The parameter is now
   * optional and ignored: `destroy()` takes no context, so teardown uses the
   * realtime service captured when the subscription was taken out. Prefer
   * kernel shutdown; direct callers keep working unchanged.
   */
  async stop(_ctx?: PluginContext): Promise<void> {
    await this.destroy();
  }
}
