// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { provisionPrimary } from '@objectstack/spec/data';
import { SysRecordShare } from './objects/sys-record-share.object.js';
import { SysShareLink } from './objects/sys-share-link.object.js';
import * as SharingObjects from './objects/index.js';

/**
 * The two sharing tables declare the ActivityPointer pair — #11386 (ADR-0052
 * §5, carrier landed by #11339).
 *
 * They live in one file because they live in one package, NOT because they
 * were adopted as one decision: `record-orphan-cleanup.ts` states the shared
 * invariant ("record gone ⇒ the row cannot describe any access at all"), but
 * each table reaches it down a different path, and each was re-verified on its
 * own — see the per-object blocks below.
 *
 * What both share, and what makes the declaration matter more here than on a
 * log: an unresolved `record_id` on a grant table does not merely fail to
 * DISPLAY. It names no live record, so the row enforces nothing while
 * appearing to be a grant — and then the orphan sweep deletes it for
 * describing a record that does not exist.
 */
describe('sys_record_share — declared pointer pair (#11386)', () => {
  const fields = SysRecordShare.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    // Dereferenced as a real address, not stored as a label:
    // `sharing-service.ts` writes the pair from `input.object` /
    // `input.recordId` and gates share management on it, and the orphan sweep
    // asks per row whether `(object_name, record_id)` still exists.
    expect(fields.record_id.referenceVia).toBe('object_name');
  });

  it('keeps the id half a plain text column with no contradicting static reference', () => {
    expect(fields.record_id.type).toBe('text');
    expect(fields.record_id.reference).toBeUndefined();
  });

  it('declares the sibling the pointer names', () => {
    expect(fields.object_name).toBeDefined();
    expect(fields.object_name.type).toBe('text');
  });

  it('does NOT declare source_id as a pointer half — it names a sharing RULE, not a record', () => {
    // The measured near-miss on this object: `source_id` sits beside the pair,
    // is text, and reads like an id half. It is the reconciliation handle for
    // the rule that materialised the grant — no sibling column names an object
    // for it, and resolving it as a record id would be a fabricated pointer.
    expect(fields.source_id).toBeDefined();
    expect(fields.source_id.referenceVia).toBeUndefined();
  });
});

describe('sys_share_link — declared pointer pair (#11386)', () => {
  const fields = SysShareLink.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    // Verified through THIS object's own consumer, which is not the sharing
    // middleware: `share-link-routes.ts` calls `engine.find(link.object_name,
    // …)` with `record_id` as the address, and `share-link-service.ts`
    // resolves a token through the fail-closed gate
    // `if (!(await this.recordStillExists(row.object_name, row.record_id))) return null`.
    expect(fields.record_id.referenceVia).toBe('object_name');
  });

  it('keeps the id half a plain text column with no contradicting static reference', () => {
    expect(fields.record_id.type).toBe('text');
    expect(fields.record_id.reference).toBeUndefined();
  });

  it('declares the sibling the pointer names', () => {
    expect(fields.object_name).toBeDefined();
    expect(fields.object_name.type).toBe('text');
  });

  it('does NOT declare token as a pointer half — a capability secret is not a record address', () => {
    expect(fields.token).toBeDefined();
    expect(fields.token.referenceVia).toBeUndefined();
  });
});

/**
 * [#24501] A list names the shared record with the id half alone. The console
 * draws a `referenceVia` column as the target record (its object's icon and
 * name) and fetches the type half for that cell without a column
 * (objectui#13036); a type-half column draws the stored API name as text.
 * Enumerated over every object this package ships (`objects/index.ts`), so a
 * view added later is judged without anyone listing it here.
 */
