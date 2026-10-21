// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  // [ruling record 6227928430, letter A] The ONE request-to-ExecutionContext
  // composition: the session read under the in-process rule, the tenancy
  // posture's classification, `resolveAuthzContext` with the auth service's
  // per-user posture source (ADR-0069 · #23287) and its API-key lifecycle
  // policy (#23367), and the assembly. This door states its differences as the
  // function's named parameters and keeps only its own facts.
  resolveRequestExecutionContext,
  isAuthzStoreUnavailableError,
  // [#23367] The brand of the refusal an API key's own lifecycle produces.
  isApiKeyLifecycleRefusalError,
  // [#16013] The posture derivation, in ONE call. It reads the posture IN
  // FORCE off the `tenancy` service (never the REQUESTED one an env var asks
  // for) and carries decision-1-option-A's classification (#13906) for every
  // admission seam at once -- see `tenancyServiceResolver` below for the half
  // that stays this seam's own.
  classifyAdmissionTenancyPosture,
  type TenancyPostureSource,
  type TenancyServiceResolver,
} from '@objectstack/core';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import type { IHttpServer, IDataEngine, IHttpRequest, IAuthService } from '@objectstack/spec/contracts';
import type { SettingsContext } from './settings-service.types.js';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
import type { SettingsAuditWriter, SettingsEngine, SettingsSecretStore } from './settings-service.types.js';
import type { CryptoAdapter } from './crypto-adapter.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { buildConfigChangeAuditSink } from './config-change-audit.js';
import { USER_OBJECT, assertUserReferenceResolves, registeredLabel } from './actor-reference.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { registerSettingsReadDoor } from './settings-read-door.js';
import {
  settingsObjects,
  settingsPluginManifestHeader,
  SETTINGS_PLUGIN_ID,
  SETTINGS_PLUGIN_VERSION,
} from './manifest.js';
import {
  builtinSettingsManifests,
  mailTestActionHandler,
  smsTestActionHandler,
  storageTestActionHandler,
  aiTestActionHandler,
  aiTestEmbedderActionHandler,
  knowledgeTestActionHandler,
} from './manifests/index.js';
import { settingsBuiltinTranslations } from './translations/index.js';

/**
 * Namespaces offered only where no organization wall stands (#24766, the
 * maintainer's ruling B′ and its amendment).
 *
 * `branding` is the one member. Its values reach the console through the
 * runtime-config door (`GET /api/v1/runtime/config`), which is anonymous and
 * resolves no organization before sign-in. Under `single` the one organization
 * IS the deployment, so its saved name, logo and colour are the deployment's.
 * Under a walled posture (`group` / `isolated`) there is no such thing as "the"
 * organization's branding on that door, and the ruling keeps tenant data off
 * it: the Branding page is not offered there at all, and the deployment's
 * branding is the operator's, through `OS_PRODUCT_NAME` / `OS_LOGO_URL` /
 * `OS_BRAND_COLOR`.
 *
 * "Not offered" is the registry's own answer, so every door agrees without a
 * second rule: the namespace is absent from `GET /api/settings`, a read or
 * write of it is refused `404 UNKNOWN_NAMESPACE` by the path every unknown
 * namespace takes, and the runtime-config door finds nothing to read. Its
 * Setup entry travels with it ({@link UNWALLED_ONLY_SETUP_NAV}).
 *
 * Such a manifest is held back at `init()` and registered from the
 * `kernel:ready` hook once the posture IN FORCE is known: during `init()` the
 * `tenancy` service may not be registered yet, and the `isolated` posture is
 * only in force once `org-scoping` has registered, so a verdict taken there
 * could be contradicted later in the same boot.
 */
const UNWALLED_ONLY_NAMESPACES: ReadonlySet<string> = new Set(['branding']);

/**
 * The Setup entry of each {@link UNWALLED_ONLY_NAMESPACES} member, contributed
 * WITH the namespace (#24766, the amendment's "no Setup entry" half).
 *
 * It used to be a static item of `@objectstack/platform-objects`'
 * `SETUP_NAV_CONTRIBUTIONS`, so a walled deployment listed a page the server
 * does not serve. It now lives and dies with the capability — the
 * `@objectstack/mcp` `connect-ui.ts` pattern (cloud ADR-0009): registered
 * through the `manifest` service from the same `kernel:ready` step that offers
 * the namespace, and never where the namespace is withheld. The labels stay
 * keyed `apps.setup.navigation.<id>` in platform-objects' bundles, which is
 * where the console resolves every Setup entry, contributed or static.
 *
 * A factory, not a shared literal: the nav fold pushes contributed items into
 * the merged tree by reference.
 */
const UNWALLED_ONLY_SETUP_NAV: Readonly<Record<string, () => Record<string, unknown>>> = {
  branding: () => ({
    id: 'nav_settings_branding',
    type: 'url',
    label: 'Branding',
    url: '/apps/setup/system/settings/branding',
    icon: 'palette',
  }),
};

/** The bundle id the Setup entries register under — distinct from the plugin's own manifest. */
const UNWALLED_ONLY_SETUP_NAV_BUNDLE_ID = `${SETTINGS_PLUGIN_ID}.setup-nav`;

