// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { classifyAdmissionTenancyPosture } from '@objectstack/core';
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
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { KnowledgeService } from './knowledge-service.js';
import type { KnowledgeLogger } from './knowledge-service.js';
import type { KnowledgeBuildLock } from './knowledge-build.js';
import type { KnowledgeFieldSecurity } from './knowledge-source-admission.js';
import { createKnowledgeReapGuard, guardedObjectsFor } from './knowledge-reap-guard.js';
import { KnowledgeSourceLoader } from './knowledge-source-loader.js';
import { KNOWLEDGE_SOURCE_TYPE } from './knowledge-source-registry.js';
import { contributeKnowledgeSettings } from './knowledge-settings-contribution.js';
import { UnknownKeyError, UnknownNamespaceError } from '@objectstack/service-settings';

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
      /** The host requests go to — named in the boot line; the key never is. */
      endpointHost: string;
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

/** The providers whose form offers the Base URL field (`embedder_base_url`'s `visible` rule). */
const BASE_URL_PROVIDERS: ReadonlySet<string> = new Set(['custom', 'azure']);

/**
 * A saved number key read as a positive integer: the value (a number, or its
 * decimal text, as an `OS_*` override hands it over), `undefined` when nothing
 * is saved, `null` when what is saved is not one.
 */
