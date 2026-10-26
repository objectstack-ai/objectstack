/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The 58 `on*` handler keys that the zod mirrors declared as `z.function()`
 * now REFUSE BY NAME (objectui#6124, maintainer ruling 2026-08-30, batch #8:
 * Q1 → A, Q2 → A with C, Q3 → A, Q4 → B).
 *
 * ## The defect, and why deletion was not the fix
 *
 * `z.function()` is a declaration NO JSON document can satisfy — `null`, `{}`,
 * `1`, `[]`, `"x"` and `true` are all refused; only a live function parses —
 * on the protocol layer of a JSON-authored vocabulary. Authors who learned
 * `onClick: { action: 'toast' }` from the corpus got a bare
 * `invalid_type … expected function` that named the key and nothing else.
 *
 * The obvious remedy, "the key leaves the mirror", was measured and refused:
 * `BaseSchema` is `.passthrough()`, so an UNDECLARED key is not refused — it
 * stops being judged and the value is KEPT. `onClick` is a member of
 * `SDUI_DOM_PASS_THROUGH_KEYS`, so the kept object reached the DOM listener
 * slot and React threw at click. A deletion converts a clear parse error into
 * silence plus a runtime throw. The counter-probe below pins that hazard so
 * nobody "simplifies" a refusal arm into a deletion.
 *
 * ## The ruled shape — two faces, one measurement per key
 *
 *   - zod face (all 58): the #5099 `z.custom` + guidance shape
 *     (`form.zod.ts` `FieldConstraintsSchema.pattern.value`), via
 *     `handlerKeyRefusal()` in `../zod/tombstone.zod.ts`. The predicate refuses
 *     EVERYTHING — an authored object AND a live function — because a JSON
 *     face has no function value and the programmatic face reaches renderers
 *     through the TypeScript interface / React props, never through
 *     `safeParse`. Measured on this tree: the only runtime `safeParse` doors
 *     into these mirrors are the CLI file validators and the exported
 *     `validateSchema` / `safeValidateSchema` helpers; `SchemaRenderer`
 *     validates through `@object-ui/core`'s structural validator, which never
 *     reads a handler key. The message names the key, says why JSON cannot
 *     author it, and points at the node-type spelling PR #6498 established
 *     (Q1 → A, option C).
 *   - TypeScript face (per key, measured): a key whose function value reaches
 *     a renderer at runtime keeps its function type — `SchemaRenderer` spreads
 *     every non-metadata schema key as a React prop, so a renderer that reads
 *     `schema.onX`, calls `props.onX`, or spreads leftover props onto a Radix
 *     root / DOM listener slot is a live channel (36 sites, `RUNTIME_SLOT`
 *     below — 37 since objectui#6576 minted `ObjectDataTableSchema` with an
 *     `onRowClick` arm, the first on an `objectql` mirror; 38 since objectui#7104
 *     declared `AlertDialogSchema.onAction`, a key the renderer had been reading
 *     UNDECLARED; 40 since objectui#7804 declared
 *     `ObjectKanbanSchema.onCardClick` / `.onQuickAdd`, that same shape again on
 *     the face that INHERITED those reads when objectui#8802 retired the
 *     sibling `kanban` arm; ⛔ this running tally is PROSE and has never carried
 *     objectui#7655's six or objectui#8802's removals, so it is not today's
 *     figure — read `RUNTIME_SLOT`'s own docblock and the length pin beside it,
 *     which objectui#7804's `DataTableSchema` slice moved by seven and its
 *     `objectql.ts` slice by a further nine). A key nothing reads
 *     gets the `?: never` tombstone (22 sites, `RETIRED` below; the `crud.ts`
 *     `confirm` / `base.ts` convention).
 *
 * ## Predictions, written before the first run (red-first)
 *
 * On the unmodified tree (`origin/main` @ `c93b4d5f3`):
 *   - the source census finds 58 `on*: z.function(` sites, not 0;
 *   - an authored object is refused with `invalid_type` (zod's bare message),
 *     not `custom` with the named guidance;
 *   - a live function parses GREEN on every one of the 58 (the accept-set
 *     change this card declares in its changeset);
 *   - `tsc -p tsconfig.test.json` reports TS2344 on every `RetiredIsNever`
 *     line (the member is still a function type).
 * The non-`on*` census (`cell` / `custom` / `renderCellEditor` / `validate`)
 * and the passthrough counter-probe are GREEN before and after — they pin the
 * ruling's scope (Q4 → B) and the reason for the arm, not this change.
 * (objectui#7759 group E later gave those four the same arm, so that census now
 * reads zero; their pins are in `./function-slot-keys-json-refusal-7759.test.ts`.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { retirementTombstone } from '../zod/tombstone.zod';
// objectui#6576 — the first handler arm on an `objectql` mirror, ledgered here
// like the 58 it joins.
// objectui#7804 added the second pair on this mirror: the `object-kanban` face
// INHERITED reads it never declared when objectui#8802 retired the sibling
// `kanban` arm.
import {
  ObjectDataTableSchema as ObjectDataTableZod,
  ObjectFormSchema as ObjectFormZod,
  ObjectGallerySchema as ObjectGalleryZod,
  ObjectGridSchema as ObjectGridZod,
  ObjectKanbanSchema as ObjectKanbanZod,
  ObjectViewSchema as ObjectViewZod,
} from '../zod/objectql.zod';
import type {
  ObjectDataTableSchema,
  ObjectFormSchema,
  ObjectGallerySchema,
  ObjectGridSchema,
  ObjectKanbanSchema,
  ObjectViewSchema,
} from '../objectql';
import {
  CalendarViewSchema as CalendarViewZod,
  CarouselSchema as CarouselZod,
  ChatbotSchema as ChatbotZod,
  ChatbotEnhancedSchema as ChatbotEnhancedZod,
  ChatbotFloatingSchema as ChatbotFloatingZod,
  FilterBuilderSchema as FilterBuilderZod,
} from '../zod/complex.zod';
import {
  AlertSchema as AlertZod,
  DataTableSchema as DataTableZod,
  ListItemSchema as ListItemZod,
  TreeViewSchema as TreeViewZod,
} from '../zod/data-display.zod';
import {
  AccordionSchema as AccordionZod,
  CollapsibleSchema as CollapsibleZod,
  ToggleGroupSchema as ToggleGroupZod,
} from '../zod/disclosure.zod';
import { ToastSchema as ToastZod } from '../zod/feedback.zod';
import {
  ButtonSchema as ButtonZod,
  CalendarSchema as CalendarZod,
  CheckboxSchema as CheckboxZod,
  CodeEditorSchema as CodeEditorZod,
  ComboboxSchema as ComboboxZod,
  CommandSchema as CommandZod,
  DatePickerSchema as DatePickerZod,
  FileUploadSchema as FileUploadZod,
  FormSchema as FormZod,
  InputOTPSchema as InputOTPZod,
  InputSchema as InputZod,
  RadioGroupSchema as RadioGroupZod,
  SelectSchema as SelectZod,
  SliderSchema as SliderZod,
  SwitchSchema as SwitchZod,
  TextareaSchema as TextareaZod,
  ToggleSchema as ToggleZod,
} from '../zod/form.zod';
import { CardSchema as CardZod, TabsSchema as TabsZod } from '../zod/layout.zod';
import {
  BreadcrumbItemSchema as BreadcrumbItemZod,
  ButtonGroupButtonSchema as ButtonGroupButtonZod,
  PaginationSchema as PaginationZod,
  SidebarSchema as SidebarZod,
} from '../zod/navigation.zod';
import {
  AlertDialogSchema as AlertDialogZod,
  DialogSchema as DialogZod,
  DrawerSchema as DrawerZod,
  DropdownMenuSchema as DropdownMenuZod,
  HoverCardSchema as HoverCardZod,
  MenuItemSchema as MenuItemZod,
  PopoverSchema as PopoverZod,
  SheetSchema as SheetZod,
} from '../zod/overlay.zod';

import type {
  CalendarViewSchema,
  CarouselSchema,
  ChatbotSchema,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
  FilterBuilderSchema,
} from '../complex';
import type { AlertSchema, DataTableSchema, ListItem, TreeViewSchema } from '../data-display';
import type { AccordionSchema, CollapsibleSchema, ToggleGroupSchema } from '../disclosure';
import type { ToastSchema } from '../feedback';
import type {
  ButtonSchema,
  CalendarSchema,
  CheckboxSchema,
  CodeEditorSchema,
  ComboboxSchema,
  CommandSchema,
  DatePickerSchema,
  FileUploadSchema,
  FormSchema,
  InputOTPSchema,
  InputSchema,
  RadioGroupSchema,
  SelectSchema,
  SliderSchema,
  SwitchSchema,
  TextareaSchema,
  ToggleSchema,
} from '../form';
import type { CardSchema, TabsSchema } from '../layout';
import type {
  BreadcrumbItem,
  ButtonGroupButton,
  PaginationSchema,
  SidebarSchema,
} from '../navigation';
import type {
  AlertDialogSchema,
  DialogSchema,
  DrawerSchema,
  DropdownMenuSchema,
  HoverCardSchema,
  MenuCommandItem,
  PopoverSchema,
  SheetSchema,
} from '../overlay';

/* ── The census, as data ─────────────────────────────────────────────────── */

type Site = readonly [file: string, schema: string, key: string, mirror: z.ZodType];

/** The object that DECLARES `key` behind a mirror. Every mirror here IS the
 *  object except `overlay.zod.ts#MenuItemSchema`: a `z.lazy` (its `children`
 *  recurse) over a discriminated UNION (command item | divider, objectui#6523),
 *  so the member lives on the command arm one `unwrap()` down. Typed loosely
 *  on purpose: the census is about members, not shapes. */
const objectOf = (mirror: z.ZodType, key: string): z.ZodObject<z.ZodRawShape> => {
  const inner = mirror instanceof z.ZodLazy ? mirror.unwrap() : mirror;
  if (inner instanceof z.ZodUnion) {
    const arm = (inner.options as z.ZodType[]).find(
      (o) => o instanceof z.ZodObject && key in (o as z.ZodObject<z.ZodRawShape>).shape,
    );
    if (!arm) throw new Error(`no union arm declares \`${key}\``);
    return arm as z.ZodObject<z.ZodRawShape>;
  }
  return inner as z.ZodObject<z.ZodRawShape>;
};

/**
 * 60 keys whose function value REACHES a renderer at runtime — the TypeScript
 * interface keeps the function type (36 at the objectui#6124 census; 38 since
 * `ObjectDataTableSchema.onRowClick`, objectui#6576, and `AlertDialogSchema.onAction`,
 * objectui#7104, joined; 44 since objectui#7655 gave `chatbot-enhanced` and
 * `chatbot-floating` their own faces, each carrying the three slots its
 * registration forwards; 51 since objectui#7804's `DataTableSchema` slice
 * declared the seven keys that arm's renderer had been reading undeclared;
 * 60 since the same card's `objectql.ts` slice declared nine more across four
 * arms in that one mirror file).
 * ⛔ Do not add a delta to this figure — the pin that cannot rot is
 * `expect(RUNTIME_SLOT).toHaveLength(…)` below; count the constant.
 * Channel measured per key on this tree:
 * `schema.onX` read/forwarded (kanban, chatbot, data-table, form, code-editor,
 * menu items), `props.onX` called after `SchemaRenderer`'s spread (input,
 * textarea, select, checkbox, file-upload, date-picker, input-otp, pagination,
 * filter-builder, calendar-view's `pickHostCallbacks`), or leftover props
 * spread onto a Radix root / DOM listener slot (accordion, collapsible,
 * toggle-group, tabs, the seven `onOpenChange` overlays, button's
 * `toFormControlDomProps` whitelist, card's `<Card {...cardProps}>`).
 */
const RUNTIME_SLOT: readonly Site[] = [
  // ⛔ objectui#7664's three `KanbanSchema` slots — `onCardMove`, `onCardClick`,
  // `onQuickAdd` — LEFT this ledger with their arm: objectui#8802 retired the
  // bare `kanban` node type key (maintainer ruling 2026-09-09) and
  // `KanbanSchema` retired with it, on both faces.
  //
  // ⚠️ This is a ledger SHRINK, and the distinction matters because shrinking
  // one is normally the exact failure this file was written to catch: the first
  // cut of objectui#7664 DROPPED `onCardClick` from the arm, which turned a
  // refused document into an accepted one while every ratchet stayed green.
  // What separates the two is where the refusal went:
  //   - a key dropped from a LIVE arm stops being judged and the value is KEPT,
  //     because `BaseSchema` is `.passthrough()`;
  //   - an arm whose TYPE LITERAL retired stops being reachable at all — a
  //     `{ "type": "kanban" }` document is now refused BY NAME by
  //     `RetiredKanbanNodeSchema`, so all three keys are refused a fortiori,
  //     on a document that never reaches a member check.
  // Pinned end to end in `./bare-kanban-node-key-retired-8802.test.ts`.
  //
  // ⚠️ `KanbanRenderer` still forwards all three off `schema.*`, and the
  // SURVIVING `object-kanban` face declares none of them — measured, and
  // recorded as a red-flag reading in
  // `plugin-kanban/src/__tests__/kanban-handler-slots-7664.test.tsx` rather
  // than repaired, because declaring them would WIDEN a published accept set.
  ['complex.zod.ts', 'CalendarViewSchema', 'onViewChange', CalendarViewZod],
  ['complex.zod.ts', 'FilterBuilderSchema', 'onChange', FilterBuilderZod],
  ['complex.zod.ts', 'ChatbotSchema', 'onError', ChatbotZod],
  ['complex.zod.ts', 'ChatbotSchema', 'onSend', ChatbotZod],
  // objectui#7655 — the two sibling faces forward the same two slots off `schema.*`
  // into `useObjectChat`, and their `handleClear` calls `schema.onClear?.()`.
  ['complex.zod.ts', 'ChatbotEnhancedSchema', 'onError', ChatbotEnhancedZod],
  ['complex.zod.ts', 'ChatbotEnhancedSchema', 'onSend', ChatbotEnhancedZod],
  ['complex.zod.ts', 'ChatbotEnhancedSchema', 'onClear', ChatbotEnhancedZod],
  ['complex.zod.ts', 'ChatbotFloatingSchema', 'onError', ChatbotFloatingZod],
  ['complex.zod.ts', 'ChatbotFloatingSchema', 'onSend', ChatbotFloatingZod],
  ['complex.zod.ts', 'ChatbotFloatingSchema', 'onClear', ChatbotFloatingZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onRowEdit', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onRowDelete', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onSelectionChange', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onColumnsReorder', DataTableZod],
  // ⭐ objectui#7804 — the `DataTableSchema` slice, seven keys the REGISTERED
  // `data-table` renderer read off the authored document while this arm declared
  // none of them, so `BaseSchema.passthrough()` ACCEPTED and KEPT an authored
  // `{ "action": "toast" }` and handed it to a call site that CALLS it.
  //
  // Each channel measured on its own, and they do NOT all share one — which is
  // why six siblings are not evidence for the seventh:
  //   - `onAddRecord` / `onBatchSave` / `onCellChange` / `onRowSave` are React
  //     props on `ObjectGridComponentProps`; `ObjectGrid` puts them on the
  //     `data-table` node it builds (`onRowSave ?? defaultRowSave` and
  //     `onBatchSave ?? defaultBatchSave` install a dataSource-backed default
  //     only when the host wired none);
  //   - `onRowActionDef` is `RelatedList`'s own `onRowAction` React prop,
  //     forwarded onto the node it builds;
  //   - `onRowClick` has THREE suppliers — `ObjectGrid`'s `navigation.handleClick`,
  //     `ObjectDataTable`'s `schema.onRowClick ?? handleRowClick`, and
  //     `RelatedList`'s own prop — and its forwarding face,
  //     `ObjectDataTableSchema.onRowClick`, is already a site in this ledger;
  //   - ⚠️ `onColumnResize` has NO host prop at all. `ObjectGrid` supplies its own
  //     closure, folding the resize into the merged `{ order, widths }` layout it
  //     persists and reports through `onColumnStateChange`. A live function still
  //     reaches the renderer through the TypeScript face, so the slot is real;
  //     `'retired'` would have published "no renderer reads this key" for a read
  //     objectui#6175 wired on purpose.
  ['data-display.zod.ts', 'DataTableSchema', 'onAddRecord', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onBatchSave', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onCellChange', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onColumnResize', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onRowActionDef', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onRowClick', DataTableZod],
  ['data-display.zod.ts', 'DataTableSchema', 'onRowSave', DataTableZod],
  // objectui#7804 — the `TreeViewSchema` slice, one site. `tree-view.tsx` gates on
  // `if (schema.onNodeClick)` and CALLS `schema.onNodeClick(node)`; the TS face
  // already declared the callable twin, so the mirror's named refusal is what the
  // JSON face was missing. ⚠️ `'retired'` was refused even though NO in-repo host
  // builds a `tree-view` node carrying it: the read is live, and this ledger's two
  // `TreeViewSchema` tombstones below (`onSelectChange`, `onExpandChange`) are the
  // keys that really are dead — the contrast is measured, not stylistic.
  ['data-display.zod.ts', 'TreeViewSchema', 'onNodeClick', TreeViewZod],
  ['disclosure.zod.ts', 'AccordionSchema', 'onValueChange', AccordionZod],
  ['disclosure.zod.ts', 'CollapsibleSchema', 'onOpenChange', CollapsibleZod],
  ['disclosure.zod.ts', 'ToggleGroupSchema', 'onValueChange', ToggleGroupZod],
  ['form.zod.ts', 'ButtonSchema', 'onClick', ButtonZod],
  ['form.zod.ts', 'InputSchema', 'onChange', InputZod],
  ['form.zod.ts', 'TextareaSchema', 'onChange', TextareaZod],
  ['form.zod.ts', 'SelectSchema', 'onChange', SelectZod],
  ['form.zod.ts', 'CheckboxSchema', 'onChange', CheckboxZod],
  ['form.zod.ts', 'FileUploadSchema', 'onChange', FileUploadZod],
  ['form.zod.ts', 'DatePickerSchema', 'onChange', DatePickerZod],
  ['form.zod.ts', 'InputOTPSchema', 'onChange', InputOTPZod],
  ['form.zod.ts', 'FormSchema', 'onSubmit', FormZod],
  ['form.zod.ts', 'FormSchema', 'onChange', FormZod],
  ['form.zod.ts', 'FormSchema', 'onCancel', FormZod],
  ['form.zod.ts', 'CodeEditorSchema', 'onChange', CodeEditorZod],
  ['layout.zod.ts', 'CardSchema', 'onClick', CardZod],
  ['layout.zod.ts', 'TabsSchema', 'onValueChange', TabsZod],
  ['navigation.zod.ts', 'PaginationSchema', 'onPageChange', PaginationZod],
  // objectui#6576 / #6914 — `ObjectDataTable.tsx` forwards `schema.onRowClick` into the `data-table` it renders.
  ['objectql.zod.ts', 'ObjectDataTableSchema', 'onRowClick', ObjectDataTableZod],
  // ⭐ objectui#7804 — the `plugin-kanban` slice of the 39-row finding, and a
  // ledger GROWTH on the face that INHERITED the reads objectui#8802's arm
  // retirement left declared by nothing. Each channel measured on its own, and
  // the two do not share one:
  //   - `onQuickAdd` rides `ObjectKanban`'s `...schema` spread untouched and
  //     arrives at `KanbanImpl` BY IDENTITY;
  //   - `onCardClick` is SUBSTITUTED on the schema `ObjectKanban` hands down,
  //     and is live anyway through the other channel — `SchemaRenderer` spreads
  //     the authored key as a React prop, `ObjectKanbanComponentProps` declares
  //     it, and the substituted wrapper CALLS it.
  // ⚠️ The third key, `onCardMove`, is NOT in this half and never was: its
  // authored value reaches nothing on this entry, which is the `'retired'`
  // disposition. It is filed in `RETIRED` below since objectui#9342, which
  // moved `KanbanRenderer`'s read off the document and onto an explicit React
  // prop — until then `check:handler-key-reads` refused the tombstone spelling
  // while the renderer still read the key.
  //
  // ⭐ `onQuickAdd` LEFT this half for `RETIRED` below (objectui#11234). Its row
  // moved; no row was dropped, which is why `ALL_SITES` holds its size.
  ['objectql.zod.ts', 'ObjectKanbanSchema', 'onCardClick', ObjectKanbanZod],
  // ⭐ objectui#7804 — the `objectql.ts` slice: nine keys across FOUR plain
  // `export interface X extends BaseSchema` faces in one file, every one read
  // off the authored document by a registered renderer while its arm declared
  // nothing, so `BaseSchema.passthrough()` ACCEPTED and KEPT an authored
  // `{ "action": "toast" }` and handed it to a call site that CALLS it.
  //
  // Each channel measured on its own, and they do NOT all share one — which is
  // why the group is not evidence for any member of it:
  //   - the five `ObjectFormSchema` keys are forwarded off `schema.*` by
  //     `ObjectForm` onto the variant node it renders;
  //     `ObjectFormComponentProps` declares only `schema` / `dataSource` /
  //     `className`, so the `object-form` NODE a host builds in TypeScript is
  //     the channel. `onSuccess` / `onCancel` have ten in-repo suppliers
  //     between them, `onOpenChange` three, `onError` one;
  //   - ⚠️ `onStepChange` has NONE. `ObjectForm` forwards it onto the wizard
  //     node and `WizardForm` calls `schema.onStepChange(step)`, so the channel
  //     is wired end to end and only the supplier is missing;
  //   - ⚠️ the two `ObjectGallerySchema` keys are this ledger's PROPS-half
  //     shape: `SchemaRenderer` spreads an authored node's leftover keys into
  //     the props bag, and `ObjectGallery` reads BOTH on one line
  //     (`props.onRowClick ?? props.onCardClick`). `onRowClick` is supplied by
  //     `ListView`'s `baseProps` and `RelatedList`'s mobile branch;
  //     `onCardClick` is the `??` fallback spelling with no in-repo supplier;
  //   - ⚠️ `ObjectGridSchema.onNavigate` has no in-repo supplier either. Its
  //     read is deliberate (maintainer ruling 2026-08-19 on objectui#5234,
  //     option C: declared for programmatic callers, off the authoring
  //     surface), and `gridNonAuthorKeys.test.tsx` supplies it from a schema
  //     and asserts the call still fires;
  //   - `ObjectViewSchema.onNavigate` is read at four sites in `plugin-view`'s
  //     `ObjectView` and supplied by `@object-ui/app-shell`'s `ObjectView`.
  //     ⚠️ Same key NAME as the grid's, different signature, different
  //     supplier, judged separately.
  //
  // ⛔ `'retired'` was refused for all nine: it publishes "no renderer reads
  // this key" against reads the renderers demonstrably make. A missing SUPPLIER
  // is not a missing read.
  ['objectql.zod.ts', 'ObjectFormSchema', 'onCancel', ObjectFormZod],
  ['objectql.zod.ts', 'ObjectFormSchema', 'onError', ObjectFormZod],
  ['objectql.zod.ts', 'ObjectFormSchema', 'onOpenChange', ObjectFormZod],
  ['objectql.zod.ts', 'ObjectFormSchema', 'onStepChange', ObjectFormZod],
  ['objectql.zod.ts', 'ObjectFormSchema', 'onSuccess', ObjectFormZod],
  ['objectql.zod.ts', 'ObjectGallerySchema', 'onCardClick', ObjectGalleryZod],
  ['objectql.zod.ts', 'ObjectGallerySchema', 'onRowClick', ObjectGalleryZod],
  ['objectql.zod.ts', 'ObjectGridSchema', 'onNavigate', ObjectGridZod],
  ['objectql.zod.ts', 'ObjectViewSchema', 'onNavigate', ObjectViewZod],
  ['overlay.zod.ts', 'DialogSchema', 'onOpenChange', DialogZod],
  ['overlay.zod.ts', 'AlertDialogSchema', 'onOpenChange', AlertDialogZod],
  // objectui#7104 — the action button's `onClick`; the renderer read `schema.onAction` UNDECLARED until then.
  ['overlay.zod.ts', 'AlertDialogSchema', 'onAction', AlertDialogZod],
  ['overlay.zod.ts', 'SheetSchema', 'onOpenChange', SheetZod],
  ['overlay.zod.ts', 'DrawerSchema', 'onOpenChange', DrawerZod],
  ['overlay.zod.ts', 'PopoverSchema', 'onOpenChange', PopoverZod],
  ['overlay.zod.ts', 'HoverCardSchema', 'onOpenChange', HoverCardZod],
  ['overlay.zod.ts', 'MenuItemSchema', 'onClick', MenuItemZod],
  ['overlay.zod.ts', 'DropdownMenuSchema', 'onOpenChange', DropdownMenuZod],
];

/**
 * The keys NO renderer reads — the TypeScript interface carries the `?: never`
 * tombstone. ⚠️ The population is whatever this array holds and the length
 * assertion below states; a figure repeated in this sentence would be derived
 * once and never again (AGENTS.md #9), and it already drifted here — it read
 * `22` while the assertion read `20`, across objectui#8802's arm retirement.
 * Measured per key: the renderer takes `({ schema })` only, or
 * strips the key through a `toFormControlDomProps` whitelist, or spreads it
 * onto a DOM element / primitive that has no such prop (React warns about an
 * unknown event handler and attaches nothing). `CommandSchema.onChange` is the
 * one that lands somewhere at all — cmdk's root `div`, where React fires it
 * with a SyntheticEvent on every keystroke — which is a DIFFERENT contract
 * from the declared `(value: string) => void`, not a consumer of it.
 */
const RETIRED: readonly Site[] = [
  // ⛔ objectui#7664's two `KanbanSchema` tombstones — `onColumnAdd`,
  // `onCardAdd` — LEFT this ledger with their arm (objectui#8802). Same
  // reasoning as the three runtime slots above: the arm's TYPE LITERAL retired,
  // so the document never reaches a member check.
  ['complex.zod.ts', 'CarouselSchema', 'onSlideChange', CarouselZod],
  ['complex.zod.ts', 'ChatbotSchema', 'onSendMessage', ChatbotZod],
  ['data-display.zod.ts', 'AlertSchema', 'onDismiss', AlertZod],
  ['data-display.zod.ts', 'ListItemSchema', 'onClick', ListItemZod],
  ['data-display.zod.ts', 'TreeViewSchema', 'onSelectChange', TreeViewZod],
  ['data-display.zod.ts', 'TreeViewSchema', 'onExpandChange', TreeViewZod],
  ['feedback.zod.ts', 'ToastSchema', 'onDismiss', ToastZod],
  ['form.zod.ts', 'RadioGroupSchema', 'onChange', RadioGroupZod],
  ['form.zod.ts', 'SwitchSchema', 'onChange', SwitchZod],
  ['form.zod.ts', 'ToggleSchema', 'onChange', ToggleZod],
  ['form.zod.ts', 'SliderSchema', 'onChange', SliderZod],
  ['form.zod.ts', 'CalendarSchema', 'onChange', CalendarZod],
  ['form.zod.ts', 'InputOTPSchema', 'onComplete', InputOTPZod],
  ['form.zod.ts', 'ComboboxSchema', 'onChange', ComboboxZod],
  ['form.zod.ts', 'CommandSchema', 'onChange', CommandZod],
  ['navigation.zod.ts', 'BreadcrumbItemSchema', 'onClick', BreadcrumbItemZod],
  ['navigation.zod.ts', 'SidebarSchema', 'onCollapsedChange', SidebarZod],
  ['navigation.zod.ts', 'ButtonGroupButtonSchema', 'onClick', ButtonGroupButtonZod],
  // ⭐ objectui#9342 — the THIRD `ObjectKanbanSchema` handler key, and the one
  // its own slice could not file. Its disposition was measured `'retired'` by
  // objectui#7804 (an authored value reaches nothing: `ObjectKanban`
  // substitutes its own mover and declares no `onCardMove` React prop), but
  // `check:handler-key-reads` refuses a tombstone while a renderer still reads
  // the key off the document, so the row sat in that gate's
  // `KNOWN_UNDECLARED_READS` instead. `KanbanRenderer` now takes `onCardMove`
  // as an explicit React prop — the objectui#7742 remedy `objectFields` took —
  // and the tombstone is spelled on both faces.
  ['objectql.zod.ts', 'ObjectKanbanSchema', 'onCardMove', ObjectKanbanZod],
  // ⭐ objectui#11234 — the Quick Add handler, MOVED here from `RUNTIME_SLOT`
  // above. Its function did reach the board by identity, but on `object-kanban`
  // it was never called: its partner `quickAdd` is retired on this element
  // (objectui#8285, ruling B of decision batch #91). `check:handler-key-reads`
  // refused the tombstone while `KanbanRenderer` read the key off the document
  // `ObjectKanban` handed it. So `ObjectKanban` now renders the internal
  // `KanbanBoardCore`, which takes the pair only as explicit props, and it
  // supplies neither. The exported `KanbanRenderer` keeps the pair for a React
  // host; that is a component prop, not a document key.
  ['objectql.zod.ts', 'ObjectKanbanSchema', 'onQuickAdd', ObjectKanbanZod],
  ['overlay.zod.ts', 'AlertDialogSchema', 'onConfirm', AlertDialogZod],
  ['overlay.zod.ts', 'AlertDialogSchema', 'onCancel', AlertDialogZod],
];

const ALL_SITES: readonly Site[] = [...RUNTIME_SLOT, ...RETIRED];

/** The nine mirror files the census covers; `base.zod.ts` is not among them —
 *  it declares no named handler key. The record-valued `EventHandlersSchema`
 *  that once stood there was never one either, and objectui#6910 retired it;
 *  the NOTE left at its site records why no JSON-authorable handler record
 *  replaces it. `objectql.zod.ts` joined with objectui#6576 — it declared no
 *  handler key at all until `ObjectDataTableSchema.onRowClick`. */
const MIRROR_FILES = [
  'complex.zod.ts',
  'data-display.zod.ts',
  'disclosure.zod.ts',
  'feedback.zod.ts',
  'form.zod.ts',
  'layout.zod.ts',
  'navigation.zod.ts',
  'objectql.zod.ts',
  'overlay.zod.ts',
] as const;

const ZOD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'zod');
const readMirror = (file: string) => readFileSync(join(ZOD_DIR, file), 'utf8');

/** The card's ANCHORED census — the unanchored `on[A-Z]…` spelling matches
 *  mid-identifier (`buttonLabel`, `actionUrl`, …) and over-reports. */
const ON_KEY_FUNCTION = /^\s*on[A-Z][A-Za-z]*: z\.function\(/gm;
const NON_ON_FUNCTION = /^\s*(cell|custom|renderCellEditor|validate): z\.function\(/gm;

const describeOf = (mirror: z.ZodType, key: string): string | undefined =>
  (objectOf(mirror, key).shape[key] as { description?: string } | undefined)?.description;

/** One key, isolated: the member's OWN declaration, lifted out of its object,
 *  so the probe needs no per-schema fixture and a refusal can only be about the
 *  key under test.
 *
 *  ⚠️ Rebuilt rather than `.pick()`ed since objectui#7804. `ObjectKanbanSchema`
 *  closes with a record-source `.superRefine()` — the one-of
 *  `bind`/`data`/`objectName` rule, `requireRecordSource` since objectui#11117,
 *  which also counts the node's `dataSource.object` — and zod refuses `.pick()` on an object
 *  carrying refinements (`.pick() cannot be used on object schemas containing
 *  refinements`), which is a THROW rather than a red assertion and so would
 *  have read as the instrument breaking rather than as a missing fixture. The
 *  member declaration handed to the new object is the same one `.pick()` would
 *  have carried, and every probe below writes only that key, so no probe's
 *  reading moves; what is dropped with the wrapper is the record-source
 *  refinement, which is exactly the noise this isolation exists to remove. */
const pickKey = (mirror: z.ZodType, key: string) =>
  z.object({ [key]: objectOf(mirror, key).shape[key] });

const AUTHORED_ACTION_OBJECT = { action: 'toast', title: 'Saved', variant: 'success' };
const LIVE_FUNCTION = () => undefined;

/* ── Census ──────────────────────────────────────────────────────────────── */

describe('census: no on* key in the eight mirrors is declared z.function() (objectui#6124)', () => {
  it('the anchored source census finds 0 `on*: z.function(` sites', () => {
    const hits = MIRROR_FILES.flatMap((file) =>
      [...readMirror(file).matchAll(ON_KEY_FUNCTION)].map((m) => `${file}: ${m[0].trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it('the four non-on* z.function() sites are gone too (objectui#7759 group E, after Q4 → B kept them out of THIS sweep)', () => {
    // Q4 → B scoped objectui#6124's sweep to `on*` keys and left
    // cell/custom/validate/renderCellEditor as `z.function()`. objectui#7759's
    // ruling (group E, "按 #6124 直接派") then gave the four the same arm; their
    // per-key pins live in `./function-slot-keys-json-refusal-7759.test.ts`.
    const hits = MIRROR_FILES.flatMap((file) =>
      [...readMirror(file).matchAll(NON_ON_FUNCTION)].map((m) => `${file}#${m[1]}`),
    );
    expect(hits).toEqual([]);
    // Positive control for the census instrument, now that the tree holds no
    // site: the regex, anchored the same way, still matches the spelling the
    // four sites had.
    const spelled = "  cell: z.function().optional().describe('Custom cell renderer'),\n";
    expect([...spelled.matchAll(NON_ON_FUNCTION)].map((m) => m[1])).toEqual(['cell']);
  });

  it('82 sites are ledgered, 60 runtime slots + 22 retired, with no key filed twice', () => {
    // 58 from objectui#6124; the 59th is `ObjectDataTableSchema.onRowClick`,
    // minted with its arm by objectui#6576 / #6914; the 60th is
    // `AlertDialogSchema.onAction`, declared by objectui#7104 for a key the
    // renderer had been reading undeclared; 61–66 are the six slots the
    // `ChatbotEnhancedSchema` / `ChatbotFloatingSchema` twins were born with
    // (objectui#7655); the 67th was `KanbanSchema.onQuickAdd`, ledgered when
    // objectui#7664 re-keyed the `'kanban'` arm onto the plugin dialect.
    //
    // ⭐ 67 → 62: objectui#8802 retired the bare `kanban` node type key and its
    // arm, taking FIVE `KanbanSchema` sites with it — three runtime slots
    // (`onCardMove`, `onCardClick`, `onQuickAdd`) and two tombstones
    // (`onColumnAdd`, `onCardAdd`). ⛔ A ledger SHRINK is normally this file's
    // own failure mode; the two comment blocks above state why an ARM
    // retirement is not that failure, and `./bare-kanban-node-key-retired-8802.test.ts`
    // measures the refusal that replaced them.
    //
    // ⭐ 62 → 64: objectui#7804 declared `ObjectKanbanSchema.onCardClick` and
    // `.onQuickAdd`, two of the three reads the retirement above left on the
    // SURVIVING face with nothing declaring them. ⚠️ TWO, not three — the
    // third (`onCardMove`) was measured `'retired'` and the gate of record
    // refused that spelling while the renderer still read the key, so it stayed
    // in `KNOWN_UNDECLARED_READS` rather than being filed here under a
    // disposition nothing measured.
    //
    // ⭐ 64 → 65: objectui#9342 moved that read to an explicit React prop on
    // `KanbanRendererProps`, which is what let the arm carry the tombstone the
    // measurement always asked for. A ledger GROWTH on the retired half, and
    // the disposition is the one objectui#7804 measured — not a new reading.
    //
    // ⭐ 72 → 81: objectui#7804's `objectql.ts` slice — nine keys across FOUR
    // arms in one mirror file, all nine on the RUNTIME SLOT half. Larger than
    // the `DataTableSchema` slice below, and unlike it spread over four faces,
    // so the per-key measurement had to be taken four times over: three of the
    // nine (`ObjectFormSchema.onStepChange`, `ObjectGallerySchema.onCardClick`,
    // `ObjectGridSchema.onNavigate`) have NO in-repo supplier, and the site
    // comment beside the rows records why that is a missing supplier and not a
    // missing read.
    //
    // ⭐ 65 → 72: objectui#7804's `DataTableSchema` slice, the largest single
    // growth this ledger has taken — seven keys the registered `data-table`
    // renderer read off the authored document with the arm declaring none of
    // them. All seven land on the RUNTIME SLOT half, each measured at its own
    // channel; `onColumnResize` is the one that does not share the group's, and
    // the site comment beside the rows records why that mattered.
    //
    // ⭐ 61 + 21 → 60 + 22, total unchanged: objectui#11234 MOVED
    // `ObjectKanbanSchema.onQuickAdd` from the runtime-slot half to the retired
    // half. A move between halves holds `ALL_SITES` at the same size, so the two
    // half lengths are the readings that see it, and both are pinned here.
    expect(RUNTIME_SLOT).toHaveLength(60);
    expect(RETIRED).toHaveLength(22);
    const ids = ALL_SITES.map(([file, schema, key]) => `${file}#${schema}.${key}`);
    expect(new Set(ids).size).toBe(82);
  });

  it.each(ALL_SITES)('%s %s.%s is DECLARED on the mirror shape, with the objectui#6124 guidance as its description', (_file, _schema, key, mirror) => {
    // Deliberately `.shape`, not `safeParse`: under `.passthrough()` a DELETED
    // key still parses green and the value rides through, so a parse-based
    // declaration pin stays green through the very deletion it exists to
    // catch (the same reading PR #6899's pin recorded for the event-name keys).
    expect(objectOf(mirror, key).shape[key]).toBeDefined();
    expect(describeOf(mirror, key)).toContain('objectui#6124');
  });
});

/* ── Behaviour: the refusal, by name, with the remedy ─────────────────────── */

describe('a JSON author is refused BY NAME and pointed at the node-type spelling (objectui#6124, Q2 → A)', () => {
  it.each(ALL_SITES)('%s %s.%s refuses an authored action object with its own guidance, not zod\'s bare invalid_type', (_file, _schema, key, mirror) => {
    const result = pickKey(mirror, key).safeParse({ [key]: AUTHORED_ACTION_OBJECT });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => String(i.path[0]) === key);
    expect(issue, `no issue addressed to \`${key}\``).toBeDefined();
    // The #5099 shape: a `z.custom` predicate, so the code is `custom` — the
    // bare `z.function()` reported `invalid_type` with "expected function".
    expect(issue!.code).toBe('custom');
    expect(issue!.path).toEqual([key]);
    expect(issue!.message).toContain(`\`${key}\``);
    expect(issue!.message).not.toContain('expected function');
    // The remedy: the node-type spelling PR #6498 established (Q1, option C).
    expect(issue!.message).toContain('"type"');
    expect(issue!.message).toContain('action:button');
    // BOTH channels, one string — the runtime message and the `.describe()`
    // metadata cannot drift apart (the `retirementTombstone()` invariant).
    expect(issue!.message).toBe(describeOf(mirror, key));
  });

  it.each(ALL_SITES)('%s %s.%s refuses a LIVE FUNCTION too — the JSON mirror is not the programmatic channel', (_file, _schema, key, mirror) => {
    // This is the accept-set change the changeset declares. The ruling: the
    // programmatic face goes through the TypeScript interface / React props
    // and never through `safeParse`; a function that parsed green here was
    // the instrument's positive control, never an authoring form.
    const result = pickKey(mirror, key).safeParse({ [key]: LIVE_FUNCTION });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, String(i.path[0])])).toEqual([['custom', key]]);
  });

  it.each(ALL_SITES)('%s %s.%s — the same isolated shape parses GREEN without the key (the arm is optional; the refusal is about the key)', (_file, _schema, key, mirror) => {
    expect(pickKey(mirror, key).safeParse({}).success).toBe(true);
  });

  it('the guidance wording distinguishes a runtime slot from a retired key', () => {
    for (const [, , key, mirror] of RUNTIME_SLOT) {
      expect(describeOf(mirror, key), key).toContain('RUNTIME SLOT');
      expect(describeOf(mirror, key), key).not.toContain('RETIRED');
    }
    for (const [, , key, mirror] of RETIRED) {
      expect(describeOf(mirror, key), key).toContain('RETIRED (objectui#6124');
      expect(describeOf(mirror, key), key).not.toContain('RUNTIME SLOT');
    }
  });

  it('a whole document still parses green once the handler key is spelled as a node type', () => {
    // The corpus flip PR #6498 landed: `{ "type": "toast" }` is the authorable
    // spelling; a button without a handler key is a plain green button.
    expect(ButtonZod.safeParse({ type: 'button', label: 'Save' }).success).toBe(true);
    expect(ToastZod.safeParse({ type: 'toast', title: 'Saved' }).success).toBe(true);
    expect(DialogZod.safeParse({ type: 'dialog', title: 'Confirm' }).success).toBe(true);
  });
});

/* ── Counter-probe: why the arm, and not a deletion ───────────────────────── */

describe('counter-probe: deleting the key instead would be a SILENT accept that KEEPS the value (the ruling\'s ⛔ 不裸删)', () => {
  const retiredEnvelope = {
    type: 'button',
    label: 'Destructive Toast',
    variant: 'destructive',
    onClick: AUTHORED_ACTION_OBJECT,
  };

  it('with the arm: refused at path onClick', () => {
    const result = ButtonZod.safeParse(retiredEnvelope);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['onClick']);
  });

  it('the deletion, simulated: `BaseSchema.passthrough()` parses it GREEN and the object rides through to the DOM listener slot', () => {
    const result = ButtonZod.omit({ onClick: true }).safeParse(retiredEnvelope);
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).onClick).toEqual(AUTHORED_ACTION_OBJECT);
  });

  it('the refusal arm is not a retirement tombstone: it reports `custom`, the tombstone reports `invalid_type`', () => {
    // Two helpers, two meanings — `retirementTombstone()` retires a key from
    // the contract on BOTH faces; the handler refusal keeps 36 of these keys
    // live on the TypeScript face. Pinned so the two are not merged into one.
    const tombstone = retirementTombstone('RETIRED (fixture)').safeParse('x');
    expect(tombstone.success).toBe(false);
    expect(tombstone.error?.issues[0]?.code).toBe('invalid_type');
    const arm = pickKey(ButtonZod, 'onClick').safeParse({ onClick: 'x' });
    expect(arm.error?.issues[0]?.code).toBe('custom');
  });
});

