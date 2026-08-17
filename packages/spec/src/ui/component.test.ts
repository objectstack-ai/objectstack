import { describe, it, expect } from 'vitest';
import {
  PageHeaderProps,
  PageTabsProps,
  PageCardProps,
  PageContainerProps,
  RecordPathProps,
  RecordDetailsProps,
  RecordRelatedListProps,
  RecordHighlightsProps,
  RecordActivityProps,
  RecordChatterProps,
  PageAccordionProps,
  ComponentPropsMap,
  ElementTextPropsSchema,
  ElementNumberPropsSchema,
  ElementImagePropsSchema,
  ElementButtonPropsSchema,
  ElementFilterPropsSchema,
  ElementFormPropsSchema,
  ElementRecordPickerPropsSchema,
  ElementTextInputPropsSchema,
} from './component.zod';
import { PageComponentSchema, PageSchema, ElementDataSourceSchema } from './page.zod';

describe('PageHeaderProps', () => {
  it('should accept minimal header', () => {
    const result = PageHeaderProps.parse({ title: 'My Page' });
    expect(result.title).toBe('My Page');
    expect(result.breadcrumb).toBe(true);
    expect(result.subtitle).toBeUndefined();
    expect(result.actions).toBeUndefined();
  });

  it('should accept full header with all fields', () => {
    const header = {
      title: 'Dashboard',
      subtitle: 'Overview',
      breadcrumb: false,
      actions: ['action-1', 'action-2'],
    };
    const result = PageHeaderProps.parse(header);
    expect(result.breadcrumb).toBe(false);
    expect(result.actions).toHaveLength(2);
  });

  // #7702, maintainer ruling 2026-08-11: `title` is OPTIONAL. The platform's
  // own synthesizer (objectui `buildDefaultHeader`) emits every seeded
  // `page:header` with no `title` — the renderer falls through to the
  // record-derived heading. `PageHeaderProps.safeParse` on that exact
  // emission shape must succeed; it used to fail with `title: Invalid input`.
  it('accepts a header without title — the synthesized shape (#7702)', () => {
    // objectui `buildDefaultHeader`'s real emission: `{ type: 'page:header',
    // recordChrome, ...(actions?) }` — no `title` key at all.
    const result = PageHeaderProps.parse({ recordChrome: true });
    expect(result.title).toBeUndefined();
    expect(result.recordChrome).toBe(true);
  });

  it('accepts a completely empty header — every field optional or defaulted', () => {
    const result = PageHeaderProps.parse({});
    expect(result.title).toBeUndefined();
    expect(result.breadcrumb).toBe(true);
  });

  it('still validates a present title as an I18nLabel', () => {
    expect(() => PageHeaderProps.parse({ title: 42 })).toThrow();
    expect(PageHeaderProps.parse({ title: 'My Page' }).title).toBe('My Page');
  });
});

// #6776 — the three record-chrome switches objectui's header renderer has always
// read (`containers.tsx:979-981`) and `PageHeaderProps` never declared. Until
// this declaration objectui's published manifest called them legal while
// `validateComponentProps` (#5068) called them undeclared — two platform
// authorities disagreeing about one key (#5435), with the renderer siding with
// the author.
describe('PageHeaderProps recordChrome / showStar / showCopyId (#6776)', () => {
  it('defaults all three ON — an unauthored header keeps the record chrome', () => {
    const result = PageHeaderProps.parse({ title: 'Lead' });
    expect(result.recordChrome).toBe(true);
    expect(result.showStar).toBe(true);
    expect(result.showCopyId).toBe(true);
  });

  it('accepts the console preview sample verbatim (`recordChrome: false` on a non-record page)', () => {
    // objectui `apps/console/src/preview-samples.ts:68` — the exact shape that
    // was reported as an undeclared key before this card.
    const result = PageHeaderProps.parse({ title: 'Welcome to the CRM', recordChrome: false });
    expect(result.recordChrome).toBe(false);
  });

  it('accepts the star and copy-id switches independently', () => {
    const result = PageHeaderProps.parse({ title: 'Lead', showStar: false, showCopyId: false });
    expect(result.showStar).toBe(false);
    expect(result.showCopyId).toBe(false);
    // Still a record header — only the two chips inside it are off.
    expect(result.recordChrome).toBe(true);
  });

  it('rejects a non-boolean rather than silently stripping it', () => {
    expect(() => PageHeaderProps.parse({ title: 'Lead', recordChrome: 'false' })).toThrow();
    expect(() => PageHeaderProps.parse({ title: 'Lead', showStar: 'no' })).toThrow();
  });
});

// #6946 — the header icon, retired by maintainer ruling 2026-08-09
// (objectui#3829 route (c)). objectui resolves `icon` only per header ACTION;
// the header's own bag is never asked for one, and the registration publishes
// no `icon` input. Four in-repo pages authored it and none ever drew it.
describe('PageHeaderProps icon is retired (#6946)', () => {
  it('rejects the retired `icon` with its prescription', () => {
    expect(() => PageHeaderProps.parse({ title: 'Connect an Agent', icon: 'bot' }))
      .toThrow(/`icon`.*removed.*`recordChrome`/s);
  });

  it('does not materialize the retired `icon` on a clean parse', () => {
    expect(PageHeaderProps.parse({ title: 'Connect an Agent' })).not.toHaveProperty('icon');
  });

  // The live half of the same key name, one component over: `page:header`
  // DOES read `actions` off its props bag and keeps it. A strip scoped by key
  // name rather than by component type would have taken this with it.
  it('keeps `actions`, which the header renderer does read', () => {
    expect(PageHeaderProps.parse({ title: 'Lead', actions: ['convert_lead'] }).actions)
      .toEqual(['convert_lead']);
  });
});

describe('PageTabsProps', () => {
  it('should accept valid tabs with defaults', () => {
    const tabs = {
      items: [{ label: 'Tab 1', children: [] }],
    };
    const result = PageTabsProps.parse(tabs);
    expect(result.tabStyle).toBe('line');
    expect(result.position).toBe('top');
    expect(result.items).toHaveLength(1);
  });

  it('should accept tabs with all options', () => {
    const tabs = {
      tabStyle: 'card' as const,
      position: 'left' as const,
      items: [{ label: 'Tab 1', icon: 'settings', children: ['child1'] }],
    };
    expect(() => PageTabsProps.parse(tabs)).not.toThrow();
  });

  it('should reject invalid tabStyle enum', () => {
    expect(() => PageTabsProps.parse({ tabStyle: 'invalid', items: [] })).toThrow();
  });

  it('should reject tabs without items', () => {
    expect(() => PageTabsProps.parse({})).toThrow();
  });

  // Conditional tabs (#2606) — item-level `visibleWhen` (ADR-0089 canonical name).
  it('should accept an item-level visibleWhen predicate (bare CEL string → envelope)', () => {
    const result = PageTabsProps.parse({
      items: [
        { label: 'Contracts', visibleWhen: 'record.status == "customer"', children: [] },
        { label: 'Details', children: [] },
      ],
    });
    expect(result.items[0].visibleWhen).toEqual({
      dialect: 'cel',
      source: 'record.status == "customer"',
    });
    // Items without the predicate are untouched — additive, back-compatible.
    expect(result.items[1].visibleWhen).toBeUndefined();
  });

  it('should accept an item-level visibleWhen Expression envelope', () => {
    const result = PageTabsProps.parse({
      items: [
        {
          label: 'Contracts',
          visibleWhen: { dialect: 'cel', source: "page.mode != ''" },
          children: [],
        },
      ],
    });
    expect(result.items[0].visibleWhen).toEqual({ dialect: 'cel', source: "page.mode != ''" });
  });

  it('does NOT accept the deprecated `visibility` alias on tab items (new surface, canonical key only)', () => {
    // ADR-0089 D2 aliases exist for keys with legacy metadata; tab items never
    // had a visibility key, so only canonical `visibleWhen` is declared.
    //
    // ⚠️ What changed at #4001 batch A is the CHANNEL, not the verdict: the
    // alias used to be dropped by the parse like any unknown key, and is now
    // rejected by it. The assertion below is the same claim measured on the
    // other side of the same fact — `visibility` is not a spelling this surface
    // accepts — and it is strictly stronger, because a drop is a claim about
    // the output while a rejection is one the author actually sees.
    const rejected = PageTabsProps.safeParse({
      items: [{ label: 'Contracts', visibility: 'record.status == \"customer\"', children: [] }],
    });
    expect(rejected.success).toBe(false);
    expect(JSON.stringify(rejected.error!.issues)).toContain('visibility');

    // And the canonical spelling on the same surface still parses — the
    // positive control that keeps the assertion above from passing for the
    // wrong reason (a tab item that rejects everything would satisfy it too).
    expect(
      PageTabsProps.parse({
        items: [{ label: 'Contracts', visibleWhen: 'record.status == \"customer\"', children: [] }],
      }).items[0].visibleWhen,
    ).toBeDefined();
  });
});

