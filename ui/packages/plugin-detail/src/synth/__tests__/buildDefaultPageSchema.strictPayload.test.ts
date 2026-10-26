/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4232 — the synthesized page must SURVIVE THE SERVER'S WRITE.
 *
 * Studio's page-create seeds a record page's `regions` from
 * `buildDefaultPageSchema(objectDef)` (app-shell
 * `views/metadata-admin/anchors.ts` → `createSeed`) and PUTs the result. The
 * server parses that body with `@objectstack/spec`'s `PageSchema`, whose page
 * component shape was closed with `.strict()` by **ADR-0089 D3a**, so a widget
 * prop written at the top level of a component node is a parse error rather
 * than a silent strip:
 *
 *     Unrecognized key(s) on this view/page schema: `recordChrome`, `actions`.
 *     Before ADR-0089 D3a these were dropped silently, shipping inert
 *     metadata; a mis-layered or stale key is now a loud parse error.
 *
 * That is why page-create never completed: the body was refused and no page row
 * was stored.
 *
 * These pins are measured against the REAL schema the server enforces — the
 * vendored `@objectstack/spec` — not a hand-mirrored key list, so they follow
 * the contract when it moves. Delete `componentNode`'s `properties` wrapping
 * and every assertion here goes red with the server's own message.
 */

import { describe, it, expect } from 'vitest';
import {
  PageSchema,
  PageComponentSchema,
  PageTabsProps,
} from '@objectstack/spec/ui';
import {
  buildDefaultPageSchema,
  buildDefaultHeader,
  buildDefaultActions,
  buildDefaultHighlights,
  buildDefaultDetails,
  buildDefaultTabs,
  buildDefaultDiscussion,
  buildDefaultAttachments,
  type ObjectDefLike,
} from '../buildDefaultPageSchema';

const leadDef: ObjectDefLike = {
  name: 'lead',
  label: 'Lead',
  fields: {
    first_name: { name: 'first_name', label: 'First Name', type: 'text' },
    email: { name: 'email', label: 'Email', type: 'email' },
    phone: { name: 'phone', label: 'Phone', type: 'phone' },
    status: {
      name: 'status',
      label: 'Status',
      type: 'picklist',
      options: [
        { value: 'new', label: 'New' },
        { value: 'qualified', label: 'Qualified' },
      ],
    },
  },
};

/**
 * The parse issues, flattened to one readable line each.
 *
 * Asserted as `toEqual([])` rather than `success === true` on purpose: when a
 * node regresses, the failure output IS the server's rejection message
 * (offending key included), which is the whole diagnostic a fixer needs.
 */
function issuesOf(result: { success: boolean; error?: { issues: any[] } }): string[] {
  if (result.success) return [];
  return (result.error?.issues ?? []).map(
    (i: any) => `${i.code} @ ${i.path.join('.') || '<root>'}: ${String(i.message).split('\n')[0]}`,
  );
}

/**
 * The body Studio PUTs on create, assembled the way the console does:
 * identity + type + object come from the create form, `regions` and `template`
 * from the synthesizer (`createSeed` contributes ONLY those two).
 */
function createBody(def: ObjectDefLike, options?: Parameters<typeof buildDefaultPageSchema>[1]) {
  const synth = buildDefaultPageSchema(def, options);
  return {
    name: 'lead_record',
    label: 'Lead Record',
    type: 'record',
    object: def.name,
    ...(synth.template ? { template: synth.template } : {}),
    ...(Array.isArray(synth.regions) && synth.regions.length ? { regions: synth.regions } : {}),
  };
}

