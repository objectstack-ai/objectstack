// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredPositions — seed stack-declared `positions` into `sys_position`
 * (ADR-0057 D6, closes #2077).
 *
 * Reads the validated `position` metadata (registered from the stack's `positions: []`
 * via `metadataService.list('position')`) and idempotently upserts each into
 * `sys_position` by `(name, organization_id)`, so the runtime position→permission-set resolution
 * (`resolveExecutionContext` → `sys_position` → `sys_position_permission_set`) and
 * sharing-rule position recipients stop being decorative. Runs on `kernel:ready`
 * alongside the platform-admin bootstrap.
 *
 * Pre-launch posture (ADR-0057): upsert only — no prune. Position visibility
 * HIERARCHY is NOT seeded here: per ADR-0057 D5 the position is a capability
 * bundle, and "manager sees subordinates" lives on the `sys_business_unit`
 * tree, not `sys_position.parent`.
 *
 * Runs ONE PASS PER ORGANIZATION under a walled posture: the object spells its
 * name index `unique: 'organization'`, and a row belonging to no organization is
 * invalid state there — it was measured unreadable by every principal, because
 * Layer 0's strict `organization_id = :tenant` AND-composes over the driver's
 * compatibility arm and leaves the strict equality alone. `single` posture keeps
 * exactly one organization-less pass. Doctrine, and the loud guard that stands
 * in place of a reap: `per-organization-catalog.ts`.
 */

import {
  resolveOwnOrganizationRow,
  rowMatchesDeclaration,
  seedCtx,
  warnPreFixOrganizationLessRows,
} from './per-organization-catalog.js';

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

async function tryFind(ql: any, object: string, where: any, limit = 100, organizationId?: string): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: seedCtx(organizationId) });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
async function tryInsert(ql: any, object: string, data: any, organizationId?: string): Promise<any | null> {
  try { return await ql.insert(object, data, { context: seedCtx(organizationId) }); } catch { return null; }
}
async function tryUpdate(ql: any, object: string, data: any, organizationId?: string): Promise<boolean> {
  try { await ql.update(object, data, { context: seedCtx(organizationId) }); return true; } catch { return false; }
}

interface SeedOptions {
  logger?: { info: (m: string, meta?: Record<string, any>) => void; warn: (m: string, meta?: Record<string, any>) => void };
  /**
   * Seed THIS organization's copies. Omitted = the `single`-posture pass, the
   * one place an organization-less catalog row is the correct shape.
   */
  organizationId?: string;
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

export async function bootstrapDeclaredPositions(
  ql: any,
  metadataService: any,
  options: SeedOptions = {},
): Promise<{ seeded: number; updated: number }> {
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    return { seeded: 0, updated: 0 };
  }
  let positions: any[] = readDeclared(ql, 'position');
  if (positions.length === 0) {
    try {
      const listed = metadataService?.list?.('position');
      positions = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { positions = []; }
  }
  if (!Array.isArray(positions) || positions.length === 0) return { seeded: 0, updated: 0 };

  const organizationId = options.organizationId;
  let seeded = 0;
  let updated = 0;
  let unchanged = 0;
  const residue: string[] = [];
  for (const r of positions) {
    if (!r?.name) continue;
    const fields = { label: r.label ?? r.name, description: r.description ?? null };
    // Limit 5, not 1 — see `bootstrap-builtin-positions.ts` for why one row is
    // the wrong question to ask a tenant-scoped read.
    const existing = await tryFind(ql, 'sys_position', { name: r.name }, 5, organizationId);
    const { own, organizationLessResidue } = resolveOwnOrganizationRow(existing, organizationId);
    if (organizationLessResidue) residue.push(r.name);
    if (own?.id) {
      // O(changed declarations): an unchanged declaration costs no write.
      if (rowMatchesDeclaration(own, fields)) { unchanged += 1; continue; }
      if (await tryUpdate(ql, 'sys_position', { id: own.id, ...fields }, organizationId)) updated += 1;
    } else {
      const created = await tryInsert(ql, 'sys_position', {
        id: genId('position'), name: r.name, ...fields, active: true, is_default: false,
      }, organizationId);
      if (created) seeded += 1;
    }
  }
  if (organizationId) {
    warnPreFixOrganizationLessRows(options.logger, 'sys_position', residue, organizationId);
  }
  if (seeded + updated > 0) {
    options.logger?.info?.('[security] declared positions seeded into sys_position', {
      seeded, updated, unchanged, total: positions.length,
      ...(organizationId ? { organization: organizationId } : {}),
    });
  }
  return { seeded, updated };
}
