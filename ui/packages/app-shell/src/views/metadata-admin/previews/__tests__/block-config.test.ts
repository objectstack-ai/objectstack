import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_LOCATIONS,
  PageAccordionProps,
  PageComponentType,
  PageHeaderProps,
  RecordDetailsProps,
} from '@objectstack/spec/ui';
import {
  arrayElementSchema,
  enumOptions,
  isShapeKeyTombstoned,
  listedShapeKeys,
  resolvePropsShape,
  shapeMemberTypeName,
} from '@object-ui/test-support';
// The NODE face of the block vocabulary — `object-kanban`'s own schema, where
// objectui#7322 declared `groupBy` and tombstoned `groupField` (that card also
// made `groupBy` REQUIRED; objectui#8990 made it OPTIONAL again, to match the
// protocol — it is still DECLARED and still typed). The
// spec imports above cover the PAGE face; the two are different contracts and
// this file now reads both.
import { ObjectKanbanSchema } from '@object-ui/types/zod';
import {
  BLOCK_CONFIG,
  RETIRED_BLOCK_PROP_KEYS,
  blockHasConfig,
  stripRetiredBlockProps,
  type BlockPropField,
  type PlaceholderSpec,
} from '../block-config';
import { BLOCK_TYPE_META, PALETTE_EXCLUSIONS, TYPES_BY_CATEGORY } from '../block-types';
import { t } from '../../i18n';

describe('block-config', () => {
  it('exposes a configurable panel for every content block with authorable props', () => {
    for (const type of [
      'element:text', 'element:image', 'element:number', 'element:button',
      'page:header', 'page:card', 'page:tabs', 'page:accordion',
      'record:related_list', 'record:highlights', 'record:details', 'record:alert',
      'record:path', 'record:quick_actions',
      'element:definition-list', 'element:repeater',
    ]) {
      expect(blockHasConfig(type), type).toBe(true);
      expect(BLOCK_CONFIG[type].length).toBeGreaterThan(0);
    }
  });

  it('returns false for pure-container blocks without scalar props (and undefined)', () => {
    expect(blockHasConfig('page:section')).toBe(false);
    expect(blockHasConfig('element:divider')).toBe(false);
    expect(blockHasConfig(undefined)).toBe(false);
  });

  it('also exposes the array-valued blocks', () => {
    for (const type of ['page:tabs', 'record:details', 'record:highlights']) {
      expect(blockHasConfig(type)).toBe(true);
    }
  });

  it('every field (incl. nested array items) has a name, label and valid kind', () => {
    const kinds = new Set([
      'text', 'number', 'boolean', 'select', 'string-list', 'array', 'json',
      'object-picker', 'field-picker', 'field-list', 'color',
    ]);
    const check = (f: any, path: string) => {
      expect(f.name, `${path}.name`).toBeTruthy();
      expect(f.label, `${path}.label`).toBeTruthy();
      expect(kinds.has(f.kind), `${path}.${f.name} kind=${f.kind}`).toBe(true);
      if (f.kind === 'select') expect(Array.isArray(f.options) && f.options.length > 0).toBe(true);
      if (f.kind === 'array') {
        expect(Array.isArray(f.itemFields) && f.itemFields.length > 0).toBe(true);
        for (const itf of f.itemFields) check(itf, `${path}.${f.name}[]`);
      }
    };
    for (const [type, fields] of Object.entries(BLOCK_CONFIG)) {
      for (const f of fields) check(f, type);
    }
  });
});

/**
 * `record:details.sections` ↔ the spec's own section-entry shape (#3819).
 *
 * The designer offered `label` / `columns` / `fields` and silently omitted
 * `name` — which the spec describes as the section's i18n ANCHOR ("resolves
 * `objects.<object>._sections.<name>.label`; a nameless section renders its
 * authored label in every locale") and which the renderer really reads
 * (`record-details.tsx`: `s.name && objectName ? sectionLabel(objectName,
 * s.name, …)`). Every section Studio produced was therefore untranslatable by
 * construction, and carried an upstream `translation-section-name-missing`
 * diagnostic no designer control could clear.
 *
 * The coverage half is DERIVED from `RecordDetailsProps`, not hand-listed, for
 * the reason the palette suite below states: a hand-written
 * `expect(name).toBeDefined()` pins today's gap closed but stays green the next
 * time the spec grows a section key the inspector never learns to author.
 */
