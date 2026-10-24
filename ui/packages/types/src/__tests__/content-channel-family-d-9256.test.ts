/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9256 — FAMILY D of the measured table: the components whose renderer
 * reads NEITHER content channel. Both `body` and `children` are tombstoned on
 * both published faces, in the shape PR objectui#9254 established for families
 * A and B (maintainer ruling, summon #17 decision batch #2, 2026-09-07,
 * verbatim 「同意」: every component schema narrows to the channel its renderer
 * actually reads and tombstones the other).
 *
 * ## Why a NEITHER verdict needed a bigger instrument than families A+B did
 *
 * objectui#9254 measured `packages/components` only. A verdict of ABSENCE is
 * not sound over a subset: any of the other 23 registering packages, or a
 * generic traverser that is not a component at all, could have been the reader.
 * The sweep behind this file runs the same TypeScript type-checker instrument
 * over 46 programs — every workspace package plus the apps and examples, 1,604
 * source files — and files every `body` / `children` read under the TYPE of the
 * object it is read from. The extended table is objectui#9256 comment
 * 5644340762; the numbers moved (77 family-D registrations, not the card's ~60,
 * and 20 of them outside `packages/components`).
 *
 * Two readers decide a NEITHER verdict and neither is a component:
 *
 *   - `SchemaRenderer` (`packages/react`) destructures `children` and `body`
 *     OUT of the props bag it spreads, so the channels cannot reach a renderer
 *     by any route except that renderer reading `schema.body` / `schema.children`
 *     itself. That is what makes "reads neither" mean "renders nothing".
 *   - `validateSchema` (`packages/core`) reads `schema.children` else
 *     `schema.body` for EVERY node, but only to RECURSE into authored content
 *     and validate it. It renders nothing, so it does not make a channel live.
 *
 * ## What is held OUT of this file, and why — each is a measurement, not appetite
 *
 *   - ⭐ SIX of the nine bare-name hold-outs are narrowed HERE, by objectui#9256
 *     slice 2, and the reason is a measurement rather than a ruling.
 *     `ComponentRegistry.register` writes a bare-name fallback LAST-ONE-WINS, so
 *     which declaration governs an authored node was unmeasured — that is what
 *     held them. `check:registry-bare-names` (objectui#9264, the gate; run it
 *     with `--table` for the population) now measures it, and `text`, `image`,
 *     `icon`, `tabs` and `accordion` each have ONE claimant of the bare key
 *     because every rival passes `skipFallback: true`, while `calendar`'s
 *     several claimants name ONE full type. `ui:calendar` rides along on
 *     `calendar`'s tombstone by declaration (`.extend()` on the mirror, and on
 *     the TS face `OmitDeclared` since objectui#9256's E3 slice — the plain
 *     `Omit` it replaced collapsed into `BaseSchema`'s index signature and
 *     carried no member, the tombstone included). Its mirror half is pinned as
 *     its own row here; its TS half lives in
 *     `content-channel-e3-residual-9256.test.ts`.
 *   - ⭐ `list` and `timeline` are narrowed HERE, by objectui#9256 slice 3. They
 *     were held for a SERIAL constraint and ⛔ never for a verdict: both declare
 *     in `data-display.ts`, which another slice was editing. That constraint is
 *     discharged, and READERSHIP was re-derived for both rather than inherited —
 *     ownership (objectui#9264) settles who answers a bare key and licenses
 *     NOTHING about which channel a renderer reads, which is the conflation that
 *     would have narrowed `button`. `ListSchema` and `TimelineSchema` each file
 *     ZERO channel reads under their declared type while the same sweep fires
 *     `ButtonSchema` 2 · `DivSchema` 2 · `CardSchema` 2 · `ContainerSchema` 1, and
 *     both target types ARE seen as receivers in the same program (`ListSchema`
 *     for `bind` / `items` / `ordered` / `title` / `wrapperClass`, `TimelineSchema`
 *     for `items` / `minDate` / `maxDate` / `rowLabel`) — so the zeros are
 *     readings and not instrument blindness.
 *   - ⚠️ `timeline`'s bare key is owned by `view:timeline`, whose renderer is
 *     `any`-typed, so a receiver-type sweep alone would have scored it "reads
 *     neither" for the wrong reason. Attributed directly instead: the whole of
 *     `packages/plugin-timeline` contains NO `body` / `children` read, on any
 *     receiver.
 *   - ⚠️ `list`'s renderer read an ITEM-level `body` when this was written
 *     (`item.content || renderChildren(item.body)`) — the ITEM channel, filed
 *     under `ListItem` and not under `ListSchema`, the same shape as `tabs`.
 *     objectui#9590 has since retired that item-level `body` (both renderers
 *     draw `content` only, and both item faces refuse `body` by name). A LIVE
 *     CONTROL below keeps the item channel, `content`, parsing.
 *   - ⛔ `button` stays out, and the reason CHANGED under re-derivation.
 *     `check:registry-bare-names` reports `ui:button` as the sole owner of the
 *     bare key — but that owner's renderer reads
 *     `schema.label || renderChildren(schema.body || schema.children)`, a LIVE
 *     `body || children` fallback. `button` is therefore family C, not family D:
 *     removing a live read is a behaviour change, and AGENTS.md #0.1 says the
 *     fallback itself is the defect. That pulls the other way, and it is the
 *     maintainer's call on objectui#8284. The `UIActionSchema` arm has nothing
 *     to tombstone at all — it does not extend `BaseSchema` and carries only
 *     `bodyExtra` / `bodyShape`, the prefix keys grep confuses for the channel.
 *     A LIVE CONTROL below keeps `button` parsing both channels.
 *   - `InputSchema` is narrowed, but NOT in this file. It was held out here while
 *     `InputShorthandSchema` inherited from it through a plain `Omit`, which
 *     collapsed into `BaseSchema`'s index signature: a tombstone on `input`
 *     reached neither the `email` nor the `password` face. objectui#9256's E3
 *     slice re-spelled that heritage as `OmitDeclared` and narrowed the two
 *     shorthand faces (`content-channel-e3-residual-9256.test.ts`); its `input`
 *     slice then narrowed `input` itself, measured to read neither channel
 *     (`content-channel-input-9256.test.ts`).
 *   - `AppComponentSchema`: it declares the `app` type literal, and `app` is
 *     served by `PageNodeSchema`, which reads BOTH channels — family C, with the
 *     maintainer.
 *   - `DetailViewSchema` is narrowed, but NOT in this file. The `detail-view`
 *     registration's `any`-typed hop hands the node to `DetailView`, typed
 *     `DetailViewSchema`, whose `SchemaRenderer` calls render sub-keys (`header`,
 *     `footer`, a tab's `content`) and never the node's own channel. The E3 slice
 *     attributed those reads directly and narrowed it there
 *     (`content-channel-e3-residual-9256.test.ts`).
 *   - the `body` channel of the three chatbot faces: the parity ledger already
 *     records that key as "two different meanings of one key — a naming
 *     collision to rule on". Their `children` channel is narrowed here, and the
 *     LIVE CONTROL below proves `body` still parses there.
 *     ⚠️ AMENDED (objectui#8572): that ruling has since been made and it reaches
 *     ONE of the three faces — `ChatbotSchema`'s own `body`, whose disposition is
 *     that card's to state and ⛔ is not restated here. The hold-out this card
 *     recorded still stands on the two TWIN faces, so both controls below are
 *     RE-POINTED at a twin rather than inverted; what this card asserts — that it
 *     narrowed `children` on the chatbot faces and left their `body` alone — is
 *     unmoved.
 *     ⚠️ AMENDED AGAIN (objectui#9256, public-block slice): the hold-out on the
 *     two TWIN faces has ended too, and not by a decision on this card —
 *     objectui#6771 retired `body` on `BaseSchema`, so each twin now declares
 *     the same neither-channel tombstone on `body` that its `children` carries,
 *     pointing at `requestBody`. `body` is REFUSED on all three chatbot faces
 *     today; the two controls below assert that refusal (the mirror control)
 *     and its compile-time twin, and neither proves `body` parses anywhere.
 *
 * ## ⚠️ Half of this file is a COMPILE-TIME assertion and vitest CANNOT read it
 *
 * `?: never` narrowings are erased before a test runs. The `@ts-expect-error`
 * lines in the last block are read by `tsc -p tsconfig.test.json` (the
 * `type-check` script), NOT by this runner: under vitest alone, deleting a
 * tombstone from the TypeScript face leaves every case here GREEN. Both readers
 * are the gate; either one alone reports NOT MEASURED.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  SeparatorSchema as SeparatorMirror,
  ResizableSchema as ResizableMirror,
  TextSchema as TextMirror,
  ImageSchema as ImageMirror,
  IconSchema as IconMirror,
  TabsSchema as TabsMirror,
} from '../zod/layout.zod';
import {
  ListSchema as ListMirror,
  TimelineSchema as TimelineMirror,
  HtmlSchema as HtmlMirror,
  AvatarSchema as AvatarMirror,
  TreeViewSchema as TreeViewMirror,
  StatisticSchema as StatisticMirror,
  KbdSchema as KbdMirror,
  TableSchema as TableMirror,
  DataTableSchema as DataTableMirror,
} from '../zod/data-display.zod';
import {
  ButtonGroupSchema as ButtonGroupMirror,
  PaginationSchema as PaginationMirror,
  NavigationMenuSchema as NavigationMenuMirror,
  HeaderBarSchema as HeaderBarMirror,
  BreadcrumbSchema as BreadcrumbMirror,
} from '../zod/navigation.zod';
import {
  LabelSchema as LabelMirror,
  TextareaSchema as TextareaMirror,
  CheckboxSchema as CheckboxMirror,
  SwitchSchema as SwitchMirror,
  SelectSchema as SelectMirror,
  RadioGroupSchema as RadioGroupMirror,
  SliderSchema as SliderMirror,
  InputOTPSchema as InputOTPMirror,
  DatePickerSchema as DatePickerMirror,
  FileUploadSchema as FileUploadMirror,
  ComboboxSchema as ComboboxMirror,
  CommandSchema as CommandMirror,
  CalendarSchema as CalendarMirror,
  UiCalendarSchema as UiCalendarMirror,
  ButtonSchema as ButtonFamilyCControl,
} from '../zod/form.zod';
import {
  ProgressSchema as ProgressMirror,
  SkeletonSchema as SkeletonMirror,
  ToasterSchema as ToasterMirror,
  LoadingSchema as LoadingMirror,
  ToastSchema as ToastMirror,
  SpinnerSchema as SpinnerMirror,
  EmptySchema as EmptyMirror,
  SonnerSchema as SonnerMirror,
} from '../zod/feedback.zod';
import {
  DialogSchema as DialogMirror,
  SheetSchema as SheetMirror,
  PopoverSchema as PopoverMirror,
  AlertDialogSchema as AlertDialogMirror,
  DrawerSchema as DrawerMirror,
  HoverCardSchema as HoverCardMirror,
  DropdownMenuSchema as DropdownMenuMirror,
  ContextMenuSchema as ContextMenuMirror,
  MenubarSchema as MenubarMirror,
} from '../zod/overlay.zod';
import {
  CollapsibleSchema as CollapsibleMirror,
  ToggleGroupSchema as ToggleGroupMirror,
  AccordionSchema as AccordionMirror,
} from '../zod/disclosure.zod';
import {
  CarouselSchema as CarouselMirror,
  FilterBuilderSchema as FilterBuilderMirror,
  CalendarViewSchema as CalendarViewMirror,
  ChatbotSchema as ChatbotMirror,
  ChatbotEnhancedSchema as ChatbotEnhancedMirror,
  ChatbotFloatingSchema as ChatbotFloatingMirror,
  DashboardComponentSchema as DashboardComponentMirror,
} from '../zod/complex.zod';
import {
  ObjectDataTableSchema as ObjectDataTableMirror,
  ObjectGallerySchema as ObjectGalleryMirror,
} from '../zod/objectql.zod';
import {
  ReportViewerSchema as ReportViewerMirror,
} from '../zod/reports.zod';
import {
  ViewSwitcherSchema as ViewSwitcherMirror,
  FilterUISchema as FilterUIMirror,
  SortUISchema as SortUIMirror,
} from '../zod/views.zod';
import { AnyComponentSchema } from '../zod/index.zod';
import type { CollapsibleSchema } from '../disclosure';
import type { DialogSchema } from '../overlay';
import type { SeparatorSchema } from '../layout';
import type { CheckboxSchema } from '../form';
import type { KbdSchema, PivotTableSchema, ListSchema, TimelineSchema } from '../data-display';
import type { SkeletonSchema } from '../feedback';
import type { PaginationSchema } from '../navigation';
import type { ObjectGallerySchema } from '../objectql';
import type { CarouselSchema, ChatbotSchema, ChatbotEnhancedSchema } from '../complex';
import type { ReportViewerSchema } from '../reports';
import type { ViewSwitcherSchema } from '../views';
import type { NLQuerySchema } from '../ai';
import type { TextSchema, ImageSchema, IconSchema, TabsSchema } from '../layout';
import type { AccordionSchema } from '../disclosure';
import type { CalendarSchema } from '../form';

type Mirror = {
  safeParse: (v: unknown) => { success: boolean; error?: z.ZodError };
  shape: Record<string, { description?: string } | undefined>;
};

/**
 * One row of family D: the registered `type`, its mirror, the channels
 * tombstoned on it, and the node's OTHER required members — `table` requires
 * `columns` and `data`, so a bare `{ type: 'table' }` is refused for a reason
 * that has nothing to do with this change and would read here as a false
 * positive. Both channels are dead on every row except the three chatbot faces,
 * whose `body` is held out (see the header).
 */
const ROWS: ReadonlyArray<readonly [
  type: string, mirror: Mirror, dead: ReadonlyArray<'body' | 'children'>, required: Record<string, unknown>,
]> = [
  ['separator', SeparatorMirror as unknown as Mirror, ['body', 'children'], {}],
  ['html', HtmlMirror as unknown as Mirror, ['body', 'children'], {"html":"x"}],
  ['button-group', ButtonGroupMirror as unknown as Mirror, ['body', 'children'], {}],
  ['pagination', PaginationMirror as unknown as Mirror, ['body', 'children'], {"totalPages":1}],
  ['navigation-menu', NavigationMenuMirror as unknown as Mirror, ['body', 'children'], {}],
  ['label', LabelMirror as unknown as Mirror, ['body', 'children'], {}],
  ['textarea', TextareaMirror as unknown as Mirror, ['body', 'children'], {}],
  ['checkbox', CheckboxMirror as unknown as Mirror, ['body', 'children'], {}],
  ['switch', SwitchMirror as unknown as Mirror, ['body', 'children'], {}],
  ['select', SelectMirror as unknown as Mirror, ['body', 'children'], {"options":[]}],
  ['radio-group', RadioGroupMirror as unknown as Mirror, ['body', 'children'], {"options":[]}],
  ['slider', SliderMirror as unknown as Mirror, ['body', 'children'], {}],
  ['input-otp', InputOTPMirror as unknown as Mirror, ['body', 'children'], {}],
  ['date-picker', DatePickerMirror as unknown as Mirror, ['body', 'children'], {}],
  ['file-upload', FileUploadMirror as unknown as Mirror, ['body', 'children'], {}],
  ['combobox', ComboboxMirror as unknown as Mirror, ['body', 'children'], {"options":[]}],
  ['command', CommandMirror as unknown as Mirror, ['body', 'children'], {"groups":[]}],
  ['header-bar', HeaderBarMirror as unknown as Mirror, ['body', 'children'], {}],
  ['avatar', AvatarMirror as unknown as Mirror, ['body', 'children'], {}],
  ['tree-view', TreeViewMirror as unknown as Mirror, ['body', 'children'], {}],
  ['statistic', StatisticMirror as unknown as Mirror, ['body', 'children'], {"value":1}],
  ['breadcrumb', BreadcrumbMirror as unknown as Mirror, ['body', 'children'], {"items":[]}],
  ['kbd', KbdMirror as unknown as Mirror, ['body', 'children'], {}],
  ['progress', ProgressMirror as unknown as Mirror, ['body', 'children'], {}],
  ['skeleton', SkeletonMirror as unknown as Mirror, ['body', 'children'], {}],
  ['toaster', ToasterMirror as unknown as Mirror, ['body', 'children'], {}],
  ['loading', LoadingMirror as unknown as Mirror, ['body', 'children'], {}],
  ['toast', ToastMirror as unknown as Mirror, ['body', 'children'], {}],
  ['spinner', SpinnerMirror as unknown as Mirror, ['body', 'children'], {}],
  ['empty', EmptyMirror as unknown as Mirror, ['body', 'children'], {}],
  ['sonner', SonnerMirror as unknown as Mirror, ['body', 'children'], {}],
  ['dialog', DialogMirror as unknown as Mirror, ['body', 'children'], {}],
  ['sheet', SheetMirror as unknown as Mirror, ['body', 'children'], {}],
  ['popover', PopoverMirror as unknown as Mirror, ['body', 'children'], {"content":{"type":"text"},"trigger":{"type":"button"}}],
  ['alert-dialog', AlertDialogMirror as unknown as Mirror, ['body', 'children'], {}],
  ['drawer', DrawerMirror as unknown as Mirror, ['body', 'children'], {}],
  ['hover-card', HoverCardMirror as unknown as Mirror, ['body', 'children'], {"content":{"type":"text"},"trigger":{"type":"button"}}],
  ['dropdown-menu', DropdownMenuMirror as unknown as Mirror, ['body', 'children'], {"items":[],"trigger":{"type":"button"}}],
  ['context-menu', ContextMenuMirror as unknown as Mirror, ['body', 'children'], {"items":[]}],
  ['menubar', MenubarMirror as unknown as Mirror, ['body', 'children'], {}],
  ['collapsible', CollapsibleMirror as unknown as Mirror, ['body', 'children'], {"trigger":{"type":"button"},"content":{"type":"text"}}],
  ['toggle-group', ToggleGroupMirror as unknown as Mirror, ['body', 'children'], {}],
  ['carousel', CarouselMirror as unknown as Mirror, ['body', 'children'], {"items":[]}],
  ['filter-builder', FilterBuilderMirror as unknown as Mirror, ['body', 'children'], {"fields":[]}],
  ['resizable', ResizableMirror as unknown as Mirror, ['body', 'children'], {"panels":[]}],
  ['table', TableMirror as unknown as Mirror, ['body', 'children'], {"data":[],"columns":[]}],
  ['data-table', DataTableMirror as unknown as Mirror, ['body', 'children'], {"data":[],"columns":[]}],
  ['calendar-view', CalendarViewMirror as unknown as Mirror, ['body', 'children'], {}],
  // ⚠️ ONE-SIDED ROW, and ⛔ not a two-sided reading (objectui#9659, carrying a
  // contract-review residual on objectui#9639). The three rows below list `children`
  // only. That no longer means `body` is live on any of them: `body` is REFUSED on all
  // three faces today, for two different reasons.
  //   - PLAIN `chatbot`: ruling A on objectui#8572 retired `ChatbotSchema.body` as an
  //     ADR-0049 tombstone for a DIFFERENT reason than this card's — a naming collision,
  //     not a dead content channel — and objectui#9639 landed it.
  //   - The TWINS `chatbot-enhanced` / `chatbot-floating`: objectui#6771 retired `body`
  //     on `BaseSchema`, so each twin declares the same neither-channel tombstone on
  //     `body` that its `children` carries, pointing at `requestBody`. The LIVE CONTROL
  //     below asserts that refusal on `chatbot-enhanced`.
  // Re-measured in the objectui#9256 public-block slice: `body` is REFUSED on
  // `chatbot`, `chatbot-enhanced` and `chatbot-floating` alike. (This comment used to
  // say `body` was ACCEPTED on the two twins; that stopped being true when the twins
  // gained their `body` tombstone, and the control below already asserted the refusal.)
  // ⇒ the absence of `body` from these rows means "not this card's row to assert", ⛔ not
  // "still live here". The `body` half of the plain face is pinned by
  // `node-recursion-point-8344.test.ts`, which owns objectui#8572.
  // ⛔ Do not add `'body'` to the plain row to "fix" this: the message that row's
  // assertions read is objectui#9256's, and the plain face's tombstone carries
  // objectui#8572's instead — the row would go red on a true statement.
  ['chatbot', ChatbotMirror as unknown as Mirror, ['children'], {"messages":[]}],
  ['chatbot-enhanced', ChatbotEnhancedMirror as unknown as Mirror, ['children'], {"messages":[]}],
  ['chatbot-floating', ChatbotFloatingMirror as unknown as Mirror, ['children'], {"messages":[]}],
  ['dashboard', DashboardComponentMirror as unknown as Mirror, ['body', 'children'], {"widgets":[]}],
  ['object-data-table', ObjectDataTableMirror as unknown as Mirror, ['body', 'children'], {}],
  ['object-gallery', ObjectGalleryMirror as unknown as Mirror, ['body', 'children'], {}],
  ['report-viewer', ReportViewerMirror as unknown as Mirror, ['body', 'children'], {}],
  ['view-switcher', ViewSwitcherMirror as unknown as Mirror, ['body', 'children'], {"views":[]}],
  ['filter-ui', FilterUIMirror as unknown as Mirror, ['body', 'children'], {"filters":[]}],
  ['sort-ui', SortUIMirror as unknown as Mirror, ['body', 'children'], {"fields":[]}],
  // ── objectui#9256 slice 2 — six of the nine bare-name hold-outs ─────────
  // Each name's owner is MEASURED (`pnpm check:registry-bare-names --table`,
  // objectui#9264) rather than guessed, which is the whole reason these six
  // could move while `list`, `timeline`, `input` and `app-schema-renderer`
  // could not. `ui:calendar` rides along because its mirror is a `.extend()` of
  // `calendar`'s, which this row pins rather than assumes. Its TypeScript face
  // inherits through `OmitDeclared` since objectui#9256's E3 slice (a plain
  // `Omit` until then, which carried no member), and that half is pinned in
  // `content-channel-e3-residual-9256.test.ts`.
  ['text', TextMirror as unknown as Mirror, ['body', 'children'], {}],
  ['image', ImageMirror as unknown as Mirror, ['body', 'children'], {"src":"/a.png"}],
  ['icon', IconMirror as unknown as Mirror, ['body', 'children'], {"icon":"check"}],
  ['tabs', TabsMirror as unknown as Mirror, ['body', 'children'], {"items":[]}],
  ['accordion', AccordionMirror as unknown as Mirror, ['body', 'children'], {"items":[]}],
  ['calendar', CalendarMirror as unknown as Mirror, ['body', 'children'], {}],
  ['ui:calendar', UiCalendarMirror as unknown as Mirror, ['body', 'children'], {}],
  // ── objectui#9256 slice 3 — the two names a SERIAL constraint held back ──
  // Readership re-derived for both rather than inherited from the slice that
  // held them; ownership is a different question and licenses nothing here.
  ['list', ListMirror as unknown as Mirror, ['body', 'children'], {"items":[]}],
  ['timeline', TimelineMirror as unknown as Mirror, ['body', 'children'], {}],
];

const CONTENT: TextSchema[] = [{ type: 'text', content: 'measured' }];
const issues = (m: Mirror, doc: unknown) => {
  const r = m.safeParse(doc);
  return r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};
const CASES = ROWS.flatMap(([type, mirror, dead, required]) =>
  dead.map((key) => [`${type}.${key}`, mirror, key, required] as const));

/* ── (a) the dead channels are REFUSED BY NAME, at the key's own path ─────── */

describe('objectui#9256 — family D refuses the content channels its renderers never read', () => {
  it('the population is the measured one — a row dropped from the table fails here', () => {
    expect(ROWS).toHaveLength(67);
    // 3 fewer than 2x: the chatbot faces carry `children` only.
    expect(CASES).toHaveLength(67 * 2 - 3);
  });

  it.each(CASES)('%s is refused at that key\'s own path', (_label, mirror, key, required) => {
    const found = issues(mirror, { ...required, type: ROWS.find((r) => r[1] === mirror)![0], [key]: CONTENT });
    expect(found, `${_label} parsed green — the tombstone is not installed`).not.toBeNull();
    expect(found!.some((i) => i.path === key && i.code === 'invalid_type')).toBe(true);
  });

  it.each(CASES)('%s — the message names the key and the card, so the author is told why', (_label, mirror, key, required) => {
    const issue = issues(mirror, { ...required, type: ROWS.find((r) => r[1] === mirror)![0], [key]: CONTENT })!
      .find((i) => i.path === key)!;
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('NEITHER content channel');
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, mirror, key, required) => {
    const issue = issues(mirror, { ...required, type: ROWS.find((r) => r[1] === mirror)![0], [key]: CONTENT })!
      .find((i) => i.path === key)!;
    expect(mirror.shape[key]?.description).toBe(issue.message);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, mirror, key, required) => {
    const type = ROWS.find((r) => r[1] === mirror)![0];
    for (const value of [CONTENT, 'text', 42, null, {}, []]) {
      expect(issues(mirror, { ...required, type, [key]: value })?.some((i) => i.path === key)).toBe(true);
    }
  });
});

/* ── (b) CONTROLS — nothing that rendered before stops parsing ────────────── */

describe('objectui#9256 — CONTROLS: the node itself, and the held-out channel, are untouched', () => {
  it.each(ROWS)('`%s` still parses with its own required members and a `className`', (type, mirror, _dead, required) => {
    expect(issues(mirror, { ...required, type })).toBeNull();
    expect(issues(mirror, { ...required, type, className: 'p-4' })).toBeNull();
  });

  it.each(CASES)('%s — the tombstone is a MEMBER of the mirror shape, so the parity ratchet\'s key sets stay equal', (_label, mirror, key) => {
    expect(Object.keys(mirror.shape)).toContain(key);
  });

  // Named for what it asserts since the objectui#9256 public-block slice: the
  // name used to say the family "still accepts `body`", which the body below has
  // not asserted since the twins gained their `body` tombstone.
  it('LIVE CONTROL — the chatbot twins REFUSE `body` too, pointing the author at `requestBody`', () => {
    // The held-out channel, still held out — RE-POINTED, not inverted, by
    // objectui#8572. This control was aimed at `ChatbotSchema`, whose own `body`
    // the parity ledger recorded as "two different meanings of one key — a naming
    // collision to rule on"; that ruling has since been made and belongs to its
    // own card, ⛔ which is why this line does not restate its verdict here.
    //
    // ⚠️ THE HOLD-OUT ENDED, and not by a decision on this card. It read: the
    // two TWIN faces inherit `body` as the content channel, only their
    // `children` is narrowed here. objectui#6771 retired `body` on `BaseSchema`
    // itself, so there is no content channel left to inherit — and an inherited
    // refusal would have named `children` as the remedy, which is refused on
    // these two as well. Each twin therefore declares the same NEITHER-channel
    // tombstone its `children` already carried, pointing at `requestBody`.
    // ⛔ This is not a narrowing this card chose: the sentence was already
    // asserted here, only the declaration was missing.
    const r = (ChatbotEnhancedMirror as unknown as Mirror)
      .safeParse({ type: 'chatbot-enhanced', messages: [], body: CONTENT });
    expect(r.success).toBe(false);
    const bodyIssue = (r.success ? [] : r.error!.issues).find((i) => i.path.join('.') === 'body');
    expect(bodyIssue?.message).toContain('requestBody');
    // CONTROL — the key an author should write instead still parses.
    expect((ChatbotEnhancedMirror as unknown as Mirror)
      .safeParse({ type: 'chatbot-enhanced', messages: [], requestBody: { model: 'gpt-4' } }).success).toBe(true);
  });

  it('`button` is family C with ONE channel left — the `body` arm was retired, not narrowed away', () => {
    // This line used to read `button` accepts BOTH channels, on the ground that
    // `ui:button` renders `schema.label || renderChildren(schema.body || schema.children)`
    // — a LIVE fallback whose removal was a behaviour change and the
    // maintainer's call. That call was made: objectui#6771's ruling puts the
    // `body` arm of every fallback reader in scope ("single-spelling applies to
    // fallback readers too") and names this expression explicitly. `button` is
    // still family C — it reads a content channel, unlike family D — and the
    // channel it reads is `children`.
    const mirror = ButtonFamilyCControl as unknown as Mirror;
    expect(issues(mirror, { type: 'button', children: CONTENT })).toBeNull();
    expect(issues(mirror, { type: 'button', body: CONTENT })).not.toBeNull();
  });

  it('LIVE CONTROL — the ITEM-level channel is untouched: a `tabs` item still parses `content`', () => {
    // `tabs.tsx` renders each item's `content` — an ITEM key, filed under
    // `TabItem` and not under `TabsSchema`, and `content` is neither of the two
    // node channels the row above refuses. Until objectui#9590 that read fell
    // back to an item-level `body`; an instrument that attributed THAT read to
    // the NODE would have made `tabs` a body reader and this whole row a
    // mistake, so the item channel is pinned as still live.
    expect(issues(TabsMirror as unknown as Mirror, {
      type: 'tabs',
      items: [{ value: 't1', label: 'One', content: CONTENT }],
    })).toBeNull();
  });

  it('LIVE CONTROL — `list`\'s ITEM channel is untouched: an item still parses `content`', () => {
    // `list.tsx` draws each entry from its `content` (`renderChildren(item.content)`)
    // — an ITEM read, filed under `ListItem` and NOT under `ListSchema`, and
    // `content` is neither of the two node channels the row above refuses.
    // Until objectui#9590 that read fell back to an item-level `body`; an
    // instrument that attributed THAT read to the NODE would have made `list` a
    // `body` reader and the row above a mistake, so the item channel is pinned
    // as still live. `content` is the key `ListItemSchema` declares; the row
    // above is about the node's own two keys and touches neither.
    expect(issues(ListMirror as unknown as Mirror, {
      type: 'list',
      items: [{ label: 'One', content: CONTENT }],
    })).toBeNull();
  });

  it('family C still reads a content channel — `div` takes `children`, and only `children`', () => {
    // `div` read `children || body`, a live fallback, and this line used to pin
    // BOTH as accepted so that this card stayed a declaration repair rather than
    // a behaviour change. objectui#6771 made the behaviour change deliberately,
    // under a maintainer ruling, and the distinction this control exists to
    // guard survives it: family C reads a content channel and family D reads
    // none. What changed is how many spellings family C answers to.
    expect(AnyComponentSchema.safeParse({ type: 'div', children: CONTENT }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'div', body: CONTENT }).success).toBe(false);
  });
});

/* ── (c) the refusal reaches NESTED nodes, not only the root ──────────────── */

describe('objectui#9256 — a nested family-D node is refused too', () => {
  it('a `skeleton` authoring `children` INSIDE a `box`\'s `children` is REFUSED', () => {
    const r = AnyComponentSchema.safeParse({
      type: 'box',
      children: [{ type: 'skeleton', children: CONTENT }],
    });
    expect(r.success).toBe(false);
    // The child slot is a `z.union`, so what surfaces is ONE `invalid_union` at
    // `children` carrying objectui#8344's capped message — the nested path and
    // the remedy text are collapsed by that union, not by this change.
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.') })))
      .toEqual([{ code: 'invalid_union', path: 'children' }]);
  });

  it('CONTROL — the same tree with a bare `skeleton` parses', () => {
    expect(AnyComponentSchema.safeParse({
      type: 'box',
      children: [{ type: 'skeleton' }],
    }).success).toBe(true);
  });
});

/* ── (d) the TypeScript face — ⚠️ READ BY `tsc`, NOT BY VITEST ────────────── */

describe('objectui#9256 — the TypeScript face refuses both channels at the AUTHORING site', () => {
  it('the `@ts-expect-error` lines in this block are the assertion; vitest only proves they are reachable', () => {
    // One pair per declaration FILE this card edits, so no edited file is
    // covered by the runtime block alone.
    // @ts-expect-error objectui#9256 — `separator` reads neither channel
    const separatorBody: SeparatorSchema = { type: 'separator', body: CONTENT };
    // @ts-expect-error objectui#9256 — `separator` reads neither channel
    const separatorChildren: SeparatorSchema = { type: 'separator', children: CONTENT };
    // @ts-expect-error objectui#9256 — `kbd` reads neither channel
    const kbdBody: KbdSchema = { type: 'kbd', body: CONTENT };
    // @ts-expect-error objectui#9256 — `skeleton` reads neither channel
    const skeletonChildren: SkeletonSchema = { type: 'skeleton', children: CONTENT };
    // @ts-expect-error objectui#9256 — `checkbox` reads neither channel
    const checkboxBody: CheckboxSchema = { type: 'checkbox', body: CONTENT };
    // @ts-expect-error objectui#9256 — `pagination` reads neither channel
    const paginationChildren: PaginationSchema = { type: 'pagination', totalPages: 1, children: CONTENT };
    // @ts-expect-error objectui#9256 — `dialog` reads `content`, never `children`
    const dialogChildren: DialogSchema = { type: 'dialog', children: CONTENT };
    // @ts-expect-error objectui#9256 — `collapsible` reads `trigger` + `content`
    const collapsibleChildren: CollapsibleSchema = { type: 'collapsible', children: CONTENT };
    // @ts-expect-error objectui#9256 — `carousel` reads neither channel
    const carouselBody: CarouselSchema = { type: 'carousel', items: [], body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-gallery` reads neither channel
    const galleryBody: ObjectGallerySchema = { type: 'object-gallery', body: CONTENT };
    // @ts-expect-error objectui#9256 — `view-switcher` reads neither channel
    const viewSwitcherChildren: ViewSwitcherSchema = { type: 'view-switcher', views: [], children: CONTENT };
    // @ts-expect-error objectui#9256 — `report-viewer` reads neither channel
    const reportBody: ReportViewerSchema = { type: 'report-viewer', body: CONTENT };
    // @ts-expect-error objectui#9256 — `nl-query` reads neither channel (no zod mirror exists; this face is the only gate)
    const nlQueryChildren: NLQuerySchema = { type: 'nl-query', children: CONTENT };
    // @ts-expect-error objectui#9256 — `pivot` reads neither channel (no zod mirror exists; this face is the only gate)
    const pivotBody: PivotTableSchema = { type: 'pivot', body: CONTENT };
    // @ts-expect-error objectui#9256 — `chatbot` reads neither channel; `children` is narrowed, `body` is held out
    const chatbotChildren: ChatbotSchema = { type: 'chatbot', messages: [], children: CONTENT };
    // ── slice 2: the six bare-name hold-outs, one NAMED pair each ─────────
    // @ts-expect-error objectui#9256 — `text` reads `content`, never a content channel
    const textBody: TextSchema = { type: 'text', body: CONTENT };
    // @ts-expect-error objectui#9256 — `text` reads `content`, never a content channel
    const textChildren: TextSchema = { type: 'text', children: CONTENT };
    // @ts-expect-error objectui#9256 — `image` reads `src` / `alt`
    const imageBody: ImageSchema = { type: 'image', src: '/a.png', body: CONTENT };
    // @ts-expect-error objectui#9256 — `image` reads `src` / `alt`
    const imageChildren: ImageSchema = { type: 'image', src: '/a.png', children: CONTENT };
    // @ts-expect-error objectui#9256 — `icon` reads `icon` / `size` / `color`
    const iconBody: IconSchema = { type: 'icon', icon: 'check', body: CONTENT };
    // @ts-expect-error objectui#9256 — `icon` reads `icon` / `size` / `color`
    const iconChildren: IconSchema = { type: 'icon', icon: 'check', children: CONTENT };
    // @ts-expect-error objectui#9256 — `tabs` renders `items[].content`, never the node's own channel
    const tabsBody: TabsSchema = { type: 'tabs', items: [], body: CONTENT };
    // @ts-expect-error objectui#9256 — `tabs` renders `items[].content`, never the node's own channel
    const tabsChildren: TabsSchema = { type: 'tabs', items: [], children: CONTENT };
    // @ts-expect-error objectui#9256 — `accordion` renders `items[].content`, never the node's own channel
    const accordionBody: AccordionSchema = { type: 'accordion', items: [], body: CONTENT };
    // @ts-expect-error objectui#9256 — `accordion` renders `items[].content`, never the node's own channel
    const accordionChildren: AccordionSchema = { type: 'accordion', items: [], children: CONTENT };
    // @ts-expect-error objectui#9256 — `calendar` reads neither channel on either of its two readers
    const calendarBody: CalendarSchema = { type: 'calendar', body: CONTENT };
    // @ts-expect-error objectui#9256 — `calendar` reads neither channel on either of its two readers
    const calendarChildren: CalendarSchema = { type: 'calendar', children: CONTENT };
    // ── slice 3: the two names a SERIAL constraint held back ──────────────
    // @ts-expect-error objectui#9256 — `list` renders `items[]`, never the node's own channel
    const listBody: ListSchema = { type: 'list', items: [], body: CONTENT };
    // @ts-expect-error objectui#9256 — `list` renders `items[]`, never the node's own channel
    const listChildren: ListSchema = { type: 'list', items: [], children: CONTENT };
    // @ts-expect-error objectui#9256 — `timeline` reads neither channel on either of its two readers
    const timelineBody: TimelineSchema = { type: 'timeline', body: CONTENT };
    // @ts-expect-error objectui#9256 — `timeline` reads neither channel on either of its two readers
    const timelineChildren: TimelineSchema = { type: 'timeline', children: CONTENT };
    // `ui:calendar`'s TypeScript face stood here as a TRIPWIRE: its heritage was a
    // plain `Omit` that collapsed into `BaseSchema`'s index signature, so this line
    // compiled. objectui#9256's E3 slice repaired the heritage, the tripwire fired as
    // designed, and the pair it asked for lives with that repair's other pins in
    // `content-channel-e3-residual-9256.test.ts`.

    expect([
      separatorBody, separatorChildren, kbdBody, skeletonChildren, checkboxBody, paginationChildren,
      dialogChildren, collapsibleChildren, carouselBody, galleryBody, viewSwitcherChildren, reportBody,
      nlQueryChildren, pivotBody, chatbotChildren,
      textBody, textChildren, imageBody, imageChildren, iconBody, iconChildren,
      tabsBody, tabsChildren, accordionBody, accordionChildren, calendarBody, calendarChildren,
      listBody, listChildren, timelineBody, timelineChildren,
    ]).toHaveLength(31);
  });

  it('CONTROL — the same nodes WITHOUT a content channel compile (no `@ts-expect-error` here, and `tsc` is the reader)', () => {
    const ok = [
      { type: 'separator' } satisfies SeparatorSchema,
      { type: 'kbd' } satisfies KbdSchema,
      { type: 'skeleton' } satisfies SkeletonSchema,
      { type: 'checkbox' } satisfies CheckboxSchema,
      { type: 'dialog', content: CONTENT } satisfies DialogSchema,
      { type: 'collapsible', trigger: CONTENT, content: CONTENT } satisfies CollapsibleSchema,
      // The ITEM channel of `list`, on the TypeScript face: `ListItem.content`
      // is declared and stays authorable. `tsc` is the reader of this line, and
      // it is what keeps the two `list` rows above a statement about the NODE.
      { type: 'list', items: [{ label: 'One', content: CONTENT }] } satisfies ListSchema,
    ];
    expect(ok).toHaveLength(7);
  });

  it('the chatbot family no longer TYPE-CHECKS with `body` — the held-out channel was retired under it', () => {
    // RE-POINTED by objectui#8572, for the reason spelled out at the mirror
    // control above, and ⛔ deliberately not restating that card's verdict here.
    //
    // ⚠️ INVERTED, and not by a decision on this card. Its claim was: objectui#9256
    // narrowed `children` on the chatbot faces and left their `body` channel
    // alone, `body` arriving from `BaseSchema` as the content channel. objectui#6771
    // retired `body` on `BaseSchema` itself, so there is no content channel left
    // to inherit and each twin now declares the same NEITHER-channel tombstone
    // its `children` sentence already asserted. ⇒ the hold-out ended by the base
    // moving, not by this card re-deciding anything. `tsc`, not vitest, is the
    // reader of both lines below.
    // @ts-expect-error objectui#6771 — `body` is retired; this family authors `requestBody`
    const retired = { type: 'chatbot-enhanced', messages: [], body: CONTENT } satisfies ChatbotEnhancedSchema;
    // CONTROL — the key an author should write instead still compiles, so the
    // line above is a reading about `body` and not about the whole declaration.
    const live = {
      type: 'chatbot-enhanced',
      messages: [],
      requestBody: { model: 'gpt-4' },
    } satisfies ChatbotEnhancedSchema;
    expect([retired.type, live.type]).toEqual(['chatbot-enhanced', 'chatbot-enhanced']);
  });
});