// #6776 — the tab strip's visual style moves from `type` to `tabStyle`.
//
// This is an acceptance-face change in BOTH directions, so both are pinned: the
// new key is accepted, and the old one is REFUSED BY NAME with the prescription
// rather than being stripped in silence (the retiredKey contract). The reason
// the concept had to change spelling at all is structural, not aesthetic: a
// props key named `type` collides with the page component's own dispatch key,
// which is why objectui's `SchemaRenderer.tsx:253,264` refuses to hoist
// `properties.type` and why `sdui-parser`'s `BASE_PROPS` (`validate.ts:20-30`)
// skips it before any validation runs.
describe('PageTabsProps tabStyle — renamed from `type` (#6776)', () => {
  it('accepts the three declared styles under the new key', () => {
    for (const tabStyle of ['line', 'card', 'pill'] as const) {
      expect(PageTabsProps.parse({ tabStyle, items: [] }).tabStyle).toBe(tabStyle);
    }
  });

  it('rejects the retired `type` with the rename prescription', () => {
    // Not `.toThrow()` alone: an undeclared key on this non-strict schema would
    // be stripped silently, and a bare throw assertion cannot tell the two
    // apart. The message IS the migration doc, so it is what gets asserted.
    expect(() => PageTabsProps.parse({ type: 'card', items: [] }))
      .toThrow(/`type`.*removed.*`tabStyle`/s);
  });

  it('does not materialize the retired `type` on a clean parse', () => {
    expect(PageTabsProps.parse({ tabStyle: 'card', items: [] })).not.toHaveProperty('type');
  });

  it('still refuses a value outside the enum under the new key', () => {
    expect(() => PageTabsProps.parse({ tabStyle: 'underline', items: [] })).toThrow();
  });
});

// #6776 — `page:accordion.variant`, read at objectui `containers.tsx:734` and
// visible on screen (`flush` draws the divider, `card` leaves the border to the
// panel's own content), declared nowhere until now.
describe('PageAccordionProps variant (#6776)', () => {
  const accordion = ComponentPropsMap['page:accordion'];

  it('defaults to `flush` — the renderer default, now stated in the contract', () => {
    const result = accordion.parse({ items: [] }) as { variant?: string };
    expect(result.variant).toBe('flush');
  });

  it('accepts the `card` opt-in the renderer invites authors to write', () => {
    const result = accordion.parse({
      items: [{ label: 'Details', children: [] }],
      variant: 'card',
    }) as { variant?: string };
    expect(result.variant).toBe('card');
  });

  it('rejects a variant outside the two the renderer branches on', () => {
    expect(() => accordion.parse({ items: [], variant: 'bordered' })).toThrow();
  });
});

// #5775 — the two tab-item keys the renderer honours and the schema did not
// declare. `value` is the load-bearing one: it is the `?tab=` token, and the
// index-derived fallback (`tab-<i>`) silently points at a different tab as soon
// as the item list changes. Declaring it is what unblocks #5776, whose showcase
// page authors this slot as `key` — neither spelling the renderer reads.
describe('PageTabsProps items[].value / items[].count (#5775)', () => {
  it('accepts a stable `value` token and an explicit `count`', () => {
    const result = PageTabsProps.parse({
      items: [
        { label: 'Details', value: 'details', children: [] },
        { label: 'Tasks', value: 'related:task', count: 3, children: [] },
      ],
    });
    expect(result.items[0]!.value).toBe('details');
    expect(result.items[1]!.count).toBe(3);
  });

  it('leaves both undefined when unauthored — the renderer derives them', () => {
    const result = PageTabsProps.parse({ items: [{ label: 'Details', children: [] }] });
    expect(result.items[0]!.value).toBeUndefined();
    expect(result.items[0]!.count).toBeUndefined();
  });

  it('rejects a non-integer count rather than silently stripping it', () => {
    expect(() => PageTabsProps.parse({
      items: [{ label: 'Tasks', count: 'many', children: [] }],
    })).toThrow();
  });
});

describe('PageCardProps', () => {
  it('should accept empty card with defaults', () => {
    const result = PageCardProps.parse({});
    expect(result.bordered).toBe(true);
    expect(result.title).toBeUndefined();
    expect(result.actions).toBeUndefined();
    expect(result.children).toBeUndefined();
    expect(result.footer).toBeUndefined();
  });

  it('should accept full card', () => {
    const card = {
      title: 'Info Card',
      bordered: false,
      children: ['component1'],
      footer: ['footer-component'],
    };
    const result = PageCardProps.parse(card);
    expect(result.title).toBe('Info Card');
    expect(result.bordered).toBe(false);
    expect(result.children).toEqual(['component1']);
  });

  // #5775 — `children` is the composition key on every container, and the card
  // renderer already reads it (`schema.body ?? schema.children`). `body` was
  // the second spelling of the same slot and is tombstoned; `footer` is a
  // genuinely distinct slot and stays.
  it('accepts the showcase card shape verbatim (my-work.page.ts:64)', () => {
    const result = PageCardProps.parse({
      title: 'Shortcuts',
      children: [{ type: 'element:text', properties: { content: 'Delivery Operations' } }],
    });
    expect(result.children).toHaveLength(1);
  });

  it('rejects the retired `body` with the rename prescription', () => {
    expect(() => PageCardProps.parse({ body: ['component1'] }))
      .toThrow(/`body`.*removed.*`children`/s);
  });

  it('does not materialize the retired `body` on a clean parse', () => {
    expect(PageCardProps.parse({ children: [] })).not.toHaveProperty('body');
  });

  // #6946 — the card's action list, retired by maintainer ruling 2026-08-09
  // (objectui#3829 route (c)). `PageCardRenderer` builds its `<Card>` from
  // title/bordered/children/footer and has no actions area; the objectui
  // registration publishes no `actions` input either. The prescription points
  // at composition, which is what actually renders.
  it('rejects the retired `actions` with the composition prescription', () => {
    expect(() => PageCardProps.parse({ title: 'Shortcuts', actions: ['new_task'] }))
      .toThrow(/`actions`.*removed.*`children`.*`footer`/s);
  });

  it('does not materialize the retired `actions` on a clean parse', () => {
    expect(PageCardProps.parse({ title: 'Shortcuts', children: [] })).not.toHaveProperty('actions');
  });
});

describe('PageContainerProps — page:section / page:footer / page:sidebar (#5775)', () => {
  // These three were declared `EmptyProps` ("zero props") while their renderers
  // have always rendered `schema.children || schema.body`. Declaring zero props
  // for a container that renders children is the ADR-0078 shape from the schema
  // side: the #5068 gate reported every authored `children` as an unknown key.
  it('declares `children` on all three thin containers', () => {
    for (const type of ['page:section', 'page:footer', 'page:sidebar'] as const) {
      const result = ComponentPropsMap[type].parse({
        children: [{ type: 'element:text' }],
      }) as { children?: unknown[] };
      expect(result.children).toHaveLength(1);
    }
  });

  it('keeps `children` optional — an empty container is still valid', () => {
    expect(PageContainerProps.parse({})).toEqual({});
  });

  // `body` is NOT a second authorable spelling here (Prime Directive #12). The
  // renderers keep reading it as a back-compat fallback for stored documents;
  // that fallback is objectui's to retire on its own schedule.
  //
  // #4001 batch A closed this shape, so the same verdict now arrives as a
  // rejection carrying the rename rather than as a silent drop — which is the
  // whole difference the campaign is buying, and the reason the prescription is
  // a hand-written `guidance` entry: `body` → `children` is not a distance the
  // suggester can cross.
  it('does not declare `body` as a second composition key', () => {
    const rejected = PageContainerProps.safeParse({ body: ['x'] });
    expect(rejected.success).toBe(false);
    const message = rejected.error!.issues.map((i) => i.message).join('\n');
    expect(message).toContain('`body`');
    expect(message).toContain('children');
  });
});