describe('record:details sections ↔ spec section-entry coverage (#3819)', () => {
  /**
   * The spec's authorable keys for one `sections[]` entry, read off the Zod shape.
   *
   * `sections` is `ZodOptional< ZodArray< ZodObject > >`, so this needs both a
   * wrapper walk and an array-element read. Both are `@object-ui/test-support`'s
   * (objectui#5872 class (2)); the six-iteration `_def.innerType` / `_def.element`
   * loop that used to stand here was one of the three disagreeing copies that
   * card censused. `arrayElementSchema` answers `undefined` for a non-array,
   * which `listedShapeKeys` turns into `[]` — the case the non-vacuity
   * assertion below exists to catch.
   */
  const specSectionKeys: string[] = listedShapeKeys(
    arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.sections),
  );

  /** The inspector's item editors for one section. */
  const sectionsField = BLOCK_CONFIG['record:details'].find((f) => f.name === 'sections') as
    | {
        kind: 'array';
        itemFields: Array<{ name: string; label: string; kind: string; placeholder?: PlaceholderSpec }>;
      }
    | undefined;

  it('reads a non-empty section-entry shape from the spec', () => {
    // Guards the derivation itself: a spec refactor that moves the shape must
    // fail here loudly rather than turn the coverage assertion into a no-op
    // that passes over an empty list.
    expect(specSectionKeys, 'could not read RecordDetailsProps.sections[] shape').not.toEqual([]);
    expect(specSectionKeys).toContain('name');
  });

  /**
   * Section keys the spec declares that this designer does NOT yet expose an
   * editor for — every one of them arriving with `@objectstack/spec` 17.3.0,
   * which grew the section entry from four member keys to twelve (measured:
   * gained set exactly these eight, lost set empty).
   *
   * ⛔ This is a DEFERRAL, not a dismissal, and it is deliberately a hand-kept
   * list rather than a loosened assertion. Eight new inspector controls is a
   * feature, and the bump that revealed the gap is not the place to build it
   * (maintainer ruling on objectui#7122, 2026-09-05, ruled item 5: "推迟,单开
   * feature 卡 —— 8 个新控件是功能,不是 bump 的尾巴"). Six of the eight are
   * already HONOURED by the renderer through `DetailSection` (`icon`,
   * `description`, `collapsible`, `defaultCollapsed`, `showBorder`,
   * `headerColor`), so the gap is genuinely the control and not the capability;
   * `group` is unimplemented here, and `hideEmpty` is retired on purpose
   * (objectui#7129). All eight are documented on the `sections` input's
   * description, which the sibling `recordDetailsInputs.spec-parity.test.ts`
   * enforces — so they are discoverable in source mode today.
   *
   * The assertion below keeps its full force for everything else: a NINTH key
   * landing upstream still fails here, and so does any entry of this list that
   * stops being a spec key (a stale deferral) or that quietly gains a control
   * without being removed from the list.
   */
  const DEFERRED_SECTION_CONTROLS = [
    'group',
    'hideEmpty',
    'collapsible',
    'showBorder',
    'defaultCollapsed',
    'icon',
    'description',
    'headerColor',
    // `@objectstack/spec` 18 declares a ninth, `count` (objectui#12030), declared
    // ahead of its renderer upstream (EXPERIMENTAL). The renderer half is held on
    // objectui#12192; its control waits with it, as the eight above do.
    'count',
  ];

  it('exposes an editor for every key the spec declares on a section, bar the deferred nine', () => {
    expect(sectionsField?.kind).toBe('array');
    const authored = (sectionsField?.itemFields ?? []).map((f) => f.name);
    const missing = specSectionKeys.filter(
      (k) => !authored.includes(k) && !DEFERRED_SECTION_CONTROLS.includes(k),
    );
    // If this fails: the spec declares a section key the block designer gives
    // authors no way to write, and that is not one of the eight consciously
    // deferred above. Add the itemField — a key that only source-mode editing
    // can reach is a key Studio-built pages structurally cannot carry.
    expect(missing, 'section keys with no designer control').toEqual([]);
  });

  it('the deferral list is neither stale nor a cover for a control that now exists', () => {
    // The two ways the exemption above could rot, both closed here rather than
    // left to a reader's diligence. Without this the list would be a permanent
    // hole: a key removed upstream, or one that later gained a control, would
    // sit in it forever and quietly shrink what the coverage assertion checks.
    const authored = (sectionsField?.itemFields ?? []).map((f) => f.name);
    expect(
      DEFERRED_SECTION_CONTROLS.filter((k) => !specSectionKeys.includes(k)),
      'deferred key the spec no longer declares — drop it from the list',
    ).toEqual([]);
    expect(
      DEFERRED_SECTION_CONTROLS.filter((k) => authored.includes(k)),
      'deferred key that now HAS a designer control — drop it from the list',
    ).toEqual([]);
  });

  it('the `name` editor is a text box carrying the snake_case convention', () => {
    const nameField = sectionsField?.itemFields.find((f) => f.name === 'name');
    expect(nameField, 'record:details sections must expose the i18n anchor `name`').toBeDefined();
    expect(nameField!.kind).toBe('text');
    // `BlockPropField` has no description/pattern affordance, so the
    // placeholder is the only place the snake_case convention can be stated —
    // the same argument the json-placeholder test below makes.
    //
    // Asserted on the RESOLVED hint in both locales, for the same reason the
    // label assertion below is: since #3979 the placeholder holds a translation
    // key, and matching /snake_case/ against the KEY would pass on the key's
    // spelling while a zh-CN author read whatever the table happens to say. The
    // convention has to survive translation — `snake_case` is a literal token
    // both locales must keep verbatim, not a word to render as 「蛇形命名」.
    const namePlaceholder = nameField!.placeholder;
    expect(namePlaceholder?.key, '`name`s placeholder must be a translation key (#3979)').toBeTruthy();
    expect(t(namePlaceholder!.key!, 'en-US'), 'en hint must state snake_case').toMatch(/snake_case/);
    expect(t(namePlaceholder!.key!, 'zh-CN'), 'zh hint must state snake_case').toMatch(/snake_case/);
    // The label must say what the box is FOR. A bare "Name" next to "Label"
    // reads as a second display string, which is how an author ends up typing
    // a heading into the anchor.
    //
    // Asserted on the RESOLVED label, in both locales, because `label` now
    // holds a translation key (#3913). Matching /i18n/i against the key itself
    // would be a claim about the key's spelling, not about the words an author
    // reads — and it would pass or fail for reasons unrelated to the wording
    // this case exists to protect.
    expect(t(nameField!.label, 'en-US')).toMatch(/i18n/i);
    expect(t(nameField!.label, 'zh-CN')).toMatch(/i18n/i);
  });

  it('lists `name` before `label` — the entry identity comes first', () => {
    // Matches `page:tabs` (`value` — named `key` until objectui#8278 renamed
    // it to the member the spec declares), where the stable identifier
    // precedes the human label. `page:accordion` items no longer have an identifier field
    // to compare against — its `value` was removed as dead input (#5212): the
    // renderer derives the panel id and never reads what was authored.
    const order = (sectionsField?.itemFields ?? []).map((f) => f.name);
    expect(order.indexOf('name')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('name')).toBeLessThan(order.indexOf('label'));
  });
});