/* ── The TypeScript face, judged by `tsc -p tsconfig.test.json` ──────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** `?: never` reads as exactly `undefined` off the interface. `Equal`, not
 *  `extends`: `BaseSchema`'s `[key: string]: any` meant a DELETED member read
 *  `any` until objectui#8347, which a one-way check would accept (the
 *  disabled-twin lesson). */
type RetiredIsNever<T> = Equal<T, undefined>;

/** A runtime slot keeps a callable member: some function type survives the
 *  `Extract`. Written over `NonNullable` so `undefined` cannot satisfy it. */
type KeepsFunction<T> = [Extract<NonNullable<T>, (...args: never[]) => unknown>] extends [never]
  ? false
  : true;

export type assertionRetiredKeysAreTombstoned = [
  Expect<RetiredIsNever<CarouselSchema['onSlideChange']>>,
  Expect<RetiredIsNever<ChatbotSchema['onSendMessage']>>,
  Expect<RetiredIsNever<AlertSchema['onDismiss']>>,
  Expect<RetiredIsNever<ListItem['onClick']>>,
  Expect<RetiredIsNever<TreeViewSchema['onSelectChange']>>,
  Expect<RetiredIsNever<TreeViewSchema['onExpandChange']>>,
  Expect<RetiredIsNever<ToastSchema['onDismiss']>>,
  Expect<RetiredIsNever<RadioGroupSchema['onChange']>>,
  Expect<RetiredIsNever<SwitchSchema['onChange']>>,
  Expect<RetiredIsNever<ToggleSchema['onChange']>>,
  Expect<RetiredIsNever<SliderSchema['onChange']>>,
  Expect<RetiredIsNever<CalendarSchema['onChange']>>,
  Expect<RetiredIsNever<InputOTPSchema['onComplete']>>,
  Expect<RetiredIsNever<ComboboxSchema['onChange']>>,
  Expect<RetiredIsNever<CommandSchema['onChange']>>,
  Expect<RetiredIsNever<BreadcrumbItem['onClick']>>,
  Expect<RetiredIsNever<SidebarSchema['onCollapsedChange']>>,
  Expect<RetiredIsNever<ButtonGroupButton['onClick']>>,
  Expect<RetiredIsNever<AlertDialogSchema['onConfirm']>>,
  Expect<RetiredIsNever<AlertDialogSchema['onCancel']>>,
  // objectui#11234 — moved here from the runtime-slot block below.
  Expect<RetiredIsNever<ObjectKanbanSchema['onQuickAdd']>>,
];

