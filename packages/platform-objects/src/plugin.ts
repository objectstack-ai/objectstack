// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SetupAppTranslations } from './apps/translations/index.js';
import { MetadataFormsTranslations } from './metadata-translations/index.js';
import { SysMigration } from './system/sys-migration.object.js';
import { SysMigrationJournal } from './system/sys-migration-journal.object.js';
import { SysSecret } from './system/sys-secret.object.js';
import { attestFreshDatastore } from './system/migration-flag.js';
import type { II18nService, IObjectQLEngine } from '@objectstack/spec/contracts';


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
 *  - **Fresh-datastore attestation** (#3438, ADR-0104 2026-07-30) —
 *    travels with the ledger registration: a store this boot created from
 *    empty is attested once that boot's own data has settled
 *    (`app:seeded`, falling back to `kernel:ready` for kernels that never
 *    seed), whichever services are composed. Not before: emptiness settles
 *    a claim about CONTENT, and a boot that certifies itself and then seeds
 *    rows contradicting the certificate leaves every later boot enforcing
 *    it against data this one wrote (#4769).
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
        objects: [SysMigration, SysMigrationJournal, SysSecret],
      });
    } catch {
      // No manifest service (lean / i18n-only kernels) — the ledger stays
      // unregistered (every flag reader answers "not verified") and the
      // secret store stays unregistered (secret-field writes fail closed).
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
    const attest = async () => {
      let engine: IObjectQLEngine | undefined;
      try {
        engine = ctx.getService?.('objectql');
      } catch {
        return;
      }
      if (!engine || typeof engine.wasDatastoreCreatedFromEmpty !== 'function') return;
      try {
        if (engine.wasDatastoreCreatedFromEmpty()) {
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
    ctx?.hook?.('app:seeded', attest);
    ctx?.hook?.('kernel:ready', attest);

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

/** Convenience factory mirroring the rest of the plugin ecosystem. */
export function createPlatformObjectsPlugin(): PlatformObjectsPlugin {
  return new PlatformObjectsPlugin();
}
