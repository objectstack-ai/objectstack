/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5795 — the synthesizer carries a related list's `sort` through to
 * the `record:related_list` node, and NOWHERE else.
 *
 * `buildDefaultTabs`' `relatedNode` builds a FRESH object literal per related
 * entry, naming every key it forwards; a key it does not name is simply gone,
 * which is the shape the original defect had one hop upstream. This is the
 * second of the two re-drop sites between the derivation and the wire, so it
 * gets its own pins rather than relying on the end-to-end test alone.
 *
 * ## The synthesizer is a CARRIER here, not a policy
 *
 * It neither derives an order nor overrides one: `RecordDetailView` decides
 * what a derived list inherits (the child object's default list view `sort` —
 * ruled direction 1 on objectstack#11345, maintainer 2026-08-23, with **no new
 * spec key**) and hands it over already lowered to the array arm. So the pins
 * below are about faithful carriage and about the key being ABSENT when
 * nothing was supplied — never about the value's content.
 *
 * ## Precedence, stated because the card asked for it to be
 *
 * There is no contest to resolve. A hand-authored page carries its own
 * `record:related_list` node with its own `sort` and never enters this
 * synthesizer at all (`RecordDetailView` synthesizes only when no page is
 * assigned), and within the synthesized path the ONE producer of
 * `related[].sort` is the inheritance. An authored sort therefore behaves
 * exactly as it did before this change — which is what the last leg records.
 *
 * ## The third site that must NOT gain the key
 *
 * The same `related[]` array also feeds `record:reference_rail`'s entries.
 * `ReferenceRailEntrySchema` is `$strict` and declares no `sort`, so emitting
 * one there would be refused at save with nothing reading it — exactly the
 * class objectui#5494 removed when it stopped emitting `rel.icon` onto rail
 * entries. The rail is a top-3 summary, not the list; it is deliberately left
 * unordered by this card.
 */

import { describe, it, expect } from 'vitest';
import { PageSchema } from '@objectstack/spec/ui';
import {
  buildDefaultPageSchema,
  buildDefaultTabs,
  type ObjectDefLike,
} from '../buildDefaultPageSchema';

const checkItemDef: ObjectDefLike = {
  name: 'task_version',
  label: 'Task Version',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
  },
};

const SORT = [{ field: 'seq_no', order: 'asc' as const }];

/** Every `record:related_list` node in a synthesized tabs node. */
function relatedNodes(tabs: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'record:related_list') out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const item of tabs.properties?.items ?? []) for (const c of item.children ?? []) walk(c);
  return out;
}

const propsOf = (node: any) => node.properties ?? node;

function issuesOf(result: { success: boolean; error?: { issues: any[] } }): string[] {
  if (result.success) return [];
  return (result.error?.issues ?? []).map(
    (i: any) => `${i.code} @ ${i.path.join('.') || '<root>'}: ${String(i.message).split('\n')[0]}`,
  );
}

describe('buildDefaultTabs — related-list sort carriage (objectui#5795)', () => {
  it('SUBJECT — forwards a supplied array-arm sort onto the node', () => {
    const tabs = buildDefaultTabs(checkItemDef, {
      related: [{ objectName: 'check_item', relationshipField: 'task_version', sort: SORT }],
    });
    const nodes = relatedNodes(tabs);
    expect(nodes).toHaveLength(1);
    expect(propsOf(nodes[0]).sort).toEqual(SORT);
  });

  it('forwards the value VERBATIM — the synthesizer is not a second translator', () => {
    // The spec union's string arm, in the related list's own `'-field'`
    // notation. The one translation this feature needs (from the ListView's
    // legacy `'field desc'` dialect) happens once, at the derivation; a second
    // conversion here is how two dialects start disagreeing.
    const tabs = buildDefaultTabs(checkItemDef, {
      related: [{ objectName: 'check_item', relationshipField: 'task_version', sort: '-seq_no' }],
    });
    expect(propsOf(relatedNodes(tabs)[0]).sort).toBe('-seq_no');
  });

  it('COUNTER-PROBE — omits the key entirely when nothing was supplied', () => {
    const tabs = buildDefaultTabs(checkItemDef, {
      related: [{ objectName: 'check_item', relationshipField: 'task_version' }],
    });
    const props = propsOf(relatedNodes(tabs)[0]);
    // Absent, not present-and-undefined: "the author said nothing" and "the
    // author asked for the default" are different facts, and the second is the
    // one a later liveness audit would read.
    expect('sort' in props).toBe(false);
  });

  it('carries a per-list sort, not a page-wide one', () => {
    const tabs = buildDefaultTabs(checkItemDef, {
      relatedLayout: 'stack',
      related: [
        { objectName: 'check_item', relationshipField: 'task_version', sort: SORT },
        { objectName: 'attachment_note', relationshipField: 'task_version' },
      ],
    });
    const byObject = Object.fromEntries(
      relatedNodes(tabs).map((n) => [propsOf(n).objectName, propsOf(n)]),
    );
    expect(byObject.check_item.sort).toEqual(SORT);
    expect('sort' in byObject.attachment_note).toBe(false);
  });

  it('the synthesized page still parses under the real PageSchema with a sort', () => {
    // The ruling added NO spec key: `record:related_list.sort` was already
    // declared-parsed-consumed, and this change only fills it. Measured
    // against the vendored `@objectstack/spec` the server enforces (ADR-0089
    // D3a closed these nodes with `.strict()`), so an invented key would be a
    // loud parse error here rather than a silent strip.
    const synth = buildDefaultPageSchema(checkItemDef, {
      related: [{ objectName: 'check_item', relationshipField: 'task_version', sort: SORT }],
    });
    const body = {
      name: 'task_version_record',
      label: 'Task Version Record',
      type: 'record',
      object: checkItemDef.name,
      ...(synth.template ? { template: synth.template } : {}),
      ...(Array.isArray(synth.regions) && synth.regions.length ? { regions: synth.regions } : {}),
    };
    expect(issuesOf(PageSchema.safeParse(body) as any)).toEqual([]);
  });

  it('THE THIRD SITE — reference-rail entries do NOT gain a sort', () => {
    // The rail is opt-in and needs at least two related lists (it also
    // suppresses the Related tab), so this is the branch where the SAME
    // `related[]` array reaches the rail's own strict entry shape.
    const synth = buildDefaultPageSchema(checkItemDef, {
      showReferenceRail: true,
      related: [
        { objectName: 'check_item', relationshipField: 'task_version', sort: SORT },
        { objectName: 'attachment_note', relationshipField: 'task_version', sort: SORT },
      ],
    });
    const aside = (synth.regions as any[]).find((r) => r.name === 'aside');
    const rail = aside?.components?.find((c: any) => c.type === 'record:reference_rail');
    expect(rail).toBeTruthy();
    for (const entry of propsOf(rail).entries) {
      expect('sort' in entry).toBe(false);
    }
    // Deliberately NOT a whole-page `PageSchema` parse here, unlike the leg
    // above: a Reference Rail page is already unpersistable for an unrelated,
    // pre-existing reason — the synthesized `aside` region carries a
    // `className` that `PageRegionSchema` refuses (objectui#4286, open).
    // Measured on this branch with NO `sort` anywhere, so it is not this
    // change; asserting a clean parse here would fail on someone else's
    // defect and asserting the failure would pin it in place.
  });
});
