// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Catalog of Page-block types, mirrored from the framework's Page
 * schema (`regions[].components[].type` enum). Grouped + iconified
 * for the picker UI in PageBlockCanvas.
 *
 * Source of truth: keep the IDs in sync with
 * `@objectstack/spec`'s page protocol. New block types appear in the
 * `Other` category by default — add a META entry to give them an icon.
 */

import {
  PanelTop,
  PanelBottom,
  PanelLeft,
  Folders,
  ChevronsUpDown,
  Square,
  Layers,
  FileText,
  Tag,
  ListChecks,
  Activity,
  MessageSquare,
  Compass,
  AlertTriangle,
  Zap,
  BookOpen,
  History,
  Menu,
  Search,
  Sparkles,
  Type,
  Hash,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  List,
  Rows3,
  Box,
  Table,
  FormInput,
  Gauge,
  Columns3,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react';

export type BlockTypeId =
  // data — object-bound views & layout grid (the high-traffic app-page blocks)
  | 'grid' | 'object-grid' | 'object-form' | 'object-metric' | 'object-kanban'
  // page:*
  | 'page:header' | 'page:footer' | 'page:sidebar' | 'page:tabs'
  | 'page:accordion' | 'page:card' | 'page:section'
  // record:*
  | 'record:details' | 'record:highlights' | 'record:related_list'
  | 'record:activity' | 'record:discussion' | 'record:path' | 'record:alert'
  | 'record:quick_actions' | 'record:reference_rail' | 'record:history'
  // nav:* — page-content navigation (shell singletons like app:launcher /
  // global:notifications / user:profile are intentionally NOT page blocks)
  | 'nav:menu' | 'nav:breadcrumb'
  // global:*
  | 'global:search'
  // ai:*
  | 'ai:suggestion'
  // element:*
  | 'element:text' | 'element:number' | 'element:image' | 'element:divider'
  | 'element:button' | 'element:definition-list' | 'element:repeater';

export type BlockCategory = 'data' | 'layout' | 'record' | 'navigation' | 'element' | 'ai' | 'misc';

export interface BlockTypeMeta {
  id: BlockTypeId;
  /** The type's English name; its `labelKey` row's en value is this, word for word. */
  label: string;
  /**
   * Designer catalogue key of the name the add-block picker DISPLAYS, read in
   * the designer locale (objectui#10862; the add-widget picker's `labelKey`
   * shape from objectui#10804).
   */
  labelKey: string;
  category: BlockCategory;
  Icon: LucideIcon;
}

export const BLOCK_TYPE_META: Record<BlockTypeId, Omit<BlockTypeMeta, 'id'>> = {
  // Data — object-bound views & layout grid
  'grid': { label: 'Grid', labelKey: 'engine.pageBlockCanvas.type.grid', category: 'data', Icon: LayoutGrid },
  'object-grid': { label: 'Table', labelKey: 'engine.pageBlockCanvas.type.objectGrid', category: 'data', Icon: Table },
  'object-form': { label: 'Form', labelKey: 'engine.pageBlockCanvas.type.objectForm', category: 'data', Icon: FormInput },
  'object-metric': { label: 'Metric', labelKey: 'engine.pageBlockCanvas.type.objectMetric', category: 'data', Icon: Gauge },
  'object-kanban': { label: 'Kanban', labelKey: 'engine.pageBlockCanvas.type.objectKanban', category: 'data', Icon: Columns3 },

  // Page layout
  'page:header': { label: 'Header', labelKey: 'engine.pageBlockCanvas.type.pageHeader', category: 'layout', Icon: PanelTop },
  'page:footer': { label: 'Footer', labelKey: 'engine.pageBlockCanvas.type.pageFooter', category: 'layout', Icon: PanelBottom },
  'page:sidebar': { label: 'Sidebar', labelKey: 'engine.pageBlockCanvas.type.pageSidebar', category: 'layout', Icon: PanelLeft },
  'page:tabs': { label: 'Tabs', labelKey: 'engine.pageBlockCanvas.type.pageTabs', category: 'layout', Icon: Folders },
  'page:accordion': { label: 'Accordion', labelKey: 'engine.pageBlockCanvas.type.pageAccordion', category: 'layout', Icon: ChevronsUpDown },
  'page:card': { label: 'Card', labelKey: 'engine.pageBlockCanvas.type.pageCard', category: 'layout', Icon: Square },
  'page:section': { label: 'Section', labelKey: 'engine.pageBlockCanvas.type.pageSection', category: 'layout', Icon: Layers },

  // Record context
  'record:details': { label: 'Record details', labelKey: 'engine.pageBlockCanvas.type.recordDetails', category: 'record', Icon: FileText },
  'record:highlights': { label: 'Highlights', labelKey: 'engine.pageBlockCanvas.type.recordHighlights', category: 'record', Icon: Tag },
  'record:related_list': { label: 'Related list', labelKey: 'engine.pageBlockCanvas.type.recordRelatedList', category: 'record', Icon: ListChecks },
  'record:activity': { label: 'Activity timeline', labelKey: 'engine.pageBlockCanvas.type.recordActivity', category: 'record', Icon: Activity },
  'record:discussion': { label: 'Discussion', labelKey: 'engine.pageBlockCanvas.type.recordDiscussion', category: 'record', Icon: MessageSquare },
  'record:path': { label: 'Stage path', labelKey: 'engine.pageBlockCanvas.type.recordPath', category: 'record', Icon: Compass },
  'record:alert': { label: 'Alert banner', labelKey: 'engine.pageBlockCanvas.type.recordAlert', category: 'record', Icon: AlertTriangle },
  'record:quick_actions': { label: 'Quick actions', labelKey: 'engine.pageBlockCanvas.type.recordQuickActions', category: 'record', Icon: Zap },
  'record:reference_rail': { label: 'Reference rail', labelKey: 'engine.pageBlockCanvas.type.recordReferenceRail', category: 'record', Icon: BookOpen },
  'record:history': { label: 'History', labelKey: 'engine.pageBlockCanvas.type.recordHistory', category: 'record', Icon: History },

  // Navigation (page-content only; shell singletons are not page blocks)
  'nav:menu': { label: 'Nav menu', labelKey: 'engine.pageBlockCanvas.type.navMenu', category: 'navigation', Icon: Menu },
  'nav:breadcrumb': { label: 'Breadcrumb', labelKey: 'engine.pageBlockCanvas.type.navBreadcrumb', category: 'navigation', Icon: Compass },
  'global:search': { label: 'Global search', labelKey: 'engine.pageBlockCanvas.type.globalSearch', category: 'navigation', Icon: Search },

  // AI
  // `ai:chat_window` is deliberately NOT in the palette: the floating chat
  // overlay (plugin-chatbot) is the canonical entry point and there is no
  // inline page-level renderer — `components/renderers/placeholders.tsx`
  // documents that exclusion, and `@objectstack/spec` 17.7.0 retired the type
  // (objectstack#21504). The palette used to offer it (with a config panel), so
  // an author dragged a block Studio advertised and got a red "Unknown component
  // type" box (#2943).
  'ai:suggestion': { label: 'AI suggestion', labelKey: 'engine.pageBlockCanvas.type.aiSuggestion', category: 'ai', Icon: Sparkles },

  // Elements
  'element:text': { label: 'Text', labelKey: 'engine.pageBlockCanvas.type.elementText', category: 'element', Icon: Type },
  'element:number': { label: 'Number', labelKey: 'engine.pageBlockCanvas.type.elementNumber', category: 'element', Icon: Hash },
  'element:image': { label: 'Image', labelKey: 'engine.pageBlockCanvas.type.elementImage', category: 'element', Icon: ImageIcon },
  'element:divider': { label: 'Divider', labelKey: 'engine.pageBlockCanvas.type.elementDivider', category: 'element', Icon: Minus },
  'element:button': { label: 'Button', labelKey: 'engine.pageBlockCanvas.type.elementButton', category: 'element', Icon: MousePointerClick },
  'element:definition-list': { label: 'Definition list', labelKey: 'engine.pageBlockCanvas.type.elementDefinitionList', category: 'element', Icon: List },
  'element:repeater': { label: 'Repeater', labelKey: 'engine.pageBlockCanvas.type.elementRepeater', category: 'element', Icon: Rows3 },
};

/**
 * Every spec `PageComponentType` the page palette deliberately does NOT offer,
 * each with the reason it is unauthorable. This is the inverse of the old
 * guard (#2943): `block-config.test.ts` used to hand-assert a few exclusions,
 * which locks drift IN — a new spec block type could land and simply never
 * appear in the palette, unnoticed. The test now derives coverage from
 * `PageComponentType` and requires every value to be either in
 * {@link BLOCK_TYPE_META} or listed here, so a new one fails until someone
 * decides about it.
 *
 * A palette entry with no renderer is the failure this closes: `ai:chat_window`
 * was offered WITH a config panel while `placeholders.tsx` deliberately
 * excluded it to force a loud error — an author dragged a block Studio
 * advertised and got a red box.
 */
export const PALETTE_EXCLUSIONS: Record<string, string> = {
  // Shell singletons — chrome the app shell owns, not page content.
  'app:launcher': 'shell singleton — lives in the app shell chrome',
  'global:notifications': 'shell singleton — lives in the app shell header',
  //
  // ⛔ `user:profile` and `element:form` are NOT missing entries — they are
  // RETIRED UPSTREAM. `@objectstack/spec` 17.3.0 dropped both from
  // `PageComponentType` (measured: the enum went 34 → 32 options, lost set
  // exactly `['user:profile', 'element:form']`, gained set empty), and this
  // ledger's contract is that every entry names a REAL spec type — pinned by
  // `__tests__/block-config.test.ts`'s "every exclusion names a real spec type
  // and carries a reason". An exclusion for a type that no longer exists is a
  // decision about nothing.
  //
  // The reconciliation was made on all sites at once rather than here alone
  // (objectui#7122): `user:profile` also came out of `PROTOCOL_COMPONENTS` in
  // `@object-ui/components`' `renderers/placeholders.tsx`, and out of the
  // regenerated `@object-ui/cli` `known-schema-types.ts` that derives from it.
  // Deleting only this entry was refused twice, and rightly: it would silence
  // the one loud signal while objectui went on knowing a type the spec had
  // retired. Nothing user-reachable was removed — neither type had a renderer.
  // `user:profile` had only the dashed "Component Placeholder" scaffold (the
  // sibling `exclusion-reason-truthfulness.test.ts` measures exactly that and
  // records that this repo does not count the scaffold as a renderer), the
  // shell's own profile affordance is a React slot and never this block type,
  // and nothing anywhere registered `element:form`.
  //
  // ⛔ `ai:chat_window` is NOT a missing entry either — it is RETIRED UPSTREAM.
  // `@objectstack/spec` 17.7.0 dropped it from `PageComponentType` and refuses
  // it by name (objectstack#21504): its row refuses every props bag with a
  // message naming the floating chat overlay as the AI chat entry point. That
  // is the decision this entry recorded (no inline renderer; the overlay in
  // plugin-chatbot is canonical), now made upstream, so the entry went with the
  // type, as `user:profile` / `element:form` did (objectui#11717). The rest of
  // the decision stands where it lives: `components/renderers/placeholders.tsx`
  // still keeps `ai:chat_window` out so a referencing schema fails loudly, and
  // the palette still does not offer it (`block-config.test.ts`).
  // Renders fine — excluded because it is not PAGE CONTENT, not because it is
  // unrenderable. Both types have a registered renderer under `namespace:
  // 'element'` (`components/renderers/basic/text-input.tsx:161`,
  // `components/renderers/basic/record-picker.tsx:303`), so the "no renderer"
  // these two reasons used to open with was simply false (#6071). That matters
  // because this ledger is read as the DECISION RECORD: #5837 had to re-derive
  // registration state from source precisely because the stated reason could not
  // be trusted. `core/src/registry/public-blocks.ts` already words these same two
  // exclusions without any renderer claim.
  //
  // ⛔ The exclusions themselves are unchanged — still decisions, still standing.
  // Only the false leading clause moved; the substantive half (field widget /
  // belongs to a form) was correct all along and is kept verbatim.
  // `exclusion-reason-truthfulness.test.ts` pins the CLASS so it cannot come
  // back: an exclusion whose reason claims "no renderer" must not have one.
  'element:record_picker': 'renders, but not as page content — record picking is a field widget, not a page block (also excluded from PUBLIC_BLOCKS)',
  'element:text_input': 'renders, but not as page content — bare inputs belong to a form, not a page block',
  // Renders fine — excluded to keep ONE palette entry per renderer, not because
  // it is unauthorable. `record:chatter` and `record:discussion` are the same
  // renderer under two names: `plugin-detail/src/index.tsx` registers both
  // against `RecordChatterRenderer`, and the palette offers the CANONICAL one
  // above as 'Discussion'.
  //
  // ⛔ Excluded from the palette is NOT removed. `record:chatter` stays fully
  // renderable for schemas already in the wild — this entry changes what Studio
  // ADVERTISES, not what works. Deleting the registration is a different (and
  // breaking) change; `palette-discussion-alias.test.tsx` pins both halves so
  // "not offered" cannot quietly become "not rendered".
  //
  // Which of the two the palette advertises was a decision, not a pin-bump edit
  // (maintainer ruling 2026-08-22, objectui#5495 — Option A, the canonical name).
  // Everything else already pointed that way: `core/src/registry/public-blocks.ts`
  // records `record:chatter` as "`record:discussion` under a Salesforce-familiar
  // name, kept for schemas", objectui's own generator has emitted the canonical
  // spelling all along (`synth/buildDefaultPageSchema.ts`), and the console's AI
  // vocabulary leaves the alias uncurated for the same reason
  // (`apps/console/src/__tests__/public-contract.test.ts`, DELIBERATELY_UNCURATED).
  // The palette was the last surface still pointing at the alias — it offered it
  // only because the then-pinned `@objectstack/spec` did not declare the
  // canonical name yet (objectui#5328); the pinned spec now declares both.
  'record:chatter': 'compatibility alias — same renderer as the offered canonical `record:discussion`; still renders, just no longer advertised',
  //
  // `@objectstack/spec` 18 added three record blocks to `PageComponentType`
  // (objectui#12030). The bump records a palette decision for each and makes
  // none: offering a block is Studio feature work, and two of the three are
  // already drawn by the record page itself. Each reason states only what is
  // true of the block today.
  'record:approvals': 'renders (registered by `@object-ui/app-shell`), not yet offered: `@objectstack/spec` 18 added the type, and offering it in the palette is a Studio decision the version bump does not make',
  'record:attachments': 'renders (registered by `@object-ui/app-shell`), not yet offered: `@objectstack/spec` 18 added the type, and offering it in the palette is a Studio decision the version bump does not make',
  'record:approval_decision': 'renders (registered by `@object-ui/app-shell`), not yet offered: `@objectstack/spec` 18 added the type, and offering it in the palette is a Studio decision its registration does not make',
  // `record:json` stood here from 18.0.0-next.3 until the spec retired it
  // (objectstack#24162): it is no longer a `PageComponentType`, so it needs no
  // exclusion (objectui#12971).
};

/**
 * Block types that are ONE renderer under several spellings — the DISPLAY
 * counterpart to {@link PALETTE_EXCLUSIONS}.
 *
 * {@link BLOCK_TYPE_META} answers "what may an author drag IN". The page canvas
 * asks a different question — "what may an author already HAVE in this page" —
 * and for most exclusions the two answers coincide: `ai:chat_window`,
 * `element:form`, `element:record_picker` and `element:text_input` are not page
 * blocks an author composes with, so a node bearing one of those names is
 * something the canvas cannot draw meaningfully, and {@link UnknownBlockIcon}
 * plus the neutral `misc` tone is the honest chrome for it.
 *
 * An alias pair is where the two questions diverge. `record:discussion` and
 * `record:chatter` are registered against the SAME renderer function
 * (`plugin-detail/src/index.tsx`), and the palette deliberately offers exactly
 * one of them so there is one entry per renderer — which leaves the other
 * spelling rendering perfectly while the canvas drew it as an unknown grey box.
 *
 * The key here is RENDERER IDENTITY, not "is excluded". A group may only list
 * spellings that resolve, through `ComponentRegistry`, to the very same
 * component; `canvas-display-meta.test.tsx` asserts exactly that against the
 * real registry, so a group cannot claim a renderability it does not have. That
 * is what keeps `element:text_input` — excluded for an unrelated reason, and
 * with no twin — from borrowing an icon it has not earned.
 *
 * Groups are UNORDERED and orientation-agnostic on purpose. Which spelling the
 * palette advertises is a maintainer decision that has already flipped once
 * (objectui#5495 moved it from the alias to the canonical name), so the
 * resolver borrows from whichever member is offered TODAY rather than
 * hard-coding a direction; a future flip cannot re-open this gap.
 */
export const BLOCK_RENDERER_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['record:discussion', 'record:chatter'],
];