describe('RecordDetailsProps', () => {
  it('should accept empty with defaults', () => {
    const result = RecordDetailsProps.parse({});
    expect(result.columns).toBe('2');
    expect(result.sections).toBeUndefined();
  });

  it('should reject invalid column value', () => {
    expect(() => RecordDetailsProps.parse({ columns: '5' })).toThrow();
  });

  // #5611: `sections` is the OBJECT form — the only form any page authors and
  // the only form any renderer reads. These fixtures are lifted verbatim from
  // the real pages so the schema is pinned to authored reality, not to a shape
  // invented here. Before this change every one of them was an `invalid_type`
  // rejection at `sections[0]` (the old `z.array(z.string())`), and the whole
  // `hideFields` key was silently stripped.
  it('accepts the showcase section shape verbatim (project-detail.page.ts:49)', () => {
    const details = {
      sections: [
        { label: 'Overview', columns: 2, fields: ['name', 'account', 'owner', 'status'] },
        { label: 'Financials', columns: 2, fields: ['budget', 'spent'] },
        { label: 'Timeline', columns: 2, fields: ['start_date', 'end_date'] },
      ],
    };
    const result = RecordDetailsProps.parse(details);
    expect(result.sections).toHaveLength(3);
    expect(result.sections?.[0]).toEqual({
      label: 'Overview',
      columns: 2,
      fields: ['name', 'account', 'owner', 'status'],
    });
    // `columns: 1` is authored too (task-detail.page.ts:76).
    expect(() =>
      RecordDetailsProps.parse({ sections: [{ label: 'Details', columns: 1, fields: ['notes'] }] }),
    ).not.toThrow();
  });

  it('accepts a section with no columns (sys-user.page.ts:118)', () => {
    const result = RecordDetailsProps.parse({
      sections: [{ label: 'Identity', fields: ['name', 'image'] }],
    });
    expect(result.sections?.[0].columns).toBeUndefined();
    expect(result.sections?.[0].fields).toEqual(['name', 'image']);
  });

  it('accepts an untitled section and a `name`-anchored one', () => {
    // No label: the renderer draws it borderless. No name: it is untranslatable
    // by construction, which is what `translation-section-name-missing` reports.
    expect(() => RecordDetailsProps.parse({ sections: [{ fields: ['notes'] }] })).not.toThrow();
    // `name` is the i18n anchor a lint rule tells authors to add, so the schema
    // must accept it — the rule and the schema cannot disagree.
    const named = RecordDetailsProps.parse({
      sections: [{ name: 'identity', label: 'Identity', fields: ['name'] }],
    });
    expect(named.sections?.[0].name).toBe('identity');
  });

  it('requires `fields` on every section', () => {
    const r = RecordDetailsProps.safeParse({ sections: [{ label: 'Empty' }] });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].path).toEqual(['sections', 0, 'fields']);
  });

  it('rejects the retired ID-list form rather than silently half-reading it', () => {
    const r = RecordDetailsProps.safeParse({ sections: ['overview'] });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].code).toBe('invalid_type');
    expect(r.success === false && r.error.issues[0].path).toEqual(['sections', 0]);
  });

  it('rejects an out-of-range section column count', () => {
    expect(() =>
      RecordDetailsProps.parse({ sections: [{ label: 'Wide', columns: 5, fields: ['a'] }] }),
    ).toThrow();
  });

  it('preserves hideFields verbatim (sys-user.page.ts:106)', () => {
    // Undeclared until #5611, so a non-strict `z.object` dropped it on the
    // floor: the platform page's hidden-field list survived only because
    // nothing ever parsed these props.
    const hideFields = ['id', 'banned', 'ban_reason', 'ban_expires', 'email', 'role'];
    const result = RecordDetailsProps.parse({
      hideFields,
      sections: [{ label: 'Audit', fields: ['created_at', 'updated_at'] }],
    });
    expect(result.hideFields).toEqual(hideFields);
  });

  // #6946 — the mode selector whose two declared modes were never implemented,
  // retired by maintainer ruling 2026-08-09 (objectui#3818). Unlike the other
  // two keys in that ruling this one WAS read — against `inline`/`compact`,
  // values this enum never permitted — so both legal values took the same
  // branch and the key selected nothing.
  it('rejects the retired `layout` with its prescription', () => {
    expect(() => RecordDetailsProps.parse({ layout: 'custom' }))
      .toThrow(/`layout`.*removed.*`sections`.*`highlightFields`/s);
    // The declared default is refused too — `auto` was never distinguishable
    // from `custom` or from omitting the key.
    expect(() => RecordDetailsProps.parse({ layout: 'auto' }))
      .toThrow(/`layout`.*removed/s);
  });

  it('does not materialize the retired `layout` on a clean parse', () => {
    expect(RecordDetailsProps.parse({ sections: [{ label: 'Overview', fields: ['name'] }] }))
      .not.toHaveProperty('layout');
  });

  // The live half of the same key name, one component over.
  it('leaves `record:highlights` layout alone — a different, honoured key', () => {
    expect(RecordHighlightsProps.parse({ fields: ['status'], layout: 'horizontal' }).layout)
      .toBe('horizontal');
  });
});

describe('RecordRelatedListProps', () => {
  it('should accept valid related list', () => {
    const props = {
      objectName: 'contact',
      relationshipField: 'account_id',
      columns: ['name', 'email'],
    };
    const result = RecordRelatedListProps.parse(props);
    expect(result.limit).toBe(5);
    expect(result.sort).toBeUndefined();
  });

  it('should accept full related list with optional fields', () => {
    const props = {
      objectName: 'opportunity',
      relationshipField: 'account_id',
      columns: ['name', 'amount'],
      sort: 'created_at',
      limit: 10,
    };
    expect(() => RecordRelatedListProps.parse(props)).not.toThrow();
  });

  it('should reject without required fields', () => {
    expect(() => RecordRelatedListProps.parse({})).toThrow();
    expect(() => RecordRelatedListProps.parse({ objectName: 'x' })).toThrow();
  });

  it('should accept a related list without columns (columns derive from the child object)', () => {
    const props = { objectName: 'contact', relationshipField: 'account_id' };
    expect(() => RecordRelatedListProps.parse(props)).not.toThrow();
    expect(RecordRelatedListProps.parse(props).columns).toBeUndefined();
  });
});

describe('RecordHighlightsProps', () => {
  it('should accept valid highlights', () => {
    const props = { fields: ['name', 'status', 'amount'] };
    const result = RecordHighlightsProps.parse(props);
    expect(result.fields).toHaveLength(3);
  });

  it('should reject empty fields array (min 1)', () => {
    expect(() => RecordHighlightsProps.parse({ fields: [] })).toThrow();
  });

  it('should reject more than 7 fields', () => {
    expect(() => RecordHighlightsProps.parse({ fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })).toThrow();
  });

  it('should reject missing fields', () => {
    expect(() => RecordHighlightsProps.parse({})).toThrow();
  });

  // #5176 — `readonly` is a declared key on the object member of
  // RecordHighlightsField. objectui's HeaderHighlight gate reads it to keep a
  // hook-maintained column non-editable; before it was declared the object
  // member (non-strict) silently stripped it, so the authored intent never
  // reached the renderer contract at all.
  it('should preserve an authored readonly on an object-form highlight field', () => {
    const props = {
      fields: [{ name: 'supply_share', readonly: true, type: 'number' }],
    };
    const result = RecordHighlightsProps.parse(props);
    const entry = result.fields[0] as { name: string; readonly?: boolean; type?: string };
    expect(entry.name).toBe('supply_share');
    expect(entry.type).toBe('number');
    expect(entry.readonly).toBe(true);
  });

  it('should preserve readonly: false rather than dropping it', () => {
    const result = RecordHighlightsProps.parse({ fields: [{ name: 'amount', readonly: false }] });
    const entry = result.fields[0] as { readonly?: boolean };
    expect(entry.readonly).toBe(false);
  });

  it('should leave readonly undefined when it is not authored (no default materialized)', () => {
    const result = RecordHighlightsProps.parse({ fields: [{ name: 'amount' }] });
    const entry = result.fields[0] as { readonly?: boolean };
    expect(entry).not.toHaveProperty('readonly');
    expect(entry.readonly).toBeUndefined();
  });

  it('should reject a non-boolean readonly instead of silently stripping it', () => {
    expect(() => RecordHighlightsProps.parse({ fields: [{ name: 'amount', readonly: 'yes' }] })).toThrow();
  });

  it('should still accept bare-string and other object-form highlight fields', () => {
    const result = RecordHighlightsProps.parse({
      fields: ['name', { name: 'status', label: 'State', icon: 'flag' }],
    });
    expect(result.fields[0]).toBe('name');
    expect(result.fields[1]).toEqual({ name: 'status', label: 'State', icon: 'flag' });
  });
});

