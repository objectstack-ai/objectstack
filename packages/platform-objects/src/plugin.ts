// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SetupAppTranslations } from './apps/translations/index.js';
import { MetadataFormsTranslations } from './metadata-translations/index.js';
import { SysMetadataActivation } from './system/sys-metadata-activation.object.js';
import { SysMigration } from './system/sys-migration.object.js';
import { SysMigrationJournal } from './system/sys-migration-journal.object.js';
import { SysSecret } from './system/sys-secret.object.js';
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
 *    service no longer names this object in its own manifest: two manifests
 *    registering one object is a governed contributor question (ADR-0029
 *    D7), and the ruling closed it by giving the ledger one owner rather
 *    than by measuring whether a double registration is benign.
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
 *    them. Loaded on `kernel:ready` so the i18n service plugin (which may
 *    register later than ordinary services) is guaranteed to be present.
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
        objects: [SysMigration, SysMigrationJournal, SysSecret, SysMetadataActivation],
      });
    } catch {
      // No manifest service (lean / i18n-only kernels) — the ledger stays
      // unregistered (every flag reader answers "not verified"), the secret
      // store stays unregistered (secret-field writes fail closed), and the
      // activation ledger stays unregistered (every enable/disable door
      // refuses loudly with 503 rather than keeping a bit that reverts).
    }
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

    ctx?.hook?.('kernel:ready', async () => {
      let i18n: II18nService | undefined;
      try {
        i18n = ctx.getService?.('i18n');
      } catch {
        return;
      }
      if (!i18n || typeof i18n.loadTranslations !== 'function') return;

      const bundles: Array<[string, Record<string, unknown>]> = [
        ['Setup', SetupAppTranslations as unknown as Record<string, unknown>],
        ['MetadataForms', MetadataFormsTranslations as unknown as Record<string, unknown>],
      ];

      let loaded = 0;
      for (const [bundleName, bundle] of bundles) {
        for (const [locale, data] of Object.entries(bundle)) {
          if (!data || typeof data !== 'object') continue;
          try {
            i18n.loadTranslations(locale, data as Record<string, unknown>);
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
    });
  }
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
        `flag on a real scan (ADR-0104, #4795).`,
    );
    return;
  }
  ctx?.logger?.info?.(
    `[platform-objects] fresh-datastore attestation deferred at kernel:ready: ${seed.inFlight} seed ` +
      `source(s) still writing (an inline seed overran OS_INLINE_SEED_BUDGET_MS and continues in the ` +
      `background). Attesting now would flip this boot to strict half-way through its own seed run. ` +
      `It runs on \`app:seeded\` once the seed settles (ADR-0104, #4795).`,
  );
}

/** Convenience factory mirroring the rest of the plugin ecosystem. */
export function createPlatformObjectsPlugin(): PlatformObjectsPlugin {
  return new PlatformObjectsPlugin();
}
