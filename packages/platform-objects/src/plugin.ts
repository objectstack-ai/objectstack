// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SetupAppTranslations } from './apps/translations/index.js';
import { MetadataFormsTranslations } from './metadata-translations/index.js';
import { SysMetadataActivation } from './system/sys-metadata-activation.object.js';
import { SysMigration } from './system/sys-migration.object.js';
import { SysMigrationJournal } from './system/sys-migration-journal.object.js';
import { SysSecret } from './system/sys-secret.object.js';
import { SysExchangeRate } from './system/sys-exchange-rate.object.js';
import { SysTrustedKey } from './system/sys-trusted-key.object.js';
import { attestFreshDatastore } from './system/migration-flag.js';
import type {
  II18nService,
  IObjectQLEngine,
  ISeedSettlementService,
  SeedSettlementSnapshot,
} from '@objectstack/spec/contracts';
import { SEED_SETTLEMENT_SERVICE } from '@objectstack/spec/contracts';


/**
 * `PlatformObjectsPlugin`
 *
 * Owns the runtime contribution of platform infrastructure that must exist
 * on every assembled kernel, independent of which optional services are
 * composed:
 *
 *  - **`sys_migration`** — the deployment-level data-migration flag ledger
 *    (#3617). Registered here rather than by a consuming service because
 *    its consumers span domains (#4243): the storage service's released-
 *    file collection, the engine's strict value-shape gates (#3438/#4235)
 *    and the migration CLI all read the same ledger, and none of them
 *    should have to drag an unrelated service into the boot to find it.
 *  - **`sys_migration_journal`** — the per-RUN crash-recovery trace
 *    (ADR-0119 D2, #4617). Distinct from the flag ledger above in grain
 *    and purpose: that one records the durable verdict for a named
 *    migration, this one records what happened inside a single run, so a
 *    restarted process can tell whether chunk 7 committed. Registered
 *    unconditionally alongside it because recovery must be discoverable
 *    with ZERO host wiring — a journal composed by some kernels and not
 *    others is ADR-0078's silently-inert failure in another costume.
 *  - **`sys_secret`** — the environment's encrypted-secret store
 *    (ADR-0066 D2/④). Same shape as the ledger, sharper stakes (#4270):
 *    its producers span domains — the settings service's encrypted
 *    specifiers, the engine's own `secret`-field encryption
 *    (`encryptSecretFields`/`resolveSecret`, a generic write path any
 *    business object with a `Field.secret()` hits), and the datasource
 *    credential binder — and the engine is fail-CLOSED about it: writing
 *    a secret field with no reachable `sys_secret` store throws. While
 *    service-settings registered it, a kernel composed without settings
 *    hard-failed every secret-field write with an error that blamed
 *    platform-objects. Registered here, that error message is true.
 *  - **`sys_trusted_key`** — the environment's trusted plugin-publisher
 *    PUBLIC keys (ADR-0025 §3.5 M1). Its readers span domains: the CLI's
 *    `os plugin install` resolves an artifact signature's key id here today,
 *    and ADR-0025 M1's boot-time plugin loader in the runtime is the second
 *    reader (not built yet). No capability plugin owns plugin distribution,
 *    so it rides with the other platform infrastructure (ADR-0029 D1/D2).
 *  - **`sys_metadata_activation`** — the packaged-metadata activation
 *    ledger (ADR-0126 §4). Same story a third time, and the ruling that
 *    moved it here is recorded verbatim on #12359 (maintainer, 2026-08-26,
 *    「同意」): registration follows the DECLARATION. Until then the only
 *    registrant was the automation service's manifest, because flows were
 *    the ledger's first and only consumer; the moment packaged ACTIONS
 *    became the second, the consult and write path moved to the ObjectQL
 *    engine — present in every composition that can execute an action —
 *    while the object it needs was still gated on an unrelated service.
 *    Measured cost of that gap: a `bootStack(showcaseStack)` boot (actions,
 *    no automation service) answered the activation door 503
 *    SERVICE_UNAVAILABLE, correctly but permanently. Registered here, every
 *    composition carrying platform-objects has the ledger, so packaged
 *    disable works without the automation service and each future ADR-0126
 *    §8 consumer (`tool`, `skill`, `position`) inherits it.
 *
 *    ⚠️ MOVE, not add — **single owner, one registration**. The automation
 *    service no longer names this object in its own manifest. The triage that
 *    raised #12359 left "is a double registration benign?" unmeasured; it is
 *    measured now, and it is NOT: `SchemaRegistry.registerObject` throws
 *    `Object "sys_metadata_activation" is already owned by package
 *    "com.objectstack.service-automation"` the moment a second code package
 *    claims the same name (ADR-0029 D3's single-owner invariant, D7's
 *    contributor kinds). Adding a registrant would have been a boot failure,
 *    not a duplicate — so MOVE was the only shape available, whichever way
 *    the ownership question was answered.
 *
 *    ⚠️ It rides its OWN manifest, not the one above, and that is a
 *    smooth-upgrade requirement rather than tidiness — see
 *    {@link ACTIVATION_LEDGER_MANIFEST}.
 *  - **`sys_exchange_rate`** — the organization's dated exchange rates
 *    (multi-currency M1-1, epic #8345, ruling 6465431966). Its one reader is
 *    the ObjectQL engine's write-time home-currency projection — present in
 *    every composition that can write a record — so it registers with the
 *    engine-facing infrastructure above, not with an optional service. Rides
 *    the first manifest (the project database), like every per-organization
 *    table here.
 *  - **Fresh-datastore attestation** (#3438, ADR-0104 2026-07-30) —
 *    travels with the ledger registration: a store this boot created from
 *    empty is attested once that boot's own data has settled
 *    (`app:seeded`, falling back to `kernel:ready` for kernels that never
 *    seed), whichever services are composed. Not before: emptiness settles
 *    a claim about CONTENT, and a boot that certifies itself and then seeds
 *    rows contradicting the certificate leaves every later boot enforcing
 *    it against data this one wrote (#4769). The `kernel:ready` fallback
 *    additionally asks the `seed-settlement` contract whether a seed is
 *    still in flight, so an over-budget background seed is waited out
 *    rather than certified over (#4795).
 *  - **Translation bundles** — `SetupAppTranslations` (the static Setup
 *    App + sys_* dashboards) and `MetadataFormsTranslations`
 *    (`metadataForms.*` for object/field/agent/flow/view configuration
 *    forms). Replaces the historical detour of piggy-backing on
 *    `plugin-auth` — translations belong with the package that defines
 *    them. Loaded UNDER what is already loaded, so a host's bundle for a
 *    platform key wins in either boot order: in `start()` when an i18n
 *    service exists by then, else on `kernel:ready` (an `AppPlugin` on a
 *    lean kernel registers its in-memory fallback during its own `start()`).
 *    See `contributeTranslations`.
 *
 * Gracefully degrades on lean kernels: without a manifest service the
 * ledger is simply absent — every flag reader answers "not verified", the
 * safe posture — secret-field writes fail closed (throw, never cleartext),
 * and without an i18n service the UI falls back to the inline literals
 * carried on each App / Dashboard / `*.form.ts` schema.
 *
 * Structurally typed against `@objectstack/core`'s `Plugin` contract so
 * this package does not need to depend on the kernel at compile time.
 */
