// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { provisionPrimary } from '@objectstack/spec/data';
import { SysAuditLog } from './objects/sys-audit-log.object.js';
import * as AuditObjects from './objects/index.js';
import { SysActivity } from './objects/sys-activity.object.js';
import { enObjects } from './translations/en.objects.generated.js';
import { zhCNObjects } from './translations/zh-CN.objects.generated.js';
import { jaJPObjects } from './translations/ja-JP.objects.generated.js';
import { esESObjects } from './translations/es-ES.objects.generated.js';

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

/**
 * [#24611] The record page names a row's target by the Details tab's pointer
 * card, and no audit surface draws a pair's type half as text.
 *
 * The console's default record page (objectui at this repository's
 * `.objectui-sha`) draws the H1 from the object's title pointer, draws each
 * `highlightFields` entry in the strip as its stored text, and hides every
 * strip field and the H1 field from the Details tab. The Details tab is where
 * a `referenceVia` id half draws as the pointer card, headed by the target
 * object's label. So the type half must be neither the title nor a strip
 * field, and the id half must not be a strip field either. The title pointer
 * is read as the registry serves it (`provisionPrimary`, the designate-only
 * pass `SchemaRegistry.registerObject` runs).
 *
 * The list half widens #24501's rule above: a type half is not a column even
 * where its id half is absent. `config_changes` listed `object_name` alone,
 * and its rows carry no `record_id`, so the column drew a stored API name with
 * no pointer beside it.
 */
describe('audit record pages and lists — the type half never draws as text (#24611)', () => {
  type TitledObject = {
    name: string;
    nameField?: string;
    titleFormat?: string | { source?: string };
    highlightFields?: readonly string[];
    fields: Record<string, { referenceVia?: unknown } | undefined>;
    listViews?: Record<string, {
      columns?: ReadonlyArray<string | { field: string }>;
      grouping?: { fields?: ReadonlyArray<{ field: string }> };
    }>;
  };

  const objects = Object.values(AuditObjects) as unknown as TitledObject[];

  /** Each declared pair as `[id half, type half]`. */
  function pairs(object: TitledObject): Array<[string, string]> {
    return Object.entries(object.fields).flatMap(([name, def]) =>
      typeof def?.referenceVia === 'string' ? [[name, def.referenceVia] as [string, string]] : []);
  }

  const paired = objects.filter((o) => pairs(o).length > 0);

  it('enumerates the pointer-pair objects, so no case below passes on an empty set', () => {
    expect(paired.map((o) => o.name).sort()).toEqual(['sys_activity', 'sys_audit_log']);
  });

  it('the served title pointer is never a type half', () => {
    const served = paired.map((o) => {
      const designated = provisionPrimary(structuredClone(o) as never, { synthesize: false }) as { nameField?: string };
      return { object: o.name, served: designated.nameField, typeHalf: pairs(o).some(([, via]) => via === designated.nameField) };
    });
    expect(served).toEqual(expect.arrayContaining([
      { object: 'sys_audit_log', served: 'action', typeHalf: false },
    ]));
    expect(served.filter((s) => s.typeHalf)).toEqual([]);
  });

  it('no titleFormat interpolates a type half', () => {
    const hits = paired.flatMap((o) => {
      const raw = o.titleFormat;
      const source = typeof raw === 'string' ? raw : raw?.source ?? '';
      return pairs(o).filter(([, via]) => source.includes(`{${via}}`)).map(([, via]) => `${o.name}: ${via}`);
    });
    expect(hits).toEqual([]);
  });

  it('highlightFields lists neither half of a pair', () => {
    const hits = paired.flatMap((o) =>
      pairs(o).flatMap((pair) => pair.filter((f) => (o.highlightFields ?? []).includes(f)).map((f) => `${o.name}: ${f}`)));
    expect(hits).toEqual([]);
  });

  it('no list view shows or groups on a type half, with or without its id half', () => {
    const hits = paired.flatMap((o) => {
      const typeHalves = new Set(pairs(o).map(([, via]) => via));
      return Object.entries(o.listViews ?? {}).flatMap(([view, def]) => [
        ...(def.columns ?? []).map((c) => (typeof c === 'string' ? c : c.field)),
        ...(def.grouping?.fields ?? []).map((g) => g.field),
      ].filter((f) => typeHalves.has(f)).map((f) => `${o.name}.${view}: ${f}`));
    });
    expect(hits).toEqual([]);
  });

  it('control: config_changes is still declared with its filter, and the pair stays declared', () => {
    const view = SysAuditLog.listViews?.config_changes as { filter?: unknown; columns?: unknown } | undefined;
    expect(view?.filter).toEqual([{ field: 'action', operator: 'in', value: ['config_change', 'import'] }]);
    expect(view?.columns).toEqual(['created_at', 'action', 'user_id']);
    expect((SysAuditLog.fields as Record<string, Record<string, unknown>>).record_id.referenceVia).toBe('object_name');
  });
});

/**
 * #28353 — the id half is headed "Record", because its cell draws the record.
 *
 * The console draws a `referenceVia` id half as the target record (its
 * object's icon and name) in the list views and on the Details tab, so the
 * header "Record ID" disagreed with the cell. The label reads "Record" in
 * every pack, the words `sys_approval_action.record_id` and
 * `sys_approval_request.record_id` already use. Only the label moves: the
 * field stays the same text id half of the same pair.
 */
describe('audit pointer id halves — headed "Record", not "Record ID" (#28353)', () => {
  const bundles = { en: enObjects, 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects };
  const words = { en: 'Record', 'zh-CN': '记录', 'ja-JP': 'レコード', 'es-ES': 'Registro' };

  for (const object of [SysAuditLog, SysActivity]) {
    const field = (object.fields as Record<string, Record<string, unknown>>).record_id;

    it(`${object.name}.record_id is labelled "Record" and stays the text id half`, () => {
      expect(field.label).toBe('Record');
      expect(field.type).toBe('text');
      expect(field.referenceVia).toBe('object_name');
    });

    for (const [locale, bundle] of Object.entries(bundles)) {
      it(`${object.name}.record_id reads ${words[locale as keyof typeof words]} in ${locale}`, () => {
        const leaf = (bundle as Record<string, { fields?: Record<string, { label?: string }> }>)[object.name]?.fields?.record_id;
        expect(leaf?.label).toBe(words[locale as keyof typeof words]);
      });
    }
  }
});