/** Configuration options for the SettingsServicePlugin. */
export interface SettingsServicePluginOptions {
  /**
   * Pre-register these manifests at boot. When omitted, the bundled
   * builtin manifests (mail / branding / feature_flags) are loaded so
   * a host gets a working Settings hub out of the box. Pass an empty
   * array to opt out entirely. A `branding` manifest, bundled or passed
   * here, is offered only where no organization wall stands (see
   * `UNWALLED_ONLY_NAMESPACES` in this file).
   */
  manifests?: SettingsManifest[];
  /** Override the default crypto adapter. */
  crypto?: CryptoAdapter;

  /**
   * Phase 3 KMS hook. When provided, encrypted specifier values are
   * routed through this provider into `sys_secret`; `sys_setting.value_enc`
   * holds the handle id only. Defaults to `LocalCryptoProvider`, an
   * AES-256-GCM provider keyed off `OS_SECRET_KEY` (or a persisted dev key).
   * In production it refuses to boot without a stable key rather than
   * silently minting an ephemeral one. Swap in an AWS / GCP / Vault
   * KMS-backed implementation for managed custody and per-tenant keys.
   */
  cryptoProvider?: ICryptoProvider;
  /** Override the default base path (`/api/settings`). */
  basePath?: string;
  /** Disable REST route registration. */
  registerRoutes?: boolean;
  /** Override the env source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Action handlers to register at boot, keyed by namespace and action
   * id. When omitted, the bundled handler of every `action_button` the
   * builtin manifests declare is registered (`mail.test`, `sms.test`,
   * `storage.test`, `ai.test`, `ai.test_embedder`, `knowledge.test`;
   * `reset` is served by the service for every namespace). Providing this
   * object replaces that whole default map. A plugin may still replace any
   * one handler later with `SettingsService.registerAction`.
   */
  actionHandlers?: Record<string, Record<string, import('./settings-service.types.js').SettingsActionHandler>>;
}

/**
 * SettingsServicePlugin — wires the SettingsService into the kernel.
 *
 *  1. `init`: instantiate the service, register it under `'settings'`,
 *     and ship `sys_setting` to the manifest service so the engine
 *     auto-provisions the table.
 *  2. `start` → `kernel:ready`: bind the data engine (when present),
 *     wire BOTH audit ledgers — `sys_audit_log` `config_change` rows
 *     ({@link buildConfigChangeAuditSink}) and the settings-specific
 *     `sys_setting_audit` trail ({@link SettingsServicePlugin.buildAuditWriter})
 *     — and mount REST routes.
 */
export class SettingsServicePlugin implements Plugin {
  name = SETTINGS_PLUGIN_ID;
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['settings'];
  /**
   * init() registers the settings K/V object through the `manifest` service
   * ObjectQLPlugin provides — order-if-present so the registration is
   * deterministic (ADR-0116, #4471). Soft, not hard: lean test kernels
   * without an engine degrade on purpose (no sys table, service still up).
   */
  optionalDependencies = ['com.objectstack.engine.objectql'];
  version = SETTINGS_PLUGIN_VERSION;
  type = 'standard' as const;

  private readonly opts: SettingsServicePluginOptions;
  private service: SettingsService | null = null;
  /**
   * Manifests in {@link UNWALLED_ONLY_NAMESPACES}, held back by `init()` until
   * the `kernel:ready` hook knows the posture in force.
   */
  private readonly heldUntilPostureKnown: SettingsManifest[] = [];

  constructor(opts: SettingsServicePluginOptions = {}) {
    this.opts = {
      ...opts,
      manifests: opts.manifests ?? builtinSettingsManifests,
      // One entry per `action_button` a builtin manifest declares against the
      // settings action route — a declared button with no entry here answers
      // "No handler registered" (#24769). `settings-default-action-handlers.pin.test.ts`
      // enumerates the manifests and holds this map to them.
      actionHandlers: opts.actionHandlers ?? {
        mail: { test: mailTestActionHandler },
        sms: { test: smsTestActionHandler },
        storage: { test: storageTestActionHandler },
        ai: { test: aiTestActionHandler, test_embedder: aiTestEmbedderActionHandler },
        knowledge: { test: knowledgeTestActionHandler },
      },
    };
  }