/**
 * [#12359 / ADR-0126 §4] The manifest the activation ledger is registered
 * under — this plugin's, but SEPARATE from the one carrying `sys_migration` /
 * `sys_migration_journal` / `sys_secret` / `sys_trusted_key`, and carrying the
 * automation manifest's `scope` / `namespace` / `defaultDatasource` triple verbatim.
 *
 * ## Why a second manifest rather than a fourth entry in the first one
 *
 * Because a manifest is not only a list of objects — it is also a ROUTING
 * decision, and #12359's ruling was about registration, not about where the
 * rows live. `ObjectQL.resolveDatasourceBinding` step 4 routes an object by
 * its OWNING PACKAGE's `defaultDatasource`, so the registrar carries the
 * table's datasource with it. Measured on a real engine holding a default
 * driver plus one named `cloud`, registering the same object definition under
 * each manifest in turn:
 *
 *     owner com.objectstack.service-automation (defaultDatasource: 'cloud')
 *       -> resolveEffectiveDatasource('sys_metadata_activation') === 'cloud'
 *     owner com.objectstack.platform-objects  (no defaultDatasource)
 *       -> resolveEffectiveDatasource('sys_metadata_activation') === undefined
 *          (i.e. rides the global default driver — a DIFFERENT database)
 *
 * The ledger table already exists in live databases. On any deployment that
 * registers a datasource named `cloud`, folding the object into the manifest
 * above would leave its rows in one database and start reading the other:
 * every artifact an administrator had switched off would silently re-arm,
 * which is precisely the failure ADR-0126 §6 wall 3 exists to close, arriving
 * through a door nobody was watching. So the routing is carried across
 * unchanged and the move is a no-op for existing data — the smooth-upgrade
 * wall this card was given, discharged by preserving the status quo rather
 * than by asserting it.
 *
 * ⛔ The siblings are deliberately NOT given this triple. They ride the
 * project database today and moving them is a different, larger question.
 * ⛔ And it is NOT spelled as `datasource: 'cloud'` on the object itself: that
 * is binding step 1, which answers even when no such driver is registered, so
 * `getDriver` would throw `Datasource 'cloud' … is not registered` on every
 * deployment that has no control plane. Step 4 is conditional on the driver
 * existing, which is exactly the behaviour this object has today.
 *
 * ⚠️ Which datasource this ledger SHOULD live on is a real question and this
 * constant does not answer it — it only refuses to answer it by accident. A
 * card that wants to move it must move the rows too.
 */
