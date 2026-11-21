// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 plan step 6] The two boot-time answers that land with the switch,
 * the moment the sharing service starts writing the share-grant leaf
 * (`SharedRecordIds`) into every sharing-scoped read.
 *
 *  - **R1 at boot, the host class (② ruled).** A host that registers an
 *    object-scoped middleware, or a `beforeFind` / `afterFind` hook, for
 *    `sys_record_share` BY NAME is in D4's second class: today's grant read
 *    ran that registration, and the leaf's subquery would read around it. The
 *    engine seam never reads around it, so every sharing-scoped read on such a
 *    host would fail with 500; the boot is refused instead, naming the
 *    registration, before any request is served. The class is kept whole:
 *    there is no exemption for a registration that skips system reads. A
 *    registration that names no object, or `'*'`, is outside the class (D4's
 *    boundary): nothing here refuses, reports or logs it, and the changeset
 *    tells the host. A registration made after boot meets the seam's refusal
 *    at read. The recognition is the engine's own
 *    (`IObjectQLEngine.fixedReadLeafClassOf`), ⛔ never restated here.
 *  - **R2's report, the storage rows (② ruled).** On an object whose storage
 *    cannot evaluate the leaf (`SharingService.shareGrantsInertReason`), share
 *    grants stop counting at the switch. ADR-0111 D10 asks that tightening to
 *    fail closed with a visible trail: the boot names, at `warn`, every such
 *    object that holds `sys_record_share` rows, with the reason. It never
 *    fails the boot.
 */

import { SharedRecordIds } from '@objectstack/spec/data';
import type { EngineFixedReadLeafClass } from '@objectstack/spec/contracts';
import { fixedReadLeafRefusal, type FixedReadLeafRefusalError } from '@objectstack/core';
import type { SharingService } from './sharing-service.js';

/** The table the share-grant leaf reads; the host class is recognised for it. */
const SHARE_TABLE = 'sys_record_share';

/**
 * The recipient of the leaf the boot check builds only to ask the engine's
 * recognition: it reads the leaf's object and table, never its recipient, and
 * the leaf is handed to no evaluator.
 */
const BOOT_CHECK_PROBE_RECIPIENT = 'share-arm-boot-probe';

/** What the boot check reads off the engine. */
export interface ShareArmBootEngine {
  fixedReadLeafClassOf?(leaf: SharedRecordIds): EngineFixedReadLeafClass | null;
}

/** The boot log both answers write to. */
export interface ShareArmBootLog {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * [ADR-0155 ② ruled R1 at boot] The refusal a host in D4's second class gets
 * at boot, or `undefined` when it is not in it.
 *
 * Asked with a leaf whose object IS the share table, so the first class
 * (another datasource) can never answer in place of the second. An engine
 * without the recognition, or one whose recognition throws, cannot say: that
 * is logged once at `warn` and the boot goes on, with the seam's own refusal
 * at read behind it.
 *
 * The refusal is D4's envelope, `INTERNAL_ERROR` / 500 (`@objectstack/core`'s
 * `fixedReadLeafRefusal`): the fault is the host's composition, never a
 * request's.
 */
export function shareGrantRegistrationRefusal(
  engine: ShareArmBootEngine | undefined,
  log?: ShareArmBootLog,
): FixedReadLeafRefusalError | undefined {
  if (!engine || typeof engine.fixedReadLeafClassOf !== 'function') {
    log?.warn?.(
      'SharingServicePlugin: the engine cannot say whether this host registers a middleware or a find hook for '
        + `'${SHARE_TABLE}' by name (it has no fixedReadLeafClassOf), so the boot check for that registration did `
        + 'not run; such a registration is refused at read by the engine seam instead (ADR-0155 D4)',
    );
    return undefined;
  }
  let recognised: EngineFixedReadLeafClass | null;
  try {
    recognised = engine.fixedReadLeafClassOf(SharedRecordIds.read(SHARE_TABLE, BOOT_CHECK_PROBE_RECIPIENT));
  } catch (err) {
    log?.warn?.(
      `SharingServicePlugin: the engine's recognition of a registration for '${SHARE_TABLE}' by name failed, so `
        + 'the boot check for it did not run; such a registration is refused at read by the engine seam instead '
        + '(ADR-0155 D4)',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return undefined;
  }
  if (recognised?.class !== 'registration-by-name') return undefined;
  return fixedReadLeafRefusal(
    'plugin-sharing',
    `the host carries ${recognised.registration}, which a read of '${recognised.table}' runs and the share-grant `
      + 'subquery every sharing-scoped read now carries would read around (ADR-0155 D4). The engine never reads '
      + 'around it, so every such read would fail; the boot is refused before any request is served. Remove that '
      + `registration for '${recognised.table}'. A host that opted '${recognised.table}' into record-view auditing `
      + 'gives up that auditing of share rows by removing it. A registration that names no object, or \'*\', is not '
      + 'refused.',
  );
}

/** One object whose share grants stopped counting and that holds share rows. */
export interface InertShareGrantHolder {
  readonly object: string;
  readonly reason: string;
}

/**
 * [ADR-0155 ② ruled R2] Name, at `warn`, every object whose share grants
 * stopped counting at the switch and that holds `sys_record_share` rows.
 * Returns what it named. Silent when there is none, which on a host whose
 * objects all live with `sys_record_share` on a SQL driver costs no read.
 */
export async function reportInertShareGrantHolders(
  sharing: Pick<SharingService, 'inertShareGrantHolders'>,
  objects: readonly string[],
  log?: ShareArmBootLog,
): Promise<InertShareGrantHolder[]> {
  const holders = await sharing.inertShareGrantHolders(objects);
  if (holders.length === 0) return holders;
  log?.warn?.(
    `SharingServicePlugin: share grants no longer count on ${holders.length} object(s) that hold `
      + `'${SHARE_TABLE}' rows, because their storage does not evaluate the share-grant subquery (ADR-0155 R2): `
      + `${holders.map((h) => `'${h.object}'`).join(', ')}. Owner, queue and approval access on them is unchanged; `
      + 'those rows are not consulted, and a new grant or sharing rule on them is refused (SHARING_NOT_ENABLED). To '
      + `share their records again, store them on the datasource of '${SHARE_TABLE}', on a driver that evaluates `
      + 'share grants (the SQL drivers do).',
    { objects: holders.map((h) => ({ object: h.object, reason: h.reason })) },
  );
  return holders;
}

/** The names of every object the engine's registry holds, or `[]` when it has no registry. */
export function registeredObjectNames(engine: unknown): string[] {
  const registry = (engine as { registry?: { getAllObjects?: () => unknown[] } } | undefined)?.registry;
  if (!registry || typeof registry.getAllObjects !== 'function') return [];
  const names = new Set<string>();
  for (const schema of registry.getAllObjects() ?? []) {
    const name = (schema as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name !== '') names.add(name);
  }
  return [...names].sort();
}