/**
 * Palette coverage ↔ spec `PageComponentType` (#2943).
 *
 * The previous version of this suite hand-asserted a handful of palette
 * EXCLUSIONS (`expect(BLOCK_TYPE_META['element:form']).toBeUndefined()`), which
 * locks drift in rather than detecting it: a new spec block type could land and
 * simply never reach the palette, with nothing failing. These derive coverage
 * from the enum instead, so every value must be an explicit decision —
 * offered, or excluded with a documented reason.
 */
describe('page palette ↔ spec PageComponentType coverage', () => {
  const specNames: string[] = enumOptions(PageComponentType);

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read PageComponentType.options from the spec').not.toEqual([]);
  });

  it('every spec block type is either offered or explicitly excluded', () => {
    const undecided = specNames.filter(
      (t) => !(t in (BLOCK_TYPE_META as Record<string, unknown>)) && !(t in PALETTE_EXCLUSIONS),
    );
    // If this fails: a spec page-block type has no palette decision. Either add
    // it to BLOCK_TYPE_META (offered — it needs a renderer!) or to
    // PALETTE_EXCLUSIONS with the reason it is unauthorable.
    expect(undecided).toEqual([]);
  });

  it('no type is both offered and excluded', () => {
    const both = Object.keys(PALETTE_EXCLUSIONS).filter(
      (t) => t in (BLOCK_TYPE_META as Record<string, unknown>),
    );
    expect(both, 'a block cannot be offered and excluded at once').toEqual([]);
  });

  it('every exclusion names a real spec type and carries a reason', () => {
    for (const [type, reason] of Object.entries(PALETTE_EXCLUSIONS)) {
      expect(specNames, `'${type}' is not a spec PageComponentType — stale exclusion`).toContain(type);
      expect(reason.length, `'${type}' needs a reason`).toBeGreaterThan(10);
    }
  });

  it('ai:chat_window is not offered — it has no inline renderer, and the spec retired it', () => {
    // The palette used to offer it WITH a config panel while
    // `components/renderers/placeholders.tsx` deliberately excluded it to force
    // a loud error: an author dragged a block Studio advertised and got a red
    // "Unknown component type" box.
    expect((BLOCK_TYPE_META as any)['ai:chat_window']).toBeUndefined();
    expect(blockHasConfig('ai:chat_window')).toBe(false);
    // Excluded by the spec now, not by this palette: `@objectstack/spec` 17.7.0
    // dropped it from `PageComponentType` (objectstack#21504), so it needs no
    // exclusion entry, and "every exclusion names a real spec type" would refuse
    // one (objectui#11717).
    expect(specNames).not.toContain('ai:chat_window');
    expect(PALETTE_EXCLUSIONS['ai:chat_window']).toBeUndefined();
  });

  it('element:button offers an action editor — without it the button is inert', () => {
    // The generic "Advanced" section enumerates keys the block ALREADY has
    // (`Object.keys(blockProps)`), so it can edit an existing `action` but can
    // never add one. A button created in Studio therefore had no path to
    // becoming interactive at all. The spec declares the prop as
    // `InlineActionSchema` (objectstack#4135).
    const action = BLOCK_CONFIG['element:button'].find((f) => f.name === 'action');
    expect(action, 'element:button must expose an `action` field').toBeDefined();
    expect(action!.kind).toBe('json');
  });

  it('every json field carries a placeholder showing the expected shape', () => {
    // An empty JSON textarea tells an author nothing. The placeholder is the
    // only affordance a raw-JSON editor has, so a json field without one is a
    // blank box.
    const jsonFields = Object.entries(BLOCK_CONFIG).flatMap(([type, fields]) =>
      fields
        .filter((f) => f.kind === 'json')
        .map((f) => ({ where: `${type}.${f.name}`, spec: (f as { placeholder?: PlaceholderSpec }).placeholder })),
    );
    expect(jsonFields.length, 'no json field found — the filter is vacuous').toBeGreaterThan(0);
    expect(jsonFields.filter((f) => !f.spec).map((f) => f.where)).toEqual([]);
    // …and it stays a LITERAL (#3979). A JSON sample is the text the author
    // copies: a "translated" `"type"` / `"target"` yields metadata
    // `InlineActionSchema` rejects, so this is the one placeholder kind where
    // going through `t()` would be the bug rather than the fix.
    expect(jsonFields.filter((f) => f.spec?.key !== undefined).map((f) => f.where)).toEqual([]);
  });

  it('a block with a config panel is a block the palette offers', () => {
    // A panel for an unauthorable block is how the ai:chat_window
    // contradiction stayed invisible.
    //
    // Keyed on the palette itself, never on the spec enum. This case used to
    // filter to `specNames.includes(t)` first, meaning to exempt objectui-native
    // blocks (`object-grid`, `grid`, …) — but those need no exemption, because
    // the palette offers them, and the filter also skipped every NON-spec name
    // the palette does not offer. `ai:input` sat in exactly that hole with a
    // curated panel and no way to author it (objectui#8280). Palette membership
    // is the question this case asks, so the palette is the only thing it
    // reads — `TYPES_BY_CATEGORY`, the list the page canvas's picker renders.
    const offered = new Set<string>(TYPES_BY_CATEGORY.flatMap((g) => g.types));
    const orphanPanels = Object.keys(BLOCK_CONFIG).filter((t) => !offered.has(t));
    expect(orphanPanels, 'these expose a config panel but cannot be authored').toEqual([]);
  });

  describe("record:quick_actions `location` — the designer's action-location dropdown", () => {
    const locationField = () =>
      BLOCK_CONFIG['record:quick_actions'].find((f) => f.name === 'location') as
        | { options?: Array<{ value: string }> }
        | undefined;

    // POSITIVE half. Without it the negative pin below passes on an empty
    // option list, which is how a deleted dropdown reads as a passing test.
    it('offers exactly the locations the spec declares', () => {
      const offered = (locationField()?.options ?? []).map((o) => o.value);
      expect([...offered].sort()).toEqual([...ACTION_LOCATIONS].sort());
    });

    // NEGATIVE pin, converted from the coverage the removed option used to
    // carry. `global_nav` was retired from `ACTION_LOCATIONS` in
    // @objectstack/spec 17.0.0-rc.6 (objectstack#6888, maintainer ruling
    // 2026-08-09 direction 2): no running-app surface ever rendered it, and the
    // console's ⌘K palette reads no action metadata at all. An option the
    // schema now rejects by name must not be offerable, or the designer teaches
    // authors — and every AI copying this corpus — to write metadata that fails
    // to parse.
    it('does NOT offer the retired global_nav location', () => {
      const offered = (locationField()?.options ?? []).map((o) => o.value);
      expect(offered.length, 'option list is empty — the pin would be vacuous').toBeGreaterThan(0);
      expect(offered).not.toContain('global_nav');
      expect(ACTION_LOCATIONS as readonly string[]).not.toContain('global_nav');
    });

    // The i18n side of the same removal: an option key kept past its option is
    // dead vocabulary the next author reads as a live surface, so BOTH locale
    // tables lost `…option.location.global_nav`. `t()` returns the key
    // unchanged on a miss, which is exactly "this locale has no translation".
    it('has no leftover translation for the retired option in either locale', () => {
      const key = 'engine.inspector.pageBlock.option.location.global_nav';
      expect(t(key, 'en-US')).toBe(key);
      expect(t(key, 'zh-CN')).toBe(key);
    });
  });
});