const ACTIVATION_LEDGER_MANIFEST = {
  id: 'com.objectstack.platform-objects.activation-ledger',
  name: 'Packaged-Metadata Activation Ledger',
  version: '1.0.0',
  type: 'plugin',
  // The same three the automation service's manifest carried. `scope: 'system'`
  // packages are documented as also setting `defaultDatasource: 'cloud'`
  // (`manifest.zod.ts`), and this one does — which is the whole point.
  scope: 'system',
  defaultDatasource: 'cloud',
  namespace: 'sys',
} as const;

export class PlatformObjectsPlugin {
  readonly name = 'com.objectstack.platform-objects';
  readonly type = 'standard';
  readonly version = '1.0.0';
  readonly dependencies: string[] = [];
  /**
   * The manifest service consumed in `init()` is registered by ObjectQL's
   * init. Optional, not required: hoisted after it when both are composed,
   * still bootable without it (translations-only kernels).
   */
  readonly optionalDependencies: string[] = ['com.objectstack.engine.objectql'];

  async init(ctx: any): Promise<void> {
    // Register the platform-infrastructure objects via the manifest service.
    try {
      ctx?.getService?.('manifest')?.register?.({
        id: this.name,
        name: 'Platform Objects',
        version: this.version,
        type: 'plugin',
        scope: 'system',
        objects: [SysMigration, SysMigrationJournal, SysSecret, SysExchangeRate, SysTrustedKey],
      });
      ctx?.getService?.('manifest')?.register?.({
        ...ACTIVATION_LEDGER_MANIFEST,
        objects: [SysMetadataActivation],
      });
    } catch {
      // No manifest service (lean / i18n-only kernels) — the ledger stays
      // unregistered (every flag reader answers "not verified"), the secret
      // store stays unregistered (secret-field writes fail closed), and the
      // activation ledger stays unregistered (every enable/disable door
      // refuses loudly with 503 rather than keeping a bit that reverts).
    }

    // The translation backstop for a kernel with no i18n service yet at this
    // plugin's `start()`. Registered here, not in `start()`, so it runs ahead of
    // the authored-translation sync hooks of the plugins ordered after this one
    // (see `contributeTranslations`). A no-op when `start()` already loaded.
    ctx?.hook?.('kernel:ready', () => this.contributeTranslations(ctx));
  }

