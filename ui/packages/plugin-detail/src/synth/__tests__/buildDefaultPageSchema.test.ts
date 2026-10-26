/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { getRecordDisplayName } from '@object-ui/core';
import {
  buildDefaultPageSchema,
  buildDefaultHeader,
  buildDefaultActions,
  buildDefaultHighlights,
  buildDefaultTabs,
  buildDefaultDiscussion,
  buildDefaultAttachments,
  detectStatusField,
  deriveStages,
  declaredStageKinds,
  deriveHighlightFields,
  deriveFieldGroupDetailSections,
  resolveDetailSections,
  type ObjectDefLike,
} from '../buildDefaultPageSchema';

/**
 * A page component's props live in the node's `properties` bag — the spec's
 * canonical carrier, and since **ADR-0089 D3a** closed `PageComponentSchema`
 * with `.strict()`, the only spelling the server accepts on a page write
 * (objectui#4232: the flat spelling made Studio's page-create PUT fail, so no
 * page row was ever stored).
 *
 * Deliberately NOT tolerant — no `?? node` fallback to a top-level read. A
 * regression to the flat spelling turns every assertion reached through these
 * two helpers red, instead of quietly passing on the shape the server refuses.
 * The payload is pinned against the real spec schema in
 * `buildDefaultPageSchema.strictPayload.test.ts`.
 */
const props = (node: any): Record<string, any> => node?.properties ?? {};
/** A `page:tabs` node's tab items, out of that same bag. */
const tabItems = (node: any): any[] => props(node).items ?? [];

const leadDef: ObjectDefLike = {
  name: 'lead',
  label: 'Lead',
  fields: {
    first_name: { name: 'first_name', label: 'First Name', type: 'text' },
    last_name: { name: 'last_name', label: 'Last Name', type: 'text' },
    email: { name: 'email', label: 'Email', type: 'email' },
    phone: { name: 'phone', label: 'Phone', type: 'phone' },
    rating: { name: 'rating', label: 'Rating', type: 'text' },
    source: { name: 'source', label: 'Source', type: 'text' },
    owner_id: { name: 'owner_id', label: 'Owner', type: 'lookup' },
    status: {
      name: 'status',
      label: 'Status',
      type: 'picklist',
      options: [
        { value: 'new', label: 'New' },
        { value: 'contacted', label: 'Contacted' },
        { value: 'qualified', label: 'Qualified' },
      ],
    },
    created_at: { name: 'created_at', label: 'Created', type: 'datetime' },
  },
};

describe('detectStatusField', () => {
  it('returns null for undefined def', () => {
    expect(detectStatusField(undefined)).toBeNull();
  });

  it('honours explicit stageField', () => {
    expect(detectStatusField({ stageField: 'pipeline', fields: { pipeline: {} } }))
      .toBe('pipeline');
  });

  it('picks status by name', () => {
    expect(detectStatusField(leadDef)).toBe('status');
  });

  it('falls back to stage / state / phase', () => {
    expect(detectStatusField({ fields: { stage: {} } })).toBe('stage');
    expect(detectStatusField({ fields: { state: {} } })).toBe('state');
    expect(detectStatusField({ fields: { phase: {} } })).toBe('phase');
  });

  it('detects by type=status when no canonical name present', () => {
    expect(
      detectStatusField({ fields: { lifecycle: { type: 'status' } } }),
    ).toBe('lifecycle');
  });

  it('returns null when nothing matches', () => {
    expect(detectStatusField({ fields: { foo: {} } })).toBeNull();
  });
});

describe('deriveStages', () => {
  it('returns null when statusField missing', () => {
    expect(deriveStages(leadDef, null)).toBeNull();
  });

  it('returns null when field has no options', () => {
    expect(deriveStages({ fields: { status: {} } }, 'status')).toBeNull();
  });

  it('maps picklist options to {value,label}', () => {
    expect(deriveStages(leadDef, 'status')).toEqual([
      { value: 'new', label: 'New' },
      { value: 'contacted', label: 'Contacted' },
      { value: 'qualified', label: 'Qualified' },
    ]);
  });

  // objectui#12907: the option's declared lifecycle `kind` rides onto the stage.
  const loanDef = {
    fields: {
      status: {
        options: [
          { value: 'borrowed', label: 'Borrowed', kind: 'open' as const },
          { value: 'returned', label: 'Returned', kind: 'won' as const },
          { value: 'overdue', label: 'Overdue', kind: 'lost' as const },
          { value: 'lost_card', label: 'Lost card' },
        ],
      },
    },
  };

  it('carries a declared won / lost kind as terminal; open and undeclared get none', () => {
    expect(deriveStages(loanDef, 'status')).toEqual([
      { value: 'borrowed', label: 'Borrowed' },
      { value: 'returned', label: 'Returned', terminal: 'won' },
      { value: 'overdue', label: 'Overdue', terminal: 'lost' },
      { value: 'lost_card', label: 'Lost card' },
    ]);
  });

  it('declaredStageKinds lists only the options that declare a kind', () => {
    expect(declaredStageKinds(loanDef, 'status')).toEqual(
      new Map([
        ['borrowed', 'open'],
        ['returned', 'won'],
        ['overdue', 'lost'],
      ]),
    );
    expect(declaredStageKinds(leadDef, 'status')).toBeNull();
    expect(declaredStageKinds(loanDef, null)).toBeNull();
  });
});