/**
 * `page:header.icon` — the designer field that outlived the spec key (#3829).
 *
 * The same shape as the `global_nav` removal above, and it is here because
 * BLOCK_CONFIG is a PUBLISH FACE with no parity gate of its own: nothing in
 * this repo diffs the designer's field set against `ComponentPropsMap`, so a
 * field can go on offering a key the contract has retired and every derived
 * check stays green. This file is the substitute, per key.
 *
 * What was wrong: `PageHeaderProps.icon` was retired in @objectstack/spec
 * 17.0.0 (objectstack#6946 / PR objectstack#7115, ADR-0087 D2, maintainer
 * ruling 2026-08-09 route (c)) because no renderer ever read it — the canonical
 * `page:header` draws its identity from the record chrome (`recordChrome`) and
 * per-action `icon`s. The retirement's own prescription said "zero producers",
 * and for `page:card.actions` that was true; for this key it was not. The
 * designer kept offering an icon box for the canonical `page:header`, so an
 * author (an AI author especially) filled it in and the platform — which used
 * to drop the value silently — now rejects the whole node BY NAME. A retirement
 * that leaves its producer standing makes the failure worse, not better.
 *
 * The `layout:page-header` ALIAS kept its own `icon` input, deliberately: that
 * was a different renderer with a real read point. objectui#10859 batch 8
 * retired the alias, so `page:header` is the only header node, and the
 * contract refuses its `icon` by name (the ADR-0087 D2 tombstone).
 */