  async start(ctx: any): Promise<void> {
    // ── Fresh-datastore attestation (#3438, ADR-0104 2026-07-30) ────────
    // A store this process just created from empty can hold no legacy
    // value, so the data migrations that exist to find and convert them
    // are settled here before they are ever run — recorded while that
    // emptiness is still an observed fact rather than something a later
    // scan would have to infer. Without it every new deployment would
    // start lax and stay lax until someone ran a command that, for them,
    // does nothing: the warn regime would never die out.
    //
    // Timing is load-bearing (#4769): the inference is "empty, therefore
    // nothing here violates", and it stops holding the moment this boot
    // writes. So the attestation waits for the boot's own data, and
    // `attestFreshDatastore` refuses any id this boot has already
    // contradicted.
    //
    // This plugin owns the call because it registers `sys_migration`
    // (above; #4243 — moved here with the registration from
    // service-storage). A store that was found rather than created attests
    // nothing and keeps producing evidence by scan.
    // #4795 — "has this boot's own seed finished landing?", asked through the
    // published `seed-settlement` contract rather than by sniffing the
    // runtime's internal `seed-datasets` service. That array's presence says a
    // seed source EXISTS; it can never say whether it has SETTLED, and the gap
    // between those two facts IS the bug. An absent service means no seed
    // pipeline registered on this kernel — a fact by `kernel:ready`, since
    // every source is declared in Phase 2 `start()`.
    const readSeedSettlement = (): SeedSettlementSnapshot | undefined => {
      try {
        const svc = ctx.getService?.(SEED_SETTLEMENT_SERVICE) as
          | ISeedSettlementService
          | undefined;
        if (!svc || typeof svc.snapshot !== 'function') return undefined;
        return svc.snapshot();
      } catch {
        return undefined;
      }
    };

    const attest = async (phase: 'app:seeded' | 'kernel:ready') => {
      let engine: IObjectQLEngine | undefined;
      try {
        engine = ctx.getService?.('objectql');
      } catch {
        return;
      }
      if (!engine || typeof engine.wasDatastoreCreatedFromEmpty !== 'function') return;
      try {
        if (engine.wasDatastoreCreatedFromEmpty()) {
          // Asked AFTER the created-from-empty check on purpose: a store that
          // was found rather than created attests nothing either way, and
          // announcing a deferral there would be noise about a decision that
          // was never going to be made.
          const seed = readSeedSettlement();
          if (seed && seed.pending > 0) {
            if (phase === 'kernel:ready') reportDeferral(ctx, seed);
            return;
          }
          await attestFreshDatastore(engine, { logger: ctx.logger });
          // The engine memoizes the flag read on first use; this write
          // may already have raced it on a fast boot.
          engine.invalidateDataMigrationFlags?.();
        }
      } catch (err: any) {
        // Bookkeeping must never break a new deployment's boot. Not
        // attesting only leaves it lax — recoverable by running the
        // migration, which for an empty store is a no-op that passes.
        ctx?.logger?.warn?.(
          `[platform-objects] fresh-datastore attestation skipped (${err?.message ?? err})`,
        );
      }
    };

    // #4769 — run it as soon as the boot's own data has settled, and not
    // before. `app:seeded` is that moment for a deployment that seeds: it
    // fires when the inline seed finishes, including the background
    // continuation of one that overran `OS_INLINE_SEED_BUDGET_MS`. Attesting
    // ahead of it certified a store as clean and then filled it with the rows
    // that disprove the certificate, which the NEXT boot enforced against.
    // `kernel:ready` stays as the backstop for every kernel that never seeds
    // (it is the same moment as before for those). Both land in the same
    // idempotent call: the first one to find an id unattested and
    // uncontradicted writes it, the other finds the row and skips.
    //
    // #4795 — subscribing to both is necessary but not sufficient, because the
    // two can arrive in EITHER order. When the inline seed overruns its budget
    // the runtime hands it to the background and `kernel:ready` arrives first,
    // so the backstop fired mid-seed: it certified the store, flipped the gates
    // to strict, and the tail of the same seed run met a contract its head had
    // never seen — one boot, two contracts. Measured on a showcase cold boot at
    // `OS_INLINE_SEED_BUDGET_MS=1`: attestation +0.470s, seed settled +3.617s.
    // Neither hook may certify while the pipeline reports work outstanding, so
    // the settlement check lives inside `attest` and guards both — `app:seeded`
    // included, since a bundle with several config apps fires it once per app
    // and the first one is not the last.
    ctx?.hook?.('app:seeded', () => attest('app:seeded'));
    ctx?.hook?.('kernel:ready', () => attest('kernel:ready'));

    // Platform translation bundles: here, as soon as an i18n service exists.
    // `init()` registered the `kernel:ready` backstop for a kernel whose i18n
    // service only appears later in Phase 2.
    this.contributeTranslations(ctx);
  }