  async init(ctx: PluginContext): Promise<void> {
    this.service = new SettingsService({
      crypto: this.opts.crypto,
      env: this.opts.env,
      // The engine arrives later, from this plugin's own `kernel:ready` hook
      // below. Declaring the pending bind here is what lets the service REFUSE
      // a write in that window instead of resolving it into the in-memory
      // fallback while nothing reaches `sys_setting` — see
      // `SettingsEngineNotBoundError`. Both branches of that hook clear it.
      engineBindPending: true,
      // #5204 — the service reports a rejected `OS_*` override at `error`, and
      // it must land in the deployment's real log pipeline rather than raw
      // stdout. Passed before `registerManifest` below, because that call is
      // what audits this namespace's env overrides: constructing the service
      // without the logger first would send the boot-time report to the
      // `console.error` fallback instead.
      logger: ctx.logger,
    });
    for (const m of this.opts.manifests ?? []) {
      if (UNWALLED_ONLY_NAMESPACES.has(m.namespace)) {
        this.heldUntilPostureKnown.push(m);
        continue;
      }
      this.service.registerManifest(m);
    }
    for (const ns of Object.keys(this.opts.actionHandlers ?? {})) {
      // A held namespace's handlers register with its manifest, or not at all.
      if (UNWALLED_ONLY_NAMESPACES.has(ns)) continue;
      this.registerActionHandlers(ns);
    }

    ctx.registerService('settings', this.service);
    ctx.logger?.info?.(
      `SettingsServicePlugin: registered (manifests=${this.opts.manifests?.length ?? 0})`,
    );

    // Register the K/V object so the engine creates the table.
    try {
      ctx.getService<{ register(m: any): void }>('manifest').register({
        ...settingsPluginManifestHeader,
        objects: settingsObjects,
      });
    } catch {
      // manifest service is optional — skip in lean test kernels.
    }
  }