describe('page:header `icon` — the designer field retired with the spec key (#3829)', () => {
  const fieldNames = () => BLOCK_CONFIG['page:header'].map((f) => f.name);

  // POSITIVE half, for the reason the location dropdown states: without it the
  // negative pin below passes just as happily on a deleted panel.
  it('still offers the canonical header fields the renderer does implement', () => {
    // `breadcrumb` left this list with objectui#11173 — see the next describe.
    expect(fieldNames()).toEqual(['title', 'subtitle']);
  });

  it('does NOT offer the retired `icon` field', () => {
    expect(fieldNames().length, 'field list is empty — the pin would be vacuous').toBeGreaterThan(0);
    expect(fieldNames()).not.toContain('icon');
  });

  // Why `Object.keys(shape)` cannot be the test, and why this pin exists at all.
  // ADR-0087 D2 retirement REPLACES the member with `z.never()` rather than
  // deleting it, so `icon` is STILL a key of the shape: every "is it declared?"
  // check reads green while the parser rejects every value by name. The
  // criterion is `@object-ui/test-support`'s shared judge (objectui#3809,
  // converged here by objectui#4947), which OR-s the structural channel this
  // block used to spell out by hand with the `[REMOVED]` description channel.
  it('the spec tombstones `icon` rather than deleting it', () => {
    expect(listedShapeKeys(PageHeaderProps)).toContain('icon');
    expect(isShapeKeyTombstoned(PageHeaderProps, 'icon')).toBe(true);
    // Non-vacuity for the probe itself: a Zod-internals change that made every
    // member read `'never'` would make the line above meaningless, and a live
    // key is the only thing that can tell the difference.
    expect(isShapeKeyTombstoned(PageHeaderProps, 'title')).toBe(false);
    expect(shapeMemberTypeName(PageHeaderProps, 'title')).toBeTruthy();
  });

  // The i18n side, exactly as the retired option above: a key kept past its
  // field is dead vocabulary the next author reads as a live surface, so BOTH
  // locale tables lost the label and its placeholder. `t()` returns the key
  // unchanged on a miss, which is precisely "this locale has no translation".
  it('has no leftover translation for the retired field in either locale', () => {
    for (const key of [
      'engine.inspector.pageBlock.field.page:header.icon',
      'engine.inspector.pageBlock.placeholder.page:header.icon',
    ]) {
      expect(t(key, 'en-US')).toBe(key);
      expect(t(key, 'zh-CN')).toBe(key);
    }
  });
});

/**
 * `page:header.breadcrumb` — the second canonical header toggle retired under
 * the rule the `icon` describe above states (objectui#11173).
 *
 * The canonical `page:header` renderer stopped reading the key (objectui#11166),
 * and objectstack#20758 retires `PageHeaderProps.breadcrumb` through ADR-0087.
 * A designer that kept offering the toggle would author a key nothing reads,
 * and — once objectui pins a spec release carrying that tombstone — one the
 * platform refuses BY NAME. The producer leaves first, so the pin bump does not
 * find it standing. When that bump lands, the `icon` describe's tombstone probe
 * is the pattern for a third assertion here.
 *
 * NOT a strip, deliberately (triage ruling on the card): `RETIRED_BLOCK_PROP_KEYS`
 * gains no `page:header` entry, because the spec's ADR-0087 conversion is the
 * one strip and a second one here would hide its notice. The stored-page half —
 * a page already carrying `breadcrumb: true` opens, and its next save keeps the
 * key — is a fact about a real commit, so it is pinned on screen in
 * `inspectors/PageBlockInspector.pageHeaderBreadcrumb-11173.test.tsx`.
 */
describe('page:header `breadcrumb` — the designer toggle retired with its reader (objectui#11173)', () => {
  const fieldNames = () => BLOCK_CONFIG['page:header'].map((f) => f.name);

  // The POSITIVE half is the `icon` describe's field-set pin above; it is the
  // non-vacuity control for this negative one as well.
  it('does NOT offer the retired `breadcrumb` toggle', () => {
    expect(fieldNames().length, 'field list is empty — the pin would be vacuous').toBeGreaterThan(0);
    expect(fieldNames()).not.toContain('breadcrumb');
  });

  // The i18n side, as for `icon`: a label kept past its field is dead
  // vocabulary, so BOTH locale tables lost it. `t()` returns the key unchanged
  // on a miss.
  it('has no leftover translation for the retired toggle in either locale', () => {
    const key = 'engine.inspector.pageBlock.field.page:header.breadcrumb';
    expect(t(key, 'en-US')).toBe(key);
    expect(t(key, 'zh-CN')).toBe(key);
  });
});

/**
 * `page:accordion` `title` / items `value` — designer inputs no renderer
 * reads (#5212).
 *
 * Same PUBLISH-FACE-with-no-parity-gate reasoning as the `page:header.icon`
 * describe above: nothing diffs the designer's field set against
 * `ComponentPropsMap`, so a field can go on offering a key nothing on the
 * render path honours and every derived check stays green.
 *
 * What was wrong, verified against the CURRENT tree (the card that reported
 * this was six days stale and one of its three findings had already been
 * fixed elsewhere — objectui#3829 / PR #4794 dropped `page:header.icon`
 * before this issue was even filed):
 *   - `title`: `PageAccordionRenderer` (`renderers/layout/containers.tsx`)
 *     reads `items`, `allowMultiple`, `variant` — never `schema.title`, and
 *     there is no accordion-level heading in the rendered output.
 *     `PageAccordionProps` never declared a `title` member either, so this
 *     was dead on BOTH sides, not merely unread by one renderer.
 *   - items `value`: the renderer OVERWRITES it — `itemsWithValue =
 *     items.map((it, idx) => ({ ...it, value: `panel-${idx}` }))` — so an
 *     authored value never reaches the Radix item. `PageAccordionProps.items[]`
 *     deliberately does not declare `value` either, and carries a `guidance`
 *     prescription (added with the #5212 spec-side half) telling an author
 *     who writes it by hand to remove the key.
 *
 * Neither is symmetric with `page:tabs`: one component over, an authored
 * `items[].value` IS read, with a `tab-${idx}` fallback only when absent
 * (`itemsWithValue` for `page:tabs`, same file) — and the designer control
 * there is NAMED `value` since objectui#8278, which is what makes the two
 * comparable; until then it was named `key`, so the tabs panel wrote a key
 * the spec refuses by name and the renderer never reads.
 * `PageTabsProps.items[].value` is a real, declared schema member. The
 * accordion's panel id is unconditionally derived; the tabs one is genuinely
 * live — this suite touches the accordion only.
 */