describe('ADR-0089 D3a — the Studio create payload parses server-side (objectui#4232)', () => {
  it('the default record page seed is accepted by PageSchema', () => {
    expect(issuesOf(PageSchema.safeParse(createBody(leadDef)))).toEqual([]);
  });

  it('is accepted with every optional surface the synthesizer can emit', () => {
    const body = createBody({ ...leadDef, enable: { files: true } }, {
      headerActions: [{ name: 'convert', label: 'Convert', locations: ['record_header'] }],
      related: [
        { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks', limit: 10, icon: 'check' },
        { objectName: 'note', relationshipField: 'parent_id', isPrimary: true },
      ],
      showActivity: true,
      history: { entries: [{ id: 'h1' }], loading: false },
      approvals: { count: 2, node: { currentUserId: 'u_1' } },
    });
    expect(issuesOf(PageSchema.safeParse(body))).toEqual([]);
  });

  it('is accepted for an object with no derivable highlights or status field', () => {
    expect(issuesOf(PageSchema.safeParse(createBody({ name: 'note', fields: {} })))).toEqual([]);
  });

  it('is accepted when the caller suppresses every optional slot', () => {
    const body = createBody(leadDef, {
      hideDiscussion: true,
      hideHighlights: true,
      hidePath: true,
    });
    expect(issuesOf(PageSchema.safeParse(body))).toEqual([]);
  });

  /**
   * The regression guard with the smallest blast radius: EVERY node the
   * synthesizer puts in a region is a `PageComponentSchema`, so a future prop
   * added at the top level of any one of them is caught here by name.
   */
  it('every synthesized component node parses as a PageComponentSchema', () => {
    const common = {
      headerActions: [{ name: 'convert', label: 'Convert', locations: ['record_header'] }],
      related: [
        { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
        { objectName: 'note', relationshipField: 'parent_id' },
      ],
      showActivity: true,
      history: { entries: [], loading: false },
      approvals: { node: { currentUserId: 'u_1' } },
    };
    const filesDef = { ...leadDef, enable: { files: true } };
    // Two pages, because the two branches are mutually exclusive by design:
    // turning the Reference Rail on suppresses the Related tab, so
    // `record:related_list` and `record:reference_rail` never co-occur.
    const pages = [
      buildDefaultPageSchema(filesDef, common),
      buildDefaultPageSchema(filesDef, { ...common, showReferenceRail: true }),
    ];
    const nodes: any[] = [];
    const walk = (n: any): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (typeof n.type === 'string') nodes.push(n);
      walk(n.properties?.items?.flatMap((i: any) => i.children ?? []));
    };
    for (const page of pages) for (const region of page.regions) walk(region.components);
    // The coverage claim, asserted rather than assumed: every component type
    // this synthesizer can emit is in the set being parsed below.
    expect([...new Set(nodes.map((n) => n.type))].sort()).toEqual([
      'page:header',
      'page:tabs',
      'record:activity',
      'record:approvals',
      'record:attachments',
      'record:details',
      'record:discussion',
      'record:highlights',
      'record:history',
      'record:path',
      'record:reference_rail',
      'record:related_list',
    ]);
    for (const node of nodes) {
      expect([node.type, issuesOf(PageComponentSchema.safeParse(node))]).toEqual([node.type, []]);
    }
  });

  it('the sub-builders emit accepted nodes on their own (slot authors compose these)', () => {
    const nodes = [
      buildDefaultHeader(leadDef),
      buildDefaultHeader(leadDef, { recordChrome: false }),
      buildDefaultActions(leadDef, [{ name: 'edit', label: 'Edit' }]),
      ...buildDefaultHighlights(leadDef),
      buildDefaultDetails(leadDef),
      buildDefaultTabs(leadDef),
      buildDefaultDiscussion(),
      buildDefaultAttachments(),
    ];
    for (const node of nodes) {
      expect([node.type, issuesOf(PageComponentSchema.safeParse(node))]).toEqual([node.type, []]);
    }
  });
});

describe('the accepted shape still carries the semantics (objectui#4232)', () => {
  /**
   * Chrome ON is the default, and it survives the server's parse — it is not
   * "accepted because it was dropped". `PageComponentSchema` keeps `properties`
   * as an opaque record, so what comes back out is what would be stored.
   */
  it('record chrome defaults ON and survives the parse', () => {
    const node = buildDefaultHeader(leadDef);
    expect(node).toEqual({ type: 'page:header', properties: { recordChrome: true } });
    const parsed = PageComponentSchema.parse(node) as any;
    expect(parsed.properties.recordChrome).toBe(true);
  });

  /**
   * The half that must never be lost to "just strip the key": an author who
   * turned the record chrome OFF (a dashboard / landing page) gets that choice
   * PERSISTED, because `recordChrome` is a declared `page:header` prop
   * (`ComponentPropsMap['page:header'].recordChrome`, #6776) and the bag it
   * lives in is the spec's own carrier.
   */
  it('record chrome turned OFF survives the parse rather than silently reverting', () => {
    const node = buildDefaultHeader(leadDef, { recordChrome: false });
    expect(node).toEqual({ type: 'page:header', properties: { recordChrome: false } });
    const parsed = PageComponentSchema.parse(node) as any;
    expect(parsed.properties.recordChrome).toBe(false);
    // …and it reaches the page body the console PUTs.
    const body = createBody(leadDef, { recordChrome: false });
    const page = PageSchema.parse(body) as any;
    expect(page.regions[0].components[0].properties.recordChrome).toBe(false);
  });

  /**
   * The tabs' item structure is the other named semantic. `PageTabsProps` is
   * the spec's own declaration of that bag, so parsing the emitted
   * `properties` against it proves the items are the DECLARED surface —
   * not merely tolerated as unknown values inside an opaque record.
   */
  it('the tab items are the spec-declared `page:tabs` props, labels/values/children intact', () => {
    const tabs = buildDefaultTabs(leadDef, {
      related: [{ objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' }],
      showActivity: true,
    });
    const parsed = PageTabsProps.parse(tabs.properties) as any;
    expect(parsed.items.map((i: any) => i.label)).toEqual(['Details', 'Related', 'Activity']);
    expect(parsed.items.map((i: any) => i.value)).toEqual(['details', 'related', 'activity']);
    expect(parsed.items[0].children[0].type).toBe('record:details');
    expect(parsed.items[1].children[0].properties.objectName).toBe('task');
  });

  it('the tab items survive the whole-page parse the server runs', () => {
    const body = createBody(leadDef, {
      related: [{ objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' }],
    });
    const page = PageSchema.parse(body) as any;
    const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
    expect(tabs.properties.items.map((i: any) => i.value)).toEqual(['details', 'related']);
    expect(tabs.properties.items[1].children[0].properties.relationshipField).toBe('lead_id');
  });
});