  async start(ctx: PluginContext): Promise<void> {
    if (!this.service) return;

    ctx.hook('kernel:ready', async () => {
      // First, before the engine binds (its change event names every
      // registered namespace) and before any later `kernel:ready` reader runs.
      await this.offerUnwalledOnlyNamespaces(ctx);

      // Contribute built-in settings translations into the i18n service.
      // Done in `kernel:ready` (not `init`) because the i18n service plugin
      // is typically registered AFTER capability-loaded service plugins.
      try {
        const i18n = ctx.getService<{
          loadTranslations: (locale: string, data: Record<string, unknown>) => void;
        }>('i18n');
        let loaded = 0;
        for (const [locale, data] of Object.entries(settingsBuiltinTranslations)) {
          if (data && typeof data === 'object') {
            try {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
              loaded++;
            } catch (err: any) {
              ctx.logger?.warn?.(
                `SettingsServicePlugin: failed to load translations for '${locale}': ${err?.message ?? err}`,
              );
            }
          }
        }
        if (loaded > 0) {
          ctx.logger?.info?.(
            `SettingsServicePlugin: contributed built-in translations (${loaded} locale${loaded > 1 ? 's' : ''})`,
          );
        }
      } catch {
        // i18n service not registered — manifest literals remain authoritative.
      }

      // Late-bind the data engine.
      let engine: IDataEngine | null = null;
      try {
        engine = ctx.getService<IDataEngine>('objectql');
      } catch {
        // ok — fall back to in-memory.
      }
      if (engine) {
        // Late-bind the engine + audit sink on the existing service
        // instance. We avoid re-registering the service because the
        // kernel disallows `registerService` for an already-registered
        // name.
        //
        // SettingsEngine and IDataEngine have *different* update
        // signatures — SettingsEngine bundles `{ where, data }` into a
        // single opts object, while IDataEngine takes
        // `(object, data, options?)` and extracts the row id from
        // `data.id` or `options.where.id`. A force-cast leaves runtime
        // calls to `update(object, { where, data })` reaching the real
        // engine as a malformed payload with no id, which then throws
        // "Update requires an ID or options.multi=true". The adapter
        // below performs the translation so SettingsService can keep
        // its narrow, bundled signature.
        this.service!.bindEngine(
          wrapEngineAsSettingsEngine(engine),
          // [#8145] The generic-ledger sink — `sys_audit_log` rows with
          // `action: 'config_change'`. This argument was `undefined` from the
          // day the slot was declared, which is the whole of #7675's
          // `config_change` half: the settings service audited into
          // `sys_setting_audit` and nothing else, so the shipped
          // `config_changes` list view and every `action: 'config_change'`
          // filter were permanently empty. Both ledgers are written now — see
          // `config-change-audit.ts` for why the settings-specific one keeps
          // its rows rather than being rerouted.
          buildConfigChangeAuditSink(engine, ctx.logger),
          {
            secretStore: this.buildSecretStore(engine),
            auditWriter: this.buildAuditWriter(ctx, engine),
            cryptoProvider: this.opts.cryptoProvider ?? new LocalCryptoProvider(),
            // The posture IN FORCE, read the way this plugin's HTTP door reads
            // it — so the service and the door it sits behind agree on whether
            // organizations are walled off. Read live at each use.
            tenancyPosture: () => this.resolveAdmissionTenancyPosture(ctx),
          },
        );
        // Each namespace's `readPermission`, applied at the generic data
        // API's read of the settings stores too (see `settings-read-door.ts`).
        if (!registerSettingsReadDoor(engine, this.service!)) {
          ctx.logger?.warn?.(
            'SettingsServicePlugin: the objectql engine offers no middleware seam, so the data API ' +
              'read of sys_setting / sys_setting_audit / sys_platform_setting / sys_platform_setting_audit ' +
              'is NOT gated by each ' +
              "settings namespace's readPermission — only by the objects' own grants.",
          );
        }
      } else {
        // No `objectql` on this kernel — the OPTIONAL dependency this plugin
        // declares is genuinely absent, so no engine is ever coming and the
        // in-memory fallback IS this deployment's store. Settle the window the
        // other way rather than leaving writes refused forever: from here on the
        // service behaves exactly as it did before the guard existed.
        this.service!.settleWithoutEngine();
        ctx.logger?.warn?.(
          'SettingsServicePlugin: no objectql engine — settings persist to the in-process ' +
            'memory fallback only and are lost on restart.',
        );
      }

      if (this.opts.registerRoutes === false) return;

      let http: IHttpServer | null = null;
      try {
        http = ctx.getService<IHttpServer>('http-server');
      } catch {
        // ok — no HTTP server in this deployment.
      }
      if (!http) {
        ctx.logger?.warn?.(
          'SettingsServicePlugin: no HTTP server available — REST routes not registered. ' +
            'SettingsService is still reachable via kernel.getService("settings").',
        );
        return;
      }
      // [Finding-1] Derive the caller's identity + capabilities from the
      // platform's VERIFIED resolution (session cookie / API key / OAuth), NOT
      // from spoofable `x-user-id` / `x-permissions` headers. The shared
      // composition returns real, server-verified capabilities; `enforced:
      // true` makes the service apply the manifest read/write permission gates.
      // An unresolvable request fails CLOSED (anonymous + enforced → denied).
      const verifiedContextFromRequest = async (req: IHttpRequest): Promise<SettingsContext> => {
        try {
          const ql: any = ctx.getService('objectql');
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers ?? {})) {
            if (v == null) continue;
            headers.set(String(k), Array.isArray(v) ? v.join(',') : String(v));
          }
          // [#23287, ruling C′ item 3] The auth service: its session read, its
          // per-user posture computation for the shared key-admission seam, and
          // its API-key lifecycle policy (#23367). A lookup that throws is no
          // auth service, so the API-key door still admits.
          let authService: IAuthService | undefined;
          try {
            authService = ctx.getService<IAuthService>('auth');
          } catch {
            authService = undefined;
          }
          // [ruling record 6227928430, letter A item 3] This door's differences,
          // each a named parameter of the one composition:
          //
          //  - `anonymous: 'fail-closed'`: a request that resolves no principal
          //    yields no context, and the door answers its anonymous floor.
          //  - `authGate: 'resolved'` (ADR-0069 · #23287): the posture the shared
          //    resolver decided for whichever credential admitted the caller, a
          //    held session's own or an API key owner's account-scope posture,
          //    read by the family's door (`registerSettingsRoutes`), which
          //    refuses a context carrying it with the gate's `403`. Absent for
          //    every healthy caller, and for a key whose owner holds only a
          //    `credential`-scope posture. No second
          //    read and no outage arm: the posture comes off the same read that
          //    resolved the caller, so a read that fails resolved no caller
          //    either, and the anonymous floor refuses it. The `503` REST and
          //    storage answer belongs to a SEPARATE gate re-read that fails
          //    after the caller was resolved, a state this door never enters
          //    for a session. For an API key the owner's posture is asked inside
          //    the resolver, and a computation that rejects raises the branded
          //    outage the `catch` below re-raises.
          //  - `sessionApi: 'optional'`: with no session read, an API key still
          //    admits its owner.
          //  - [#15351] `tenancy`: the posture is an authorization INPUT. Without
          //    it both posture-conditional API-key refusals were unreachable
          //    here, and this seam hands the vetted `tenantId` onward as the
          //    resolved settings tenant.
          //  - `localization`, `requestLocale`, `accessToken`: withheld. The
          //    settings context carries no locale, no time zone and no bearer.
          const context = await resolveRequestExecutionContext({
            headers,
            ql,
            authService,
            tenancy: this.tenancyServiceResolver(ctx),
            anonymous: 'fail-closed',
            authGate: 'resolved',
            credentials: 'api-key-and-session',
            sessionApi: 'optional',
            session: 'request',
            localization: 'withhold',
            requestLocale: undefined,
            accessToken: 'withhold',
            oauth: undefined,
            onAdmission: undefined,
          });
          if (!context) return { enforced: true }; // fail closed
          const authGate = context.authGate;
          return {
            userId: context.userId,
            tenantId: context.tenantId,
            // Manifest read/write permissions are system CAPABILITIES
            // (setup.access / setup.write / manage_platform_settings) — union
            // both aggregates so either kind of declared gate resolves.
            permissions: [...(context.systemPermissions ?? []), ...(context.permissions ?? [])],
            enforced: true,
            ...(authGate ? { authGate } : {}),
          };
        } catch (err) {
          // [commit 6a180e42d] An unreachable permission store is an outage, not a
          // caller with no permissions — re-raise it rather than returning an
          // enforced-but-empty context the routes read as a denial.
          if (isAuthzStoreUnavailableError(err)) throw err;
          // [#23367] A key its own lifecycle refused (revoked, expired,
          // inactive) is a verdict, not a missing caller: re-raised by brand
          // for the family's door (`registerSettingsRoutes`), which relays it
          // as its declared 403 and ledger code beside the store outage.
          if (isApiKeyLifecycleRefusalError(err)) throw err;
          return { enforced: true }; // fail closed
        }
      };

      registerSettingsRoutes(http, this.service!, {
        basePath: this.opts.basePath,
        contextFromRequest: verifiedContextFromRequest,
      });
      ctx.logger?.info?.(
        'SettingsServicePlugin: REST routes registered at ' + (this.opts.basePath ?? '/api/settings'),
      );
    });
  }

  /**
   * [#15351] How this door reaches the `tenancy` service, so the posture IN
   * FORCE reaches `resolveAuthzContext` (through the shared composition,
   * `resolveRequestExecutionContext`) and its two posture-conditional API-key
   * refusals run: `organization_required` (an organization-less key under a
   * wall) and `organization_membership_ended` (a key stamped with an
   * organization its owner has left). Both are gated on a posture the CALLER
   * supplies, and this caller once supplied none.
   *
   * ## ⛔ Not the requested posture
   *
   * `resolveTenancyPosture()` reads `OS_TENANCY_POSTURE` — what the deployment
   * ASKED for. Under ADR-0093 D4/D5 a deployment that requests `isolated`
   * without the organizations runtime is `single` in force, so the
   * requested value would refuse legitimate automation over a wall that is not
   * there. The posture the guards must see is the one the `tenancy` service
   * reports, which is what {@link effectiveTenancyPosture} reads.
   *
   * ## The classification, decision 1 option A (#13906) — no longer written here
   *
   * [#16013] `classifyAdmissionTenancyPosture` (`@objectstack/core`) owns it
   * for every admission seam, called on this resolver by the shared composition
   * for the door and by {@link resolveAdmissionTenancyPosture} for the service:
   * never registered ⇒ branded ⇒ quiet `undefined`;
   * every other rejection ⇒ `AuthzStoreUnavailableError` (ADR-0112
   * `SERVICE_UNAVAILABLE` / 503), because admission was never DECIDED and must
   * not be answered. ⛔ A `try { … } catch { undefined }` at any seam
   * re-introduces exactly the permissive-on-failure defect #13906 exists to
   * repair — a failure reading as "this check does not apply" — and six copies
   * of that decision were six chances to write it.
   *
   * ⚠️ At THIS door: a lean embedding with no `plugin-auth` is a SUPPORTED
   * composition, so behaviour there is exactly what it was; and on the loud arm
   * the caller's own `catch` re-raises the brand rather than degrading it to a
   * denial.
   *
   * ⚠️ The brand exists only on the ASYNC resolution path: `PluginContext.getService`
   * throws two UNBRANDED plain `Error`s (`… not found` and `… is async - use
   * await`), so a synchronous read cannot tell the two facts apart and would
   * have to guess. Hence `getServiceAsync`, reached through `getKernel()`.
   *
   * ⚠️ The ASYNC ACCESSOR's presence is part of the wiring fact, exactly as on
   * the REST and install-local seams: a `KernelBase`-shaped host (`LiteKernel`)
   * exposes `getKernel()` but has no `getServiceAsync` at all, so dereferencing
   * it would raise an unbranded — therefore LOUD — `TypeError`, turning "this
   * host shape has no async registry" into an outage. Such a host has no
   * service factories either (`registerServiceFactory` throws "not supported"),
   * so absence is the only fault it could report anyway. It keeps the quiet
   * answer, unchanged.
   *
   * ⛔ That argument is exactly why the RESOLUTION here did NOT move when the
   * classification did (#16013), nor when the composition did (ruling record
   * 6227928430): the shared helpers are handed a decided way to reach the
   * service; whether this host shape may be asked at all is a fact only this
   * seam holds.
   *
   * @returns `undefined` for a host shape with no async registry (no posture
   *   is read), else the read.
   */
  private tenancyServiceResolver(ctx: PluginContext): TenancyServiceResolver | undefined {
    const kernel = ctx.getKernel?.() as
      | { getServiceAsync?: <T>(name: string, scopeId?: string) => Promise<T> }
      | undefined;
    if (!kernel || typeof kernel.getServiceAsync !== 'function') return undefined;
    return () => kernel.getServiceAsync!<TenancyPostureSource>('tenancy');
  }

  /**
   * The posture IN FORCE, read the way this plugin's HTTP door reads it
   * ({@link tenancyServiceResolver}, then the shared classification), for the
   * settings service's own `tenancyPosture` option.
   */
  private async resolveAdmissionTenancyPosture(
    ctx: PluginContext,
  ): Promise<TenancyPosture | undefined> {
    const tenancy = this.tenancyServiceResolver(ctx);
    return tenancy ? classifyAdmissionTenancyPosture(tenancy) : undefined;
  }

  /** Register the configured action handlers of one namespace. */
  private registerActionHandlers(namespace: string): void {
    for (const [id, fn] of Object.entries(this.opts.actionHandlers?.[namespace] ?? {})) {
      this.service!.registerAction(namespace, id, fn);
    }
  }

  /**
   * Offer the held {@link UNWALLED_ONLY_NAMESPACES} manifests, or withhold them
   * for the life of the process, by the posture IN FORCE.
   *
   * Read the way this plugin's door and service read it
   * ({@link resolveAdmissionTenancyPosture}): no `tenancy` service, or a host
   * with no async registry, is a deployment with no wall this plugin can know
   * of, and offers them — the reading every lean kernel has always had. Read
   * once, here: by `kernel:ready` every `init()` has run, so the `tenancy`
   * service and `org-scoping` are as registered as they will ever be.
   *
   * A posture that cannot be read withholds them. Offering a namespace whose
   * values the anonymous runtime-config door would then serve is the one
   * direction a guess must not take; the line says what is missing and why.
   */
  private async offerUnwalledOnlyNamespaces(ctx: PluginContext): Promise<void> {
    if (this.heldUntilPostureKnown.length === 0) return;
    const names = this.heldUntilPostureKnown.map((m) => `'${m.namespace}'`).join(', ');
    let posture: TenancyPosture | undefined;
    try {
      posture = await this.resolveAdmissionTenancyPosture(ctx);
    } catch (err: any) {
      ctx.logger?.warn?.(
        `SettingsServicePlugin: the tenancy posture could not be read (${err?.message ?? err}) — ` +
          `settings namespace(s) ${names} are NOT offered on this boot: they are offered only where no ` +
          'organization wall stands, and that could not be established. The deployment branding ' +
          '(OS_PRODUCT_NAME / OS_LOGO_URL / OS_BRAND_COLOR) still applies.',
      );
      return;
    }
    if (posture !== undefined && postureEnforcesWall(posture)) {
      ctx.logger?.info?.(
        `SettingsServicePlugin: tenancy posture '${posture}' walls organizations apart — settings ` +
          `namespace(s) ${names} are not offered. The deployment branding is the operator's: ` +
          'OS_PRODUCT_NAME / OS_LOGO_URL / OS_BRAND_COLOR.',
      );
      return;
    }
    for (const m of this.heldUntilPostureKnown) {
      this.service!.registerManifest(m);
      this.registerActionHandlers(m.namespace);
    }
    // The Setup entries travel with the namespaces just offered — and only then.
    const items = this.heldUntilPostureKnown
      .map((m) => UNWALLED_ONLY_SETUP_NAV[m.namespace]?.())
      .filter((item): item is Record<string, unknown> => item !== undefined);
    if (items.length === 0) return;
    let manifestService: { register(m: unknown): void } | undefined;
    try {
      manifestService = ctx.getService<{ register(m: unknown): void }>('manifest');
    } catch {
      // No manifest service (lean kernels, tests): no app registry to contribute to.
      return;
    }
    manifestService?.register?.({
      id: UNWALLED_ONLY_SETUP_NAV_BUNDLE_ID,
      namespace: 'sys',
      version: SETTINGS_PLUGIN_VERSION,
      type: 'plugin',
      scope: 'system',
      name: 'Settings Service — Setup entries',
      description: 'Setup navigation for the settings namespaces offered only where no organization wall stands.',
      navigationContributions: [
        // After platform-objects' Configuration entries (priority 100), before
        // later contributors' (service-messaging, 120).
        { app: 'setup', group: 'group_configuration', priority: 110, items },
      ],
    });
  }

  /**
   * Phase 3: build a `sys_secret`-backed implementation of
   * `SettingsSecretStore`. The store bypasses the tenant audit
   * warning because secrets are scoped through their owning
   * `sys_setting` row (which already carries the tenant context).
   *
   * [#21908] Every call carries the explicit system opt-in, as `delete` below
   * already did: `sys_secret` is a platform-owned cipher store, and each
   * call is the settings service acting on its own row after its own
   * capability and lock gates passed. Without it these calls reach the data
   * engine with no principal and no opt-in — the principal-less hand-off
   * ADR-0096 D5 closes — and every encrypted setting would stop reading back
   * once that hand-off denies.
   */
  private buildSecretStore(engine: IDataEngine): SettingsSecretStore {
    const eng: any = engine;
    return {
      async insert(row) {
        await eng.insert('sys_secret', row, { bypassTenantAudit: true, context: { isSystem: true } });
        return { id: row.id };
      },
      async get(id) {
        const rows = await eng.find('sys_secret', {
          where: { id },
          limit: 1,
          bypassTenantAudit: true,
          context: { isSystem: true },
        });
        const row = Array.isArray(rows) ? rows[0] : rows?.data?.[0];
        return row ?? null;
      },
      async update(id, patch) {
        // IDataEngine.update signature is `(object, data, options?)`
        // and extracts the record id from `data.id` (or
        // `options.where.id`). Passing `{ where, data, ... }` as the
        // data argument left id=undefined and tripped
        // "Update requires an ID or options.multi=true".
        //
        // [#21908] Under the opt-in the engine's `readonly` strip no longer
        // runs on this write, so a re-wrap's `ciphertext` (declared
        // `readonly`) is written, which is what this member promises; without
        // a context the strip took it. No caller in this repository reaches
        // `update` today.
        await eng.update(
          'sys_secret',
          { id, ...patch },
          { bypassTenantAudit: true, context: { isSystem: true } },
        );
      },
      async delete(id) {
        // [#8030] The rotated-away ciphertext. By the time this runs the
        // caller has re-read `sys_setting.value_enc` and CONFIRMED it no
        // longer names this handle ([#8262] — it used to infer that), so the
        // row is genuinely unreferenced — see `SettingsService.reapRotatedSecret`
        // for why leaving it is a security problem rather than untidiness, and
        // why the confirmation is not optional.
        //
        // System-elevated for the same reason the settings row update is:
        // `sys_secret` is a platform-owned table and this is the platform
        // deleting its own row, after the caller's write already passed the
        // settings service's capability and lock gates.
        await eng.delete(
          'sys_secret',
          { where: { id }, bypassTenantAudit: true, context: { isSystem: true } },
        );
      },
    };
  }

  /**
   * Phase 3: append-only writer for `sys_setting_audit`.
   * See {@link buildSettingAuditWriter} — this is the plugin-context-bound
   * spelling of it.
   */
  private buildAuditWriter(ctx: PluginContext, engine: IDataEngine): SettingsAuditWriter {
    return buildSettingAuditWriter(engine, ctx.logger as any);
  }
}