describe('ComponentPropsMap', () => {
  it('should contain structure components', () => {
    expect(ComponentPropsMap['page:header']).toBeDefined();
    expect(ComponentPropsMap['page:tabs']).toBeDefined();
    expect(ComponentPropsMap['page:card']).toBeDefined();
    expect(ComponentPropsMap['page:footer']).toBeDefined();
    expect(ComponentPropsMap['page:sidebar']).toBeDefined();
    expect(ComponentPropsMap['page:accordion']).toBeDefined();
    expect(ComponentPropsMap['page:section']).toBeDefined();
  });

  it('should contain record components', () => {
    expect(ComponentPropsMap['record:details']).toBeDefined();
    expect(ComponentPropsMap['record:related_list']).toBeDefined();
    expect(ComponentPropsMap['record:highlights']).toBeDefined();
    expect(ComponentPropsMap['record:activity']).toBeDefined();
    expect(ComponentPropsMap['record:chatter']).toBeDefined();
    expect(ComponentPropsMap['record:path']).toBeDefined();
  });

  it('should contain AI components', () => {
    expect(ComponentPropsMap['ai:chat_window']).toBeDefined();
    expect(ComponentPropsMap['ai:suggestion']).toBeDefined();
  });

  it('should parse ai:chat_window with default', () => {
    const result = ComponentPropsMap['ai:chat_window'].parse({});
    expect(result.mode).toBe('float');
  });

  it('should parse ai:suggestion with optional context', () => {
    const result = ComponentPropsMap['ai:suggestion'].parse({});
    expect(result.context).toBeUndefined();
  });

  it('should parse empty props schemas for utility components', () => {
    expect(() => ComponentPropsMap['page:footer'].parse({})).not.toThrow();
    expect(() => ComponentPropsMap['global:search'].parse({})).not.toThrow();
    expect(() => ComponentPropsMap['user:profile'].parse({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Content Elements in PageComponentType
// ---------------------------------------------------------------------------
describe('Content Elements', () => {
  it('should accept element:text component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:text',
      properties: { content: 'Hello World' },
    })).not.toThrow();
  });

  it('should accept element:number component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:number',
      properties: { object: 'order', aggregate: 'count' },
    })).not.toThrow();
  });

  it('should accept element:image component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:image',
      properties: { src: '/images/banner.jpg' },
    })).not.toThrow();
  });

  it('should accept element:divider component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:divider',
      properties: {},
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Element Props Schemas
// ---------------------------------------------------------------------------
describe('ElementTextPropsSchema', () => {
  it('should accept minimal text props', () => {
    const props = ElementTextPropsSchema.parse({ content: 'Hello' });
    expect(props.content).toBe('Hello');
    expect(props.variant).toBe('body');
    expect(props.align).toBe('left');
  });

  it('should accept full text props', () => {
    const props = ElementTextPropsSchema.parse({
      content: '# Welcome',
      variant: 'heading',
      align: 'center',
    });
    expect(props.variant).toBe('heading');
    expect(props.align).toBe('center');
  });

  it('should accept all variants', () => {
    const variants = ['heading', 'subheading', 'body', 'caption'] as const;
    variants.forEach(variant => {
      expect(() => ElementTextPropsSchema.parse({ content: 'Test', variant })).not.toThrow();
    });
  });

  it('should reject without content', () => {
    expect(() => ElementTextPropsSchema.parse({})).toThrow();
  });
});

describe('ElementNumberPropsSchema', () => {
  it('should accept minimal number props', () => {
    const props = ElementNumberPropsSchema.parse({
      object: 'order',
      aggregate: 'count',
    });
    expect(props.object).toBe('order');
    expect(props.aggregate).toBe('count');
    expect(props.field).toBeUndefined();
  });

  it('should accept full number props', () => {
    const props = ElementNumberPropsSchema.parse({
      object: 'order',
      field: 'amount',
      aggregate: 'sum',
      filter: { status: 'paid' },
      format: 'currency',
      prefix: '$',
      suffix: ' USD',
    });
    expect(props.format).toBe('currency');
    expect(props.prefix).toBe('$');
    expect(props.suffix).toBe(' USD');
  });

  it('should accept all aggregate functions', () => {
    const aggregates = ['count', 'sum', 'avg', 'min', 'max'] as const;
    aggregates.forEach(aggregate => {
      expect(() => ElementNumberPropsSchema.parse({ object: 'order', aggregate })).not.toThrow();
    });
  });

  it('should accept all format options', () => {
    const formats = ['number', 'currency', 'percent'] as const;
    formats.forEach(format => {
      expect(() => ElementNumberPropsSchema.parse({ object: 'order', aggregate: 'count', format })).not.toThrow();
    });
  });

  it('should reject without required fields', () => {
    expect(() => ElementNumberPropsSchema.parse({})).toThrow();
    expect(() => ElementNumberPropsSchema.parse({ object: 'order' })).toThrow();
  });
});

describe('ElementImagePropsSchema', () => {
  it('should accept minimal image props', () => {
    const props = ElementImagePropsSchema.parse({ src: '/images/hero.jpg' });
    expect(props.src).toBe('/images/hero.jpg');
    expect(props.fit).toBe('cover');
  });

  it('should accept full image props', () => {
    const props = ElementImagePropsSchema.parse({
      src: '/images/banner.png',
      alt: 'Company banner',
      fit: 'contain',
      height: 200,
    });
    expect(props.alt).toBe('Company banner');
    expect(props.fit).toBe('contain');
    expect(props.height).toBe(200);
  });

  it('should accept all fit modes', () => {
    const fits = ['cover', 'contain', 'fill'] as const;
    fits.forEach(fit => {
      expect(() => ElementImagePropsSchema.parse({ src: '/img.png', fit })).not.toThrow();
    });
  });

  it('should reject without src', () => {
    expect(() => ElementImagePropsSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComponentPropsMap content elements
// ---------------------------------------------------------------------------
describe('ComponentPropsMap content elements', () => {
  it('should contain element:text', () => {
    expect(ComponentPropsMap['element:text']).toBeDefined();
  });

  it('should contain element:number', () => {
    expect(ComponentPropsMap['element:number']).toBeDefined();
  });

  it('should contain element:image', () => {
    expect(ComponentPropsMap['element:image']).toBeDefined();
  });

  it('should contain element:divider', () => {
    expect(ComponentPropsMap['element:divider']).toBeDefined();
  });

  it('should parse element:text props', () => {
    const result = ComponentPropsMap['element:text'].parse({ content: 'Hello' });
    expect(result.content).toBe('Hello');
  });

  it('should parse element:number props', () => {
    const result = ComponentPropsMap['element:number'].parse({
      object: 'order',
      aggregate: 'count',
    });
    expect(result.object).toBe('order');
  });

  it('should parse element:image props', () => {
    const result = ComponentPropsMap['element:image'].parse({ src: '/img.png' });
    expect(result.src).toBe('/img.png');
  });

  it('should parse element:divider (empty props)', () => {
    expect(() => ComponentPropsMap['element:divider'].parse({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:button
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:button', () => {
  it('should accept element:button component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:button',
      properties: { label: 'Submit' },
    })).not.toThrow();
  });

  it('should parse element:button props with defaults', () => {
    const props = ElementButtonPropsSchema.parse({ label: 'Save' });
    expect(props.label).toBe('Save');
    expect(props.variant).toBe('primary');
    expect(props.size).toBe('medium');
    expect(props.iconPosition).toBe('left');
    expect(props.disabled).toBe(false);
  });

  it('should accept full button props', () => {
    const props = ElementButtonPropsSchema.parse({
      label: 'Delete',
      variant: 'danger',
      size: 'large',
      icon: 'trash',
      iconPosition: 'right',
      disabled: true,
    });
    expect(props.variant).toBe('danger');
    expect(props.icon).toBe('trash');
    expect(props.disabled).toBe(true);
  });

  it('should accept all button variants', () => {
    const variants = ['primary', 'secondary', 'danger', 'ghost', 'link'] as const;
    variants.forEach(variant => {
      expect(() => ElementButtonPropsSchema.parse({ label: 'Btn', variant })).not.toThrow();
    });
  });

  it('should reject button without label', () => {
    expect(() => ElementButtonPropsSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:filter (RETIRED at element grain, #9220)
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:filter (retired, #9220)', () => {
  // The node-level parse never judged `properties` (that is the #5068 props
  // gate's job), and `type` is an open union — so a stored, not-yet-migrated
  // node still parses at THIS level. Pinned so the element retirement is not
  // misread as a node-level refusal.
  it('still parses at the node level — the refusal lives at the props dispatch', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:filter',
      properties: { object: 'order', fields: ['status'] },
    })).not.toThrow();
  });

  // #9220 tombstones — ADR-0049 enforce-or-remove at ELEMENT grain: no
  // renderer for `element:filter` ever shipped anywhere, so every authorable
  // key refuses with the element-retirement prescription. The former accept
  // shape (`{ object, fields }`) is the exact input that must now refuse.
  it('rejects every former accept shape with the element-retirement prescription', () => {
    expect(() => ElementFilterPropsSchema.parse({ object: 'order', fields: ['status'] }))
      .toThrow(/`element:filter` property `object`.*removed.*`element:filter` element is retired.*Delete the `element:filter` component/s);
    expect(() => ElementFilterPropsSchema.parse({ layout: 'sidebar' }))
      .toThrow(/`element:filter` property `layout`.*removed.*Delete the `element:filter` component/s);
    expect(() => ElementFilterPropsSchema.parse({ showSearch: true }))
      .toThrow(/`element:filter` property `showSearch`.*removed/s);
    expect(() => ElementFilterPropsSchema.parse({ aria: { label: 'Filter' } }))
      .toThrow(/`element:filter` property `aria`.*removed/s);
  });

  // Flip of "should accept filter with targetVariable" — #9198 deliberately
  // left this element's `targetVariable` untouched as out-of-scope; #9220
  // retires it with its element, and the prescription carries the migrate
  // sentence (the D2 conversion `element-filter-removed` strips it).
  it('rejects the retired `targetVariable` with its prescription', () => {
    expect(() => ElementFilterPropsSchema.parse({ targetVariable: 'active_filter' }))
      .toThrow(/`element:filter` property `targetVariable`.*removed.*Run `os migrate meta --from 17` to rewrite existing sources automatically/s);
  });

  // The migrated shape — `element-filter-removed` strips all six keys and
  // leaves the bare node — parses clean and materializes nothing. (The
  // pre-retirement schema REQUIRED `object` + `fields`, so `{}` used to
  // throw; the requiredness died with the element.)
  it('parses a bare (migrated) node clean and materializes nothing', () => {
    const props = ElementFilterPropsSchema.parse({});
    for (const key of ['object', 'fields', 'targetVariable', 'layout', 'showSearch', 'aria']) {
      expect(props).not.toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:form
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:form', () => {
  it('should accept element:form component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:form',
      properties: { object: 'contact' },
    })).not.toThrow();
  });

  it('should parse form props with defaults', () => {
    const props = ElementFormPropsSchema.parse({ object: 'contact' });
    expect(props.object).toBe('contact');
    expect(props.mode).toBe('create');
  });

  it('should accept full form props', () => {
    const props = ElementFormPropsSchema.parse({
      object: 'contact',
      fields: ['name', 'email', 'phone'],
      mode: 'edit',
      submitLabel: 'Update Contact',
      onSubmit: 'navigate_to("page_detail")',
    });
    expect(props.mode).toBe('edit');
    expect(props.fields).toHaveLength(3);
    expect(props.submitLabel).toBe('Update Contact');
  });

  it('should reject form without object', () => {
    expect(() => ElementFormPropsSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:record_picker
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:record_picker', () => {
  it('should accept element:record_picker component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:record_picker',
      properties: { object: 'account', labelField: 'name' },
    })).not.toThrow();
  });

  it('should parse record_picker props with defaults', () => {
    const props = ElementRecordPickerPropsSchema.parse({
      object: 'account',
      labelField: 'name',
    });
    expect(props.object).toBe('account');
    expect(props.labelField).toBe('name');
  });

  it('should accept full record_picker props', () => {
    const props = ElementRecordPickerPropsSchema.parse({
      object: 'account',
      labelField: 'name',
      valueField: 'id',
      label: 'Account',
      filter: { status: 'active' },
      placeholder: 'Search accounts...',
      emptyText: 'No accounts',
    });
    expect(props.labelField).toBe('name');
    expect(props.valueField).toBe('id');
    expect(props.label).toBe('Account');
    expect(props.emptyText).toBe('No accounts');
  });

  it('should reject record_picker without its one required field', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({})).toThrow();
  });

  // #5775 — `object` is the ONLY required prop. `labelField` is optional
  // because the renderer defaults it to `name` (`props.labelField ?? 'name'`),
  // so omitting it is a working picker, not a broken one. This is the half of
  // the ruling that lets the showcase's `page-variables` page stop reporting
  // `component-props-invalid` (a required key it had no reason to write).
  it('accepts a picker with `object` alone — labelField defaults in the renderer', () => {
    const props = ElementRecordPickerPropsSchema.parse({ object: 'account' });
    expect(props.object).toBe('account');
    expect(props.labelField).toBeUndefined();
  });

  it('accepts the showcase picker shape verbatim (page-variables.page.ts:59)', () => {
    const props = ElementRecordPickerPropsSchema.parse({
      label: 'Project',
      labelField: 'name',
      placeholder: 'Choose a project…',
      object: 'showcase_project',
    });
    expect(props.labelField).toBe('name');
    expect(props.label).toBe('Project');
  });

  // #5775 tombstones — the prescription IS the payload. `displayField` was a
  // REQUIRED declaration no renderer read; `searchFields` / `multiple` were
  // capability claims the single-select control never kept (ADR-0049).
  it('rejects the retired `displayField` with the rename prescription', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', displayField: 'title' }))
      .toThrow(/displayField.*removed.*use `labelField`|displayField.*removed.*`labelField`/s);
  });

  it('rejects the retired `searchFields` with its prescription', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', searchFields: ['name'] }))
      .toThrow(/`searchFields`.*removed.*Delete the key/s);
  });

  it('rejects the retired `multiple` with its prescription', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', multiple: true }))
      .toThrow(/`multiple`.*removed.*Delete the key/s);
  });

  it('does not materialize the retired keys on a clean parse', () => {
    const props = ElementRecordPickerPropsSchema.parse({ object: 'a' });
    expect(props).not.toHaveProperty('displayField');
    expect(props).not.toHaveProperty('searchFields');
    expect(props).not.toHaveProperty('multiple');
    expect(props).not.toHaveProperty('targetVariable');
  });

  // #9198 tombstone — `targetVariable` was a declarative hint with zero
  // readers; the live binding is the page variable whose `source` names this
  // component's `id` (ADR-0049 enforce-or-remove).
  it('rejects the retired `targetVariable` with its prescription', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', targetVariable: 'selected_id' }))
      .toThrow(/`targetVariable`.*removed.*Delete the key/s);
  });

  // ── #6276 — the flat `sort` / `limit` shorthands ─────────────────────────
  // The renderer resolves four keys through one pattern
  // (`ds.<k> ?? props.<k>`); after #5775 two of the four flat spellings were
  // declared and two were not. These pin the other two, in BOTH halves of what
  // a declaration buys: the key is retained (not stripped into silence) and the
  // VALUE is judged (a wrong shape is rejected by name rather than dropped).
  it('retains the flat `sort` shorthand — declared, not stripped (#6276)', () => {
    const props = ElementRecordPickerPropsSchema.parse({
      object: 'showcase_project',
      sort: [{ field: 'created_at', order: 'desc' }],
    });
    expect(props.sort).toEqual([{ field: 'created_at', order: 'desc' }]);
  });

  it('retains the flat `limit` shorthand — declared, not stripped (#6276)', () => {
    const props = ElementRecordPickerPropsSchema.parse({ object: 'showcase_project', limit: 20 });
    expect(props.limit).toBe(20);
  });

  // The exact ADR-0078 trap the issue reported: an author who infers
  // `properties.limit: 20` from the declared `object`/`filter` spelling used to
  // get the renderer's default 50 with zero diagnostics, because the key was
  // stripped before anything could read it.
  it('rejects a non-integer / non-positive `limit` by name (#6276)', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', limit: 0 })).toThrow(/limit/);
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', limit: -5 })).toThrow(/limit/);
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', limit: 2.5 })).toThrow(/limit/);
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', limit: 'ten' })).toThrow(/limit/);
  });

  it('rejects a malformed `sort` by name (#6276)', () => {
    // A bare field name — the shape an author reaches for when the key is
    // undeclared and nothing has ever told them otherwise.
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', sort: 'created_at' }))
      .toThrow(/sort/);
    // Right container, wrong direction vocabulary.
    expect(() => ElementRecordPickerPropsSchema.parse({
      object: 'a',
      sort: [{ field: 'created_at', order: 'descending' }],
    })).toThrow(/sort/);
    // Right container, missing the required half of the pair.
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'a', sort: [{ field: 'created_at' }] }))
      .toThrow(/sort/);
  });

  // The shorthand IS the `dataSource` key, so one value must parse identically
  // through both doors. This is what stops the flat spelling drifting into a
  // third sort dialect (the ledger's `report.zod.ts` row records three already).
  it('parses `sort` / `limit` identically to `dataSource` (one shape, two spellings) (#6276)', () => {
    const sort = [{ field: 'name', order: 'asc' as const }];
    const viaProps = ElementRecordPickerPropsSchema.parse({ object: 'a', sort, limit: 25 });
    const viaDataSource = ElementDataSourceSchema.parse({ object: 'a', sort, limit: 25 });
    expect(viaProps.sort).toEqual(viaDataSource.sort);
    expect(viaProps.limit).toEqual(viaDataSource.limit);
    // …and the same rejections on the same values.
    expect(ElementRecordPickerPropsSchema.safeParse({ object: 'a', limit: 0 }).success)
      .toBe(ElementDataSourceSchema.safeParse({ object: 'a', limit: 0 }).success);
    expect(ElementRecordPickerPropsSchema.safeParse({ object: 'a', sort: 'name' }).success)
      .toBe(ElementDataSourceSchema.safeParse({ object: 'a', sort: 'name' }).success);
  });

  // The renderer's `?? 50` is a RENDERER fallback, deliberately not a schema
  // default: `.default(50)` would materialize a limit on every parsed picker
  // and turn an unset key into an authored one (and would then have to be kept
  // in sync with objectui by hand).
  it('does not default `limit` — the 50 is the renderer fallback (#6276)', () => {
    const props = ElementRecordPickerPropsSchema.parse({ object: 'a' });
    expect(props.limit).toBeUndefined();
    expect(props.sort).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:text_input
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:text_input', () => {
  it('should accept element:text_input component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:text_input',
      properties: { label: 'Workspace name' },
    })).not.toThrow();
  });

  it('should parse text_input props with defaults', () => {
    const props = ElementTextInputPropsSchema.parse({});
    expect(props.inputType).toBe('text');
    expect(props.required).toBe(false);
    expect(props.disabled).toBe(false);
  });

  it('should accept full text_input props', () => {
    const props = ElementTextInputPropsSchema.parse({
      inputType: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      defaultValue: 'a@b.com',
      required: true,
      disabled: false,
      description: 'We never share it',
    });
    expect(props.inputType).toBe('email');
    expect(props.required).toBe(true);
  });

  // #9198 tombstone — `targetVariable` was a declarative hint with zero
  // readers; the live binding is the page variable whose `source` names this
  // component's `id` (ADR-0049 enforce-or-remove).
  it('rejects the retired `targetVariable` with its prescription', () => {
    expect(() => ElementTextInputPropsSchema.parse({ targetVariable: 'email' }))
      .toThrow(/`targetVariable`.*removed.*Delete the key/s);
  });

  it('does not materialize the retired `targetVariable` on a clean parse', () => {
    const props = ElementTextInputPropsSchema.parse({});
    expect(props).not.toHaveProperty('targetVariable');
  });

  it('should accept all input types', () => {
    const types = ['text', 'email', 'number', 'tel', 'url', 'password'] as const;
    types.forEach(inputType => {
      expect(() => ElementTextInputPropsSchema.parse({ inputType })).not.toThrow();
    });
  });

  it('should accept a numeric defaultValue', () => {
    const props = ElementTextInputPropsSchema.parse({ inputType: 'number', defaultValue: 42 });
    expect(props.defaultValue).toBe(42);
  });

  it('should reject an unknown input type', () => {
    expect(() => ElementTextInputPropsSchema.parse({ inputType: 'color' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComponentPropsMap — interactive elements
// ---------------------------------------------------------------------------
describe('ComponentPropsMap interactive elements', () => {
  it('should contain element:button', () => {
    expect(ComponentPropsMap['element:button']).toBeDefined();
  });

  it('should contain element:filter', () => {
    expect(ComponentPropsMap['element:filter']).toBeDefined();
  });

  it('should contain element:form', () => {
    expect(ComponentPropsMap['element:form']).toBeDefined();
  });

  it('should contain element:record_picker', () => {
    expect(ComponentPropsMap['element:record_picker']).toBeDefined();
  });

  it('should contain element:text_input', () => {
    expect(ComponentPropsMap['element:text_input']).toBeDefined();
  });

  it('should parse element:button props', () => {
    const result = ComponentPropsMap['element:button'].parse({ label: 'Click Me' });
    expect(result.label).toBe('Click Me');
  });

  // Flip of "should parse element:filter props" (#9220): the row STAYS so the
  // #5068 props gate keeps dispatching on the type — and what it dispatches to
  // now refuses with the element-retirement prescription.
  it('refuses element:filter props through the kept map row (retired, #9220)', () => {
    expect(() => ComponentPropsMap['element:filter'].parse({
      object: 'order',
      fields: ['status'],
    })).toThrow(/`element:filter` element is retired/s);
  });

  it('should parse element:form props', () => {
    const result = ComponentPropsMap['element:form'].parse({ object: 'contact' });
    expect(result.object).toBe('contact');
  });

  it('should parse element:record_picker props', () => {
    const result = ComponentPropsMap['element:record_picker'].parse({
      object: 'account',
      labelField: 'name',
    });
    expect(result.object).toBe('account');
  });

  it('should parse element:text_input props', () => {
    const result = ComponentPropsMap['element:text_input'].parse({ label: 'Name' });
    expect(result.inputType).toBe('text');
  });
});

// #5775 — `stages[].terminal` is honoured FIRST by the record-path renderer,
// ahead of the token heuristic that guesses "won"/"lost" from the value/label.
// The showcase's `done` stage is exactly the case the heuristic cannot read, so
// without this key there is no way to declare the terminus at all.
describe('RecordPathProps stages[].terminal (#5775)', () => {
  it('accepts the showcase stage shape verbatim (task-detail.page.ts:40)', () => {
    const result = RecordPathProps.parse({
      statusField: 'status',
      stages: [
        { value: 'todo', label: 'To Do' },
        { value: 'done', label: 'Done', terminal: 'won' },
      ],
    });
    expect(result.stages![1]!.terminal).toBe('won');
  });

  it('leaves terminal undefined when unauthored (no default materialized)', () => {
    const result = RecordPathProps.parse({
      statusField: 'status',
      stages: [{ value: 'todo', label: 'To Do' }],
    });
    expect(result.stages![0]!.terminal).toBeUndefined();
  });

  it('rejects a terminal outside won|lost rather than silently stripping it', () => {
    expect(() => RecordPathProps.parse({
      statusField: 'status',
      stages: [{ value: 'x', label: 'X', terminal: 'closed' }],
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Enhanced RecordActivityProps (Unified Timeline)
// ---------------------------------------------------------------------------
describe('RecordActivityProps (enhanced)', () => {
  it('should accept empty with defaults', () => {
    const result = RecordActivityProps.parse({});
    expect(result.filterMode).toBe('all');
    expect(result.showFilterToggle).toBe(true);
    expect(result.limit).toBe(20);
    expect(result.showCompleted).toBe(false);
    expect(result.unifiedTimeline).toBe(true);
    expect(result.showCommentInput).toBe(true);
    expect(result.enableMentions).toBe(true);
    expect(result.enableReactions).toBe(false);
    expect(result.enableThreading).toBe(false);
    expect(result.showSubscriptionToggle).toBe(true);
  });

  it('should accept unified feed item types including comment and field_change', () => {
    const result = RecordActivityProps.parse({
      types: ['comment', 'field_change', 'task', 'email'],
    });
    expect(result.types).toEqual(['comment', 'field_change', 'task', 'email']);
  });

  it('should accept custom filter mode', () => {
    const result = RecordActivityProps.parse({ filterMode: 'comments_only' });
    expect(result.filterMode).toBe('comments_only');
  });

  it('should accept all filter modes', () => {
    const modes = ['all', 'comments_only', 'changes_only', 'tasks_only'] as const;
    modes.forEach(mode => {
      expect(() => RecordActivityProps.parse({ filterMode: mode })).not.toThrow();
    });
  });

  it('should accept full configuration', () => {
    const result = RecordActivityProps.parse({
      types: ['comment', 'field_change'],
      filterMode: 'all',
      showFilterToggle: true,
      limit: 50,
      showCompleted: true,
      unifiedTimeline: true,
      showCommentInput: true,
      enableMentions: true,
      enableReactions: true,
      enableThreading: true,
      showSubscriptionToggle: false,
    });
    expect(result.enableReactions).toBe(true);
    expect(result.enableThreading).toBe(true);
    expect(result.showSubscriptionToggle).toBe(false);
    expect(result.limit).toBe(50);
  });

  it('should reject invalid feed item type', () => {
    expect(() => RecordActivityProps.parse({ types: ['invalid_type'] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RecordChatterProps (replaces EmptyProps)
// ---------------------------------------------------------------------------
describe('RecordChatterProps', () => {
  it('materializes NO defaults — an empty bag parses to an empty bag (#8762)', () => {
    // The pre-#8762 state this pins against: `.default('sidebar')` wrote a
    // value NO renderer branch compared onto every parsed node that said
    // nothing, and `.default(true)` on `collapsible` INVERTED the renderer
    // merge's own `false` fallback. Renderer fallbacks stay the renderer's
    // facts (the `maxVisible` principle): "the author said nothing" must
    // parse to nothing.
    const result = RecordChatterProps.parse({});
    expect('position' in result).toBe(false);
    expect('collapsible' in result).toBe(false);
    expect('defaultCollapsed' in result).toBe(false);
    expect(result.width).toBeUndefined();
    expect(result.feed).toBeUndefined();
  });

  it('should accept a docked side position with width', () => {
    const result = RecordChatterProps.parse({
      position: 'right',
      width: '350px',
    });
    expect(result.position).toBe('right');
    expect(result.width).toBe('350px');
  });

  it('should accept numeric width', () => {
    const result = RecordChatterProps.parse({ width: 400 });
    expect(result.width).toBe(400);
  });

  it("should accept exactly the renderer's position vocabulary (#8762)", () => {
    // `RecordChatterPanel` branches on right/left (docked) vs bottom
    // (in-flow) — measured at objectui pin 665661ab0932. One vocabulary.
    const positions = ['bottom', 'right', 'left'] as const;
    positions.forEach(position => {
      const result = RecordChatterProps.parse({ position });
      expect(result.position).toBe(position);
    });
  });

  it('should accept collapsed state', () => {
    const result = RecordChatterProps.parse({
      collapsible: true,
      defaultCollapsed: true,
    });
    expect(result.defaultCollapsed).toBe(true);
  });

  it('should accept embedded feed configuration', () => {
    const result = RecordChatterProps.parse({
      position: 'right',
      width: '30%',
      feed: {
        types: ['comment', 'field_change'],
        filterMode: 'all',
        limit: 30,
        enableMentions: true,
        enableReactions: true,
      },
    });
    expect(result.feed).toBeDefined();
    expect(result.feed!.types).toEqual(['comment', 'field_change']);
    expect(result.feed!.limit).toBe(30);
    expect(result.feed!.enableReactions).toBe(true);
  });

  it('should reject a never-legal position with the plain enum refusal', () => {
    const result = RecordChatterProps.safeParse({ position: 'modal' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.code).toBe('invalid_value');
      // 'modal' was never a legal spelling, so it gets zod's own enum
      // message, not a retirement prescription.
      expect(result.error.issues[0]!.message).not.toContain('was removed');
    }
  });

  describe('the three retired spellings refuse with a per-value prescription (#8762)', () => {
    // Each old spelling gets its own "was removed" message naming the
    // replacement — the `view.exportOptions` `'pdf'` precedent: an
    // enum-VALUE narrowing has no `retiredKey()` tombstone to carry the
    // prescription, so the enum's own error map does, keyed on `issue.input`.
    const cases = [
      { from: 'sidebar', to: "'right'" },
      { from: 'inline', to: "'bottom'" },
      { from: 'drawer', to: "'right'" },
    ] as const;
    for (const { from, to } of cases) {
      it(`'${from}' → refused, prescribing ${to}`, () => {
        const result = RecordChatterProps.safeParse({ position: from });
        expect(result.success).toBe(false);
        if (!result.success) {
          const issue = result.error.issues[0]!;
          expect(issue.code).toBe('invalid_value');
          expect(issue.path).toEqual(['position']);
          expect(issue.message).toContain(`'${from}' was removed`);
          expect(issue.message).toContain(`Write ${to}`);
          expect(issue.message).toContain('os migrate meta');
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ComponentPropsMap — record:chatter is no longer empty
// ---------------------------------------------------------------------------
describe('ComponentPropsMap record:chatter', () => {
  it('should parse record:chatter with no materialized defaults (#8762)', () => {
    const result = ComponentPropsMap['record:chatter'].parse({});
    expect('position' in result).toBe(false);
    expect('collapsible' in result).toBe(false);
  });

  it('should parse record:chatter with feed config', () => {
    const result = ComponentPropsMap['record:chatter'].parse({
      position: 'bottom',
      feed: { filterMode: 'comments_only' },
    });
    expect(result.position).toBe('bottom');
    expect(result.feed!.filterMode).toBe('comments_only');
  });

  it('should parse record:activity with unified types', () => {
    const result = ComponentPropsMap['record:activity'].parse({
      types: ['comment', 'field_change', 'task'],
      unifiedTimeline: true,
    });
    expect(result.types).toEqual(['comment', 'field_change', 'task']);
    expect(result.unifiedTimeline).toBe(true);
  });
});

/**
 * ── 批 17's `no gate` verdict, and what #5068 changed about it ──────────────
 *
 * 批 17 measured that nothing parsed these schemas, so closing them would have
 * enforced nothing (#4583). **#5068 wired the parse** — on the LINT side, per
 * the maintainer's direction-A ruling — so the class is `authorable` again and
 * the ratchet is ordinary strictness work. The full measurement and the three
 * things the flip did not do live in `component.zod.ts`'s header and in the
 * `ui/` tables of `docs/audits/2026-07-unknown-key-strictness-ledger.md`.
 *
 * **Every assertion below still holds, and that is the point rather than an
 * oversight.** Direction B (a discriminated `properties` on the carrier) was
 * DECLINED as breaking against an open `type` union, so the schema path is
 * untouched: the carrier is still an open record, an unknown key still survives
 * `PageSchema.parse()`, and all 31 entries still strip. Measured against the
 * landed gate, not assumed — `packages/lint`'s `validate-component-props.test.ts`
 * holds the other half (the gate reports what these three assertions show the
 * schema still accepts).
 *
 * This block exists so the verdict cannot outlive its truth. Each assertion is
 * written to go RED the day the world changes underneath it — at which point the
 * correct response is to update all three places together, not to relax the test.
 */
describe('批 17 / #5068 — the carrier stays an open bag; the gate is on the lint side', () => {
  it('the carrier is still an OPEN bag — direction B (a typed `properties`) was declined, so this stays green', () => {
    // `PageComponentSchema` is `.strict().transform(…)`, so unwrap the pipe to
    // reach the object shape.
    const def = (PageComponentSchema as any)._zod.def;
    const shape = def.type === 'pipe' ? def.in._zod.def.shape : def.shape;
    // `properties` is `z.record(z.string(), z.unknown()).optional().default({})`.
    let node = shape.properties;
    while (node?._zod?.def?.innerType) node = node._zod.def.innerType;
    expect(node._zod.def.type).toBe('record');
    // The value type must still be the fully-open `unknown`. #5068 dispatches
    // `ComponentPropsMap` by `type` at the AUTHORING GATE
    // (`packages/lint/src/validate-component-props.ts`), not here — the carrier
    // keeps this shape by decision, because `type` is an open union and a
    // discriminated `properties` would reject the unregistered types real pages
    // author. If this ever DOES go red, the carrier itself was reshaped: that is
    // a protocol change (direction B), not a lint change.
    expect(node._zod.def.valueType._zod.def.type).toBe('unknown');
  });

  // Still true after #5068, and it is the sentence that keeps the gate honest:
  // the SCHEMA accepts and retains the key; what changed is that the authoring
  // gate now REPORTS it (at `warning`). A reader who mistakes the gate for a
  // closed door would be wrong in the direction that matters — the storage path
  // (`saveMetaItem` / REST `/meta`) runs no such gate at all.
  it('an unknown key inside `properties` survives the LIVE page parse — with the strict sibling as negative control', () => {
    const page = {
      name: 'batch17_probe',
      label: 'Probe',
      type: 'home' as const,
      regions: [
        { name: 'header', components: [{ type: 'page:header', properties: { title: 'T' } }] },
      ],
    };

    // A. unknown key INSIDE the carrier slot — accepted AND retained today.
    const inside = structuredClone(page) as any;
    inside.regions[0].components[0].properties.zzUndeclared = 'x';
    const a = PageSchema.safeParse(inside);
    expect(a.success).toBe(true);
    expect((a as any).data.regions[0].components[0].properties.zzUndeclared).toBe('x');

    // B. NEGATIVE CONTROL — the same key one level out, on the component node
    // itself, which IS strict (ADR-0089 D3a). If this ever stops failing, the
    // assertion above proves nothing and this whole block is measuring air.
    const outside = structuredClone(page) as any;
    outside.regions[0].components[0].zzUndeclared = 'x';
    expect(PageSchema.safeParse(outside).success).toBe(false);
  });

  /**
   * ⚠️ THE FLIP. Until #4001 batch A this asserted the opposite — that every
   * entry was still open — and its own comment named the conditions for
   * flipping it: "When a later batch DOES close them, this expectation flips —
   * update the verdict in component.zod.ts and the ledger in the same PR."
   * Both were updated in the PR that changed this line.
   *
   * The two assertions ABOVE are deliberately untouched and still green: the
   * carrier is still an open `z.record(z.string(), z.unknown())` and an unknown
   * key still survives `PageSchema.parse()`. That is not a leftover — it is the
   * precise scope of this batch. Direction B (a discriminated `properties`)
   * stays declined, so closing these shapes moves the rejection into the #5068
   * authoring gate's `safeParse` half, not onto the page protocol. The storage
   * path (`saveMetaItem` / REST `/meta`) still runs no props parse at all
   * (#4463's fourth wall), which is why the assertion above must keep passing:
   * a reader who mistook this batch for a closed storage door would be wrong in
   * the direction that matters.
   */
  it('every ComponentPropsMap entry is now STRICT — batch A closed all 31 sites', () => {
    const stillOpen: string[] = [];
    for (const [type, schema] of Object.entries(ComponentPropsMap)) {
      const def = (schema as any)._zod.def;
      // zod records an unknown-key policy on the object def; `.strict()` sets a
      // `never` catchall. Anything else means the site is still open.
      if (def.catchall?._zod?.def?.type === 'never') continue;
      stillOpen.push(type);
    }
    expect(stillOpen).toEqual([]);

    // Positive control in the same run: the strictness is REACHABLE through the
    // map, on every registered type, with a key no schema declares. Without
    // this the assertion above is a claim about a `catchall` field rather than
    // about behaviour — and the campaign has twice shipped a pin that read the
    // shape and not the parse.
    const rejects: string[] = [];
    for (const [type, schema] of Object.entries(ComponentPropsMap)) {
      if ((schema as any).safeParse({ zzUndeclared: 'x' }).success) rejects.push(type);
    }
    expect(rejects).toEqual([]);
  });
});

/**
 * The curated half of #4001 batch A — the `aliases` / `guidance` a closed shape
 * can carry and the #5068 walker could not.
 *
 * `alias-integrity.test.ts` already proves every entry is a TRUE claim about
 * its schema (the key it is filed under is rejected, the key it prescribes is
 * accepted). What it cannot ask is whether the entry still EXISTS — a table
 * emptied by a later edit is a table that passes every integrity check. These
 * assertions are that half: each one names a producer measured in the wild, so
 * deleting the entry is a decision about that producer rather than a cleanup.
 */
describe('#4001 batch A — the prescriptions, each backed by a measured producer', () => {
  const refuse = (schema: { safeParse(v: unknown): any }, value: unknown): string => {
    const r = schema.safeParse(value);
    expect(r.success).toBe(false);
    return r.error.issues.map((i: { message: string }) => i.message).join('\n');
  };

  it('a tab item `key` is answered with `value` — objectui\'s Studio designer publishes `key`', () => {
    // Producer: `previews/block-config.ts`, `page:tabs.items.itemFields`. The
    // renderer reads `it.value` and falls back to `tab-<index>` — so an
    // authored `key` is not a typo, it is a spelling that silently yields
    // index-derived tab tokens.
    const message = refuse(PageTabsProps, { items: [{ label: 'A', key: 'a', children: [] }] });
    expect(message).toContain('`key`');
    expect(message).toContain('value');
  });

  it('an accordion item `value` is answered with "the renderer derives it" — NOT a rename', () => {
    // The same designer publishes `value` here too, but this renderer
    // OVERWRITES it (`{ ...it, value: `panel-${idx}` }`). The prescription must
    // therefore say the key is dead, not offer a spelling — the distinction
    // between this entry and the tab one is the whole point of both (#7973).
    const message = refuse(PageAccordionProps, {
      items: [{ label: 'A', value: 'a', children: [] }],
    });
    expect(message).toContain('panel-<index>');
    expect(message).not.toContain('Did you mean');
  });

  it('a component-NODE key inside `properties` is told to move up a level — by family', () => {
    // Two families, two prescriptions, and they must NOT be collapsed: the
    // visibility one is a pattern (it has to catch spellings nobody
    // enumerated — `visibleIf`, `hiddenWhen`), while the dispatch one is an
    // enumerated list narrowed to keys no props schema declares.
    for (const [schema, key] of [
      [PageCardProps, 'visible'],
      [PageHeaderProps, 'visibleWhen'],
      [RecordDetailsProps, 'hiddenWhen'],
    ] as const) {
      const message = refuse(schema, { [key]: 'x' });
      expect(message).toContain('move it up one level');
      expect(message).toContain('visibleWhen');
    }
    for (const [schema, key] of [
      [RecordDetailsProps, 'dataSource'],
      [PageCardProps, 'className'],
    ] as const) {
      expect(refuse(schema, { [key]: 'x' })).toContain('component NODE');
    }
  });

  it('a container `body` is answered with `children`', () => {
    expect(refuse(PageContainerProps, { body: [] })).toContain('children');
  });

  it('a no-props component names ITSELF in the rejection, not "this component"', () => {
    // The reason `emptyProps` is a factory: an empty shape has no candidate
    // keys, so the distance fallback can say nothing and the surface name is
    // the entire diagnostic. Seven types share the shape; none may share a name.
    expect(refuse(ComponentPropsMap['element:divider'], { color: 'red' }))
      .toContain('`element:divider`');
    expect(refuse(ComponentPropsMap['nav:menu'], { color: 'red' }))
      .toContain('`nav:menu`');
  });

  it('the five renderer-honoured keys batch A declared are ACCEPTED, not prescribed', () => {
    // The other side of the same judgement: these were measured as read by
    // objectui through `schema?.X ?? schema?.properties?.X`, so a rejection
    // here would be the declaration disagreeing with the delivered platform.
    expect(PageHeaderProps.parse({ maxVisible: 5, mobileMaxVisible: 2 }).maxVisible).toBe(5);
    expect(PageTabsProps.parse({ items: [], alwaysShowStrip: true }).alwaysShowStrip).toBe(true);
    const details = RecordDetailsProps.parse({ inlineEdit: false, showHeader: true });
    expect(details.inlineEdit).toBe(false);
    expect(details.showHeader).toBe(true);

    // …and none of them acquired a schema DEFAULT, which would turn "the author
    // said nothing" into "the author asked for the renderer's fallback".
    const empty = RecordDetailsProps.parse({});
    expect('inlineEdit' in empty).toBe(false);
    expect('showHeader' in empty).toBe(false);
    expect('maxVisible' in PageHeaderProps.parse({})).toBe(false);
  });
});

/**
 * ── #7751: the `object-*` block family enters the map (ruling 2026-08-12) ────
 *
 * Direction A, quoted from the maintainer's ruling: 「object-* 块族的 props
 * schema 进 ComponentPropsMap」. Key sets are derived from the objectui
 * renderers' own read points (section header in component.zod.ts carries the
 * per-key citations); the corpus shapes below are COPIES of the showcase
 * pages' authored nodes (examples/app-showcase/src/ui/pages/*), not imports —
 * cross-package test inputs are their own failure class.
 */
describe('#7751 — object-* block props schemas', () => {
  const refuse = (schema: { safeParse(v: unknown): any }, value: unknown): string => {
    const r = schema.safeParse(value);
    expect(r.success).toBe(false);
    return r.error.issues.map((i: { message: string }) => i.message).join('\n');
  };

  it('the six ruled blocks are registered; object-chart deliberately is NOT', () => {
    for (const type of [
      'object-grid', 'object-metric', 'object-kanban', 'object-calendar',
      'object-form', 'object-master-detail-form',
    ]) {
      expect(ComponentPropsMap[type as keyof typeof ComponentPropsMap], type).toBeDefined();
    }
    // Two-vocabulary problem (`chartType` vs ChartConfigSchema `type`; bag
    // spread into the generic chart component) — its key set is not derivable
    // with this section's confidence, so it stays a SKIPPED unregistered type
    // rather than a partial entry that warns on working keys.
    expect((ComponentPropsMap as Record<string, unknown>)['object-chart']).toBeUndefined();
  });

  it('the #7750 specimen shape is REJECTED, with the rename in the message: `filters` → `filter`', () => {
    const message = refuse(ComponentPropsMap['object-grid'], {
      objectName: 'showcase_task',
      columns: ['title', 'project', 'status', 'priority', 'due_date'],
      filters: [['owner_id', '=', '{current_user_id}']],
    });
    expect(message).toContain('`filters`');
    expect(message).toContain('Did you mean `filters` → `filter`?');
  });

  it('the corrected #7750 node (my-work.page.ts, post-fix) parses GREEN and retains its filter', () => {
    const parsed = ComponentPropsMap['object-grid'].parse({
      objectName: 'showcase_task',
      columns: ['title', 'project', 'status', 'priority', 'due_date'],
      filter: [['owner_id', '=', '{current_user_id}']],
    });
    expect(parsed.filter).toEqual([['owner_id', '=', '{current_user_id}']]);
  });

  it('`defaultFilters` stays HONOURED — it is a read legacy fallback, not an inert spelling', () => {
    // ObjectGrid.tsx reads it and lowers it to `$filter` when `filter` is
    // absent (the routed finding on #7751 verified the read point). Only the
    // plural `filters` has zero read points.
    const parsed = ComponentPropsMap['object-grid'].parse({
      objectName: 'showcase_task',
      defaultFilters: [['status', '=', 'open']],
    });
    expect(parsed.defaultFilters).toEqual([['status', '=', 'open']]);
  });

  it('every object-metric node of the showcase corpus parses GREEN (the clean-corpus control)', () => {
    // Copies of all three my-work.page.ts metrics + the command-center shape
    // (variant/format) — the exact nodes the lint must NOT start warning on.
    const nodes = [
      { objectName: 'showcase_task', label: 'Open Tasks', icon: 'list-checks', colorVariant: 'blue', description: 'not done', aggregate: { field: 'id', function: 'count' }, filter: { status: { $ne: 'done' } } },
      { objectName: 'showcase_task', label: 'In Review', icon: 'eye', colorVariant: 'warning', description: 'awaiting review', aggregate: { field: 'id', function: 'count' }, filter: { status: 'in_review' } },
      { objectName: 'showcase_project', label: 'At-Risk Projects', icon: 'alert-triangle', colorVariant: 'danger', description: 'health red', aggregate: { field: 'id', function: 'count' }, filter: { health: 'red' } },
      { objectName: 'showcase_task', label: 'Tasks', colorVariant: 'purple', variant: 'bare', aggregate: { field: 'id', function: 'count' }, format: '0,0' },
    ];
    for (const node of nodes) {
      const r = ComponentPropsMap['object-metric'].safeParse(node);
      expect(r.success, JSON.stringify(node) + '\n' + JSON.stringify((r as any).error?.issues)).toBe(true);
    }
  });

  it('the showcase object-form wizard node parses GREEN', () => {
    const r = ComponentPropsMap['object-form'].safeParse({
      objectName: 'showcase_project',
      mode: 'create',
      formType: 'wizard',
      showStepIndicator: true,
      title: 'Create a Project',
      description: 'A three-step wizard — basics, status, then budget & schedule.',
      sections: [
        { label: 'Basics', description: 'Name the project and bind its account.', fields: ['name', 'account', 'owner'] },
      ],
      submitBehavior: { kind: 'thank-you', title: 'Project created', message: 'Ready.' },
    });
    expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
  });

  it('the showcase object-master-detail-form node parses GREEN', () => {
    const r = ComponentPropsMap['object-master-detail-form'].safeParse({
      objectName: 'showcase_project',
      mode: 'create',
      formType: 'simple',
      submitText: 'Create Project + Tasks',
      fields: ['name', 'account', 'status', 'health', 'budget', 'end_date'],
      details: [{ title: 'Tasks', childObject: 'showcase_task', addLabel: 'Add task' }],
    });
    expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
  });

  it("the designer's dead `groupField` spelling is answered with the `groupBy` the board reads", () => {
    // Producer: objectui previews/block-config.ts publishes `groupField` for
    // object-kanban; ObjectKanban.tsx reads only `groupBy` (#7973 class).
    const message = refuse(ComponentPropsMap['object-kanban'], { objectName: 'task', groupField: 'status' });
    expect(message).toContain('Did you mean `groupField` → `groupBy`?');
  });

  it('the plural `filters` is rejected by name on every block that reads `filter`', () => {
    for (const type of ['object-grid', 'object-metric', 'object-kanban', 'object-calendar'] as const) {
      const message = refuse(ComponentPropsMap[type], { filters: [] });
      expect(message, type).toContain('Did you mean `filters` → `filter`?');
    }
  });

  it("object-calendar's flat field spellings get the wrong-layer prescription, not a rename", () => {
    // Read as back-compat by getCalendarConfig, emitted by ObjectView/ListView
    // handoffs — but the authored spelling is the `calendar` object (one key
    // per concept; the `body` → `children` precedent).
    const message = refuse(ComponentPropsMap['object-calendar'], { objectName: 'task', startDateField: 'due_date' });
    expect(message).toContain('`calendar`');
    expect(message).toContain('startDateField');
  });

  it('objectName is OPTIONAL on every entry — the dataSource binding can supply the object (#6953)', () => {
    // A required `objectName` would false-flag every node bound through the
    // component-level `dataSource`; the lint's required-prop exemption only
    // covers the key spelled `object`. Measured, not assumed.
    for (const type of [
      'object-grid', 'object-metric', 'object-kanban', 'object-calendar',
      'object-form', 'object-master-detail-form',
    ] as const) {
      expect(ComponentPropsMap[type].safeParse({}).success, type).toBe(true);
    }
  });
});
