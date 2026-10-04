import { describe, it, expect } from 'vitest';
import { z } from 'zod';
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
  ObjectMetricPropsSchema,
  ObjectKanbanPropsSchema,
  pageComponentSlotPositions,
} from './component.zod';
import { PageComponentSchema, PageSchema, PageComponentType, ElementDataSourceSchema, RETIRED_PAGE_COMPONENT_TYPES } from './page.zod';
import {
  GanttConfigSchema, TreeConfigSchema, ListMapConfigSchema, ListColumnSchema, ListViewSchema,
  TimelineConfigSchema,
} from './view.zod';
import { FieldSchema } from '../data/field.zod';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { strictObjectDeclarations } from '../shared/strict-object';

describe('PageHeaderProps', () => {
  it('should accept minimal header', () => {
    const result = PageHeaderProps.parse({ title: 'My Page' });
    expect(result.title).toBe('My Page');
    expect(result.subtitle).toBeUndefined();
    expect(result.actions).toBeUndefined();
  });

  it('should accept full header with all fields', () => {
    const header = {
      title: 'Dashboard',
      subtitle: 'Overview',
      recordChrome: false,
      actions: ['action-1', 'action-2'],
    };
    const result = PageHeaderProps.parse(header);
    expect(result.recordChrome).toBe(false);
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
    expect(result.recordChrome).toBe(true);
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

// #9881 — the accept-pin for `page:accordion` items[].icon, a key a liveness
// sweep once read as declared-but-unenforced. It has a live cross-repo consumer:
// objectui's `PageAccordionRenderer` renders `{item.icon && <LazyIcon
// name={item.icon} …/>}` inside the `AccordionTrigger`
// (`packages/components/src/renderers/layout/containers.tsx:1170-1176`), and the
// same file's `ComponentRegistry.register('accordion', …)` publishes the key to
// the Studio block designer at `:1219` (the `items` input, documented as
// `[{ label, icon?, collapsed?, children }]`). Measured at the pin this repo
// builds against — `.objectui-sha` = `2e818d0b5`. Re-derived at that pin
// 2026-10-04: every objectui file this record cites is byte-identical across
// the hop from `ab1879721` (`git diff --quiet`), so every anchor held unmoved.
// At `ab1879721`, re-derived there 2026-10-03: `containers.tsx` changed
// across the hop from `89cad75d5` (23
// insertions, 27 deletions: objectui#11445's i18next count family for the
// `page:tabs` count badge, and objectui#11438 dropping the `page:header`
// registration's inert `breadcrumb` input), so both anchors were re-READ rather
// than carried, and BOTH MOVED up one line with their text byte-identical (the
// tab-count translation table above them lost a net line): the icon block
// `1171-1177` -> `1170-1176`, still inside `PageAccordionRenderer`'s
// `AccordionTrigger`, and the input `1220` -> `1219`, still inside the
// `register('accordion', …)` inputs. At `89cad75d5`, re-derived at that pin
// 2026-10-02: `containers.tsx` is byte-identical across the hop from
// `31971ff1e` (`git diff --quiet`), and both anchors were re-READ in place and
// still say what this block says: the icon block `1171-1177`, inside
// `PageAccordionRenderer`'s `AccordionTrigger`, and the input `1220`, inside
// the `register('accordion', …)` inputs. At `31971ff1e`, re-derived at that pin
// 2026-10-01: `containers.tsx` is byte-identical across the hop from
// `e420df310` (`git diff --quiet`), and both anchors were re-READ in place and
// still say what this block says: the icon block `1171-1177`, inside
// `PageAccordionRenderer`'s `AccordionTrigger`, and the input `1220`, inside
// the `register('accordion', …)` inputs. At `e420df310`, re-derived at that pin
// 2026-09-30: `containers.tsx` changed again across the hop from `db11afd49` (40
// insertions, 26 deletions: objectui#11166's `page:header` breadcrumb slot and
// objectui#11212's fail-closed permission gates), every hunk of it at `:1286`
// or below, so both anchors were re-READ in place and NEITHER moved, each
// byte-identical: the icon block `1171-1177`, still inside
// `PageAccordionRenderer`'s `AccordionTrigger`, and the input `1220`, still
// inside the `register('accordion', …)` inputs. At `db11afd49`, re-derived at
// that pin 2026-09-29: `containers.tsx` changed again across the hop from `dd3f7e1be` (46
// insertions, 6 deletions: objectui `0ecaa7dbb`'s block-level nested `aria` bags
// and comment re-citations), so both anchors were re-READ rather than carried,
// and BOTH MOVED with their text byte-identical, the icon block by 32 and the
// registration input by 34: `1139-1145` -> `1171-1177`, `1186` -> `1220`. At
// `dd3f7e1be`, re-derived at that pin
// 2026-09-28: `containers.tsx` changed again across the hop from `f8a9d0fb0`
// (120 insertions, 63 deletions; the 70 net lines above both anchors are
// objectui `3261e6479`'s one `titleFormat` interpolator for the record title
// and an import line from objectui `f5178a272`; the rest lands below both,
// objectui `1dae95a41`'s two re-cited `page:header` comments among it), so
// both anchors were re-READ
// rather than carried — and both MOVED with their text byte-identical: the
// icon block `1069-1075` -> `1139-1145`, still inside `PageAccordionRenderer`'s
// `AccordionTrigger`, and the input `1116` -> `1186`, still inside the
// `register('accordion', …)` inputs. At `f8a9d0fb0` (2026-09-24, off
// `62597c588`: 36 insertions, 7 deletions, objectui `ba0b61a60`, an import
// line and the `page:header` title) NEITHER had moved, each byte-identical to
// its `62597c588` and `87af769e9` text. The hop onto `62597c588` (74
// insertions, 16 deletions, objectui `4c6f549ef`) read the same. (The hop before, off `53ded82bf`,
// moved them from `919-925` and `966` and rewrote the input LINE — it now
// declares `of: 'object'`, carries a longer description and no `label` —
// while the member list this pin cites stayed unchanged.) Identity preserves a
// wrong anchor as faithfully as a right one, which is why neither was carried
// (commit d1ba685ec).
//
// #9397 spent a full dispatch cycle re-deriving that read point from scratch
// after the sweep proposed retiring the key. This block plus the `.describe()`
// it pins are what stop the next sweep repeating it: the liveness verdict is
// now readable from the spec side alone, with no cross-repo hunt.
describe('PageAccordionProps items[].icon liveness (#9881)', () => {
  const accordion = ComponentPropsMap['page:accordion'];

  it('accepts an icon on a panel item — the value objectui LazyIcon renders in the trigger', () => {
    const result = accordion.safeParse({
      items: [{ label: 'Details', icon: 'circle-alert', children: [] }],
    });
    expect(result.success).toBe(true);
    const items = (result.success ? result.data : undefined) as
      | { items: { icon?: string }[] }
      | undefined;
    // Carried through to the parsed output, not stripped: what the renderer
    // reads is what an author writes.
    expect(items?.items[0]?.icon).toBe('circle-alert');
  });

  it('still refuses an undeclared sibling on the same item — the accept above is not vacuous', () => {
    // Without this the green above would also be green on a schema that had
    // stopped being strict, which is the failure mode an accept-pin exists to
    // exclude.
    const result = accordion.safeParse({
      items: [{ label: 'Details', iconName: 'circle-alert', children: [] }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('unrecognized_keys');
  });

  it('keeps a `.describe()` that names the consumer, so the read point survives a rename', () => {
    // The describe is the artifact an auditor reads instead of hunting across
    // repos; deleting it is what re-opens the false candidate, so it is pinned
    // rather than left to review.
    const itemShape = (PageAccordionProps as unknown as {
      def: { shape: { items: { def: { element: { def: { shape: Record<string, { description?: string }> } } } } } };
    }).def.shape.items.def.element.def.shape;
    expect(itemShape.icon?.description).toContain('LazyIcon');
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

// Commit 60e0f900a — the accept-pin for `page:tabs` items[].icon, the exact sibling of the
// #9881 accordion key: same file, same renderer, same `LazyIcon` slot, and the
// same bare declaration a liveness sweep reads as declared-but-unenforced.
// objectui's `PageTabsRenderer` renders `{item.icon && <LazyIcon
// name={item.icon} …/>}` inside the `TabsTrigger`
// (`packages/components/src/renderers/layout/containers.tsx:945-951`), and the
// same file's `ComponentRegistry.register('tabs', …)` publishes the key to the
// Studio block designer at `:1004` (the `items` input, documented as
// `[{ label, value?, icon?, count?, visibleWhen?, children }]`). Measured at
// the pin this repo builds against — `.objectui-sha` = `2e818d0b5`. Re-derived at
// that pin 2026-10-04: every objectui file this record cites is byte-identical
// across the hop from `ab1879721` (`git diff --quiet`), so every anchor held
// unmoved. At `ab1879721`, re-derived there 2026-10-03: `containers.tsx`
// changed across the hop from `89cad75d5`
// (23 insertions, 27 deletions: objectui#11445's i18next count family, which
// rewrote the tab-count translation table above both anchors and the count
// badge's `aria-label` between them, and objectui#11438 dropping the
// `page:header` registration's inert `breadcrumb` input below them), so both
// anchors were re-READ rather than carried, and BOTH MOVED up one line with
// their text byte-identical: the icon block `946-952` -> `945-951`, still
// inside `PageTabsRenderer`'s `TabsTrigger`, and the input `1005` -> `1004`,
// still inside the `register('tabs', …)` inputs. At `89cad75d5`, re-derived at
// that pin 2026-10-02: `containers.tsx` is byte-identical across the hop from
// `31971ff1e` (`git diff --quiet`), and both anchors were re-READ in place and
// still say what this block says: the icon block `946-952`, inside
// `PageTabsRenderer`'s `TabsTrigger`, and the input `1005`, inside the
// `register('tabs', …)` inputs. At `31971ff1e`, re-derived at that pin
// 2026-10-01: `containers.tsx` is byte-identical across the hop from
// `e420df310` (`git diff --quiet`), and both anchors were re-READ in place and
// still say what this block says: the icon block `946-952`, inside
// `PageTabsRenderer`'s `TabsTrigger`, and the input `1005`, inside the
// `register('tabs', …)` inputs. At `e420df310`, re-derived at that pin
// 2026-09-30: `containers.tsx` changed again across the hop from
// `db11afd49` (40 insertions, 26 deletions: objectui#11166's `page:header`
// breadcrumb slot and objectui#11212's fail-closed permission gates), every hunk
// of it at `:1286` or below, so both anchors were re-READ in place and NEITHER
// moved, each byte-identical: the icon block `946-952`, still inside
// `PageTabsRenderer`'s `TabsTrigger`, and the input `1005`, still inside the
// `register('tabs', …)` inputs. At `db11afd49`, re-derived at
// that pin 2026-09-29: `containers.tsx` changed again across the hop from
// `dd3f7e1be` (46 insertions, 6 deletions: objectui `0ecaa7dbb`'s block-level
// nested `aria` bags and comment re-citations), so both anchors were re-READ
// rather than carried, and BOTH MOVED with their text byte-identical, the net +23
// all landing above them: `923-929` -> `946-952`, `982` -> `1005`. At
// `dd3f7e1be`, re-derived
// at that pin 2026-09-28: `containers.tsx` changed again across the hop from
// `f8a9d0fb0` (120 insertions, 63 deletions, 70 net lines above both anchors:
// objectui `3261e6479`'s `titleFormat` interpolator and an import line), so
// both anchors were re-READ rather than carried — and both MOVED with their
// text byte-identical: the icon block `853-859` -> `923-929`, still inside
// `PageTabsRenderer`'s `TabsTrigger`, and the input `912` -> `982`, still
// inside the `register('tabs', …)` inputs. At `f8a9d0fb0` (2026-09-24, off
// `62597c588`: 36 insertions, 7 deletions, objectui `ba0b61a60`) NEITHER had
// moved, each byte-identical to its `62597c588` and `87af769e9` text; the hop
// onto `62597c588` (74 insertions, 16 deletions, objectui `4c6f549ef`) read
// the same. (The hop before, off `53ded82bf`, moved them from
// `730-736` and `789` and rewrote the input LINE — `of: 'object'`, a longer
// description, no `label` — while the member list this pin cites stayed
// unchanged.) Never inferred (commit d1ba685ec).
//
// #9397 spent a full dispatch cycle re-deriving the accordion's read point
// after the sweep proposed retiring it. This block plus the `.describe()` it
// pins are what stop that repeating one component over: the liveness verdict is
// readable from the spec side alone, with no cross-repo hunt.
describe('PageTabsProps items[].icon liveness (#9972)', () => {
  const tabs = ComponentPropsMap['page:tabs'];

  it('accepts an icon on a tab item — the value objectui LazyIcon renders in the trigger', () => {
    const result = tabs.safeParse({
      items: [{ label: 'Details', icon: 'circle-alert', children: [] }],
    });
    expect(result.success).toBe(true);
    const parsed = (result.success ? result.data : undefined) as
      | { items: { icon?: string }[] }
      | undefined;
    // Carried through to the parsed output, not stripped: what the renderer
    // reads is what an author writes.
    expect(parsed?.items[0]?.icon).toBe('circle-alert');
  });

  it('still refuses an undeclared sibling on the same item — the accept above is not vacuous', () => {
    // Without this the green above would also be green on a schema that had
    // stopped being strict, which is the failure mode an accept-pin exists to
    // exclude.
    const result = tabs.safeParse({
      items: [{ label: 'Details', iconName: 'circle-alert', children: [] }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('unrecognized_keys');
  });

  it('keeps a `.describe()` that names the consumer, so the read point survives a rename', () => {
    // The describe is the artifact an auditor reads instead of hunting across
    // repos; deleting it is what re-opens the false candidate, so it is pinned
    // rather than left to review.
    const itemShape = (PageTabsProps as unknown as {
      def: { shape: { items: { def: { element: { def: { shape: Record<string, { description?: string }> } } } } } };
    }).def.shape.items.def.element.def.shape;
    expect(itemShape.icon?.description).toContain('LazyIcon');
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

describe('pageComponentSlotPositions — the one slot list, derived from the rows (#20940)', () => {
  // Every page walk reads this list: the ADR-0087 conversion walker (every
  // entry), the exported `walkAddressedPageComponents` and lint's
  // `walkPageComponents` (authorable entries). Before it each kept its own,
  // and they disagreed about `page:card.footer`.
  it('names exactly the positions the rows declare, in the walks\' visit order', () => {
    expect(pageComponentSlotPositions()).toEqual([
      { key: 'children', retired: false },
      { key: 'body', retired: true },
      { key: 'footer', retired: false },
      { key: 'items', panelKey: 'children', retired: false },
    ]);
  });

  it('is derived from the rows that declare each position, never from a list of its own', () => {
    const cardShape = PageCardProps.shape as Record<string, unknown>;
    const tabsItem = (PageTabsProps.shape.items as any).def.element.shape as Record<string, unknown>;
    const accordionItem = (PageAccordionProps.shape.items as any).def.element.shape as Record<string, unknown>;
    for (const key of ['children', 'body', 'footer']) expect(cardShape).toHaveProperty(key);
    expect(PageContainerProps.shape).toHaveProperty('children');
    expect(tabsItem).toHaveProperty('children');
    expect(accordionItem).toHaveProperty('children');
    // CONTROL: a row's plain `z.array(z.unknown())` that is NOT a slot — the
    // same schema shape, unmarked — is not in the list.
    const keys = pageComponentSlotPositions().map((p) => p.key);
    for (const notASlot of ['columns', 'staticData', 'rowActions', 'fields', 'sections']) {
      expect(keys).not.toContain(notASlot);
    }
  });

  it('marks a slot without changing it: the parse and the JSON Schema are the unmarked schema\'s', () => {
    const footer = PageCardProps.shape.footer;
    const unmarked = z.array(z.unknown()).optional().describe('Card footer components (slot)');
    expect(z.toJSONSchema(footer)).toEqual(z.toJSONSchema(unmarked));
    expect(footer.parse(['bare-id', { type: 'element:button' }])).toEqual(['bare-id', { type: 'element:button' }]);
    expect(() => PageCardProps.parse({ body: [] })).toThrow(/`body`.*removed.*`children`/s);
  });

  it('is derived once and handed back frozen', () => {
    const first = pageComponentSlotPositions();
    expect(pageComponentSlotPositions()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((position) => Object.isFrozen(position))).toBe(true);
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

  // #11289 — the three section keys the renderer honoured and this shape
  // rejected (maintainer ruling 2026-08-23, direction 1: declare; renderer
  // unchanged). `hideEmpty: false` is the load-bearing one: it is the only
  // spelling that keeps a section's label skeleton on an all-empty record,
  // and before this declaration `objectstack validate` warned it "did
  // nothing".
  it('preserves the section presentation keys verbatim (#11289)', () => {
    const result = RecordDetailsProps.parse({
      sections: [{
        label: 'Description',
        fields: ['description', 'next_step'],
        hideEmpty: false,
        collapsible: true,
        showBorder: false,
      }],
    });
    expect(result.sections?.[0].hideEmpty).toBe(false);
    expect(result.sections?.[0].collapsible).toBe(true);
    expect(result.sections?.[0].showBorder).toBe(false);
  });

  it('does not materialize the section presentation keys on a clean parse', () => {
    // Optional with NO schema default (the `maxVisible` principle): `true` /
    // off / title-derived are the RENDERER'S fallbacks, and a schema default
    // would turn "the author said nothing" into "the author asked for the
    // default" — a different fact.
    const section = RecordDetailsProps.parse({
      sections: [{ label: 'Overview', fields: ['name'] }],
    }).sections?.[0] as Record<string, unknown>;
    expect('hideEmpty' in section).toBe(false);
    expect('collapsible' in section).toBe(false);
    expect('showBorder' in section).toBe(false);
  });

  it('rejects non-boolean values for the section presentation keys', () => {
    for (const key of ['hideEmpty', 'collapsible', 'showBorder'] as const) {
      const r = RecordDetailsProps.safeParse({
        sections: [{ label: 'A', fields: ['a'], [key]: 'yes' }],
      });
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0].code).toBe('invalid_type');
      expect(r.success === false && r.error.issues[0].path).toEqual(['sections', 0, key]);
    }
  });

  it('still rejects unknown section keys, and the new keys are suggestion candidates', () => {
    // Strictness survives the widening, and the declared keys entered the
    // "did you mean" candidate list — the proof the declaration reached the
    // same error map the strict shape reads.
    const r = RecordDetailsProps.safeParse({
      sections: [{ label: 'A', fields: ['a'], showBorders: true }],
    });
    expect(r.success).toBe(false);
    const message = r.success === false
      ? r.error.issues.map((i) => i.message).join('\n')
      : '';
    expect(message).toContain('`showBorders`');
    // The arrow form specifically — a bare `toContain('showBorder')` is
    // satisfied by the echoed offending key (`showBorders` contains it), which
    // is exactly what reverse verification against the pre-declaration schema
    // measured: that spelling stayed green with no declaration at all.
    expect(message).toContain('`showBorders` → `showBorder`');
  });

  // #11661 — three more section keys in exactly the pre-#11289 position
  // (honoured by the renderer, refused by this shape), declared under the
  // inherited ruling. Measured at the `.objectui-sha` pin (`190fbd01`):
  // `defaultCollapsed` at `DetailSection.tsx:139`
  // (`useState(section.defaultCollapsed ?? false)`), `icon` at
  // `DetailSection.tsx:516/546`, `description` at `DetailSection.tsx:520/557`.
  it('preserves the #11661 section keys verbatim', () => {
    const result = RecordDetailsProps.parse({
      sections: [{
        label: 'Company',
        fields: ['industry', 'website'],
        collapsible: true,
        defaultCollapsed: true,
        icon: 'building-2',
        description: 'Firmographics and reach',
      }],
    });
    expect(result.sections?.[0].defaultCollapsed).toBe(true);
    expect(result.sections?.[0].icon).toBe('building-2');
    expect(result.sections?.[0].description).toBe('Firmographics and reach');
  });

  it('does not materialize the #11661 keys on a clean parse', () => {
    // Same `maxVisible` principle as the #11289 trio: expanded / no icon / no
    // sub-heading are the RENDERER'S fallbacks; a schema default would turn
    // "the author said nothing" into "the author asked for the default".
    const section = RecordDetailsProps.parse({
      sections: [{ label: 'Overview', fields: ['name'] }],
    }).sections?.[0] as Record<string, unknown>;
    expect('defaultCollapsed' in section).toBe(false);
    expect('icon' in section).toBe(false);
    expect('description' in section).toBe(false);
  });

  it('rejects wrongly-typed values for the #11661 keys', () => {
    for (const [key, value] of [
      ['defaultCollapsed', 'yes'],
      ['icon', 7],
      ['description', ['two', 'lines']],
    ] as const) {
      const r = RecordDetailsProps.safeParse({
        sections: [{ label: 'A', fields: ['a'], [key]: value }],
      });
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0].code).toBe('invalid_type');
      expect(r.success === false && r.error.issues[0].path).toEqual(['sections', 0, key]);
    }
  });

  it('still refuses unknown section keys after the #11661 widening', () => {
    // The strict face survives, and the new keys entered the "did you mean"
    // candidate list — the declaration reached the same error map the strict
    // shape reads.
    const r = RecordDetailsProps.safeParse({
      sections: [{ label: 'A', fields: ['a'], defaultCollapse: true }],
    });
    expect(r.success).toBe(false);
    const message = r.success === false
      ? r.error.issues.map((i) => i.message).join('\n')
      : '';
    expect(message).toContain('`defaultCollapse` → `defaultCollapsed`');
  });

  it('still refuses the one key #11661 deliberately withholds (`title`)', () => {
    // Honoured by the renderer at the pin, and OUT of the accept set on
    // purpose: `title` is a second spelling of the heading slot `label`
    // declares (the `page:card` `body`-vs-`children` shape, which #5775
    // converged rather than declared) and is held for a maintainer ruling.
    // A later batch declaring it must flip this pin consciously.
    //
    // `headerColor` was withheld alongside it until #12126 (maintainer
    // ruling A, 2026-08-26): its refusal's recorded reason — a
    // template-literal Tailwind read that generated no CSS — was repaired by
    // objectui#6294's literal-class lookup, so the pin flipped CONSCIOUSLY,
    // as this comment always anticipated. The key's new accept/reject
    // boundary is pinned by the two tests below.
    const r = RecordDetailsProps.safeParse({
      sections: [{ label: 'A', fields: ['a'], title: 'Company' }],
    });
    expect(r.success).toBe(false);
    const message = r.success === false
      ? r.error.issues.map((i) => i.message).join('\n')
      : '';
    expect(message).toContain('`title`');
  });

  it('accepts all six `headerColor` enum tokens verbatim, with no schema default (#12126)', () => {
    // Ruling A: a closed z.enum over exactly the six tokens objectui#6294's
    // `plugin-detail/src/headerColor.ts` lookup ships — complete class
    // literals in a file every consuming app's Tailwind scan covers, so
    // every enum value is guaranteed present in the compiled stylesheet.
    // Declared = enforced.
    for (const token of [
      'muted', 'muted/50', 'accent', 'primary/10', 'secondary/10', 'destructive/10',
    ] as const) {
      const section = RecordDetailsProps.parse({
        sections: [{ label: 'A', fields: ['a'], headerColor: token }],
      }).sections?.[0] as Record<string, unknown>;
      expect(section.headerColor).toBe(token);
    }
    // No schema default: an omitted key means "no tint" — the renderer's own
    // fallback, not an authored request (the `maxVisible` principle).
    const bare = RecordDetailsProps.parse({
      sections: [{ label: 'A', fields: ['a'] }],
    }).sections?.[0] as Record<string, unknown>;
    expect('headerColor' in bare).toBe(false);
  });

  it('refuses `headerColor` values outside the closed enum, by name (#12126)', () => {
    // The boundary ruling A draws: everything outside the six tokens — an
    // arbitrary palette guess (the objectui#6178 silent-no-paint failure
    // mode), the renderer's `bg-*` pass-through spellings (which render only
    // if the HOST app's Tailwind build happens to generate the class), and
    // the solid tokens the tints-only vocabulary deliberately excludes — is
    // refused at authoring time rather than shipping a header that silently
    // does not paint.
    for (const value of ['blue-100', 'bg-muted', 'primary', 'destructive']) {
      const r = RecordDetailsProps.safeParse({
        sections: [{ label: 'A', fields: ['a'], headerColor: value }],
      });
      expect(r.success).toBe(false);
      if (r.success) continue;
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('invalid_value');
      expect(issue.path).toEqual(['sections', 0, 'headerColor']);
    }
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

// ===========================================================================
// #18639 — `record:related_list.columns` IS the saved-view `ListColumn` union
// ===========================================================================
/**
 * Ruling A on objectui#9593 (decision batch #144 item 3, maintainer verbatim
 * 「9593 A，其他同意」): `RecordRelatedListProps.columns` declares the SAME
 * union as the saved-view key `listViews[].columns`, because objectui composes
 * a saved view's columns onto this block VERBATIM (`dataSource.view` →
 * `composeElementDataSource` → `savedViewColumns`). Before it, two published
 * declarations disagreed about one key.
 *
 * What is pinned here:
 *
 *   1. both spellings parse, and the decoration SURVIVES the parse — a
 *      `describe()` promising decoration a parse strips would be the defect
 *      class this card exists to close, one layer over;
 *   2. it is the same DECLARATION, not a lookalike: the object arm is the
 *      `ListColumnSchema` binding itself (reference identity, and the refusal
 *      text carries that schema's own surface word), and block and view give
 *      every fixture the same verdict;
 *   3. what it still REFUSES — an unknown member on a column object, a MIXED
 *      array (the arms are exclusive), a non-array, an identity-less object;
 *   4. the prose↔schema agreement, so the two cannot drift apart silently;
 *   5. the ruling's two scope fences, held by measurement rather than intent.
 */
describe('RecordRelatedListProps.columns — the saved-view ListColumn union (#18639)', () => {
  const base = { objectName: 'contact', relationshipField: 'account_id' };
  const parse = (columns: unknown) => RecordRelatedListProps.safeParse({ ...base, columns });
  /** Refuse `columns` and hand back the issues as a searchable string. */
  const refusalOf = (columns: unknown): string => {
    const r = parse(columns);
    expect(r.success, `expected REJECTION of ${JSON.stringify(columns)}`).toBe(false);
    return JSON.stringify(r.error?.issues ?? []);
  };

  it('still accepts the legacy field-name string array', () => {
    const r = parse(['name', 'email']);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data?.columns).toEqual(['name', 'email']);
  });

  it("accepts a saved view's decorated columns, and the decoration survives the parse", () => {
    const decorated = [
      { field: 'name', label: 'Name', link: true },
      { field: 'amount', width: 120, align: 'right', summary: 'sum' },
      { field: 'internal_note', hidden: true, sortable: false },
    ];
    const r = parse(decorated);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    // Not just "it parsed": the keys the ruling wants on the screen are still
    // there afterwards. A strip would satisfy `success` and lose the point.
    expect(r.data?.columns).toMatchObject(decorated);
  });

  it('is the SAME union the saved-view key declares — the object arm IS ListColumnSchema', () => {
    /** The element schema of a `columns` union's object arm, both carriers. */
    const objectArmElement = (schema: unknown): unknown => {
      const def = (schema as { _zod: { def: Record<string, unknown> } })._zod.def;
      const union = (def.type === 'optional'
        ? (def.innerType as { _zod: { def: Record<string, unknown> } })._zod.def
        : def) as { type: string; options: Array<{ _zod: { def: { element: unknown } } }> };
      expect(union.type).toBe('union');
      expect(union.options).toHaveLength(2);
      return union.options[1]._zod.def.element;
    };
    const blockArm = objectArmElement((RecordRelatedListProps as unknown as {
      shape: Record<string, unknown>;
    }).shape.columns);
    const viewArm = objectArmElement((ListViewSchema as unknown as {
      shape: Record<string, unknown>;
    }).shape.columns);
    // Reference identity, not structural resemblance: one def, two carriers.
    expect(blockArm).toBe(ListColumnSchema);
    expect(viewArm).toBe(ListColumnSchema);
    expect(blockArm).toBe(viewArm);
  });

  it('agrees with `listViews[].columns` on every fixture — one union, two carriers', () => {
    const fixtures: unknown[] = [
      ['name', 'email'],
      [{ field: 'amount', label: 'Amount', width: 120 }],
      [{ field: 'amount', summary: { type: 'avg', field: 'total' } }],
      [{ field: 'name', prefix: { field: 'status', type: 'badge' } }],
      [{ field: 'amount', bogus: 1 }],
      ['name', { field: 'amount' }],
      [{ field: 'name', prefix: { field: 'status', type: 'chip' } }],
      [{}],
      'name',
      { field: 'name' },
    ];
    for (const columns of fixtures) {
      const view = (ListViewSchema as unknown as {
        safeParse: (v: unknown) => { success: boolean };
      }).safeParse({ columns });
      expect(
        parse(columns).success,
        `block and saved view disagree about ${JSON.stringify(columns)}`,
      ).toBe(view.success);
    }
  });

  it("refuses an unknown member on a column object — through ListColumnSchema's own strictness", () => {
    const text = refusalOf([{ field: 'amount', bogus: 1 }]);
    expect(text).toContain('"code":"unrecognized_keys"');
    expect(text).toContain('bogus');
    // The named-surface refusal is ListColumnSchema's own text. A re-spelled
    // lookalike would refuse too, and would not say this.
    expect(text).toContain('this list column');
  });

  it('refuses a MIXED array — the two arms are exclusive, exactly as the describe says', () => {
    const text = refusalOf(['name', { field: 'amount' }]);
    expect(text).toContain('"code":"invalid_union"');
  });

  it('refuses a non-array, and an object entry with no resolvable field', () => {
    refusalOf('name');
    refusalOf({ field: 'name' });
    refusalOf([{}]);
    refusalOf([{ label: 'Amount' }]);
  });

  it('the describe() says what the schema does — override chain and the ListColumn spelling', () => {
    const text = String((RecordRelatedListProps as unknown as {
      shape: Record<string, { description?: string }>;
    }).shape.columns.description);
    // The override chain the ruling asked the describe to name …
    expect(text).toContain('Override chain: child highlightFields → field-level relatedListColumns');
    // … that a view-supplied list may arrive in the ListColumn spelling …
    expect(text).toContain('`ListColumn`');
    expect(text).toContain('listViews[].columns');
    expect(text).toContain('verbatim');
    // … and the exclusivity the schema really enforces (pinned above).
    expect(text).toContain('the two arms are exclusive');
  });
});

describe('#18639 scope fences — held by measurement, not by intent', () => {
  it('`field.relatedListColumns` is still strings-only — a ListColumn entry is refused at the field door', () => {
    const lookup = { name: 'project', label: 'Project', type: 'lookup', reference: 'showcase_project' };
    const field = (relatedListColumns: unknown) =>
      FieldSchema.safeParse({ ...lookup, relatedListColumns });
    expect(field(['status', 'amount']).success).toBe(true);
    const refused = field([{ field: 'amount', label: 'Amount', width: 120 }]);
    expect(refused.success, 'the sibling key stays strings-only by ruling').toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('FIELD-NAME strings');
  });

  it('the `field-column-lists-canonicalized` conversion is unchanged — object entries still fold to the identity string', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === 'field-column-lists-canonicalized');
    expect(entry, 'the ruling keeps this conversion exactly as it is').toBeDefined();
    expect(entry?.surface).toBe('field.inlineColumns[].field / field.relatedListColumns[] object entries');
    const after = entry?.fixture.after as {
      objects: Array<{ fields: Record<string, { relatedListColumns?: unknown }> }>;
    };
    // `{ field: 'status', label: 'Status' }` → `'status'`: the decoration is
    // still DROPPED on this key, which is precisely what widening the block
    // sibling does NOT do.
    expect(after.objects[0].fields.project.relatedListColumns).toEqual(['status', 'amount', 'issued_on']);
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
    // #10054 fixture triage: this pin used to author `icon: 'flag'` — the one
    // in-repo writer of the key that change retired. Respelled rather than
    // deleted: the pin guards the SURVIVING object-arm surface, which is
    // {name, label?, type?, readonly?}.
    const result = RecordHighlightsProps.parse({
      fields: ['name', { name: 'status', label: 'State', type: 'text', readonly: true }],
    });
    expect(result.fields[0]).toBe('name');
    expect(result.fields[1]).toEqual({ name: 'status', label: 'State', type: 'text', readonly: true });
  });

  // ── #10054 — `icon` retired from the object arm (ADR-0049 / ADR-0087) ────
  //
  // Measured dead (census 2026-08-20): the renderer normalized `icon` into a
  // chip with no icon slot, `useRegisterHighlightFields` carries names only,
  // and the Studio designer publishes the field list as `string[]` — while six
  // author-facing surfaces advertised the key. The arm is `strictObject`, so
  // the route is strict deletion + a `guidance` prescription and the refusal
  // is the arm's own named `unrecognized_keys` (the `data/Metric:filters`
  // route, not a `retiredKey` tombstone).
  //
  // Reverse-verified from the committed state: restoring the `icon` line turns
  // the refusal pin red (the parse succeeds) — the pin reads the live schema,
  // not a cached shape.
  describe('retired icon on the RecordHighlightsField object arm (#10054)', () => {
    /**
     * Dig the object arm's own issues out of the zod-4 union collapse: the
     * union reports ONE `invalid_union` whose `errors` tucks each arm's real
     * issues away (the #5583 shape — `zod-issue-format.ts` unpacks this for
     * authors; here the pin asserts the raw material it unpacks).
     */
    const collapsedUnion = (input: unknown) => {
      const r = RecordHighlightsProps.safeParse(input);
      expect(r.success).toBe(false);
      if (r.success) throw new Error('unreachable');
      const union = r.error.issues.find((i) => i.code === 'invalid_union') as {
        code: string;
        path: PropertyKey[];
        errors?: ReadonlyArray<ReadonlyArray<{
          code: string; message: string; path: PropertyKey[]; keys?: string[];
        }>>;
      } | undefined;
      expect(union, 'the union collapse carries the arm issues').toBeDefined();
      return union!;
    };

    it('refuses an authored icon as a named unrecognized_keys rejection carrying the prescription', () => {
      const union = collapsedUnion({ fields: [{ name: 'status', icon: 'flag' }] });
      // The right path: the offending entry, not the whole props bag.
      expect(union.path).toEqual(['fields', 0]);
      const armIssue = (union.errors ?? []).flat().find((i) => i.code === 'unrecognized_keys');
      expect(armIssue, "the object arm's own unrecognized_keys issue").toBeDefined();
      expect(armIssue!.keys).toContain('icon');
      // The named surface and the retirement prescription — citation, the
      // "drawn by nothing" story, and the no-replacement guidance. The `s`
      // flag is house style: the message spans lines.
      expect(armIssue!.message).toMatch(/this `record:highlights` field/);
      expect(armIssue!.message).toMatch(/`record:highlights` field `icon` was removed .*ADR-0049/s);
      expect(armIssue!.message).toMatch(/Delete the key — no replacement: the renderer never drew it/s);
      expect(armIssue!.message).toMatch(/os migrate meta --from 17/);
    });

    it('control: the same entry without icon parses clean — the refusal is about the key, not the arm', () => {
      const result = RecordHighlightsProps.parse({ fields: [{ name: 'status' }] });
      expect(result.fields[0]).toEqual({ name: 'status' });
    });

    it('readonly behaviour is untouched by the retirement', () => {
      const result = RecordHighlightsProps.parse({ fields: [{ name: 'supply_share', readonly: true }] });
      expect((result.fields[0] as { readonly?: boolean }).readonly).toBe(true);
    });
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
    // `ai:chat_window`'s row is KEPT as a refusal door (#21504) — see the
    // describe below; it no longer parses any bag.
    expect(ComponentPropsMap['ai:chat_window']).toBeDefined();
    expect(ComponentPropsMap['ai:suggestion']).toBeDefined();
  });

  // `should parse ai:chat_window with default` LEFT at #21504 — the row
  // refuses every bag now; its flipped twin is the first pin of the
  // `ai:chat_window is retired` describe below.

  it('should parse ai:suggestion with optional context', () => {
    const result = ComponentPropsMap['ai:suggestion'].parse({});
    expect(result.context).toBeUndefined();
  });

  it('should parse empty props schemas for utility components', () => {
    expect(() => ComponentPropsMap['page:footer'].parse({})).not.toThrow();
    expect(() => ComponentPropsMap['global:search'].parse({})).not.toThrow();
    // `user:profile` LEFT this pin at #14159 — see the describe below: it is
    // not author-placeable, so its row refuses even the empty bag.
  });

  // #14159 — ruling B (director seat 2026-09-01, batch #26, maintainer verbatim
  // 「同意」): `user:profile` is shell chrome (the avatar menu), not an
  // author-placeable element, and no renderer is built for it (objectui#7135
  // measured the zero with a positive control). The member is refused BY NAME
  // with one located prescription at every door; `code` + `path` + the first
  // sentence are the pin — never a bare `toThrow()`, which greens on any error.
  describe('user:profile is not author-placeable (#14159, ruling B)', () => {
    const FIRST_SENTENCE =
      /^`user:profile` is not a page-placeable element — it is shell chrome \(the signed-in user's avatar menu, which the app shell renders itself on every page\), no renderer for it exists anywhere by ruling, and there is nothing to put in its place: delete the component node and let the shell render the profile\./;
    // `check:doc-authoring` (maintainer ruling 2026-08-12): a prescription printed
    // at the customer carries no citation-shaped issue id — the ADR id is the
    // durable reference; the issue anchors live in the adjacent source comment.
    const ISSUE_ID = /#\d{3,}/;

    it('the ComponentPropsMap row refuses even the empty bag — the flipped accept pin', () => {
      const r = ComponentPropsMap['user:profile'].safeParse({});
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues[0]!;
      // The `retiredKey` channel at element grain: `expected: 'never'`.
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual([]);
      expect(issue.message).toMatch(FIRST_SENTENCE);
      expect(issue.message).not.toMatch(ISSUE_ID);
      expect(issue.message).toContain('ADR-0049');
      // A populated bag gets the same prescription, not an unknown-key verdict.
      const populated = ComponentPropsMap['user:profile'].safeParse({ showAvatar: true });
      expect(populated.success).toBe(false);
      if (!populated.success) {
        expect(populated.error.issues[0]!.code).toBe('invalid_type');
        expect(populated.error.issues[0]!.message).toMatch(FIRST_SENTENCE);
      }
    });

    it('PageComponentSchema refuses the node by name at `type` — the door the open string arm used to defeat', () => {
      const r = PageComponentSchema.safeParse({ type: 'user:profile' });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('custom');
      expect(issue.path).toEqual(['type']);
      expect(issue.message).toMatch(FIRST_SENTENCE);
      expect((issue as { params?: Record<string, unknown> }).params).toEqual({ retiredComponentType: 'user:profile' });
    });

    it('PageSchema refuses an authored page at the element path — the door `os validate` parses', () => {
      const r = PageSchema.safeParse({
        name: 'home',
        label: 'Home',
        regions: [{
          name: 'main',
          components: [
            { type: 'page:header', properties: { title: 'Home' } },
            { type: 'user:profile' },
          ],
        }],
      });
      expect(r.success).toBe(false);
      if (r.success) return;
      const located = r.error.issues.filter((i) => i.code === 'custom');
      expect(located).toHaveLength(1);
      expect(located[0]!.path).toEqual(['regions', 0, 'components', 1, 'type']);
      expect(located[0]!.message).toMatch(FIRST_SENTENCE);

      // A slot-mounted node goes through the same node schema. The slot is a
      // `z.union([PageComponentSchema, z.array(PageComponentSchema)])`, and zod 4
      // reports a union whose every arm failed as ONE `invalid_union` at the
      // slot's path with the arms' issues nested under `errors`, their paths
      // RELATIVE to the union — a property of the slot union, not of this
      // retirement (an unknown key on a slotted node arrives the same way;
      // `formatZodIssue` renders the nested line with the absolute path, #4971
      // / #5341, and `describeIssue` in `@objectstack/lint` unpacks it, #5583).
      // The located prescription must still be inside it, at the node's `type`.
      const slotted = PageSchema.safeParse({
        name: 'home',
        label: 'Home',
        regions: [],
        slots: { header: { type: 'user:profile' } },
      });
      expect(slotted.success).toBe(false);
      if (!slotted.success) {
        type Nested = { code: string; path: PropertyKey[]; message: string; errors?: Nested[][] };
        const outer = slotted.error.issues.filter((i) => i.code === 'invalid_union');
        expect(outer).toHaveLength(1);
        expect(outer[0]!.path).toEqual(['slots', 'header']);
        const flatten = (issues: Nested[]): Nested[] =>
          issues.flatMap((i) => [i, ...(i.errors ?? []).flatMap(flatten)]);
        const atSlot = flatten(slotted.error.issues as Nested[]).filter((i) => i.code === 'custom');
        expect(atSlot).toHaveLength(1);
        expect(atSlot[0]!.path).toEqual(['type']);
        expect(atSlot[0]!.message).toMatch(FIRST_SENTENCE);
      }
    });

    it('PageComponentType itself refuses the member with the prescription — the enum error map', () => {
      expect(PageComponentType.options).not.toContain('user:profile');
      const r = PageComponentType.safeParse('user:profile');
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues[0]!.code).toBe('invalid_value');
      expect(r.error.issues[0]!.message).toMatch(FIRST_SENTENCE);
      // Only a value that USED to be legal gets the prescription — a stranger
      // keeps zod's own enum message.
      const stranger = PageComponentType.safeParse('user:avatar');
      expect(stranger.success).toBe(false);
      if (!stranger.success) expect(stranger.error.issues[0]!.message).not.toContain('shell chrome');
    });

    it('positive control: the two shipped shell singletons still parse at every door', () => {
      for (const type of ['global:search', 'global:notifications'] as const) {
        expect(() => ComponentPropsMap[type].parse({})).not.toThrow();
        expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
        expect(PageComponentType.safeParse(type).success, type).toBe(true);
      }
    });

    it('preservation: the other three shell singletons are unchanged', () => {
      for (const type of ['app:launcher', 'nav:menu', 'nav:breadcrumb'] as const) {
        expect(() => ComponentPropsMap[type].parse({})).not.toThrow();
        expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
        expect(PageComponentType.safeParse(type).success, type).toBe(true);
        const r = ComponentPropsMap[type].safeParse({ zzUndeclared: 1 });
        expect(r.success, type).toBe(false);
        if (!r.success) expect(r.error.issues.map((i) => i.message).join('\n')).toContain(type);
      }
    });

    it('the open string arm stays open — only the retired NAME is refused', () => {
      for (const type of ['custom.widget', 'mcp:connect-agent', 'object-grid', 'user:avatar']) {
        expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
      }
    });
  });

  // #21504 — triage ruling 5963897014: retire `ai:chat_window` under ADR-0049
  // enforce-or-remove, refused BY NAME, the `user:profile` precedent above.
  // Zero producers measured, and objectui registers no renderer on purpose —
  // the console's floating chat overlay is the AI chat entry point. Same pin
  // shape as that describe: `code` + `path` + `params` + the prescription's
  // first sentence at each door, never a bare `toThrow()`, which greens on any
  // error. The control is `ai:suggestion`, the member of the same namespace the
  // ruling keeps (it has a placeholder renderer — a different class).
  describe('ai:chat_window is retired, refused by name (#21504)', () => {
    const FIRST_SENTENCE =
      /^`ai:chat_window` was removed in @objectstack\/spec 17 \(ADR-0049\) — no renderer for it ever shipped: the console leaves it unregistered on purpose, so a page that placed one validated clean and then drew "Unknown component type" in front of an end user, and its `mode`, `agentId`, `context` and `aria` props configured nothing\./;
    // The supported entry point is NAMED, and the fix is imperative.
    const ENTRY_POINT = 'the floating chat overlay the console mounts on every page is the supported entry point';
    const FIX = 'Delete the `ai:chat_window` component node';
    // `check:doc-authoring` (maintainer ruling 2026-08-12): a prescription
    // printed at the customer carries no citation-shaped issue id.
    const ISSUE_ID = /#\d{3,}/;

    it('the map carries the prescription: the overlay named, the fix imperative, no tracker number', () => {
      const guidance = RETIRED_PAGE_COMPONENT_TYPES.get('ai:chat_window');
      expect(guidance).toBeTypeOf('string');
      expect(guidance!).toMatch(FIRST_SENTENCE);
      expect(guidance!).toContain(ENTRY_POINT);
      expect(guidance!).toContain(FIX);
      expect(guidance!).toContain('ADR-0049');
      expect(guidance!).not.toMatch(ISSUE_ID);
    });

    it('the ComponentPropsMap row refuses even the empty bag — the flipped accept pin', () => {
      for (const bag of [{}, { mode: 'float' }, { agentId: 'ask', context: { recordId: 'r1' } }]) {
        const r = ComponentPropsMap['ai:chat_window'].safeParse(bag);
        expect(r.success, JSON.stringify(bag)).toBe(false);
        if (r.success) continue;
        expect(r.error.issues).toHaveLength(1);
        const issue = r.error.issues[0]!;
        // The `retiredKey` channel at element grain: `expected: 'never'`.
        expect(issue.code).toBe('invalid_type');
        expect(issue.path).toEqual([]);
        expect(issue.message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get('ai:chat_window'));
      }
    });

    it('PageComponentSchema refuses the node by name at `type`, bare or populated', () => {
      for (const properties of [undefined, {}, { mode: 'inline' }]) {
        const r = PageComponentSchema.safeParse(
          properties === undefined ? { type: 'ai:chat_window' } : { type: 'ai:chat_window', properties },
        );
        expect(r.success, `properties=${JSON.stringify(properties)}`).toBe(false);
        if (r.success) continue;
        expect(r.error.issues).toHaveLength(1);
        const issue = r.error.issues[0]!;
        expect(issue.code).toBe('custom');
        expect(issue.path).toEqual(['type']);
        expect(issue.message).toMatch(FIRST_SENTENCE);
        expect((issue as { params?: Record<string, unknown> }).params).toEqual({ retiredComponentType: 'ai:chat_window' });
      }
    });

    it('PageSchema refuses an authored page at the element path — the door `os validate` parses', () => {
      const r = PageSchema.safeParse({
        name: 'account_detail',
        label: 'Account',
        regions: [{
          name: 'main',
          components: [
            { type: 'page:header', properties: { title: 'Account' } },
            { type: 'ai:chat_window', properties: { mode: 'sidebar' } },
          ],
        }],
      });
      expect(r.success).toBe(false);
      if (r.success) return;
      const located = r.error.issues.filter((i) => i.code === 'custom');
      expect(located).toHaveLength(1);
      expect(located[0]!.path).toEqual(['regions', 0, 'components', 1, 'type']);
      expect(located[0]!.message).toMatch(FIRST_SENTENCE);
    });

    it('PageComponentType itself refuses the member with the prescription — the enum error map', () => {
      expect(PageComponentType.options).not.toContain('ai:chat_window');
      const r = PageComponentType.safeParse('ai:chat_window');
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues[0]!.code).toBe('invalid_value');
      expect(r.error.issues[0]!.message).toMatch(FIRST_SENTENCE);
      // Only a value that USED to be legal gets the prescription — a stranger
      // keeps zod's own enum message.
      const stranger = PageComponentType.safeParse('ai:chat');
      expect(stranger.success).toBe(false);
      if (!stranger.success) expect(stranger.error.issues[0]!.message).not.toContain('floating chat overlay');
    });

    it('control: `ai:suggestion`, the member the ruling keeps, still parses at every door', () => {
      expect(RETIRED_PAGE_COMPONENT_TYPES.has('ai:suggestion')).toBe(false);
      expect(PageComponentType.options).toContain('ai:suggestion');
      expect(PageComponentType.safeParse('ai:suggestion').success).toBe(true);
      expect(ComponentPropsMap['ai:suggestion'].safeParse({ context: 'account' }).success).toBe(true);
      expect(PageComponentSchema.safeParse({ type: 'ai:suggestion', properties: { context: 'account' } }).success).toBe(true);
      const page = PageSchema.safeParse({
        name: 'account_detail',
        label: 'Account',
        regions: [{ name: 'main', components: [{ type: 'ai:suggestion' }] }],
      });
      expect(page.success).toBe(true);
    });

    it('the open string arm stays open — only the retired NAME is refused', () => {
      for (const type of ['ai:assistant', 'custom.chat_window', 'object-grid']) {
        expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
      }
    });
  });

  // #11575 — the two `@objectstack/cloud-connection` console widgets. Rows
  // exist so the #5068 gate's dispatch reaches them; the accepted key set is
  // EMPTY, measured from the renderers' read points at the `.objectui-sha`
  // pin (both registrations discard the schema node — `() => <Widget />`).
  describe('plugin console widgets (#11575)', () => {
    it('declares rows for cloud-connection:panel and marketplace:installed-list', () => {
      expect(ComponentPropsMap['cloud-connection:panel']).toBeDefined();
      expect(ComponentPropsMap['marketplace:installed-list']).toBeDefined();
    });

    it('accepts the empty bag both shipped pages author', () => {
      expect(() => ComponentPropsMap['cloud-connection:panel'].parse({})).not.toThrow();
      expect(() => ComponentPropsMap['marketplace:installed-list'].parse({})).not.toThrow();
    });

    it('refuses any authored key, naming the surface — the pre-row silent no-op', () => {
      // Before the rows, both keys below rode through every validator in
      // silence (the widgets read nothing). The refusal must name WHICH
      // zero-prop component refused, or the author is left guessing.
      const panel = ComponentPropsMap['cloud-connection:panel'].safeParse({ pollInterval: 5 });
      expect(panel.success).toBe(false);
      if (!panel.success) {
        const message = panel.error.issues.map((i) => i.message).join('\n');
        expect(message).toContain('cloud-connection:panel');
        expect(message).toContain('pollInterval');
      }

      const list = ComponentPropsMap['marketplace:installed-list'].safeParse({ filter: 'installed' });
      expect(list.success).toBe(false);
      if (!list.success) {
        const message = list.error.issues.map((i) => i.message).join('\n');
        expect(message).toContain('marketplace:installed-list');
        expect(message).toContain('filter');
      }
    });
  });

  // #12344 — the `@objectstack/mcp` console widget, the same mechanism a
  // third instance over. Row exists so the #5068 gate's dispatch reaches it
  // (and so the mcp canonical-envelope gate's door 3 reads its bag instead of
  // carrying a standing exemption); the accepted key set is EMPTY, measured
  // from the renderer's read points at the `.objectui-sha` pin (the
  // registration discards the schema node — `() => <ConnectAgent />` — and
  // the component function takes no parameters).
  describe('mcp console widget (#12344)', () => {
    it('declares a row for mcp:connect-agent', () => {
      expect(ComponentPropsMap['mcp:connect-agent']).toBeDefined();
    });

    it('accepts the empty bag the shipped page authors', () => {
      expect(() => ComponentPropsMap['mcp:connect-agent'].parse({})).not.toThrow();
    });

    it('refuses any authored key, naming the surface — the pre-row silent no-op', () => {
      // Before the row, the key below rode through every validator in
      // silence (the widget reads nothing authored). The refusal must name
      // WHICH zero-prop component refused, or the author is left guessing.
      const widget = ComponentPropsMap['mcp:connect-agent'].safeParse({ serverUrl: 'https://x' });
      expect(widget.success).toBe(false);
      if (!widget.success) {
        const message = widget.error.issues.map((i) => i.message).join('\n');
        expect(message).toContain('mcp:connect-agent');
        expect(message).toContain('serverUrl');
      }
    });
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
// element:number `filter` — the ViewFilterRule ARRAY orthography (ui#6206-B)
// ---------------------------------------------------------------------------
describe("element:number `filter` — one filter orthography platform-wide (ui#6206 Option B)", () => {
  const number = ComponentPropsMap['element:number'];
  const relatedList = ComponentPropsMap['record:related_list'];
  const RULES = [{ field: 'status', operator: 'equals', value: 'won' }];
  const RECORD_FORM = { status: 'won' };
  /** The issues a parse raised AT `key` (top-level), whatever else it raised. */
  const issuesAt = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } }, key: string) =>
    r.success ? [] : r.error!.issues.filter((i) => i.path[0] === key);

  it('accepts a ViewFilterRule[] filter — the acceptance criterion', () => {
    // Before the 2026-08-25 ruling this exact value was REFUSED here (the entry
    // said `FilterConditionSchema`, the MongoDB-style record) while every
    // sibling `filter` input in the map accepted it.
    const r = number.safeParse({ object: 'order', aggregate: 'count', filter: RULES });
    expect(r.success).toBe(true);
    expect(r.data!.filter).toEqual(RULES);
  });

  it('the array carries the REAL ViewFilterRuleSchema, not a lookalike: operators normalize, value shapes are checked', () => {
    // `eq` is a legacy spelling `normalizeFilterOperator` lowers to `equals` — a
    // plain `z.array(z.object(...))` would have echoed it back unchanged.
    const legacy = number.safeParse({
      object: 'order', aggregate: 'count',
      filter: [{ field: 'status', operator: 'eq', value: 'won' }],
    });
    expect(legacy.success).toBe(true);
    expect(legacy.data!.filter![0].operator).toBe('equals');
    // `in` takes an array; a scalar is refused at `filter.0.value` by the rule's
    // own superRefine — the value-shape check rides in with the schema.
    const scalarIn = number.safeParse({
      object: 'order', aggregate: 'count',
      filter: [{ field: 'status', operator: 'in', value: 'won' }],
    });
    expect(scalarIn.success).toBe(false);
    expect(scalarIn.error!.issues.map((i) => i.path.join('.'))).toContain('filter.0.value');
  });

  it('the MongoDB-style record form — what this entry alone used to accept — is REFUSED at the `filter` path', () => {
    // Reverse verification of the convergence, asserted on the issue envelope
    // rather than on a bare `success === false`: the refusal is located at
    // `filter` and names the expected kind. Migration:
    // `element-number-filter-rule-array`.
    const r = number.safeParse({ object: 'order', aggregate: 'count', filter: RECORD_FORM });
    expect(r.success).toBe(false);
    const atFilter = issuesAt(r, 'filter');
    expect(atFilter).toHaveLength(1);
    expect(atFilter[0].code).toBe('invalid_type');
    expect(atFilter[0]).toMatchObject({ expected: 'array' });
    // An operator-object record (`{ amount: { $gt: 100 } }`) is the same form
    // and gets the same verdict — no arm accepts any spelling of the record.
    const opRecord = number.safeParse({ object: 'order', aggregate: 'sum', field: 'amount', filter: { amount: { $gt: 100 } } });
    expect(opRecord.success).toBe(false);
    expect(issuesAt(opRecord, 'filter').map((i) => i.code)).toEqual(['invalid_type']);
  });

  it('shares the array orthography with the sibling `filter` inputs — one value, two doors, the same verdicts', () => {
    // The ruling is "one filter orthography platform-wide", so the pin is
    // cross-entry: the same rule array raises no issue at `filter` on either
    // door, and the same record form is refused at `filter` with the same
    // issue code on both. Each door is asked only about ITS `filter` — the
    // other keys the related list requires are not this pin's subject.
    expect(issuesAt(number.safeParse({ object: 'order', aggregate: 'count', filter: RULES }), 'filter')).toEqual([]);
    expect(issuesAt(relatedList.safeParse({ filter: RULES }), 'filter')).toEqual([]);
    const numberRefusal = issuesAt(number.safeParse({ object: 'order', aggregate: 'count', filter: RECORD_FORM }), 'filter');
    const relatedRefusal = issuesAt(relatedList.safeParse({ filter: RECORD_FORM }), 'filter');
    expect(numberRefusal.map((i) => i.code)).toEqual(['invalid_type']);
    expect(relatedRefusal.map((i) => i.code)).toEqual(numberRefusal.map((i) => i.code));
  });

  it('positive control: a well-formed multi-rule array with a real `in` rule parses through the element', () => {
    const r = number.safeParse({
      object: 'order', aggregate: 'sum', field: 'amount',
      filter: [
        { field: 'status', operator: 'in', value: ['won', 'closed'] },
        { field: 'amount', operator: 'greater_than', value: 100 },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data!.filter).toHaveLength(2);
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
      variant: 'h2',
      align: 'center',
    });
    expect(props.variant).toBe('h2');
    expect(props.align).toBe('center');
  });

  /**
   * The accept set, measured rather than described. Release 2 of the
   * objectui#7450 convergence (#21015; maintainer 2026-09-09, option B) is the
   * narrowing, so the assertion has two halves and BOTH are load-bearing: the
   * nine published values are accepted, and the two pre-convergence spellings
   * are refused BY NAME with their prescription. A pin that only checked the
   * nine would stay green if the retirement were reverted.
   */
  const PUBLISHED_NINE = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'caption', 'overline'] as const;

  it.each(PUBLISHED_NINE)('accepts the published variant %s', variant => {
    const parsed = ElementTextPropsSchema.safeParse({ content: 'Test', variant });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.variant).toBe(variant);
  });

  /**
   * The envelope a schema refusal carries: a ZodError issue with `code` and
   * `path`. There is no ADR-0112 `status` here — that envelope belongs to the
   * API error surface — so these pin the code, the path naming the position,
   * the prescription's first sentence (the FROM → TO an upgrading author greps
   * for) and the house `os migrate meta` sentence.
   */
  const MIGRATE_SENTENCE =
    'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

  it.each([
    ['heading', 'h2'],
    ['subheading', 'h3'],
  ] as const)('refuses `variant: %s` by name, naming `%s`', (retired, level) => {
    const parsed = ElementTextPropsSchema.safeParse({ content: 'Test', variant: retired });
    expect(parsed.success).toBe(false);
    const issues = parsed.success ? [] : parsed.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_value');
    expect(issues[0]!.path).toEqual(['variant']);
    const message = issues[0]!.message;
    expect(message.split(' — ')[0]).toBe(
      `\`${retired}\` was removed from \`element:text\` \`variant\` (\`ElementTextPropsSchema.variant\`) in @objectstack/spec 17.7.0`,
    );
    expect(message).toContain(`Write \`${level}\``);
    expect(message.endsWith(MIGRATE_SENTENCE)).toBe(true);
  });

  it('refuses a retired spelling through the `ComponentPropsMap` row the props gate parses', () => {
    const parsed = ComponentPropsMap['element:text'].safeParse({ content: 'Test', variant: 'subheading' });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map(issue => issue.code)).toEqual(['invalid_value']);
  });

  it('tsc refuses each retired spelling at its typed position', () => {
    // @ts-expect-error — `heading` left `element:text` `variant`.
    const heading: z.input<typeof ElementTextPropsSchema>['variant'] = 'heading';
    // @ts-expect-error — `subheading` left `element:text` `variant`.
    const subheading: z.input<typeof ElementTextPropsSchema>['variant'] = 'subheading';
    // The parse half of the same fact, so neither local is unused.
    expect(ElementTextPropsSchema.safeParse({ content: 'Test', variant: heading }).success).toBe(false);
    expect(ElementTextPropsSchema.safeParse({ content: 'Test', variant: subheading }).success).toBe(false);
  });

  /**
   * The lit control for the refusals above: a value that was never legal keeps
   * zod's own message (which lists the legal tokens) — telling its author the
   * value "was removed" would misinform.
   */
  it('still refuses a value outside the nine, with zod\'s own invalid_value message', () => {
    const parsed = ElementTextPropsSchema.safeParse({ content: 'Test', variant: 'small' });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map(issue => issue.code)).toContain('invalid_value');
    expect(parsed.success ? [] : parsed.error.issues.map(issue => issue.path.join('.'))).toContain('variant');
    expect(parsed.success ? '' : parsed.error.issues[0]!.message).not.toContain('was removed');
  });

  /**
   * Absence is the one thing neither release may move (objectui#6942 keeps
   * the `ui:text` side from synthesising `body`; the spec side always has).
   * `.optional().default('body')` is kept deliberately, so an absent `variant`
   * still materialises `'body'` — pinned here as well as in the minimal-props
   * test above, because that test would keep passing if the default moved to
   * some other member of the enum.
   */
  it('leaves absence exactly where it was — no variant materialises body', () => {
    const parsed = ElementTextPropsSchema.safeParse({ content: 'Test' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.variant).toBe('body');
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
      // The ViewFilterRule array form (ui#6206-B) — this fixture authored the
      // record form `{ status: 'paid' }` while the entry alone accepted it.
      filter: [{ field: 'status', operator: 'equals', value: 'paid' }],
      format: 'currency',
      prefix: '$',
      suffix: ' USD',
    });
    expect(props.filter).toEqual([{ field: 'status', operator: 'equals', value: 'paid' }]);
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
  // FLIPPED (#15110). This pin used to read "still parses at the node level —
  // the refusal lives at the props dispatch", and the docblock above
  // `ElementFilterPropsSchema` recorded why: "A bare node with empty
  // `properties` parses clean (the open `type` union accepts any string, so a
  // node-level refusal is not expressible here)". #14159 built the door that
  // expresses it; `element:filter` is a member of
  // `RETIRED_PAGE_COMPONENT_TYPES`, so the node is refused BY NAME wherever it
  // is written, populated or bare. The located refusal is pinned in the
  // describe below; this one holds the flip itself.
  it('no longer parses at the node level — the name is refused, populated or bare', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:filter',
      properties: { object: 'order', fields: ['status'] },
    })).toThrow(/`element:filter` element is retired/);
    expect(() => PageComponentSchema.parse({
      type: 'element:filter',
      properties: {},
    })).toThrow(/`element:filter` element is retired/);
    // Lit control: a LIVE element in the same namespace is untouched.
    expect(() => PageComponentSchema.parse({
      type: 'element:text', properties: { text: 'hi' },
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
      .toThrow(/`element:filter` property `targetVariable`.*removed.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand/s);
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
describe('Interactive Elements — element:form (retired, #9249)', () => {
  // FLIPPED (#15110). This pin used to read "accepts a bare element:form node
  // (the migrated shape)", on the reading the docblock recorded as structural:
  // "the open `type` union accepts any string, so a node-level refusal is not
  // expressible here". `element:form` is now a member of
  // `RETIRED_PAGE_COMPONENT_TYPES`, so the node is refused by name — the bare
  // migrated shape included, which is the whole point: that is the shape an
  // author is left holding.
  it('no longer accepts a bare element:form node — the migrated shape is refused by name', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:form',
      properties: {},
    })).toThrow(/`element:form` element is retired/);
    // Lit control: a LIVE element in the same namespace is untouched.
    expect(() => PageComponentSchema.parse({
      type: 'element:button', properties: { label: 'Save' },
    })).not.toThrow();
  });

  // Refusal pins — the ELEMENT retired at element grain (#9249): no renderer
  // for `element:form` ever shipped anywhere, so every authorable key is a
  // retiredKey tombstone whose prescription names the live replacement (the
  // object-bound `object-form` block).
  it('refuses every retired key with the element-retirement prescription', () => {
    expect(() => ElementFormPropsSchema.parse({ object: 'contact' }))
      .toThrow(/`element:form` property `object`.*removed.*`element:form` element is retired.*use the object-bound `object-form` block/s);
    expect(() => ElementFormPropsSchema.parse({ fields: ['name', 'email'] }))
      .toThrow(/`element:form` property `fields`.*removed.*Delete the `element:form` component/s);
    expect(() => ElementFormPropsSchema.parse({ mode: 'edit' }))
      .toThrow(/`element:form` property `mode`.*removed/s);
    expect(() => ElementFormPropsSchema.parse({ submitLabel: 'Update' }))
      .toThrow(/`element:form` property `submitLabel`.*removed/s);
    expect(() => ElementFormPropsSchema.parse({ onSubmit: 'navigate_to("page_detail")' }))
      .toThrow(/`element:form` property `onSubmit`.*removed/s);
    expect(() => ElementFormPropsSchema.parse({ aria: { label: 'Form' } }))
      .toThrow(/`element:form` property `aria`.*removed.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand/s);
  });

  // The migrated shape — `element-form-removed` strips all six keys and
  // leaves the bare node — parses clean and materializes nothing. (The
  // pre-retirement schema REQUIRED `object` and defaulted `mode`, so `{}`
  // used to throw and a parse used to materialize `mode: 'create'`; both
  // died with the element.)
  it('parses a bare (migrated) node clean and materializes nothing', () => {
    const props = ElementFormPropsSchema.parse({});
    for (const key of ['object', 'fields', 'mode', 'submitLabel', 'onSubmit', 'aria']) {
      expect(props).not.toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// The two element-grain retirements are refused BY NAME at the node (#15110)
// ---------------------------------------------------------------------------

/**
 * #15110 — the node-level half of #9220 / #9249, expressed through the door
 * #14159 built for `user:profile`. Each element's own docblock recorded the
 * surviving bare node as structural, not intended: "A bare node with empty
 * `properties` parses clean (the open `type` union accepts any string, so a
 * node-level refusal is not expressible here)". It is expressible one level up.
 *
 * The shape mirrors the `user:profile` describe above deliberately: `code` +
 * `path` + `params` + the prescription's text are the pin, never a bare
 * `toThrow()`, which greens on any error.
 */
describe('element:filter / element:form are refused by name at the node (#15110)', () => {
  // `check:doc-authoring` (maintainer ruling 2026-08-12): a prescription
  // printed at the customer carries no citation-shaped issue id.
  const ISSUE_ID = /#\d{3,}/;
  const cases = [
    { type: 'element:filter', props: ElementFilterPropsSchema, key: 'object',
      marker: 'list surfaces own their filtering' },
    { type: 'element:form', props: ElementFormPropsSchema, key: 'object',
      marker: 'use the object-bound `object-form` block instead' },
  ] as const;

  it.each(cases)('$type is a member with a prescription that names no issue id', ({ type, marker }) => {
    const guidance = RETIRED_PAGE_COMPONENT_TYPES.get(type);
    expect(guidance).toBeTypeOf('string');
    expect(guidance!).toMatch(new RegExp('^`' + type + '` was removed in @objectstack/spec 17 '));
    expect(guidance!).toContain('ADR-0049');
    expect(guidance!).toContain(marker);
    expect(guidance!).not.toMatch(ISSUE_ID);
  });

  /**
   * The anti-drift pin. The node prescription is not new prose: it is the
   * element-grain TAIL of this element's own `retiredKey` tombstones, with the
   * per-key head dropped. Holding the two equal BY BYTES is what keeps the
   * node door and the props door telling one story — the `user:profile` shape
   * ("one prescription, three doors") reached at a type whose row could not be
   * `z.never`, because it has six tombstoned keys with more to say.
   */
  it.each(cases)('$type: the node prescription is the tombstones\' own tail, byte for byte', ({ type, props, key }) => {
    const node = RETIRED_PAGE_COMPONENT_TYPES.get(type)!;
    const tail = node.slice(node.indexOf('\u2014 ') + 2);
    expect(tail.length).toBeGreaterThan(200);
    const r = props.safeParse({ [key]: 'x' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]!.message).toContain(tail);
    // ...and the head is the only difference: the key message names the key.
    expect(r.error.issues[0]!.message).toContain('property `' + key + '`');
    expect(node).not.toContain('property `' + key + '`');
  });

  it.each(cases)('$type: PageComponentSchema refuses the node at `type`, bare or populated', ({ type }) => {
    for (const properties of [undefined, {}, { object: 'order' }]) {
      const r = PageComponentSchema.safeParse(
        properties === undefined ? { type } : { type, properties },
      );
      expect(r.success, `properties=${JSON.stringify(properties)}`).toBe(false);
      if (r.success) continue;
      const located = r.error.issues.filter((i) => i.code === 'custom');
      expect(located).toHaveLength(1);
      expect(located[0]!.path).toEqual(['type']);
      expect(located[0]!.message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get(type));
      expect((located[0]! as { params?: Record<string, unknown> }).params)
        .toEqual({ retiredComponentType: type });
    }
  });

  it.each(cases)('$type: PageSchema locates it at the element path — the door `os validate` parses', ({ type }) => {
    const r = PageSchema.safeParse({
      name: 'board',
      label: 'Board',
      regions: [{
        name: 'main',
        components: [
          { type: 'page:header', properties: { title: 'Board' } },
          { type },
        ],
      }],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const located = r.error.issues.filter((i) => i.code === 'custom');
    expect(located).toHaveLength(1);
    expect(located[0]!.path).toEqual(['regions', 0, 'components', 1, 'type']);
    expect(located[0]!.message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get(type));
  });

  it.each(cases)('$type: the enum error map carries the same prescription', ({ type }) => {
    expect(PageComponentType.options).not.toContain(type);
    const r = PageComponentType.safeParse(type);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]!.code).toBe('invalid_value');
    expect(r.error.issues[0]!.message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get(type));
  });

  /**
   * The kept row is the reason these two are NOT `retiredComponentProps`: six
   * tombstoned keys each, and a per-key prescription says more than one
   * whole-bag refusal could. The empty bag still parses AT THE ROW — that door
   * is simply no longer reachable through `PageComponentSchema`, which is
   * pinned above. Both halves are load-bearing, so both are pinned.
   */
  it.each(cases)('$type: the row keeps dispatching per key, and still accepts the empty bag', ({ type, props, key }) => {
    expect(Object.keys(ComponentPropsMap)).toContain(type);
    expect(props.safeParse({}).success).toBe(true);
    expect(props.safeParse({ [key]: 'x' }).success).toBe(false);
  });

  it('a LIVE element in the same namespace is untouched — the lit control', () => {
    for (const type of ['element:text', 'element:number', 'element:image', 'element:divider',
      'element:button', 'element:record_picker', 'element:text_input']) {
      expect(RETIRED_PAGE_COMPONENT_TYPES.has(type), type).toBe(false);
      expect(PageComponentSchema.safeParse({ type }).success, type).toBe(true);
    }
    // ...as is the open arm outside the reserved namespaces.
    expect(PageComponentSchema.safeParse({ type: 'object-grid' }).success).toBe(true);
    expect(PageComponentSchema.safeParse({ type: 'mcp:connect-agent' }).success).toBe(true);
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
      // The ViewFilterRule array form (ui#6206-B, #14406) — this fixture
      // authored the record form `{ status: 'active' }` while the entry alone
      // accepted it.
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
      placeholder: 'Search accounts...',
      emptyText: 'No accounts',
    });
    expect(props.labelField).toBe('name');
    expect(props.valueField).toBe('id');
    expect(props.label).toBe('Account');
    expect(props.filter).toEqual([{ field: 'status', operator: 'equals', value: 'active' }]);
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

  // ── commit 78f0be872 — the flat `sort` / `limit` shorthands ──────────────
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
// element:record_picker `filter` — the ViewFilterRule ARRAY orthography (ui#6206-B, #14406)
// ---------------------------------------------------------------------------
describe("element:record_picker `filter` — one filter orthography platform-wide (ui#6206 Option B, #14406)", () => {
  const picker = ComponentPropsMap['element:record_picker'];
  const number = ComponentPropsMap['element:number'];
  const relatedList = ComponentPropsMap['record:related_list'];
  const RULES = [{ field: 'status', operator: 'equals', value: 'active' }];
  const RECORD_FORM = { status: 'active' };
  type ParseResult = { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } };
  /** The issues a parse raised AT `key` (top-level), whatever else it raised. */
  const issuesAt = (r: ParseResult, key: string) =>
    r.success ? [] : r.error!.issues.filter((i) => i.path[0] === key);

  it('accepts a ViewFilterRule[] filter — the acceptance criterion', () => {
    // Before #14406 this exact value was REFUSED here — the entry said
    // `FilterConditionSchema`, the MongoDB-style record, the LAST one in the
    // map — while every sibling `filter` input accepted it. Measured at the
    // objectui pin before the declaration moved: the renderer hands the value
    // to `query.$filter`, and `adapter.find()` lowers a rule array through
    // `translateFilterArray`, so the array reaches the query.
    const r = picker.safeParse({ object: 'account', filter: RULES });
    expect(r.success).toBe(true);
    expect(r.data!.filter).toEqual(RULES);
  });

  it('the array carries the REAL ViewFilterRuleSchema, not a lookalike: operators normalize, value shapes are checked', () => {
    // `eq` is a legacy spelling `normalizeFilterOperator` lowers to `equals` — a
    // plain `z.array(z.object(...))` would have echoed it back unchanged.
    const legacy = picker.safeParse({
      object: 'account',
      filter: [{ field: 'status', operator: 'eq', value: 'active' }],
    });
    expect(legacy.success).toBe(true);
    expect(legacy.data!.filter![0].operator).toBe('equals');
    // `in` takes an array; a scalar is refused at `filter.0.value` by the rule's
    // own superRefine — the value-shape check rides in with the schema.
    const scalarIn = picker.safeParse({
      object: 'account',
      filter: [{ field: 'status', operator: 'in', value: 'active' }],
    });
    expect(scalarIn.success).toBe(false);
    expect(scalarIn.error!.issues.map((i) => i.path.join('.'))).toContain('filter.0.value');
  });

  it('the MongoDB-style record form — what this entry alone used to accept — is REFUSED at the `filter` path', () => {
    // Reverse verification of the convergence, asserted on the issue envelope
    // rather than on a bare `success === false`: the refusal is located at
    // `filter` and names the expected kind. Migration:
    // `element-record-picker-filter-rule-array`.
    const r = picker.safeParse({ object: 'account', filter: RECORD_FORM });
    expect(r.success).toBe(false);
    const atFilter = issuesAt(r, 'filter');
    expect(atFilter).toHaveLength(1);
    expect(atFilter[0].code).toBe('invalid_type');
    expect(atFilter[0]).toMatchObject({ expected: 'array' });
    // An operator-object record and a `$and` group are the same form and get
    // the same verdict — no arm accepts any spelling of the record.
    const opRecord = picker.safeParse({ object: 'account', filter: { amount: { $gt: 100 } } });
    expect(issuesAt(opRecord, 'filter').map((i) => i.code)).toEqual(['invalid_type']);
    const group = picker.safeParse({ object: 'account', filter: { $and: [{ status: 'active' }] } });
    expect(issuesAt(group, 'filter').map((i) => i.code)).toEqual(['invalid_type']);
  });

  it('shares the array orthography with the sibling `filter` inputs — one value, three doors, the same verdicts', () => {
    // The ruling is "one filter orthography platform-wide" and this entry was
    // the last holdout, so the pin is cross-entry: the same rule array raises
    // no issue at `filter` on any of the three declared doors, and the same
    // record form is refused at `filter` with the same issue code on all
    // three. Each door is asked only about ITS `filter`.
    expect(issuesAt(picker.safeParse({ object: 'account', filter: RULES }), 'filter')).toEqual([]);
    expect(issuesAt(number.safeParse({ object: 'account', aggregate: 'count', filter: RULES }), 'filter')).toEqual([]);
    expect(issuesAt(relatedList.safeParse({ filter: RULES }), 'filter')).toEqual([]);
    const pickerRefusal = issuesAt(picker.safeParse({ object: 'account', filter: RECORD_FORM }), 'filter').map((i) => i.code);
    expect(pickerRefusal).toEqual(['invalid_type']);
    expect(issuesAt(number.safeParse({ object: 'account', aggregate: 'count', filter: RECORD_FORM }), 'filter').map((i) => i.code))
      .toEqual(pickerRefusal);
    expect(issuesAt(relatedList.safeParse({ filter: RECORD_FORM }), 'filter').map((i) => i.code)).toEqual(pickerRefusal);
  });

  it('no top-level `filter` door in ComponentPropsMap refuses the rule array any more — the census the card closes', () => {
    // The card's claim is "the last record-form `filter` in `ComponentPropsMap`".
    // Asserted over the WHOLE map by shape rather than over the entries named
    // above, so a future entry declaring `FilterConditionSchema` at `filter`
    // (which refuses an array outright, `invalid_type`) is caught here by
    // name. The holdout shape is exactly "declares `filter`, refuses the
    // array". A door declaring `z.unknown()` accepted both forms and was never
    // a holdout of THIS census by construction — which is why the four
    // `object-*` doors needed the complementary pin below (#15449): "every
    // `filter` door refuses the record".
    type Door = { shape?: Record<string, unknown>; safeParse: (v: unknown) => ParseResult };
    const doors = (Object.entries(ComponentPropsMap) as Array<[string, unknown]>)
      .filter(([, schema]) => {
        const shape = (schema as Door).shape;
        return !!shape && 'filter' in shape;
      })
      .map(([type]) => type);
    // Guard the probe: the three doors pinned above must be found, or the
    // shape read has gone wrong and the loop below is vacuous.
    expect(doors).toEqual(expect.arrayContaining(['element:record_picker', 'element:number', 'record:related_list']));
    const holdouts = doors.filter((type) => {
      const r = (ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as Door).safeParse({ filter: RULES });
      return issuesAt(r, 'filter').length > 0;
    });
    expect(holdouts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The seven `object-*` `filter` doors — the ViewFilterRule ARRAY orthography
// (ui#6206-B reaching the object-* family: #15449, folded into #15442,
// decision batch #55, option A: family-wide, one ADR-0087 D3 entry). The last
// three joined at #18305, when `object-map` / `object-gantt` / `object-tree`
// got their rows: a NEW `filter` door on this family declares the ruled
// orthography from birth — the ruling is family-wide, so there is no
// "measured before the ruling" arm left for a door that did not exist then.
// ---------------------------------------------------------------------------
describe('the seven `object-*` `filter` doors — one filter orthography platform-wide (ui#6206-B, #15449, #18305)', () => {
  const OBJECT_DOORS = [
    'object-grid', 'object-metric', 'object-kanban', 'object-calendar',
    'object-map', 'object-gantt', 'object-tree',
  ] as const;
  const RULES = [{ field: 'status', operator: 'not_equals', value: 'done' }];
  const RECORD_FORM = { status: { $ne: 'done' } };
  /** The showcase's `object-grid` used to author THIS — an ObjectQL AST tuple array. */
  const TUPLE_ARRAY = [['owner_id', '=', '{current_user_id}']];
  type ParseResult = { success: boolean; data?: { filter?: unknown }; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } };
  type Door = { shape?: Record<string, unknown>; safeParse: (v: unknown) => ParseResult };
  const door = (type: string) => ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as Door;
  const issuesAtPath = (r: ParseResult, path: string) =>
    r.success ? [] : r.error!.issues.filter((i) => i.path.join('.') === path);

  it.each(OBJECT_DOORS)('%s accepts a ViewFilterRule[] filter and echoes it — the acceptance criterion', (type) => {
    // Measured at the objectui pin `53ded82b` before the declarations moved:
    // grid lowers the rule array through `toFilterNode`; kanban and calendar
    // hand it verbatim to `$filter`, where `convertQueryParams` lowers it; the
    // metric's aggregate path lowers it through `translateFilterArray` and
    // `parseFilterAST` before `POST /analytics/query` (objectui#7754 — the
    // door the family was sequenced behind, #15828 / the pin bump commit 30b099078). Re-measured at
    // the same pin for the three #18305 doors: `ObjectMap.tsx:742`,
    // `ObjectGantt.tsx:738` and `ObjectTree.tsx:474` each hand `schema.filter`
    // verbatim to `$filter`, the kanban/calendar shape.
    const r = door(type).safeParse({ objectName: 'showcase_task', filter: RULES });
    expect(r.success).toBe(true);
    expect(r.data!.filter).toEqual(RULES);
  });

  it.each(OBJECT_DOORS)('%s carries the REAL ViewFilterRuleSchema: a legacy operator spelling normalizes on parse', (type) => {
    // `z.unknown()` echoed `ne` back unchanged; the real rule schema lowers it.
    const r = door(type).safeParse({ objectName: 'showcase_task', filter: [{ field: 'status', operator: 'ne', value: 'done' }] });
    expect(r.success).toBe(true);
    expect((r.data!.filter as Array<{ operator: string }>)[0].operator).toBe('not_equals');
  });

  it.each(OBJECT_DOORS)('%s REFUSES the MongoDB-style record at the `filter` path — what `z.unknown()` used to take silently', (type) => {
    // Reverse verification on the issue envelope: located at `filter`, kind
    // named. Before #15449 this exact value parsed with zero issues on every
    // one of the four doors (measured, census report on #15442). Migration:
    // `element-data-source-and-object-block-filter-rule-array`.
    const r = door(type).safeParse({ objectName: 'showcase_task', filter: RECORD_FORM });
    expect(r.success).toBe(false);
    const atFilter = issuesAtPath(r, 'filter');
    expect(atFilter).toHaveLength(1);
    expect(atFilter[0].code).toBe('invalid_type');
    expect(atFilter[0]).toMatchObject({ expected: 'array' });
    const plain = door(type).safeParse({ objectName: 'showcase_task', filter: { status: 'done' } });
    expect(issuesAtPath(plain, 'filter').map((i) => i.code)).toEqual(['invalid_type']);
  });

  it.each(OBJECT_DOORS)('%s REFUSES the ObjectQL AST tuple array at `filter.0` — the other shape `z.unknown()` took', (type) => {
    // The showcase's work-queue grid authored this until #15442 migrated it to
    // the rule object; the container is right and the element is the wrong
    // kind, so the refusal sits one hop deeper than the record's.
    const r = door(type).safeParse({ objectName: 'showcase_task', filter: TUPLE_ARRAY });
    expect(r.success).toBe(false);
    expect(issuesAtPath(r, 'filter')).toEqual([]);
    expect(issuesAtPath(r, 'filter.0').map((i) => i.code)).toEqual(['invalid_type']);
  });

  it('every `filter` door in ComponentPropsMap refuses the record — the twin of the #14406 census pin', () => {
    // The #14406 pin above asks "does any `filter` door refuse the ARRAY?" and
    // cannot see an accept-anything door by construction. This is the other
    // half of "one filter orthography": asked over the WHOLE map by shape, so
    // a future entry declaring `filter` as `z.unknown()` or as the record is
    // caught here by name. Guarded the same way — the doors pinned above must
    // be found, or the shape read has gone wrong and the loop is vacuous.
    const doors = (Object.entries(ComponentPropsMap) as Array<[string, unknown]>)
      .filter(([, schema]) => {
        const shape = (schema as Door).shape;
        return !!shape && 'filter' in shape;
      })
      .map(([type]) => type);
    expect(doors).toEqual(expect.arrayContaining([...OBJECT_DOORS, 'element:record_picker', 'element:number', 'record:related_list']));
    const recordTakers = doors.filter((type) => {
      const r = door(type).safeParse({ filter: RECORD_FORM });
      return issuesAtPath(r, 'filter').length === 0;
    });
    expect(recordTakers).toEqual([]);
  });
});

describe('the four `object-*` `sort` doors — one sort orthography, the array (objectui#8221, decision batch #77, option B; #18305)', () => {
  // `object-map` and `object-gantt` joined at #18305: both hand `schema.sort`
  // to the SAME shared sink the grid and the calendar do
  // (`convertSortToQueryParams`, `core/src/utils/sort-query.ts`) —
  // `ObjectMap.tsx:743`, `ObjectGantt.tsx:739` at the pin `53ded82b`.
  // `object-tree` is deliberately NOT here: its fetch (`ObjectTree.tsx:473-484`)
  // carries `$filter`, `$top` and `$expand` and no `$orderby` at all, so its row
  // declares no `sort` — a door with no read site is what this family refuses to
  // publish.
  const SORT_DOORS = ['object-grid', 'object-calendar', 'object-map', 'object-gantt'] as const;
  const ARRAY_FORM = [{ field: 'created_at', order: 'desc' }];
  /**
   * The legacy OData-ish clause `convertSortToQueryParams` honours at the
   * objectui pin `53ded82b` (`core/src/utils/sort-query.ts:66-70`) and that
   * `ObjectGrid.tsx:1845-1846` puts on `$orderby` verbatim. Retired by the
   * ruling; refused here.
   */
  const STRING_FORM = 'created_at desc';
  type ParseResult = { success: boolean; data?: { sort?: unknown }; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } };
  type Door = { shape?: Record<string, unknown>; safeParse: (v: unknown) => ParseResult };
  const door = (type: string) => ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as Door;
  const issuesAtPath = (r: ParseResult, path: string) =>
    r.success ? [] : r.error!.issues.filter((i) => i.path.join('.') === path);

  it.each(SORT_DOORS)('%s accepts a SortItem[] and echoes it — the acceptance criterion', (type) => {
    const r = door(type).safeParse({ objectName: 'showcase_task', sort: ARRAY_FORM });
    expect(r.success).toBe(true);
    expect(r.data!.sort).toEqual(ARRAY_FORM);
  });

  it.each(SORT_DOORS)('%s carries the REAL SortItemSchema, not a lookalike: the direction enum and the required pair are checked', (type) => {
    // `z.unknown()` echoed every one of these back with `success: true`.
    const spelledOut = door(type).safeParse({ objectName: 'showcase_task', sort: [{ field: 'created_at', order: 'descending' }] });
    expect(issuesAtPath(spelledOut, 'sort.0.order').map((i) => i.code)).toEqual(['invalid_value']);
    // Same code as the misspelling above, and deliberately so: `order` is a
    // required enum, so an ABSENT direction and a wrong one are one verdict at
    // one path — the pair is what the schema asks for.
    const noDirection = door(type).safeParse({ objectName: 'showcase_task', sort: [{ field: 'created_at' }] });
    expect(issuesAtPath(noDirection, 'sort.0.order').map((i) => i.code)).toEqual(['invalid_value']);
    const noField = door(type).safeParse({ objectName: 'showcase_task', sort: [{ order: 'asc' }] });
    expect(issuesAtPath(noField, 'sort.0.field').map((i) => i.code)).toEqual(['invalid_type']);
  });

  it.each(SORT_DOORS)('%s REFUSES the legacy string clause at the `sort` path — the shape the ruling retires', (type) => {
    // Reverse verification on the issue envelope: located at `sort`, kind
    // named. Before this change the same value parsed with zero issues on
    // both doors (the card's measurement on `@objectstack/spec` 17.2.0, and
    // the ablation in the landing PR re-runs it against this tree).
    const r = door(type).safeParse({ objectName: 'showcase_task', sort: STRING_FORM });
    expect(r.success).toBe(false);
    const atSort = issuesAtPath(r, 'sort');
    expect(atSort).toHaveLength(1);
    expect(atSort[0].code).toBe('invalid_type');
    expect(atSort[0]).toMatchObject({ expected: 'array' });
  });

  it.each(SORT_DOORS)('%s REFUSES a bare number at `sort` — the other value `z.unknown()` receipted', (type) => {
    const r = door(type).safeParse({ objectName: 'showcase_task', sort: 3 });
    expect(issuesAtPath(r, 'sort').map((i) => i.code)).toEqual(['invalid_type']);
  });

  it.each(SORT_DOORS)('%s still refuses an undeclared key BY NAME on the same call — the control the card keeps', (type) => {
    // The control that makes the three readings above verdicts rather than a
    // schema that reports nothing: key checking was never the thing that was
    // missing on these doors, the VALUE was.
    const r = door(type).safeParse({ objectName: 'showcase_task', sort: ARRAY_FORM, bogusProp: 1 });
    expect(r.success).toBe(false);
    expect(issuesAtPath(r, 'sort')).toEqual([]);
    const unrecognized = r.error!.issues.filter((i) => i.code === 'unrecognized_keys') as Array<{ keys?: string[] }>;
    expect(unrecognized.flatMap((i) => i.keys ?? [])).toContain('bogusProp');
  });

  it('`sort` agrees with `dataSource.sort` and with the picker shorthand — one shape, four doors', () => {
    // The map's own copies are the same import (`SortItemSchema`), so this
    // asks the question the copies could not: do the doors AGREE, value for
    // value, with the binding every data-bound element already carries.
    const viaBinding = ElementDataSourceSchema.parse({ object: 'showcase_task', sort: ARRAY_FORM });
    for (const type of [...SORT_DOORS, 'element:record_picker']) {
      const value = type === 'element:record_picker'
        ? { object: 'showcase_task', sort: ARRAY_FORM }
        : { objectName: 'showcase_task', sort: ARRAY_FORM };
      const r = door(type).safeParse(value);
      expect([type, r.success]).toEqual([type, true]);
      expect([type, r.data!.sort]).toEqual([type, viaBinding.sort]);
      const refused = door(type).safeParse({ ...value, sort: STRING_FORM });
      expect([type, issuesAtPath(refused, 'sort').map((i) => i.code)]).toEqual([type, ['invalid_type']]);
    }
  });

  it('the census: no `sort` door in ComponentPropsMap takes a string except `record:related_list`, whose string is a DIFFERENT dialect and was not ruled', () => {
    // Asked over the WHOLE map by shape rather than by the two names above, so
    // a future entry declaring `sort` as `z.unknown()` is caught here by name.
    // Guarded the same way as its `filter` twin: the doors pinned above must
    // be found, or the shape read has gone wrong and the loop is vacuous.
    const doors = (Object.entries(ComponentPropsMap) as Array<[string, unknown]>)
      .filter(([, schema]) => {
        const shape = (schema as Door).shape;
        return !!shape && 'sort' in shape;
      })
      .map(([type]) => type);
    expect(doors).toEqual(expect.arrayContaining([...SORT_DOORS, 'element:record_picker', 'record:related_list']));
    const stringTakers = doors.filter((type) => issuesAtPath(door(type).safeParse({ sort: STRING_FORM }), 'sort').length === 0);
    // ⚠️ `record:related_list` is the ONE deliberate exception and it is pinned
    // as such, not tolerated: its string is the `'field'` / `'-field'` form
    // read by `RelatedList.normalizeSortSpec`, a different dialect that never
    // reaches `convertSortToQueryParams` — measured by objectui#8221's own
    // implementing round, which narrowed it, established the dialect and then
    // reverted the narrowing byte-identically. Retiring it was not ruled and
    // would delete working, spec-legal behaviour.
    expect(stringTakers).toEqual(['record:related_list']);
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

  // Flip of "should parse element:form props" (#9249): same shape as
  // element:filter above — the kept row dispatches to tombstones.
  it('refuses element:form props through the kept map row (retired, #9249)', () => {
    expect(() => ComponentPropsMap['element:form'].parse({
      object: 'contact',
    })).toThrow(/`element:form` element is retired/s);
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

  // -------------------------------------------------------------------------
  // `types` is an OPEN vocabulary (commit 1a6a19c31, executing the 2026-08-24 maintainer
  // ruling commit 88b9d749a declared: `sys_activity.type` is author-extensible, and "every
  // closed map over this vocabulary is now the bug"). The closed-enum pin that
  // used to live here ("should reject invalid feed item type",
  // `types: ['invalid_type']` throwing) pinned exactly the branch the ruling
  // removed — it is replaced, not merely reworded, by the cases below.
  // -------------------------------------------------------------------------
  it('accepts author-contributed activity kinds beyond the built-in set (#11507 ruling, #11658)', () => {
    // 'scheduled' is a real contributed value (hotcrm writes it today);
    // 'my_custom_kind' stands in for any future author vocabulary.
    const result = RecordActivityProps.safeParse({
      types: ['comment', 'scheduled', 'my_custom_kind'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.types).toEqual(['comment', 'scheduled', 'my_custom_kind']);
    }
  });

  it('does not reject a typo of a built-in kind by name — the ruling accepted this cost (#11658)', () => {
    // Under the closed enum, 'commnet' got a named rejection. An open
    // vocabulary cannot distinguish a typo from a contributed kind, and the
    // ruling accepted that trade rather than re-close the vocabulary.
    const result = RecordActivityProps.safeParse({ types: ['commnet'] });
    expect(result.success).toBe(true);
  });

  it('still rejects non-string and empty entries — open vocabulary, not untyped (#11658)', () => {
    const nonString = RecordActivityProps.safeParse({ types: [42] });
    expect(nonString.success).toBe(false);
    if (!nonString.success) {
      expect(nonString.error.issues[0]?.path).toEqual(['types', 0]);
    }
    const empty = RecordActivityProps.safeParse({ types: [''] });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0]?.path).toEqual(['types', 0]);
    }
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
      // #14159 — a row retired at element grain is `z.never` itself: no shape,
      // no catchall, refuses every bag including `{}`. Closed by construction;
      // the positive control below still exercises it through the parse.
      if (def.type === 'never') continue;
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

  it('the nine ruled blocks are registered; object-chart deliberately is NOT', () => {
    // Six at #7751, three more at #18305 (`object-map` / `object-gantt` /
    // `object-tree`) — the blocks that section enumerated past rather than
    // ruled out. `Object.keys(ComponentPropsMap)` is what every downstream
    // reader dispatches on, so the row set is pinned by name here.
    for (const type of [
      'object-grid', 'object-metric', 'object-kanban', 'object-calendar',
      'object-form', 'object-master-detail-form',
      'object-map', 'object-gantt', 'object-tree',
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
    // The node as the showcase authors it since #15442 / #15449: the
    // `ViewFilterRule` array (ui#6206-B). The AST tuple this pin carried
    // before is refused at `filter.0` now — pinned in the object-* filter
    // describe below.
    const parsed = ComponentPropsMap['object-grid'].parse({
      objectName: 'showcase_task',
      columns: ['title', 'project', 'status', 'priority', 'due_date'],
      filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
    });
    expect(parsed.filter).toEqual([{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }]);
  });

  it("object-grid `data` takes the ViewDataSchema provider object — the ui#6207 convergence (Option A)", () => {
    // The #5090-pinned authority: static inline rows are `{ provider: 'value',
    // items }`. Before the 2026-08-25 ruling this exact value was REFUSED by
    // this entry ("expected array, received object") while being the
    // pinned-legal form of the authority the objectui declaration is held to.
    const inline = ComponentPropsMap['object-grid'].safeParse({
      data: { provider: 'value', items: [] },
    });
    expect(inline.success).toBe(true);
    // A second arm of the union, to prove the whole discriminated authority is
    // reachable through this entry rather than one hardcoded branch.
    const bound = ComponentPropsMap['object-grid'].safeParse({
      data: { provider: 'object', object: 'showcase_task' },
    });
    expect(bound.success).toBe(true);
  });

  it('the bare-array `data` — the deprecated `staticData` shortcut — is REFUSED at the `data` path', () => {
    // Reverse verification of the convergence: the value this entry used to
    // accept (`z.array(z.unknown())`) no longer parses. The #4648 carve-out
    // already refuses to publish the bare-array author; this closes the spec
    // entry that still advertised it. Migration:
    // `object-grid-data-view-data-converged`.
    const r = ComponentPropsMap['object-grid'].safeParse({ data: [{ id: 1 }] });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === 'data')).toBe(true);
  });

  it('`defaultFilters` stays HONOURED — it is a read legacy fallback, not an inert spelling', () => {
    // ObjectGrid.tsx reads it and lowers it to `$filter` when `filter` is
    // absent (the routed finding on #7751 verified the read point). Only the
    // plural `filters` has zero read points.
    //
    // [#19514] The VALUE this pin carries moved, and the pin's subject did not.
    // The key is still honoured and still parses; what changed is that it now
    // carries `filter`'s own declaration — the same value in the same role,
    // read through the same lowering sink — instead of `z.unknown()`. The AST
    // tuple array this pin used to spell is one the pinned objectui grid
    // APPLIES (`toFilterNode` passes it through and `parseFilterAST` accepts
    // it), so its refusal here is a spelling change for the author, not the
    // repair of a filter that failed. Its refusal is pinned below, and in full
    // at `component-object-grid-default-filters.pin.test.ts`.
    const rules = [{ field: 'status', operator: 'equals', value: 'open' }];
    const parsed = ComponentPropsMap['object-grid'].parse({
      objectName: 'showcase_task',
      defaultFilters: rules,
    });
    expect(parsed.defaultFilters).toEqual(rules);
  });

  it('`defaultFilters` refuses the AST tuple array the `z.unknown()` door used to receipt (#19514)', () => {
    const r = ComponentPropsMap['object-grid'].safeParse({
      objectName: 'showcase_task',
      defaultFilters: [['status', '=', 'open']],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => String(i.path[0]) === 'defaultFilters')).toBe(true);
  });

  // #11805 — the grid's legacy single-sort fallback, retired by maintainer
  // ruling 2026-08-25 (decision-inbox batch 4; the producer half of
  // objectui#5861 under the objectui#4869 「接受所有」 direction). Unlike
  // `defaultFilters` above — a read fallback that STAYS — `defaultSort` was
  // the second spelling of `sort` (read only when `sort` was absent, and
  // wrapped `[schema.defaultSort]` by the renderer's own header-arrow path),
  // so the one-intent-two-spellings rule retires it at the producer.
  describe('object-grid `defaultSort` is retired (#11805)', () => {
    it('rejects the retired `defaultSort` with the wrap-and-rename prescription', () => {
      expect(() => ComponentPropsMap['object-grid'].parse({
        objectName: 'showcase_task',
        defaultSort: { field: 'due_date', order: 'asc' },
      })).toThrow(/`defaultSort`.*removed.*`sort`/s);
    });

    it('does not materialize the retired `defaultSort` on a clean parse', () => {
      expect(ComponentPropsMap['object-grid'].parse({ objectName: 'showcase_task' }))
        .not.toHaveProperty('defaultSort');
    });

    // The live half of the intent: the array spelling every read path honours.
    it('keeps `sort`, the canonical spelling', () => {
      const parsed = ComponentPropsMap['object-grid'].parse({
        objectName: 'showcase_task',
        sort: [{ field: 'due_date', order: 'asc' }],
      });
      expect(parsed.sort).toEqual([{ field: 'due_date', order: 'asc' }]);
    });
  });

  it('every object-metric node of the showcase corpus parses GREEN (the clean-corpus control)', () => {
    // Copies of all three my-work.page.ts metrics + the command-center shape
    // (variant/format) — the exact nodes the lint must NOT start warning on.
    // The three filters are the `ViewFilterRule` arrays the showcase authors
    // since #15442 / #15449 (ui#6206-B); the records they replaced are refused
    // at `filter` now (pinned in the object-* filter describe above).
    const nodes = [
      { objectName: 'showcase_task', label: 'Open Tasks', icon: 'list-checks', colorVariant: 'blue', description: 'not done', aggregate: { field: 'id', function: 'count' }, filter: [{ field: 'status', operator: 'not_equals', value: 'done' }] },
      { objectName: 'showcase_task', label: 'In Review', icon: 'eye', colorVariant: 'warning', description: 'awaiting review', aggregate: { field: 'id', function: 'count' }, filter: [{ field: 'status', operator: 'equals', value: 'in_review' }] },
      { objectName: 'showcase_project', label: 'At-Risk Projects', icon: 'alert-triangle', colorVariant: 'danger', description: 'health red', aggregate: { field: 'id', function: 'count' }, filter: [{ field: 'health', operator: 'equals', value: 'red' }] },
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

  describe('`object-master-detail-form` `formType` speaks the measured vocabulary (#11873)', () => {
    // Spec half of objectui#5939: the renderer honours exactly `simple` and
    // `tabbed` for the parent half; the old bare `z.string()` let any value
    // parse clean, match no branch, and render a silently sectionless parent
    // form (the objectui#3840 probe read GREEN through a real crash this way).
    const schema = ComponentPropsMap['object-master-detail-form'];

    for (const value of ['simple', 'tabbed'] as const) {
      it(`'${value}' is accepted`, () => {
        const r = schema.safeParse({ objectName: 'po', details: [], formType: value });
        expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
      });
    }

    it("a never-vocabulary value ('wizzard' — the issue's own repro) refuses with the plain enum refusal", () => {
      const result = schema.safeParse({ objectName: 'po', details: [], formType: 'wizzard' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues[0]!;
        expect(issue.code).toBe('invalid_value');
        expect(issue.path).toEqual(['formType']);
        // Never a legal spelling anywhere, so it gets zod's own enum message,
        // not a retirement prescription.
        expect(issue.message).not.toContain('is not part of');
      }
    });

    describe('the four `object-form` spellings refuse with a per-value prescription', () => {
      // Each names the measured way it breaks the atomic parent+details
      // contract and prescribes the two honoured values — the `record:chatter`
      // `position` precedent (#8762): an enum-VALUE narrowing has no
      // `retiredKey()` tombstone, so the enum's own error map carries the
      // prescription, keyed on `issue.input`.
      for (const from of ['wizard', 'split', 'drawer', 'modal'] as const) {
        it(`'${from}' → refused, prescribing 'simple' or 'tabbed'`, () => {
          const result = schema.safeParse({ objectName: 'po', details: [], formType: from });
          expect(result.success).toBe(false);
          if (!result.success) {
            const issue = result.error.issues[0]!;
            expect(issue.code).toBe('invalid_value');
            expect(issue.path).toEqual(['formType']);
            expect(issue.message).toContain(`'${from}' is not part of`);
            expect(issue.message).toContain("Write 'simple'");
            expect(issue.message).toContain('object-form');
          }
        });
      }
    });
  });

  it("the designer's dead `groupField` spelling is answered with the `groupBy` the board reads", () => {
    // Producer: objectui previews/block-config.ts publishes `groupField` for
    // object-kanban; ObjectKanban.tsx reads only `groupBy` (#7973 class).
    const message = refuse(ComponentPropsMap['object-kanban'], { objectName: 'task', groupField: 'status' });
    expect(message).toContain('Did you mean `groupField` → `groupBy`?');
  });

  it('the plural `filters` is rejected by name on every block that reads `filter`', () => {
    for (const type of [
      'object-grid', 'object-metric', 'object-kanban', 'object-calendar',
      'object-map', 'object-gantt', 'object-tree',
    ] as const) {
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
      'object-map', 'object-gantt', 'object-tree',
    ] as const) {
      expect(ComponentPropsMap[type].safeParse({}).success, type).toBe(true);
    }
  });
});

// #16503 — the spec half of objectui#8172 (decision batch #68, 2026-09-07,
// option A: the contract declares the capability that already ships, is
// documented and is in use). Measured at the objectui pin this repo builds
// against (`.objectui-sha` = `2e818d0b5`; re-measured there 2026-10-04 —
// `plugin-kanban/src/types.ts`, `ObjectKanban.tsx` and
// `plugin-kanban/src/index.tsx` are byte-identical to `ab1879721`
// (`git diff --quiet`), so `types.ts` still declares no `limit` and `:722` /
// `:97` / `487-491` did not move; `plugin-kanban.mdx` gained a `grouping`
// Properties row below the `limit` row (objectui#11216) and still teaches
// `limit: 250`; `objectql.ts` changed only below the member (objectui#11216's
// `grouping` declaration on `ObjectKanbanSchema`), so `:4720` did not move.
// At `ab1879721`, re-measured there 2026-10-03 —
// `plugin-kanban/src/types.ts`, `ObjectKanban.tsx` and `plugin-kanban.mdx` are
// byte-identical to `89cad75d5` (`git diff --quiet`), so `types.ts` still
// declares no `limit`, `:722` / `:97` did not move and were re-read in place,
// and the mdx still teaches `limit: 250` with its Properties row; `index.tsx`
// changed only below the mapping (objectui#11438's 17.6.0 re-citation in the
// `ObjectKanbanRenderer` docblock and objectui#11522's `{ condition, style }`
// description on the `conditionalFormatting` input), so `487-491` did not
// move and still maps `limit: 'limit'`; `objectql.ts` MOVED the member `4661`
// -> `4720` byte-identical, still inside `ObjectKanbanSchema` (the 59 lines
// are declarations the range changed above it: the spec `{ condition, style }`
// rule types of objectui#11533 / objectui#11522, `ObjectGridSchema`'s
// `keyboardNavigation` of objectui#11068 and its 17.6.0 members of
// objectui#11438 among them). At `89cad75d5`, re-measured there 2026-10-02 —
// `plugin-kanban/src/types.ts` and `ObjectKanban.tsx` are byte-identical to
// `31971ff1e` (`git diff --quiet`), so `types.ts` still declares no `limit`
// and `:722` / `:97` did not move and were re-read in place; `index.tsx`
// changed only in the `ObjectKanbanRenderer` docblock and the `navigation`
// input's description (objectui#11293's record-navigator `page` mode), at
// `:626` and below, so the mapping did not move from `487-491`; `objectql.ts`
// MOVED the member `4588` -> `4661` byte-identical, still inside
// `ObjectKanbanSchema` (the 73 lines are declarations eight objectui commits
// of the range added above it); and `plugin-kanban.mdx` rewrote its
// `navigation` Properties row and gained a `swimlaneField` row, both below the
// `limit` row, which is byte-identical, and still teaches `limit: 250`. At
// `31971ff1e`, re-measured there 2026-10-01 —
// `plugin-kanban/src/types.ts` is byte-identical to `e420df310` and still
// declares no `limit`; `ObjectKanban.tsx` changed only in the comment above
// its `navigation` read (objectui#8652), below both anchors, so `:722` and
// `:97` did not move; `index.tsx` changed below the mapping (objectui#8652's
// `navigation` input), which did not move from `487-491`; `objectql.ts`
// MOVED the member `4430` -> `4588` byte-identical, still inside
// `ObjectKanbanSchema`; and `plugin-kanban.mdx` gained a `navigation`
// Properties row below the `limit` row and still teaches `limit: 250`. At
// `e420df310`, re-measured there 2026-09-30 —
// `plugin-kanban/src/types.ts` is byte-identical to `db11afd49` and still
// declares no `limit`; the other four files changed, so their anchors were
// re-READ. `ObjectKanban.tsx` changed at BOTH anchors: objectui#9853 renamed
// the default `DEFAULT_KANBAN_LIMIT` to `DEFAULT_KANBAN_FETCH_BATCH_SIZE`
// (still 100, now documented as the board's fetch batch, not a page size) and
// objectui#11234 moved the board into an internal `KanbanBoardCore`, so the
// query line now reads `$top: resolveRowLimit(schema.limit,
// DEFAULT_KANBAN_FETCH_BATCH_SIZE)` and moved `712` -> `722`, and the constant
// `:88` -> `:97` — same cap, same default, a renamed name. `index.tsx` lost
// the Quick Add plumbing above the mapping (objectui#8285, objectui#11234), so
// `OBJECT_KANBAN_DATA_SOURCE` MOVED `506-510` -> `487-491` byte-identical;
// `objectql.ts` MOVED the member `4302` -> `4430` byte-identical, still inside
// `ObjectKanbanSchema`; `plugin-kanban.mdx` still teaches `limit: 250` and its
// Properties row. At `db11afd49`, re-measured there 2026-09-29 —
// `plugin-kanban.mdx`, `plugin-kanban/src/types.ts` and
// `plugin-kanban/src/index.tsx` are byte-identical to `dd3f7e1be`;
// `ObjectKanban.tsx` changed in one comment line (`:1367`), so `:712` and `:88`
// did not move; `objectql.ts` gained declarations above the member, which is
// still inside `ObjectKanbanSchema`, and MOVED `4139` -> `4302` with its text
// byte-identical. At `dd3f7e1be`, re-measured there 2026-09-28 —
// `plugin-kanban.mdx` is byte-identical to `f8a9d0fb0`; the other four files
// changed, so their anchors were re-READ, and every one MOVED with its text
// byte-identical: `ObjectKanban.tsx` gained three imports and, above the
// fetch, objectui#10666's resolved `$filter` and objectui#10572's
// invalidation re-read (`687` -> `712`, `:85` -> `:88`; its comments also
// re-cite objectui#8307 as `5591f03bd`, objectui `1dae95a41`, one line for
// one); `index.tsx` changed
// above the mapping in exports and docblocks only (objectui#10582's
// `ColumnWidthConfig`, objectui#8522's `useColumnWidths`), net one line up
// (`507-511` -> `506-510`); `objectql.ts` grew above the member, which is
// still inside `ObjectKanbanSchema` (`3832` -> `4139`); and `types.ts` only
// dropped the same `ColumnWidthConfig` re-export and still declares no
// `limit`. At `f8a9d0fb0` (2026-09-24) `types.ts` and `plugin-kanban.mdx`
// were byte-identical to `62597c588`, `676` -> `687` and `:84` -> `:85` moved
// with their text byte-identical, the mapping gained `sort: true` beside the
// `limit` it cites (objectui#10068, `447-450` -> `507-511`), and the
// `limit?: number` member moved `3735` -> `3832`. All five files were
// byte-identical across the hop onto `62597c588`, and were last re-READ at
// `87af769e9` 2026-09-20, the hop that moved every anchor and renamed one
// face outright): `plugin-kanban/src/ObjectKanban.tsx:722`
// queries `$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`
// (100, `:97`; the bare `??` became `resolveRowLimit` in objectui#9925, which drops
// and reports a cap the contract refuses),
// `plugin-kanban/src/index.tsx:487-491` maps `limit: 'limit'` in
// `OBJECT_KANBAN_DATA_SOURCE`, ⚠️ `KanbanSchema` is RETIRED at this pin and
// `plugin-kanban/src/types.ts` declares the member no more — the published
// twin is `ObjectKanbanSchema`, declaring `limit?: number` at
// `packages/types/src/objectql.ts:4720` — and `content/docs/plugins/plugin-kanban.mdx`
// teaches `limit: 250` with a Properties row. The strict map refused the key by
// name — the same `unrecognized_keys` verdict as the `bogusProp` control — so an
// author following the published docs wrote a node the save gate rejected.
describe('ObjectKanbanPropsSchema limit — the row cap four objectui faces already implement (#16503)', () => {
  const kanban = ComponentPropsMap['object-kanban'];

  it("accepts the documented shape `{ objectName: 'x', limit: 250 }` and carries the value through", () => {
    const result = kanban.safeParse({ objectName: 'x', limit: 250 });
    expect(result.success).toBe(true);
    const parsed = (result.success ? result.data : undefined) as { limit?: number } | undefined;
    // Carried through to the parsed output, not stripped: what the board
    // lowers to `$top` is what the author wrote.
    expect(parsed?.limit).toBe(250);
  });

  it('still refuses an undeclared sibling on the same node — the accept above is not vacuous', () => {
    // The card's own control, and the half that proves the object stayed
    // strict: without it the green above would also be green on a map that
    // had stopped refusing anything.
    const result = kanban.safeParse({ objectName: 'x', bogusProp: 250 });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys') as
      | { keys?: string[] }
      | undefined;
    expect(issue?.keys).toEqual(['bogusProp']);
  });

  it('refuses a cap the query could not lower to `$top` — zero, negative, fractional, or a string — at the VALUE, not the key', () => {
    // `z.number().int().positive()`: the shape `element:record_picker` and
    // `record:related_list` declare for the same `$top` read, so the flat row
    // caps in this map are one contract rather than three dialects. The key is
    // recognised (no `unrecognized_keys`); the value is what fails.
    for (const limit of [0, -1, 1.5, '250']) {
      const result = kanban.safeParse({ objectName: 'x', limit });
      expect(result.success, JSON.stringify(limit)).toBe(false);
      const codes = (result.error?.issues ?? []).map((i) => i.code);
      expect(codes, JSON.stringify(limit)).not.toContain('unrecognized_keys');
      expect(result.error?.issues[0]?.path, JSON.stringify(limit)).toEqual(['limit']);
    }
  });

  it('keeps a `.describe()` that names the `$top` the board lowers it to and the binding that outranks it', () => {
    // The describe is the artifact an auditor reads instead of hunting across
    // repos, and the row the generated reference page prints; deleting it is
    // what re-opens the "is this key live?" question this record answers.
    const shape = (ObjectKanbanPropsSchema as unknown as {
      def: { shape: Record<string, { description?: string }> };
    }).def.shape;
    expect(shape.limit?.description).toContain('$top');
    expect(shape.limit?.description).toContain('row cap');
    expect(shape.limit?.description).toContain('dataSource.limit');
  });
});

// #17260 — the board's per-column quick-add switch, retired by the
// objectui#8285 director-seat ruling (comment 5583979207, decision batch #91,
// 2026-09-08; ruled option B: `quickAdd` leaves `object-kanban`; the ruling
// named the React-host `kanban-ui` block as where it stays, and objectui has
// since retired that block, objectui#8257). Unlike `limit` above — a key four
// objectui faces already implemented, so the spec was the half that was wrong
// — `quickAdd` was FORWARDED and never read: at the pin this repo builds
// against (`.objectui-sha` = `2e818d0b5`; re-measured there 2026-10-04 —
// every objectui file this record cites is byte-identical across the hop from
// `ab1879721` (`git diff --quiet`), so every anchor held unmoved. At
// `ab1879721`, re-measured there 2026-10-03 —
// `KanbanBoardCore.tsx` and `ObjectKanban.tsx` are byte-identical to
// `89cad75d5` (`git diff --quiet`), so `:78`, `:111-112` and the spread
// `:1639` did not move and were re-read in place, and the counts re-read the
// same, 2 / 2 / 11; `KanbanImpl.tsx` changed only in two comments above the
// gate (objectui#11522: card formatting is the spec `{ condition, style }`
// rule alone, +8/-5), so both gate lines MOVED by 3 byte-identical, `621` ->
// `624` and `634` -> `637`, and still read `quickAdd && onQuickAdd`. At
// `89cad75d5`, re-measured there 2026-10-02 —
// `KanbanImpl.tsx`, `KanbanBoardCore.tsx` and `ObjectKanban.tsx` are
// byte-identical to `31971ff1e` (`git diff --quiet`), so `:621`, `:634`,
// `:78`, `:111-112` and the spread `:1639` did not move and were re-read in
// place, and the counts re-read the same, 2 / 2 / 11. At `31971ff1e`,
// re-measured there 2026-10-01 —
// `KanbanImpl.tsx` and `KanbanBoardCore.tsx` are byte-identical to
// `e420df310`, so `:621`, `:634`, `:78` and `:111-112` did not move and were
// re-read in place; `ObjectKanban.tsx` changed only in the comment above its
// `navigation` read (objectui#8652), above the spread, which MOVED `1641` ->
// `1639` with its line byte-identical; and the counts re-read the same, 2 /
// 2 / 11. At `e420df310`, re-measured there 2026-09-30 —
// `KanbanImpl.tsx` is byte-identical to `db11afd49`, so `:621` and `:634` did
// not move and were re-read in place; `ObjectKanban.tsx` changed, carrying
// objectui's own half of this retirement: objectui#8285 stopped forwarding
// `quickAdd`, and objectui#11234 retired `onQuickAdd` and mounts an internal
// `KanbanBoardCore` where it mounted `KanbanRenderer`. So the spread MOVED
// `1614` -> `1641` with its line byte-identical, but it now feeds
// `KanbanBoardCore`, which reads neither key off `schema` and takes the pair
// only as explicit props (`KanbanBoardCore.tsx:78`, `:111-112`) that
// `ObjectKanban` never passes. ⚠️ The 0 / 0 / 11 counts did NOT re-read the
// same: `ObjectKanban.tsx` now spells `quickAdd` 2 times and `onQuickAdd` 2
// times, all four inside the two objectui#11234 comments that record the cut,
// so it still names neither half in code, against 11 for `onCardClick`. At
// `db11afd49`, re-measured there 2026-09-29 —
// `KanbanImpl.tsx` is byte-identical to `dd3f7e1be` and `ObjectKanban.tsx`
// changed in one comment line (`:1367`), so `:1614`, `:621` and `:634` did not
// move and were re-read in place, and the 0 / 0 / 11 counts re-read the same. At
// `dd3f7e1be`, re-measured there 2026-09-28 —
// `KanbanImpl.tsx` changed in three comment lines only (objectui `1dae95a41`
// re-citing objectui#8307 as `5591f03bd`, one line for one), so `:621` /
// `:634` did not move and re-read the same, and `ObjectKanban.tsx` changed
// above the spread (objectui#10666's resolved `$filter`, objectui#10572's
// invalidation re-read, objectui#10663's error clear), which MOVED `1578` ->
// `1614` with its text byte-identical, still the `schema` bag handed to
// `KanbanRenderer` — the same re-citation touched the comment on the line
// below it, not the spread; at `f8a9d0fb0` (2026-09-24) it
// had MOVED `1563` -> `1578` the same way (objectui#10068's `$orderby`); both
// files were byte-identical across the hop onto `62597c588`, and every anchor
// was re-READ at `87af769e9` 2026-09-20) `ObjectKanban.tsx:1639`
// spreads the
// authored bag into `KanbanBoardCore` (into `KanbanRenderer` until
// objectui#11234, which reads the pair off it no more) and `KanbanImpl` gates the affordance on
// `quickAdd && onQuickAdd` (`KanbanImpl.tsx:624`, `:637` — the file is spelled
// here because those two ranges are NOT in `ObjectKanban.tsx`), while
// `onQuickAdd` is a
// host-supplied FUNCTION no producer puts on an `object-kanban` node
// (`ObjectKanban.tsx` names neither half in code: 0 each re-counted at this pin
// outside the two comments that record objectui's cut, 2 each with them,
// against 11 for the sibling `onCardClick` in the same file).
describe('ObjectKanbanPropsSchema quickAdd is retired (#17260)', () => {
  const kanban = ComponentPropsMap['object-kanban'];

  it('rejects the retired `quickAdd` with the prescription, not a bare unknown-key verdict', () => {
    // The prescription IS the payload: the author who hits this got
    // `unknown-prop` from objectui's html tier before — the same message a
    // typo gets — so the refusal has to say what to do instead: delete the key.
    expect(() => kanban.parse({ objectName: 'showcase_task', quickAdd: true }))
      .toThrow(/`quickAdd`.*removed.*Delete the key/s);
  });

  it('prescribes no block objectui does not register — the remedy names no `kanban-ui`', () => {
    // `kanban-ui` is a node type objectui retired (objectui#8257) and this spec
    // never declared, so `PageComponentSchema` accepts it as an unregistered
    // custom string: an author steered there writes a node that saves clean and
    // resolves no renderer. The control itself has no metadata route, so the
    // one sentence every copy shares is "delete the key" — pinned on the
    // refusal, the D2 conversion's summary, the D3 entry's three texts and
    // step 18's rationale (the paragraph the upgrade guide prints).
    const refused = kanban.safeParse({ objectName: 'showcase_task', quickAdd: true });
    expect(refused.success).toBe(false);
    const issue = (refused.error?.issues ?? []).find((i) => i.path.join('.') === 'quickAdd');
    expect(issue?.code).toBe('invalid_type'); // the refusal itself is unchanged
    const tombstone = issue?.message ?? '';
    expect(tombstone).toContain('Delete the key; `object-kanban` offers no quick-add control.');

    const conversion = ALL_CONVERSIONS.find((c) => c.id === 'object-kanban-quick-add-removed');
    const step18 = MIGRATIONS_BY_MAJOR[18];
    const semantic = step18?.semantic.find((m) => m.id === 'object-kanban-quick-add-retired');
    expect(conversion).toBeDefined();
    expect(semantic).toBeDefined();
    expect(step18?.rationale).toContain('retires `object-kanban`\'s `quickAdd`');
    const remedyTexts = [
      tombstone,
      conversion?.summary ?? '',
      semantic?.replacement ?? '',
      semantic?.reason ?? '',
      semantic?.acceptanceCriteria ?? '',
      step18?.rationale ?? '',
    ];
    for (const text of remedyTexts) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('kanban-ui');
    }
    expect(semantic?.replacement).toContain('Delete the key; `object-kanban` offers no quick-add control.');
  });

  it('does not materialize the retired `quickAdd` on a clean parse', () => {
    expect(kanban.parse({ objectName: 'showcase_task' })).not.toHaveProperty('quickAdd');
  });

  it('refuses the key by the TOMBSTONE, not by the strict unknown-key arm — the two are different answers', () => {
    // The control that makes the assertion above a reading: an undeclared
    // sibling on the same node comes back as `unrecognized_keys`, while the
    // tombstoned key does not — it is declared, and rejected with its own
    // guidance. Without this pair a shape that had simply DROPPED the key
    // would pass the first test on the strict arm's generic message.
    const retired = kanban.safeParse({ objectName: 'showcase_task', quickAdd: true });
    expect(retired.success).toBe(false);
    expect((retired.error?.issues ?? []).map((i) => i.code)).not.toContain('unrecognized_keys');

    const undeclared = kanban.safeParse({ objectName: 'showcase_task', bogusProp: true });
    expect(undeclared.success).toBe(false);
    const issue = undeclared.error?.issues.find((i) => i.code === 'unrecognized_keys') as
      | { keys?: string[] }
      | undefined;
    expect(issue?.keys).toEqual(['bogusProp']);
  });

  it('keeps the neighbouring forwarded keys that ARE read on this path', () => {
    // The retirement is one key wide. `coverImageField` and
    // `conditionalFormatting` travel the same forward and ARE read
    // (`KanbanRenderer` / `bucketCardsIntoColumns` at the same pin), so a
    // sweep that took the whole forwarded list would be over-wide — this is
    // the pin that would catch it. The rule is the `{ condition, style }` the
    // member takes since #21464 (respelled from a `{ field, value }` entry with
    // no `operator`, which the board's evaluator skipped as no predicate).
    const parsed = kanban.safeParse({
      objectName: 'showcase_task',
      coverImageField: 'cover',
      conditionalFormatting: [{ condition: "record.priority == 'high'", style: { backgroundColor: '#fee2e2' } }],
    });
    expect(parsed.success).toBe(true);
  });
});

// #10053 — the accept-pins for the last two `icon` slots in this file whose
// describes stated only the VOCABULARY. "Icon name (Lucide)" is equally true of
// the `page:header` `icon` retired in #6946 *because nothing reads it*, so the
// prose could not separate a live key from a refused one — the same absence
// that sent #9397 on a full dispatch cycle re-deriving the accordion read point.
// #9881 and commit 60e0f900a recorded the accordion and tab items; these two close the set.
//
// The button record re-measured at the pin this repo builds against —
// `.objectui-sha` = `2e818d0b5`, re-derived there 2026-10-04: every objectui
// file this record cites is byte-identical to `ab1879721` (`git diff --quiet`),
// so every anchor below holds unmoved. At `ab1879721`, re-derived there
// 2026-10-03: `button.tsx`,
// `lazy-icon.tsx`, `resolve-icon.ts` and the generated
// `lucide-record-icon-names.ts` are byte-identical to `89cad75d5`
// (`git diff --quiet`), so every anchor below holds unmoved and was re-read in
// place. At `89cad75d5`, 2026-10-02: `button.tsx`,
// `lazy-icon.tsx`, `resolve-icon.ts` and the generated
// `lucide-record-icon-names.ts` are byte-identical to `31971ff1e`
// (`git diff --quiet`), so every anchor below holds unmoved and was re-read in
// place. At `31971ff1e`, 2026-10-01: `button.tsx`,
// `lazy-icon.tsx`, `resolve-icon.ts` and the generated
// `lucide-record-icon-names.ts` are byte-identical to `e420df310`
// (`git diff --quiet`), so every anchor below holds unmoved and was re-read in
// place. At `e420df310`, 2026-09-30: `button.tsx`,
// `lazy-icon.tsx`, `resolve-icon.ts` and the generated
// `lucide-record-icon-names.ts` are byte-identical to `db11afd49`, so every
// anchor below holds unmoved and was re-read in place. At `db11afd49`,
// 2026-09-29: `button.tsx`,
// `lazy-icon.tsx` and `resolve-icon.ts` are byte-identical to `dd3f7e1be`, so
// every anchor below holds unmoved. At `dd3f7e1be`, 2026-09-28: `button.tsx` and
// `lazy-icon.tsx` are byte-identical to `f8a9d0fb0` (`git diff --quiet`), so
// the `:43` / `:72` / `:74` anchors below hold by identity, and
// `resolve-icon.ts` changed (42 insertions, 17 deletions, objectui
// `fb336df01`: lucide-react 1.31.0 -> 1.43.0), so its anchors were re-READ:
// `toPascalCase` `:153-158` and the rename map `:143-145` did not move, and
// `describeIconLookup` `302-305` -> `327-330` and `resolveIcon` `322-328` ->
// `347-353` MOVED byte-identical. What changed in the file sits past the
// name lookup — the lazily loaded module's path data is now read from
// `__iconData.node` before `__iconNode`, the `IconNode` type is narrowed with
// `NonNullable`, and the `lucideClassNames` docblock was rewritten over
// unchanged code — so the SPELLINGS an author may write resolve exactly as
// before. The VOCABULARY moved with the bump, in the generated table
// `recordIconName` decodes (`lib/lucide-record-icon-names.ts`, 1781 -> 1818
// entries): 38 names in and one out, `Trash2`, so `trash-2` now resolves to
// `null` and draws nothing, like any unknown name. At `f8a9d0fb0`
// (2026-09-24) `resolve-icon.ts` and `lazy-icon.tsx` were byte-identical to `62597c588`
// and `87af769e9`, and `button.tsx` changed only inside its registration's
// input list (objectui#9910 added a `children` slot input, no `icon` one), so
// the button anchors did not move; all three files were byte-identical across
// the hop onto `62597c588`. The hop before that,
// onto `87af769e9` (re-derived 2026-09-20), moved both files in this chain —
// `resolve-icon.ts` +203/-7 and `button.tsx` +6/-11 against `53ded82bf` — so
// no anchor below was carried there and every one was re-READ (commit d1ba685ec). ⚠️ `resolveIcon` itself was rewritten: its tail no
// longer indexes `lucide-react`'s `icons` record, it asks `recordIconName`
// for the kebab-case name and hands the pair to `lazyIconComponent`, so the
// glyph arrives lazily. What an author may write did not change with it. The
// earlier hop
// onto `00d3f09c5` was the one that changed this record's SUBSTANCE and not
// merely its line numbers: `resolve-icon.ts` was restructured (110
// insertions), so `resolveIcon` no longer PascalCases and maps inline — it
// delegates to the `describeIconLookup` seam (now `:327-330`), and the tokeniser
// splits on hyphen, underscore AND whitespace (`/[-_\s]+/`), where this record
// used to say "splits on `-` only". That sentence was true when written and
// was false by then, which is exactly why a citation refresh re-READS instead
// of moving numbers (commit d1ba685ec).
// The one move that changed the button READ POINT and not merely its line
// numbers was the one onto `9602dc820`: objectui#5993 deleted `button.tsx`'s
// file-local `toPascalCase` + `iconNameMap` + `icons` index and routed the
// button through the SHARED `resolveIcon` that every `action:*` site already
// used, so the resolution anchor hops into `renderers/action/resolve-icon.ts`.
// What an author sees did not move with it: an unknown name still resolves to
// `null` and draws nothing, which is still the `LazyIcon` contrast the third
// test below pins. The moves before that were line-number drift only — #10137
// moved the pin while the #9881 / commit 60e0f900a records still cited `82a94170c`, commit d1ba685ec re-measured
// those four onto `9a3daf8d3`, and `button.tsx` was byte-identical at
// `9a3daf8d3` and `190fbd01d`.
describe('ElementButtonPropsSchema icon liveness (#10053)', () => {
  const button = ComponentPropsMap['element:button'];

  it('accepts an icon on a button — the value objectui resolves through the lucide `icons` map', () => {
    // objectui `packages/components/src/renderers/form/button.tsx:43` hands the
    // name to the shared `resolveIcon`
    // (`packages/components/src/renderers/action/resolve-icon.ts:347-353`),
    // which delegates to `describeIconLookup` (`:327-330`): that PascalCases
    // through `toPascalCase` (`:153-158`, splitting on hyphen, underscore or
    // whitespace) and applies the one-entry rename map (`:143-145`) before the
    // lookup, which at this pin runs through `recordIconName` +
    // `lazyIconComponent` rather than indexing `icons` from `lucide-react`
    // directly; `button.tsx:72` / `:74`
    // draw it either side of the label per `iconPosition`.
    const result = button.safeParse({ label: 'Save', icon: 'arrow-right' });
    expect(result.success).toBe(true);
    const parsed = (result.success ? result.data : undefined) as { icon?: string } | undefined;
    // Carried through to the parsed output, not stripped: what the renderer
    // reads is what an author writes.
    expect(parsed?.icon).toBe('arrow-right');
  });

  it('still refuses an undeclared sibling on the same node — the accept above is not vacuous', () => {
    // Without this the green above would also be green on a schema that had
    // stopped being strict, which is the failure mode an accept-pin excludes.
    const result = button.safeParse({ label: 'Save', iconName: 'arrow-right' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('unrecognized_keys');
  });

  it('keeps a `.describe()` that names the consumer AND the non-LazyIcon path', () => {
    // The second half is load-bearing, not decoration: this slot is the one
    // authorable icon on the surface that does NOT go through `LazyIcon`, so an
    // author who assumes `LazyIcon`'s tolerant fallback gets silence instead of
    // a glyph.
    const shape = (ElementButtonPropsSchema as unknown as {
      def: { shape: Record<string, { description?: string }> };
    }).def.shape;
    expect(shape.icon?.description).toContain('lucide-react');
    expect(shape.icon?.description).toContain('LazyIcon');
    // And that the path is the SHARED one. Naming `resolveIcon` is what stops
    // the describe drifting back to "its own normaliser": that sentence was
    // true when the button carried a private copy of the algorithm, survived
    // the copy's deletion unchanged, and shipped false to authors until this
    // record was re-measured. The prose has to name the function, not just the
    // library, for a reader to be able to check it.
    expect(shape.icon?.description).toContain('resolveIcon');
  });
});

describe('ObjectMetricPropsSchema icon liveness (#10053)', () => {
  const metric = ComponentPropsMap['object-metric'];

  it('accepts an icon on the metric tile — the value objectui resolves via getLazyIcon', () => {
    // objectui `plugin-dashboard/src/index.tsx:204` publishes the input
    // (this read `:161` until the `a472b0716` re-measure: wrong since written,
    // not shifted — that line is a sentence in the registry shell's docblock,
    // not the `object-metric` registration's `icon` input, and the file is
    // byte-identical at both pins, so only a re-READ could find it);
    // `ObjectMetricWidget.tsx:142` destructures it and forwards it at `:474` to
    // `MetricWidget`, which resolves it at `MetricWidget.tsx:312-321` and draws
    // it at `:373-382` in the `colorVariant`-tinted square.
    const result = metric.safeParse({ objectName: 'task', icon: 'circle-alert' });
    expect(result.success).toBe(true);
    const parsed = (result.success ? result.data : undefined) as { icon?: string } | undefined;
    expect(parsed?.icon).toBe('circle-alert');
  });

  it('still refuses an undeclared sibling on the same node — the accept above is not vacuous', () => {
    const result = metric.safeParse({ objectName: 'task', iconName: 'circle-alert' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('unrecognized_keys');
  });

  it('keeps a `.describe()` that names the consumer, so the read point survives a rename', () => {
    // The describe is the artifact an auditor reads instead of hunting across
    // repos; deleting it is what re-opens the false candidate, so it is pinned
    // rather than left to review.
    const shape = (ObjectMetricPropsSchema as unknown as {
      def: { shape: Record<string, { description?: string }> };
    }).def.shape;
    expect(shape.icon?.description).toContain('getLazyIcon');
    expect(shape.icon?.description).toContain('MetricWidget');
  });
});

// ---------------------------------------------------------------------------
// #18305 — `object-map` / `object-gantt` / `object-tree` get their
// `ComponentPropsMap` rows, executing the objectui#8348 ruling
// 「8348 以协议为准」 (batch #83, 2026-09-08) and batch #136 item 3 (Q1-C).
//
// The acceptance the card names, pinned: each row's KEY SET is the one the
// renderer's read points support at the pin this repo builds against
// (`.objectui-sha` = `2e818d0b5`; re-measured there 2026-10-04 —
// `ObjectMap.tsx`, `ObjectTree.tsx`, `ObjectGantt.tsx` and `record-source.ts`
// are byte-identical across the hop off `ab1879721` (`git diff --quiet`), so
// every anchor in them held unmoved. At `ab1879721`, re-measured there
// 2026-10-03 —
// `ObjectMap.tsx`, `ObjectTree.tsx` and `record-source.ts` are byte-identical
// across the hop off `89cad75d5` (`git diff --quiet`), so every anchor in them
// held unmoved; `ObjectGantt.tsx` +8/-0 gained one import line and, in the
// tooltip's `percent` row, a `percentCellScale(def)` argument scaling at the
// field definition's declared storage (objectui#11475) — a field-definition
// read, not a node key — so the set of `schema.*` keys each renderer reads is
// the same at both pins. At `89cad75d5`, 2026-10-02 — all four
// cited files changed on the hop off `31971ff1e`, so each was re-READ, and
// the set of `schema.*` keys each renderer reads is the same at both pins.
// `ObjectMap.tsx` +11/-4: the shadowed-flat-key warning reads `schema[key]`
// typed instead of through a cast (objectui#11355), and the declared `map`
// block's return path now takes the same `style` as every other path,
// `mapStyle` first, then `map.style` (objectui#11168 slice 3) — the two keys
// it reads are unchanged, and the `style` line MOVED `400` -> `407`
// byte-identical. `ObjectGantt.tsx` +47/-10: the same typed shadowed-key read
// (objectui#11355) and the tooltip's number and percent rows taking their
// width from the field definition's `scale` through `resolveFieldScale`
// (objectui#11254) — a field-definition read, not a node key.
// `ObjectTree.tsx` +8/-17: the `navigation` read lost its cast
// (`(schema as any).navigation` `:1063` -> `schema.navigation` `:1054`,
// objectui#11168 slice 3 declaring it), the same key; the rung-1 call
// `resolveRecordSourceConfig(schema, 'view-data')` `:634` and the shorthand
// read `(rest as any).data` `:865` did not move. ⚠️ `record-source.ts`
// +4/-5 no longer lists FOUR tree tags as `view-data`: objectui `990a2d616`
// (objectui#10859 batch 8) retired the bare `tree` / `view:tree` node types,
// so the arm table keeps `object-tree` and `plugin-tree:object-tree` only,
// still `view-data`. The in-test notes below stay dated to the pins they
// name. At `31971ff1e`, 2026-10-01 — `ObjectMap.tsx`, `ObjectGantt.tsx`,
// `ObjectTree.tsx` and `record-source.ts` were byte-identical across the hop
// off `e420df310` (`git diff --quiet`), so every anchor held unmoved and the
// set of `schema.*` keys each renderer reads was the one recorded at
// `e420df310`. At `e420df310`, 2026-09-30 — all
// three renderers changed on the hop off `db11afd49`, `ObjectMap.tsx` in one docblock
// only, `ObjectGantt.tsx` +85/-26 (objectui#11141's inclusive date-only end,
// objectui#8348, objectui#11070) and `ObjectTree.tsx` +29/-26, and the set of
// `schema.*` keys each reads is the same at both pins. ⚠️ One read changed
// CONTENT, in the direction of this row: objectui#8348 (objectui `846cec0ef`)
// moved the tree's rung-1 call from `resolveRecordSourceConfig(schema,
// 'undeclared')` to `'view-data'` (`ObjectTree.tsx:632` -> `:634`), the arm its
// siblings pass, and `record-source.ts` now lists the four tree tags as
// `view-data`; and the shorthand read `(rest as any).data ?? schema.data`
// became `(rest as any).data` (`:862` -> `:865`), so the renderer no longer
// honours an authored bare array at all. The in-test notes below that say the
// tree's arm is `'undeclared'` and WIDER than this row are the `87af769e9`
// reading they are dated to; at this pin the renderer and the row agree. At
// `db11afd49`, 2026-09-29 — `ObjectMap.tsx`
// is byte-identical to `dd3f7e1be`, `ObjectTree.tsx` changed in one comment line
// and `ObjectGantt.tsx` in its date-only DST handling and citations, and the set
// of `schema.*` keys each reads is the same at both pins. At `dd3f7e1be`,
// 2026-09-28: all three
// renderers changed on this hop, `ObjectMap.tsx` +193/-72, `ObjectGantt.tsx`
// +285/-56 and `ObjectTree.tsx` +136/-30, so each was re-READ: no declared key
// set moved. The set of `schema.*` keys the code reads is the same at both
// pins in all three files; what changed is how reads are MADE — each now
// resolves its own `filter` through `useResolvedFilter` before the fetch
// (objectui#10666) and re-reads on the data-invalidation bus — while the
// tree's fetch still carries no `$orderby`, so `sort` stays off its row, and
// `record-source.ts` lost only the retired bare `map` / `view:map` arm entries
// (objectui#10393). At `f8a9d0fb0` (2026-09-24) the map's `ObjectMap.tsx` was
// byte-identical to `62597c588`, and the gantt and tree renderers changed and
// were re-READ with no declared key set moving (the gantt's new
// host-generated `search` / `searchableFields` reads, objectui#10250, stay
// undeclared and are recorded in its header; the tree's `filter.tree` stash
// read was deleted, objectui#9549). At `62597c588`
// the gantt and tree renderers were byte-identical to `87af769e9`, and the
// map's `ObjectMap.tsx` had changed only in a docblock and a dev-warning
// string (objectui `2252653d0`), so its anchors MOVED with their cited text
// byte-identical and no key set moved. They were re-READ at `87af769e9`
// 2026-09-22 — all three renderers moved hard on the hop from `53ded82bf`,
// so NO anchor in this block was carried and every one was re-derived. Four
// changed CONTENT rather than position and say so where they are cited: the
// map's array-shorthand head, the tree's record-source ARM, the cast on the
// tree's `schema.data` read, and the tree's `titleField` rung), and
// `Object.keys(ComponentPropsMap)` lists the three. The key sets are asserted
// WHOLE rather than by spot-check — a row derived from read points is a claim
// about a complete set, and only an equality can hold a later addition to
// having been measured too.
// ---------------------------------------------------------------------------
describe('the three #18305 object blocks — key sets derived from the renderers read points', () => {
  type Shape = { shape: Record<string, unknown>; safeParse(v: unknown): any };
  const door = (type: string) => ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as Shape;
  const keysOf = (type: string) => Object.keys(door(type).shape).sort();
  const refuse = (type: string, value: unknown): string => {
    const r = door(type).safeParse(value);
    expect(r.success).toBe(false);
    return r.error.issues.map((i: { message: string }) => i.message).join('\n');
  };

  it('object-map declares exactly its measured read set', () => {
    // ObjectMap.tsx @ 87af769e9: data (:183 — `getDataConfig` is now that one
    // `resolveRecordSourceConfig(schema, 'view-data')` statement; the
    // array-shorthand head that used to open it is GONE, and the docblock at
    // :168-176 records that an authored array now reaches this renderer only
    // through the React props channel), staticData / objectName (the shared
    // ladder's rungs 2 and 3, record-source.ts :296 and :303), filter (:814
    // and :895 — the inline and the object fetch), sort (:815 and :896), map
    // (:382), mapStyle (:377), navigation (:1042), enableClustering (:1058).
    expect(keysOf('object-map')).toEqual([
      'data', 'enableClustering', 'filter', 'map', 'mapStyle', 'navigation', 'objectName', 'sort', 'staticData',
    ]);
  });

  it('object-gantt declares exactly its measured read set', () => {
    // ObjectGantt.tsx @ 87af769e9: the ladder (:613), filter (:844), sort
    // (:845), gantt (:501-503), navigation (:1615), label (:2181 — the
    // `resolveI18nLabel` call in the export-file-name chain; the retired
    // reading :1849 was the COMMENT above that chain even at its own pin, and
    // at this one is a BLANK line two above an unrelated callback's comment),
    // skipWeekends (:1333), holidays (:1334), persistLayout (:1485),
    // viewName (:1487), markers (:2136),
    // criticalPath (:2139), showBaselines (:2142), readOnly (:1985 and
    // :2143), mobileReadOnly (:2144).
    expect(keysOf('object-gantt')).toEqual([
      'criticalPath', 'data', 'filter', 'gantt', 'holidays', 'label', 'markers', 'mobileReadOnly',
      'navigation', 'objectName', 'persistLayout', 'readOnly', 'showBaselines', 'skipWeekends',
      'sort', 'staticData', 'viewName',
    ]);
  });

  it('object-tree declares exactly its measured read set — and `data` IS in it', () => {
    // The card's open question, answered by measurement rather than by family
    // symmetry: ObjectTree.tsx @ 87af769e9 reaches `schema.data` through
    // `resolveRecordSourceConfig(schema, 'undeclared')` at :582 — rung 1 of
    // the shared ladder, which returns the authored value VERBATIM. That
    // ONE site is the whole support for the object arm, and it is sufficient.
    // ⚠️ The ARM is `'undeclared'` here, not the `'view-data'` its siblings
    // pass, so rung 1 honours any truthy value at the renderer — WIDER than
    // this row, which is the harmless direction: the door below refuses the
    // bare array the renderer would have taken.
    // ⛔ :775 is NOT a second one: `(rest as any).data ?? schema.data` (the
    // cast on `schema` went away with objectui#8655) is gated by
    // `Array.isArray(passed)` on the next line, so it honours only
    // the bare-ARRAY shorthand this row REFUSES (pinned below). objectui#9234
    // left the rung-1 read marked `undeclared` because neither published face
    // carried the key; the protocol row follows the READ POINTS, which is what
    // 「以协议为准」 resolving for this block means.
    expect(keysOf('object-tree')).toEqual([
      'data', 'filter', 'navigation', 'objectName', 'staticData', 'tree',
    ]);
    // …and NOT `sort`: this renderer's fetch carries $filter, $top and $expand
    // and no $orderby, so a `sort` door here would publish a key with no read
    // site. The negative is the other half of "derived from read points".
    expect(keysOf('object-tree')).not.toContain('sort');
  });

  it('`data` takes the ViewData object arm on all three — the arm the shared ladder returns verbatim', () => {
    for (const type of ['object-map', 'object-gantt', 'object-tree'] as const) {
      const bound = door(type).safeParse({ data: { provider: 'object', object: 'showcase_task' } });
      expect([type, bound.success]).toEqual([type, true]);
      const inline = door(type).safeParse({ data: { provider: 'value', items: [{ id: 1 }] } });
      expect([type, inline.success]).toEqual([type, true]);
      // The bare-array shorthand two of these renderers normalize is off
      // contract — `ViewData` is a discriminated union over OBJECT variants —
      // so it is refused here exactly as it is on `object-grid`.
      const bare = door(type).safeParse({ data: [{ id: 1 }] });
      expect([type, bare.success]).toEqual([type, false]);
      // Inline rows have their own declared door, and it is an array.
      const staticRows = door(type).safeParse({ staticData: [{ id: 1 }] });
      expect([type, staticRows.success]).toEqual([type, true]);
    }
  });

  it('the flat config spellings are refused with the wrong-layer prescription, not a rename', () => {
    // The ObjectView / ListView flatten product: read by all three renderers,
    // ruled an internal transport form rather than a second authoring surface
    // (objectui#5018 for the map, inherited by objectui#6469 for the gantt;
    // one composition key per concept for the tree).
    const mapMsg = refuse('object-map', { objectName: 'task', latitudeField: 'lat' });
    expect(mapMsg).toContain('`map`');
    expect(mapMsg).toContain('latitudeField');
    const ganttMsg = refuse('object-gantt', { objectName: 'task', startDateField: 'starts_at' });
    expect(ganttMsg).toContain('`gantt`');
    expect(ganttMsg).toContain('startDateField');
    const treeMsg = refuse('object-tree', { objectName: 'task', parentField: 'parent_id' });
    expect(treeMsg).toContain('`tree`');
    expect(treeMsg).toContain('parentField');
  });

  it('each flat-key set is HELD EQUAL to the config block it points at — it cannot drift silently', () => {
    // The lists are spelled out at the declaration (forcing a `lazySchema`
    // proxy at module load would build `view.zod` mid-initialisation), so the
    // derivation is asserted here instead. A key added to a config block on
    // either face lands in this assertion, not in a silent gap between the
    // block and the prescription that sends authors to it.
    const setFor = (type: string, name: string): readonly string[] => {
      // Force the row first: declarations register when their `lazySchema` body
      // runs, so a registry read before that returns a set this row is not in.
      void door(type).shape;
      const decl = strictObjectDeclarations().find((d) => d.options.surface === `this \`${type}\``);
      expect(decl, type).toBeDefined();
      const set = (decl!.options.guidanceSets ?? []).find((g) => g.name === name);
      expect(set, name).toBeDefined();
      expect(Array.isArray(set!.keys), name).toBe(true);
      return [...(set!.keys as readonly string[])].sort();
    };
    // map: `ListMapConfigSchema`'s own shape MINUS `style`, the one member that
    // has no flat spelling — flattened to the top level it collides with
    // `BaseSchema.style`, the node's inline CSS record, so objectui's own
    // `FLAT_MAP_CONFIG_KEYS` subtracts it and this set follows. Derived by
    // SUBTRACTION rather than hand-listed, so a newly declared config key still
    // lands in this assertion.
    expect(setFor('object-map', 'OBJECT_MAP_FLAT_CONFIG_KEYS'))
      .toEqual(Object.keys(ListMapConfigSchema.shape).filter((k) => k !== 'style').sort());
    // gantt: `GanttConfigSchema`'s shape PLUS the legacy singular alias the
    // renderer's flat branch still reads beside `dependenciesField`.
    expect(setFor('object-gantt', 'OBJECT_GANTT_FLAT_CONFIG_KEYS'))
      .toEqual([...Object.keys(GanttConfigSchema.shape), 'dependencyField'].sort());
    // tree: `TreeConfigSchema`'s shape PLUS `titleField`. ⚠️ Re-READ at
    // 87af769e9 and the read point is GONE, not moved: objectui#8841 deleted
    // the `?? schema.titleField` rung from `getTreeConfig` (now :235-248),
    // and the docblock above it (:197-218) records why — it read the
    // FLATTENED NODE, never the block, and the key is declared on neither
    // face. The key stays in THIS set, and the prescription that names it
    // stays TRUE, on the OTHER half of the sentence: `ListView`'s flatten
    // still resolves `treeCfg.titleField` into `labelField` before emitting
    // (`ListView.tsx:3270` at this pin), so an authored `titleField` is still
    // only ever the block's `labelField`. What died is the renderer's own
    // fallback, not the flatten's.
    expect(setFor('object-tree', 'OBJECT_TREE_FLAT_CONFIG_KEYS'))
      .toEqual([...Object.keys(TreeConfigSchema.shape), 'titleField'].sort());
  });

  it('the config blocks are the spec own schemas where the renderer names one, `z.unknown()` where it does not', () => {
    // gantt: `ObjectGantt.tsx:503` validates the authored block against
    // `GanttConfigSchema` imported from `@objectstack/spec/ui`, so the read
    // point names the schema and the door takes it — a misspelling inside the
    // block is refused here exactly as the renderer's own safeParse warns.
    expect(door('object-gantt').safeParse({
      gantt: { startDateField: 's', endDateField: 'e', titleField: 't' },
    }).success).toBe(true);
    expect(door('object-gantt').safeParse({
      gantt: { startDateField: 's', endDateField: 'e', titleField: 't', colourField: 'status' },
    }).success).toBe(false);
    // tree: `TreeConfigSchema`, closed at #15469 on this very measurement.
    expect(door('object-tree').safeParse({ tree: { parentField: 'parent_id' } }).success).toBe(true);
    expect(door('object-tree').safeParse({ tree: { labelFeild: 'name' } }).success).toBe(false);
    // map: `ListMapConfigSchema` — the ratchet the previous posture deferred,
    // taken now that `style` is declared on that block (the key `getMapConfig`
    // reads at `ObjectMap.tsx:377`, `schema.mapStyle || schema.map?.style`). The
    // two assertions that used to record the divergence are INVERTED here: the
    // list-view face accepts the style URL, and the door accepts it through the
    // spec's own schema rather than through an open value.
    expect(ListMapConfigSchema.safeParse({ style: 'https://tiles.example/style.json' }).success).toBe(true);
    expect(door('object-map').safeParse({ map: { latitudeField: 'lat', style: 'https://tiles.example/style.json' } }).success).toBe(true);
    // …and the acceptance is the SCHEMA's, not an open value's: a misspelling
    // inside the block is refused AT `map`, by name. Without this half the pin
    // above passes just as well against the `z.unknown()` it replaced.
    const mapTypo = door('object-map').safeParse({ map: { latitudeField: 'lat', styl: 'https://tiles.example/style.json' } });
    expect(mapTypo.success).toBe(false);
    const mapUnknown = mapTypo.error.issues.find(
      (i: { code: string; path: PropertyKey[] }) => i.code === 'unrecognized_keys'
        && JSON.stringify(i.path) === JSON.stringify(['map']),
    );
    expect(mapUnknown, 'the refusal must land at `map`, not at the node root').toBeDefined();
    expect(mapUnknown.keys).toContain('styl');
  });

  it('every one of the three still refuses an undeclared key BY NAME — the control', () => {
    for (const type of ['object-map', 'object-gantt', 'object-tree'] as const) {
      const r = door(type).safeParse({ objectName: 'task', bogusProp: 1 });
      expect([type, r.success]).toEqual([type, false]);
      const unrecognized = r.error.issues.filter((i: { code: string }) => i.code === 'unrecognized_keys');
      expect(unrecognized.flatMap((i: { keys?: string[] }) => i.keys ?? [])).toContain('bogusProp');
    }
  });

  it('each row carries the objectBlockHistory line — the silence it ends is named in the refusal', () => {
    for (const type of ['object-map', 'object-gantt', 'object-tree'] as const) {
      const message = refuse(type, { bogusProp: 1 });
      expect(message, type).toContain('had no entry there at all');
      expect(message, type).toContain(type);
    }
  });

  it('object-chart is STILL deliberately absent — the three rows did not sweep it in', () => {
    expect((ComponentPropsMap as Record<string, unknown>)['object-chart']).toBeUndefined();
  });
});

// #19228 — the react tier's own precedence sentence was narrower than the
// guard it names. These pins hold the structural facts the repair rests on,
// measured first-hand at the objectui pin `87af769e9` on 2026-09-21T06:30-06:40Z.
describe('row caps on the object-bound blocks — what #19228 recorded', () => {
  const timeline = ComponentPropsMap['object-timeline'];
  const kanban = ComponentPropsMap['object-kanban'];

  it('leaves the ELEMENT-face `limit` undefaulted — the fact that keeps the gate arm alive', () => {
    // `ElementDataSourceGate` lowers a bound view's cap into this key only
    // when it does not already carry a USABLE one
    // (`ElementDataSourceGate.tsx:316-331`, `!fromView || !isUsableRowLimit`).
    // An applied default here would make every parsed node carry a usable cap
    // and kill that arm outright — the failure #19228 feared, on the schema it
    // would actually happen to. ⛔ Do not "fix" a red here by deleting the pin.
    for (const [label, schema] of [['object-kanban', kanban], ['object-timeline', timeline]] as const) {
      const parsed = schema.parse({ objectName: 'task' }) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(parsed, 'limit'), label).toBe(false);
    }

    // LIT CONTROL, same instrument (a Zod applied default, observed through
    // `parse`): a VIEW-face block DOES materialize its `scale`, so the zeros
    // above are a reading rather than a parse that never ran.
    const viewSide = TimelineConfigSchema.parse({ startDateField: 'start_date', titleField: 'name' }) as { scale?: string };
    expect(viewSide.scale).toBe('week');
  });

  it('admits only caps the binding gate calls usable — the SUBSET that makes 「unset」 the whole rule', () => {
    // ⛔ Not a prose pin. The published sentence says a bound view's
    // `pagination.pageSize` fills this key only when it is UNSET, and this is
    // the structural fact that makes that true rather than narrow:
    // `ElementDataSourceGate`'s guard is `!isUsableRowLimit(authored)` with
    // `isUsableRowLimit = typeof v === 'number' && Number.isInteger(v) && v > 0`.
    // This key's accept set is a SUBSET of that predicate — ⛔ NOT the same
    // set; `2 ** 53 + 2` separates them, and the case below pins it. Subset is
    // the direction the sentence needs: it makes 「set but not usable」 empty
    // across the whole accept set, so the guard has exactly two outcomes.
    //
    // ⚠️ What this pin can and cannot catch, because the two sides are not
    // symmetric here:
    //  · SPEC side — reds. A `.nullable()`, a `0` sentinel, dropping `.int()`
    //    or adding a `.default()` each fail a specific expect below.
    //  · GATE side — ⛔ CANNOT red. `usableToTheGate` is a TRANSCRIPTION of
    //    `isUsableRowLimit` as it read at objectui pin `87af769e9`, not an
    //    import — nothing here resolves into objectui. A rewrite of that
    //    predicate at objectui HEAD leaves this test green. It is re-read on
    //    a PIN BUMP, by hand, and that is the only thing that refreshes it.
    const usableToTheGate = (v: unknown): boolean =>
      typeof v === 'number' && Number.isInteger(v) && v > 0;

    // ACCEPTED by the schema ⇒ usable to the gate ⇒ the view's cap does NOT land.
    for (const cap of [1, 25, 100, 5000]) {
      const r = kanban.safeParse({ objectName: 'x', limit: cap });
      expect(r.success, `accept ${cap}`).toBe(true);
      expect(usableToTheGate((r.success ? r.data : {} as never).limit), `usable ${cap}`).toBe(true);
    }

    // REFUSED by the schema ⇒ never reaches the gate from a valid document,
    // which is why the displaced-and-reported arm is not in the describe.
    for (const cap of [0, -1, 2.5, '100', null]) {
      expect(kanban.safeParse({ objectName: 'x', limit: cap }).success, `refuse ${JSON.stringify(cap)}`).toBe(false);
      expect(usableToTheGate(cap), `gate also rejects ${JSON.stringify(cap)}`).toBe(false);
    }

    // ⛔ The sets are NOT equal, and this is the witness. `2 ** 53 + 2` is
    // refused here (zod 4's `.int()` enforces SAFE integers, `too_big`) while
    // `Number.isInteger` calls it usable. Subset, not coincidence — if this
    // case ever flips, the docblock sentence built on the subset direction
    // has to be re-derived rather than reworded.
    const beyondSafe = 2 ** 53 + 2;
    expect(kanban.safeParse({ objectName: 'x', limit: beyondSafe }).success).toBe(false);
    expect(usableToTheGate(beyondSafe)).toBe(true);

    // UNSET — accepted, and the one state the gate treats as unauthored.
    const unset = kanban.safeParse({ objectName: 'x' });
    expect(unset.success).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(unset.success ? unset.data : {}, 'limit')).toBe(false);
    expect(usableToTheGate(undefined)).toBe(false);
  });
});