/** The settings audit trail's tenant and user rungs (organization NOT NULL). */
export const SETTING_AUDIT_OBJECT = 'sys_setting_audit';

/**
 * The settings audit trail's global rung, with no organization column
 * (ADR-0131 D7, ruling record 6257510973 · Q4 A).
 */
export const PLATFORM_SETTING_AUDIT_OBJECT = 'sys_platform_setting_audit';

/**
 * Which table an audit row of this cascade rung goes to: the global rung's to
 * the deployment-level sibling, the tenant and user rungs' to
 * `sys_setting_audit` — the split `sys_setting` / `sys_platform_setting` makes
 * for the values themselves.
 *
 * An 18.0 install wrote global-rung rows into `sys_setting_audit`; the upgrade
 * ceremony moves them to the sibling before the database is certified, so the
 * global rung's history is the sibling alone, and `sys_setting_audit` declares
 * no `global` scope.
 */
export function settingAuditObjectFor(scope: string): string {
  return scope === 'global' ? PLATFORM_SETTING_AUDIT_OBJECT : SETTING_AUDIT_OBJECT;
}

/**
 * Phase 3: append-only writer for the settings audit trail — `sys_setting_audit`
 * for the tenant and user rungs, `sys_platform_setting_audit` for the global
 * rung ({@link settingAuditObjectFor}). Failures here MUST NOT abort the
 * settings write, so all calls are wrapped in a try/catch and reported through
 * the plugin logger.
 *
 * [#8145] The settings-SHAPED half of the dual write. Its sibling —
 * {@link buildConfigChangeAuditSink} — records the same event on the
 * platform-wide `sys_audit_log` as a `config_change` row. Neither replaces the
 * other: `namespace`/`key`/`scope`/`old_hash`/`new_hash`/`source`/`reason` below
 * have no columns on the generic ledger, and `object_name`/`record_id`/`actor`
 * have none here.
 *
 * Lifted out of the class body (and exported) by the same card, for the same
 * reason `wrapEngineAsSettingsEngine` is: a pin over the DUAL write has to
 * exercise both writers as the plugin builds them. Reconstructing this row shape
 * inside a test would make the test assert against its own copy — the one place
 * a "the existing ledger is unchanged" claim must not be measured.
 */