export type assertionRuntimeSlotsKeepTheirFunctionType = [
  Expect<KeepsFunction<CalendarViewSchema['onViewChange']>>,
  Expect<KeepsFunction<FilterBuilderSchema['onChange']>>,
  Expect<KeepsFunction<ChatbotSchema['onError']>>,
  Expect<KeepsFunction<ChatbotSchema['onSend']>>,
  Expect<KeepsFunction<ChatbotEnhancedSchema['onError']>>,
  Expect<KeepsFunction<ChatbotEnhancedSchema['onSend']>>,
  Expect<KeepsFunction<ChatbotEnhancedSchema['onClear']>>,
  Expect<KeepsFunction<ChatbotFloatingSchema['onError']>>,
  Expect<KeepsFunction<ChatbotFloatingSchema['onSend']>>,
  Expect<KeepsFunction<ChatbotFloatingSchema['onClear']>>,
  Expect<KeepsFunction<DataTableSchema['onRowEdit']>>,
  Expect<KeepsFunction<DataTableSchema['onRowDelete']>>,
  Expect<KeepsFunction<DataTableSchema['onSelectionChange']>>,
  Expect<KeepsFunction<DataTableSchema['onColumnsReorder']>>,
  // objectui#7804 — the `DataTableSchema` slice. Each TS twin stays callable
  // because the function value REACHES the renderer; the mirror refuses by name.
  Expect<KeepsFunction<DataTableSchema['onAddRecord']>>,
  Expect<KeepsFunction<DataTableSchema['onBatchSave']>>,
  Expect<KeepsFunction<DataTableSchema['onCellChange']>>,
  Expect<KeepsFunction<DataTableSchema['onColumnResize']>>,
  Expect<KeepsFunction<DataTableSchema['onRowActionDef']>>,
  // objectui#7804 — the `TreeViewSchema` slice. Same rule: the TS twin stays
  // callable because the function value REACHES the renderer and is INVOKED there.
  Expect<KeepsFunction<TreeViewSchema['onNodeClick']>>,
  Expect<KeepsFunction<DataTableSchema['onRowClick']>>,
  Expect<KeepsFunction<DataTableSchema['onRowSave']>>,
  // objectui#7804 — the `objectql.ts` slice. Each TS twin stays callable
  // because the function value REACHES the renderer; the mirror refuses by
  // name. The two `ObjectGallerySchema` keys are DECLARED here by this slice:
  // they reached the renderer through `SchemaRenderer`'s props spread while
  // `BaseSchema`'s index signature admitted them untyped, so declaring them is
  // a narrowing on this face as well as on the mirror.
  Expect<KeepsFunction<ObjectFormSchema['onCancel']>>,
  Expect<KeepsFunction<ObjectFormSchema['onError']>>,
  Expect<KeepsFunction<ObjectFormSchema['onOpenChange']>>,
  Expect<KeepsFunction<ObjectFormSchema['onStepChange']>>,
  Expect<KeepsFunction<ObjectFormSchema['onSuccess']>>,
  Expect<KeepsFunction<ObjectGallerySchema['onCardClick']>>,
  Expect<KeepsFunction<ObjectGallerySchema['onRowClick']>>,
  Expect<KeepsFunction<ObjectGridSchema['onNavigate']>>,
  Expect<KeepsFunction<ObjectViewSchema['onNavigate']>>,
  Expect<KeepsFunction<AccordionSchema['onValueChange']>>,
  Expect<KeepsFunction<CollapsibleSchema['onOpenChange']>>,
  Expect<KeepsFunction<ToggleGroupSchema['onValueChange']>>,
  Expect<KeepsFunction<ButtonSchema['onClick']>>,
  Expect<KeepsFunction<InputSchema['onChange']>>,
  Expect<KeepsFunction<TextareaSchema['onChange']>>,
  Expect<KeepsFunction<SelectSchema['onChange']>>,
  Expect<KeepsFunction<CheckboxSchema['onChange']>>,
  Expect<KeepsFunction<FileUploadSchema['onChange']>>,
  Expect<KeepsFunction<DatePickerSchema['onChange']>>,
  Expect<KeepsFunction<InputOTPSchema['onChange']>>,
  Expect<KeepsFunction<FormSchema['onSubmit']>>,
  Expect<KeepsFunction<FormSchema['onChange']>>,
  Expect<KeepsFunction<FormSchema['onCancel']>>,
  Expect<KeepsFunction<CodeEditorSchema['onChange']>>,
  Expect<KeepsFunction<CardSchema['onClick']>>,
  Expect<KeepsFunction<TabsSchema['onValueChange']>>,
  Expect<KeepsFunction<PaginationSchema['onPageChange']>>,
  Expect<KeepsFunction<ObjectDataTableSchema['onRowClick']>>,
  Expect<KeepsFunction<ObjectKanbanSchema['onCardClick']>>,
  Expect<KeepsFunction<DialogSchema['onOpenChange']>>,
  Expect<KeepsFunction<AlertDialogSchema['onOpenChange']>>,
  Expect<KeepsFunction<AlertDialogSchema['onAction']>>,
  Expect<KeepsFunction<SheetSchema['onOpenChange']>>,
  Expect<KeepsFunction<DrawerSchema['onOpenChange']>>,
  Expect<KeepsFunction<PopoverSchema['onOpenChange']>>,
  Expect<KeepsFunction<HoverCardSchema['onOpenChange']>>,
  Expect<KeepsFunction<MenuCommandItem['onClick']>>,
  Expect<KeepsFunction<DropdownMenuSchema['onOpenChange']>>,
];

// The two helpers must be able to FAIL — synthetic controls, both directions.
export type assertionRetiredIsNeverCanFail = Expect<Equal<RetiredIsNever<(() => void) | undefined>, false>>;
export type assertionKeepsFunctionCanFail = Expect<Equal<KeepsFunction<undefined>, false>>;
