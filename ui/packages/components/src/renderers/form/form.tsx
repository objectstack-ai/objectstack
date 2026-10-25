/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, resolveFieldRuleState, evalFieldPredicate, resolveCascadingOptions, resolveDependsOnFields, CASCADE_OPTION_WIDGET_TYPES, EXPANDABLE_FIELD_TYPES, isValueStillOffered, isMissingForRequired, isServerOwnedValue } from '@object-ui/core';
import type { FormSchema, FormField as FormFieldConfig, FormFieldTab, FormFieldPane, FieldCondition, SelectOption } from '@object-ui/types';
import { useForm } from 'react-hook-form';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '../../ui/form';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Checkbox } from '../../ui/checkbox';
import { Switch } from '../../ui/switch';
import { 
  Select, 
  SelectTrigger, 
  SelectValue, 
  SelectContent, 
  SelectItem 
} from '../../ui/select';
import { renderChildren } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';
import { toControlValue, matchOptionValue, type OptionValue } from './option-value';
import { RHF_RECOGNIZED_RULE_KEYS } from './validationRuleKeys';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../../custom/resizable';
import { Alert, AlertDescription } from '../../ui/alert';
import { toast } from '../../ui/sonner';
import { AlertCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
// The fullscreen long-text affordance, dialog and draft/commit state machine
// (objectui#3398). The icons and the `Dialog` family that used to be imported
// here belonged to the hand-written copy this branch no longer carries.
import { FullscreenEditor } from '../../custom/fullscreen-editor';
// The character counter both long-text render paths render (objectui#3439).
// Hoisted here from `@object-ui/fields` for the same measured reason, and in
// the same direction, as `FullscreenEditor` above (objectui#3398 / PR #4193):
// `fields` depends on `components`, never the reverse.
import { CharacterCount } from '../../custom/character-count';
import { cn } from '../../lib/utils';
import React from 'react';
import { SchemaRendererContext, usePredicateScope, isPermissionError, extractWriteErrorMessage, extractFieldErrors, declaredUserMessage } from '@object-ui/react';
import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Whether a `section-divider` row draws anything: a heading, a blurb, or both.
 * A row with neither (a headingless section's gate row) renders nothing and
 * exists only to carry its section's predicate and membership claim. Read by
 * `SectionDivider` and by `splitAtUntitledRuns`, so the row that is drawn and
 * the heading a block is split under are one answer.
 */
function dividerDrawsRow(label: unknown, description: unknown): boolean {
  return Boolean(label) || Boolean(description);
}

/**
 * Is this row a `section-divider` whose `visibleWhen` is FAIL-CLOSED?
 * (objectui#13055)
 *
 * A divider's `visibleWhen` is its section's layout gate, and two origins put a
 * predicate there that `@objectstack/spec` gives OPPOSITE fault directions: a
 * field group's (`ObjectFieldGroupSchema.visibleWhen` — "else hidden
 * (fail-closed)") and an authored form-view section's own
 * (`FormSectionSchema.visibleWhen`, which faults open). The slot cannot tell
 * them apart, so the producer says which: `visibleWhenFault: 'hidden'`, stamped
 * by the field-group derivation and carried by every layout
 * (`FormField.visibleWhenFault`). Every other row — a field's own
 * `visibleWhen` (the ADR-0137 D3 triad) and an unstamped divider — keeps the
 * fail-open answer of `resolveFieldRuleState`.
 *
 * A fail-closed gate is taken OFF the triad call (its `visibleWhen` is passed
 * as absent there) and evaluated by {@link sectionGateVisible} instead, at
 * every site that judges a divider, so the one-time warning — deduped per
 * predicate text, first site wins — always names `false` as the default.
 */
function isFailClosedSectionGate(f: unknown): boolean {
  const row = f as { type?: unknown; visibleWhenFault?: unknown; visibleWhen?: unknown } | null | undefined;
  return row?.type === 'section-divider' && row.visibleWhenFault === 'hidden' && row.visibleWhen != null;
}

/** The locator the fail-closed gate's warning prints; one spelling for every site. */
function failClosedGateContext(kind: string, key: string): string {
  return `visibleWhen of field group ${kind} '${key}' — fail-closed, the group is hidden`;
}

/**
 * The verdict of a fail-closed section gate ({@link isFailClosedSectionGate}):
 * the predicate's own answer when it evaluates, `false` (hidden) when it
 * faults. Same engine, record assembly and scope as the triad call it replaces.
 */
function sectionGateVisible(
  f: { name?: string; visibleWhen?: unknown },
  record: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  scope: Record<string, unknown> | undefined,
): boolean {
  return evalFieldPredicate(
    f.visibleWhen as Parameters<typeof evalFieldPredicate>[0],
    record,
    false,
    previous,
    scope,
    { context: failClosedGateContext('section', String(f.name)) },
  );
}

/** Inline section header rendered as a virtual field inside a flat SchemaRenderer field list.
 *  Collapsibility is controlled externally (collapsed state lives in DrawerForm). */
function SectionDivider({ label, description, collapsible, collapsed, onToggle, className }: {
  label?: string;
  description?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  if (!dividerDrawsRow(label, description)) return null;
  // objectui#13220 — a collapsible row is a disclosure control a keyboard can
  // operate: a tab stop (`tabIndex`) that Enter and Space toggle, as the record
  // detail page's section header is (objectui#12625). Before this it carried
  // `role="button"` and `aria-expanded` with an `onClick` only, so the Tab
  // cycle stepped over it and a collapsed group could not be opened without a
  // mouse. `preventDefault` keeps Space from scrolling the dialog; a held key's
  // auto-repeat does not toggle the group back and forth. A plain heading stays
  // a plain row: no role, no tab stop. There is no `aria-controls`: the group's
  // fields are siblings of this row in the form's field grid, with no element
  // of their own to point at, and a collapsed group's fields are not mounted.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) onToggle?.();
  };
  return (
    <div
      className={cn(
        'col-span-full pt-4 pb-1 border-b border-border',
        collapsible &&
          'cursor-pointer select-none ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      onClick={collapsible ? onToggle : undefined}
      onKeyDown={collapsible ? handleKeyDown : undefined}
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? !collapsed : undefined}
    >
      {label && (
        <div className="flex items-center gap-1.5">
          {collapsible && (
            collapsed
              ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
      )}
      {/* A section's authored blurb. Carried on the divider because a sectioned
          form is ONE form with inline headers — there is no per-section wrapper
          left to render it (see FormSchema.fieldTabs / objectui#2959). */}
      {description && (
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** Field name → config, first declaration wins. */
function indexFieldsByName(fields: FormFieldConfig[]): Map<string, FormFieldConfig> {
  const byName = new Map<string, FormFieldConfig>();
  for (const f of fields) if (f?.name && !byName.has(f.name)) byName.set(f.name, f);
  return byName;
}

/**
 * The form's fields that no layout group claimed. `fieldTabs` / `fieldPanes` are
 * authored against field NAMES, so a field the author forgot to mention must
 * still render (above the group) instead of silently disappearing.
 */
function unclaimedFields(
  groups: Array<{ fields: FormFieldConfig[] }>,
  fields: FormFieldConfig[],
): FormFieldConfig[] {
  const claimed = new Set<string>();
  for (const group of groups) for (const f of group.fields) claimed.add(f.name);
  return fields.filter((f) => f?.name && !claimed.has(f.name));
}

/**
 * The classes that set an untitled block off from the section above it
 * (objectui#11777) — a boundary on the block's own container, ⛔ never a row.
 * Applied only when something above the block was drawn, so a form whose
 * titled sections are all hidden does not open on a stray rule.
 */
const UNTITLED_BLOCK_CLASS = 'mt-4 border-t border-border pt-4';

/**
 * Split a sectioned field list into the blocks its field grid is drawn in —
 * objectui#11777.
 *
 * A sectioned form is ONE form whose section headings are inline
 * `section-divider` rows. Every row used to share one field grid, so the fields
 * of an UNTITLED section — `@objectstack/spec`'s trailing ungrouped bucket
 * (`deriveFieldGroupLayout`, ADR-0085 §5), which by the one row rule
 * (objectui#9849, director ruling letter E: a row exists iff
 * `title || description`) draws no row of its own — flowed on under the
 * previous section's heading, into the same grid row, and read as its members.
 *
 * The heading already says where its section ends: its membership claim
 * (`fields`, objectui#6236) names the section's members. A field the claim of
 * the heading above it does not name is, by that declaration, not under that
 * heading, so the grid is split there and the untitled run opens a block of its
 * own. A row that draws nothing (a headingless section's gate row) is not under
 * the heading above it either, and opens a block the same way. ⛔ Nothing is
 * added for the untitled run: no row, no heading, no placeholder title — the
 * block boundary is the whole separation.
 *
 * One block, the DOM this form drew before #11777, whenever no field sits
 * under a heading that does not claim it: a flat form, titled sections only,
 * and untitled fields that come BEFORE the first heading. A heading WITHOUT a
 * claim keeps the pre-#6236 contract and is read as heading everything up to
 * the next heading, so it never splits.
 */
function splitAtUntitledRuns(fields: FormFieldConfig[]): FormFieldConfig[][] {
  const blocks: FormFieldConfig[][] = [[]];
  // The claim of the heading the current block's tail sits under: `null` when
  // there is none (no heading yet, or an untitled block is open), `'all'` for a
  // heading that carries no claim.
  let heading: ReadonlySet<string> | 'all' | null = null;
  for (const f of fields) {
    const isDivider = f?.type === 'section-divider';
    if (isDivider && dividerDrawsRow(f.label, f.description)) {
      const claim = f.fields;
      heading = Array.isArray(claim) && claim.length > 0 ? new Set(claim) : 'all';
      blocks[blocks.length - 1].push(f);
      continue;
    }
    const underHeading = heading === 'all' || (heading !== null && !isDivider && heading.has(f?.name));
    if (heading !== null && !underHeading) {
      blocks.push([]);
      heading = null;
    }
    blocks[blocks.length - 1].push(f);
  }
  return blocks;
}

/**
 * Pane sizes in the JSON protocol are percentages (spec `splitSize`). react-resizable-panels
 * documents a NUMERIC size as pixels and an unsuffixed STRING as a percentage —
 * in practice v4 resolves both the same way, but the string says which unit we
 * mean, so the intent survives a library change.
 */
const panePercent = (size: number | undefined): string | undefined =>
  typeof size === 'number' && Number.isFinite(size) ? String(size) : undefined;

/**
 * Breakpoint ladder, narrowest first. Shared by the container-query family
 * (`@md:`) and the viewport family (`md:`) — the two never appear in the same
 * container class, but ordering both off one list keeps the walk in
 * {@link spanLadderFor} deterministic regardless of the order the prefixes
 * happen to be written in.
 */
const SPAN_BREAKPOINTS = ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'] as const;

/**
 * Every col-span class {@link spanLadderFor} can emit, written out as a
 * literal. ⛔ Never build one with a template string: Tailwind's scanner reads
 * source text, so a computed class is scanned out and the utility silently
 * does not exist in the built CSS.
 *
 * Keyed `<prefix>:<span>`, exhaustive over the prefixes the tier regex matches
 * × the spans a form field can take (2-4). Exhaustive on purpose: the previous
 * table was partial, and its `||` fallback answered an unmapped key with a
 * BARE `col-span-N` — the one answer that must never be given under a
 * single-column base tier, because CSS grid then synthesizes an implicit
 * track. A missing key now yields no class at all, which under-spans (visibly
 * wrong, recoverable) instead of distorting every column width.
 */
const SPAN_CLASS: Record<string, string> = {
  '@sm:2': '@sm:col-span-2', '@sm:3': '@sm:col-span-3', '@sm:4': '@sm:col-span-4',
  '@md:2': '@md:col-span-2', '@md:3': '@md:col-span-3', '@md:4': '@md:col-span-4',
  '@lg:2': '@lg:col-span-2', '@lg:3': '@lg:col-span-3', '@lg:4': '@lg:col-span-4',
  '@xl:2': '@xl:col-span-2', '@xl:3': '@xl:col-span-3', '@xl:4': '@xl:col-span-4',
  '@2xl:2': '@2xl:col-span-2', '@2xl:3': '@2xl:col-span-3', '@2xl:4': '@2xl:col-span-4',
  '@3xl:2': '@3xl:col-span-2', '@3xl:3': '@3xl:col-span-3', '@3xl:4': '@3xl:col-span-4',
  '@4xl:2': '@4xl:col-span-2', '@4xl:3': '@4xl:col-span-3', '@4xl:4': '@4xl:col-span-4',
  '@5xl:2': '@5xl:col-span-2', '@5xl:3': '@5xl:col-span-3', '@5xl:4': '@5xl:col-span-4',
  '@6xl:2': '@6xl:col-span-2', '@6xl:3': '@6xl:col-span-3', '@6xl:4': '@6xl:col-span-4',
  '@7xl:2': '@7xl:col-span-2', '@7xl:3': '@7xl:col-span-3', '@7xl:4': '@7xl:col-span-4',
  'sm:2': 'sm:col-span-2', 'sm:3': 'sm:col-span-3', 'sm:4': 'sm:col-span-4',
  'md:2': 'md:col-span-2', 'md:3': 'md:col-span-3', 'md:4': 'md:col-span-4',
  'lg:2': 'lg:col-span-2', 'lg:3': 'lg:col-span-3', 'lg:4': 'lg:col-span-4',
  'xl:2': 'xl:col-span-2', 'xl:3': 'xl:col-span-3', 'xl:4': 'xl:col-span-4',
  '2xl:2': '2xl:col-span-2', '2xl:3': '2xl:col-span-3', '2xl:4': '2xl:col-span-4',
  '3xl:2': '3xl:col-span-2', '3xl:3': '3xl:col-span-3', '3xl:4': '3xl:col-span-4',
  '4xl:2': '4xl:col-span-2', '4xl:3': '4xl:col-span-3', '4xl:4': '4xl:col-span-4',
  '5xl:2': '5xl:col-span-2', '5xl:3': '5xl:col-span-3', '5xl:4': '5xl:col-span-4',
  '6xl:2': '6xl:col-span-2', '6xl:3': '6xl:col-span-3', '6xl:4': '6xl:col-span-4',
  '7xl:2': '7xl:col-span-2', '7xl:3': '7xl:col-span-3', '7xl:4': '7xl:col-span-4',
};

/** Bare (unprefixed) col-span, for a container that is multi-column at every width. */
const BARE_SPAN_CLASS: Record<number, string> = {
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
};

/**
 * The tier class of a 12-track field container — one column below `@md`,
 * twelve tracks from `@md` up. `@object-ui/plugin-form` draws a sectioned form
 * on it when the sections' `columns` counts do not all fit one 1–4 grid
 * (objectui#12548), and a field's `colSpan` there is in TWELFTHS of the row.
 *
 * ⛔ Kept a whole literal: it is also what puts the utility into this
 * package's published `style.css`, whose Tailwind scan reads only this
 * package's source.
 */
const TWELVE_TRACK_TIER = '@md:grid-cols-12';

const isTwelveTrackContainer = (containerClass: string): boolean =>
  containerClass.split(/\s+/).includes(TWELVE_TRACK_TIER);

/**
 * The col-span classes of a twelfths `colSpan` on a {@link TWELVE_TRACK_TIER} container.
 *
 * A share of the row that a 1–4 column count yields (12 / 6 / 4 / 3, and the
 * 8 and 9 an authored `colSpan` of 2 of 3 or 3 of 4 yields) keeps the step
 * ladder the 1–4 container classes give that count: at most two fields per row
 * at `@md`, three at `@2xl`, four at `@4xl` — the tiers of
 * `grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4`. So a
 * 3-column section reads two per row at `@md` and three from `@2xl`, exactly as
 * it does on its own grid. A share reduces to lowest terms `k / d` and draws
 * `min(k, p) / p` of the row at a tier allowing `p = min(d, tier)` per row.
 * Other twelfths are no 1–4 count's share and are drawn as written.
 *
 * Every tier earns a class from `@md`, because the base tier is one column and
 * the twelve-track tiers have no cell narrower than a twelfth to fall back to.
 *
 * ⛔ Literals, never assembled: Tailwind's scanner reads source text.
 */
const TWELVE_TRACK_SPAN_CLASS: Record<number, string> = {
  1: '@md:col-span-1',
  2: '@md:col-span-2',
  3: '@md:col-span-6 @2xl:col-span-4 @4xl:col-span-3',
  4: '@md:col-span-6 @2xl:col-span-4',
  5: '@md:col-span-5',
  6: '@md:col-span-6',
  7: '@md:col-span-7',
  8: '@md:col-span-12 @2xl:col-span-8',
  9: '@md:col-span-12 @4xl:col-span-9',
  10: '@md:col-span-10',
  11: '@md:col-span-11',
  12: '@md:col-span-12',
};

/** {@link TWELVE_TRACK_SPAN_CLASS} for a field's `colSpan`; none set ⇒ one track, as the grid draws it. */
function twelveTrackSpanClass(colSpan: number | undefined): string {
  if (!colSpan || !(colSpan >= 1)) return '';
  return TWELVE_TRACK_SPAN_CLASS[Math.min(Math.floor(colSpan), 12)];
}

/**
 * The col-span classes a field must carry to occupy `targetCols` cells of
 * `containerClass` — ONE CLASS PER TIER, not one class for the widest tier
 * (`bd0995738`).
 *
 * The form's column count is resolved per tier, by container queries on the
 * field container (`grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3` is three
 * different column counts on one screen). `@objectstack/spec`'s `FormField.
 * span` declares `'full'` as «whole row at ANY column count», so a whole-row
 * field needs a span at every tier where the grid is multi-column. Emitting
 * only the widest tier's class satisfies the declaration at the widest tier
 * and nowhere else: at `@md` the field takes 1 of 2 cells, which is
 * pixel-identical to authoring nothing at all (measured in Chromium at 285px
 * of a 586px grid — objectstack#17328).
 *
 * ⚠️ The prefixing itself is deliberate and stays. A bare `col-span-2` while
 * the grid is still `grid-cols-1` makes CSS grid synthesize an implicit second
 * track and distorts every column width, so a tier only gets a class once that
 * tier actually has the columns to give.
 *
 * The walk: tiers narrowest-first, each wanting `min(tierCols, targetCols)`
 * cells, skipping any tier whose want is not an INCREASE. Tailwind prefixes
 * are min-width, so a class emitted at `@md` is still in force at `@2xl`;
 * re-emitting the same span there would be dead weight in the class attribute
 * and in the generated CSS. That skip is also what keeps `colSpan: 2` in a
 * 3-column container at exactly `@md:col-span-2`, unchanged by this card.
 *
 * ⭐ `plugin-detail`'s `getResponsiveSpanClass` has always returned this ladder
 * for the viewport family (`md:col-span-2 lg:col-span-3 xl:col-span-4`); it
 * hard-codes that ladder, while this derives the tiers from the container
 * class and therefore also covers the container-query family.
 */
function spanLadderFor(containerClass: string, targetCols: number): string {
  const re = /(@)?(sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl):grid-cols-(\d+)/g;
  const tiers = Array.from(containerClass.matchAll(re))
    .map((m) => ({ at: m[1] || '', bp: m[2], cols: Number(m[3]) }))
    .sort(
      (a, b) =>
        SPAN_BREAKPOINTS.indexOf(a.bp as (typeof SPAN_BREAKPOINTS)[number]) -
        SPAN_BREAKPOINTS.indexOf(b.bp as (typeof SPAN_BREAKPOINTS)[number]),
    );
  if (!tiers.length) {
    // No responsive/container prefix found — the bare class is safe because
    // the grid is already multi-column at all widths.
    return BARE_SPAN_CLASS[Math.min(Math.max(targetCols, 2), 4)];
  }
  const ladder: string[] = [];
  // The base tier of every container this renderer builds is one column, so a
  // tier only earns a class once it can give MORE than the one cell the field
  // already occupies.
  let spanned = 1;
  for (const tier of tiers) {
    const want = Math.min(tier.cols, targetCols);
    if (want <= spanned) continue;
    const cls = SPAN_CLASS[`${tier.at}${tier.bp}:${want}`];
    if (!cls) continue;
    ladder.push(cls);
    spanned = want;
  }
  return ladder.join(' ');
}

const useSafeFormTranslation = createSafeTranslation(
  {
    'common.selectOption': 'Select an option',
    // objectui#3272 — the action bar's button copy when the schema authored no
    // `submitLabel` / `cancelLabel`. Deliberately the SHARED `common.*` keys
    // rather than new `form.*` twins: "Submit" and "Cancel" are the same words
    // the rest of the console already ships in ten packs, and a second copy of
    // a one-word string is exactly the drift #3231/#3263 had to undo. The
    // defaults here are byte-identical to the English literals they replaced,
    // so a form with no I18nProvider renders what it always did.
    'common.submit': 'Submit',
    'common.cancel': 'Cancel',
    // objectui#3272 — the fullscreen long-text editor (`mobile_fullscreen`).
    // A whole dialog, not a word: title, its sr-only description, the footer's
    // confirm button, and the trigger's accessible name. `Cancel` in the footer
    // reuses `common.cancel` above for the same reason.
    'form.fullscreen.title': 'Edit text',
    'form.fullscreen.description': 'Edit the full text value, then save or cancel your changes.',
    'form.fullscreen.done': 'Done',
    // The trigger's accessible name keeps the literal's shape —
    // `Edit ${label ?? 'text'} fullscreen` — as ONE sentence with a
    // TRANSLATED generic noun standing in for a missing label. The obvious
    // alternative (a second, label-less sentence key) would ship dead in all
    // ten packs: `label` is destructured off the field config before
    // `...fieldProps`, so the only caller never forwards it and the labelled
    // limb is unreachable today (filed separately). Interpolating a
    // translated noun keeps BOTH keys on the live path while leaving the
    // limb's fate to that issue.
    'form.fullscreen.toggle': 'Edit {{label}} fullscreen',
    'form.fullscreen.textFallback': 'text',
    // objectui#3231 — the dependency-gate sentence (#2284). Shared with the
    // option widgets' own fallback so both sides render one wording.
    'fields.options.selectFirst': 'Select {{fields}} first',
    // objectui#3263 — the built-in `select` branch's own empty copy. Same key
    // as the option widgets' fallback (`packages/fields`), so an empty option
    // list reads identically whichever render path produced it. The default
    // here is what a form with no I18nProvider renders — byte-identical to the
    // English literal this replaced.
    'fields.options.empty': 'No options available',
    'validation.required': '{{field}} is required',
    'validation.minLength': '{{field}} must be at least {{min}} characters',
    'validation.maxLength': '{{field}} must be at most {{max}} characters',
    'validation.min': '{{field}} must be at least {{min}}',
    'validation.max': '{{field}} must be at most {{max}}',
    'validation.pattern': '{{field}} format is invalid',
    'validation.email': 'Please enter a valid email address',
    'validation.url': 'Please enter a valid URL',
    'validation.formInvalid': 'Please check the highlighted fields: {{fields}}',
    // objectstack#5407 — the joiner between the field names is a LOCALE
    // property, not a code constant. It used to be a hardcoded `、` (U+3001),
    // which is right for zh/ja and wrong everywhere else — including `en`,
    // where the toast read "Subject、Account、Status". A locale that ships no
    // entry falls back through i18next to `en`'s ", ".
    'validation.formInvalidJoiner': ', ',
    'errors.forbidden': 'Access denied.',
    'form.noPermissionToSave': "You don't have permission to save this record.",
    'form.submitFailed': 'Could not save. Please try again.',
    'form.clearedOnHide': 'Cleared — no longer applicable given the current values: {{fields}}',
    // objectui#8069 — the submit refusal for a field `visibleWhen` that could
    // not be evaluated (see `handleSubmit`). Byte-identical to the `en` pack.
    'form.visibleWhenFaulted':
      "Can't submit: the visibleWhen rule of {{fields}} could not be evaluated. The rule must be fixed before this form can be submitted.",
    // objectui#12108 — the hint under an empty field the server fills at insert
    // (see `renderFieldDescription`). Byte-identical to the `en` pack.
    'form.serverDefaultHint': 'Set automatically when saved.',
  },
  'common.selectOption',
);

// --- Dirty detection -------------------------------------------------------
// react-hook-form's `isDirty` compares current values against `defaultValues`
// by strict identity, which produces false positives on a freshly opened form:
// several field widgets normalize their empty state on mount (e.g. '' -> null,
// undefined -> '', a cleared lookup -> null), and `null !== undefined` makes
// RHF flag an untouched create form as dirty. That made the discard-guard pop
// its "unsaved changes?" prompt even when the user typed nothing. We instead
// compute dirtiness ourselves with a comparison that treats all empty-ish
// values as equivalent, so only a genuine edit (empty <-> meaningful, or one
// meaningful value -> another) counts.
const isEmptyish = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0);

const valuesEqualForDirty = (a: unknown, b: unknown): boolean => {
  if (isEmptyish(a) && isEmptyish(b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
};

/** Own-property test — a field can legitimately be named `constructor`. */
const hasOwn = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o ?? {}, k);

const computeDirty = (
  baseline: Record<string, unknown>,
  values: Record<string, unknown>,
): boolean => {
  const keys = new Set([
    ...Object.keys(baseline ?? {}),
    ...Object.keys(values ?? {}),
  ]);
  for (const k of keys) {
    if (!valuesEqualForDirty(baseline?.[k], values?.[k])) return true;
  }
  return false;
};

/**
 * Widget types that render a two-state control, whose empty state IS `false`
 * (see the `defaultValues` seeding below). Covers the bare builtin spellings
 * and the registry ids `mapFieldTypeToFormType` produces for the object-schema
 * `boolean` / `toggle` types (both → `field:boolean`).
 */
const BOOLEAN_WIDGET_TYPES = new Set([
  'checkbox', 'switch', 'boolean', 'toggle',
  'field:boolean', 'field:switch', 'field:checkbox',
]);

/**
 * Which control a field row will render as — the same precedence
 * `resolvedType` applies further down (explicit form-config `widget`, then the
 * resolved field metadata's own widget hint, then the bare `type`), each
 * widget hint taken only when it can render (see {@link resolveRenderableWidget}).
 */
const resolveWidgetType = (f: any): string =>
  resolveRenderableWidget(f?.type, f?.widget, f?.field?.widget);

/**
 * The first widget hint that can render, else `type` — objectui#12110 item 2.
 *
 * `@objectstack/spec`'s `FieldSchema.widget` names "a registered field
 * component (resolved as `field:<widget>`)" and promises that it "Degrades to
 * the `type` renderer when unregistered". This renderer used to take the hint
 * whether or not anything could draw it, so a `rating` field declaring
 * `widget: 'star_rating'` — a name nothing registers — fell past the registered
 * `field:rating` widget to the default branch's plain text box (finding A-03
 * of the HotCRM browser pass).
 *
 * The hints are tried in precedence order (the form config's, then the field
 * metadata's), so an unrenderable form-level override falls back to the
 * object's own hint before it falls back to the type.
 */
function resolveRenderableWidget(type: string, ...hints: unknown[]): string {
  for (const hint of hints) {
    if (typeof hint === 'string' && hint !== '' && widgetRendersAsItself(hint)) return hint;
  }
  return type;
}

/**
 * Does `renderFieldComponent` have a deliberate rendering for this widget NAME?
 *
 *  - a built-in control (`input`, `textarea`, …) — a `switch` arm;
 *  - a registered field widget, resolved exactly as `renderFieldComponent`
 *    resolves it ({@link resolvesToRegisteredFieldWidget});
 *  - one of the `default` arm's own declared inputs: a native email / password
 *    input ({@link NATIVE_INPUT_FIELD_TYPES}) or the secret refusal
 *    ({@link SECRET_FIELD_TYPES}). These are kept on purpose: degrading a
 *    secret-declaring hint to its field's `type` could put the value on screen
 *    as clear text, the one degrade objectui#5322 rules out.
 *
 * Anything else names a component nothing draws, and the spec's degrade
 * applies.
 */
function widgetRendersAsItself(widget: string): boolean {
  if (BUILTIN_FIELD_TYPES.has(widget)) return true;
  if (resolvesToRegisteredFieldWidget(widget)) return true;
  const declared = normalizeFieldType(widget);
  return hasOwn(NATIVE_INPUT_FIELD_TYPES, widget)
    || hasOwn(NATIVE_INPUT_FIELD_TYPES, declared)
    || SECRET_FIELD_TYPES.has(declared);
}

const BUILTIN_FIELD_TYPES = new Set(['input', 'textarea', 'checkbox', 'switch', 'select']);

/**
 * Built-in types whose `multiple: true` form is a DIFFERENT registered widget
 * (objectui#11116).
 *
 * `select` is a {@link BUILTIN_FIELD_TYPES} member, so a hand-authored
 * `{ type: 'select', multiple: true }` used to render the built-in branch of
 * `renderFieldComponent` — `BuiltinSelectControl`, a single-value Radix select
 * that reads `multiple` nowhere. The field declared zero-or-more values and
 * collected one; measured through the real `SchemaRenderer` with
 * `@object-ui/fields` registered, the catalog's `fields-select/multi-select`
 * example drew the SAME single-value combobox with and without the key.
 *
 * The object-bound path never had the defect: `@object-ui/fields`'
 * `mapFieldTypeToFormType` maps `select` + `multiple` to `field:multiselect`
 * (its `MULTI_VALUE_FORM_TYPES` table) before the type reaches this renderer.
 * The hand-authored spelling is routed to that SAME registry id here, so one
 * widget renders a multi-value select on both paths and the submitted value is
 * that widget's array. ⛔ Not a second multi-select inside
 * `BuiltinSelectControl`: the arity lives in the widget id, exactly as the
 * `fields` table documents, so the label association that widget declares
 * (`labelling: 'group'`) and the component that renders cannot disagree.
 *
 * A one-entry copy of that table, on purpose: `@object-ui/components` cannot
 * import `@object-ui/fields` (the dependency runs the other way), and the id is
 * reached through `ComponentRegistry` at render time like every other `field:*`
 * widget. `select` is the only member on both sides; keep them in step.
 *
 * With nothing registered under `field:multiselect` (no `@object-ui/fields`),
 * the routed id takes `renderFieldComponent`'s `default` branch — the answer an
 * object-bound `field:multiselect` gets in that host — rather than falling back
 * to the single-value control that drops the declared arity.
 */
const BUILTIN_MULTI_VALUE_WIDGETS: Readonly<Record<string, string>> = {
  select: 'field:multiselect',
};

/**
 * The widget key a field row renders under, once its declared arity is
 * applied — see {@link BUILTIN_MULTI_VALUE_WIDGETS}. Applied where `resolvedType`
 * is computed, BEFORE any of its readers run: `renderFieldComponent` and its
 * three mirrors (`resolveFieldLabelling`, `resolvesToRegisteredFieldWidget`,
 * `rendersBuiltinSelectEmptyState`) must all see the routed id, or the label
 * would be associated for a single control while a chip group renders.
 *
 * `multiple` is read the way `mapFieldTypeToFormType` reads it (truthy), so the
 * two paths answer the same field the same way.
 */
function applyDeclaredArity(type: string, multiple: unknown): string {
  return multiple && hasOwn(BUILTIN_MULTI_VALUE_WIDGETS, type)
    ? BUILTIN_MULTI_VALUE_WIDGETS[type]
    : type;
}

/**
 * Fields whose unrecognized validation-rule names were already reported, keyed
 * by field name + the sorted offending keys. Module-level for the same reason
 * as `basic/div.tsx`'s `_warnedDeprecations`: `rawFields` is a caller-owned
 * prop, and a schema-driven caller that rebuilds the array per render re-runs
 * the reporting effect every render — a diagnostic that repeats forever gets
 * muted by the very reader the message is written for (objectui#3965 measured
 * ~190 identical notices burying the real errors).
 */
const _reportedUnrecognizedRules = new Set<string>();

/**
 * Report a field's unrecognized validation-rule names ONCE per module load,
 * dev builds only (#5099's "dev-time error" limb — a customer's production
 * console is not the audience).
 *
 * Same shape as `warnDeprecatedOnce` in `basic/div.tsx` / `basic/span.tsx`,
 * and order matters the same way there and here: the production check returns
 * BEFORE the seen-set is marked, so a production render never suppresses the
 * dev notice. The memo includes the offending keys, not just the field name —
 * metadata that grows a NEW bad rule after the first report must still shout.
 */
function reportUnrecognizedRulesOnce(fieldName: string, unrecognized: string[]): void {
  if (process.env.NODE_ENV === 'production') return;
  const memo = `${fieldName}::${[...unrecognized].sort().join(',')}`;
  if (_reportedUnrecognizedRules.has(memo)) return;
  _reportedUnrecognizedRules.add(memo);
  // The message doubles as the fix instruction — it is what an agent
  // iterating on the metadata will read and follow.
  console.error(
    `[object-ui] form field '${fieldName}': validation rule(s) ${unrecognized
      .map((k) => `'${k}'`)
      .join(', ')} are not rules react-hook-form runs — the field renders, but these rules ` +
      `validate NOTHING. Recognized rules: ${[...RHF_RECOGNIZED_RULE_KEYS].join(', ')}. ` +
      `Check the spelling (\`minLength\`, not \`minlength\`); express email/url checks as a ` +
      `\`pattern\` whose \`value\` is a RegExp; and declare \`validation\` as an OBJECT — ` +
      `spreading an array leaves numeric keys that run nothing.`,
  );
}
/**
 * Widget-hint pickers that resolve records / object catalogs and read sibling
 * field values — they need `dataSource` and `dependentValues` threaded exactly
 * like a lookup does, but they are NOT declarable field types: they are reached
 * only through a `widget:` hint (`widgetHintOnly: true` in
 * `app-shell/src/utils/paramValueShape.ts`), so no object schema can produce a
 * field whose `type` is one of them.
 *
 * This is the ONLY form-specific half of the data-source rule; the other half
 * is the shared reference-bearing family — see {@link needsDataSourceWiring}.
 *
 * `capability-multiselect` was listed here until objectui#3308 retired the
 * widget name (ADR-0049 enforce-or-remove): no producer stamped the hint and
 * `field:capability-multiselect` was never registered on the live path, so the
 * entry could never match a resolvable widget.
 */
const DATA_SOURCE_ONLY_WIDGET_TYPES = new Set([
  'object-ref', 'filter-condition', 'recipient-picker',
  // objectui#7611: the registry-name pickers read their catalog through
  // `dataSource.listMetadataItems`.
  'position-ref', 'permission-ref',
]);

/**
 * Whether this widget key receives `dataSource` / `dependentValues` /
 * `dependsOnLabels` — i.e. whether the control it renders has to QUERY records
 * to do its job.
 *
 * The reference-bearing half is not restated here: it is
 * `EXPANDABLE_FIELD_TYPES`, the one relational-field family in
 * `@object-ui/core` that the `$expand` builder and predicate-record projection
 * already read. This renderer held a private copy of it
 * (`DATA_SOURCE_FIELD_TYPES`) until objectui#4790, whose TSDoc on the core side
 * claimed the two "mirror" each other; by then they had drifted apart in both
 * directions — `user` only in core, the three picker names only here — and the
 * gap was live, not theoretical: a `user` field got NONE of the three props.
 * `dataSource` has a `SchemaRendererContext` fallback inside the widget, so the
 * picker limped along; `dependentValues` and `dependsOnLabels` have none, so a
 * dependent user picker was left unscoped AND interpolated raw API names into
 * its "select … first" hint — the very leak objectstack#5407 fixed for lookups.
 *
 * ⚠️ This used to credit `dependentValues` with a context fallback too. The
 * widgets spelled one (`?? ctx.formValues ?? ctx.data`) while
 * `SchemaRendererContextType` declares exactly `dataSource` / `debug` /
 * `debugFlags` / `apiFetch`, so it was unconditionally empty — unsettable, not
 * merely unset — and it has since been retired (objectui#7206). Of the three
 * props above, only `dataSource` is served by the context at all; the other two
 * reach a widget only because this renderer passes them.
 * The widget contract has always named `user` among the types this renderer
 * injects `dataSource` for (`fields/src/widgets/types.ts`).
 *
 * Members are WIDGET keys — `normalizeFieldType` output, the `field:` prefix
 * stripped — and they coincide with the core set's schema-type spellings
 * because `mapFieldTypeToFormType` maps each reference type onto a same-named
 * widget id (`lookup` → `field:lookup`, `user` → `field:user`, …). The one
 * exception is `tree`, which maps to `field:lookup` and so reaches this test as
 * `lookup`; the `tree` member is therefore inert on the object-schema path and
 * matches only a hand-authored `type: 'tree'`. It stays because the core set is
 * defined over SCHEMA types, where `tree` is a real reference type.
 */
function needsDataSourceWiring(widgetType: string): boolean {
  return (
    EXPANDABLE_FIELD_TYPES.has(widgetType) ||
    DATA_SOURCE_ONLY_WIDGET_TYPES.has(widgetType)
  );
}

// Option fields (`select`/`radio`/`multiselect`/`checkboxes`) support per-option
// `visibleWhen` cascading + `dependsOn` gating (#2284/#1583): the widget re-filters
// its OFFERED set against the live form record (`record.country == 'cn'` …). They
// take no `dataSource`, but they DO need the live `dependentValues` record —
// without it a cascading select never sees its controlling field and stays
// permanently gated on the "select the parent first" hint. The set itself is
// `CASCADE_OPTION_WIDGET_TYPES`, imported from `@object-ui/core` above: this
// form, the action dialog and the bulk dialog feed one evaluator and must read
// one allow-table (objectui#4770 — until then each held a private copy).

/**
 * The sibling fields that SCOPE a dependent lookup's candidate query — the
 * parents whose change must clear its selection (objectui#11631). Empty for
 * every field that is not a dependent member of the reference family.
 *
 * Read from exactly the slot the picker scopes by, so this form's clear and the
 * picker's query cannot disagree about which parent moves the scope:
 * `LookupField` (and `UserField`, which delegates to it) takes `dependsOn` from
 * its `field` prop — this renderer hands it `field.field || field` — after
 * unwrapping one nested `field` that carries `reference` or `type`, and it
 * honours only the ARRAY shape the spec declares at field level
 * (`FieldDependsOn`). A bare parent name there scopes nothing, so it moves
 * nothing here either.
 *
 * The family is `EXPANDABLE_FIELD_TYPES` — the set `needsDataSourceWiring`
 * above already feeds `dependentValues` to. ⛔ Not `CASCADE_OPTION_WIDGET_TYPES`:
 * that shared allow-list names the OPTION widgets fed the live record, and its
 * other readers rely on the lookup family not being in it.
 *
 * A field never counts as its own parent: a self-reference would clear the
 * user's pick the moment it was made.
 */
function dependentLookupParents(f: FormFieldConfig | undefined): string[] {
  const name = f?.name;
  if (!f || !name) return [];
  const widget = resolveWidgetType(f);
  if (typeof widget !== 'string' || !EXPANDABLE_FIELD_TYPES.has(normalizeFieldType(widget))) {
    return [];
  }
  const carrier: Record<string, unknown> = f.field || (f as Record<string, unknown>);
  const inner = carrier.field;
  const meta =
    inner !== null && typeof inner === 'object' && ('reference' in inner || 'type' in inner)
      ? (inner as Record<string, unknown>)
      : carrier;
  const declared = meta.dependsOn;
  if (!Array.isArray(declared)) return [];
  return resolveDependsOnFields(declared).filter((parent) => parent !== name);
}

/**
 * The attributes a built-in branch puts on its native control BY NAME, per
 * host element (objectui#12155).
 *
 * The built-in branches used to spread a BLOCKLIST of the entry's leftover
 * keys (`stripRendererOnlyProps`, now gone) onto the control, so any key no
 * entry of that list named reached the DOM. A field-level `defaultValue` was
 * the costly case: the `textarea` branches and the `default` arm drew it in
 * the control, react-hook-form never saw it, and the submit carried no value,
 * so the user saw a value that was not saved (a form's initial values are
 * `FormSchema.defaultValues`, the one spelling). `defaultChecked` checked the
 * Radix checkbox's hidden bubble input while the visible box stayed unchecked.
 * A blocklist cannot be finished, because the set of keys an author may write
 * is open (the objectui#4428 measurement `dom-props.ts` in `@object-ui/core`
 * records), so the branches now take the family's form-control ALLOWLIST,
 * `toFormControlDomProps`, and add only what is listed here.
 *
 * Each key below reached the control through the old spread and has a reader
 * that says so, which is why it is forwarded rather than dropped:
 *
 *  - `min`, `max`, `minLength`, `pattern`, `rows`: `FormField` in
 *    `@object-ui/types` documents each one as put on the built-in branch's
 *    native control, and the `form` docs page lists the first four as the
 *    field's validation keys. The browser enforces them at submit.
 *  - `step`: `FormField` declares it, the spec's number (objectui#12130).
 *    On a number input the `input` and `default` arms resolve it from the
 *    metadata carrier after this spread (`nativeNumberStep`), which decides
 *    whether the input accepts a decimal at all
 *    (`objectFormNumericStep-9574.test.tsx`); this forward is what reaches the
 *    other input types that step, such as `time`.
 *  - `multiple`, `accept`: `ObjectForm` in `@object-ui/plugin-form` writes
 *    them onto the entries it builds for a `file` / `image` field it routes to
 *    the built-in `input`.
 *
 * ⛔ Add a key here only with such a reader. A key nobody documents for the
 * built-in control and no producer writes for it is the open tail this
 * allowlist exists to refuse. `maxLength` is not listed: every branch that
 * caps resolves it by name after the spread (objectui#3439, objectui#5201).
 */
const BUILTIN_HOST_ATTRIBUTES = {
  input: ['min', 'max', 'step', 'minLength', 'pattern', 'multiple', 'accept'],
  textarea: ['rows', 'minLength'],
} as const;

/** The {@link BUILTIN_HOST_ATTRIBUTES} of `host` the entry carries, by name. */
function builtinHostAttributes(
  fieldProps: Record<string, unknown>,
  host: keyof typeof BUILTIN_HOST_ATTRIBUTES,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of BUILTIN_HOST_ATTRIBUTES[host]) {
    if (fieldProps[key] !== undefined) picked[key] = fieldProps[key];
  }
  return picked;
}

/** Serialize a JS value as a CEL literal (string / number / bool / list / null). */
function celLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(celLiteral).join(', ')}]`;
  return JSON.stringify(String(v));
}

/**
 * Translate the legacy `FormField.condition` shape
 * (`{ field, equals?/notEquals?/in? }`) into an equivalent CEL visible-when
 * predicate, so it evaluates on the canonical engine like every other
 * conditional rule (issue #1584 / ADR-0036) instead of a bespoke JSON branch.
 * The present sub-conditions are AND-ed (matching the legacy "hide unless all
 * clauses hold"); returns `null` when there is nothing to gate on.
 */
function legacyConditionToCel(condition: FieldCondition | undefined): string | null {
  if (!condition || !condition.field) return null;
  const ref = `record[${JSON.stringify(condition.field)}]`;
  const clauses: string[] = [];
  if (condition.equals !== undefined) clauses.push(`${ref} == ${celLiteral(condition.equals)}`);
  if (condition.notEquals !== undefined) clauses.push(`${ref} != ${celLiteral(condition.notEquals)}`);
  if (Array.isArray(condition.in)) clauses.push(`${ref} in ${celLiteral(condition.in)}`);
  return clauses.length > 0 ? clauses.join(' && ') : null;
}

function normalizeFieldType(type: string): string {
  return type.startsWith('field:') ? type.slice('field:'.length) : type;
}

/**
 * How this field's label must be associated with what the widget renders
 * (`ComponentMeta.labelling`, objectui#3961) — `'control'` for a labelable
 * element (plain `<label for>`), `'group'` for a composite container or another
 * non-labelable control (`aria-labelledby` by IDREF).
 *
 * The DECLARATION is authoritative; this function only resolves WHOSE
 * declaration applies, and it mirrors `renderFieldComponent`'s resolution
 * exactly so producer and consumer cannot disagree about which component will
 * actually render:
 *
 *  - the builtin test is on the RAW type, exactly as there: a bare `select`
 *    renders the builtin `<Select>` branch and the registry is never consulted,
 *    while a `field:`-qualified `field:select` DOES resolve to the registered
 *    widget. Normalizing before this test would let a widget's declaration
 *    re-address the label of a builtin that renders in its place;
 *  - only then is the `field:` prefix stripped, to the key `getMeta` stores.
 *
 * Anything undeclared — third-party widgets, bare-name SDUI components, an
 * unregistered type — resolves to `'control'`: the single-control path, byte for
 * byte what this renderer emitted before the declaration existed.
 */
function resolveFieldLabelling(type: string): 'control' | 'group' | 'display' {
  if (BUILTIN_FIELD_TYPES.has(type)) return 'control';
  const declared = ComponentRegistry.getMeta(normalizeFieldType(type), 'field')?.labelling;
  return declared === 'group' || declared === 'display' ? declared : 'control';
}

/**
 * Does this type render a REGISTERED FIELD WIDGET (objectui#4788)?
 *
 * Mirrors `renderFieldComponent`'s resolution the same way
 * `resolveFieldLabelling` mirrors it, and for the same reason: the answer
 * decides whether the host wraps the output, so producer and consumer must not
 * be able to disagree about which component actually renders.
 *
 *  - a builtin name is decided on the RAW type and never consults the registry;
 *  - a bare name resolves through the `field:` namespace;
 *  - a colon-qualified type resolves directly, and is a FIELD widget only when
 *    it names the `field` namespace — the bare-name fallback (`alert`, `badge`,
 *    the display `text` widget) implements the universal `schema` contract, not
 *    `FieldWidgetComponentProps`, and is deliberately left alone.
 */
function resolvesToRegisteredFieldWidget(type: string): boolean {
  if (BUILTIN_FIELD_TYPES.has(type)) return false;
  if (type.includes(':')) {
    return type.startsWith('field:') && !!ComponentRegistry.get(type);
  }
  return !!ComponentRegistry.get(`field:${type}`);
}

/**
 * Will this field render {@link BuiltinSelectEmptyState} — the built-in
 * `select` branch's CONTROL-LESS output — objectui#3991?
 *
 * `<FormLabel>` emits `htmlFor={formItemId}` for every field by default, and
 * `for` may only reference a LABELABLE element (`button`, `input`, `meter`,
 * `output`, `progress`, `select`, `textarea`). When the built-in `select`
 * branch's option list resolves empty — unconfigured, or a `dependsOn` gate
 * withholding it (#2284) — the branch returns a `<div>` carrying the status
 * text and NO control at all, so that `for` lands on a `div`. Measured on
 * `origin/main` @ `b6d07df4b`, for `{ name: 'empty', label: 'Empty', type:
 * 'select', options: [] }`:
 *
 * ```
 *   label for="_r_2_-form-item"  ->  ownerTag = DIV
 *   getByLabelText('Empty')      ->  throws "the element associated with this
 *                                    label (<div />) is non-labellable"
 * ```
 *
 * Inert HTML, and a test-side error that reads like a broken renderer when it
 * is a correctly-rendered empty state. The honest output is a label with no
 * `for` and the message beside it: nothing is lost, because nothing was ever
 * associated — there is no focusable control in this state for a name to name.
 *
 * ## Why the answer is knowable HERE, and only here
 *
 * This is the third mirror of `renderFieldComponent`'s resolution, alongside
 * `resolveFieldLabelling` and `resolvesToRegisteredFieldWidget`, and it is a
 * mirror for the same reason: producer and consumer must not be able to
 * disagree about which component actually renders.
 *
 *  - WHICH component: decided on the RAW type against `BUILTIN_FIELD_TYPES`,
 *    exactly as there — a bare `select` renders this branch and the registry is
 *    never consulted, while a `field:`-qualified `field:select` resolves to the
 *    registered widget and never reaches it;
 *  - WHETHER it takes the empty branch: read from `options`, which the call
 *    site passes down as the very argument `renderFieldComponent`'s
 *    `!options || options.length === 0` tests. One expression, two readers.
 *
 * ## ⛔ Deliberately NOT extended to the registered-widget path
 *
 * `@object-ui/fields`' `OptionsEmptyState` was the same FAULT on the
 * `field:select` path — measured there, the `for` dangled instead, pointing at
 * an id no element carried — but it is NOT the same mechanism, so it was never
 * fixable by this predicate:
 *
 *  - the branch belongs to a component `ComponentRegistry` resolves, not to
 *    this file. Any third party may register a `field:select` that renders a
 *    real control for an empty list, and suppressing the `for` on a host-side
 *    GUESS would break the association for a widget that had it right;
 *  - what a widget renders is a widget DECLARATION (`labelling`,
 *    objectui#3961), which is why the three group-labelled option widgets
 *    (`radio` / `checkboxes` / `multiselect`) are already correct in this state
 *    — they publish the label's id and answer with `aria-labelledby`
 *    (objectui#3990 / #4005). Single `select` declares `labelling: 'control'`
 *    and has no such channel; giving it one is a ruling, not a mirror.
 *
 * That half was repaired in the WIDGET, by objectui#8803, and it did not need
 * a ruling after all: `'control'` already promises "the outermost rendered
 * element is a LABELABLE HTML element", and the zero-option branch simply was
 * not keeping that promise. It now renders an `<output>` carrying the host id,
 * so this file's `for` reaches it unchanged — nothing here was extended, and
 * the host still makes no guess about what a registered widget renders.
 */
function rendersBuiltinSelectEmptyState(
  type: string,
  options: readonly unknown[] | undefined,
): boolean {
  if (!BUILTIN_FIELD_TYPES.has(type)) return false;
  if (type !== 'select') return false;
  return !options || options.length === 0;
}

/**
 * The container a registered field widget's replacement-display output is
 * wrapped in, so the field's visible label NAMES and its visible help text
 * DESCRIBES the surface that replaced the control (objectui#4788, maintainer
 * ruling of 2026-08-16 — option E of the measured option set). Reached two
 * ways: a READONLY registered widget (#4788's original gate, unchanged), and —
 * since objectui#4857 — a widget declared `labelling: 'display'`, whose whole
 * surface is such a display in every state (`formula` / `summary` /
 * `auto_number` / `vector`), so the wrapper applies in the editable state too.
 * The `data-slot` keeps its original name: what this container wraps is a
 * read-only display either way, whatever the form's own mode.
 *
 * ## What was broken
 *
 * A widget's readonly branch renders a REPLACEMENT DISPLAY — a `mailto:` anchor,
 * a formatted span, a chip row, a preview table — and returns before its
 * `toDomProps` spread, so not one prop the host handed down reaches an element.
 * Measured on `origin/main` at `1ef236e18`, a real form + bare registration, one
 * field per row, `description` set, counting the elements whose
 * `aria-describedby` names the rendered `<FormDescription>`:
 *
 * ```
 *                       readonly                                      editable
 * text      for=DANGLING hostIdEl=NONE consumers=0    for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * boolean   for=DANGLING hostIdEl=NONE consumers=0    for=RESOLVES-LABELABLE hostIdEl=switch consumers=1
 * email     for=DANGLING hostIdEl=NONE consumers=0    for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * formula   for=DANGLING hostIdEl=NONE consumers=0    for=DANGLING           hostIdEl=NONE   consumers=0
 * …(33 registered non-group-labelled types, every readonly row identical)
 * ```
 *
 * `hostIdEl=NONE` is the load-bearing reading: in the readonly state the
 * `…-form-item` id is on NO element in the document, so the visible label's
 * `for` pointed at nothing and the readonly surface had no accessible name at
 * all. That is a whole step worse than objectui#3990's family, where the label
 * at least published an id nobody consumed.
 *
 * ## Why the host, and not the 33 widgets
 *
 * Every widget-side variant needs each author to remember one more spread, and
 * the measurement showed exactly how such a fix goes silently wrong: an
 * `aria-labelledby` on a role-less `span` / `div` names NOTHING (`generic`
 * prohibits an author name), while `toHaveAccessibleName()` in jsdom answers
 * PASS for it — a ghost fix that ships green tests. Landing the mechanism once,
 * here, makes the 33 current widgets and any future third-party one correct by
 * construction: there is no "remember to spread" entry point left.
 *
 * ## The shape
 *
 * `<FormControl>` is a Radix `Slot`, so it injects the field's `id` /
 * `aria-describedby` / `aria-invalid` into THIS element instead of the widget's
 * root, and the widget below renders exactly the markup it rendered before.
 *
 *  - `role="group"` — the same semantic claim objectui#3990 established for the
 *    seven composite surfaces. It is what makes the name and the description
 *    land at all, and it does not promise the interactivity `textbox` would.
 *  - `aria-labelledby="<labelId> <hostId>"` — the label's id AND this element's
 *    own. `group` is not a name-from-content role, so the self-reference is what
 *    keeps the VALUE in the accessible name: an `email` field reads
 *    `"Email user@example.com"` rather than dropping the address that is the
 *    only thing on screen. (accname §2F: a node reached through
 *    `aria-labelledby` is named from its contents whatever its role.)
 *  - `aria-describedby` — forwarded as the Slot handed it down. A group is a
 *    description carrier under ARIA 1.2 with no focusable control required,
 *    which is the objectui#4005 reasoning applied to a second surface.
 *  - `aria-invalid` — DROPPED. It is control-channel state: it reports what a
 *    user's own editing may do wrong, to the element they would edit. A
 *    readonly display cannot be edited and cannot be made invalid by the person
 *    reading it. Same boundary objectui#3291 / objectui#3318 / objectui#4005
 *    drew, pinned from both sides in the tests.
 *
 * `aria-required` never reaches here at all — it rides the widget props, exactly
 * as before, for the same reason.
 */
type ReadonlyFieldGroupProps = {
  /** The id `<FormLabel>` published in place of its `for`. */
  labelId: string;
  children: React.ReactNode;
  /** Injected by `<FormControl>`'s Slot: the host control id (`…-form-item`). */
  id?: string;
  /** Injected by `<FormControl>`'s Slot: `<FormDescription>` (+ `<FormMessage>`). */
  'aria-describedby'?: string;
  /** Injected by `<FormControl>`'s Slot, and deliberately consumed here — see above. */
  'aria-invalid'?: boolean | 'true' | 'false';
};

const ReadonlyFieldGroup = React.forwardRef<HTMLDivElement, ReadonlyFieldGroupProps>(
  function ReadonlyFieldGroup(
    { labelId, children, id, 'aria-describedby': describedBy, 'aria-invalid': _ariaInvalid },
    ref,
  ) {
    return (
      <div
        ref={ref}
        id={id}
        role="group"
        // The host id is appended to the label IDREF, not substituted for it:
        // the field's name comes first and the rendered value follows. Falls
        // back to the label alone if the Slot ever stops handing down an id,
        // because half a name beats a reference to `"<labelId> undefined"`.
        aria-labelledby={id ? `${labelId} ${id}` : labelId}
        aria-describedby={describedBy}
        // Stable locator for this DOM layer (ADR-0054 C4) so end-to-end specs
        // and CSS have something to select that is not an a11y attribute.
        data-slot="readonly-field-group"
      >
        {children}
      </div>
    );
  },
);
ReadonlyFieldGroup.displayName = 'ReadonlyFieldGroup';

/**
 * Wrap `node` in {@link ReadonlyFieldGroup} when the host resolved a label id
 * for it, and hand it back untouched otherwise — so every field that is NOT a
 * readonly registered widget keeps the exact element tree it had, with
 * `<FormControl>`'s Slot injecting straight into the widget as before.
 */
function withReadonlyHostGroup(labelId: string | undefined, node: React.ReactNode): React.ReactNode {
  if (!labelId) return node;
  return <ReadonlyFieldGroup labelId={labelId}>{node}</ReadonlyFieldGroup>;
}

/**
 * The help line under one field: its authored `description`, and the
 * "set automatically when saved" hint when the caller passes one
 * (objectui#12108).
 *
 * Why the hint exists: a CREATE form leaves a server-owned control EMPTY on
 * purpose. `@object-ui/plugin-form`'s `schemaDefaults.ts` does not seed a CEL
 * envelope or a runtime token (the client cannot evaluate it), and the submit
 * omits the key so the server resolves the declared default at insert. With
 * nothing here the user saw an empty control, or "Select an option", and no
 * sign that a value was coming. The caller decides WHEN; this only draws it.
 *
 * Both go inside the ONE `<FormDescription>`, the field's text first, because
 * `<FormControl>` names that element's id in the control's `aria-describedby`:
 * the hint is announced with the field, and no second element reuses the id.
 * Drawn here, under the control, rather than as a placeholder: a registered
 * widget reads its placeholder off the field metadata, not off the host, and
 * the date, time, boolean and user widgets draw none at all.
 */
function renderFieldDescription(
  description: string | undefined,
  serverDefaultHint: string | undefined,
): React.ReactNode {
  if (!description && !serverDefaultHint) return null;
  return (
    <FormDescription>
      {description}
      {serverDefaultHint && (
        <span className={description ? 'block' : undefined} data-server-default-hint="true">
          {serverDefaultHint}
        </span>
      )}
    </FormDescription>
  );
}

function stripRegisteredFieldProps(type: string, props: RenderFieldProps): RenderFieldProps {
  const {
    dataSource,
    inputType: _inputType,
    showActions: _showActions,
    fieldContainerClass: _fieldContainerClass,
    mobileStickyActions: _mobileStickyActions,
    mobile_fullscreen: _mobileFullscreen,
    dependentValues,
    dependsOnLabels,
    emptyHint,
    // Renderer-only, and deliberately NOT a new key in the widget contract
    // (objectui#3393). The call site started forwarding `label` for the
    // built-in fullscreen dialog; registered widgets must keep receiving
    // exactly what they received before, because `field` is their single
    // metadata carrier since v17 (objectui#3233) and it already carries the
    // label. Adding a second spelling here would give every AI-authored widget
    // two places to read one fact — and, since widgets spread their leftover
    // props onto the control they render, would also drop a `label` attribute
    // onto seven widgets' DOM overnight. Whether the contract SHOULD publish a
    // `label` prop is a separate decision against `FieldWidgetPropsSchema`.
    label: _label,
    // Retired from the widget contract in v17 (objectui#3233): `field` is the
    // single metadata carrier. The strip stays so an authored form field that
    // happens to carry a `schema` key cannot resurrect the second carrier —
    // or spill an object onto the DOM through a widget's `...props` spread.
    schema: _schema,
    ...fieldProps
  } = props;
  const normalizedType = normalizeFieldType(type);

  return {
    ...fieldProps,
    // `dependsOnLabels` rides with `dependentValues`: the widgets that gate on
    // a sibling field's VALUE are exactly the ones that have to NAME that field
    // in the gate hint (objectstack#5407). Stripped for everything else for the
    // same reason `emptyHint` is — an unknown object prop reaching a DOM node
    // through a widget's `...props` spread is a React warning.
    ...(needsDataSourceWiring(normalizedType) ? { dataSource, dependentValues, dependsOnLabels } : {}),
    // The cascade option widgets own the gate hint's presentation, so they get
    // the computed `emptyHint` alongside the live record (objectui#3231). It is
    // stripped by default because every OTHER registered widget spreads its
    // leftover props onto a DOM node, where an unknown `emptyHint` attribute is
    // a React warning — hence an allow-list, not an unconditional pass-through.
    ...(CASCADE_OPTION_WIDGET_TYPES.has(normalizedType) ? { dependentValues, emptyHint } : {}),
  };
}

/**
 * FullscreenTextarea — `<Textarea>` with a top-right "expand" button that
 * opens a fullscreen edit dialog. Mobile UX (round 3) — driven by the form
 * field's `mobile_fullscreen: true` flag (propagated from
 * `ObjectFormSchema.mobile.fullscreenLongText`).
 *
 * The affordance, the dialog and the draft/commit state machine are NOT written
 * here: they are the shared `FullscreenEditor` primitive (objectui#3398). This
 * branch used to carry a second, hand-written copy of the same interaction that
 * `@object-ui/fields` renders for the registered `field:textarea` /
 * `field:markdown` widgets — one form-level setting, two implementations, which
 * drifted exactly as two copies of a state machine do (objectui#3400 on this
 * side, objectui#3402 on the other). The merge direction follows the measured
 * import graph: `fields` depends on `components`, never the reverse, so the
 * primitive lives in `custom/fullscreen-editor.tsx` and both paths render it.
 *
 * What stays here is the part only this branch has: the INLINE textarea, and
 * the editor injected into the dialog body. `readOnly` / `disabled` are still
 * DECLARED props rather than passengers on `rest` (objectui#3400) — the inline
 * control needs them as real attributes, and the primitive needs them to decide
 * the affordance. Their meaning is now defined once, by the primitive:
 * `readOnly` renders no affordance at all, `disabled` leaves an inert one. See
 * `FullscreenEditor`'s own doc comment for why each is gated in more than one
 * place.
 */
function FullscreenTextarea({
  value,
  onChange,
  placeholder,
  className,
  label,
  readOnly,
  disabled,
  error,
  maxLength,
  ...rest
}: {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /**
   * The declared character cap (objectui#3439). DECLARED rather than left to
   * ride `rest`, because it now has THREE readers, not one: the native
   * `maxLength` attribute on each of the two textareas, and the counter that
   * renders beside them. It rode `rest` for as long as the branch's only use
   * of it was the attribute — which is also why the snake_case `max_length`
   * spelling silently did nothing here before objectui#3439 (that spelling is
   * retired since objectui#11070; see the call site).
   */
  maxLength?: number;
  /**
   * The field's validation message (objectui#4824). DECLARED, so it is not a
   * passenger on `rest` — it must not reach the inline `<Textarea>` as a stray
   * `error="…"` attribute, and the primitive needs it by name.
   *
   * Like `label` and `mobile_fullscreen`, it is read off `fieldProps` at the
   * call site: the DOM allowlist (`toFormControlDomProps`) drops `error`,
   * correctly, because the INLINE control gets its `aria-invalid` from
   * `<FormControl>`'s Slot. The DIALOG's control is built from scratch and gets
   * nothing from that Slot, which is the whole of objectui#4824.
   */
  error?: string;
  [key: string]: any;
}) {
  // The inline control's own gate. `readOnly`/`disabled` are real attributes on
  // the `<Textarea>` below, but the attribute alone is not the write path —
  // this is, so it is gated here too. The DIALOG's write-back is gated by the
  // primitive; this function is reused for `onCommit` so the branch keeps a
  // single expression of "may a value leave this control".
  const locked = readOnly === true || disabled === true;
  const safeOnChange = (v: string) => { if (locked) return; onChange?.(v); };

  /**
   * Two description ids off one `useId()` — one per editing surface, exactly as
   * `TextAreaField` mints them (objectui#3417). They cannot be one id: the
   * dialog edits a LOCAL draft, so the moment the user types in it the two
   * surfaces are counting different strings and a shared id would point both
   * textareas at whichever sentence rendered last.
   */
  const instanceId = React.useId();
  const descriptionId = `${instanceId}-charcount`;
  const fullscreenDescriptionId = `${instanceId}-fullscreen-charcount`;

  /**
   * APPENDED, never assigned (objectui#3408's discipline, objectui#3439 here).
   * `<FormControl>` is a Radix Slot and hands this component an
   * `aria-describedby` naming the field's description and error message; it
   * arrives on `rest`. Overwriting it would trade "no cap announced" for "no
   * error announced" — strictly worse, and silent.
   */
  const describedBy =
    [rest['aria-describedby'], maxLength ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="relative">
      <Textarea
        placeholder={placeholder}
        // The right padding reserves room for the expand button; with no button
        // rendered there is nothing to reserve, and the control should look
        // exactly like the plain read-only textarea the non-fullscreen exit
        // renders.
        className={cn(!readOnly && 'pr-10', className)}
        value={value ?? ''}
        onChange={(e) => safeOnChange(e.target.value)}
        {...rest}
        maxLength={maxLength}
        // After the spread so the composed value wins over the raw host one.
        aria-describedby={describedBy}
        readOnly={readOnly}
        disabled={disabled}
      />
      {maxLength ? (
        /*
          The INLINE surface's counter, `announceNearLimit` — the same answer
          `TextAreaField` gives its inline surface (objectui#3417). This is the
          surface the user types into with the rest of the form around them, so
          the near-limit warning is the one thing worth interrupting for, and it
          is threshold-gated and debounced inside the primitive.

          Positioned to clear the expand button when there is one: the button
          occupies the top-right corner, the digits the bottom-right, which is
          why this className is not simply the registered widget's.
        */
        <CharacterCount
          length={(value ?? '').length}
          maxLength={maxLength}
          descriptionId={descriptionId}
          announceNearLimit
          className="absolute bottom-2 right-2 text-xs text-gray-400"
          testId="form-textarea-character-count"
        />
      ) : null}
      <FullscreenEditor
        value={value ?? ''}
        onCommit={safeOnChange}
        label={label}
        // Unchanged ids: `form-textarea-fullscreen-toggle` / `-dialog` /
        // `-save`, distinct from the registered widgets' `textarea-` and
        // `richtext-` namespaces so a test can still say which render path it
        // found.
        testIdPrefix="form-textarea"
        readOnly={readOnly}
        disabled={disabled}
        error={error}
        /*
          The FULLSCREEN surface's counter (objectui#3439), the same slot and
          the same ruling as the registered path's (objectui#3417).

          `announceNearLimit={false}` is a choice about this SURFACE, not a
          saving on effort: a fullscreen modal is opened deliberately to write
          at length, the description below already delivers the cap on focus,
          and the dialog's textarea carries the same native `maxLength` stop. A
          second live region here would also put two of them in one document,
          since the inline counter stays mounted behind the overlay.
        */
        footer={(draft) =>
          maxLength ? (
            <CharacterCount
              length={draft.length}
              maxLength={maxLength}
              descriptionId={fullscreenDescriptionId}
              announceNearLimit={false}
              className="text-xs text-muted-foreground self-center"
              testId="form-textarea-fullscreen-character-count"
            />
          ) : null
        }
      >
        {(draft, setDraft, editorDisabled, editorAria) => (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="h-full min-h-full resize-none text-base"
            disabled={editorDisabled}
            maxLength={maxLength}
            data-testid="form-textarea-fullscreen-input"
            /*
              Name + validation state, computed by the primitive and spread whole
              (objectui#4824 / #4832). This control used to carry neither: no
              `aria-invalid` at all, and an empty accessible name, while the
              inline `<Textarea>` above announced both off `<FormControl>`'s
              Slot. Spread rather than unpacked — this branch is not told which
              ids it names, so it cannot point at the host's `<FormMessage>`,
              which Radix `aria-hidden`s for as long as the dialog is open.
            */
            {...editorAria}
            /*
              Assigned, not appended — and that is a statement about THIS
              element, not a relaxation of the composition rule above. The
              inline control composes because `<FormControl>`'s Slot hands it an
              `aria-describedby`; this one is built here from scratch, the Slot
              never reaches it, and the ids the host would have supplied name
              nodes OUTSIDE the dialog, which Radix `aria-hidden`s while the
              modal is open. There is nothing to preserve. `editorAria` carries
              no `aria-describedby` of its own, so this composes with it rather
              than overwriting it.
            */
            aria-describedby={maxLength ? fullscreenDescriptionId : undefined}
          />
        )}
      </FullscreenEditor>
    </div>
  );
}

/**
 * The built-in (unregistered) `textarea` branch's plain control — objectui#3439.
 *
 * ## What it exists to fix
 *
 * One `maxLength` declaration produced two experiences. The registered
 * `field:textarea` widget has shipped four things since objectui#3406/#3408/
 * #3417 — the native cap, visible `{n}/{max}` digits, a description reached
 * through `aria-describedby` so the limit is announced ON FOCUS, and a
 * threshold-gated debounced near-limit notice — while this branch shipped none
 * of them. Measured on `origin/main`: a screen-reader user on the built-in path
 * learned the cap only as a validation error AFTER submitting, and a sighted
 * user saw no count at all.
 *
 * That is the family this repo has ruled on four times (objectui#3272, #3400,
 * #3402, #3404, and #3398's hoist of the fullscreen editor): one form-level
 * declaration must produce one behaviour on both render paths. The counter is
 * therefore the SAME component the widget renders, hoisted to this package —
 * not a second implementation of it.
 *
 * ## Why a component and not inline JSX in the branch
 *
 * The counter has to sit in a positioned wrapper beside the control, and
 * `<FormControl>` is a Radix `Slot`: it injects the field's `id` /
 * `aria-describedby` / `aria-invalid` into whatever ELEMENT the branch returns.
 * Returning a `<div>` wrapper directly would hand those three to the DIV — the
 * label would point at an id no control carries and the field would lose its
 * accessible name and error link, which is objectui#3976 exactly. A component
 * boundary receives them as props instead, so this one re-addresses them onto
 * the `<textarea>`. Same reason, same mechanism, as `BuiltinSelectControl`
 * below and `FullscreenTextarea` above.
 */
function BuiltinTextarea({
  value,
  placeholder,
  className,
  readOnly,
  maxLength,
  ...rest
}: {
  value?: string;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  /**
   * The declared cap, resolved by the call site rather than left to ride `rest`
   * onto the DOM. Two readers now — the native attribute and the counter — and
   * the call site is where the two authored spellings are reconciled.
   */
  maxLength?: number;
  [key: string]: any;
}) {
  /** One id per control; see `FullscreenTextarea` for why the dialog needs a second. */
  const descriptionId = `${React.useId()}-charcount`;

  /**
   * APPENDED, never assigned. The Slot's `aria-describedby` names the field's
   * description and error message and arrives on `rest`; assigning here would
   * trade "no cap announced" for "no error announced".
   */
  const describedBy =
    [rest['aria-describedby'], maxLength ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  // No counter, no wrapper: an unconditional `<div className="relative">` around
  // every built-in textarea would change the layout of every capless long-text
  // field in the repo to buy nothing. A field that declares no cap renders
  // exactly the element it rendered before this component existed.
  const control = (
    <Textarea
      placeholder={placeholder}
      className={className}
      {...rest}
      maxLength={maxLength}
      // After the spread so the composed value wins over the raw host one.
      aria-describedby={describedBy}
      readOnly={readOnly}
      value={value ?? ''}
    />
  );

  if (!maxLength) return control;

  return (
    <div className="relative">
      {control}
      {/*
        `announceNearLimit` — this is the surface the user types into with the
        rest of the form around them, the same answer the registered widget's
        inline surface gives (objectui#3408/#3417). The gating and the debounce
        live in the primitive, so neither path can drift into its own schedule.
      */}
      <CharacterCount
        length={(value ?? '').length}
        maxLength={maxLength}
        descriptionId={descriptionId}
        announceNearLimit
        className="absolute bottom-2 right-2 text-xs text-gray-400"
        testId="form-textarea-character-count"
      />
    </div>
  );
}

// Form renderer component - Airtable-style feature-complete form
ComponentRegistry.register('form',
  ({ schema, className, onAction, disabled: hostDisabled, ...props }: { schema: FormSchema; className?: string; onAction?: (action: any) => void; disabled?: boolean; [key: string]: any }) => {
    const { t } = useSafeFormTranslation();
    // Prefix for the label ids the GROUP-labelled fields need (objectui#3961).
    // Owned here, not derived from `<FormItem>`'s own `useId()`: that id lives in
    // a context published INSIDE `FormItem`, and this renderer builds the label
    // element as a child of it — one render too early to read it. It is also the
    // reason the fix needs no change to `ui/form.tsx` (AGENTS.md #7 no-touch):
    // `<FormLabel>` spreads its props onto `Label` AFTER its own `htmlFor`, so
    // both halves — give the label an `id`, take its `for` away — travel as
    // ordinary props.
    const labelIdPrefix = React.useId();
    const {
      defaultValues: authoredDefaultValues = {},
      // The persisted record being edited (absent ⇒ this is an insert). Binds
      // `previous` for field-rule CEL and gates the read-only submit strip —
      // see FormSchema.previousValues and the two memos below (objectui#3484).
      previousValues,
      fields: rawFields = [],
      // No English default here — objectui#3272. A literal default made the
      // absence of an authored label indistinguishable from an author who
      // typed "Submit", and froze every un-labelled form's buttons to English
      // in a zh/ja/ar session. The default is now the ABSENCE of a value, and
      // the fallback happens at render through `t()` (see the action bar
      // below), so `submitLabel?: string` staying optional in the spec means
      // exactly what it says: unset = "whatever this session's language calls
      // it". An authored value still wins verbatim, including `''`.
      submitLabel,
      cancelLabel,
      showCancel = false,
      showSubmit = true,
      layout = 'vertical',
      columns = 1,
      onSubmit: onSubmitProp,
      onChange: onChangeProp,
      onDirtyChange: onDirtyChangeProp,
      onCancel: onCancelProp,
      resetOnSubmit = false,
      validationMode = 'onSubmit',
    } = schema;

    // The form-wide enablement verdict, and NOT `schema.disabled` beside it.
    // `SchemaRenderer` evaluates the node's `disabled` / `disabledOn` — either
    // may be a predicate STRING — strips the raw key from the props it spreads,
    // and forwards the answer as a real `disabled` prop. The raw value is truthy
    // HOWEVER it evaluates, so destructuring it off `schema` here greyed out
    // every field, the submit button and the cancel button on any form that
    // authored a predicate — a FALSE verdict included (objectui#7238). One
    // carrier for one question, AGENTS.md #0.1; the precedent is
    // `plugin-chatbot`'s renderer (objectui#6169).
    //
    // `=== true` rather than a truthy read: the verdict channel carries exactly
    // `true` or `undefined` (`disabled: __disabled || undefined`), and the three
    // consumers below OR this into a boolean.
    const disabled = hostDisabled === true;

    // ── Spec-vocabulary boundary (#3090) ──────────────────────────────────
    // `{ field: 'x' }` is the spec form-VIEW vocabulary — a reference to an
    // object field, resolvable only where an object schema exists (the
    // `normalizeSectionField` chokepoint in @object-ui/plugin-form). This
    // standalone renderer's vocabulary is `{ name: 'x' }` (the form data
    // path). Such an entry used to slip past the `f?.name` guards below and
    // reach a react-hook-form Controller with `name === undefined`, crashing
    // the WHOLE form on `name.split('.')` — with nothing saying which entry
    // was to blame. Partition them out and surface them loudly instead.
    const specVocabularyFields = React.useMemo(
      () =>
        (rawFields as any[]).filter(
          (f) => f && typeof f.field === 'string' && typeof f.name !== 'string',
        ),
      [rawFields],
    );
    const fields = React.useMemo(
      () =>
        specVocabularyFields.length === 0
          ? rawFields
          : (rawFields as any[]).filter((f) => !specVocabularyFields.includes(f)),
      [rawFields, specVocabularyFields],
    );
    React.useEffect(() => {
      for (const f of specVocabularyFields) {
        // This message doubles as the fix instruction — it is what an agent
        // iterating on the metadata will read and follow.
        console.error(
          `[object-ui] form field { field: '${f.field}' } was NOT rendered: \`field\` is the spec form-view ` +
            `vocabulary (a reference to an object field), and a standalone form has no object schema to resolve ` +
            `it against. Rename the key to \`name\` (the form data path) — or use an object-bound form ` +
            `(objectName + sections), whose section fields accept the spec shape.`,
        );
      }
      for (const f of rawFields as any[]) {
        if (f && typeof f.field === 'string' && typeof f.name === 'string') {
          console.warn(
            `[object-ui] form field '${f.name}' mixes vocabularies: it also carries { field: '${f.field}' } ` +
              `(spec form-view key), which this standalone renderer ignores. Drop one of the two.`,
          );
        }
      }
    }, [rawFields, specVocabularyFields]);

    // ── Unrecognized validation-rule names fail LOUDLY (#5099) ────────────
    // react-hook-form's field validator destructures a FIXED rule set (see
    // validationRuleKeys.ts, pinned against the installed bundle) and drops
    // every other key without a trace — a misspelled `minlength`, an invented
    // `email`, or the numeric keys left by spreading an ARRAY into
    // `validation` all yield a form that LOOKS validated and runs nothing.
    // `FieldValidationRules` already rejects these at compile time; this
    // catches the metadata that reaches the renderer as plain JSON, where
    // TypeScript never ran. Report-only by design: the maintainer ruling on
    // #5099 explicitly rejected normalizing/compiling at this read point
    // (consumer tolerance, AGENTS.md #0.1) — the fix belongs at the producer.
    // Dev-only and once per field+rule-set: see reportUnrecognizedRulesOnce.
    React.useEffect(() => {
      for (const f of rawFields as any[]) {
        const v = f?.validation;
        if (v == null || typeof v !== 'object') continue;
        const unrecognized = Object.keys(v).filter((k) => !RHF_RECOGNIZED_RULE_KEYS.has(k));
        if (unrecognized.length === 0) continue;
        reportUnrecognizedRulesOnce(String(f?.name), unrecognized);
      }
    }, [rawFields]);

    // The `previous` binding — the persisted record, seeded the same way as
    // `ruleRecord` so a predicate naming a column the read didn't return
    // compares against `null` instead of faulting (objectui#3484). `undefined`
    // when the host supplied no `previousValues`, which is how an INSERT is
    // told apart from an UPDATE: the server exempts inserts from the
    // `readonlyWhen` strip entirely, so the renderer must not invent a
    // `previous` for them.
    const previousRecord = React.useMemo(() => {
      if (!previousValues || typeof previousValues !== 'object') return undefined;
      const out: Record<string, unknown> = {};
      for (const f of fields) if (f?.name) out[f.name] = null;
      for (const k of Object.keys(previousValues)) {
        if (previousValues[k] !== undefined) out[k] = previousValues[k];
      }
      return out;
    }, [fields, previousValues]);

    // Is this an INSERT? Same signal the memo above documents and the read-only
    // strip already gates on: `FormSchema.previousValues` is set by an
    // edit-mode host only, and its ABSENCE is the declared "this is an insert"
    // (objectui#3484). Read once here, above the boolean seed that needs it
    // first, so the seed and the rule-state call sites below cannot each
    // answer the mode differently.
    const isCreateForm = previousRecord === undefined;

    // The same signal decides whether `readonlyWhen` binds (objectui#13436):
    // UPDATE only. objectql exempts INSERT from it entirely, so a create form
    // evaluating it against the seeded defaults (a `defaultValue` the
    // predicate names, an unset column under `!=`) locked fields the server
    // accepts on insert, and the user could not fill a form the API takes.
    // Every `resolveFieldRuleState` call below therefore passes
    // `readonlyWhen: isCreateForm ? undefined : RULE` — the render verdict and
    // the memos that re-evaluate the same rules alike, so none of them warns a
    // fault for a rule the create form never applies. Static `readonly: true`
    // still locks on create; `visibleWhen` / `requiredWhen` are untouched.

    // A two-state control has no third state, so a boolean field that nobody
    // supplied a value for starts at `false` — not `undefined`. Without this
    // the switch renders OFF while the form holds NOTHING: the create payload
    // omits the column (it lands null, which reads as unchecked but isn't),
    // and a `required` boolean is refused as empty while the user is looking
    // at a perfectly valid answer — an AI-built tracker could not create an
    // UNFINISHED task (cloud#972). It has to be folded into `defaultValues`
    // itself, not seeded per-Controller, because this is also the baseline the
    // dirty check and the defaults-reset window below compare against; a value
    // that only lived in the field would be wiped by the first `form.reset`.
    // Callers that DO supply a value (including `null` from a loaded record)
    // are untouched.
    //
    // Nor is a field the server fills on this insert (objectui#12121): a
    // runtime `defaultValue` (a CEL envelope or a runtime token) is the
    // producer's to resolve, and `ObjectQL.applyFieldDefaults` resolves it
    // only for a key that arrives absent or null. A seeded `false` is
    // neither, so it was submitted and the declaration never ran. Left
    // unseeded, the untouched control is empty: `omitServerResolvedDefaults`
    // drops the key from the create payload, and the "set on save" hint and
    // the `required` suppression below read this same `isServerOwnedValue`
    // verdict. A value the user sets, `false` included, is submitted as usual.
    const defaultValues = React.useMemo(() => {
      const seeded: Record<string, unknown> = { ...(authoredDefaultValues as Record<string, unknown>) };
      let added = false;
      for (const f of fields as any[]) {
        if (typeof f?.name !== 'string') continue;
        if (hasOwn(seeded, f.name)) continue;
        if (!BOOLEAN_WIDGET_TYPES.has(resolveWidgetType(f))) continue;
        if (isServerOwnedValue(f, isCreateForm)) continue;
        seeded[f.name] = false;
        added = true;
      }
      return added ? seeded : authoredDefaultValues;
    }, [authoredDefaultValues, fields, isCreateForm]);

    // Initialize react-hook-form. `shouldFocusError: false` because RHF's
    // native focus-on-error only works for fields whose registered ref is a
    // focusable native input — it silently no-ops for custom widgets
    // (lookup / select / master-detail), which is exactly the #2793 case. We
    // own the scroll+focus explicitly in the onInvalid handler below so it
    // works for every field type and follows visual order.
    const form = useForm({
      defaultValues,
      mode: validationMode,
      shouldFocusError: false,
    });

    // Scoped to this form so the error-scroll query never reaches a sibling form.
    const formRef = React.useRef<HTMLFormElement>(null);

    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    /**
     * The sonner id every OUTCOME toast of THIS form is published under.
     *
     * The in-form banner (`submitError`) and its toast are raised together at
     * each of the three points below, but only the banner was ever retired
     * together: the toast went out under sonner's auto-generated id, so nothing
     * here held a handle on it and a refused submit's toast outlived the
     * attempt that raised it. A later SUCCESSFUL submit — whose success toast a
     * host raises (`WizardForm`, `ObjectForm`), not this renderer — then landed
     * BESIDE that stale refusal, and the form ended on a screen asserting both
     * outcomes at once (objectui#7252).
     *
     * One stable id closes both halves. Reusing an id sonner already holds
     * UPDATES that toast rather than stacking a second one, so every outcome
     * this form reports supersedes the one before it; and the dismissal beside
     * `setSubmitError(null)` retires it the moment a new attempt starts, so by
     * the time any host can confirm a success this form's last refusal is gone.
     *
     * Scoped to this form instance (`React.useId()`) on purpose: a blanket
     * `toast.dismiss()` would take unrelated toasts down with it.
     */
    const formInstanceId = React.useId();
    const outcomeToastId = `form-outcome:${formInstanceId}`;
    // Active `fieldTabs` panel. Undefined until something picks one — the
    // effective tab falls back to `defaultFieldTab`, then to the first tab.
    // Which tab of an in-progress form is showing is presentational and dies
    // with the form, so it stays component state (AGENTS.md #8).
    const [pickedFieldTab, setPickedFieldTab] = React.useState<string | undefined>(undefined);
    // Field names the last submit attempt rejected (client rules or server
    // `fields[]`), used to mark the tabs that hold them.
    const [rejectedFieldNames, setRejectedFieldNames] = React.useState<string[]>([]);

    // Live snapshot of all form values — subscribes to every change so
    // field-level CEL rules (visibleWhen/readonlyWhen/requiredWhen) re-evaluate
    // reactively as the user edits. Evaluated below via the canonical
    // `@objectstack/formula` engine (same dialect the server enforces). We seed
    // every declared field name to `null` first so a predicate that references
    // a field react-hook-form hasn't registered yet (e.g. on initial mount,
    // before defaults populate) evaluates against a present-but-null value
    // rather than faulting — mirroring the server, which evaluates over the
    // full merged record.
    const watched = form.watch() as Record<string, unknown>;

    // Global predicate scope (from the host shell's ExpressionProvider) — carries
    // `current_user` (plus the ADR-0068 D1 `user` / `ctx.user` / `os.user` aliases,
    // `data`, `features`) so a `visibleWhen` can gate on role/context in
    // addition to sibling field values. Empty object when no provider is mounted.
    // ⛔ No `app` root: objectui#8155 unbound it (the engine's `SCOPE_ROOTS`
    // never declared one).
    //
    // ⛔ Declared HERE, above `readonlyFieldNames`, and not at its historical spot
    // ~75 lines down (#6010). It used to sit below, which is exactly why the
    // field-rule call sites could not have it: `readonlyFieldNames`' `useMemo`
    // factory runs SYNCHRONOUSLY during this render, so a `predicateScope`
    // declared after it is in the temporal dead zone at that point and reading it
    // there is a `ReferenceError` on the first render, not a missing binding. The
    // hook is still called unconditionally and exactly once per render — only its
    // position among this component's hooks moved, which React does not constrain.
    const predicateScope = usePredicateScope();

    const ruleRecord = React.useMemo(() => {
      // Seed every declared field to `null` so a predicate referencing a field
      // that's absent / not-yet-registered evaluates against a present-null
      // value. The canonical CEL engine throws "No such key" on a *missing*
      // field (which would fail the predicate open), but compares cleanly
      // against `null`. Overlay only DEFINED watched values so an unregistered
      // field (value `undefined`) doesn't clobber its null seed back to missing.
      const out: Record<string, unknown> = {};
      for (const f of fields) if (f?.name) out[f.name] = null;
      // The persisted record sits UNDER the live values, exactly as the server
      // builds its own scope (`merged = { ...previous, ...data }` in objectql's
      // `stripReadonlyWhenFields`). Without it a predicate that names a record
      // column this form does not render evaluates against the `null` seed —
      // or nothing at all — and reaches a different verdict than the server.
      if (previousRecord) {
        for (const k of Object.keys(previousRecord)) out[k] = previousRecord[k];
      }
      for (const k of Object.keys(watched)) if (watched[k] !== undefined) out[k] = watched[k];
      return out;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fields, previousRecord, JSON.stringify(watched)]);

    // Fields this form has resolved to READ-ONLY for the record as it now
    // stands — the exact set an UPDATE must not carry (objectui#3484).
    //
    // react-hook-form keeps a value for every registered field, so an edit form
    // seeded from a full record round-trips the WHOLE record on save, including
    // the fields it just rendered as read-only plain text. The user could not
    // have touched them and the value is the one already in the database, yet
    // the server dutifully strips them (`stripReadonlyWhenFields`) and reports
    // `droppedFields` — which the shell turned into "some fields were not
    // saved" on a save where nothing was even changed. Not sending them is the
    // fix; the warning channel then only fires for a write that really did lose
    // something.
    //
    // Gated on `previousRecord` because the strip this mirrors is UPDATE-ONLY:
    // objectql exempts INSERT from `readonlyWhen` entirely, so dropping keys on
    // create would make the client stricter than the server and silently lose
    // authored defaults.
    const readonlyFieldNames = React.useMemo(() => {
      const locked = new Set<string>();
      if (!previousRecord) return locked;
      for (const f of fields as FormFieldConfig[]) {
        const name = f?.name;
        if (!name) continue;
        const st = resolveFieldRuleState(
          {
            // A fail-closed section gate is judged by `sectionGateVisible`,
            // never by the triad (objectui#13055) — and this memo reads only
            // `readonly`, so it has nothing to evaluate it for.
            visibleWhen: isFailClosedSectionGate(f) ? undefined : (f as any).visibleWhen,
            readonlyWhen: isCreateForm ? undefined : (f as any).readonlyWhen,
            requiredWhen: (f as any).requiredWhen,
          },
          ruleRecord,
          {
            required: !!f.required,
            readonly: (f as any).readonly === true,
            serverOwnedValue: isServerOwnedValue(f, isCreateForm),
          },
          previousRecord,
          predicateScope,
          // Same locator as the render path (objectstack-ai/objectstack#5149). A failure here reports the
          // field, not a bare rule kind; `warnPredicateFailure` dedupes by
          // predicate source, so re-evaluating a rule the renderer already
          // evaluated cannot double-warn.
          `field '${name}'`,
        );
        if (st.readonly) locked.add(name);
      }
      return locked;
    }, [fields, ruleRecord, previousRecord, isCreateForm, predicateScope]);

    // Fields hidden RIGHT NOW by their OWN authored conditional-visibility
    // predicate — `visibleWhen` (canonical, ADR-0089) or its deprecated
    // view-level sibling `visibleOn` (#2212). The pair is one verdict here for
    // the same reason the stale-error effect below already folds them into one:
    // they are two spellings of "this field does not apply to the record as it
    // now stands", and splitting them would give one authored intent two
    // behaviours.
    //
    // Feeds the clear-on-hide effect (`6a449fc49`). Fields declaring NEITHER
    // key are skipped outright, so a form that does not use conditional
    // visibility recomputes nothing and behaves exactly as before.
    //
    // ⛔ Deliberately NOT the union of every reason a field is not drawn. A
    // field claimed by a hidden section (#6236), a field on a hidden tab
    // (#6237) and a statically `hidden` field are all absent from this set:
    // the first two carry the 2026-08-27 maintainer ruling (visibility decides
    // what is DRAWN and nothing else — their values still submit) and the
    // third is not conditional at all, it is how a fixed value is carried into
    // a payload. Re-evaluating the predicates the render path also evaluates
    // cannot double-warn: `warnPredicateFailure` dedupes by predicate source,
    // which `readonlyFieldNames` above already leans on.
    //
    // ── …and the fields whose `visibleWhen` could NOT be evaluated
    // (objectui#8069, ADR-0137 D2 as ruled) ─────────────────────────────────
    // The same `resolveFieldRuleState` call reports them (`faults`), so the
    // submit refusal below reads the verdict this memo already drew and never
    // evaluates a predicate a second time. Every declared field is judged, not
    // only the drawn ones: a faulted `visibleWhen` fails OPEN, so the field is
    // never cleared on hide (`6a449fc49`) and its value reaches the payload
    // whether or not a section or tab happens to hide it — the rule changes
    // the write either way, so the write is refused either way.
    //
    // One exclusion, about WHAT the slot holds rather than about the fault: a
    // `section-divider` row carries its SECTION's predicate in this same
    // `visibleWhen` slot, which is a layout gate and not a field rule. A
    // stored BLANK field rule is a fault like any other (ADR-0137 D2; see
    // `FieldRuleFaults`) and is refused; a new one is refused earlier, at
    // authoring, by the form schema's triad wire.
    const { conditionallyHiddenFieldNames, faultedVisibleWhenFieldNames } = React.useMemo(() => {
      const hidden = new Set<string>();
      const faulted: string[] = [];
      for (const f of fields as FormFieldConfig[]) {
        const name = f?.name;
        if (!name) continue;
        const visibleWhen = (f as any).visibleWhen;
        const visibleOn = (f as any).visibleOn;
        if (visibleWhen == null && visibleOn == null) continue;
        if (visibleWhen != null) {
          // A fail-closed section gate (objectui#13055) is judged off the triad.
          const gate = isFailClosedSectionGate(f);
          const st = resolveFieldRuleState(
            {
              visibleWhen: gate ? undefined : visibleWhen,
              readonlyWhen: isCreateForm ? undefined : (f as any).readonlyWhen,
              requiredWhen: (f as any).requiredWhen,
            },
            ruleRecord,
            {
              required: !!f.required,
              readonly: (f as any).readonly === true,
              serverOwnedValue: isServerOwnedValue(f, isCreateForm),
            },
            previousRecord,
            predicateScope,
            // Same locator the render path uses (objectstack-ai/objectstack#5149), so a faulted
            // predicate is reported once, against the field.
            `field '${name}'`,
          );
          if (st.faults.visibleWhen !== undefined && f.type !== 'section-divider') faulted.push(name);
          if (!st.visible || (gate && !sectionGateVisible(f, ruleRecord, previousRecord, predicateScope))) {
            hidden.add(name);
            continue;
          }
        }
        if (
          visibleOn != null &&
          !evalFieldPredicate(visibleOn, ruleRecord, true, previousRecord, predicateScope, {
            context: `visibleOn of field '${name}'`,
          })
        ) {
          hidden.add(name);
        }
      }
      return { conditionallyHiddenFieldNames: hidden, faultedVisibleWhenFieldNames: faulted };
    }, [fields, ruleRecord, previousRecord, isCreateForm, predicateScope]);

    // ── The section grouping contract (objectui#6236, maintainer ruling
    // 2026-08-27) ─────────────────────────────────────────────────────────────
    // A `section-divider` that CLAIMS its member fields (`fields: string[]` —
    // the membership shape `FormFieldTab.fields` / `FormFieldPane.fields`
    // already model) gates its WHOLE group: when the divider's own visibility
    // verdict is FALSE, `renderFormField` draws neither the heading (the
    // divider's own rule check does that half, pinned by
    // predicate-scope-parity-6010) nor any claimed field (this set does the
    // other half). Hiding a member this way is the SAME mechanism as the
    // field's own false predicate — return `null`, so the Controller unmounts,
    // react-hook-form skips the unmounted field at submit-time validation and
    // keeps its value (`shouldUnregister` stays default-false). That is
    // exactly the ruled semantics, inherited from the field-level precedent
    // (#5594 / #2212) rather than re-implemented: visibility decides what is
    // DRAWN and nothing else — a hidden section's values still submit — and a
    // hidden section's fields skip client-side validation, so a user is never
    // blocked by an error pointing at a control they cannot see (#6110's
    // defect shape). The server-side contract stays the floor for
    // genuinely-required data.
    //
    // The divider's verdict here replicates the FOUR gates `renderFormField`
    // applies to the divider row itself — static `hidden`, the legacy
    // `condition`, `visibleWhen` (via `resolveFieldRuleState`) and `visibleOn`
    // — with the SAME record assembly (`ruleRecord` / `previousRecord` /
    // `predicateScope`), the same fail-open fallbacks and the same locator
    // strings, so heading and group cannot reach different verdicts
    // (`warnPredicateFailure` dedupes by predicate source, so re-evaluating a
    // predicate the render path also evaluates cannot double-warn — the
    // `readonlyFieldNames` memo above already leans on that).
    //
    // A divider WITHOUT a claim keeps the pre-#6236 contract (a presentational
    // row whose predicate gates only the heading); unknown claimed names are
    // ignored (FormFieldTab parity); a field claimed by several dividers hides
    // when ANY hidden claimer names it.
    const hiddenSectionFieldNames = React.useMemo(() => {
      const hiddenNames = new Set<string>();
      for (const f of fields as FormFieldConfig[]) {
        const divider = f as FormFieldConfig & { fields?: unknown };
        if (divider?.type !== 'section-divider') continue;
        const claimed = divider.fields;
        if (!Array.isArray(claimed) || claimed.length === 0) continue;
        const name = divider.name;
        let dividerHidden = !!divider.hidden;
        if (!dividerHidden) {
          const legacyConditionCel = legacyConditionToCel(divider.condition);
          if (
            legacyConditionCel &&
            !evalFieldPredicate(legacyConditionCel, ruleRecord, true, undefined, undefined, {
              context: `condition of field '${name}'`,
            })
          ) {
            dividerHidden = true;
          }
        }
        if (!dividerHidden) {
          // A field group's gate is fail-CLOSED (objectui#13055): a predicate
          // that faults hides the group, header and claimed members, through
          // this same set — so its members behave exactly as under a FALSE
          // verdict (values still submit, validation is skipped).
          const gate = isFailClosedSectionGate(divider);
          const st = resolveFieldRuleState(
            {
              visibleWhen: gate ? undefined : (divider as any).visibleWhen,
              readonlyWhen: isCreateForm ? undefined : (divider as any).readonlyWhen,
              requiredWhen: (divider as any).requiredWhen,
            },
            ruleRecord,
            {
              required: !!divider.required,
              readonly: (divider as any).readonly === true,
              serverOwnedValue: isServerOwnedValue(divider, isCreateForm),
            },
            previousRecord,
            predicateScope,
            `field '${name}'`,
          );
          if (!st.visible) dividerHidden = true;
          else if (gate && !sectionGateVisible(divider, ruleRecord, previousRecord, predicateScope)) dividerHidden = true;
        }
        if (!dividerHidden && (divider as any).visibleOn != null) {
          const viewVisible = evalFieldPredicate(
            (divider as any).visibleOn,
            ruleRecord,
            true,
            previousRecord,
            predicateScope,
            { context: `visibleOn of field '${name}'` },
          );
          if (!viewVisible) dividerHidden = true;
        }
        if (dividerHidden) {
          for (const claimedName of claimed) {
            if (typeof claimedName === 'string') hiddenNames.add(claimedName);
          }
        }
      }
      return hiddenNames;
    }, [fields, ruleRecord, previousRecord, isCreateForm, predicateScope]);

    // --- Tabbed field layout (#2959) ---------------------------------------
    // `fieldTabs` spreads THIS form's fields across tab panels. Crucially there
    // is still exactly ONE <form> / react-hook-form instance: the panels are
    // force-mounted and merely CSS-hidden, so a tab the user navigated away from
    // keeps BOTH its values and its validation. (Rendering one form per tab lost
    // every non-active tab's input — the footer submit button can only be
    // associated with a single form — and unmounting a tab's fields makes
    // react-hook-form skip their rules, which let a required field on a tab
    // nobody opened sail past the client and return as a server 400.)
    //
    // Declared here, above the stale-error effect, because the tab predicate
    // verdicts (#6237, below) join that effect's inputs.
    const fieldTabs = React.useMemo<FormFieldTab[] | null>(() => {
      const declared = schema.fieldTabs;
      if (schema.children || !Array.isArray(declared)) return null;
      const usable = declared.filter((t) => t && typeof t.key === 'string');
      return usable.length > 1 ? usable : null;
    }, [schema.fieldTabs, schema.children]);

    // ── The tabbed arm of the grouping contract (objectui#6237, same
    // maintainer ruling as #6236) ─────────────────────────────────────────────
    // A tab may carry the section predicate (`FormFieldTab.visibleWhen`) the
    // synthesis sites copy from an authored `FormSection.visibleWhen`. The
    // verdict is evaluated HERE, with the same record assembly the field-level
    // rules use (`ruleRecord` / `previousRecord` / `predicateScope`, #6010) and
    // the same fail-open fallback, so a section rendered as a tab and the same
    // section rendered as a divider cannot reach different verdicts.
    //
    // A hidden tab's trigger and panel are simply NOT DRAWN — which unmounts
    // its fields, the exact mechanism a field's own false predicate uses
    // (`return null`): react-hook-form keeps the values (`shouldUnregister`
    // stays default-false), so they still submit, and skips the unmounted
    // controls at submit-time validation. Those are the ruled semantics
    // (visibility gates drawing only; the server stays the loud floor),
    // inherited rather than re-implemented.
    //
    // Deliberately NOT folded into the `fieldTabs` memo above: whether the
    // tabbed arm engages at all (`usable.length > 1`) is judged on the
    // DECLARED tabs, so a predicate hiding one of two tabs filters what is
    // drawn instead of collapsing the strip into the untabbed layout
    // mid-interaction (a collapse would remount every remaining field —
    // destroying focus and in-progress edits — and would draw the hidden
    // tab's fields flat, breaking the ruled semantics).
    const hiddenFieldTabKeys = React.useMemo(() => {
      const hidden = new Set<string>();
      for (const tab of fieldTabs ?? []) {
        const visibleWhen = tab.visibleWhen;
        if (visibleWhen == null) continue;
        // A tab built from a field group carries its fail-closed direction
        // (`FormFieldTab.visibleWhenFault`, objectui#13055); every other tab
        // keeps the fail-open default.
        const failClosed = tab.visibleWhenFault === 'hidden';
        const visible = evalFieldPredicate(
          visibleWhen,
          ruleRecord,
          !failClosed,
          previousRecord,
          predicateScope,
          {
            context: failClosed
              ? failClosedGateContext('tab', tab.key)
              : `visibleWhen of fieldTab '${tab.key}'`,
          },
        );
        if (!visible) hidden.add(tab.key);
      }
      return hidden;
    }, [fieldTabs, ruleRecord, previousRecord, predicateScope]);

    // Field names that are NOT drawn because every tab claiming them is hidden
    // (#6237). A name also claimed by a VISIBLE tab still renders in that
    // panel, so it stays out of this set — the set mirrors what the panels
    // actually draw, and feeds the stale-error hygiene below. (The drawing
    // itself needs no per-field gate: a hidden tab's panel is not rendered.)
    const hiddenTabFieldNames = React.useMemo(() => {
      const hidden = new Set<string>();
      if (!fieldTabs || hiddenFieldTabKeys.size === 0) return hidden;
      for (const tab of fieldTabs) {
        if (!hiddenFieldTabKeys.has(tab.key)) continue;
        for (const name of tab.fields ?? []) {
          if (typeof name === 'string') hidden.add(name);
        }
      }
      for (const tab of fieldTabs) {
        if (hiddenFieldTabKeys.has(tab.key)) continue;
        for (const name of tab.fields ?? []) hidden.delete(name);
      }
      return hidden;
    }, [fieldTabs, hiddenFieldTabKeys]);

    // When a field's CEL rule relaxes — it becomes hidden (visibleWhen FALSE) or
    // no longer required (requiredWhen FALSE) — clear any stale validation error
    // left from a prior submit attempt. react-hook-form keeps an error until the
    // erroring field itself revalidates; without this a "required" message would
    // linger after the condition that imposed it (e.g. status) changed.
    React.useEffect(() => {
      const errs = form.formState.errors as Record<string, unknown>;
      if (!errs || Object.keys(errs).length === 0) return;
      for (const f of fields as FormFieldConfig[]) {
        const name = f?.name;
        if (!name || !errs[name]) continue;
        const st = resolveFieldRuleState(
          {
            visibleWhen: (f as any).visibleWhen,
            readonlyWhen: isCreateForm ? undefined : (f as any).readonlyWhen,
            requiredWhen: (f as any).requiredWhen,
          },
          ruleRecord,
          {
            required: !!f.required,
            readonly: (f as any).readonly === true,
            serverOwnedValue: isServerOwnedValue(f, isCreateForm),
          },
          previousRecord,
          predicateScope,
          `field '${name}'`,
        );
        // View-level FormField.visibleOn hides the field the same way a
        // field-level visibleWhen does (#2212) — fold it into the verdict.
        const viewVisible =
          (f as any).visibleOn == null ||
          evalFieldPredicate((f as any).visibleOn, ruleRecord, true, previousRecord, predicateScope, {
            context: `visibleOn of field '${name}'`,
          });
        // A hidden field shows no errors at all; an un-required field clears
        // only its *required* error (keep legitimate format/min/etc. errors).
        // A field hidden by its SECTION's predicate (#6236) clears the same
        // way a field hidden by its own rule does — same rendering verdict,
        // same stale-error hygiene.
        const errType = (errs[name] as { type?: string } | undefined)?.type;
        if (
          !st.visible ||
          !viewVisible ||
          hiddenSectionFieldNames.has(name) ||
          hiddenTabFieldNames.has(name) ||
          (!st.required && errType === 'required')
        ) {
          form.clearErrors(name);
        }
      }
      // `predicateScope` joins `ruleRecord` here for the same reason it is passed
      // above (#6010): a scope change — the host swapping organisations, so
      // `current_user.positions` changes — can flip a `visibleWhen` to FALSE just
      // as a keystroke can, and a stale required-error on the field it just hid
      // must clear on that transition too.
      // `hiddenSectionFieldNames` joins them (#6236): a section verdict flip is
      // a visibility transition for every claimed field, and the memo can move
      // on a `fields` identity change the two record inputs would miss.
      // `hiddenTabFieldNames` joins for the same reason (#6237): a TAB verdict
      // flip hides every field the tab claims, and its stale errors must clear
      // on that transition exactly as a section flip clears its members'.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ruleRecord, predicateScope, hiddenSectionFieldNames, hiddenTabFieldNames]);

    // Read DataSource from SchemaRendererContext and propagate it to field
    // widgets as a prop so they can dynamically load related records.
    const schemaCtx = React.useContext(SchemaRendererContext);
    const contextDataSource = schemaCtx?.dataSource ?? null;

    // Field name → label, for the "select the parent first" gate hint (#2284).
    const fieldLabelByName = React.useMemo(() => {
      const m: Record<string, string> = {};
      for (const f of fields as FormFieldConfig[]) if (f?.name) m[f.name] = (f as any).label || f.name;
      return m;
    }, [fields]);

    /** Field name → the tab that owns it (first claim wins). */
    const tabKeyByFieldName = React.useMemo(() => {
      const m = new Map<string, string>();
      for (const tab of fieldTabs ?? []) {
        for (const name of tab.fields ?? []) if (!m.has(name)) m.set(name, tab.key);
      }
      return m;
    }, [fieldTabs]);

    // Only VISIBLE tabs are selectable (#6237): a predicate hiding the ACTIVE
    // tab re-selects deterministically — the user's pick if its tab is (still)
    // visible, else the declared default, else the first visible tab — so the
    // form never shows an empty panel. The pick itself is kept: derived
    // selection means a hidden pick simply stops winning, and the tab the user
    // chose becomes active again the moment its predicate re-admits it.
    const activeFieldTab = React.useMemo(() => {
      if (!fieldTabs?.length) return undefined;
      const keys = fieldTabs.map((t) => t.key).filter((k) => !hiddenFieldTabKeys.has(k));
      if (!keys.length) return undefined;
      if (pickedFieldTab && keys.includes(pickedFieldTab)) return pickedFieldTab;
      if (schema.defaultFieldTab && keys.includes(schema.defaultFieldTab)) return schema.defaultFieldTab;
      return keys[0];
    }, [fieldTabs, hiddenFieldTabKeys, pickedFieldTab, schema.defaultFieldTab]);

    // Resolve each tab's declared field names against the form's field list.
    const fieldTabGroups = React.useMemo(() => {
      if (!fieldTabs) return null;
      const byName = indexFieldsByName(fields as FormFieldConfig[]);
      return fieldTabs.map((tab) => ({
        key: tab.key,
        label: tab.label || tab.key,
        description: tab.description,
        containerClass: tab.containerClass,
        fields: (tab.fields ?? [])
          .map((name) => byName.get(name))
          .filter((f): f is FormFieldConfig => Boolean(f)),
      }));
    }, [fieldTabs, fields]);

    // A field no tab claimed must not vanish — it renders above the tab strip,
    // visible from every tab. Computed from the FULL group list on purpose: a
    // predicate-hidden tab (#6237) still CLAIMS its fields — they are hidden
    // with it, not promoted into this leading block.
    const untabbedFields = React.useMemo(
      () => (fieldTabGroups ? unclaimedFields(fieldTabGroups, fields as FormFieldConfig[]) : []),
      [fieldTabGroups, fields],
    );

    // What the strip and the panels actually draw (#6237): the groups whose
    // tab the predicate verdict admits. Not drawing a hidden tab's panel IS
    // the ruled-semantics mechanism — see `hiddenFieldTabKeys`.
    const visibleFieldTabGroups = React.useMemo(
      () =>
        fieldTabGroups
          ? hiddenFieldTabKeys.size === 0
            ? fieldTabGroups
            : fieldTabGroups.filter((g) => !hiddenFieldTabKeys.has(g.key))
          : null,
      [fieldTabGroups, hiddenFieldTabKeys],
    );

    // --- Split field layout (#2153) ----------------------------------------
    // `fieldPanes` places this form's fields in resizable panels. The <form>
    // wraps the whole panel GROUP, so — exactly as with `fieldTabs` — there is
    // still ONE react-hook-form instance behind the split: a submit from either
    // side carries every pane's values, and a rule in one pane can read a field
    // in another. A <form> INSIDE each panel could do neither: its submit saw
    // only its own fields, and its rule record didn't even contain the other
    // pane's names, so a cross-pane predicate faulted and failed open.
    //
    // Tabbed wins if a caller somehow declares both: a form is one or the other.
    const fieldPanes = React.useMemo<FormFieldPane[] | null>(() => {
      const declared = schema.fieldPanes;
      if (schema.children || fieldTabs || !Array.isArray(declared)) return null;
      const usable = declared.filter((p) => p && typeof p.key === 'string');
      return usable.length > 1 ? usable : null;
    }, [schema.fieldPanes, schema.children, fieldTabs]);

    const fieldPaneGroups = React.useMemo(() => {
      if (!fieldPanes) return null;
      const byName = indexFieldsByName(fields as FormFieldConfig[]);
      return fieldPanes.map((pane) => ({
        key: pane.key,
        defaultSize: panePercent(pane.defaultSize),
        minSize: panePercent(pane.minSize) ?? '20',
        containerClass: pane.containerClass,
        fields: (pane.fields ?? [])
          .map((name) => byName.get(name))
          .filter((f): f is FormFieldConfig => Boolean(f)),
      }));
    }, [fieldPanes, fields]);

    // Same guarantee as `untabbedFields`: an unclaimed field renders above the
    // panel group rather than being dropped.
    const unpanedFields = React.useMemo(
      () => (fieldPaneGroups ? unclaimedFields(fieldPaneGroups, fields as FormFieldConfig[]) : []),
      [fieldPaneGroups, fields],
    );

    // Tabs holding a field the LAST submit rejected, so their trigger can carry
    // a marker — otherwise a rejection on a background tab is invisible and the
    // user just sees a submit that does nothing. Fed from `announceFieldErrors`,
    // which covers both referees (client rules and server `fields[]`), and reset
    // when a submit gets past validation. Kept as state rather than derived from
    // `formState.errors` because react-hook-form re-renders the erroring field's
    // own Controller, not necessarily this component.
    const erroredFieldTabs = React.useMemo(() => {
      const out = new Set<string>();
      if (!fieldTabs) return out;
      for (const name of rejectedFieldNames) {
        const key = tabKeyByFieldName.get(name);
        if (key) out.add(key);
      }
      return out;
    }, [fieldTabs, tabKeyByFieldName, rejectedFieldNames]);

    // Cascade clear (#2284): when a select/radio's option list narrows — because a
    // controlling field changed or a role/context predicate flipped — a previously
    // chosen value may no longer be offered. Drop it so the form never submits a
    // stale "china + california" pair. Mirrors the dependent-lookup gate but for
    // static/predicate-driven option sets. Fail-open filtering keeps unrelated
    // fields untouched (no visibleWhen / dependsOn → nothing recomputed).
    // A dependent LOOKUP never reaches this effect — it has no static option
    // set to test a value against — and is cleared by its own rule further
    // down, beside the `defaultValues` reset (`dependentLookupsKey`,
    // objectui#11631).
    React.useEffect(() => {
      for (const f of fields as FormFieldConfig[]) {
        const name = f?.name;
        if (!name) continue;
        // The render path's own resolution (objectui#12110 item 2), so a hint
        // that degrades to its `type` there is judged as that type here too.
        const resolvedType = resolveWidgetType(f);
        // `field:select` and `select` name the SAME field kind, so this clear
        // must recognise both spellings — the object-form path
        // (`mapFieldTypeToFormType`) emits the prefixed id, hand-written SDUI
        // schemas the bare one. Comparing the RAW string recognised only the
        // bare form, so every option field coming from an object schema fell
        // out of this effect entirely: its parent could narrow the offered set
        // and the stale value was never dropped, submitting the "china +
        // california" pair this effect exists to prevent (objectui#4014).
        // `normalizeFieldType` + the shared set is exactly what the render path
        // below already does for `isOptionField` (objectui#3231) — the two
        // readers of "is this an option field?" must not disagree.
        if (typeof resolvedType !== 'string') continue;
        if (!CASCADE_OPTION_WIDGET_TYPES.has(normalizeFieldType(resolvedType))) continue;
        const opts = (f as any).options as SelectOption[] | undefined;
        if (!opts || opts.length === 0) continue;
        const dependsOn = f.dependsOn;
        const hasOptionPredicate = opts.some((o) => (o as any)?.visibleWhen != null);
        if (!hasOptionPredicate && !dependsOn) continue;
        const current = form.getValues(name);
        if (current === undefined || current === null || current === '') continue;
        // Same shared resolver the widgets use, so gating/filtering stays in
        // lockstep — including the guard below.
        const { options: visible, gated } = resolveCascadingOptions(opts, ruleRecord, dependsOn, predicateScope);
        // Gated ≠ invalid (objectui#4247). While a dependency is empty the whole
        // list is WITHHELD, so `visible` is empty for a reason that says nothing
        // about the stored value — and this effect runs on mount, so a record
        // that merely ARRIVES with its controlling field empty (a later-cleared
        // parent, an import, a partially-migrated row) had the dependent
        // picklist wiped before the user touched anything, while the field
        // rendered "select the parent first" beside it. Gating is missing
        // information, not a verdict; the cascade converges when the parent IS
        // chosen and the resolved set genuinely excludes the value, which is the
        // clear below, unchanged. The four option WIDGETS carry the matching
        // guard — this effect is an independent second clear on the form host,
        // and the widgets' fix does not reach it.
        if (gated) continue;
        // A cleared scalar is `null`, never `undefined` (objectui#10291) — the
        // reasoning the clear-on-hide effect below spells out at length:
        // `undefined` vanishes from `JSON.stringify`, and an absent key tells
        // the write contract "leave the stored value unchanged". This clear
        // runs on its own wherever no option widget prunes first — a field
        // `visibleWhen` keeps unmounted, the built-in `select` branch — so
        // `undefined` here saved the stale pair this effect exists to drop.
        if (!isValueStillOffered(current, visible)) {
          form.setValue(name, Array.isArray(current) ? [] : null, {
            shouldValidate: false,
            shouldDirty: true,
          });
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ruleRecord, predicateScope]);

    // Clear-on-hide (`6a449fc49`) — the field's own `visibleWhen` turning it
    // invisible clears its value.
    //
    // ## The dead end this closes
    //
    // Hiding a populated field without clearing it made a declared exclusivity
    // impossible to satisfy: the Console kept the value in form state and
    // submitted it anyway, so the server refused the row — correctly — by
    // naming a column that was no longer on screen to clear. On the EDIT path
    // the stored value was re-sent on EVERY attempt, so such a record could
    // never be retyped through the Console at all. Measured against a real app
    // (twelve rows in that state) and graded p1: `visibleWhen` on a populated
    // field must stop producing an unsubmittable form.
    //
    // ## Why `null` and not `undefined`, and why not "just withhold the key"
    //
    // The card offered a second shape — omit invisible fields from the payload
    // — and it cannot fix the edit path. objectui#6848 measured the write
    // contract: `driver-memory`'s `update()` merges `{ ...stored, ...data }`
    // and `driver-sql` issues `SET` for the keys PRESENT, so an absent key
    // keeps the stored value and an explicit `null` overwrites it ("to clear
    // the stored value write null; to leave it unchanged omit the field"). A
    // withheld `crm_contact` therefore leaves the stored contact in the row and
    // the same refusal comes back. `undefined` is the same trap one level down:
    // it satisfies a `== null` check and then vanishes from `JSON.stringify`.
    // So a cleared scalar is `null` — the sentinel every other clearing widget
    // in this workspace already emits — and a cleared multi-value is `[]`,
    // matching the cascade clear above.
    //
    // ## Transition-only, and only over a value that exists
    //
    // A field is cleared when its verdict goes VISIBLE → HIDDEN, which is the
    // card's own wording ("clear a field's value when its `visibleWhen` TURNS
    // it invisible"). The first pass only records the baseline, so opening a
    // record never nulls a column the user has not seen: a save that changed
    // one unrelated field cannot silently strip the stored values of every
    // conditionally-hidden column. Values that are already empty are never
    // written to either, so a create form cannot turn an absent key into an
    // explicit `null` and suppress the server-side default the author declared
    // (#4069).
    //
    // A cleared field that comes back into view comes back EMPTY: this is a
    // clear, not a stash. Re-hiding it then writes nothing (the value is
    // already empty), so the pair cannot oscillate.
    //
    // ## The clear is NAMED (objectui#8070)
    //
    // A silent clear let a stored value vanish with the field that held it. The
    // ruling on objectui#8070 (letter A) ports the naming half of the
    // objectui#6499 ruling to this surface: the user is told WHICH fields were
    // cleared and WHY. So a pass that empties anything raises one notice naming
    // the cleared fields by the label the form draws (the source
    // `validation.formInvalid` names them from), joined by the locale's own
    // `validation.formInvalidJoiner`, under `outcomeToastId`. Sharing that id
    // is what makes it retire like the form's other outcome messages: a later
    // submit refusal replaces it, and the next accepted attempt dismisses it.
    //
    // Only a field that held something is named. An empty list is rewritten
    // as itself, and `false` on a two-state control is that control's EMPTY
    // state (see `BOOLEAN_WIDGET_TYPES`; a create form seeds it), so the box
    // reads unchecked before and after: neither is reported as cleared.
    //
    // A clear can hide a second field — one whose `visibleWhen` reads the
    // field just cleared — and that second clear runs on the NEXT pass. Naming
    // only that pass would replace the notice with the second field alone and
    // hide the first clear from the user. So a pass that starts from exactly
    // the values the previous clearing pass left behind (nothing edited since:
    // the cascade, not a new user action) names its fields together with that
    // pass's. Any edit in between starts a fresh list.
    const previouslyHiddenFieldNames = React.useRef<Set<string> | undefined>(undefined);
    const lastClearNotice = React.useRef<
      { names: string[]; values: Record<string, unknown> } | undefined
    >(undefined);
    React.useEffect(() => {
      const before = previouslyHiddenFieldNames.current;
      previouslyHiddenFieldNames.current = conditionallyHiddenFieldNames;
      if (!before) return;
      const prior = lastClearNotice.current;
      const chained =
        prior !== undefined &&
        !computeDirty(prior.values, form.getValues() as Record<string, unknown>);
      if (!chained) lastClearNotice.current = undefined;
      const cleared: string[] = [];
      for (const name of conditionallyHiddenFieldNames) {
        if (before.has(name)) continue;
        const current = form.getValues(name);
        if (current === undefined || current === null || current === '') continue;
        form.setValue(name, Array.isArray(current) ? [] : null, {
          shouldValidate: false,
          shouldDirty: true,
        });
        const heldNothing = Array.isArray(current)
          ? current.length === 0
          : current === false &&
            BOOLEAN_WIDGET_TYPES.has(
              resolveWidgetType((fields as FormFieldConfig[]).find((f) => f?.name === name)),
            );
        if (!heldNothing) cleared.push(name);
      }
      if (cleared.length === 0) return;
      const names = chained && prior ? [...prior.names, ...cleared] : cleared;
      lastClearNotice.current = {
        names,
        values: { ...(form.getValues() as Record<string, unknown>) },
      };
      toast.warning(
        t('form.clearedOnHide', {
          fields: names.map((n) => fieldLabelByName[n] || n).join(t('validation.formInvalidJoiner')),
        }),
        { id: outcomeToastId },
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conditionallyHiddenFieldNames]);

    // React to defaultValues changes — but ONLY when the values actually
    // change, not on every new object identity. Callers often pass a freshly
    // built `defaultValues` object on each render; resetting on identity alone
    // wiped user input mid-interaction (e.g. a parent re-render between a submit
    // click and the deferred requestSubmit emptied the form, so validation then
    // failed on now-blank required fields and nothing was saved). Compare by
    // value so a genuine change (e.g. an edit-mode record finishing loading)
    // still resets, while identity churn is ignored.
    const lastDefaultsKey = React.useRef<string | undefined>(undefined);
    // The pristine snapshot the dirty check compares against. Kept in sync with
    // whatever we last reset the form to (initial defaults, or a loaded record).
    const baselineRef = React.useRef<Record<string, unknown>>(
      (defaultValues ?? {}) as Record<string, unknown>,
    );
    // The window in which a `defaultValues` reset is running. The two
    // value-notification channels below — `onChange` and the `form_change`
    // `onAction` — read it, so that what they report across a reset is stated
    // HERE, explicitly, the way `onDirtyChange` already states it (a few lines
    // down: it computes its payload from `baselineRef` and is then called
    // outright).
    //
    // Before this ref, those two rode on React's effect ordering instead:
    // every layout DESTROY runs before any layout CREATE, so a caller passing
    // a fresh callback each render had its subscription torn down before the
    // reset and re-established after, and the reset went unreported. That
    // guarantee was delivered by the CALLBACK'S IDENTITY CHANGING — so a
    // caller wrapping the same callback in `React.useCallback`, taught
    // everywhere as a pure performance optimization, kept one identity, the
    // effect never re-ran, the subscription stayed live across the reset, and
    // the record landing was delivered as if the user had edited every field
    // it filled (#2968, measured in #5235). Nothing in the type, the docs or
    // this renderer said "do not memoize this callback".
    //
    // ⛔ NOT decided here (#5235, explicitly left open): whether a value
    // channel SHOULD report a programmatic reset. That is a contract change.
    // This only makes the answer the file already gives identity-independent —
    // the same for memoized and inline callers. If it is ever answered "yes",
    // the explicit call belongs beside the `onDirtyChangeProp?.(...)` one
    // below, not back in a subscription's teardown ordering.
    const resetInFlightRef = React.useRef(false);
    // LAYOUT effect, deliberately — not a passive one. A passive effect runs a
    // commit LATER than the render that produced the new values, so there is a
    // window in which the new inputs are already mounted and interactive but the
    // form still holds the old record. Anything typed in that window is
    // destroyed: the pending `reset()` overwrites the whole record with
    // `defaultValues`, silently dropping the field the user just filled. A
    // layout effect runs synchronously inside the same commit, before the
    // browser can paint or deliver a keystroke to those inputs, so the window
    // does not exist. This surfaced as a flaky wizard test (#2982): a step
    // transition changes `defaultValues`, and a value entered on the new step
    // before the deferred reset landed vanished from the create payload.
    React.useLayoutEffect(() => {
      let key: string;
      try { key = JSON.stringify(defaultValues ?? {}); } catch { key = String(Date.now()); }
      if (lastDefaultsKey.current === key) return;
      lastDefaultsKey.current = key;
      const incoming = (defaultValues ?? {}) as Record<string, unknown>;
      const outgoing = baselineRef.current;
      // `reset()` replaces the WHOLE record, so it also blanks fields the
      // incoming defaults say nothing about — and it lands here in a PASSIVE
      // effect, one commit after those fields were painted. Input arriving in
      // that window was silently discarded. The caught case is the wizard: it
      // reuses one inner form across steps and feeds back `formData`, the merge
      // of the steps submitted SO FAR — so at every step boundary the incoming
      // defaults are missing exactly the fields now on screen, and the create
      // POST went out without the step just filled (#2982):
      //
      //   RESET to {"name":"Alice"}  (values before: {"name":"Alice","note":"hello"})
      //
      // Carry such a value across the reset instead of dropping it.
      const carried = Object.entries(form.getValues() as Record<string, unknown>).filter(
        ([name, value]) =>
          // Only a field the CALLER HAS NEVER CARRIED is eligible — absent from
          // both the outgoing and the incoming defaults. Everywhere the caller
          // has an opinion it stays authoritative, so the three load-bearing
          // paths keep today's behavior exactly: a record landing after first
          // paint still fills every field it names; a `recordId` swap still
          // replaces the record outright (drawer/modal/split forms re-fetch
          // without re-entering their loading branch, so record B lands in the
          // still-mounted form and must not inherit an abandoned edit to A);
          // and a field the caller withdraws stops being the user's.
          !hasOwn(incoming, name) &&
          !hasOwn(outgoing, name) &&
          // The same empty-ish comparison the dirty check uses, so a widget
          // normalizing its own empty value on mount ('' -> null, undefined ->
          // '') is not mistaken for input and does not keep a field alive.
          !valuesEqualForDirty(outgoing[name], value),
      );
      // Set the baseline before resetting: `reset`/`setValue` notify the watcher
      // below synchronously, and it reads this to compute dirtiness.
      baselineRef.current = incoming;
      // Everything up to the `finally` is the reset: `reset()` itself plus the
      // re-application of the carried values, which is part of the same
      // operation and is no more a user edit than the reset is. RHF delivers
      // both to `form.watch` subscribers SYNCHRONOUSLY (measured on 7.85, and
      // relied on by the `baselineRef` line above), so the window shuts before
      // anything else can run in it — a keystroke least of all.
      resetInFlightRef.current = true;
      try {
        form.reset(defaultValues);
        for (const [name, value] of carried) {
          form.setValue(name, value, { shouldValidate: false, shouldDirty: true });
        }
      } finally {
        resetInFlightRef.current = false;
      }
      // Fresh values, so last attempt's rejected-field markers no longer apply.
      setRejectedFieldNames([]);
      // A reset that carried nothing is by definition pristine — clear any stale
      // dirty signal (e.g. an edit-mode record that just finished loading). One
      // that carried input is genuinely dirty against the caller's defaults, and
      // the host's discard guard has to keep hearing so.
      onDirtyChangeProp?.(carried.length > 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultValues]);

    // Watch for form changes - only track changes when onAction is available.
    // LAYOUT effect to stay in the same phase as the `defaultValues` reset
    // above: a passive subscription is established one commit LATER than the
    // layout-phase reset, which is a schedule of its own for no reason.
    //
    // What keeps a reset from being reported as a user edit is the explicit
    // window (`resetInFlightRef`), NOT this effect's teardown ordering. That
    // ordering unsubscribes only when the callback's identity changes, so it
    // held for inline arrows and quietly did nothing for a caller who
    // memoized — see the ref's declaration above (#2968, #5235).
    React.useLayoutEffect(() => {
      if (onAction) {
        const subscription = form.watch((data) => {
          // A `defaultValues` reset is the host's own data landing, not the
          // user editing every field it fills. Driven from the reset itself,
          // so it holds for every caller.
          if (resetInFlightRef.current) return;
          onAction({
            type: 'form_change',
            data,
            formData: data,
          });
        });
        return () => subscription.unsubscribe();
      }
    }, [form, onAction]);

    // Surface dirty state to the host (e.g. a modal/drawer guarding against
    // accidental discard of unsaved input). We compute it via a normalized
    // comparison against the pristine baseline (see computeDirty) rather than
    // react-hook-form's `isDirty`, which false-positives on fields that
    // self-normalize their empty value on mount. Layout-phase for the same
    // ordering reason as the subscription above.
    React.useLayoutEffect(() => {
      const subscription = form.watch((values) => {
        onDirtyChangeProp?.(
          computeDirty(baselineRef.current, values as Record<string, unknown>),
        );
      });
      return () => subscription.unsubscribe();
    }, [form, onDirtyChangeProp]);

    // Surface live values to the host — `FormSchema.onChange`, the value-change
    // sibling of the submit/dirty/cancel callbacks destructured beside it. It
    // was declared, typed, exported and documented, but the renderer never
    // invoked it: authoring `onChange` on a form schema was a silent no-op
    // (#4259). Same subscription plumbing as the two effects above, so the
    // value channel cannot drift into its own schedule.
    //
    // GUARDED, like the `onAction` subscription and unlike the `onDirtyChange`
    // one: a form whose author wrote no `onChange` must establish no
    // subscription at all. Watching unconditionally would put a third
    // `form.watch` on every form in the product to serve callers who asked for
    // nothing — a behaviour change for them, where honouring the declaration
    // is meant to be purely additive.
    //
    // Layout-phase for the same reason as the `onAction` effect above, and —
    // like it — a `defaultValues` reset is kept off this channel by the
    // explicit window (`resetInFlightRef`), not by whether React happened to
    // tear this subscription down. The teardown only happens when the
    // callback's identity changes, i.e. for callers who do not memoize; the
    // guarantee is not theirs alone (#2968, #5235).
    React.useLayoutEffect(() => {
      if (onChangeProp) {
        const subscription = form.watch((values) => {
          // The host's own record landing is not the user changing values.
          if (resetInFlightRef.current) return;
          onChangeProp(values as Record<string, any>);
        });
        return () => subscription.unsubscribe();
      }
    }, [form, onChangeProp]);

    // Dependent-lookup clear (objectui#11631) — the reference-family half of
    // the cascade clear (#2284), which only ever covered option fields.
    //
    // ## The defect this closes
    //
    // A lookup whose `dependsOn` names a sibling (an invoice's `contact`
    // scoped by its `account`) re-scopes its candidate QUERY when the parent
    // moves, but nothing dropped the selection already made: switch Account
    // from Northwind to Contoso and the Northwind contact stayed selected and
    // was saved beside the Contoso account. The server checks only that a
    // reference exists, so this form is the one place the contradictory pair
    // can be stopped. The cascade clear above cannot take it: it tests a
    // value against a STATIC option set, and a lookup has none to test — its
    // offered set is a query result.
    //
    // ## The rule: a change of the parent is the clear
    //
    // When any parent that scopes a lookup (`dependentLookupParents`) takes a
    // different value — another record, or empty — the lookup's selection is
    // cleared: `null` for a single value, `[]` for a multi-value lookup, the
    // sentinels the two clears above write (`null`, never `undefined`,
    // objectui#10291). Whether the old selection happens to fall inside the
    // new scope is not asked: answering it is a query against the server, and
    // a pick the user made under a parent they have since replaced is not
    // theirs to keep silently. A lookup that holds nothing is never written to,
    // so a create form cannot turn an absent key into an explicit `null`.
    //
    // ## Only an EDIT moves a parent — the host's data landing does not
    //
    // The comparison is between successive values of the form, so the
    // question is which value changes count. A `defaultValues` reset — an
    // edit-mode record landing after first paint, a `recordId` swap in a
    // still-mounted drawer, the carried input re-applied inside it — fills
    // the parent AND the lookup in one operation; read as an edit, it would
    // empty every saved pair the moment the record opened. So the comparison
    // is re-based, never acted on, in two cases: inside the explicit reset
    // window (`resetInFlightRef`, the same signal the two value channels above
    // read), and on a notification that names no field — react-hook-form's
    // whole-record replacement (`reset()`, including the bare ones the cancel
    // and `resetOnSubmit` paths call). Everything else is a value moving in
    // this form — a user's pick, or one of the clears above emptying a field —
    // and is acted on. That is also what makes a multi-level chain converge:
    // clearing `contact` is itself a named change, so a lookup scoped by
    // `contact` is cleared in the same pass.
    //
    // The field whose change started a pass is never cleared by it, so two
    // lookups that name each other cannot wipe the pick the user just made.
    //
    // A subscription, like the value channels above, and not a `ruleRecord`
    // effect: the reset window is a synchronous span inside the reset itself,
    // so only a subscriber notified INSIDE it can read it; an effect running
    // after the commit sees two value sets and no record of which operation
    // moved them. Established only when the form has a dependent lookup, and
    // keyed on the primitive `dependentLookupsKey`, not on the memoised
    // `fields` (AGENTS.md #10).
    const dependentLookupsKey = React.useMemo(() => {
      const pairs: Array<[string, string[]]> = [];
      for (const f of fields as FormFieldConfig[]) {
        const parents = dependentLookupParents(f);
        if (parents.length > 0) pairs.push([f.name as string, parents]);
      }
      return pairs.length > 0 ? JSON.stringify(pairs) : '';
    }, [fields]);
    React.useLayoutEffect(() => {
      if (!dependentLookupsKey) return;
      const lookups = JSON.parse(dependentLookupsKey) as Array<[string, string[]]>;
      const parentNames = Array.from(new Set(lookups.flatMap(([, parents]) => parents)));
      const readParents = (): Record<string, unknown> => {
        const values = form.getValues() as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const parent of parentNames) out[parent] = values?.[parent];
        return out;
      };
      let seen = readParents();
      // The field whose change started the current pass; clears nest inside
      // it synchronously (`setValue` notifies this subscription re-entrantly).
      let origin: string | undefined;
      const subscription = form.watch((_values, info) => {
        const before = seen;
        const now = readParents();
        seen = now;
        if (resetInFlightRef.current || !info?.name) return;
        const outermost = origin === undefined;
        if (outermost) origin = info.name;
        try {
          for (const [name, parents] of lookups) {
            if (name === origin) continue;
            if (parents.every((parent) => valuesEqualForDirty(before[parent], now[parent]))) continue;
            const current = form.getValues(name);
            if (isEmptyish(current)) continue;
            form.setValue(name, Array.isArray(current) ? [] : null, {
              shouldValidate: false,
              shouldDirty: true,
            });
          }
        } finally {
          if (outermost) origin = undefined;
        }
      });
      return () => subscription.unsubscribe();
    }, [form, dependentLookupsKey]);

    /**
     * Scroll a field into view and focus a control inside it. The field wrapper
     * carries `data-field` (FormItem), so this reaches custom widgets that RHF's
     * own focus cannot (#2793).
     */
    const revealField = (name: string) => {
      const root: ParentNode = formRef.current ?? document;
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(name)
          : name.replace(/["\\]/g, '\\$&');
      const target = root.querySelector<HTMLElement>(`[data-field="${escaped}"]`);
      if (target) {
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        const focusable = target.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
        );
        focusable?.focus?.({ preventScroll: true });
      }
    };

    /**
     * Tell the user WHICH fields are wrong, wherever the verdict came from.
     *
     * Toast naming the offending fields, then reveal the FIRST of them (in
     * declared/visual order, not the caller's key order) — activating its tab
     * first when it sits on a background one.
     *
     * Shared by the client-side invalid handler and the SERVER-rejection path:
     * the two failures are the same event as far as the person filling the form
     * is concerned; only the referee differs.
     */
    const announceFieldErrors = (names: string[]) => {
      if (names.length === 0) return;
      setRejectedFieldNames(names);
      const labels = names.map((n) => fieldLabelByName[n] || n);
      const MAX = 3;
      const fieldsText =
        labels.slice(0, MAX).join(t('validation.formInvalidJoiner')) +
        (labels.length > MAX ? '…' : '');
      toast.error(t('validation.formInvalid', { fields: fieldsText }), { id: outcomeToastId });

      const errored = new Set(names);
      const firstName =
        (fields as FormFieldConfig[])
          .map((f) => f?.name)
          .find((n): n is string => Boolean(n) && errored.has(n as string)) ?? names[0];

      // In a tabbed layout the offending field may sit on a tab the user is not
      // looking at — naming it is useless if they can't see it. Activate its tab
      // first, then reveal it once that panel has actually been painted (it is
      // display:none until then, so scroll/focus would no-op).
      //
      // Unless the tab is predicate-HIDDEN (#6237): only the SERVER can reject
      // a field there (its client rules are skipped with it), and there is no
      // panel to activate or control to reveal — the toast above already names
      // the field. Recording the activation as a pick anyway would yank the
      // view to that tab whenever its predicate later re-admits it.
      const tabKey = tabKeyByFieldName.get(firstName);
      if (tabKey && hiddenFieldTabKeys.has(tabKey)) return;
      if (tabKey && tabKey !== activeFieldTab) {
        setPickedFieldTab(tabKey);
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => revealField(firstName));
        } else {
          setTimeout(() => revealField(firstName), 0);
        }
        return;
      }
      revealField(firstName);
    };

    // Handle form submission — react-hook-form's validation, then the write.
    // Reached only through `handleSubmit` below, which refuses first on a
    // faulted `visibleWhen`.
    const submitThroughValidation = form.handleSubmit(async (data) => {
      setIsSubmitting(true);
      setSubmitError(null);
      // …and the toast twin of that banner (objectui#7252). Both belong to the
      // previous attempt and both are stale now; the toast outliving it is what
      // let an earlier refusal share the screen with the success that followed.
      toast.dismiss(outcomeToastId);
      // This attempt cleared client validation — drop the previous attempt's
      // tab markers (the server may re-add its own below).
      setRejectedFieldNames([]);

      // Defensive check: If data is an Event, use getValues()
      let formData = data;
      // Check for Event-like properties
      const isEvent = data && (
        (data as any).nativeEvent || 
        typeof (data as any).preventDefault === 'function' || 
        typeof (data as any).stopPropagation === 'function' ||
        (data as any).target ||
        (data as any).bubbles
      );

      if (isEvent) {
        // This should not happen with RHF handleSubmit, but just in case
        formData = form.getValues();
      } else if (!formData || Object.keys(formData).length === 0) {
        // Fallback: if data is empty check getValues(), in case RHF failed to pass it for some reason
        const values = form.getValues();
        if (values && Object.keys(values).length > 0) {
             formData = values;
        }
      }

      // Drop the keys this form itself resolved to read-only. See
      // `readonlyFieldNames`: they are values the user had no way to change,
      // and re-sending them only earns a server-side strip plus a "some fields
      // were not saved" warning on a save that changed none of them.
      if (readonlyFieldNames.size > 0 && formData && typeof formData === 'object') {
        const kept: Record<string, unknown> = {};
        for (const k of Object.keys(formData)) {
          if (!readonlyFieldNames.has(k)) kept[k] = (formData as Record<string, unknown>)[k];
        }
        formData = kept as typeof formData;
      }

      try {
        if (onAction) {
          const result = await onAction({
            type: 'form_submit',
            data: formData,
            formData: formData,
          }) as any;

          // Check if submission returned an error
          if (result?.error) {
            setSubmitError(result.error);
            // Also surface as a toast so the message is visible even when the
            // in-form banner has scrolled out of view (long forms in modals/drawers).
            toast.error(result.error, { id: outcomeToastId });
            return;
          }
        }

        if (onSubmitProp && typeof onSubmitProp === 'function') {
          await onSubmitProp(formData);
        }

        if (resetOnSubmit) {
          form.reset();
        }
      } catch (error) {
        // The server can reject field-by-field: `@objectstack/objectql`'s
        // validators throw `VALIDATION_FAILED` with `fields[]`, and both the
        // REST layer and the runtime dispatcher serve it as a 400 with those
        // entries intact. Every form used to drop them and show one undirected
        // toast — telling the user something was wrong, but not WHAT, on a
        // surface that already knows how to mark the input. Mark them.
        const fieldErrors = extractFieldErrors(error);
        if (fieldErrors) {
          const known = fieldErrors.filter((fe) =>
            (fields as FormFieldConfig[]).some((f) => f?.name === fe.field),
          );
          for (const fe of known) {
            form.setError(fe.field, {
              type: 'server',
              // Fall back to the envelope's top-level text rather than leaving
              // a marked field with no reason next to it.
              message: fe.message || extractWriteErrorMessage(error) || t('form.submitFailed'),
            });
          }
          // Only take over the whole failure when EVERY rejected field has a
          // visible input to carry it. If the server also rejected something
          // this form does not render, fall through: the top-level message
          // concatenates every field's reason, so the part the user cannot see
          // inline is still said out loud instead of silently dropped.
          if (known.length > 0 && known.length === fieldErrors.length) {
            announceFieldErrors(known.map((fe) => fe.field));
            // A fully-attributed rejection is not a form-level failure — the
            // banner would just repeat what is now written under each input.
            return;
          }
        }
        // A rejected write used to be rendered verbatim, which put raw server
        // diagnostics in front of end users — untranslated, and leaking the
        // object's machine name and the record id, e.g.
        // "FORBIDDEN: insufficient privileges to update showcase_private_note
        // pi-TgoJ4_DM55Fqz" (objectstack#3821). A permission denial is a
        // condition the UI already knows how to name, so say it in the user's
        // language and keep the server text for the console.
        // …unless the AUTHOR opted in. `userMessage` (objectstack `79c46da90`) is the
        // producer-side marking: a hook sets it at throw time to
        // say "this text is for the end user". It is a separate field from
        // `message`, so nothing unmarked can reach here — the substitution above
        // still governs every platform diagnostic, and objectstack-ai/objectstack#3821 holds by
        // construction rather than by us guessing what a 403 body contains.
        // Status-agnostic on purpose: 403 is where this was reported
        // (objectui#5210), not a fence the contract draws.
        const errorMessage =
          declaredUserMessage(error) ??
          (isPermissionError(error)
            ? t('form.noPermissionToSave')
            : extractWriteErrorMessage(error) ?? t('form.submitFailed'));
        if (isPermissionError(error) && typeof console !== 'undefined') {
          console.warn('[form] write denied:', error);
        }
        setSubmitError(errorMessage);
        // Also surface as a toast so the message is visible even when the
        // in-form banner has scrolled out of view (long forms in modals/drawers).
        toast.error(errorMessage, { id: outcomeToastId });

        // Log errors for debugging (dev environment only)
        // process may not be defined in all environments
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
          console.error('Form submission error:', error);
        }
      } finally {
        setIsSubmitting(false);
      }
    }, (validationErrors) => {
      // Client-side (react-hook-form) validation blocked the submit. The
      // per-field errors render inline, but in long forms the offending field
      // is often scrolled out of view — the user clicks 创建 and sees nothing
      // happen. Surface a toast naming the fields so the feedback is visible
      // regardless of scroll position (mirrors the server-error toast above).
      announceFieldErrors(Object.keys(validationErrors || {}));
    });

    /**
     * The submit entry: a faulted `visibleWhen` refuses the write, naming the
     * field and the rule (objectui#8069 — ADR-0137 D2, ruled as Q1 = B: one
     * judge per rule).
     *
     * ## Why `visibleWhen` alone
     *
     * It is the one field rule no server evaluates, so its fail-open render
     * direction (D3: a faulting `visibleWhen` SHOWS the field) would otherwise
     * be a silent grant — a field the working rule would have hidden, drawn,
     * edited and written, with nothing anywhere saying the rule did not run.
     * `requiredWhen` / `readonlyWhen` keep their render direction and warning
     * here unchanged: the server evaluates both and refuses a fault itself
     * (D2), field-attributed, and that refusal lands beside the input through
     * the `extractFieldErrors` → `form.setError` path above. A second judge on
     * the client, with less of the record in hand than the server has, would
     * refuse writes the server accepts.
     *
     * ## Why BEFORE react-hook-form's validation
     *
     * Nothing the person filling the form can type clears a broken rule, so
     * asking them to satisfy the other rules first only to refuse them anyway
     * would be wasted work. The refusal therefore runs first and ends the
     * attempt: no validation, no `onAction` / `onSubmit`, no write.
     *
     * ## The accepted residual, named rather than worked around
     *
     * A `visibleWhen` reading `previous` cannot be evaluated on a CREATE form
     * (there is no stored row), so such a form is refused on every submit. The
     * ruling accepted that; it is pinned, not patched.
     *
     * The verdict is read from `faultedVisibleWhenFieldNames` — the same
     * evaluation that decided which fields are hidden — never re-derived here.
     */
    const handleSubmit = (event?: React.BaseSyntheticEvent) => {
      if (faultedVisibleWhenFieldNames.length > 0) {
        event?.preventDefault?.();
        toast.dismiss(outcomeToastId);
        const message = t('form.visibleWhenFaulted', {
          fields: faultedVisibleWhenFieldNames
            .map((n) => fieldLabelByName[n] || n)
            .join(t('validation.formInvalidJoiner')),
        });
        setSubmitError(message);
        toast.error(message, { id: outcomeToastId });
        // Marks the tabs that hold the fields, as a rejected submit does.
        setRejectedFieldNames(faultedVisibleWhenFieldNames);
        return Promise.resolve();
      }
      return submitThroughValidation(event);
    };

    // Handle cancel
    const handleCancel = () => {
      form.reset();
      
      if (onCancelProp && typeof onCancelProp === 'function') {
        onCancelProp();
      }

      if (onAction) {
        onAction({
          type: 'form_cancel',
          data: form.getValues(),
        });
      }
    };

    // Determine grid classes based on columns (explicit classes for Tailwind JIT)
    // Mobile-first: 1 column on mobile, responsive breakpoints for larger screens
    const gridColsClass = 
      columns === 1 ? '' :
      columns === 2 ? 'md:grid-cols-2' :
      columns === 3 ? 'md:grid-cols-2 lg:grid-cols-3' :
      'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
    
    const gridClass = columns > 1
      ? cn('grid gap-4', gridColsClass)
      : 'space-y-4';

    // Every field container (flat, or one per tab panel) lays its fields out on
    // the same grid, so per-field `colSpan` means the same thing on every tab.
    const fieldGridClass = schema.fieldContainerClass || gridClass;
    const fieldTabsPosition = schema.fieldTabsPosition || 'top';
    const isVerticalFieldTabs = fieldTabsPosition === 'left' || fieldTabsPosition === 'right';

    // The LIVE required verdict, per field name: present ⇒ required right now,
    // and the value is the message to show; absent ⇒ not required. Republished
    // by `renderFormField` below on every render, from the very same
    // `resolveFieldRuleState` result that draws the asterisk — so the
    // submit-time check and the star can never disagree (objectui#4161). A ref
    // rather than state: nothing renders off it, it must be readable from
    // inside a validator react-hook-form may have captured at mount, and
    // writing it must not itself schedule a render. Lazily initialised rather
    // than `useRef(new Map())`, whose argument is re-evaluated (and discarded)
    // on every render — the same React footgun documented at the call site.
    const requiredMessagesRef = React.useRef<Map<string, string> | undefined>(undefined);
    const requiredMessages = (requiredMessagesRef.current ??= new Map<string, string>());

    // --- Field rendering ---------------------------------------------------
    // Renders ONE field row (or a virtual section divider). Hoisted out of the
    // field loop so a tabbed layout can place the very same row inside a tab
    // panel — every field, on every tab, belongs to this one form instance.
    const renderFormField = (field: FormFieldConfig): React.ReactNode => {
      const {
        name,
        label,
        description,
        type = 'input',
        required: staticRequired = false,
        disabled: fieldDisabled = false,
        validation = {},
        condition,
        colSpan,
        hidden,
        widget,
        visibleOn,
        readonly: staticReadonly,
        visibleWhen,
        readonlyWhen,
        requiredWhen,
        ...fieldProps
      } = field;

      // Skip hidden fields
      if (hidden) return null;

      // A field claimed by a HIDDEN section is not drawn (#6236) — the same
      // `return null` a field's own false predicate takes, so the ruled
      // semantics ride the existing mechanism: the value stays in the form
      // state and still submits, and react-hook-form skips the unmounted
      // control at submit-time validation. See `hiddenSectionFieldNames`.
      if (hiddenSectionFieldNames.has(name)) return null;

      // Legacy `condition: { field, equals/notEquals/in }` — translated
      // to CEL and evaluated on the canonical engine over the seeded
      // live record (issue #1584), so it agrees with `visibleWhen` and
      // the server. Fail-open (a broken predicate shows the field),
      // matching the CEL rules below.
      //
      // Deliberately still `undefined` for `scope` while the two CEL faces below
      // now receive `predicateScope` (#6010): this predicate is not authored, it
      // is SYNTHESISED here from a structured `{ field, equals/notEquals/in }`
      // object, so its text can only ever name `record.<field>`. There is no
      // authoring path by which it could reference `current_user`, so binding a
      // scope it cannot read would buy nothing and widen the surface.
      const legacyConditionCel = legacyConditionToCel(condition);
      if (
        legacyConditionCel &&
        !evalFieldPredicate(legacyConditionCel, ruleRecord, true, undefined, undefined, {
          context: `condition of field '${name}'`,
        })
      ) {
        return null;
      }

      // Field-level CEL conditional rules (B2). Evaluated reactively
      // against the live record via the canonical engine — same
      // dialect the server enforces (requiredWhen / readonlyWhen), so
      // the UX and the persisted verdict agree. A field with no rules
      // resolves to its static flags unchanged.
      //
      // `serverOwned` is read twice below — by the required suppression here
      // and by the "set on save" hint under the control (objectui#12108) — so
      // it is computed once: one classifier, one answer per field.
      const serverOwned = isServerOwnedValue(field, isCreateForm);
      // A fail-closed section gate (objectui#13055) is judged off the triad —
      // see `isFailClosedSectionGate`.
      const failClosedGate = isFailClosedSectionGate(field);
      const ruleState = resolveFieldRuleState(
        { visibleWhen: failClosedGate ? undefined : visibleWhen, readonlyWhen: isCreateForm ? undefined : readonlyWhen, requiredWhen },
        ruleRecord,
        {
          required: staticRequired,
          readonly: staticReadonly === true,
          // A CREATE form leaves a producer-owned control empty on purpose and
          // omits the key so the server resolves the declared runtime default
          // (#4069). Nothing may then declare the field required — neither the
          // static flag (which `@object-ui/plugin-form` already lowers at the
          // producer) nor a `requiredWhen` predicate resolving TRUE against the
          // live record, which used to re-require it here with nothing the user
          // could type to unblock the submit (#4085).
          serverOwnedValue: serverOwned,
        },
        previousRecord,
        // The host shell's predicate scope — `current_user` and friends (#6010).
        // The SAME bag `resolveCascadingOptions` below already receives, so one
        // authored predicate text means one thing on every `visibleWhen` surface
        // (ADR-0068 D1 / ADR-0089 D1: runtime record surfaces bind `record` +
        // `current_user`). Before this it was `undefined`, and a form-field gate
        // naming `current_user` named an UNBOUND root — which fails OPEN below,
        // i.e. showed the field to everyone.
        predicateScope,
        `field '${name}'`,
      );
      if (!ruleState.visible) return null;
      if (failClosedGate && !sectionGateVisible(field, ruleRecord, previousRecord, predicateScope)) return null;

      // View-level conditional visibility — spec FormField.visibleOn,
      // authored on the form view (not the object field). Same
      // canonical CEL engine and record scope as visibleWhen; both
      // the bare-string and `{ dialect, source }` wire shapes are
      // accepted, and a broken predicate fails open — loudly since
      // objectstack-ai/objectstack#5149 (#2212).
      if (
        visibleOn != null &&
        !evalFieldPredicate(visibleOn, ruleRecord, true, previousRecord, predicateScope, {
          context: `visibleOn of field '${name}'`,
        })
      ) {
        return null;
      }
      const required = ruleState.required;
      const readonly = ruleState.readonly;

      // Section divider — renders a collapsible FormSection header inline
      // so all fields share the same form instance (enables cross-section conditions).
      if (type === 'section-divider') {
        const fp = fieldProps as any;
        return (
          <SectionDivider
            key={name}
            label={label}
            description={description}
            collapsible={fp.collapsible}
            collapsed={fp.collapsed}
            onToggle={fp.onToggle}
            className={fp.className}
          />
        );
      }

      // Build validation rules
      const rules: any = {
        ...validation,
      };

      // `required` is a PRESENCE contract, not a truthiness one — and the
      // referee it has to agree with is the server. `@objectstack/spec`
      // FieldSchema.required (ADR-0113) reads "an insert must provide a
      // NON-NULL value", and objectql's record validator implements exactly
      // that: `isMissing` = undefined | null | blank string. `false` and `0`
      // are values.
      //
      // react-hook-form's own `required` rule breaks that contract in both
      // directions: it fails whenever `isBoolean(value) && !value` (its
      // accept-the-terms checkbox heritage), so a required boolean silently
      // becomes "must be TRUE" and the only state the control shows by
      // default is the one value that cannot be saved — an AI-built task
      // tracker could not create an UNFINISHED task (cloud#972); and it lets
      // a whitespace-only string through, which the server then rejects.
      //
      // So never hand RHF its `required` (`delete` also drops the copy that
      // rode in on `validation` from buildValidationRules, which must not
      // outlive a `requiredWhen` that resolved to FALSE) and express the
      // check as a `validate` entry keyed `required` — RHF reports an
      // object-form validate failure under its key, so the error still
      // surfaces as `type: 'required'` for the conditional-required cleanup
      // above.
      //
      // The entry is registered UNCONDITIONALLY and decides required-ness when
      // it RUNS, instead of being added only while the field is required
      // (objectui#4161). react-hook-form merges a Controller's `rules` INTO the
      // field descriptor it already holds — `_f: { ...previous._f, ...options }`
      // — so a rule key that simply stops being spelled is never removed: the
      // validator installed the first time `requiredWhen` evaluated TRUE
      // outlived every later FALSE. The two layers then disagreed: the display
      // layer re-evaluated (asterisk and `aria-required` both disappeared)
      // while submit stayed refused with "<field> is required" and no write was
      // ever issued. Always spelling the key gives that merge something to
      // overwrite, and reading the verdict out of `requiredMessages` at call
      // time keeps the answer correct even for the closure RHF captured at
      // mount — the fix must not rest on RHF re-registering per render, which
      // it does today only as a side effect of `useRef(control.register(…))`
      // re-evaluating its (discarded) initializer argument.
      //
      // Deliberately NOT re-evaluating the predicate inside the validator: that
      // would be a second evaluation site with its own copy of the record
      // assembly (the `null` seeding, the `previousRecord` overlay), i.e. the
      // exact drift this issue is about. The verdict published here IS the one
      // the asterisk was drawn from.
      delete rules.required;
      if (required) {
        requiredMessages.set(
          name,
          typeof validation.required === 'string'
            ? validation.required
            : t('validation.required', { field: label || name }),
        );
      } else {
        requiredMessages.delete(name);
      }
      const authoredValidate = rules.validate;
      rules.validate = {
        // A field-authored `validate` keeps running, and keeps its own
        // `type: 'validate'` error key.
        ...(typeof authoredValidate === 'function'
          ? { validate: authoredValidate }
          : (authoredValidate ?? {})),
        required: (value: unknown) => {
          const requiredMessage = requiredMessages.get(name);
          // Absent ⇒ not required as of NOW, whatever it was when this
          // validator was registered.
          if (requiredMessage === undefined) return true;
          return !isMissingForRequired(value) || requiredMessage;
        },
      };

      // Localize the standard validation messages emitted by
      // buildValidationRules. Each such rule carries a `messageKey`
      // and leaves `message` undefined for the auto-generated case
      // (a field-authored message is a string and is left untouched);
      // we fill the blanks through i18n so they track the label's
      // language. A fresh object avoids mutating the shared rule.
      const localizeRule = (
        rule: any,
        interp?: (r: any) => Record<string, unknown>,
      ) => {
        if (
          rule && typeof rule === 'object' &&
          rule.message == null && typeof rule.messageKey === 'string'
        ) {
          return {
            ...rule,
            message: t(rule.messageKey, { field: label || name, ...(interp?.(rule)) }),
          };
        }
        return rule;
      };
      if (rules.minLength) rules.minLength = localizeRule(rules.minLength, r => ({ min: r.value }));
      if (rules.maxLength) rules.maxLength = localizeRule(rules.maxLength, r => ({ max: r.value }));
      if (rules.min) rules.min = localizeRule(rules.min, r => ({ min: r.value }));
      if (rules.max) rules.max = localizeRule(rules.max, r => ({ max: r.value }));
      if (rules.pattern) rules.pattern = localizeRule(rules.pattern);

      // Use field.id or field.name for stable keys (never use index alone)
      const fieldKey = field.id ?? name;

      // Resolve the component type: prefer an explicit form-config
      // `widget`, then the object-schema field's own `widget` render
      // hint (carried on the field metadata, e.g. `object-ref`,
      // `filter-condition`, `recipient-picker`), then the bare `type`.
      // The nested-metadata fallback matters because some field
      // builders (e.g. the field-group/section layout path in
      // ObjectForm) pass the field metadata through without hoisting
      // its `widget` to the top-level form-config, which would
      // otherwise degrade a picker field to its raw `type` input.
      // (`.field` is the resolved metadata OBJECT — declared on FormField
      // since #3090, never the spec string; see types/form.ts)
      //
      // A built-in type declared `multiple` is routed to its multi-value
      // widget HERE, before any reader of `resolvedType` runs
      // (objectui#11116) — see `applyDeclaredArity`.
      //
      // A hint nothing can draw degrades to `type`, as the spec promises
      // (objectui#12110 item 2) — see `resolveRenderableWidget`.
      const resolvedType = applyDeclaredArity(
        resolveRenderableWidget(type, widget, fieldProps.field?.widget),
        fieldProps.multiple,
      );

      // Cascading / role-gated option lists (#2284). For option fields,
      // narrow the set by each option's `visibleWhen` (evaluated against
      // the live record + `current_user`), and gate the whole control
      // while a declared `dependsOn` parent is still empty — surfacing a
      // "select the parent first" hint instead of an unfiltered list.
      // `field:select` and `select` name the SAME field kind — the object-form
      // path (`mapFieldTypeToFormType`) emits the prefixed id, hand-written
      // form schemas the bare one. Comparing the raw string recognised only the
      // bare form, so every option field coming from an object schema fell out
      // of this block entirely and no gate hint was ever computed for it
      // (objectui#3231). `normalizeFieldType` is the same normalization
      // `stripRegisteredFieldProps` already applies a few lines down; the two
      // must agree on what a `select` is.
      const isOptionField = CASCADE_OPTION_WIDGET_TYPES.has(normalizeFieldType(resolvedType));
      const rawOptions = (fieldProps as any).options as SelectOption[] | undefined;
      // Resolve gating + `visibleWhen` filtering through the shared
      // core helper so this pre-filter can't drift from the widgets'
      // `useCascadingOptions` hook (#2715). Non-option fields pass
      // their options through untouched.
      const cascade = isOptionField
        ? resolveCascadingOptions(rawOptions, ruleRecord, field.dependsOn, predicateScope)
        : null;
      const optionGroupGated = cascade?.gated ?? false;
      const dependsOnFields = cascade?.dependsOnFields ?? [];
      const effectiveOptions = cascade ? cascade.options : rawOptions;
      // Same i18n key the option widgets fall back to (`fields.options.
      // selectFirst`, objectui#3231): one sentence, two callers — this one
      // interpolates the controlling fields' LABELS, a standalone widget its
      // raw metadata names — so the gate can never read differently depending
      // on which side produced it.
      //
      // That invariant held for the sentence but not for its `{{fields}}`
      // slot, which each caller filled with a hardcoded separator — `' / '`
      // here, `', '` in the lookup's own gate — so a field gated on two
      // parents still read two ways (objectui#4026). The separator is a
      // property of the locale, so all of them now read
      // `validation.formInvalidJoiner`: the key objectstack#5407 added for the
      // invalid-submit toast a few hundred lines up, which is the same class
      // of truncated-name list, rather than a second gate-only twin that would
      // reintroduce the divergence.
      const gatedHint = optionGroupGated
        ? t('fields.options.selectFirst', {
            fields: dependsOnFields
              .map((fn) => fieldLabelByName[fn] || fn)
              .join(t('validation.formInvalidJoiner')),
          })
        : undefined;

      // colSpan classes for grid layout.
      //
      // When the container uses container-query-based grid classes
      // (e.g. `@md:grid-cols-2`), the grid's base is `grid-cols-1`
      // on narrow containers. Applying a bare `col-span-2` in that
      // state causes CSS grid to synthesize an implicit 2nd column
      // track, distorting column widths. We must mirror the same
      // container-query prefix on the col-span utilities so they
      // only engage once the grid is actually multi-column.
      // The effective container is whatever wraps the fields: either
      // `fieldContainerClass` (overrides, typically container-query based)
      // or the locally-computed `gridClass` (viewport-based).
      const containerClass = schema.fieldContainerClass || gridClass;
      // One class PER TIER, derived from the container class — see
      // {@link spanLadderFor} for why a single widest-tier class under-spans
      // every intermediate width (`bd0995738`), and for why the tier
      // prefixes are load-bearing rather than decoration.
      const pickSpanClass = (targetCols: number): string =>
        spanLadderFor(containerClass, targetCols);

      const colSpanClass = isTwelveTrackContainer(containerClass)
        ? twelveTrackSpanClass(colSpan)
        : colSpan && colSpan > 1
        ? colSpan === 2 ? pickSpanClass(2)
        : colSpan === 3 ? pickSpanClass(3)
        : colSpan >= 4 ? pickSpanClass(4)
        : ''
        : '';

      // Metadata-derived stable locator (ADR-0054 C4): the renderer
      // emits it from the object + field name so every generated form
      // inherits it with zero per-app work. Object prefix omitted when
      // the form schema has no owning object.
      const fieldTestId = `field:${schema.objectName ? `${schema.objectName}.` : ''}${name}`;

      const fieldLabelling = resolveFieldLabelling(resolvedType);
      const groupLabelled = fieldLabelling === 'group';

      // A registered field widget whose output is a replacement display drops
      // every prop the host handed down, so the host wraps that output in a
      // named group of its own — see {@link ReadonlyFieldGroup} for the
      // measurement and the shape. Two ways a field gets here, one wrapper:
      //
      //  - `readonly === true` (objectui#4788): the widget's readonly branch
      //    renders the display in place of its control. Unchanged semantics —
      //    this arm still keys off the field STATE, not the declaration, so an
      //    undeclared third-party widget keeps exactly the #4788 behaviour;
      //  - `labelling: 'display'` (objectui#4857): the widget declares that its
      //    surface is a pure display in EVERY state — `formula` / `summary` /
      //    `auto_number` / `vector` have no editable branch at all — so the
      //    wrapper applies in the editable state too. Without this arm those
      //    four lost the host id whenever the form was editable: on the real
      //    object-form path they arrive as `disabled`, not `readonly`
      //    (ObjectForm keeps that distinction deliberately — option 1 of the
      //    #4857 option set was rejected), so the #4788 gate never fired and
      //    the label's `for` dangled.
      //
      // Two further gates, each carrying its own reason:
      //
      //  - `label`: with no visible label there is no naming channel to repair,
      //    and a `role="group"` that nothing names is the inert pair this issue
      //    exists to avoid. Standalone / label-less rendering therefore stays
      //    byte-identical, exactly as `toHostGroupProps` keeps it;
      //  - `!groupLabelled`: the group-labelled widgets already consume the
      //    host's id / name / description themselves (objectui#3961 → #3990 →
      //    #4005). Wrapping them too would nest a second group with the same
      //    name and take the id off the surface those PRs put it on;
      //  - a registered FIELD widget: the builtin branch renders a real control
      //    inside `<FormControl>` in the readonly state too, so its label keeps
      //    a `for` that resolves to a labelable element — measured, and left
      //    alone. (A `'display'` declaration can only come from a registered
      //    widget's meta, so for that arm this gate is belt-and-braces.)
      const hostWrappedDisplay =
        (readonly === true || fieldLabelling === 'display') &&
        !!label &&
        !groupLabelled &&
        resolvesToRegisteredFieldWidget(resolvedType);

      // The visible label is associated by IDREF instead of `for` — it gets an
      // `id`, and the surface that answers to it gets `aria-labelledby`. Two
      // paths reach this shape: a group-labelled widget (objectui#3961), where
      // the WIDGET answers, and a readonly registered widget (objectui#4788),
      // where the host's own wrapper does. `undefined` everywhere else, and
      // every use below is a conditional spread, so the single-control path
      // emits not one changed attribute — no second naming channel for the
      // fields that never needed one (the #3290 / #3222 / #3952 rule: one fact,
      // one author).
      //
      // Whitespace is squeezed out of the field name because this id is consumed
      // as an `aria-labelledby` IDREF, and that attribute is a SPACE-SEPARATED
      // list: an id containing a space would silently resolve to two ids,
      // neither of which exists.
      const hostLabelId =
        label && (groupLabelled || hostWrappedDisplay)
          ? `${labelIdPrefix}${String(name).replace(/\s+/g, '_')}-group-label`
          : undefined;

      // The widget-facing half. Only the group-labelled path hands the IDREF
      // DOWN to the widget: on the host-wrapped path (readonly, or a declared
      // `'display'` widget) the wrapper is the named surface, and passing the
      // same id to the widget as well would give one label two consumers — the
      // double channel #3978 removed.
      const groupLabelId = groupLabelled ? hostLabelId : undefined;

      // The option set the field will actually be rendered with. Hoisted to a
      // single const because TWO readers need the identical value: it is passed
      // down as `options` below, and `rendersBuiltinSelectEmptyState` reads it
      // here to decide whether the branch about to render has a control at all
      // (objectui#3991). Two spellings of one expression is exactly how the
      // label and the branch would come to disagree.
      const resolvedOptions = isOptionField ? effectiveOptions : fieldProps.options;

      // The built-in `select` branch renders `BuiltinSelectEmptyState` — a
      // `<div>`, no control — when that set is empty, so the `for` `<FormLabel>`
      // emits by default would name a non-labelable element: inert HTML
      // (objectui#3991). No control ⇒ no `for`. ⛔ Not an `aria-labelledby`
      // IDREF and ⛔ not a synthetic role: both name a thing that is not a
      // control, which is the same category error spelled differently. See
      // {@link rendersBuiltinSelectEmptyState} for why this is knowable here
      // and why the registered-widget path is deliberately excluded.
      const builtinBranchHasNoControl = rendersBuiltinSelectEmptyState(
        resolvedType,
        resolvedOptions as readonly unknown[] | undefined,
      );

      return (
        <FormField
          key={fieldKey}
          control={form.control}
          name={name}
          rules={rules}
          render={({ field: formField, fieldState }) => (
            <FormItem
              className={colSpanClass || undefined}
              data-testid={fieldTestId}
              data-field={name}
            >
              {label && (
                <FormLabel
                  className="text-xs font-normal text-muted-foreground"
                  // A group-labelled widget (objectui#3961) is named by IDREF:
                  // publish the label's own `id` and drop the `for`. `htmlFor:
                  // undefined` is not a no-op — `<FormLabel>` sets
                  // `htmlFor={formItemId}` BEFORE spreading its props, so this
                  // key removes the attribute. It has to go: a `for` naming a
                  // `div` (or nothing at all) is inert HTML, and leaving it
                  // beside the `aria-labelledby` would give one label two
                  // association channels, one of which is broken.
                  //
                  // A readonly registered widget (objectui#4788) — and a
                  // widget declared `labelling: 'display'`, in every state
                  // (objectui#4857) — reaches the same shape through the
                  // host's own wrapper, and needs the `for` gone for the same
                  // reason: it was measurably DANGLING there, pointing at an
                  // id no element in the document carried.
                  {...(hostLabelId ? { id: hostLabelId, htmlFor: undefined } : null)}
                  // No control renders in this branch, so there is nothing a
                  // `for` could legally name (objectui#3991). `htmlFor:
                  // undefined` is not a no-op — `<FormLabel>` sets
                  // `htmlFor={formItemId}` BEFORE spreading its props, so this
                  // key removes the attribute; the label stays visible text
                  // beside the message. Mutually exclusive with the branch
                  // above by construction: `hostLabelId` needs `groupLabelled`
                  // or `hostWrappedDisplay`, and a BUILTIN type is neither
                  // (`resolveFieldLabelling` answers `'control'` for it and
                  // `resolvesToRegisteredFieldWidget` answers `false`) — pinned
                  // from the DOM, not assumed.
                  {...(builtinBranchHasNoControl ? { htmlFor: undefined } : null)}
                >
                  {label}
                  {required && (
                    // Purely visual redundancy now that `aria-required` rides
                    // on the control itself (objectui#3290). It used to carry
                    // `aria-label="required"`, which made the asterisk part of
                    // the control's accessible name; keeping both channels
                    // would have assistive tech announce required TWICE — once
                    // inside the name, once as the state. The state channel is
                    // the correct single source, so the marker leaves the
                    // accessibility tree entirely.
                    //
                    // `data-required-marker` is the stable locator for the
                    // sighted-user affordance (ADR-0054 C4), replacing the
                    // `aria-label` that end-to-end specs were selecting on —
                    // a11y attributes must not double as test hooks, which is
                    // how this one survived as long as it did.
                    <span
                      className="text-destructive ml-1"
                      data-required-marker="true"
                      aria-hidden="true"
                    >
                      *
                    </span>
                  )}
                </FormLabel>
              )}
              <FormControl>
                {/* Render the actual field component based on resolved type.
                    A readonly registered widget's output goes inside the host's
                    own named group (objectui#4788) — every other field is handed
                    to `<FormControl>`'s Slot exactly as before. */}
                {withReadonlyHostGroup(hostWrappedDisplay ? hostLabelId : undefined, renderFieldComponent(resolvedType, {
                  ...fieldProps,
                  // Specialized fields need the raw metadata object. `.field`
                  // is the declared metadata slot (#3090 — never the spec
                  // string); fall back to the field config itself when no
                  // metadata was stashed (standalone forms).
                  field: field.field || field,
                  ...formField,
                  inputType: fieldProps.inputType,
                  // The field's label, forwarded explicitly because the
                  // destructure above takes it OFF `fieldProps` (objectui#3393).
                  // Without this key the built-in `textarea` branch's `label`
                  // was `undefined` on every render, so the fullscreen dialog's
                  // title fell to the generic "Edit text" and all three long-text
                  // fields on one form gave their expand buttons the SAME
                  // accessible name. Renderer-only: both strips drop it, so it
                  // reaches no DOM attribute and no registered widget.
                  label,
                  options: resolvedOptions,
                  placeholder: fieldProps.placeholder ?? (resolvedType === 'select' ? t('common.selectOption') : undefined),
                  // `disabled` means "not interactive, muted"; `readonly` means
                  // "shown plainly, not editable" — keep them distinct so widgets
                  // that implement a real readonly display (e.g. EmailField's
                  // mailto link) actually receive it instead of always collapsing
                  // to the grayed-out disabled look. A dependency-gated option
                  // list (#2284) is disabled until its controlling field is set.
                  disabled: disabled || fieldDisabled || isSubmitting || optionGroupGated,
                  readonly,
                  // Gate hint shown when a dependent option list is still
                  // waiting on its controlling field (#2284).
                  emptyHint: gatedHint,
                  dataSource: contextDataSource,
                  // Live form values for dependent (cascading) lookups
                  // (#2215): the widget's `dependsOn` gate + filters must
                  // re-scope as the user picks the parent field in THIS
                  // form, not read a stale record snapshot. Forwarded to
                  // data-source widgets only (see stripRegisteredFieldProps).
                  dependentValues: ruleRecord,
                  // Field name → label for the SAME sibling fields
                  // `dependentValues` carries the values of, so a gated lookup
                  // can say "Select Account first" instead of naming the raw
                  // API name (objectstack#5407). The whole form's map is passed
                  // (not a per-field slice) because the widget reads only the
                  // entries its own `dependsOn` names, and one stable
                  // reference keeps the widget's memo deps from thrashing.
                  dependsOnLabels: fieldLabelByName,
                  // The validation slot the widget props contract has declared
                  // all along and nobody produced (objectui#3222). Spelled
                  // `error` because that is what `@objectstack/spec/ui`'s
                  // `FieldWidgetPropsSchema` calls it — the published contract
                  // third-party / AI-authored widgets are written against.
                  //
                  // A widget consumes it for `aria-invalid` ONLY; the message
                  // TEXT belongs to `<FormMessage/>` below. Both halves matter:
                  // `aria-invalid` has to sit on the input element, which only
                  // the widget renders, and `<FormControl>`'s Slot does hand a
                  // correct `aria-invalid` down — but a widget that computes
                  // its own from a prop nobody passed OVERRIDES that Slot value
                  // with `false`. That is how seven widgets ended up never once
                  // announcing an invalid field.
                  //
                  // Undefined when the field is valid, so the key is simply
                  // absent from the DOM rather than rendering `error=""`.
                  error: fieldState.error?.message,
                  // Required is a STATE, so it travels the state channel
                  // (objectui#3290). Until now the resolved `required` (static
                  // `required` + `requiredWhen` CEL) drove exactly one thing —
                  // the red asterisk in `<FormLabel>` — which reached assistive
                  // tech only by being folded into the control's ACCESSIBLE
                  // NAME ("Title required"). Three ways that fails: a name is
                  // read in name order rather than announced as a state, "list
                  // the required fields" navigation cannot see it, and a field
                  // rendered without a `label` (compact layouts, inline grid
                  // editing) draws no asterisk at all, so the signal vanishes.
                  //
                  // No widget change is needed for this to land on the input:
                  // `aria-required` is already declared and typed on the widget
                  // props contract (`FieldWidgetComponentProps & AriaAttributes`)
                  // and every widget forwards its leftover props to the control
                  // it renders. The builtin branch is the same story — neither
                  // `stripRegisteredFieldProps` nor the builtin branches' DOM
                  // allowlist (`toFormControlDomProps`) drops `aria-*`. That is
                  // precisely why #3222 refused to
                  // sink a `required` BOOLEAN into the widget contract: a
                  // boolean gives the asterisk a second author and the next
                  // AI-written widget draws its own, while `aria-required` goes
                  // straight to the DOM with no new key to get wrong.
                  //
                  // `|| undefined` (not `String(required)`) so an optional
                  // field carries NO attribute at all. `aria-required="false"`
                  // is legal but semantically noisier than absence, and absence
                  // is what the dynamic `requiredWhen` FALSE case must produce.
                  //
                  // Deliberately NOT the native `required` attribute: that
                  // would arm the browser's own constraint-validation bubble
                  // alongside react-hook-form's messages — two validators, two
                  // UIs, one field. `aria-required` reports the state without
                  // triggering native validation.
                  'aria-required': required || undefined,
                  // The IDREF half of the group-labelled association
                  // (objectui#3961). Like `aria-required` this needs no new key
                  // in the widget contract — `aria-*` is declared on it as
                  // React's `AriaAttributes`, neither strip touches the prefix,
                  // and `toDomProps` forwards the whole `aria-` family — so the
                  // widget's existing spread carries it to the element it puts
                  // the host's `id` on. The widgets that render a real composite
                  // additionally answer with `role="group"`; `file`, whose single
                  // control is a `div[role="button"]`, just takes the name.
                  //
                  // Spread conditionally so the single-control path receives no
                  // such key at all: absent, not `undefined`.
                  ...(groupLabelId ? { 'aria-labelledby': groupLabelId } : null),
                }))}
              </FormControl>
              {renderFieldDescription(
                description,
                // objectui#12108 — shown exactly while the submit would omit
                // the key, so the server fills the field: it is server-owned
                // (`serverOwned`, the classifier the required suppression above
                // reads) and its live value is empty by `isMissingForRequired`,
                // the predicate `omitServerResolvedDefaults` drops a key by. A
                // typed value is submitted and wins, so the hint goes with it.
                //
                // Not on a control that takes no input. The containers send
                // `previousValues` in EDIT mode only, so a `mode: 'view'` form
                // reads as create here, and every field it draws is disabled:
                // an empty stored column there is filled by no save. The same
                // gate hides the hint on a locked field of a real create form,
                // which is a missing hint, never a wrong one.
                serverOwned && !readonly && !fieldDisabled && isMissingForRequired(formField.value)
                  ? t('form.serverDefaultHint')
                  : undefined,
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    };

    // The untabbed, unpaned field list, drawn one grid per block
    // (`splitAtUntitledRuns`, objectui#11777). Every block lays its fields out
    // on the same `fieldGridClass`, so a `colSpan` means the same thing in each,
    // and every field is still rendered exactly once, into this one form. A
    // single block is the pre-#11777 DOM, unchanged. Keyed by position in the
    // split, which only the field list's structure moves — a predicate flipping
    // never re-keys a block, so it never remounts the fields in it.
    const renderFieldBlocks = (list: FormFieldConfig[]): React.ReactNode => {
      let drawnAbove = false;
      return splitAtUntitledRuns(list).map((block, index) => {
        const nodes = block.map(renderFormField);
        const draws = block.some(
          (f, j) =>
            nodes[j] != null &&
            !(f?.type === 'section-divider' && !dividerDrawsRow(f.label, f.description)),
        );
        const separated = index > 0 && drawnAbove && draws;
        drawnAbove = drawnAbove || draws;
        return (
          <div key={index} className={separated ? cn(fieldGridClass, UNTITLED_BLOCK_CLASS) : fieldGridClass}>
            {nodes}
          </div>
        );
      });
    };

    // Extract designer-related props and conflicting handlers
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        onSubmit: _ignoredOnSubmit, // Prevent overwriting our handleSubmit
        // Keep a top-level `onChange` off the <form> DOM node. Some callers /
        // the SDUI dispatch spread the whole form node at the top level in
        // addition to `schema`, and a DOM `onChange` there fires with a
        // SyntheticEvent — never with form values, so it is not the
        // `FormSchema.onChange` contract at all. That schema-level callback is
        // subscribed above (#4259) and is the only `onChange` this renderer
        // honours; before it was wired there was in fact no "our onChange" for
        // this line to protect. Dropping the top-level copy is all this does:
        // it is not re-routed here, and nothing double-fires.
        onChange: _ignoredOnChange,
        // Extract schema props that should not be spread to DOM (handled separately by schema destructuring above)
        submitLabel: _submitLabel,
        cancelLabel: _cancelLabel,
        showSubmit: _showSubmit,
        showCancel: _showCancel,
	        resetOnSubmit: _resetOnSubmit,
	        defaultValues: _defaultValues,
	        inputType: _inputType,
          dataSource: _dataSource,
          showActions: _showActions,
          fieldContainerClass: _fieldContainerClass,
          mobileStickyActions: _mobileStickyActions,
          // Remaining FormSchema-level props that are NOT valid <form> DOM
          // attributes. Some callers / the SDUI dispatch spread the whole form
          // node at the top level (in addition to `schema`), so these arrive in
          // `props` and would leak onto the DOM — React warns "does not
          // recognize the `objectName` prop" and "Unknown event handler
          // property `onDirtyChange`" (seen on every object list view). The
          // `schema` destructure above already consumes them; drop the
          // top-level copies here so nothing bleeds through `...formProps`.
          objectName: _objectName,
          // The persisted record (objectui#6396). It has a real consumer — the
          // `previousRecord` memo above, which binds `previous` for field-rule
          // CEL and is the INSERT/UPDATE signal the read-only submit strip
          // gates on — but that consumer reads it off `schema`, never off
          // `props`. This top-level copy is purely the SDUI-dispatch duplicate
          // described above, and it was the one member of this family missing
          // from the list: it rode `...formProps` onto <form>, where React
          // declined it ("does not recognize the `previousValues` prop") AND
          // still stamped the node with `previousvalues="[object Object]"` —
          // seen on every edit-mode `object-master-detail-form` header render.
          previousValues: _previousValuesProp,
          onDirtyChange: _onDirtyChangeProp,
          onCancel: _onCancelProp,
          fields: _fields,
          layout: _layout,
          columns: _columns,
          validationMode: _validationMode,
          // (`disabled` is not listed here: the component signature consumes the
          // host verdict by name, so it never reaches `props` — see `const
          // disabled` above.)
          fieldTabs: _fieldTabs,
          defaultFieldTab: _defaultFieldTab,
          fieldTabsPosition: _fieldTabsPosition,
          fieldPanes: _fieldPanes,
          fieldPanesOrientation: _fieldPanesOrientation,
          fieldPanesResizable: _fieldPanesResizable,
	        ...formProps
	    } = props;

    return (
      <Form {...form}>
        <form
            ref={formRef}
            onSubmit={handleSubmit}
            className={className}
            {...formProps}
            // Apply designer props
            data-obj-id={dataObjId}
            data-obj-type={dataObjType}
            style={style}
        >
          {/* Form Error Alert */}
          {submitError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          {/* Spec-vocabulary entries cannot be rendered here (#3090) — say so
              in the form instead of silently dropping the fields. */}
          {specVocabularyFields.length > 0 && (
            <Alert variant="destructive" className="mb-4" data-testid="form-spec-vocabulary-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {`Not rendered — spec form-view vocabulary ({ field: … }) in a standalone form: ` +
                  specVocabularyFields.map((f: any) => f.field).join(', ') +
                  '. Use { name: … }, or an object-bound form with sections.'}
              </AlertDescription>
            </Alert>
          )}

          {/* Form Fields */}
          {schema.children ? (
            // If children are provided directly, render them
            <div className={schema.fieldContainerClass || 'space-y-4'}>
              {renderChildren(schema.children)}
            </div>
          ) : fieldTabGroups && visibleFieldTabGroups ? (
            // Tabbed field layout (#2959): one <form>, one react-hook-form
            // instance, N force-mounted panels. Inactive panels are CSS-hidden
            // (`data-[state=inactive]:hidden`) rather than unmounted, which is
            // what keeps their values and their validation alive.
            //
            // Predicate-hidden tabs (#6237) are a different kind of hidden: the
            // strip and the panel list below draw only `visibleFieldTabGroups`,
            // so a hidden tab's fields UNMOUNT — the ruled hidden-group
            // semantics (values kept and submitted, client validation
            // skipped). With every tab hidden nothing remains to draw, so the
            // strip is omitted rather than rendered empty.
            <>
              {untabbedFields.length > 0 && (
                <div className={cn(fieldGridClass, 'mb-4')}>
                  {untabbedFields.map(renderFormField)}
                </div>
              )}
              {visibleFieldTabGroups.length > 0 && (
              <Tabs
                value={activeFieldTab}
                onValueChange={setPickedFieldTab}
                orientation={isVerticalFieldTabs ? 'vertical' : 'horizontal'}
                // Always a flex container: `order-last` on the strip is what
                // puts it after the panels for `bottom`/`right`, and `order`
                // only applies to flex children.
                className={cn('flex w-full', isVerticalFieldTabs ? 'gap-4' : 'flex-col')}
              >
                <TabsList
                  className={cn(
                    // `self-start` keeps the strip its content's size instead of
                    // being stretched by the flex container above.
                    'self-start',
                    isVerticalFieldTabs
                      ? cn('h-auto flex-col', fieldTabsPosition === 'right' && 'order-last')
                      : fieldTabsPosition === 'bottom' ? 'order-last mt-4' : 'mb-4',
                  )}
                >
                  {visibleFieldTabGroups.map((group) => (
                    <TabsTrigger
                      key={group.key}
                      value={group.key}
                      data-testid={`form-tab:${group.key}`}
                      data-error={erroredFieldTabs.has(group.key) || undefined}
                      className={cn(
                        isVerticalFieldTabs && 'w-full justify-start',
                        erroredFieldTabs.has(group.key) && 'text-destructive data-[state=active]:text-destructive',
                      )}
                    >
                      {group.label}
                      {erroredFieldTabs.has(group.key) && (
                        <span
                          aria-hidden="true"
                          className="ml-1.5 size-1.5 rounded-full bg-destructive"
                        />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="min-w-0 flex-1">
                  {visibleFieldTabGroups.map((group) => (
                    <TabsContent
                      key={group.key}
                      value={group.key}
                      forceMount
                      className="mt-0 data-[state=inactive]:hidden"
                      data-testid={`form-tab-panel:${group.key}`}
                    >
                      {group.description && (
                        <p className="mb-3 text-sm text-muted-foreground">{group.description}</p>
                      )}
                      <div className={group.containerClass || fieldGridClass}>
                        {group.fields.map(renderFormField)}
                      </div>
                    </TabsContent>
                  ))}
                </div>
              </Tabs>
              )}
            </>
          ) : fieldPaneGroups ? (
            // Split field layout (#2153): one <form>, one react-hook-form
            // instance, N resizable panels. The <form> wraps the GROUP and the
            // panels hold only fields, so the split is purely presentational —
            // it cannot influence which values a submit collects.
            <>
              {unpanedFields.length > 0 && (
                <div className={cn(fieldGridClass, 'mb-4')}>
                  {unpanedFields.map(renderFormField)}
                </div>
              )}
              <ResizablePanelGroup
                orientation={schema.fieldPanesOrientation === 'vertical' ? 'vertical' : 'horizontal'}
                className="min-h-[300px] rounded-lg border"
              >
                {fieldPaneGroups.map((group, index) => (
                  <React.Fragment key={group.key}>
                    {index > 0 && (
                      <ResizableHandle
                        withHandle={schema.fieldPanesResizable !== false}
                        disabled={schema.fieldPanesResizable === false}
                      />
                    )}
                    <ResizablePanel defaultSize={group.defaultSize} minSize={group.minSize}>
                      {/* Each pane is its own `@container`: a pane's field grid
                          must measure the PANE, so a 2-column group collapses to
                          one when the divider is dragged narrow — measuring the
                          whole form would keep it 2-up and overflow. */}
                      <div
                        className={cn('@container p-4', group.containerClass || fieldGridClass)}
                        data-testid={`form-pane:${group.key}`}
                      >
                        {group.fields.map(renderFormField)}
                      </div>
                    </ResizablePanel>
                  </React.Fragment>
                ))}
              </ResizablePanelGroup>
            </>
          ) : (
            // Otherwise render fields from schema — one grid per block, split
            // where an untitled run leaves a heading (objectui#11777).
            renderFieldBlocks(fields as FormFieldConfig[])
          )}

          {/* Form Actions */}
          {(schema.showActions !== false) && (
            <div
              className={cn(
                `flex flex-col sm:flex-row gap-2 ${layout === 'horizontal' ? 'sm:justify-end' : 'sm:justify-start'} mt-6`,
                schema.mobileStickyActions &&
                  'sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur border-t md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:border-0 md:backdrop-blur-none',
              )}
              data-testid={schema.mobileStickyActions ? 'form-mobile-sticky-actions' : undefined}
            >
              {showCancel && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting || disabled}
                  className="w-full sm:w-auto"
                >
                  {/* `??`, not `||`: an authored `cancelLabel: ''` is an
                      explicit choice (an icon-only / deliberately blank
                      button), not "unset". Only null/undefined falls back. */}
                  {cancelLabel ?? t('common.cancel')}
                </Button>
              )}
              {showSubmit && (
              <Button
                type="submit"
                disabled={isSubmitting || disabled}
                className="w-full sm:w-auto"
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitLabel ?? t('common.submit')}
              </Button>
              )}
            </div>
          )}
        </form>
      </Form>
    );
  },
  {
    namespace: 'ui',
    label: 'Form',
    inputs: [
      { 
        name: 'fields', 
        type: 'array', 
        description: 'Array of field configurations with name, label, type, validation, etc.'
      },
      { 
        name: 'defaultValues', 
        type: 'object', 
        description: 'Object with default values for form fields'
      },
      { name: 'submitLabel', type: 'string' },
      { name: 'cancelLabel', type: 'string' },
      { name: 'showCancel', type: 'boolean' },
      { 
        name: 'layout', 
        type: 'enum', 
        enum: ['vertical', 'horizontal']      },
      { 
        name: 'columns', 
        type: 'number', 
        
        
        description: 'For multi-column layouts (1-4)'
      },
      { 
        name: 'validationMode', 
        type: 'enum',
        enum: ['onSubmit', 'onBlur', 'onChange', 'onTouched', 'all']      },
      { name: 'resetOnSubmit', type: 'boolean' },
      { name: 'disabled', type: 'boolean' },
      { name: 'className', type: 'string' },
      { name: 'fieldContainerClass', type: 'string' },
      { name: 'children', type: 'slot', description: 'Authored form body, rendered in place of the generated field list' }
    ],
    defaultProps: {
      submitLabel: 'Submit',
      cancelLabel: 'Cancel',
      showCancel: false,
      layout: 'vertical',
      columns: 1,
      validationMode: 'onSubmit',
      resetOnSubmit: false,
      disabled: false,
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'input',
          required: true,
          placeholder: 'Enter your name',
        },
        {
          name: 'email',
          label: 'Email',
          type: 'input',
          inputType: 'email',
          required: true,
          placeholder: 'Enter your email',
        },
      ],
    },
  }
);

// Helper function to render field components with proper typing
interface RenderFieldProps {
  inputType?: string;
  options?: SelectOption[];
  placeholder?: string;
  value?: any;
  onChange?: (value: any) => void;
  disabled?: boolean;
  readonly?: boolean;
  /**
   * Active validation message, forwarded to registered widgets under the name
   * `@objectstack/spec/ui`'s `FieldWidgetPropsSchema` gives it (objectui#3222).
   */
  error?: string;
  /**
   * The field's authored label (objectui#3393). Renderer-only: consumed by the
   * built-in `textarea` branch's fullscreen dialog, stripped before the DOM and
   * before every registered widget (which reads it off `field`).
   */
  label?: string;
  [key: string]: any;
}

// Native date/time inputs only open their picker when the user clicks the tiny
// calendar/clock icon. For these types we open the picker on any click inside the
// box so they behave like the other field widgets (click-anywhere-to-edit).
const NATIVE_PICKER_INPUT_TYPES = new Set(['date', 'datetime-local', 'time', 'month', 'week']);

/**
 * Field types whose native `<input type>` the `default` branch must resolve
 * from the field's own declared `type` (objectui#5254).
 *
 * Both are declared field types in `@object-ui/types`
 * (`EmailFieldMetadata` / `PasswordFieldMetadata`), and both used to reach a
 * native input only by ACCIDENT: the bare-name fallback handed the field to
 * the `ui`-namespace SDUI node renderer registered under the same short name
 * (./input.tsx), which hard-codes `inputType`. With that fallback gone
 * (see `renderFieldComponent`) they take this branch, where `inputType` is
 * whatever the AUTHOR wrote — `undefined` for a plain
 * `{ name, type: 'password' }`, which would render `type="text"` and put a
 * secret on screen in clear text.
 *
 * So this table is not a new tolerance (AGENTS.md #0.1): it is what keeps the
 * VISIBLE rendering of these two types byte-identical to what the fallback
 * produced, while the leak and the duplicate `<label>` go away. An explicitly
 * authored `inputType` still wins over it.
 *
 * Deliberately narrow. Every other declared field type with a native HTML
 * equivalent (`url`, `phone`, `number`, `color`, `date` …) ALREADY takes this
 * branch as `type="text"` on the built-in path and is untouched by
 * objectui#5254 — widening the table beyond a SECRET would change fields no
 * card has moved or measured.
 *
 * ## The two secret spellings added by objectui#5375 (maintainer ruling of
 * 2026-08-20, half A — defense in depth)
 *
 * Measured on `main` at f2e11ae6f, on the built-in path, all three of these
 * put the value on screen as `type="text"`:
 *
 *   ui:password    registry hit = TRUE    rendered type="text"
 *   secret         registry hit = false   rendered type="text"
 *   field:secret   registry hit = false   rendered type="text"
 *
 *  - **`secret`** is the ObjectQL field type. `mapFieldTypeToFormType` maps it
 *    to `field:password`, so an OBJECT-derived secret field is already safe —
 *    it arrives here as `password`. What was not safe is a hand-authored
 *    `{ name, type: 'secret' }` in a standalone `FormSchema`, which reaches
 *    this table under its own name and missed it.
 *  - **`ui:password`** is keyed RAW, not as a declared type, and that is
 *    deliberate: {@link normalizeFieldType} strips only `field:` (the one
 *    namespace that means "field widget", objectui#5254), so a `ui:`-qualified
 *    id arrives here unstripped. It is NOT given a namespace-stripping rule of
 *    its own — that would re-open the cross-namespace resolution #5254
 *    deliberately removed, and would silently move `ui:email`, `ui:date` and
 *    every other `ui:*` id this card never measured.
 *
 * `ui:password` is ALSO refused at authoring time as of the same card (half C,
 * `validateFormSchema` in `@object-ui/core`): a namespaced id that is not
 * `field:` resolves no field widget and is an authoring error. This entry is
 * the defense-in-depth half — validation is advisory at render time, so a host
 * that never validates still must not leak, and an existing author who wrote
 * the spelling needs no migration to keep a working (masked) field.
 */
const NATIVE_INPUT_FIELD_TYPES: Record<string, string> = {
  email: 'email',
  password: 'password',
  // objectui#5375 — see the two paragraphs above. `secret` is a DECLARED type
  // key (so `field:secret` normalizes into it too); `ui:password` is a RAW key.
  secret: 'password',
  'ui:password': 'password',
};

/**
 * Declared field types whose VALUE is a SECRET — objectui#5322.
 *
 * The one type family where "render something plausible" is the wrong answer.
 * Every other type in this branch degrades to a text box that is merely LESS
 * capable than the widget the author declared; a `password` degrades to a text
 * box that PUTS THE SECRET ON SCREEN, and does it in the shape the author is
 * least likely to notice (an input, in the right slot, with the right label).
 *
 * Membership is the declared type — the `field:` prefix already stripped by
 * {@link normalizeFieldType} — so each entry answers both its spellings.
 * An OBJECT-derived secret field reaches this set as `password`, because
 * `mapFieldTypeToFormType` maps the ObjectQL `secret` type to `field:password`.
 *
 * `secret` itself joined the set with objectui#5375 (half A), for the spelling
 * that mapping never sees: a hand-authored `{ name, type: 'field:secret' }` in
 * a standalone `FormSchema`. It is a registry key naming a widget nothing
 * registers, so — exactly like `field:password` — reaching the default branch
 * with it proves the declared widget is absent, and the value is refused rather
 * than rendered. The BARE `secret` spelling is not refused: it claims no
 * registered widget at all, so this branch is its intended home and
 * `NATIVE_INPUT_FIELD_TYPES` above renders it as the native masked input, the
 * same answer a bare `password` gets.
 *
 * Only members reached with a `field:` prefix are refused — see the gate in
 * `renderFieldComponent`'s `default` arm — so adding a non-`field:` spelling
 * here would be a dead entry. `ui:password` is therefore handled by
 * `NATIVE_INPUT_FIELD_TYPES` alone, and not listed here.
 */
const SECRET_FIELD_TYPES = new Set(['password', 'secret']);

/**
 * `field:<type>` ids already reported missing, keyed by widget id + field name.
 *
 * Module-level and de-duplicated for the reason `_reportedUnrecognizedRules`
 * above is: a schema-driven caller re-renders this field on every keystroke
 * elsewhere on the form, and a diagnostic that repeats forever gets muted by
 * the very reader it is written for (objectui#3965).
 */
const _reportedMissingSecretWidgets = new Set<string>();

/**
 * Report a missing SECRET field widget — loudly, once per widget id + field.
 *
 * NOT dev-gated, unlike {@link reportUnrecognizedRulesOnce}. That one is a
 * metadata lint whose audience is the author at their desk; this one is a
 * REGISTRATION failure on a security-relevant field, and an app that reaches
 * production in this state is exactly the one whose console should say so.
 * Same call this file's spec-vocabulary boundary (#3090) and
 * `RetiredFieldTombstone` (`packages/fields`, objectui#4814) already made for
 * the same class of entry — one this renderer cannot honour.
 */
function reportMissingSecretWidget(widgetType: string, fieldName: string): void {
  const memo = `${widgetType}::${fieldName}`;
  if (_reportedMissingSecretWidgets.has(memo)) return;
  _reportedMissingSecretWidgets.add(memo);
  // The message doubles as the fix instruction — it is what an agent
  // iterating on the metadata (or on the host bootstrap) will read and follow.
  console.error(
    `[object-ui] form field '${fieldName}': widget '${widgetType}' is NOT registered, so this ` +
      `form has no widget for a SECRET value. The field renders a refusal instead of an input — ` +
      `the default input branch would render it as \`type="text"\` and put the secret on screen ` +
      `in clear text (objectui#5322). Register the field widgets — \`registerAllFields()\` from ` +
      `\`@object-ui/fields\` — so '${widgetType}' resolves. In a hand-authored standalone form, ` +
      `write the built-in spelling \`{ type: 'password' }\` instead, which renders the native ` +
      `masked input on this branch.`,
  );
}

/**
 * The refusal a `field:`-namespaced SECRET field renders when its widget is not
 * registered — objectui#5322.
 *
 * Shape borrowed from `RetiredFieldTombstone` (`packages/fields`) and this
 * file's own spec-vocabulary boundary (#3090), this repo's settled answer to
 * "an authored entry this renderer cannot honour": an inline alert that NAMES
 * the offending entry, plus a `console.error` whose text doubles as the fix
 * instruction. Nothing is thrown — one unrenderable field must not take down
 * the rest of the record form — and nothing is silently substituted, which is
 * the whole point.
 *
 * A COMPONENT, not inline JSX, for the same reason `BuiltinSelectEmptyState`
 * above is one: `renderFieldComponent` is a plain helper that early-returns, so
 * a hook called there would run conditionally (rules-of-hooks).
 *
 * `...rest` is forwarded because `<FormControl>` is a Radix `Slot`: it hands the
 * control its `id` / `aria-describedby` / `aria-invalid`, so dropping the rest
 * props here would unlink the field's own label and error message. What is
 * deliberately NOT forwarded is the field's `value`/`onChange` bundle — the
 * point of the refusal is that the secret reaches no element at all, so this
 * component is handed the two identifying strings and nothing else.
 */
function MissingSecretFieldWidget({
  widgetType,
  fieldName,
  className,
  ...rest
}: {
  widgetType: string;
  fieldName: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  React.useEffect(() => {
    reportMissingSecretWidget(widgetType, fieldName);
  }, [widgetType, fieldName]);
  return (
    <div
      role="alert"
      data-testid="field-missing-secret-widget"
      data-missing-field-widget={widgetType}
      className={cn(
        'rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive',
        className,
      )}
      {...rest}
    >
      {`This field was not rendered: its widget \`${widgetType}\` is not registered. ` +
        `Register the field widgets (\`registerAllFields()\` from \`@object-ui/fields\`). ` +
        `A secret is never rendered in a plain text box.`}
    </div>
  );
}

function openNativePickerOnClick(inputType: string | undefined) {
  if (!inputType || !NATIVE_PICKER_INPUT_TYPES.has(inputType)) return undefined;
  return (e: React.MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (el.disabled || el.readOnly) return;
    try {
      (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // Browsers throw when the picker can't be shown; the native icon still works.
    }
  };
}

/**
 * The built-in (unregistered) `select` branch's empty state — objectui#3263.
 *
 * A component rather than an inline `<div>` because the copy has to go through
 * `useSafeFormTranslation()`, and `renderFieldComponent` below is a plain
 * helper, not a component: it early-returns on the registered-widget path, so a
 * hook called there would run conditionally (rules-of-hooks). Owning the box
 * gives the hook a legitimate home without changing what the branch renders.
 *
 * The host's `emptyHint` still wins when it computed one (the #2284 dependency
 * gate, already translated via `fields.options.selectFirst`); this only
 * translates the branch's OWN fallback, which was the last hardcoded English
 * copy of that sentence in this file.
 *
 * Deliberately NOT `packages/fields`' `OptionsEmptyState`: different package,
 * different render path (this is the inline `BUILTIN_FIELD_TYPES` branch, that
 * one the registry). What the two share is the i18n KEY, not a component —
 * unifying them would impose one path's styling and props on the other.
 *
 * `...rest` is forwarded because `<FormControl>` is a Radix `Slot`: it hands the
 * control its `id` / `aria-describedby` / `aria-invalid`, so dropping the rest
 * props here would silently unlink the field's own label and error message.
 */
function BuiltinSelectEmptyState({
  emptyHint,
  className,
  ...rest
}: { emptyHint?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const { t } = useSafeFormTranslation();
  return (
    <div className={cn('text-sm text-muted-foreground', className)} {...rest}>
      {emptyHint || t('fields.options.empty')}
    </div>
  );
}

/**
 * The built-in (unregistered) `select` branch's control — objectui#3976.
 *
 * Radix's `Select.Root` renders NO DOM element of its own, so every prop it does
 * not recognise is silently DROPPED instead of reaching an element. The branch
 * used to spread its whole DOM pass-through onto that Root, which is where
 * `<FormControl>`'s Slot puts the field's `id` / `aria-describedby` /
 * `aria-invalid` and the call site puts `aria-required` — so a bare
 * `{ type: 'select' }` rendered a visible `<FormLabel for="…-form-item">`
 * pointing at an id NO element carried: the label was inert (clicking it did
 * nothing) and the field had no accessible name, no error link and no required
 * state at all.
 *
 * This is the exact mechanism objectui#3306 fixed on the WIDGET side
 * (`SelectField` routes its pass-through to `SelectTrigger`); the built-in
 * branch never followed, and the two `select` paths diverge because
 * `BUILTIN_FIELD_TYPES` contains `'select'` — so a bare `type: 'select'` never
 * consults the registry while an object-driven `field:select` does.
 *
 * A component (rather than inline JSX in the branch) is what makes the fix
 * possible at all: the Slot injects into whatever ELEMENT the branch returns, so
 * only a component boundary can receive those props and re-address them. Same
 * reason `BuiltinSelectEmptyState` above is a component.
 *
 * The pass-through lands on `SelectTrigger` — the focusable
 * `<button role="combobox">` the user and their screen reader actually interact
 * with — with the same two deliberate exceptions #3306 kept on Root:
 *
 *  - `name`: the one key Root genuinely consumes — it forwards it to the hidden
 *    native `<select>` that takes part in form submission. On the trigger it
 *    would sit uselessly on a non-submitter `<button>`.
 *  - `disabled`: Root is the single authority (it disables trigger, items and
 *    the hidden select together), so the raw prop must not get a second author.
 *
 * `ref` rides the pass-through for the same reason the `aria-*` do: react-hook-form
 * hands every field a `ref` and this branch dropped it on Root, so the built-in
 * select was the one built-in control RHF could not focus. Forwarded here to the
 * trigger, exactly like `input`/`textarea` hand theirs to a real element.
 */
type BuiltinSelectControlProps = {
  options: SelectOption[];
  placeholder?: string;
  /** The AUTHORED value — stringified for Radix on the way in (#3090). */
  value?: OptionValue | null;
  /** Receives the AUTHORED option value, not Radix's string (#3090). */
  onValueChange?: (next: OptionValue) => void;
  disabled?: boolean;
} & Omit<
  React.ComponentPropsWithoutRef<typeof SelectTrigger>,
  'value' | 'onValueChange' | 'disabled' | 'children'
>;

const BuiltinSelectControl = React.forwardRef<HTMLButtonElement, BuiltinSelectControlProps>(
  function BuiltinSelectControl(
    { options, placeholder, value, onValueChange, disabled, name, className, ...triggerDomProps },
    ref,
  ) {
    return (
      // Radix speaks strings: stringify going in, map the selection back to
      // the AUTHORED option value coming out, so a numeric/boolean option
      // round-trips typed instead of morphing to "2" in the payload (#3090).
      <Select
        name={name}
        value={toControlValue(value)}
        onValueChange={(v) => onValueChange?.(matchOptionValue(options, v))}
        disabled={disabled}
      >
        <SelectTrigger
          ref={ref}
          {...triggerDomProps}
          // `cn`-merged rather than spread-ordered: an authored `className` must
          // be able to override the touch-target height without deleting it by
          // accident, and this prop reached no element before the fix.
          className={cn('min-h-[44px] sm:min-h-0', className)}
        >
          {/* No `|| 'Select an option'` — objectui#3272. The single call site
              already supplies `t('common.selectOption')` for `select`, so the
              literal was all but unreachable; the ONE stack that did reach it
              was an authored `placeholder: ''` (the call site's `??` keeps an
              empty string), where a second fallback overrode the author's
              explicit blank with an untranslated English word. */}
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt: SelectOption) => (
            <SelectItem key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
);

/**
 * The `step` of a number input this renderer draws itself: the `input` arm,
 * and the unregistered-widget `default` arm, under `inputType: 'number'`
 * (objectui#12130).
 *
 * The registered `number` widget's rule, read off the same metadata carrier
 * (`field`, which the call site sets to `field.field || field`): an explicit
 * numeric `step` wins (the spec's `FieldSchema.step`, which `FormField`
 * declares by reference), else `10^-scale` (decimal places, never
 * `precision`'s total digits, objectui#9574), else `'any'`. Not an absent
 * attribute: that is HTML's step of 1, which refuses every decimal a field
 * that declares no `scale` never ruled out. This package cannot import
 * `NumberField`, so the rule is restated here; keep the two in step.
 *
 * Derived where it is consumed, so no producer writes the HTML-only `'any'`
 * onto an entry, where the spec's numeric `step` refuses it. `ObjectForm`
 * wrote it until objectui#12130; `objectFormNumericStep-9574.test.tsx` pins
 * both of its routes.
 */
function nativeNumberStep(carrier: Record<string, unknown> | undefined): number | 'any' {
  const step = carrier?.step;
  if (typeof step === 'number') return step;
  const scale = carrier?.scale;
  return typeof scale === 'number' ? Math.pow(10, -scale) : 'any';
}

function renderFieldComponent(type: string, props: RenderFieldProps) {
  // 1. Resolve the specialized FIELD WIDGET — and only a field widget.
  //    A form field's type either names a `field:`-namespaced widget or takes
  //    the declared `default` input branch below; it never resolves a plain
  //    SDUI node renderer (objectui#5254, maintainer ruling of 2026-08-19 —
  //    option B of the measured option set).
  //
  //    The bare `field:<type>` preference was always the point (so { type:
  //    'text' } in a form schema resolves to the text INPUT, not the display
  //    `text` widget sharing that short name in the global registry). What is
  //    gone is the `|| ComponentRegistry.get(type)` tail behind it: a form
  //    field that missed the `field:` namespace fell through to whatever
  //    happened to hold the bare name in ANY namespace, which is a
  //    cross-namespace fallback no contract states.
  //
  //    Measured on `origin/main` at 3fbbea1f3, that tail answered 126 bare
  //    names on the built-in (no-`registerAllFields()`) path — `div`, `h1`,
  //    `card`, `button`, even `form` — and 116 of them with the fields package
  //    registered too. The two that mattered in practice were `email` and
  //    `password`, registered as `ui`-namespace SDUI node renderers for
  //    top-level `{ type: 'email' }` nodes (see ./input.tsx). Reached as a
  //    FIELD they got the field-widget prop bundle they do not implement and
  //    spread it straight onto the element, so a hand-authored
  //    `{ name, type: 'email', max_length: 50 }` rendered:
  //
  //      attrs=["class","id","max_length","field","aria-describedby",
  //             "aria-invalid","type","value","name"]   maxlength=null
  //
  //    i.e. the raw metadata OBJECT as `field="[object Object]"`, an inert
  //    `max_length` that capped nothing, and — because that renderer draws its
  //    own `<Label>` on top of the form's `<FormLabel>` — a SECOND `<label>`
  //    naming the same control.
  //
  //    A `field:` entry is a FIELD WIDGET (`FieldWidgetComponentProps`, whose
  //    metadata carrier is `field` and nothing else since v17), which is now
  //    the only contract this function dispatches to. `resolveFieldLabelling`
  //    and `resolvesToRegisteredFieldWidget` above mirror this resolution and
  //    already spelled the rule this way; they now agree with it exactly.
  const namespacedWidget = !BUILTIN_FIELD_TYPES.has(type) && !type.includes(':')
    ? ComponentRegistry.get(`field:${type}`)
    : undefined;
  // A colon-qualified type resolves directly, and only when it names the
  // `field` namespace (`type: 'field:textarea'`). `ui:email` is not a field
  // widget any more than the bare `email` was.
  const RegisteredComponent = !BUILTIN_FIELD_TYPES.has(type)
    ? (namespacedWidget || (type.startsWith('field:') ? ComponentRegistry.get(type) : undefined))
    : undefined;

  if (RegisteredComponent) {
    // `field` is the single metadata carrier (objectui#3233). It rides in
    // `registeredProps` untouched — the caller always sets it (`field.field
    // || field`, i.e. the raw metadata object, never undefined) and
    // `stripRegisteredFieldProps` keeps it.
    //
    // This used to ALSO pass `schema={props.field || props.schema || props}`,
    // a second key carrying the *same* object: `props.field` is truthy at the
    // only call site, so the two chain terms after it were unreachable and
    // `schema` was always `=== props.field`. Widgets therefore resolved
    // `field || schema` to `field` on this path every time — which is why
    // dropping the key here changes no payload, only the number of spellings
    // a widget author has to know.
    return <RegisteredComponent {...stripRegisteredFieldProps(type, props)} />;
  }

  const { inputType, options = [], placeholder, readonly, emptyHint, ...fieldProps } = props;
  // What reaches the control is an ALLOWLIST (objectui#12155): the family's
  // form-control set (`id`, `className`, `name`, `disabled`, the handlers,
  // `aria-*`, `data-*`), plus, per host, the attributes in
  // `BUILTIN_HOST_ATTRIBUTES`. Every other leftover key of the entry stays off
  // the DOM, a field-level `defaultValue` / `defaultChecked` included, so the
  // control never draws a value the form does not hold.
  const domFieldProps: Record<string, any> = toFormControlDomProps(fieldProps);
  // react-hook-form's binding, handed to each control BY NAME. The allowlist
  // keeps `name`, `disabled` and `onBlur`; these three it drops, because they
  // are the control's state and its ref, not attributes.
  const { value, onChange, ref: controlRef } = fieldProps;
  // Text-like controls get a real readonly treatment (native `readOnly` +
  // a soft, non-"disabled" tint) instead of being grayed out. Toggle/choice
  // controls (checkbox/switch/select) have no meaningful "look but don't
  // touch" state of their own, so for those `readonly` falls back to disabled.
  const readonlyInputClass = readonly && 'bg-muted/40 cursor-default focus-visible:ring-0';

  switch (type) {
    case 'input': {
      // The declared ceiling is resolved HERE rather than left to ride the
      // pass-through onto the DOM (objectui#5201). This is the same mechanism
      // the `textarea` branch below resolves for the same reason
      // (objectui#3439) — this branch was deliberately left out of that card
      // because the COUNTER half is a design question for a single-line input;
      // the ceiling half is not.
      //
      // The spec's `maxLength` — which `FormField` declares by reference to
      // `FieldSchema.maxLength` — is the one spelling read. The snake_case
      // `max_length` this branch also read until objectui#11070 is retired,
      // with no alias: `FieldSchema` and the strict authoring face refuse it
      // by name, no objectui type declares it, and no in-repo producer writes
      // it. The local strip that kept it off the element went with the read,
      // so nothing in this branch names it any more.
      //
      // Scope: the CEILING only. Whether a single-line input should also carry
      // a visible `{n}/{max}` counter and an announced limit the way the
      // `textarea` branch does is an independent design trade-off that does
      // NOT follow from #3439's conclusion, and is deliberately not decided
      // here (the objectui#5201 triage ruling).
      const maxLength = (fieldProps as any).maxLength;
      if (inputType === 'file') {
        // File inputs cannot be controlled with value prop, so `value` is not
        // passed. No cap applies to a file picker. The entry's `className` is
        // merged in, not spread over (objectui#12130).
        return (
          <Input
            type="file"
            placeholder={placeholder}
            {...domFieldProps}
            {...builtinHostAttributes(fieldProps, 'input')}
            className={cn('min-h-[44px] sm:min-h-0', domFieldProps.className)}
            ref={controlRef}
            onChange={onChange}
          />
        );
      }
      return (
        <Input
          type={inputType || 'text'}
          placeholder={placeholder}
          {...domFieldProps}
          {...builtinHostAttributes(fieldProps, 'input')}
          // After the spread, and MERGED: an entry's `className` adds to this
          // branch's own classes instead of replacing them (objectui#12130).
          // Every built-in branch writes it this way.
          className={cn('min-h-[44px] sm:min-h-0', readonlyInputClass, domFieldProps.className)}
          ref={controlRef}
          onChange={onChange}
          // After the spread, so the resolved cap is the one written (the
          // #3222 discipline). `undefined` when the field declares no
          // `maxLength`, which renders no attribute.
          maxLength={maxLength}
          // After the spread too: a number input's step is resolved from the
          // metadata carrier, not taken from whatever the entry spread
          // (objectui#12130, `nativeNumberStep`).
          {...(inputType === 'number' ? { step: nativeNumberStep(fieldProps.field) } : null)}
          onClick={(e) => {
            openNativePickerOnClick(inputType)?.(e);
            domFieldProps.onClick?.(e);
          }}
          readOnly={readonly}
          value={value ?? ''}
        />
      );
    }

    case 'textarea': {
      // `mobile_fullscreen` is the flag's ONE spelling (objectui#3303). This
      // branch used to read `mobile_fullscreen || fullscreen`; the second term
      // had no producer anywhere in this repo or in `@objectstack/spec` — the
      // only `fullscreen` properties that exist belong to the unrelated
      // feedback/loading overlay — so it was undefined from the day it was
      // written, while advertising a spelling that silently does nothing to
      // whoever reads this file next (AGENTS.md #0.1). `ObjectForm` is the sole
      // producer and it stamps `mobile_fullscreen` (#3245/#3300), which is also
      // the single spelling `TextAreaField` and `RichTextField` read.
      //
      // `label` rides the same way: read off `fieldProps`, because the DOM
      // allowlist (`toFormControlDomProps`) keeps it off the control
      // (objectui#3393, objectui#12155). It used to be discarded by a local
      // `const { label: _label, ...rest }` on the next line — which ESLint
      // flagged as an unused binding, correctly: the call site never forwarded
      // a `label`, so the guard was defending against something that never
      // arrived, while every OTHER built-in branch had no guard at all. Now the
      // allowlist keeps it off the DOM for all branches.
      //
      // `error` rides the same way, and for the same reason (objectui#4824):
      // the allowlist drops it because the INLINE control takes
      // its `aria-invalid` from `<FormControl>`'s Slot and would only gain a
      // stray `error="…"` attribute. The fullscreen DIALOG's control is built
      // from scratch inside this branch, reaches no Slot, and so had no way to
      // say the field had failed — measured announcing nothing at all while the
      // inline control announced `aria-invalid="true"` for the same field. The
      // primitive, not this branch, decides what to do with it.
      //
      // `maxLength` is resolved HERE rather than left to ride `rest` onto the
      // DOM (objectui#3439): it has three readers in this branch — the native
      // attribute on each of the two textareas, and the counter beside them.
      // The spec's `maxLength` — which `FormField` declares by reference to
      // `FieldSchema.maxLength` — is the one spelling read, as in the
      // registered `field:textarea` widget. The snake_case `max_length` this
      // branch also read until objectui#11070 is retired, with no alias: the
      // spec and the strict authoring face refuse it by name, no objectui type
      // declares it, and no in-repo producer writes it. The local strip that
      // kept it off the element went with the read.
      const { mobile_fullscreen, label, error } = fieldProps as any;
      const maxLength = (fieldProps as any).maxLength;
      const rest = { ...domFieldProps, ...builtinHostAttributes(fieldProps, 'textarea') };
      if (mobile_fullscreen) {
        return (
          <FullscreenTextarea
            placeholder={placeholder}
            label={label}
            error={error}
            {...rest}
            // `readonly` is destructured off `props` at the top of this
            // function, so — exactly like `label` and `mobile_fullscreen` — it
            // is NOT in `rest` and has to be forwarded by name (objectui#3400).
            // The non-fullscreen exit below always did this; this exit forwarded
            // neither the attribute nor the tint, which is why a read-only long
            // text field was editable in place the moment the fullscreen flag
            // was on. (`disabled` rides `rest`: the allowlist keeps it.) The
            // entry's `className` is merged in, not spread over (objectui#12130).
            className={cn('min-h-[44px] sm:min-h-0', readonlyInputClass, rest.className)}
            ref={controlRef}
            onChange={onChange}
            // After the spread, so the resolved cap is the one written (the
            // #3222 discipline).
            maxLength={maxLength}
            readOnly={readonly}
            value={value ?? ''}
          />
        );
      }
      return (
        <BuiltinTextarea
          placeholder={placeholder}
          {...rest}
          className={cn('min-h-[44px] sm:min-h-0', readonlyInputClass, rest.className)}
          ref={controlRef}
          onChange={onChange}
          maxLength={maxLength}
          readOnly={readonly}
          value={value ?? ''}
        />
      );
    }

    case 'checkbox': {
      // For checkbox, we need to handle the value differently. `checkboxProps`
      // is the allowlist's output (objectui#12155): an authored
      // `defaultChecked` used to ride it onto Radix's hidden bubble input,
      // checking that input while the visible box stayed unchecked.
      const { disabled: cbDisabled, ...checkboxProps } = domFieldProps;
      return (
        <Checkbox
          checked={value}
          onCheckedChange={onChange}
          disabled={cbDisabled || readonly}
          {...checkboxProps}
          className={cn('min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0', checkboxProps.className)}
          ref={controlRef}
        />
      );
    }

    case 'switch': {
      // For switch, we need to handle the value differently (same as checkbox)
      const { disabled: swDisabled, ...switchProps } = domFieldProps;
      return (
        <Switch
          checked={value}
          onCheckedChange={onChange}
          disabled={swDisabled || readonly}
          {...switchProps}
          className={cn('min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0', switchProps.className)}
          ref={controlRef}
        />
      );
    }

    case 'select': {
      // For select with react-hook-form, we need to handle the onChange
      const { disabled: selDisabled, ...selectProps } = domFieldProps;

      // Safety check for options. When a dependent (cascading) select is still
      // waiting on its controlling field the renderer passes a gate hint (#2284)
      // — surface that instead of the generic "no options" so the user knows to
      // pick the parent first rather than reading it as a broken widget.
      if (!options || options.length === 0) {
        return <BuiltinSelectEmptyState emptyHint={emptyHint} />;
      }

      // The DOM pass-through goes to the CONTROL, not to Radix's element-less
      // Root (objectui#3976) — see `BuiltinSelectControl`. Spread first so the
      // branch's own computations below win over anything the host forwarded,
      // the #3222 discipline.
      return (
        <BuiltinSelectControl
          {...selectProps}
          ref={controlRef}
          options={options}
          placeholder={placeholder}
          value={value}
          onValueChange={onChange}
          disabled={selDisabled || readonly}
        />
      );
    }

    default: {
      // ── The unregistered-widget default, objectui#5322 ──────────────────
      //
      // Two spellings reach this branch and they do NOT mean the same thing,
      // so the ruling of 2026-08-19 is answered on each in its own terms
      // ("the unregistered-widget default must respect the declared input
      // type, OR refuse to render the value rather than degrade to clear
      // text", with "for `password` specifically, prefer masking/refusal over
      // best-effort rendering"):
      //
      //  - A BARE `password` / `email` is a declared input type on the
      //    built-in path. It claims no registered widget, this branch IS its
      //    intended home, and `NATIVE_INPUT_FIELD_TYPES` renders it natively
      //    (objectui#5254). Nothing below changes that — a fix that traded one
      //    spelling for the other would not be a fix.
      //
      //  - A `field:`-prefixed id is a REGISTRY KEY. Reaching this branch with
      //    one is proof of an unmet contract: the app declares a widget that
      //    is not registered (no `registerAllFields()`, or no
      //    `@object-ui/fields` at all). `mapFieldTypeToFormType` emits the
      //    prefixed id for EVERY object-derived form, so this is the normal
      //    path and not an edge case.
      //
      // Measured on this branch point (f2e11ae6f), before the change, with
      // nothing registered under `field:`:
      //
      //   field:password → type="text"   attrs=["class","id",
      //                    "aria-describedby","aria-invalid","type","name"]
      //   field:email    → type="text"
      //   password       → type="password"      (PR5326, unchanged)
      //   email          → type="email"         (PR5326, unchanged)
      //
      // i.e. the object-derived spelling of a password field put the secret on
      // screen in clear text. PRE-EXISTING: `NATIVE_INPUT_FIELD_TYPES` is keyed
      // on the raw type, so the prefixed spelling always missed it — this is
      // not a regression from objectui#5254, which was measured on
      // `origin/main` before that change too.
      //
      // The declared type — the prefix stripped — is what the two halves below
      // read. Only `field:` is stripped (`normalizeFieldType`): it is the one
      // namespace that means "field widget" and the one the producer emits.
      // A `ui:`-qualified id therefore arrives here UNSTRIPPED and is matched
      // raw where it is matched at all (`ui:password`, objectui#5375) — no
      // second namespace gets a stripping rule, because that would re-open the
      // cross-namespace resolution objectui#5254 deliberately removed.
      const declaredType = normalizeFieldType(type);

      // ── Half 1: REFUSE, for a secret ────────────────────────────────────
      // Masking the value would already close the leak the card names, and it
      // is what the bare spelling does. It is not enough HERE, because here we
      // additionally KNOW the app shipped without the widget it declares: a
      // masked box would let the user type a secret into a form whose password
      // widget (its own strength meter, confirm pair, reveal toggle, submit
      // handling) is absent, and would look like it worked. So the value is
      // not rendered at all, in any form, and the refusal says why.
      //
      // Deliberately narrow — the SECRET types only, and only under `field:`.
      // Every other unregistered `field:*` id (`field:currency`,
      // `field:qrcode` …) still renders the text box it renders today: turning
      // the whole class into refusals would change fields no card has moved or
      // measured, the same restraint `NATIVE_INPUT_FIELD_TYPES` above states.
      // `field:secret` joined `SECRET_FIELD_TYPES` with objectui#5375 and so
      // is refused here too; the BARE `secret` spelling is not — it names no
      // registry key, so it takes the native masked input below.
      if (type.startsWith('field:') && SECRET_FIELD_TYPES.has(declaredType)) {
        return (
          <MissingSecretFieldWidget
            widgetType={type}
            fieldName={String(fieldProps.name ?? '')}
          />
        );
      }

      // The declared ceiling is resolved HERE rather than left to ride the
      // pass-through onto the DOM (objectui#5253). Identical mechanism and
      // identical reasons to the `input` branch above (objectui#5201) and the
      // `textarea` branch (objectui#3439) — this fallback was simply out of
      // #5201's scoped surface, so it kept the defect after that card landed.
      //
      // The spec's `maxLength` — which `FormField` declares by reference to
      // `FieldSchema.maxLength` — is the one spelling read. The snake_case
      // `max_length` this branch also read until objectui#11070 is retired,
      // with no alias: the spec and the strict authoring face refuse it by
      // name, no objectui type declares it, and no in-repo producer writes it.
      // The local strip that kept it off the element went with the read.
      const maxLength = (fieldProps as any).maxLength;
      return (
        <Input
          // ── Half 2: RESPECT the declared input type ───────────────────
          // An authored `inputType` first, then the native type this field's
          // own declared `type` names (objectui#5254 — `email` / `password`
          // reach this branch since the cross-namespace fallback was removed,
          // and must keep rendering the native input they always rendered:
          // without this a `type: 'password'` field would show the secret as
          // clear text). `'text'` for everything else, exactly as before.
          //
          // Keyed on `declaredType`, not the raw `type` (objectui#5322): the
          // table's two members are DECLARED FIELD TYPES
          // (`EmailFieldMetadata` / `PasswordFieldMetadata` in
          // `@object-ui/types`), and `field:email` declares `email` just as
          // plainly as a bare `email` does. Before this the prefixed spelling
          // missed the table and lost the native keyboard and validation.
          // `field:password` / `field:secret` never reach here — half 1 above
          // refuses them — so this line answers `field:email`, the bare
          // spellings, and (objectui#5375) the two raw secret spellings
          // `secret` and `ui:password`, which the table now carries.
          type={inputType || NATIVE_INPUT_FIELD_TYPES[declaredType] || 'text'}
          placeholder={placeholder}
          {...domFieldProps}
          {...builtinHostAttributes(fieldProps, 'input')}
          className={cn(readonlyInputClass, domFieldProps.className)}
          ref={controlRef}
          onChange={onChange}
          // `value` as react-hook-form holds it, `undefined` included: this arm
          // has always handed the control the form's value unchanged, and only
          // the form's value (objectui#12155). A field-level `defaultValue`
          // used to reach the element here and draw a value the form did not
          // hold.
          value={value}
          // After the spread, so the resolved cap is the one written (the
          // #3222 discipline). `undefined` when the field declares no
          // `maxLength`, which renders no attribute — an uncapped field is
          // left exactly as it was.
          maxLength={maxLength}
          // The `input` arm's rule (objectui#12130), for an entry that says
          // `inputType: 'number'` and whose type names no registered widget.
          {...(inputType === 'number' ? { step: nativeNumberStep(fieldProps.field) } : null)}
          onClick={(e) => {
            openNativePickerOnClick(inputType)?.(e);
            domFieldProps.onClick?.(e);
          }}
          readOnly={readonly}
        />
      );
    }
  }
}