export function buildSettingAuditWriter(
  engine: IDataEngine,
  // The accept set `main` published (`{ warn? }`), plus a sink that carries
  // `error` — declared REQUIRED on that member, so no shape here makes `error`
  // optional with no channel beside it.
  logger?: { warn?: (message: string) => void } | { error: (message: string) => void; warn?: (message: string) => void },
): SettingsAuditWriter {
  const eng: any = engine;
  // `error` when the host's sink carries it (a durability loss), else `warn`.
  const report = (message: string): void => {
    if (logger && 'error' in logger && typeof logger.error === 'function') logger.error(message);
    else logger?.warn?.(message);
  };
  // The consequence and the fix ride the first failure only (AGENTS.md,
  // degradation log levels); every later lost row is still named, briefly.
  let reportedDurabilityLoss = false;
  return {
    write: async (entry) => {
      try {
        // Under the opt-in below the engine no longer checks that `actor_id`
        // names a user, so the writer keeps that refusal; this `catch` reports
        // it exactly as it reported the engine's (see assertUserReferenceResolves).
        const object = settingAuditObjectFor(entry.scope);
        await assertUserReferenceResolves(
          (id) => eng.findOne(USER_OBJECT, { where: { id }, fields: ['id'] }, { context: { isSystem: true } }),
          {
            object,
            field: 'actor_id',
            label: registeredLabel(eng, { object, field: 'actor_id' }, 'Actor'),
          },
          entry.actorId ?? null,
        );
        const row = {
          namespace: entry.namespace,
          key: entry.key,
          scope: entry.scope,
          action: entry.action,
          source: entry.source ?? 'api',
          actor_id: entry.actorId ?? null,
          old_hash: entry.oldHash ?? null,
          new_hash: entry.newHash ?? null,
          encrypted: !!entry.encrypted,
          request_id: entry.requestId ?? null,
          reason: entry.reason ?? null,
          created_at: new Date().toISOString(),
        };
        // The explicit system opt-in, as the settings row write carries: the
        // settings audit is the platform's own ledger, written after the
        // settings door already authorized the change, and not a write that
        // may rely on a missing principal to pass the security middleware's
        // principal-less hand-off (ADR-0096 D5). One literal object per call
        // site, so each write names the table it lands in.
        if (object === PLATFORM_SETTING_AUDIT_OBJECT) {
          // [ADR-0131 D7] A global value is deployment-level: its row names no
          // organization, in the sibling that has no organization column.
          await eng.insert('sys_platform_setting_audit', row, { bypassTenantAudit: true, context: { isSystem: true } });
        } else {
          // [ADR-0131 D3/D9] The organization whose value changed — the
          // settings row's own owner.
          await eng.insert('sys_setting_audit', {
            ...row,
            ...(entry.organizationId ? { organization_id: entry.organizationId } : {}),
          }, { bypassTenantAudit: true, context: { isSystem: true } });
        }
      } catch (err: any) {
        // A durability loss, not a functional one: the settings write already
        // landed and everything keeps looking normal, while the per-key
        // history row it claims is gone — so `error`, never `warn`.
        const cause = 'SettingsServicePlugin: setting-audit write failed: ' + (err?.message ?? err);
        if (reportedDurabilityLoss) {
          report(cause);
        } else {
          reportedDurabilityLoss = true;
          report(
            cause +
              ' — settings writes keep succeeding, but their settings audit history rows are NOT persisted ' +
              'and nothing retries them. Fix the cause named here (the actor must be a sys_user; the row must ' +
              'carry the organization its setting belongs to).',
          );
        }
      }
    },
  };
}