  /**
   * The i18n service instance the platform bundles were loaded into, so the
   * `kernel:ready` backstop loads them once per instance, never twice.
   */
  private translationsLoadedInto: II18nService | undefined;

  /**
   * Load the platform translation bundles UNDER whatever is already loaded
   * for each locale, so a host's bundle for a platform key wins in either
   * boot order — the precedence `content/docs/ui/translations.mdx` publishes
   * ("yours would override the platform's"). A bundle loaded later wins by
   * the service's own deep merge (last writer); one loaded earlier wins
   * because {@link layUnder} hands it back on top of the platform's.
   *
   * ## Why `start()` first, with `kernel:ready` only as a backstop
   *
   * The read that makes "under" possible is `II18nService.getTranslations`,
   * and both real providers answer it with the runtime-AUTHORED overlay
   * (Studio `translation` items) merged over the bundles. That overlay is
   * synced at `kernel:ready`, by a hook `AppPlugin` registers in `init()` —
   * ahead of every hook registered in `start()`. Read after it, the overlay's
   * values would be written into the bundle layer, and a deleted Studio
   * override of a platform key would keep serving the deleted text until the
   * next restart. Read in `start()`, no sync has run yet. The backstop hook is
   * registered in `init()` for the same reason: it then runs ahead of the
   * sync hooks of every plugin ordered after this one.
   */
  private contributeTranslations(ctx: any): void {
    let i18n: II18nService | undefined;
    try {
      i18n = ctx.getService?.('i18n');
    } catch {
      return;
    }
    if (!i18n || typeof i18n.loadTranslations !== 'function') return;
    if (this.translationsLoadedInto === i18n) return;
    this.translationsLoadedInto = i18n;

    // `getTranslations` is on the contract. A provider without it still gets
    // the platform bundles, loaded the old way: over whatever is there.
    const canLayUnder = typeof i18n.getTranslations === 'function';
    if (!canLayUnder) {
      ctx?.logger?.warn?.(
        '[platform-objects] the i18n service has no getTranslations(locale), so the platform ' +
          'translation bundles were loaded OVER any bundle already registered: a host bundle ' +
          'loaded before this point does not override the platform text it repeats. Implement ' +
          'getTranslations (II18nService) on the provider to restore that precedence.',
      );
    }

    const bundles: Array<[string, Record<string, unknown>]> = [
      ['Setup', SetupAppTranslations as unknown as Record<string, unknown>],
      ['MetadataForms', MetadataFormsTranslations as unknown as Record<string, unknown>],
    ];

    let loaded = 0;
    for (const [bundleName, bundle] of bundles) {
      for (const [locale, data] of Object.entries(bundle)) {
        if (!data || typeof data !== 'object') continue;
        try {
          const platform = data as Record<string, unknown>;
          i18n.loadTranslations(
            locale,
            canLayUnder ? layUnder(platform, readLoaded(i18n, locale)) : platform,
          );
          loaded++;
        } catch (err: any) {
          ctx?.logger?.warn?.(
            `[platform-objects] failed to load ${bundleName} translations for '${locale}': ${
              err?.message ?? err
            }`,
          );
        }
      }
    }

    if (loaded > 0) {
      ctx?.logger?.info?.(
        `[platform-objects] contributed platform translations (${loaded} locale entries)`,
      );
    }
  }
}

