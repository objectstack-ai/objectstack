// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysAuditLog } from './objects/sys-audit-log.object.js';
import * as AuditObjects from './objects/index.js';

/**
 * `sys_audit_log` declares the ActivityPointer pair — #11386 (ADR-0052 §5,
 * carrier landed by #11339).
 *
 * This pin lives HERE, next to the object, rather than only in the seed
 * loader's own suite, because the loader's tests mirror this shape in a fake
 * schema map. A mirror that drifts from the real declaration keeps passing
 * while the platform stops resolving the pair — the pin closes that gap by
 * asserting what the object ACTUALLY declares.
 *
 * The evidence that this pair is a pointer and not two coincidental columns
 * (re-verified for THIS object, per the card's per-object discipline): every
 * writer stamps an object MACHINE NAME beside a real record id of that object
 * — `audit-writers.ts` (`object_name: ctx.object` / `record_id: recordId`),
 * `read-audit.ts` (`event.objectName` / `event.recordId`),
 * `auth-event-audit.ts` (the session object / `event.sessionId`), and
 * plugin-auth's admin user endpoints (`'sys_user'` / the affected user id).
 * The `{object_name, record_id}` index and the `record_views` list view read
 * the pair back as "who touched THIS record".
 */
describe('sys_audit_log — declared pointer pair (#11386)', () => {
  const fields = SysAuditLog.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    expect(fields.record_id.referenceVia).toBe('object_name');
  });

  it('keeps the id half a plain text column — `referenceVia` is text-only, and a static `reference` would contradict it', () => {
    expect(fields.record_id.type).toBe('text');
    expect(fields.record_id.reference).toBeUndefined();
  });

  it('declares the sibling the pointer names, holding an object machine name', () => {
    // `ObjectSchema.create` refuses a `referenceVia` whose sibling is not
    // declared, so this is belt-and-braces — but it is also the line a future
    // rename of `object_name` will trip over, which is the point.
    expect(fields.object_name).toBeDefined();
    expect(fields.object_name.type).toBe('text');
  });

  it('leaves the id half OPTIONAL — run-level rows (an `import` row) carry no record', () => {
    // Load-bearing for the pair's seed contract: because the column is
    // optional, an out-of-order seed pointer can be deferred and back-filled
    // rather than failing the insert outright. It is also why "id half
    // authored, object half empty" is reachable here and refused loudly.
    expect(fields.record_id.required ?? false).toBe(false);
    expect(fields.object_name.required ?? false).toBe(false);
  });
});

/**
 * [#24501] A list names a pointer's target with the id half alone. The console
 * draws a `referenceVia` column as the target record (its object's icon and
 * name) and fetches the type half for that cell without a column
 * (objectui#13036); a type-half column draws the stored API name as text.
 * Enumerated over every object this package ships (`objects/index.ts`), so a
 * view added later is judged without anyone listing it here.
 */
describe('audit list views — a pointer shows as its id half, never its type half (#24501)', () => {
  type PointerObject = {
    name: string;
    fields: Record<string, { referenceVia?: unknown } | undefined>;
    listViews?: Record<string, { columns?: ReadonlyArray<string | { field: string }> }>;
  };

  /** `object.view: column` for each shown id half, and for each type half shown beside one. */
  function pointerColumns(objects: readonly PointerObject[]): { idHalves: string[]; typeHalves: string[] } {
    const idHalves: string[] = [];
    const typeHalves: string[] = [];
    for (const object of objects) {
      for (const [view, def] of Object.entries(object.listViews ?? {})) {
        const shown = new Set((def.columns ?? []).map((c) => (typeof c === 'string' ? c : c.field)));
        for (const column of shown) {
          const via = object.fields[column]?.referenceVia;
          if (typeof via !== 'string') continue;
          idHalves.push(`${object.name}.${view}: ${column}`);
          if (shown.has(via)) typeHalves.push(`${object.name}.${view}: ${via}`);
        }
      }
    }
    return { idHalves, typeHalves };
  }

  const objects = Object.values(AuditObjects) as unknown as PointerObject[];

  it('no list view shows a referenceVia sibling beside its id half', () => {
    expect(pointerColumns(objects).typeHalves).toEqual([]);
  });

  it('the ledger lists still show the id half, so the Record column names the target', () => {
    expect(pointerColumns(objects).idHalves).toEqual(expect.arrayContaining([
      'sys_audit_log.recent: record_id',
      'sys_audit_log.writes_only: record_id',
      'sys_audit_log.record_views: record_id',
      'sys_audit_log.all_events: record_id',
    ]));
  });
});