/**
 * Designer catalogue key of each category heading the add-block picker displays
 * (objectui#10862). The en rows are the English headings this table carried.
 */
export const CATEGORY_LABEL_KEY: Record<BlockCategory, string> = {
  data:       'engine.pageBlockCanvas.category.data',
  layout:     'engine.pageBlockCanvas.category.layout',
  record:     'engine.pageBlockCanvas.category.record',
  navigation: 'engine.pageBlockCanvas.category.navigation',
  element:    'engine.pageBlockCanvas.category.element',
  ai:         'engine.pageBlockCanvas.category.ai',
  misc:       'engine.pageBlockCanvas.category.misc',
};

export const TYPES_BY_CATEGORY: Array<{ category: BlockCategory; types: BlockTypeId[] }> = (() => {
  const out: Record<BlockCategory, BlockTypeId[]> = {
    data: [], layout: [], record: [], navigation: [], element: [], ai: [], misc: [],
  };
  for (const [id, meta] of Object.entries(BLOCK_TYPE_META)) {
    out[meta.category].push(id as BlockTypeId);
  }
  return (['data', 'layout', 'record', 'element', 'navigation', 'ai', 'misc'] as BlockCategory[])
    .map((c) => ({ category: c, types: out[c] }))
    .filter((g) => g.types.length > 0);
})();