describe('deriveHighlightFields', () => {
  it('honours explicit objectDef.highlightFields', () => {
    expect(deriveHighlightFields({ ...leadDef, highlightFields: ['email', 'phone'] }, 'status'))
      .toEqual(['email', 'phone']);
  });

  it('caps explicit list at max', () => {
    expect(
      deriveHighlightFields(
        { ...leadDef, highlightFields: ['a', 'b', 'c', 'd', 'e', 'f'] },
        null,
        3,
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('prefers owner / rating / source / phone / email and skips status', () => {
    const fields = deriveHighlightFields(leadDef, 'status');
    expect(fields).not.toContain('status');
    expect(fields).not.toContain('created_at');
    expect(fields).toContain('owner_id');
    expect(fields.length).toBeLessThanOrEqual(4);
  });

  it('falls back to any field order when preferred names absent, minus the H1 field', () => {
    const def: ObjectDefLike = { fields: { foo: {}, bar: {}, baz: {} } };
    // No conventional name field here, so the shared ADR-0079 ladder DERIVES
    // the title: the first title-eligible field in declaration order, `foo`.
    // The page H1 renders ITS value — so the strip sitting directly beneath
    // must not repeat it. Before objectui#7287 this module ran its own ladder,
    // whose literal five-name walk did not know `foo`; it returned null, and
    // `foo` was the first chip under a heading already showing it.
    expect(
      getRecordDisplayName(def, { id: 'r1', foo: 'Acme', bar: 'x', baz: 'y' }),
    ).toBe('Acme');
    expect(deriveHighlightFields(def, null)).toEqual(['bar', 'baz']);
  });

  it('skips system tenancy + audit fields (organization_id, created_by, etc.)', () => {
    const def: ObjectDefLike = {
      fields: {
        id: {},
        organization_id: {},
        created_by: {},
        updated_by: {},
        tenant_id: {},
        workspace_id: {},
        useful_field: {},
        another_useful: {},
      },
    };
    const fields = deriveHighlightFields(def, null);
    expect(fields).not.toContain('organization_id');
    expect(fields).not.toContain('created_by');
    expect(fields).not.toContain('updated_by');
    expect(fields).not.toContain('tenant_id');
    expect(fields).not.toContain('workspace_id');
    expect(fields).toContain('useful_field');
    expect(fields).toContain('another_useful');
  });

  it('skips the record title field to avoid duplicating the page H1', () => {
    const def = {
      // The DECLARED role, ADR-0079's canonical pointer. This fixture used to
      // spell it `primaryField` — a `DetailViewSchema` key that no object
      // payload can carry, and whose read this module dropped in
      // objectui#7287.
      nameField: 'subject',
      fields: {
        subject: {},
        name: {}, // common candidate also skipped
        priority: {},
        status: {},
        due_date: {},
        notes: {},
      },
    } as unknown as ObjectDefLike;
    const fields = deriveHighlightFields(def, 'status');
    expect(fields).not.toContain('subject');
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('status');
    expect(fields).toContain('priority');
  });
});

describe('buildDefaultPageSchema', () => {
  it('emits a record Page with the default template + main region', () => {
    const page = buildDefaultPageSchema(leadDef);
    expect(page.type).toBe('record');
    expect(page.pageType).toBe('record');
    expect(page.object).toBe('lead');
    // The spec retires `full-width` by name; a seed carrying it is refused at save.
    expect(page.template).toBe('default');
    expect(page.regions).toHaveLength(1);
    expect(page.regions[0].name).toBe('main');
  });

  it('emits page:header, record:highlights, record:path, page:tabs, record:discussion', () => {
    const types = buildDefaultPageSchema(leadDef).regions[0].components.map(
      (c: any) => c.type,
    );
    expect(types).toEqual([
      'page:header',
      'record:highlights',
      'record:path',
      'page:tabs',
      'record:discussion',
    ]);
  });

  it('omits record:path when no status field', () => {
    const def: ObjectDefLike = { name: 'note', fields: { body: {} } };
    const types = buildDefaultPageSchema(def).regions[0].components.map(
      (c: any) => c.type,
    );
    expect(types).not.toContain('record:path');
  });

  it('omits record:highlights when no fields derivable', () => {
    const def: ObjectDefLike = { name: 'empty', fields: {} };
    const types = buildDefaultPageSchema(def).regions[0].components.map(
      (c: any) => c.type,
    );
    expect(types).not.toContain('record:highlights');
  });

  it('hideDiscussion drops record:discussion', () => {
    const types = buildDefaultPageSchema(leadDef, { hideDiscussion: true })
      .regions[0].components.map((c: any) => c.type);
    expect(types).not.toContain('record:discussion');
  });

  it('hideHighlights / hidePath each drop their component', () => {
    const types = buildDefaultPageSchema(leadDef, {
      hideHighlights: true,
      hidePath: true,
    }).regions[0].components.map((c: any) => c.type);
    expect(types).not.toContain('record:highlights');
    expect(types).not.toContain('record:path');
  });

  it('options override auto-derivation', () => {
    const page = buildDefaultPageSchema(leadDef, {
      highlightFields: ['email'],
      statusField: 'rating',
      stages: [{ value: 'hot', label: 'Hot' }],
    });
    const hl = page.regions[0].components.find((c: any) => c.type === 'record:highlights');
    const path = page.regions[0].components.find((c: any) => c.type === 'record:path');
    expect(props(hl).fields).toEqual(['email']);
    expect(props(path).statusField).toBe('rating');
    expect(props(path).stages).toEqual([{ value: 'hot', label: 'Hot' }]);
  });

  it('page:header.recordChrome defaults to true and can be turned off', () => {
    const on = buildDefaultPageSchema(leadDef).regions[0].components[0];
    const off = buildDefaultPageSchema(leadDef, { recordChrome: false }).regions[0].components[0];
    expect(props(on).recordChrome).toBe(true);
    expect(props(off).recordChrome).toBe(false);
  });

  it('page:tabs always carries a details tab containing record:details', () => {
    const tabs = buildDefaultPageSchema(leadDef).regions[0].components.find(
      (c: any) => c.type === 'page:tabs',
    );
    expect(tabItems(tabs)).toHaveLength(1);
    expect(tabItems(tabs)[0].label).toBe('Details');
    expect(tabItems(tabs)[0].children[0].type).toBe('record:details');
  });

  it('handles undefined def gracefully', () => {
    const page = buildDefaultPageSchema(undefined);
    expect(page.type).toBe('record');
    expect(page.object).toBeUndefined();
    const types = page.regions[0].components.map((c: any) => c.type);
    // Should still emit page:header + page:tabs + record:discussion;
    // no highlights / path because the def is empty.
    expect(types).toEqual(['page:header', 'page:tabs', 'record:discussion']);
  });

  describe('slice 4 — headerActions / related / activity / history', () => {
    it('embeds headerActions into page:header.actions instead of a separate quick_actions node', () => {
      const page = buildDefaultPageSchema(leadDef, {
        headerActions: [
          { name: 'edit', label: 'Edit', locations: ['record_header'] },
        ],
      });
      const types = page.regions[0].components.map((c: any) => c.type);
      expect(types[0]).toBe('page:header');
      // No separate record:quick_actions sibling — actions live on the header.
      expect(types).not.toContain('record:quick_actions');
      const header = page.regions[0].components[0];
      expect(Array.isArray(props(header).actions)).toBe(true);
      expect(props(header).actions).toHaveLength(1);
      expect(props(header).actions[0].name).toBe('edit');
    });

    it('omits header.actions when headerActions empty or absent', () => {
      const noOpt = buildDefaultPageSchema(leadDef);
      const emptyOpt = buildDefaultPageSchema(leadDef, { headerActions: [] });
      const header1 = noOpt.regions[0].components[0];
      const header2 = emptyOpt.regions[0].components[0];
      expect(props(header1).actions).toBeUndefined();
      expect(props(header2).actions).toBeUndefined();
    });

    it('emits Related tab with one record:related_list per entry', () => {
      const page = buildDefaultPageSchema(leadDef, {
        // The Related tab is the default home for related lists. The
        // Reference Rail is opt-in (`showReferenceRail`), so it stays off
        // here and the Related tab renders even with 2+ related lists.
        related: [
          {
            objectName: 'task',
            relationshipField: 'lead_id',
            title: 'Tasks',
            limit: 10,
          },
          {
            objectName: 'note',
            relationshipField: 'parent_id',
          },
        ],
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabItems(tabs)).toHaveLength(2);
      expect(tabItems(tabs)[1].label).toBe('Related');
      expect(tabItems(tabs)[1].children).toHaveLength(2);
      expect(tabItems(tabs)[1].children[0].type).toBe('record:related_list');
      expect(props(tabItems(tabs)[1].children[0]).objectName).toBe('task');
      expect(props(tabItems(tabs)[1].children[0]).relationshipField).toBe('lead_id');
      expect(props(tabItems(tabs)[1].children[0]).limit).toBe(10);
    });

    it('promotes an isPrimary related list to its OWN tab (rule Z default)', () => {
      const tabs = buildDefaultTabs(leadDef, {
        related: [
          { objectName: 'opportunity', relationshipField: 'lead_id', title: 'Opportunities', isPrimary: true },
        ],
      });
      const labels = tabItems(tabs).map((t: any) => t.label);
      expect(labels).toEqual(['Details', 'Opportunities']);
      expect(labels).not.toContain('Related');
    });

    it('gives primary lists their own tab and collapses the rest into Related', () => {
      const tabs = buildDefaultTabs(leadDef, {
        related: [
          { objectName: 'opportunity', relationshipField: 'lead_id', title: 'Opportunities', isPrimary: true },
          { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
          { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
        ],
      });
      const labels = tabItems(tabs).map((t: any) => t.label);
      expect(labels).toEqual(['Details', 'Opportunities', 'Related']);
      const related = tabItems(tabs).find((t: any) => t.label === 'Related');
      expect(related.children).toHaveLength(2);
      expect(related.children.map((c: any) => props(c).objectName)).toEqual(['task', 'note']);
    });

    it("relatedLayout:'tabs' gives every related list its own tab, ignoring isPrimary", () => {
      const tabs = buildDefaultTabs(leadDef, {
        relatedLayout: 'tabs',
        related: [
          { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
          { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
        ],
      });
      const labels = tabItems(tabs).map((t: any) => t.label);
      expect(labels).toEqual(['Details', 'Tasks', 'Notes']);
      expect(labels).not.toContain('Related');
    });

    it("relatedLayout:'stack' collapses all lists into one Related tab, ignoring isPrimary", () => {
      const tabs = buildDefaultTabs(leadDef, {
        relatedLayout: 'stack',
        related: [
          { objectName: 'opportunity', relationshipField: 'lead_id', title: 'Opportunities', isPrimary: true },
          { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
        ],
      });
      const labels = tabItems(tabs).map((t: any) => t.label);
      expect(labels).toEqual(['Details', 'Related']);
      const related = tabItems(tabs).find((t: any) => t.label === 'Related');
      expect(related.children).toHaveLength(2);
    });

    it('does NOT emit a Reference Rail by default, keeping the Related tab', () => {
      const page = buildDefaultPageSchema(leadDef, {
        related: [
          { objectName: 'task', relationshipField: 'lead_id' },
          { objectName: 'note', relationshipField: 'parent_id' },
        ],
      });
      // No aside region — the rail is opt-in.
      expect(page.regions.find((r: any) => r.name === 'aside')).toBeUndefined();
      // Related tab survives (Details + Related).
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      const labels = tabItems(tabs).map((t: any) => t.label);
      expect(labels).toContain('Related');
    });

    it('emits a Reference Rail aside region and suppresses the duplicate Related tab when showReferenceRail is on and 2+ related lists are present', () => {
      const page = buildDefaultPageSchema(leadDef, {
        showReferenceRail: true,
        related: [
          { objectName: 'task', relationshipField: 'lead_id' },
          { objectName: 'note', relationshipField: 'parent_id' },
        ],
      });
      // Related tab is suppressed (Details only)
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabItems(tabs)).toHaveLength(1);
      expect(tabItems(tabs)[0].label).toBe('Details');
      // Aside region emitted with the rail
      const aside = page.regions.find((r: any) => r.name === 'aside');
      expect(aside).toBeDefined();
      expect(aside.components[0].type).toBe('record:reference_rail');
      expect(props(aside.components[0]).entries).toHaveLength(2);
      expect(props(aside.components[0]).entries[0].objectName).toBe('task');
    });

    it('emits aside region from slots.rightRail even without any related lists', () => {
      const page = buildDefaultPageSchema(leadDef, {
        slots: {
          rightRail: [
            { type: 'card', title: 'Workflow status', children: [] },
          ],
        },
      });
      const aside = page.regions.find((r: any) => r.name === 'aside');
      expect(aside).toBeDefined();
      // No reference rail (no related lists), only the slot contribution
      expect(aside.components).toHaveLength(1);
      expect(aside.components[0].type).toBe('card');
      expect(aside.components[0].title).toBe('Workflow status');
    });

    it('appends slots.rightRail after the auto-emitted reference rail', () => {
      const page = buildDefaultPageSchema(leadDef, {
        showReferenceRail: true,
        related: [
          { objectName: 'task', relationshipField: 'lead_id' },
          { objectName: 'note', relationshipField: 'parent_id' },
        ],
        slots: {
          rightRail: { type: 'card', title: 'Activity' },
        },
      });
      const aside = page.regions.find((r: any) => r.name === 'aside');
      expect(aside).toBeDefined();
      expect(aside.components).toHaveLength(2);
      expect(aside.components[0].type).toBe('record:reference_rail');
      expect(aside.components[1].type).toBe('card');
    });

    it('emits Activity tab when showActivity is true', () => {
      const page = buildDefaultPageSchema(leadDef, { showActivity: true });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      const labels = tabItems(tabs).map((t: any) => t.label);
      expect(labels).toContain('Activity');
      const act = tabItems(tabs).find((t: any) => t.label === 'Activity');
      expect(act.children[0].type).toBe('record:activity');
    });

    it('emits History tab with entries when history option provided', () => {
      const entries = [
        { id: '1', timestamp: '2025-01-01', action: 'created' },
      ];
      const page = buildDefaultPageSchema(leadDef, {
        history: { entries, loading: false },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      const hist = tabItems(tabs).find((t: any) => t.label === 'History');
      expect(hist).toBeDefined();
      expect(hist.children[0].type).toBe('record:history');
      expect(props(hist.children[0]).entries).toEqual(entries);
      expect(props(hist.children[0]).loading).toBe(false);
    });

    it('Details / Related / Activity / History tab order is stable', () => {
      const page = buildDefaultPageSchema(leadDef, {
        related: [{ objectName: 'task', relationshipField: 'lead_id' }],
        showActivity: true,
        history: { entries: [], loading: false },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabItems(tabs).map((t: any) => t.label)).toEqual([
        'Details',
        'Related',
        'Activity',
        'History',
      ]);
    });

    describe("relatedLayout: 'tabs'", () => {
      const related = [
        {
          objectName: 'task',
          relationshipField: 'lead_id',
          title: 'Tasks',
          limit: 10,
          icon: 'check',
        },
        {
          objectName: 'note',
          relationshipField: 'parent_id',
        },
      ];

      it("gives each related list its own peer tab instead of one shared Related tab", () => {
        const page = buildDefaultPageSchema(leadDef, {
          related,
          relatedLayout: 'tabs',
        });
        const tabs = page.regions[0].components.find(
          (c: any) => c.type === 'page:tabs',
        );
        // Details + one tab per related child (no shared 'Related' tab).
        expect(tabItems(tabs).map((t: any) => t.label)).toEqual([
          'Details',
          'Tasks',
          'note',
        ]);
        const tasksTab = tabItems(tabs)[1];
        expect(tasksTab.icon).toBe('check');
        expect(tasksTab.children).toHaveLength(1);
        expect(tasksTab.children[0].type).toBe('record:related_list');
        expect(props(tasksTab.children[0]).objectName).toBe('task');
        expect(props(tasksTab.children[0]).relationshipField).toBe('lead_id');
        expect(props(tasksTab.children[0]).limit).toBe(10);
        // The second related child (no title) falls back to its objectName.
        expect(props(tabItems(tabs)[2].children[0]).objectName).toBe('note');
      });

      it("defaults to the stacked 'Related' tab when relatedLayout is omitted", () => {
        const page = buildDefaultPageSchema(leadDef, { related });
        const tabs = page.regions[0].components.find(
          (c: any) => c.type === 'page:tabs',
        );
        expect(tabItems(tabs).map((t: any) => t.label)).toEqual([
          'Details',
          'Related',
        ]);
        expect(tabItems(tabs)[1].children).toHaveLength(2);
      });

      it("still honours hideRelatedTab (no related tabs emitted)", () => {
        const page = buildDefaultPageSchema(leadDef, {
          related,
          relatedLayout: 'tabs',
          hideRelatedTab: true,
        });
        const tabs = page.regions[0].components.find(
          (c: any) => c.type === 'page:tabs',
        );
        expect(tabItems(tabs).map((t: any) => t.label)).toEqual(['Details']);
      });

      it("keeps Activity / History after the per-table tabs", () => {
        const page = buildDefaultPageSchema(leadDef, {
          related,
          relatedLayout: 'tabs',
          showActivity: true,
          history: { entries: [], loading: false },
        });
        const tabs = page.regions[0].components.find(
          (c: any) => c.type === 'page:tabs',
        );
        expect(tabItems(tabs).map((t: any) => t.label)).toEqual([
          'Details',
          'Tasks',
          'note',
          'Activity',
          'History',
        ]);
      });
    });
  });

  describe('slice I — slot overrides', () => {
    it('replaces the page:header node when slots.header is provided', () => {
      const page = buildDefaultPageSchema(leadDef, {
        slots: { header: { type: 'div', children: 'Custom Header' } },
      });
      const first = page.regions[0].components[0];
      expect(first.type).toBe('div');
      expect(first.children).toBe('Custom Header');
      // header slot should suppress the default page:header
      const hasDefaultHeader = page.regions[0].components.some(
        (c: any) => c.type === 'page:header',
      );
      expect(hasDefaultHeader).toBe(false);
    });

    it('accepts an array slot and flattens it in place', () => {
      const page = buildDefaultPageSchema(leadDef, {
        slots: {
          header: [
            { type: 'div', id: 'banner' },
            { type: 'page:header' },
          ],
        },
      });
      const types = page.regions[0].components.slice(0, 2).map((c: any) => c.type);
      expect(types).toEqual(['div', 'page:header']);
    });

    it('actions slot overrides even when headerActions is empty', () => {
      const page = buildDefaultPageSchema(leadDef, {
        slots: { actions: { type: 'div', id: 'custom-bar' } },
      });
      const hasCustom = page.regions[0].components.some(
        (c: any) => c.type === 'div' && c.id === 'custom-bar',
      );
      expect(hasCustom).toBe(true);
    });

    it('highlights slot replaces the entire chips+path strip', () => {
      const page = buildDefaultPageSchema(leadDef, {
        slots: { highlights: { type: 'div', id: 'custom-strip' } },
      });
      const has = (t: string, id?: string) =>
        page.regions[0].components.some(
          (c: any) => c.type === t && (id == null || c.id === id),
        );
      expect(has('div', 'custom-strip')).toBe(true);
      expect(has('record:highlights')).toBe(false);
      expect(has('record:path')).toBe(false);
    });

    it('details slot replaces only the Details tab body, keeps other tabs', () => {
      const page = buildDefaultPageSchema(leadDef, {
        related: [{ objectName: 'task', relationshipField: 'lead_id' }],
        history: { entries: [], loading: false },
        slots: { details: { type: 'div', id: 'custom-details' } },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabItems(tabs).map((t: any) => t.label)).toEqual([
        'Details',
        'Related',
        'History',
      ]);
      expect(tabItems(tabs)[0].children).toEqual([{ type: 'div', id: 'custom-details' }]);
      // record:details default body must be gone
      const firstBodyType = tabItems(tabs)[0].children[0].type;
      expect(firstBodyType).toBe('div');
    });

    it('tabs slot wins over details slot when both provided', () => {
      // Authored verbatim, in the caller's own spelling: a slot node is the
      // author's, and the synthesizer places it UNTOUCHED — it does not
      // re-shape someone else's tree (objectui#4232 canonicalizes the nodes
      // this file BUILDS, not the ones it is handed).
      const slotNode = { type: 'page:tabs', items: [{ label: 'Only', children: [] }] };
      const page = buildDefaultPageSchema(leadDef, {
        slots: {
          tabs: slotNode,
          details: { type: 'div', id: 'unused' },
        },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabs).toEqual(slotNode);
      expect(tabs.items).toHaveLength(1);
      expect(tabs.items[0].label).toBe('Only');
      // details slot was not applied
      const hasUnused = page.regions[0].components.some(
        (c: any) => c.id === 'unused',
      );
      expect(hasUnused).toBe(false);
    });

    it('discussion slot overrides even when hideDiscussion is true', () => {
      const page = buildDefaultPageSchema(leadDef, {
        hideDiscussion: true,
        slots: { discussion: { type: 'div', id: 'custom-discussion' } },
      });
      const last = page.regions[0].components[page.regions[0].components.length - 1];
      expect(last.id).toBe('custom-discussion');
    });

    it('omitted slots fall through to synth defaults', () => {
      const page = buildDefaultPageSchema(leadDef, {
        slots: { header: { type: 'div', id: 'h' } },
      });
      // header replaced, but discussion + tabs + highlights still default
      const types = page.regions[0].components.map((c: any) => c.type);
      expect(types).toContain('record:highlights');
      expect(types).toContain('record:path');
      expect(types).toContain('page:tabs');
      expect(types).toContain('record:discussion');
    });
  });

  describe('slice I — sub-builders', () => {
    it('buildDefaultHeader returns a page:header node with recordChrome default true', () => {
      const node = buildDefaultHeader(leadDef);
      expect(node).toEqual({ type: 'page:header', properties: { recordChrome: true } });
    });

    it('buildDefaultActions returns null for empty actions list', () => {
      expect(buildDefaultActions(leadDef, [])).toBeNull();
      expect(buildDefaultActions(leadDef, undefined)).toBeNull();
    });

    it('buildDefaultActions returns a quick_actions node when actions are provided', () => {
      const node = buildDefaultActions(leadDef, [{ id: 'edit', label: 'Edit' }]);
      expect(node?.type).toBe('record:quick_actions');
      expect(props(node).location).toBe('record_header');
      expect(props(node).actions).toHaveLength(1);
    });

    it('buildDefaultHighlights returns [chips, path] when status field is present', () => {
      const nodes = buildDefaultHighlights(leadDef);
      const types = nodes.map((n) => n.type);
      expect(types).toContain('record:highlights');
      expect(types).toContain('record:path');
    });

    it('buildDefaultHighlights respects hideHighlights / hidePath flags', () => {
      const nodes = buildDefaultHighlights(leadDef, {
        hideHighlights: true,
        hidePath: true,
      });
      expect(nodes).toHaveLength(0);
    });

    it('buildDefaultTabs emits Details/Related/Activity/History in order', () => {
      const tabs = buildDefaultTabs(leadDef, {
        related: [{ objectName: 'task', relationshipField: 'lead_id' }],
        showActivity: true,
        history: { entries: [], loading: false },
      });
      expect(tabs.type).toBe('page:tabs');
      expect(tabItems(tabs).map((t: any) => t.label)).toEqual([
        'Details',
        'Related',
        'Activity',
        'History',
      ]);
    });

    it('buildDefaultDiscussion returns the record:discussion node', () => {
      expect(buildDefaultDiscussion()).toEqual({ type: 'record:discussion' });
    });

    it('buildDefaultAttachments returns the record:attachments node', () => {
      expect(buildDefaultAttachments()).toEqual({ type: 'record:attachments' });
    });
  });

  // objectstack#4358 — `enable.files` objects get a peer Attachments tab
  // (with a count badge derived by PageTabsRenderer) instead of the legacy
  // below-the-feed append that a growing timeline buried.
  describe('attachments tab (enable.files, objectstack#4358)', () => {
    const filesDef: ObjectDefLike = { ...leadDef, enable: { files: true } };

    it('no enable.files → no record:attachments anywhere', () => {
      const page = buildDefaultPageSchema(leadDef);
      expect(JSON.stringify(page)).not.toContain('record:attachments');
    });

    it('enable.files → tabs carry an Attachments tab wrapping record:attachments', () => {
      const page = buildDefaultPageSchema(filesDef);
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      const tab = tabItems(tabs).find((t: any) => t.value === 'attachments');
      expect(tab).toBeDefined();
      expect(tab.label).toBe('Attachments');
      expect(tab.children).toEqual([{ type: 'record:attachments' }]);
      // The discussion footer is untouched — attachments are a tab, not a
      // footer widget.
      const components = page.regions[0].components;
      expect(components[components.length - 1].type).toBe('record:discussion');
    });

    it('the Attachments tab sits after Related and before Activity/History', () => {
      const tabs = buildDefaultTabs(filesDef, {
        related: [{ objectName: 'task', relationshipField: 'lead_id' }],
        showActivity: true,
        history: { entries: [], loading: false },
      });
      expect(tabItems(tabs).map((t: any) => t.value)).toEqual([
        'details',
        'related',
        'attachments',
        'activity',
        'history',
      ]);
    });

    it('hideAttachments suppresses the tab', () => {
      const page = buildDefaultPageSchema(filesDef, { hideAttachments: true });
      expect(JSON.stringify(page)).not.toContain('record:attachments');
    });

    it('a details slot override keeps the Attachments tab', () => {
      const page = buildDefaultPageSchema(filesDef, {
        slots: { details: { type: 'div', id: 'custom-details' } },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabItems(tabs).some((t: any) => t.value === 'attachments')).toBe(true);
      expect(tabItems(tabs)[0].children[0].id).toBe('custom-details');
    });
  });

  // objectui#3461 — records with approval requests get a peer Approvals tab
  // wrapping `record:approvals`, fed the host's LIVE approvals read through
  // the node payload so the tab and the header decision buttons can never
  // disagree. No requests → no option passed → no dead tab.
  describe('approvals tab (objectui#3461)', () => {
    const nodePayload = {
      approvals: { available: true, requests: [{ id: 'req_1' }], pendingRequest: null },
      currentUserId: 'u_1',
    };

    it('no approvals option → no record:approvals anywhere', () => {
      const page = buildDefaultPageSchema(leadDef);
      expect(JSON.stringify(page)).not.toContain('record:approvals');
    });

    it('approvals option → tabs carry an Approvals tab wrapping record:approvals with the payload', () => {
      const page = buildDefaultPageSchema(leadDef, {
        approvals: { count: 2, node: nodePayload },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      const tab = tabItems(tabs).find((t: any) => t.value === 'approvals');
      expect(tab).toBeDefined();
      expect(tab.label).toBe('Approvals');
      expect(tab.count).toBe(2);
      expect(tab.children).toEqual([{ type: 'record:approvals', properties: { ...nodePayload } }]);
    });

    it('the Approvals tab sits after Related and before Attachments/Activity/History', () => {
      const tabs = buildDefaultTabs({ ...leadDef, enable: { files: true } }, {
        related: [{ objectName: 'task', relationshipField: 'lead_id' }],
        showActivity: true,
        history: { entries: [], loading: false },
        approvals: { node: nodePayload },
      });
      expect(tabItems(tabs).map((t: any) => t.value)).toEqual([
        'details',
        'related',
        'approvals',
        'attachments',
        'activity',
        'history',
      ]);
    });

    it('a details slot override keeps the Approvals tab', () => {
      const page = buildDefaultPageSchema(leadDef, {
        approvals: { node: nodePayload },
        slots: { details: { type: 'div', id: 'custom-details' } },
      });
      const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
      expect(tabItems(tabs).some((t: any) => t.value === 'approvals')).toBe(true);
      expect(tabItems(tabs)[0].children[0].id).toBe('custom-details');
    });
  });
});

// ADR-0085 — top-level semantic roles (stageField / highlightFields).
describe('semantic-role hints (ADR-0085 / #2065)', () => {
  describe('detectStatusField', () => {
    it('an explicit stageField wins over heuristics', () => {
      expect(
        detectStatusField({
          stageField: 'pipeline',
          fields: { pipeline: {}, status: {} },
        }),
      ).toBe('pipeline');
    });

    it('stageField: false suppresses detection entirely', () => {
      expect(
        detectStatusField({
          stageField: false,
          fields: { status: { type: 'status' } },
        }),
      ).toBeNull();
    });

    it('falls back to the heuristic when no role is declared', () => {
      expect(detectStatusField({ fields: { status: {} } })).toBe('status');
    });
  });

  describe('deriveHighlightFields', () => {
    it('reads the highlightFields semantic role', () => {
      expect(
        deriveHighlightFields({ ...leadDef, highlightFields: ['phone', 'rating'] }, 'status'),
      ).toEqual(['phone', 'rating']);
    });

    it('ignores the retired compactLayout spelling (framework#2536) — heuristic applies instead', () => {
      // The cast is the case, not a workaround for it: `compactLayout` was
      // RETIRED, so `ObjectDefLike` rejecting it is the type doing its job, and
      // spelling it here in a typed position would only be asserting that the
      // retirement happened. What this case is about is the other half — an
      // object definition arriving as untyped runtime metadata (a stored record,
      // a hand-written JSON file) that still carries the old key. Widening the
      // type to admit it would un-retire it; asserting through `Record` models
      // the untyped source exactly and leaves the verdict below untouched.
      const retiredSpelling = { ...leadDef, compactLayout: ['email', 'phone'] } as Record<
        string,
        unknown
      > as ObjectDefLike;
      const derived = deriveHighlightFields(retiredSpelling, 'status');
      expect(derived).not.toEqual(['email', 'phone']);
    });

    it('drops non-string entries and caps the declared list at max', () => {
      expect(
        deriveHighlightFields(
          { highlightFields: ['a', '', { name: 'x' } as any, 'b', 'c', 'd'], fields: {} },
          null,
          3,
        ),
      ).toEqual(['a', 'b', 'c']);
    });

    it('drops the record title field from a declared list — it is already the H1 (#2548)', () => {
      const def: ObjectDefLike = {
        fields: { name: {}, status: {}, amount: {} },
        highlightFields: ['name', 'status', 'amount'],
      };
      expect(deriveHighlightFields(def, null)).toEqual(['status', 'amount']);
      // Filtering happens BEFORE the cap, so the title never wastes a slot.
      const wide: ObjectDefLike = {
        fields: { name: {}, a: {}, b: {}, c: {}, d: {} },
        highlightFields: ['name', 'a', 'b', 'c', 'd'],
      };
      expect(deriveHighlightFields(wide, null)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('title resolution honours declared roles over conventional names', () => {
      const def = {
        // ADR-0079's canonical pointer, which outranks the conventional
        // `name`. (`primaryField` stood here until objectui#7287 — a
        // `DetailViewSchema` key read off an object def.)
        nameField: 'subject',
        fields: { subject: {}, name: {}, status: {} },
        highlightFields: ['subject', 'name', 'status'],
      } as unknown as ObjectDefLike;
      // The declared role wins → `subject` is the H1 and drops; the literal
      // `name` field is NOT the title here and stays a chip.
      expect(deriveHighlightFields(def, null)).toEqual(['name', 'status']);
    });
  });
});

describe('deriveFieldGroupDetailSections (#2148)', () => {
  const groupedDef: ObjectDefLike = {
    name: 'account',
    fieldGroups: [
      { key: 'basic', label: '基本信息' },
      { key: 'finance', label: '财务', collapsible: true, collapsed: true },
      { key: 'unused', label: 'Empty group' },
    ],
    fields: {
      name: { label: 'Name', type: 'text', group: 'basic' },
      industry: { label: 'Industry', type: 'select', group: 'basic' },
      revenue: { label: 'Revenue', type: 'currency', group: 'finance' },
      website: { label: 'Website', type: 'url' },
      secret: { label: 'Secret', type: 'text', group: 'basic', hidden: true },
      created_at: { label: 'Created', type: 'datetime' },
      organization_id: { label: 'Org', type: 'text' },
    },
  };

  it('passes group icon/description through to the section descriptors (#2548)', () => {
    const def: ObjectDefLike = {
      name: 'zoo',
      fieldGroups: [
        {
          key: 'money',
          label: 'Money',
          icon: 'banknote',
          description: 'Financial fields.',
          collapse: 'collapsed',
        },
      ],
      fields: { budget: { label: 'Budget', type: 'currency', group: 'money' } },
    };
    const sections = deriveFieldGroupDetailSections(def)!;
    expect(sections[0]).toMatchObject({
      name: 'money',
      icon: 'banknote',
      description: 'Financial fields.',
      collapsible: true,
      defaultCollapsed: true,
    });
  });

  it('returns sections in declared order with collapse passthrough, dropping empty groups', () => {
    const sections = deriveFieldGroupDetailSections(groupedDef)!;
    expect(sections.map((s: any) => s.name)).toEqual(['basic', 'finance', undefined]);
    expect(sections[0].label).toBe('基本信息');
    expect(sections[0].fields.map((f: any) => f.name)).toEqual(['name', 'industry']);
    expect(sections[1]).toMatchObject({
      name: 'finance',
      label: '财务',
      collapsible: true,
      defaultCollapsed: true,
    });
    // 'unused' group has no fields → dropped.
    expect(sections.some((s: any) => s.name === 'unused')).toBe(false);
  });

  it('collects ungrouped fields into a trailing untitled section, skipping audit/system fields', () => {
    const sections = deriveFieldGroupDetailSections(groupedDef)!;
    const trailing = sections[sections.length - 1];
    expect(trailing.name).toBeUndefined();
    expect(trailing.label).toBeUndefined();
    expect(trailing.fields.map((f: any) => f.name)).toEqual(['website']);
  });

  it('honours the canonical collapse enum (ADR-0085)', () => {
    const sections = deriveFieldGroupDetailSections({
      fieldGroups: [
        { key: 'a', label: 'A', collapse: 'collapsed' },
        { key: 'b', label: 'B', collapse: 'expanded' },
      ],
      fields: { x: { group: 'a' }, y: { group: 'b' } },
    })!;
    expect(sections[0]).toMatchObject({ name: 'a', collapsible: true, defaultCollapsed: true });
    expect(sections[1]).toMatchObject({ name: 'b', collapsible: true });
    expect(sections[1].defaultCollapsed).toBeUndefined();
  });

  it('keeps audit fields an author EXPLICITLY grouped', () => {
    const def: ObjectDefLike = {
      fieldGroups: [{ key: 'meta', label: 'Meta' }],
      fields: {
        title: { type: 'text' },
        created_at: { type: 'datetime', group: 'meta' },
      },
    };
    const sections = deriveFieldGroupDetailSections(def)!;
    expect(sections[0].fields.map((f: any) => f.name)).toEqual(['created_at']);
  });

  it('skips hidden fields even when grouped', () => {
    const sections = deriveFieldGroupDetailSections(groupedDef)!;
    const basic = sections.find((s: any) => s.name === 'basic')!;
    expect(basic.fields.map((f: any) => f.name)).not.toContain('secret');
  });

  it('emits rich field descriptors (label / type / options)', () => {
    const sections = deriveFieldGroupDetailSections(groupedDef)!;
    expect(sections[0].fields[1]).toMatchObject({
      name: 'industry',
      label: 'Industry',
      type: 'select',
    });
  });

  it('returns null when grouping does not apply', () => {
    // No fieldGroups at all.
    expect(deriveFieldGroupDetailSections(leadDef)).toBeNull();
    // Declared groups but no field references one.
    expect(
      deriveFieldGroupDetailSections({
        fieldGroups: [{ key: 'g1' }],
        fields: { a: {}, b: {} },
      }),
    ).toBeNull();
    // Undefined def.
    expect(deriveFieldGroupDetailSections(undefined)).toBeNull();
  });

  it('ignores keyless / malformed group entries', () => {
    expect(
      deriveFieldGroupDetailSections({
        fieldGroups: [{ label: 'No key' } as any, null as any],
        fields: { a: { group: 'x' } },
      }),
    ).toBeNull();
  });
});

describe('resolveDetailSections priority (ADR-0085)', () => {
  const groupedDef: ObjectDefLike = {
    fieldGroups: [{ key: 'g', label: 'G' }],
    fields: { a: { group: 'g' }, b: {} },
  };

  it('explicit options.sections wins', () => {
    const explicit = [{ label: 'Explicit', fields: ['a'] }];
    expect(resolveDetailSections(groupedDef, explicit)).toBe(explicit);
  });

  it('derives from fieldGroups last, else undefined', () => {
    // A declared group is emitted as the spec's `{ group }` reference
    // (objectui#11630) — `record:details` resolves its heading and members.
    const derived = resolveDetailSections(groupedDef)!;
    expect(derived[0]).toEqual({ group: 'g', columns: expect.any(Number) });
    expect(resolveDetailSections(leadDef)).toBeUndefined();
    expect(resolveDetailSections(undefined)).toBeUndefined();
  });

  it('empty options.sections array does not shadow the fallbacks', () => {
    const derived = resolveDetailSections(groupedDef, [])!;
    expect(derived[0]).toMatchObject({ group: 'g' });
  });
});

describe('buildDefaultPageSchema integration (#2148)', () => {
  it('record:details picks up fieldGroups-derived sections when no options.sections', () => {
    const def: ObjectDefLike = {
      name: 'account',
      fieldGroups: [{ key: 'basic', label: 'Basic' }],
      fields: {
        name: { type: 'text', group: 'basic' },
        website: { type: 'url' },
      },
    };
    const page = buildDefaultPageSchema(def);
    const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
    const details = tabItems(tabs)[0].children[0];
    expect(details.type).toBe('record:details');
    expect(props(details).sections[0]).toMatchObject({ group: 'basic' });
  });

  it('stageField: false drops record:path', () => {
    const def: ObjectDefLike = {
      ...leadDef,
      stageField: false,
    };
    const types = buildDefaultPageSchema(def).regions[0].components.map((c: any) => c.type);
    expect(types).not.toContain('record:path');
  });
});

describe('buildDefaultTabs — stable tab values (objectui#2257)', () => {
  const relA = { title: 'Invoices', objectName: 'invoice', relationshipField: 'account', isPrimary: true };
  const relB = { title: 'Notes', objectName: 'note', relationshipField: 'account' };

  it('emits semantic values: details / related:<child> (primary) / related (rest) / activity / history', () => {
    const tabs = buildDefaultTabs(undefined, {
      related: [relA, relB],
      showActivity: true,
      history: { entries: [], loading: false },
    });
    expect(tabItems(tabs).map((i: any) => i.value)).toEqual([
      'details', 'related:invoice', 'related', 'activity', 'history',
    ]);
  });

  it('relatedLayout tabs → every child gets related:<child>; stack → one related', () => {
    const asTabs = buildDefaultTabs(undefined, { related: [relA, relB], relatedLayout: 'tabs' });
    expect(tabItems(asTabs).map((i: any) => i.value)).toEqual(['details', 'related:invoice', 'related:note']);
    const stacked = buildDefaultTabs(undefined, { related: [relA, relB], relatedLayout: 'stack' });
    expect(tabItems(stacked).map((i: any) => i.value)).toEqual(['details', 'related']);
  });

  it('values stay stable when the related list shrinks (URL tokens must not shift)', () => {
    const both = buildDefaultTabs(undefined, { related: [relA, relB] });
    const onlyB = buildDefaultTabs(undefined, { related: [relB] });
    // 'related' names the same (stacked) tab in both trees — an index value
    // would have pointed at 'related:invoice' before and 'related' after.
    expect(tabItems(both).some((i: any) => i.value === 'related')).toBe(true);
    expect(tabItems(onlyB).some((i: any) => i.value === 'related')).toBe(true);
  });
});