describe('sharing list views — a pointer shows as its id half, never its type half (#24501)', () => {
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

  const objects = Object.values(SharingObjects) as unknown as PointerObject[];

  it('no list view shows a referenceVia sibling beside its id half', () => {
    expect(pointerColumns(objects).typeHalves).toEqual([]);
  });

  it('the share and link lists still show the id half, so the Record column names the target', () => {
    const shareViews = ['all_shares', 'granted_to_me', 'granted_by_me', 'by_object', 'manual_grants', 'rule_grants'];
    const linkViews = ['active_links', 'by_me', 'revoked', 'all_links'];
    expect(pointerColumns(objects).idHalves).toEqual(expect.arrayContaining([
      ...shareViews.map((v) => `sys_record_share.${v}: record_id`),
      ...linkViews.map((v) => `sys_share_link.${v}: record_id`),
    ]));
  });
});

/**
 * [#24611] The record page names the shared record by the Details tab's
 * pointer card, never by the pair's type half.
 *
 * The console's default record page (objectui at this repository's
 * `.objectui-sha`) draws the H1 from the object's title pointer, draws each
 * `highlightFields` entry in the strip as its stored text, and hides every
 * strip field and the H1 field from the Details tab. The Details tab is where
 * a `referenceVia` id half draws as the pointer card, headed by the target
 * object's label. So the type half must be neither the title nor a strip
 * field, and the id half must not be a strip field either.
 *
 * The title pointer is read as the registry serves it: `provisionPrimary` is
 * the designate-only pass `SchemaRegistry.registerObject` runs. With no
 * declared pointer it derived `object_name` for `sys_record_share`, and the
 * page H1 read the shared record's object API name.
 */
describe('sharing record pages — the pointer card names the target, never the type half (#24611)', () => {
  type TitledObject = {
    name: string;
    nameField?: string;
    titleFormat?: string | { source?: string };
    highlightFields?: readonly string[];
    fields: Record<string, { referenceVia?: unknown } | undefined>;
    listViews?: Record<string, {
      sort?: ReadonlyArray<{ field: string }>;
      grouping?: { fields?: ReadonlyArray<{ field: string }> };
    }>;
  };

  const objects = Object.values(SharingObjects) as unknown as TitledObject[];

  /** Each declared pair as `[id half, type half]`. */
  function pairs(object: TitledObject): Array<[string, string]> {
    return Object.entries(object.fields).flatMap(([name, def]) =>
      typeof def?.referenceVia === 'string' ? [[name, def.referenceVia] as [string, string]] : []);
  }

  const paired = objects.filter((o) => pairs(o).length > 0);

  it('enumerates both pointer-pair objects, so no case below passes on an empty set', () => {
    expect(paired.map((o) => o.name).sort()).toEqual(['sys_record_share', 'sys_share_link']);
  });

  it('the served title pointer is declared and is never a type half', () => {
    const served = paired.map((o) => {
      const designated = provisionPrimary(structuredClone(o) as never, { synthesize: false }) as { nameField?: string };
      return {
        object: o.name,
        declared: o.nameField,
        served: designated.nameField,
        typeHalf: pairs(o).some(([, via]) => via === designated.nameField),
      };
    });
    expect(served).toEqual([
      { object: 'sys_record_share', declared: 'recipient_id', served: 'recipient_id', typeHalf: false },
      { object: 'sys_share_link', declared: 'label', served: 'label', typeHalf: false },
    ]);
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

  it('no list view groups on a type half', () => {
    const hits = paired.flatMap((o) => {
      const typeHalves = new Set(pairs(o).map(([, via]) => via));
      return Object.entries(o.listViews ?? {}).flatMap(([view, def]) =>
        (def.grouping?.fields ?? []).filter((g) => typeHalves.has(g.field)).map((g) => `${o.name}.${view}: ${g.field}`));
    });
    expect(hits).toEqual([]);
  });

  it('control: by_object still orders the grants by their object, and the pair stays declared', () => {
    expect(SysRecordShare.listViews?.by_object?.sort?.[0]).toEqual({ field: 'object_name', order: 'asc' });
    expect((SysRecordShare.fields as Record<string, Record<string, unknown>>).record_id.referenceVia).toBe('object_name');
    expect((SysShareLink.fields as Record<string, Record<string, unknown>>).record_id.referenceVia).toBe('object_name');
  });
});