/**
 * Translate an `IDataEngine` instance into the narrower `SettingsEngine`
 * surface used inside `SettingsService`. The two interfaces diverge on
 * `update`:
 *
 *   - SettingsEngine: `update(object, { where, data, bypassTenantAudit })`
 *   - IDataEngine:    `update(object, data, options?)` — id comes from
 *     `data.id` or `options.where.id`; otherwise the engine throws
 *     "Update requires an ID or options.multi=true".
 *
 * The adapter resolves the row id from `where.id` when present and
 * forwards everything in IDataEngine's positional form. When the caller
 * supplies a non-id where clause (composite-key tables), we fall back
 * to `multi: true` so the engine routes through `driver.updateMany`
 * instead of throwing.
 *
 * ### `context` is load-bearing, on BOTH branches (#8030)
 *
 * `SettingsService` sends `{ isSystem: true }` with its row writes because
 * `sys_setting.value_enc` / `updated_by` are declared `readonly: true` and the
 * engine strips author-declared read-only columns from a NON-system caller's
 * UPDATE payload. This adapter is the only thing between that declaration and
 * the engine, so a branch that forgets to forward `options.context` restores
 * the defect in full: the rotation writes a new `sys_secret` row, answers 200
 * with a redacted echo, advances `updated_at` — and leaves `value_enc` on the
 * OLD handle, so the credential the admin just rotated away is still live.
 *
 * Both branches forward it, and the settings row write in practice takes the
 * `multi` one (its `where` is the composite `(namespace, key, scope, user_id)`,
 * never an `id`) — so the by-id branch is the one that would rot unnoticed.
 * Exported for that reason: `settings-secret-rotation.test.ts` drives the real
 * engine through this adapter on both.
 */
