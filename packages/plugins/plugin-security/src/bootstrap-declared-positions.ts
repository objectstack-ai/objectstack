// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredPositions — seed stack-declared `positions` into `sys_position`
 * (ADR-0057 D6, closes #2077).
 *
 * Reads the validated `position` metadata (registered from the stack's `positions: []`
 * via `metadataService.list('position')`) and idempotently upserts each into
 * `sys_position` by `name`, so the runtime position→permission-set resolution
 * (`resolveExecutionContext` → `sys_position` → `sys_position_permission_set`) and
 * sharing-rule position recipients stop being decorative. Runs on `kernel:ready`
 * alongside the platform-admin bootstrap.
 *
 * Pre-launch posture (ADR-0057): upsert only — no prune. Position visibility
 * HIERARCHY is NOT seeded here: per ADR-0057 D5 the position is a capability
 * bundle, and "manager sees subordinates" lives on the `sys_business_unit`
 * tree, not `sys_position.parent`.
 */

import { buildExistingByName } from './seed-name-lookup.js';

const SYSTEM_CTX = { isSystem: true };

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try { return await ql.insert(object, data, { context: SYSTEM_CTX }); } catch { return null; }
}
async function tryUpdate(ql: any, object: string, data: any): Promise<boolean> {
  try { await ql.update(object, data, { context: SYSTEM_CTX }); return true; } catch { return false; }
}

interface SeedOptions {
  logger?: { info: (m: string, meta?: Record<string, any>) => void; warn: (m: string, meta?: Record<string, any>) => void };
}

/**
 * Read declared metadata items of a type. The engine's SchemaRegistry
 * (populated by `manifest.register` from the stack's `positions`/`sharingRules`
 * arrays) is the reliable source in every boot path; the metadata-service
 * facade only surfaces these once the compiled-artifact loader runs (serve.ts).
 *
 * [#8378] No `{ name, content }` unwrap: the registered item IS the authoring
 * document. `PositionSchema` declares no `content` key and rejects one as
 * unrecognized, so the unwrap could only ever have destroyed a document —
 * see `bootstrap-declared-permissions.ts` for the full measurement.
 */
function readDeclared(engine: any, type: string): any[] {
  try {
    const reg = engine?.registry;
    if (reg?.listItems) {
      return (reg.listItems(type) ?? []).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

/**
 * The columns a re-seed writes. Position IDENTITY + display only: the record
 * side (bindings, `active`, `is_default`, `delegatable`, `managed_by`) belongs
 * to the runtime/admin and is never projected from the declaration (#2909 T2).
 */
function positionRowFields(r: any): { label: any; description: any } {
  return { label: r.label ?? r.name, description: r.description ?? null };
}

/** True when the stored row differs from what a re-seed would write (#10946). */
function positionRecordDiffers(row: any, fields: { label: any; description: any }): boolean {
  return (row?.label ?? null) !== (fields.label ?? null)
    || (row?.description ?? null) !== (fields.description ?? null);
}

export async function bootstrapDeclaredPositions(
  ql: any,
  metadataService: any,
  options: SeedOptions = {},
): Promise<{ seeded: number; updated: number; unchanged: number; unreadable: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0, unchanged: 0, unreadable: 0 };
  }
  let positions: any[] = readDeclared(ql, 'position');
  if (positions.length === 0) {
    try {
      const listed = metadataService?.list?.('position');
      positions = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { positions = []; }
  }
  if (!Array.isArray(positions) || positions.length === 0) return { seeded: 0, updated: 0, unchanged: 0, unreadable: 0 };

  // [#10946] ONE existence read for the whole declaration, before the loop.
  // See `seed-name-lookup.ts` for why a read that cannot ANSWER must never be
  // read as "none of them exist" — that conflation would re-create every
  // position on every boot.
  const existingByName = await buildExistingByName(
    ql,
    'sys_position',
    positions.map((r) => r?.name),
    options.logger,
  );

  let seeded = 0;
  let updated = 0;
  let unchanged = 0;
  let unreadable = 0;
  for (const r of positions) {
    if (!r?.name) continue;
    const fields = positionRowFields(r);
    // ⛔ Three outcomes, not two (#10946 / #3807): a read that FAILED is not
    // "no such position". Inserting on it would re-create every position on
    // every boot the database is briefly unreachable.
    const lookup = await existingByName.get(String(r.name));
    if (lookup.status === 'unknown') { unreadable += 1; continue; }
    const existing = lookup.status === 'present' ? lookup.row : undefined;
    if (existing?.id) {
      // [#10946] Only write when the stored row actually differs. An
      // unconditional UPDATE here cost two remote round trips per position on
      // every boot to store the values already there.
      //
      // ⚠️ EQUALITY decides, not presence: a position whose stored label or
      // description drifted from the declaration still gets its UPDATE. Only
      // the display fields are compared because only the display fields are
      // written — the record-authoritative columns (`active`, `is_default`,
      // `delegatable`, `managed_by`) are deliberately never touched by a
      // re-seed (#2909 T2), so they can neither cause nor suppress one.
      if (!positionRecordDiffers(existing, fields)) {
        unchanged += 1;
      } else if (await tryUpdate(ql, 'sys_position', { id: existing.id, ...fields })) {
        updated += 1;
      }
    } else {
      const row = {
        id: genId('position'), name: r.name, ...fields, active: true, is_default: false,
      };
      const created = await tryInsert(ql, 'sys_position', row);
      if (created) {
        seeded += 1;
        // The batched oracle is a snapshot taken before the loop; a name
        // declared twice in one batch must resolve to the row we just made
        // rather than attempting a second insert the unique index refuses.
        existingByName.remember(String(r.name), row);
      }
    }
  }
  if (unreadable > 0) {
    // Said once, with the count — see the sibling warn in
    // `bootstrap-declared-permissions.ts`.
    options.logger?.warn?.(
      '[security] declared positions left untouched — their records could not be read',
      { unreadable, total: positions.length },
    );
  }
  options.logger?.info?.('[security] declared positions seeded into sys_position', { seeded, updated, unchanged, unreadable, total: positions.length });
  return { seeded, updated, unchanged, unreadable };
}