/** Fallback icon for unknown block types. */
export const UnknownBlockIcon = Box;

/**
 * Per-category color tone — keeps block kinds scannable in the page
 * canvas and picker, mirroring the field-type / nav-kind / node-type
 * tinting used across the other Studio designers. Class strings are
 * written out in full so Tailwind's JIT emits them, with light + dark
 * variants (the app defaults to dark).
 */
export interface BlockCategoryTone {
  icon: string;
  badge: string;
}

export const BLOCK_CATEGORY_TONE: Record<BlockCategory, BlockCategoryTone> = {
  data: {
    icon: 'text-emerald-500 dark:text-emerald-400',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  layout: {
    icon: 'text-slate-500 dark:text-slate-400',
    badge: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
  },
  record: {
    icon: 'text-blue-500 dark:text-blue-400',
    badge: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  },
  navigation: {
    icon: 'text-indigo-500 dark:text-indigo-400',
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300',
  },
  element: {
    icon: 'text-teal-500 dark:text-teal-400',
    badge: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300',
  },
  ai: {
    icon: 'text-violet-500 dark:text-violet-400',
    badge: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  },
  misc: {
    icon: 'text-zinc-500 dark:text-zinc-400',
    badge: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400',
  },
};

/**
 * Icon + tone inputs for any block type the canvas can ENCOUNTER, as opposed to
 * {@link BLOCK_TYPE_META}, which lists what the palette OFFERS.
 *
 * Deliberately narrower than {@link BlockTypeMeta}: no `label`. `blockLabel()`
 * in `PageBlockCanvas` never consulted this catalogue — it falls back to the
 * raw type string — and widening display resolution into labels would change
 * author-visible naming, a separate decision from chrome.
 */
export interface BlockDisplayMeta {
  Icon: LucideIcon;
  category: BlockCategory;
}

/**
 * Resolve the canvas chrome for a block `type`: its palette entry when it has
 * one, otherwise an alias sibling's ({@link BLOCK_RENDERER_ALIAS_GROUPS}).
 * `undefined` for everything else, so the caller draws
 * {@link UnknownBlockIcon}. Nothing here makes a type offerable — the palette
 * is built from {@link BLOCK_TYPE_META} alone ({@link TYPES_BY_CATEGORY}).
 */
export function resolveBlockDisplayMeta(type: string): BlockDisplayMeta | undefined {
  const direct = BLOCK_TYPE_META[type as BlockTypeId];
  if (direct) return { Icon: direct.Icon, category: direct.category };
  for (const group of BLOCK_RENDERER_ALIAS_GROUPS) {
    if (!group.includes(type)) continue;
    for (const sibling of group) {
      const meta = BLOCK_TYPE_META[sibling as BlockTypeId];
      if (meta) return { Icon: meta.Icon, category: meta.category };
    }
  }
  return undefined;
}

/** Resolve a category tone for any block `type` string (handles unknowns). */
export function resolveBlockTone(type: string): BlockCategoryTone {
  return BLOCK_CATEGORY_TONE[resolveBlockDisplayMeta(type)?.category ?? 'misc'];
}