describe('page:accordion `title` / items `value` — dead designer inputs (#5212)', () => {
  const fieldNames = () => BLOCK_CONFIG['page:accordion'].map((f) => f.name);
  const itemsField = () =>
    BLOCK_CONFIG['page:accordion'].find((f) => f.name === 'items') as
      | { kind: 'array'; itemFields: Array<{ name: string }> }
      | undefined;

  // POSITIVE half: without it the negative pins below would pass just as
  // happily on a designer panel that lost ALL of its fields.
  it('still offers the item fields the renderer does implement', () => {
    expect(fieldNames()).toEqual(['items']);
    expect(itemsField()?.itemFields.map((f) => f.name)).toEqual(['label']);
  });

  it('does NOT offer the accordion-level `title` field', () => {
    expect(fieldNames().length, 'field list is empty — the pin would be vacuous').toBeGreaterThan(0);
    expect(fieldNames()).not.toContain('title');
  });

  it('does NOT offer an item `value` field', () => {
    const names = itemsField()?.itemFields.map((f) => f.name) ?? [];
    expect(names.length, 'item field list is empty — the pin would be vacuous').toBeGreaterThan(0);
    expect(names).not.toContain('value');
  });

  // The spec side: unlike `page:header.icon` (a tombstoned `z.never()`
  // member — the key still exists on the shape), `title` and items `value`
  // were never declared at all, so a strict-object rejection is the right
  // envelope to assert (same `unrecognized_keys` pattern as
  // `text-input-inputs-spec-parity.test.ts`), not a tombstone-type probe.
  it('the spec rejects an authored `title` — not a member of PageAccordionProps', () => {
    const result = PageAccordionProps.safeParse({
      title: 'Section heading',
      items: [{ label: 'One', children: [] }],
    });
    expect(result.success).toBe(false);
    const codes = result.success ? [] : result.error.issues.map((i) => i.code);
    expect(codes).toContain('unrecognized_keys');
    const refused = result.success
      ? []
      : result.error.issues.flatMap((i) => (i as unknown as { keys?: string[] }).keys ?? []);
    expect(refused).toContain('title');
  });

  it('the spec rejects an authored item `value` — not a member of the item shape', () => {
    const result = PageAccordionProps.safeParse({
      items: [{ label: 'One', value: 'panel-custom', children: [] }],
    });
    expect(result.success).toBe(false);
    const codes = result.success ? [] : result.error.issues.map((i) => i.code);
    expect(codes).toContain('unrecognized_keys');
    const refused = result.success
      ? []
      : result.error.issues.flatMap((i) => (i as unknown as { keys?: string[] }).keys ?? []);
    expect(refused).toContain('value');
  });

  // Non-vacuity for both safeParse probes above: a base accordion with only
  // the declared keys must parse clean, or the rejections above could be
  // attributable to something other than the extra key under test.
  it('a base accordion with only declared keys parses clean', () => {
    const result = PageAccordionProps.safeParse({
      items: [{ label: 'One', children: [] }],
      allowMultiple: true,
      variant: 'card',
    });
    expect(result.success).toBe(true);
  });

  // The i18n side, exactly as the `page:header.icon` removal above: a key
  // kept past its field is dead vocabulary the next author reads as a live
  // surface, so BOTH locale tables lost these two keys.
  it('has no leftover translation for the retired fields in either locale', () => {
    for (const key of [
      'engine.inspector.pageBlock.field.page:accordion.title',
      'engine.inspector.pageBlock.field.page:accordion.items.value',
    ]) {
      expect(t(key, 'en-US')).toBe(key);
      expect(t(key, 'zh-CN')).toBe(key);
    }
  });
});

/**
 * `object-kanban` — the panel that could not author a valid board (objectui#7772).
 *
 * Same PUBLISH-FACE-with-no-parity-gate reasoning as the two describes above,
 * and this block is where that gap cost the most.
 * `scripts/check-designer-field-key-parity.mjs` judges `PAYLOAD_SHAPES` — the
 * field / object / permission payloads — and does not read `BLOCK_CONFIG` at
 * all, so nothing mechanical compared this panel's four fields against
 * `ObjectKanbanSchema`. What that hid was not one stale key but a matched pair:
 *
 *   - the ONLY control able to set grouping wrote `groupField`, which
 *     `ObjectKanban.tsx` reads at zero sites (`schema.groupBy` at thirteen in
 *     the same query, so that zero is a reading) and which objectui#7322
 *     retired BY NAME — `retirementTombstone()` on the zod face, `?: never` on
 *     the TS one;
 *   - `groupBy`, which the same card declared (REQUIRED then; OPTIONAL since
 *     objectui#8990, which aligned it with `@objectstack/spec`), had no control
 *     at all.
 *
 * So the panel stably emitted a node that carried a name-retired key and no
 * lane key at all, and rendered a board that grouped nothing with no diagnostic
 * anywhere. ⚠️ Under today's contract the missing lane key is no longer itself a
 * refusal — which is precisely why the CONTROL that the panel offers a `groupBy`
 * box matters more than it did: the schema no longer backstops its absence. `limit` is the third declared key it never offered:
 * `ObjectKanban.tsx` sends it as a real `$top`, so a board over
 * `DEFAULT_KANBAN_FETCH_BATCH_SIZE` records was silently truncated with no way to widen it.
 *
 * The parse probes below are the instrument this surface otherwise lacks: they
 * read the CONTRACT rather than a spelling, so the next control added here is
 * measured against the schema instead of against a reviewer's memory.
 */