function positiveIntegerSetting(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The host of an endpoint URL, or the URL itself when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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
  const preset = Object.prototype.hasOwnProperty.call(OPENAI_COMPATIBLE_PRESETS, providerId)
    ? (providerId as OpenAICompatiblePreset)
    : undefined;
  // The saved Base URL applies only to the providers whose form offers the
  // field (`custom`, `azure`, the manifest's `visible` rule); every other
  // provider uses its preset endpoint.
  const baseUrl =
    BASE_URL_PROVIDERS.has(providerId) && typeof saved.embedder_base_url === 'string'
      ? saved.embedder_base_url.trim()
      : undefined;
  const model = typeof saved.embedder_model === 'string' ? saved.embedder_model.trim() : undefined;
  // The two number keys can arrive as text: an `OS_AI_EMBEDDER_*` override of a
  // key with no numeric default is handed over as the env string. A positive
  // integer, as a number or as its decimal text, is the value; anything else
  // is refused below rather than dropped.
  const dimensions = positiveIntegerSetting(saved.embedder_dimensions);
  const savedBatch = positiveIntegerSetting(saved.embedder_batch_size);
  if (dimensions === null || savedBatch === null) {
    const key = dimensions === null ? 'embedder_dimensions' : 'embedder_batch_size';
    return {
      kind: 'unconfigured',
      quiet: false,
      reason:
        `ai.${key} is saved as '${String(saved[key])}', which is not a positive integer — correct it ` +
        EMBEDDER_SETTINGS_REMEDY,
    };
  }
  // Only a SAVED batch size is a batch cap; unsaved, the embedder batches at the
  // model's own documented cap (some providers accept 10, not the default 64).
  // A saved size is held to that documented cap when the saved model has one:
  // an explicit `maxBatchSize` would otherwise override it. A model the table
  // does not know, or no saved model, keeps the saved size as saved.
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
  const endpoint = baseUrl || (preset ? OPENAI_COMPATIBLE_PRESETS[preset] : '');
  if (!endpoint) {
    return {
      kind: 'unconfigured',
      quiet: false,
      reason: `ai.embedder_provider '${providerId}' names no known endpoint and no ai.embedder_base_url is saved — save one ${EMBEDDER_SETTINGS_REMEDY}`,
    };
  }
  try {
    const embedder = createOpenAIEmbedder({
      preset,
      baseUrl: endpoint,
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
      endpointHost: hostOf(endpoint),
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
  /**
   * Build, after boot and in the background, every source whose adapter
   * holds nothing for it or marks it as needing a rebuild (ADR-0161 K7,
   * "What starts a rebuild"; `KnowledgeService.buildSourcesAtBoot`). One node
   * builds each source, under the `cluster` service's lock. A build sends the
   * source's content fields to the embedding provider, which bills for them.
   * `false` leaves every source as it is; an administrator then builds one
   * with `os knowledge rebuild`.
   * @default true
   */
  buildAtBoot?: boolean;
  /**
   * [ADR-0161 K4 ◆] The deployment's adapter: the id of the store the runtime
   * mounts beside this plugin for the `knowledge` capability. Set by the
   * runtime's capability composition (`resolveCapabilityArgument` in
   * `@objectstack/core`, read by `os serve` and `@objectstack/verify`), which
   * constructs this plugin and the store together; a host that mounts the
   * plugin itself leaves it unset. A source that names no `adapter` binds to
   * it (`KnowledgeServiceOptions.deploymentAdapter`). A service option, never
   * an adapter-contract member.
   */
  deploymentAdapter?: string;
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
 *     name: 'task_notes', label: 'Task notes', adapter: 'memory',
 *     source: { kind: 'object', object: 'task', content: ['notes'] },
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
  /** The loader of the published `knowledge_source` items (`knowledge-source-loader.ts`). */
  private loader: KnowledgeSourceLoader | undefined;
  /** Dropped at destroy: the protocol's mutation signal and the service's source-change signal. */
  private unsubscribes: Array<() => void> = [];
  /** The one reap guard, and the objects it is registered for so far ({@link syncReapGuards}). */
  private reapGuard: ReturnType<typeof createKnowledgeReapGuard> | undefined;
  private readonly guardedObjects = new Set<string>();

  constructor(private readonly options: KnowledgeServicePluginOptions = {}) {}

  async init(ctx: PluginContext): Promise<void> {
    let engine: IDataEngine | undefined;
    try {
      engine = ctx.getService<IDataEngine>('objectql');
    } catch {
      // Data engine not wired — the service still mounts, and serves a
      // caller that is not the system identity no source at all: no hit can
      // be re-checked without an engine.
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
      ...(this.options.deploymentAdapter === undefined ? {} : { deploymentAdapter: this.options.deploymentAdapter }),
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
      // The settings page's `knowledge.chunk_target`, the splitter's
      // `maxChars` under a source's own `split.maxChars` (#37098). Read each
      // time the service splits, never here: the settings service may hold a
      // value saved after boot. No settings service, or none serving the
      // `knowledge` namespace (it is contributed below only where one
      // exists), reads as unset.
      resolveChunkTarget: async () => {
        let settings: { get?(ns: string, key: string): Promise<{ value?: unknown } | undefined> } | undefined;
        try {
          settings = ctx.getService('settings');
        } catch (err) {
          if (isServiceNotRegisteredError(err, 'settings')) return undefined;
          throw err;
        }
        if (typeof settings?.get !== 'function') return undefined;
        let resolved: { value?: unknown } | undefined;
        try {
          resolved = await settings.get('knowledge', 'chunk_target');
        } catch (err) {
          // A host's own settings service without this namespace or key:
          // nothing is configured there. Any other failure is the service's
          // to report (it warns and splits by the source's own value).
          if (err instanceof UnknownNamespaceError || err instanceof UnknownKeyError) return undefined;
          throw err;
        }
        const value = resolved?.value;
        return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
      },
      // [ADR-0161 K8, item 9] The EFFECTIVE tenancy posture, read per assembly
      // and per search from the kernel's `tenancy` service, classified the way
      // every admission seam classifies it: never registered → `undefined` (no
      // wall exists); registered and unreadable → a throw, which the service
      // answers fail-closed. The async accessor first, so a factory-registered
      // service resolves; the sync leg serves a `LiteKernel`-shaped host.
      resolveTenancyPosture: () =>
        classifyAdmissionTenancyPosture(async () => {
          const kernel = typeof ctx.getKernel === 'function' ? ctx.getKernel() : undefined;
          if (kernel && typeof kernel.getServiceAsync === 'function') {
            return kernel.getServiceAsync<{ posture?: string; isolationActive?: boolean }>('tenancy');
          }
          try {
            return ctx.getService<{ posture?: string; isolationActive?: boolean }>('tenancy');
          } catch (err) {
            if (isServiceNotRegisteredError(err, 'tenancy')) return undefined;
            throw err;
          }
        }),
      // The cluster lock a build runs under, so one node builds a source
      // (`knowledge-build.ts`). Resolved when a build starts; no `cluster`
      // service is a one-node composition, and a lookup that throws for any
      // other reason is the service's to report.
      resolveBuildLock: () => {
        let cluster: { lock?: KnowledgeBuildLock } | undefined;
        try {
          cluster = ctx.getService<{ lock?: KnowledgeBuildLock } | undefined>('cluster') ?? undefined;
        } catch (err) {
          if (isServiceNotRegisteredError(err, 'cluster')) return undefined;
          throw err;
        }
        return cluster?.lock && typeof cluster.lock.acquire === 'function' ? cluster.lock : undefined;
      },
    });

    for (const source of this.options.sources ?? []) {
      this.service.registerSource(source);
    }

    ctx.registerService(KNOWLEDGE_SERVICE, this.service);

    // The knowledge settings page, the `ai` embedder section, both test
    // actions and the Setup entry are offered only where this service is
    // mounted — never by default (`@objectstack/service-settings`).
    contributeKnowledgeSettings(ctx, this.version, this.service);
    ctx.logger.info?.(
      `KnowledgeServicePlugin: registered '${KNOWLEDGE_SERVICE}' service (eventSync=${
        this.options.enableEventSync !== false
      }, dataEngine=${engine ? 'yes' : 'no'})`,
    );
  }

  async start(ctx: PluginContext): Promise<void> {
    this.loadPublishedSources(ctx);

    // The embedder is provided at `kernel:bootstrapped`, after every
    // `kernel:ready` handler has settled: an embedder another plugin registers
    // in its init(), start() or `kernel:ready` (cloud `service-ai` reads its
    // settings there) is seen and kept, never doubled. A consumer resolves
    // `EMBEDDER_SERVICE` where it embeds, not at boot.
    ctx.hook('kernel:bootstrapped', async () => {
      // The published sources once more: a package another plugin registers
      // in its own `kernel:ready` handler (the install-local rehydrate) is
      // listed only now, and the first build below must see its sources.
      await this.reconcileSources(ctx, 'boot');
      await this.provideEmbedder(ctx);
      // [ADR-0161 K7] The first build: every source a build is due for is
      // built once, in the background — after the embedder is provided,
      // since a build embeds, and never awaited, so the boot does not wait
      // for it. `buildAtBoot: false` turns it off.
      if (this.options.buildAtBoot !== false && this.service) {
        // `buildSourcesAtBoot` resolves on every failure it can name; the
        // catch is for one it cannot, so no rejection goes unhandled.
        void this.service.buildSourcesAtBoot().catch((err: unknown) => {
          ctx.logger.warn?.(
            `KnowledgeServicePlugin: the boot build pass stopped (${err instanceof Error ? err.message : String(err)}); ` +
              'no further source is built at this boot. Rebuild one with os knowledge rebuild.',
          );
        });
      }
    });
    // Every store registers its adapter in its own start(), so the reading of
    // which sources name an unmounted one is taken once all have started.
    ctx.hook('kernel:bootstrapped', () => {
      this.service?.reportUnmountedAdapters();
    });

    if (this.options.enableEventSync === false) return;
    const service = this.service;
    if (!service) return;

    // [ADR-0161 K3, item 2] The guarded object set follows the sources: a
    // source registered or loaded after boot for an object no source indexed
    // before gets its guard when it arrives.
    this.unsubscribes.push(service.onSourcesChanged(() => this.syncReapGuards(ctx, service)));

    ctx.hook('kernel:ready', async () => {
      // Reap-path de-indexing first: it is independent of the realtime service,
      // and the branch below returns early when that one is absent.
      this.syncReapGuards(ctx, service);

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
        // front of. The event stream cannot repair that half (it names no
        // record); a complete reindex does, by the purge ADR-0161 K8 items 1
        // and 2 gave it. Reporting it accurately is the whole job of this
        // branch.
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
          `(provider=${outcome.provider}, endpoint=${outcome.endpointHost}, model=${outcome.model ?? '(embedder default)'}, ` +
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
   * Load the published `knowledge_source` items (ADR-0161 K4, clause 3) and
   * keep the service's sources in step with them.
   *
   * - **At boot**: one pass at `kernel:ready`, when every plugin has started
   *   and the apps' packages are registered, and one more at
   *   `kernel:bootstrapped`, before the first build (see `start`).
   * - **While the process runs**: one pass on each signal that a published
   *   item may have changed — the metadata protocol's mutation signal
   *   (`onMetadataMutation`: a save, a publish, a delete, a revert, a
   *   rollback, and on a cluster the same write converging on a peer), for a
   *   `knowledge_source` item that is not a draft; and the kernel's
   *   `metadata:reloaded` (a package published, installed or removed, a dev
   *   artifact recompiled). A draft is not a published item and loads nothing.
   *
   * The listing is the protocol's execution read of the type
   * (`getMetaItemsForExecution`, else `getMetaItems`): the stored bodies with
   * each row's package, the merge every `/meta` read serves. With no
   * `protocol` service there is no metadata store, and the sources are the
   * ones registered in code.
   */
  private loadPublishedSources(ctx: PluginContext): void {
    const service = this.service;
    if (!service) return;
    this.loader = new KnowledgeSourceLoader({
      service,
      logger: this.logger,
      buildOnReload: this.options.buildAtBoot !== false,
      readItems: () => readPublishedSources(ctx),
      namespaceOf: (packageId) => packageNamespaceOf(ctx, packageId),
    });

    ctx.hook('kernel:ready', async () => {
      await this.reconcileSources(ctx, 'boot');
      // Resolved here, once every plugin has started, so a protocol that
      // registers after this plugin is seen.
      const protocol = protocolOf(ctx);
      if (typeof protocol?.onMetadataMutation === 'function') {
        const unsubscribe = protocol.onMetadataMutation((evt) => {
          if (!evt || evt.type !== KNOWLEDGE_SOURCE_TYPE || evt.state === 'draft') return;
          void this.reconcileSources(ctx, 'reload');
        });
        if (typeof unsubscribe === 'function') this.unsubscribes.push(unsubscribe);
      }
    });
    ctx.hook('metadata:reloaded', async () => {
      await this.reconcileSources(ctx, 'reload');
    });
  }

  /** One loader pass; never throws — a failed pass is reported and changes nothing further. */
  private async reconcileSources(ctx: PluginContext, reason: 'boot' | 'reload'): Promise<void> {
    if (!this.loader) return;
    try {
      const result = await this.loader.reconcile(reason);
      const total = result.added.length + result.changed.length + result.removed.length;
      if (total === 0) return;
      const part = (label: string, faces: string[]): string => (faces.length === 0 ? '' : ` ${label}: ${faces.join(', ')}.`);
      ctx.logger.info?.(
        `KnowledgeServicePlugin: knowledge_source items loaded.${part('Added', result.added)}` +
          `${part('Changed', result.changed)}${part('Removed, index dropped', result.removed)}`,
      );
    } catch (err) {
      ctx.logger.warn?.(
        `KnowledgeServicePlugin: loading the knowledge_source items failed (${err instanceof Error ? err.message : String(err)}); ` +
          'the sources stay as they were. The next change to a knowledge source, or a restart, loads them again.',
      );
    }
  }

  /**
   * Register the lifecycle reap guard (#4672, ADR-0057 amendment) for every
   * object a source projects — at `kernel:ready`, and again each time the set
   * of sources changes (ADR-0161 K3, item 2: the set is dynamic).
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
   * ## Seams
   *
   * Reached exactly as `service-storage` reaches it for `sys_file` byte
   * reclaim: duck-typed `ctx.getService('lifecycle')` +
   * `registerReapGuard(object, guard)`. Guards compose by intersection
   * (#5535), so registering here cannot displace storage's byte-reclaim
   * guard, nor it ours.
   *
   * Silent when there is no lifecycle service (a bare kernel): the sweep is
   * what deletes rows, so no sweeper means no orphans to prevent. The absence
   * is not cached: the next change of the sources asks again.
   *
   * ## The object set follows the sources
   *
   * One guard instance serves every object (it resolves its targets from the
   * `object` it is called with, each call). The objects it is registered for
   * are remembered, and each pass registers it for the objects that have a
   * source now and had none before — a source loaded from a
   * `knowledge_source` item saved after boot, or registered in code after
   * boot, is guarded from that moment. An object whose last source was
   * removed keeps its registration: the lifecycle service has no unregister,
   * and the guard, finding no source for the object, confirms every row and
   * de-indexes nothing.
   */
  private syncReapGuards(ctx: PluginContext, service: KnowledgeService): void {
    const objects = guardedObjectsFor(service.indexedSources()).filter((object) => !this.guardedObjects.has(object));
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

    const guard = (this.reapGuard ??= createKnowledgeReapGuard(service, this.logger));
    // Called AS A METHOD, never through a detached reference: the real
    // `LifecycleService.registerReapGuard` reads `this.reapGuards`, so
    // `const register = lifecycle.registerReapGuard` throws on the first call.
    for (const object of objects) {
      lifecycle.registerReapGuard(object, guard);
      this.guardedObjects.add(object);
    }
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
    // The boot's first-build pass starts no further build; one already
    // walking runs to its end (a walk cannot be cancelled part-way).
    this.service?.stopBuilds();
    for (const unsubscribe of this.unsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
    }
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

/** The slice of the metadata protocol the loader reads, reached duck-typed. */
interface KnowledgeSourceProtocol {
  getMetaItemsForExecution?(request: { type: string }): Promise<unknown>;
  getMetaItems?(request: { type: string }): Promise<unknown>;
  onMetadataMutation?(listener: (evt: { type?: string; name?: string; state?: string } | undefined) => void): (() => void) | void;
}

function protocolOf(ctx: PluginContext): KnowledgeSourceProtocol | undefined {
  try {
    return ctx.getService<KnowledgeSourceProtocol | undefined>('protocol') ?? undefined;
  } catch {
    return undefined; // no protocol service: no metadata store to read.
  }
}

/**
 * The published `knowledge_source` items, or `null` when they cannot be read
 * (the loader then changes nothing). No `protocol` service, or one with no
 * list read, is a composition with no metadata store: it holds no item, which
 * is an empty list, not a failed read.
 */
async function readPublishedSources(ctx: PluginContext): Promise<unknown[] | null> {
  const protocol = protocolOf(ctx);
  const read = typeof protocol?.getMetaItemsForExecution === 'function'
    ? protocol.getMetaItemsForExecution.bind(protocol)
    : typeof protocol?.getMetaItems === 'function'
      ? protocol.getMetaItems.bind(protocol)
      : undefined;
  if (!read) return [];
  let raw: unknown;
  try {
    raw = await read({ type: KNOWLEDGE_SOURCE_TYPE });
  } catch (err) {
    ctx.logger.warn?.(
      `KnowledgeServicePlugin: the knowledge_source items could not be read (${err instanceof Error ? err.message : String(err)}); ` +
        'the sources stay as they were.',
    );
    return null;
  }
  // The read hands back a bare array or an `{ items: [...] }` envelope, and
  // each entry is the document itself or an `{ item }` wrapper.
  const list = Array.isArray(raw) ? raw : (raw as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const doc = entry && typeof entry === 'object' && 'item' in entry ? (entry as { item: unknown }).item : entry;
    return stripReadDecorations(doc);
  });
}

/**
 * [ADR-0150 D2/D6] The manifest namespace of a package, from the engine's
 * registry, or `undefined`: no engine, or an id with no package record. A
 * source's face is then its bare name.
 */
function packageNamespaceOf(ctx: PluginContext, packageId: string): string | undefined {
  type RegistryLike = { registry?: { getPackage?(id: string): { manifest?: { namespace?: unknown } } | undefined } };
  let engine: RegistryLike | undefined;
  try {
    engine = ctx.getService<RegistryLike | undefined>('objectql') ?? undefined;
  } catch {
    return undefined;
  }
  let namespace: unknown;
  try {
    namespace = engine?.registry?.getPackage?.(packageId)?.manifest?.namespace;
  } catch {
    return undefined;
  }
  return typeof namespace === 'string' && namespace !== '' ? namespace : undefined;
}