/** What the i18n service holds for `locale` now; empty when it cannot say. */
function readLoaded(i18n: II18nService, locale: string): Record<string, unknown> {
  try {
    const loaded = i18n.getTranslations(locale);
    return isPlainRecord(loaded) ? loaded : {};
  } catch {
    // Unreadable reads as nothing loaded: the platform bundle still lands.
    return {};
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The platform bundle with every leaf the service already holds laid back on
 * top — what to hand `loadTranslations` so the platform text goes UNDER it.
 *
 * Walks the platform bundle's own keys only: a key outside it is untouched by
 * the service's deep merge anyway, so nothing is copied that the load would
 * not reach. Where both sides hold an object it recurses, so a host label
 * deep inside `objects.<name>.fields` wins and its platform siblings still
 * land; anywhere else the loaded value is handed back as it is — a string
 * over a platform subtree, or a subtree over a platform string — so the load
 * never replaces or deletes a key the host shipped. Arrays are values, as in
 * the providers' own merge. Neither input is mutated.
 */
function layUnder(
  platform: Record<string, unknown>,
  loaded: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, platformValue] of Object.entries(platform)) {
    const loadedValue = loaded[key];
    if (isPlainRecord(platformValue) && isPlainRecord(loadedValue)) {
      out[key] = layUnder(platformValue, loadedValue);
    } else {
      out[key] = loadedValue === undefined ? platformValue : loadedValue;
    }
  }
  return out;
}

/**
 * Say, once, why `kernel:ready` did not attest — and what closes the gate.
 *
 * ## The ADR-0104 posture for deployments that never settle a boot seed (#4795)
 *
 * Two shapes register seed datasets and deliberately do not run them at boot,
 * so `app:seeded` never fires and the tally stays pending for the life of the
 * process: **multi-tenant** (seeds replay per organization on
 * `sys_organization` insert) and **`skipSeedData`** (an `os migrate` planning
 * boot that must not write to the target database at all, #3917).
 *
 * Their posture is **do not self-certify at boot; wait for `os migrate`** —
 * ruled 2026-08-06 and recorded on #4795. It is not a gap this check leaves
 * behind, it is the answer:
 *
 *  - the fresh-datastore attestation infers "created empty, therefore no
 *    legacy value can exist". On a multi-tenant deployment the rows that
 *    inference is about have not been written yet — they land org by org,
 *    later. Certifying at startup that a replay which has not happened holds
 *    no violating value is exactly #4769's error with a longer fuse;
 *  - a `skipSeedData` boot writes nothing, so it observes nothing, so it has
 *    no evidence to certify from;
 *  - standing down is the *recoverable* direction. The deployment stays
 *    warn-first — true, and closable at any time by `os migrate value-shapes
 *    --apply` / `os migrate files-to-references --apply`, which record the flag
 *    on a real scan of what the store actually holds. The opposite error is not
 *    recoverable in the same way: a certificate issued over rows nobody looked
 *    at is enforced by every later boot against data it never examined.
 *
 * Logged at `info`, not `warn`. This is a functional posture, not a durability
 * degradation: nothing claims to have persisted and failed, and the gate that
 * stays open is the lenient one. A `warn` on every boot of every multi-tenant
 * deployment for behaviour that is correct by design is precisely what trains
 * operators to skim the level that matters (AGENTS.md, degradation log levels).
 */
function reportDeferral(ctx: any, seed: SeedSettlementSnapshot): void {
  if (seed.suppressed.length > 0) {
    const reasons = [...new Set(seed.suppressed)].join(', ');
    ctx?.logger?.info?.(
      `[platform-objects] not attesting this fresh datastore at boot: seed data is registered but ` +
        `this boot does not write it (${reasons}). Multi-tenant deployments replay seeds per org on ` +
        `sys_organization insert, and a skipSeedData boot writes nothing at all — so nothing observed ` +
        `now could prove or disprove the claim. The deployment stays warn-first until ` +
        `\`os migrate value-shapes --apply\` / \`os migrate files-to-references --apply\` records the ` +
        `flag on a real scan (ADR-0104).`,
    );
    return;
  }
  ctx?.logger?.info?.(
    `[platform-objects] fresh-datastore attestation deferred at kernel:ready: ${seed.inFlight} seed ` +
      `source(s) still writing (an inline seed overran OS_INLINE_SEED_BUDGET_MS and continues in the ` +
      `background). Attesting now would flip this boot to strict half-way through its own seed run. ` +
      `It runs on \`app:seeded\` once the seed settles (ADR-0104).`,
  );
}

/** Convenience factory mirroring the rest of the plugin ecosystem. */
export function createPlatformObjectsPlugin(): PlatformObjectsPlugin {
  return new PlatformObjectsPlugin();
}