describe('object-kanban — the `groupBy` control, and the retired `groupField` (objectui#7772)', () => {
  const fieldNames = () => BLOCK_CONFIG['object-kanban'].map((f) => f.name);

  /** A block node as the canvas hoists it: `properties.*` at the top level. */
  const nodeFrom = (properties: Record<string, unknown>) => ({
    type: 'object-kanban' as const,
    id: 'k1',
    ...properties,
  });

  // POSITIVE half, for the reason the two describes above state: without it the
  // negative pin would pass just as happily on a panel that lost every field.
  it('offers exactly the five controls, in panel order', () => {
    expect(fieldNames()).toEqual(['objectName', 'groupBy', 'titleField', 'cardFields', 'limit']);
  });

  it('does NOT offer the retired `groupField`', () => {
    expect(fieldNames().length, 'field list is empty — the pin would be vacuous').toBeGreaterThan(0);
    expect(fieldNames()).not.toContain('groupField');
  });

  /* ── the contract, read rather than spelled ───────────────────────────── */

  /** A value of the shape the control commits, chosen by its declared kind. */
  const sampleFor = (f: BlockPropField): unknown => {
    switch (f.kind) {
      case 'number':
        return 1;
      case 'boolean':
        return true;
      case 'field-list':
      case 'string-list':
        return ['name'];
      default:
        return 'name';
    }
  };

  it('every control writes a key `ObjectKanbanSchema` accepts', () => {
    // Membership, not absence: a field whose name the schema refuses (retired,
    // or never declared) fails here without anyone having to name it in
    // advance — which is the coverage `check-designer-field-key-parity.mjs`
    // gives the payload shapes and does not give this table.
    const refused = BLOCK_CONFIG['object-kanban']
      .filter(
        (f) =>
          !ObjectKanbanSchema.safeParse(
            nodeFrom({ objectName: 'opportunity', groupBy: 'stage', [f.name]: sampleFor(f) }),
          ).success,
      )
      .map((f) => f.name);
    expect(refused).toEqual([]);

    // Non-vacuity: the probe must be able to say no. A key this block never
    // declared has to be refused by the very same call shape.
    expect(
      ObjectKanbanSchema.safeParse(
        nodeFrom({ objectName: 'opportunity', groupBy: 'stage', groupField: 'stage' }),
      ).success,
    ).toBe(false);
  });

  it('the node this panel can now author PARSES', () => {
    const result = ObjectKanbanSchema.safeParse(
      nodeFrom({
        objectName: 'opportunity',
        groupBy: 'stage',
        titleField: 'name',
        cardFields: ['amount'],
        limit: 50,
      }),
    );
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  // FALSIFICATION for the probe above — the pre-fix control set, verbatim. A
  // green "it parses" means nothing unless the node this panel used to emit
  // goes red.
  //
  // ⚠️ It used to go red TWICE — once for the MISSING `groupBy` and once for the
  // name-retired `groupField`. objectui#8990 made `groupBy` OPTIONAL on both
  // faces (`@objectstack/spec` declares it optional, and requiring it made this
  // repository narrower than the protocol), so the first half is gone: an
  // absent lane key is no longer a refusal anywhere. The falsification still
  // holds on the half that was always the sharper one — the retired key refused
  // BY NAME — and it is now asserted as the SOLE issue, which is a strictly
  // tighter statement than the old two-key set: it fails if a future change
  // either stops refusing `groupField` or starts refusing something else here.
  it('the node the pre-fix panel emitted is still refused — at the name-retired `groupField`', () => {
    const result = ObjectKanbanSchema.safeParse(
      nodeFrom({ objectName: 'opportunity', groupField: 'stage', titleField: 'name' }),
    );
    expect(result.success).toBe(false);
    const byPath = Object.fromEntries(
      (result.error?.issues ?? []).map((i) => [i.path.join('.'), i]),
    );
    // objectui#8990 — was `['groupBy', 'groupField']`. The absent lane key is no
    // longer among the reasons, and asserting the WHOLE key set is what records
    // that rather than letting it pass unnoticed.
    expect(Object.keys(byPath).sort()).toEqual(['groupField']);
    // The retired key, refused BY NAME — the tombstone's guidance reaches the
    // author verbatim, which is the whole point of `retirementTombstone()` over
    // a silent strip. Asserted on the message because `invalid_type` alone
    // cannot tell a tombstone from an ordinary type mismatch.
    expect(byPath.groupField.message).toContain('RETIRED (objectui#7322)');
    expect(byPath.groupField.message).toContain('author `groupBy`');
  });

  // CONTROL for the pin above — `groupBy` being optional must not be mistaken
  // for `groupBy` being unjudged. The panel's own control writes a string, and
  // a non-string still fails.
  it('CONTROL — an optional `groupBy` is still TYPED when the panel writes one', () => {
    expect(
      ObjectKanbanSchema.safeParse(nodeFrom({ objectName: 'opportunity', groupBy: 'stage' })).success,
    ).toBe(true);
    const bad = ObjectKanbanSchema.safeParse(nodeFrom({ objectName: 'opportunity', groupBy: 42 }));
    expect(bad.success).toBe(false);
    expect((bad.error?.issues ?? []).map((i) => i.path.join('.'))).toContain('groupBy');
  });

  /* ── the placeholder states the real default ──────────────────────────── */

  it("`limit`'s placeholder is DEFAULT_KANBAN_FETCH_BATCH_SIZE, read from the renderer", () => {
    // The box is empty by default and the board still caps the fetch, so the
    // hint is only honest while it equals the constant `ObjectKanban.tsx`
    // actually falls back to. Read from source rather than imported: the
    // constant is not on `@object-ui/plugin-kanban`'s barrel, and a deep
    // cross-package import would be a worse coupling than a regex.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.resolve(here, '../../../../../../plugin-kanban/src/ObjectKanban.tsx'),
      'utf8',
    );
    const declared = /export const DEFAULT_KANBAN_FETCH_BATCH_SIZE = (\d+)/.exec(src)?.[1];
    expect(declared, 'could not read DEFAULT_KANBAN_FETCH_BATCH_SIZE from ObjectKanban.tsx').toBeTruthy();

    const limit = BLOCK_CONFIG['object-kanban'].find((f) => f.name === 'limit');
    expect(limit?.kind).toBe('number');
    expect((limit as { placeholder?: PlaceholderSpec }).placeholder).toEqual({ literal: declared });
  });

  /* ── the i18n side ────────────────────────────────────────────────────── */

  // The two repo-wide i18n gates do NOT reach this table — `check:i18n-keys`
  // and `check:i18n-dead-keys` both read `packages/i18n/src/locales/en.ts`, and
  // `engine.inspector.pageBlock.*` lives only in `metadata-admin/i18n.ts`
  // (which says so in its own header). So the renamed key's two halves are
  // pinned here, in the same file as the field it labels: the sibling
  // `block-config-i18n.test.ts` derives the NEW key from this table's position
  // and demands both locales define it, and this pin is the other direction —
  // a key kept past its field is dead vocabulary the next author reads as a
  // live surface.
  it('has no leftover translation for the retired key in either locale', () => {
    const retired = 'engine.inspector.pageBlock.field.object-kanban.groupField';
    expect(t(retired, 'en-US')).toBe(retired);
    expect(t(retired, 'zh-CN')).toBe(retired);
    // Non-vacuity: `t()` returning the key unchanged is also what a broken
    // table would do, so a live neighbour must still resolve to real text.
    const live = 'engine.inspector.pageBlock.field.object-kanban.groupBy';
    expect(t(live, 'en-US')).toBe('Group by field');
    expect(t(live, 'zh-CN')).toBe('分组字段');
  });
});

/**
 * `stripRetiredBlockProps` — the read-door half of objectui#7772.
 *
 * The rename above stops the panel WRITING `groupField`; documents saved by
 * every released build before it still carry the key, and after the rename it
 * is no longer a curated field, so it lands in `PageBlockInspector`'s generic
 * "Advanced" section — an editor that can set a value but has no delete. These
 * pin the door itself; `PageBlockInspector.retiredBlockProps.test.tsx` pins
 * what an author sees and what the next save commits.
 */
describe('stripRetiredBlockProps (objectui#7772)', () => {
  it('drops the retired key and keeps everything else', () => {
    const out = stripRetiredBlockProps('object-kanban', {
      objectName: 'opportunity',
      groupField: 'stage',
      groupBy: 'stage',
      titleField: 'name',
      // An unknown key the designer does not render still survives: this is a
      // tombstone-keyed strip, never a blanket unknown-key purge (AGENTS.md
      // #0.1) — a plugin-registered key would be lost by the blanket version.
      somePluginKey: 1,
    });
    expect(Object.keys(out).sort()).toEqual(
      ['groupBy', 'objectName', 'somePluginKey', 'titleField'].sort(),
    );
  });

  it('is scoped to the block type that retired the key', () => {
    // `groupField` is NODE-LOCAL to `object-kanban`. Any other block carrying a
    // key of that name keeps it — and so does the view-level `kanban.groupField`
    // alias, which is live (`core/src/utils/normalize-list-view.ts`) and is not
    // a page block at all.
    const props = { groupField: 'stage' };
    expect(stripRetiredBlockProps('object-grid', props)).toEqual({ groupField: 'stage' });
    expect(stripRetiredBlockProps(undefined, props)).toEqual({ groupField: 'stage' });
  });

  it('returns the very same object when there is nothing to strip', () => {
    // Identity, not equality: the caller memoises on this value, so allocating a
    // fresh object per read would churn every consumer downstream of it.
    const props = { objectName: 'opportunity', groupBy: 'stage' };
    expect(stripRetiredBlockProps('object-kanban', props)).toBe(props);
  });

  it('every registered key really is one the block schema refuses BY NAME', () => {
    // The membership criterion, mechanical: a key the schema ACCEPTS must never
    // be listed here, because stripping an accepted key deletes authored
    // metadata. Only `object-kanban` is registered today, and this walks
    // whatever the registry holds rather than that one literal.
    for (const [type, keys] of Object.entries(RETIRED_BLOCK_PROP_KEYS)) {
      expect(type, 'only object-kanban has a schema probe here').toBe('object-kanban');
      for (const key of keys) {
        const result = ObjectKanbanSchema.safeParse({
          type: 'object-kanban',
          id: 'k1',
          objectName: 'opportunity',
          groupBy: 'stage',
          [key]: 'anything',
        });
        expect(result.success, `${type}.${key} is still accepted`).toBe(false);
        expect(
          (result.error?.issues ?? []).some((i) => i.path.join('.') === key),
          `${type}.${key} was not refused at its own path`,
        ).toBe(true);
      }
    }
  });
});