export function wrapEngineAsSettingsEngine(engine: IDataEngine): SettingsEngine {
  const eng: any = engine;
  return {
    async find(objectName, opts) {
      return eng.find(objectName, opts);
    },
    async insert(objectName, data, opts) {
      return eng.insert(objectName, data, opts);
    },
    async update(objectName, opts) {
      const { where, data, bypassTenantAudit, context } = opts as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
        bypassTenantAudit?: boolean;
        context?: Record<string, unknown>;
      };
      const driverOpts = {
        ...(bypassTenantAudit ? { bypassTenantAudit: true } : {}),
        ...(context ? { context } : {}),
      };
      const id = (where as any)?.id;
      if (id !== undefined && id !== null) {
        // [#11231] The operation's id AFTER the spread, so it WINS — the same
        // convention as `rest-server.ts`'s batch arm and `protocol.updateData`
        // (#6479). This branch passes no `where` to the engine, so the payload
        // is the only id the engine sees and its conflicting-id refusal
        // (`UPDATE_ID_MISMATCH`) has nothing to compare against: a
        // caller-supplied `data.id` spread over the resolved id would retarget
        // the write silently. Do not flip this back to `{ id, ...data }`.
        return eng.update(objectName, { ...data, id }, driverOpts);
      }
      return eng.update(objectName, data, {
        where,
        multi: true,
        ...driverOpts,
      });
    },
  };
}
