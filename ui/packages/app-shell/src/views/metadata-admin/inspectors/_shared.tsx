// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared building blocks for scoped metadata inspectors.
 *
 * Every inspector renders the same three regions:
 *   • Header strip — kind chip + element label + close button
 *   • Scrollable form area — labelled inputs in a single column
 *   • Footer — destructive "remove this element" button
 *
 * The widgets below factor those regions out so each per-type
 * inspector can stay focused on field definitions and update logic.
 *
 * All inputs are uncontrolled-from-outside: parent owns the draft
 * record, inspectors call `onCommit(value)` which trips an immutable
 * splice + `onPatch({...})`. Locale-aware via the `useT` hook the
 * caller already has in scope — the shared shell takes raw strings.
 *
 * The exceptions are DEFAULTS rather than labels a caller hands in: the flag
 * {@link InspectorSelectField} puts on a stored value its roster does not
 * offer (objectui#9652), and the wording a caller may omit — the shell's close
 * label, the reorder pair's names and the roster-failure notice
 * (objectui#10586). Wherever a call site passes none, the default is what a
 * zh-CN author reads, so it resolves through `useMetadataLocale()` — the hook
 * the designer's other shared editors (`widgets.tsx`, `SchemaForm`,
 * `ConditionBuilder`) already read when no `locale` prop reaches them. A label
 * the caller passes always wins.
 */

import * as React from 'react';
import { ArrowDown, ArrowUp, Trash2, X } from 'lucide-react';
import { cn } from '@object-ui/components';
import { Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { type LoadState } from '../loadState.js';
import { t, tFormat, useMetadataLocale, type SupportedLocale } from '../i18n.js';

/* ─────────────── Layout shell ─────────────── */

export interface InspectorShellProps {
  kindLabel: string;
  title: string;
  onClose: () => void;
  /** The close button's accessible name; omitted, `engine.close` in the designer locale. */
  closeLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Optional reorder controls rendered to the left of the close button.
   * Use {@link InspectorReorderButtons} for the standard ↑/↓ pair.
   */
  headerActions?: React.ReactNode;
  /**
   * Hide the close (×) button. Used by "home" inspectors that have no
   * better state to fall back to (e.g. the View inspector is the default
   * right-panel for a view, so closing it would just re-open it).
   */
  hideClose?: boolean;
}

/**
 * objectui#12488 — a host that draws the inspector's frame itself.
 *
 * Studio's Automations pillar mounts the flow inspectors inside its own 300 px
 * aside, whose header already names the selection (eyebrow, title, close). Under
 * this provider {@link InspectorShell} draws no header strip of its own, so the
 * aside shows one header instead of two stacked ones; its header actions, if
 * any, lead the body. The metadata-admin designer provides nothing and keeps
 * the shell's own header.
 *
 * `onSelectionChange` lets a field inside move the host's selection — the
 * decision's branch cards use it to open a connection's own inspector.
 */
export interface InspectorShellHost {
  onSelectionChange?: (selection: { kind: string; id: string; label?: string }) => void;
}

const InspectorShellHostContext = React.createContext<InspectorShellHost | null>(null);

/** Provides {@link InspectorShellHost} to the inspectors below it. */
export function InspectorShellHostProvider({ value, children }: { value: InspectorShellHost; children?: React.ReactNode }) {
  return <InspectorShellHostContext.Provider value={value}>{children}</InspectorShellHostContext.Provider>;
}

/** The host that frames this inspector, or `null` when the shell frames itself. */
export function useInspectorShellHost(): InspectorShellHost | null {
  return React.useContext(InspectorShellHostContext);
}

export function InspectorShell({ kindLabel, title, onClose, closeLabel: closeLabelProp, children, footer, headerActions, hideClose }: InspectorShellProps) {
  const locale = useMetadataLocale();
  const host = useInspectorShellHost();
  const closeLabel = closeLabelProp ?? t('engine.close', locale);
  if (host) {
    return (
      <div className="flex h-full flex-col" data-testid="inspector-shell-hosted">
        <div className="flex-1 space-y-3.5 overflow-auto p-4">
          {headerActions && <div className="flex items-center justify-end gap-1">{headerActions}</div>}
          {children}
        </div>
        {footer && <div className="border-t px-4 py-2.5">{footer}</div>}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{kindLabel}</Badge>
          <div className="mt-1 truncate text-sm font-medium" title={title}>{title}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerActions}
          {!hideClose && (
            <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel} className="h-7 w-7 p-0">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">{children}</div>
      {footer && <div className="border-t px-4 py-2.5">{footer}</div>}
    </div>
  );
}

/* ─────────────── Reorder buttons ─────────────── */

export interface InspectorReorderButtonsProps {
  /** Current 0-based index of the selected item. */
  index: number;
  /** Total number of siblings. */
  total: number;
  /** Called with the new index when the user clicks ↑ or ↓. */
  onMove: (toIndex: number) => void;
  /** Localized aria-labels; omitted, `engine.inspector.reorder.up` / `.down` in the designer locale. */
  upLabel?: string;
  downLabel?: string;
  /** Disable both buttons (read-only inspectors). */
  disabled?: boolean;
}

/**
 * Compact ↑/↓ pair sized to fit alongside the close button in the
 * inspector header. Auto-disables boundaries (↑ at index 0, ↓ at
 * `total - 1`) and the whole pair when `total <= 1`.
 */
export function InspectorReorderButtons({
  index,
  total,
  onMove,
  upLabel: upLabelProp,
  downLabel: downLabelProp,
  disabled,
}: InspectorReorderButtonsProps) {
  // Read before the early return: a hook's call order may not depend on props.
  const locale = useMetadataLocale();
  if (total <= 1 || index < 0) return null;
  const upLabel = upLabelProp ?? t('engine.inspector.reorder.up', locale);
  const downLabel = downLabelProp ?? t('engine.inspector.reorder.down', locale);
  const canUp = !disabled && index > 0;
  const canDown = !disabled && index < total - 1;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => canUp && onMove(index - 1)}
        disabled={!canUp}
        aria-label={upLabel}
        title={upLabel}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => canDown && onMove(index + 1)}
        disabled={!canDown}
        aria-label={downLabel}
        title={downLabel}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </>
  );
}

/* ─────────────── Form atoms ─────────────── */

/**
 * Every atom below that renders a `<Label>` as a SIBLING of its control mints
 * its own id with `React.useId()` and closes the pair (`htmlFor` ⇄ `id`).
 * Visual adjacency is not an association: without it assistive tech reads an
 * anonymous "edit box" and the visible label is unowned text, and clicking the
 * label does nothing (objectui#3994).
 *
 * The id is minted INSIDE the atom rather than taken as a prop on purpose:
 * these atoms are rendered in loops over array items (`page:tabs.items[i]`,
 * `record:details.sections[i]`), where a caller-supplied id is the one thing a
 * caller can get wrong — two items sharing a label would share an id and the
 * second label would silently point at the first control. `useId()` is unique
 * per instance by construction, so there is no way to author a collision.
 * A future `aria-describedby` (e.g. the validation messages of objectui#3912)
 * belongs to the same atom and can derive from this same private id; exposing
 * the id would only be required if the association had to be made from
 * OUTSIDE, which no call site needs.
 *
 * `InspectorCheckboxField` stays on the wrapping-`<label>` form — that is
 * already a valid association and needs no id.
 */

/**
 * The metadata form's required marker, for an inspector label (objectui#10948).
 *
 * The markup is `SchemaForm`'s own — the `*` its `FieldRow` puts inside a
 * required field's label, and its repeater puts in a required column's header —
 * so an inspector marks a required key the way the rest of the designer does,
 * not in a second visual idiom. Visual-only, as there (objectui#10367): it sits
 * inside the text that names the control, so it is `aria-hidden`, and an atom
 * that owns its control carries the requirement as `aria-required` instead.
 */
export function RequiredMarker() {
  return (
    <span className="text-destructive ml-0.5" aria-hidden="true" data-required-marker="true">*</span>
  );
}

export function InspectorTextField({
  label,
  value,
  onCommit,
  onBlur,
  placeholder,
  disabled,
  mono,
  testId,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  /** Fired on blur with the final value — e.g. to derive a dependent field. */
  onBlur?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  /** Stable hook for e2e/dogfood selectors. */
  testId?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        onBlur={(e) => onBlur?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        className={cn('h-8 text-sm', mono && 'font-mono')}
      />
    </div>
  );
}

export function InspectorNumberField({
  label,
  value,
  onCommit,
  placeholder,
  disabled,
  required,
}: {
  label: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Mark the field required: {@link RequiredMarker} in the label, `aria-required` on the input. */
  required?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {required && <RequiredMarker />}
      </Label>
      <Input
        id={id}
        aria-required={required ? true : undefined}
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onCommit(v === '' ? undefined : Number(v));
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 text-sm"
      />
    </div>
  );
}

/**
 * What {@link InspectorSelectField} is entitled to say about a stored value,
 * derived from the ONE state its roster is in.
 *
 * `silent` — no claim may be made: the question is unasked or still out.
 * `answered` — the roster spoke, so "not offered" is a fact it can testify to.
 * `failed` — the question was not answered at all, and that is its own fact.
 */
type RosterVerdict = 'silent' | 'answered' | 'failed';

/**
 * ⭐ The whole repair for objectui#9651 is that this reads ONE value.
 *
 * The defect it closes was a *combination* defect: `options: []` plus
 * `loading: false` is what a failed fetch leaves behind AND what a successful
 * fetch that found nothing leaves behind, so the primitive could not tell a
 * fault from a measurement (`loadState.ts` documents the class, objectui#5170 /
 * objectui#5169). ⛔ The obvious repair — a second boolean beside `loading` —
 * re-creates it one size larger: three facts in two booleans is how this arrived,
 * and four facts in three booleans leaves FIVE combinations nothing defines.
 *
 * Reading a discriminated union instead means there are no combinations to
 * leave undefined, and the `default` leg makes that mechanical rather than
 * remembered: a NEW arm on {@link LoadState} stops compiling here instead of
 * silently falling into one of the answers below. That is the property the
 * card asked for — no fourth arm waiting behind this one.
 */
function rosterVerdict(roster: LoadState<unknown> | undefined): RosterVerdict {
  // No prop at all is the synchronous call site: a literal `options` array has
  // always already answered. That is what every call site handing this
  // primitive a literal roster passes — the ones a `roster=` search does NOT
  // return — and it is a real arm of the answer, not a default-by-omission.
  if (!roster) return 'answered';
  switch (roster.status) {
    case 'idle':
    case 'loading':
      return 'silent';
    case 'loaded':
      return 'answered';
    case 'error':
      return 'failed';
    default: {
      const unhandled: never = roster;
      return unhandled;
    }
  }
}

/**
 * Adapt a picker hook that still reports `{ loading, error }` into the one
 * state {@link InspectorSelectField} reads.
 *
 * Several metadata-admin loaders (`useObjectFields`, `useDatasetCatalog`,
 * `useDatasetSemantics`) predate {@link LoadState} and publish the pair. The
 * pair is not wrong at the source — it is wrong to re-derive its PRECEDENCE at
 * every render site, which is the failure `loadState.ts` names: `error` has to
 * be read before `loading`/loaded, by hand, everywhere, and a reordered branch
 * breaks it silently. Written once here, no call site can get the order wrong.
 */
export function rosterFrom(source: {
  loading: boolean;
  error: string | null | undefined;
}): LoadState<undefined> {
  // `!= null`, not truthiness: a fault reported with an empty message is still
  // a fault, and swallowing it here would put back the exact substitution this
  // whole change exists to remove. The notice renders the label alone when
  // there is no cause to show.
  if (source.error != null) return { status: 'error', message: source.error };
  if (source.loading) return { status: 'loading' };
  return { status: 'loaded', data: undefined };
}

/**
 * Catalogue key of the default wording for the notice
 * {@link InspectorSelectField} renders when its roster failed to load: the
 * shared picker-failure title objectui#5170 landed for the widget family, read
 * in the designer's locale (objectui#10586). A call site that passes its own
 * `rosterFailureLabel` keeps it.
 */
const DEFAULT_ROSTER_FAILURE_LABEL_KEY = 'engine.form.optionsLoadFailedTitle';

/**
 * The label of the row {@link InspectorSelectField} synthesises for a stored
 * value its roster does not offer: the value, then a FLAG saying why it is not
 * offered (`t('engine.form.notFound', locale)`, `…notInObject`, `…deprecated`).
 *
 * The two are joined by the `engine.form.flaggedValue` template, not by a
 * template literal at the call site, because the order of the two and the gap
 * between them are the locale's to decide — zh sets no space before the
 * full-width bracket its flags open with (objectui#9652). Every call site that
 * words its own flag goes through here, and so does the primitive's default.
 */
export function flagUnknownValue(
  value: string,
  flag: string,
  locale: SupportedLocale | string | undefined,
): string {
  return tFormat('engine.form.flaggedValue', locale, { value, flag });
}

export function InspectorSelectField({
  label,
  value,
  options,
  onCommit,
  placeholder = '—',
  unknownValueLabel: unknownValueLabelProp,
  roster,
  rosterFailureLabel: rosterFailureLabelProp,
  disabled,
  required,
}: {
  label: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onCommit: (v: string) => void;
  placeholder?: string;
  /**
   * Wording for the synthesised row that carries a stored value the roster does
   * not offer. Receives the raw stored value; defaults to the value flagged
   * `engine.form.notFound` in the designer's active locale — `VALUE (not found)`
   * in en-US. Build an override with {@link flagUnknownValue}.
   * Override it, never the RULE — the rule is the one this primitive owns.
   */
  unknownValueLabel?: (value: string) => string;
  /**
   * What the `options` roster DID — unasked, in flight, answered, or failed —
   * as one value rather than a set of flags.
   *
   * The flag this primitive owns is an assertion about the author's own data,
   * so it may only be made by a roster that actually answered. `idle` and
   * `loading` withhold it because the roster has not spoken (objectui#8862);
   * `error` withholds it because the roster never will, and additionally says
   * so on screen (objectui#9651) — silence there would trade a wrong message
   * for no message.
   *
   * ⚠️ This REPLACED a `loading?: boolean`. The sibling atom
   * `InspectorComboField` still spells its own signal as a boolean, and that is
   * not drift: its `loading` only picks the trigger's placeholder text, it
   * decides no claim, so it has no fault arm to be blind to.
   *
   * Omit it entirely for a synchronous roster (a literal `options` array).
   */
  roster?: LoadState<unknown>;
  /**
   * Wording for the notice shown when `roster` reports a failure. The CAUSE is
   * rendered from the state's own message; this is the sentence in front of it.
   * Defaults to `engine.form.optionsLoadFailedTitle` in the designer's locale.
   */
  rosterFailureLabel?: string;
  disabled?: boolean;
  /**
   * Mark the field required: {@link RequiredMarker} in the label, `aria-required`
   * on the trigger (the labelled `combobox`, as `SchemaForm`'s select puts it).
   */
  required?: boolean;
}) {
  // Radix `<Select.Item>` forbids an empty-string value (it reserves ""
  // for the cleared/placeholder state), yet callers legitimately use ""
  // to mean "no value" (e.g. a "— None —" option). Bridge with an
  // internal sentinel so the public contract (value="" ⇄ none) holds.
  const toInner = (v: string) => (v === '' ? SELECT_NONE_SENTINEL : v);
  const fromInner = (v: string) => (v === SELECT_NONE_SENTINEL ? '' : v);
  // The id goes on `SelectTrigger`, never on `Select`: Radix's `Select.Root`
  // renders no DOM element of its own, so an `id` handed to it is silently
  // dropped and the label's `for` resolves to nothing — the exact failure
  // objectui#3976 (PR #3992) fixed in the built-in select branch. The trigger
  // renders the real `button[role=combobox]`, which is a labelable element, so
  // one `for`/`id` pair names it (no second `aria-labelledby` channel needed).
  const id = React.useId();
  // objectui#9652 — the default flag used to be a raw English template literal,
  // so every call site that passes no `unknownValueLabel` showed a zh-CN author
  // `VALUE (not found)` on an otherwise Chinese inspector. It resolves through
  // the designer's own catalogue now, in the locale the designer is showing.
  const locale = useMetadataLocale();
  const rosterFailureLabel = rosterFailureLabelProp ?? t(DEFAULT_ROSTER_FAILURE_LABEL_KEY, locale);
  const unknownValueLabel =
    unknownValueLabelProp ??
    ((v: string) => flagUnknownValue(v, t('engine.form.notFound', locale), locale));
  // `SelectValue`'s own `placeholder` is unreachable here, and was at all 45
  // call sites (objectui#8450). Radix shows it only when its value is `''` or
  // `undefined`, and the sentinel bridge above guarantees the value is never
  // either — a controlled value matching no `SelectItem` renders as nothing at
  // all, so every empty select in the designer drew a BLANK trigger.
  //
  // The repair renders the placeholder here instead of handing Radix an
  // `undefined` value. Passing `undefined` would work, but it makes the Radix
  // `Select` UNCONTROLLED for exactly as long as the field is empty, so the
  // first selection at every call site flips it back — measured: Radix logs
  // `Select is changing from uncontrolled to controlled`, and the same flip
  // fires with the value untouched when a late-arriving `options` list gains or
  // loses its `''` row (async pickers: `useMetaOptions`, `datasetOptions`,
  // `fieldOptions`). While uncontrolled, Radix also keeps its OWN value, so a
  // pick the owner declines to persist stays on screen. Rendering the text is
  // the same predicate with none of that.
  //
  // "No selection" is the narrow state: no value AND no option standing for
  // none. When the caller DOES offer a `''` row (a "— None —" choice), `''` is
  // a selection like any other and that row's label wins — the case pinned in
  // `_shared.select.test.tsx`.
  const current = value ?? '';
  const hasNoneOption = options.some((o) => o.value === '');
  const showPlaceholder = current === '' && !hasNoneOption;

  // objectui#8488 — the OTHER half, and it is not the same state. A non-empty
  // value the roster does not offer is a STALE value, not an absent one, and
  // Radix renders a controlled value matching no `SelectItem` as nothing at
  // all: the trigger goes blank, pixel-identical to "unset". The author then
  // sees an empty control, picks something to "fill it in", and overwrites a
  // key they were never shown.
  //
  // ⛔ The placeholder is NOT the repair. Drawing `'—'` here would assert
  // "nothing is stored" about a field that IS storing something — worse than
  // the blank, because it is confidently wrong rather than merely empty. So
  // the two states must stay distinguishable on screen, and they are: empty
  // draws `placeholder`, unknown draws the value itself under a flag.
  //
  // EIGHT call sites had hand-rolled this, and re-deriving them is what moved
  // the rule here. Three flagged the row — `ActionTargetField`
  // ("(not found)"), `ViewColumnInspector`'s field picker ("(not in object)")
  // and `FlowNodeConfigField`'s select branch ("(deprecated)", framework#4278 /
  // ADR-0090 D3). FIVE only made it visible — `ReportDefaultInspector`'s type,
  // dataset and both chart axes, and `ViewVariantInspector`'s type — appending
  // the raw value with no marker at all, which is the same screen a real option
  // draws. Every one of them is deleted now; only the WORDING stays with the
  // call site, through `unknownValueLabel`.
  //
  // The row is selectable — all three flagged copies made it so, and re-picking
  // your own stored value must not be a dead end. It goes FIRST, where two of
  // those three put it: Radix scrolls the selected item into view on open, so
  // the real roster then sits directly under it, which is where a replacement
  // gets picked.
  //
  // objectui#8862 — the boundary objectui#8488 measured and left open, closed
  // here. An `options` array cannot say WHY it is empty: an async picker that
  // has not answered yet hands over `[]`, indistinguishable from a catalog that
  // genuinely does not carry the value. So a perfectly valid stored value wore
  // the flag for the length of a round trip — and on the metadata-AUTHORING
  // surface that flag is not a cosmetic wobble, it is an assertion to the
  // author that a key they bound correctly does not exist on the object. The
  // plausible response is to "fix" a binding that was already right.
  //
  // objectui#8862 gave that boundary a `loading` term and made the answer a
  // TRI-state. objectui#9651 measured the arm it left open and made the answer
  // read ONE state instead of a list plus flags — see {@link rosterVerdict}:
  //   • roster answered, value offered     → the option's own label
  //   • roster answered, value NOT offered → the value under `unknownValueLabel`
  //   • roster unasked or in flight        → the value, bare
  //   • roster FAILED                      → the value, bare, plus a notice
  //
  // The row is still SYNTHESISED in every silent arm. Withholding it would put
  // back the blank trigger objectui#8488 removed, and would blank it exactly
  // when the author has least other evidence of what is stored; only the CLAIM
  // is withheld. A value drawn plainly asserts nothing about a roster that has
  // not spoken, which is the only honest render while it is silent. ⚠️ That is
  // not the direction objectui#8488 refused: what it refused — "stored" and
  // "offered" drawn alike — is a claim about a roster that HAS answered and
  // can tell them apart. This one cannot, and in the failure arm never will.
  //
  // objectui#9651 — the arm objectui#8862 left open, and the reason it needed
  // its own decision rather than a wider `loading`. A fetch that FAILS also
  // leaves `options` at `[]` with nothing in flight, so to a list-plus-flag
  // reading it is byte-identical to "the roster answered and your value is not
  // in it" — and unlike the pending arm it never resolves, so the false claim
  // was PERMANENT. Measured on the unrepaired tree through the real
  // `ViewColumnInspector`: a rejected `client.get` rendered
  // `amount (not in object)` for a field the object really has, with nothing
  // anywhere on screen saying the request failed.
  //
  // ⚠️ Suppressing the flag is only half. A silent suppression trades a wrong
  // message for NO message, and the author is then looking at a picker whose
  // list is empty for an unstated reason. So the failure arm also renders its
  // own notice, carrying the cause — which is what this tree already decided a
  // picker owes its host on a failed catalog: `PickerLoadFailure` in
  // `widgets.tsx` (objectui#5170) states that the list could not be loaded,
  // shows the cause, makes NO claim about whether options exist, and keeps the
  // control editable so a failed catalog does not also block authoring. Same
  // three properties here, in the shape a single inspector row can carry.
  const verdict = rosterVerdict(roster);
  const rosterFailure = roster?.status === 'error' ? roster.message : undefined;
  const isUnknownValue = current !== '' && !options.some((o) => o.value === current);
  const shownOptions = isUnknownValue
    ? [
        {
          value: current,
          label: verdict === 'answered' ? unknownValueLabel(current) : current,
        },
        ...options,
      ]
    : options;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {required && <RequiredMarker />}
      </Label>
      <Select
        value={toInner(value ?? '')}
        onValueChange={(v) => onCommit(fromInner(v))}
        disabled={disabled}
      >
        {/* `data-placeholder` is Radix's own trigger flag and the hook Shadcn's
            `data-[placeholder]:text-muted-foreground` styles the empty state
            with. Radix cannot derive it through the sentinel, and the trigger
            spreads caller props AFTER its own attributes, so setting it here
            restores the real placeholder styling instead of hand-rolling it. */}
        <SelectTrigger
          id={id}
          aria-required={required ? true : undefined}
          className="h-8 text-sm"
          data-placeholder={showPlaceholder ? '' : undefined}
        >
          {showPlaceholder ? <span>{placeholder}</span> : <SelectValue />}
        </SelectTrigger>
        <SelectContent>
          {shownOptions.map((o) => (
            <SelectItem key={o.value} value={toInner(o.value)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* objectui#9651 — the failure arm says so. `role="status"` is what the
          shared `PickerLoadFailure` block uses for the same fact, and the warn
          tone matches the `Hint tone="warn"` this tree already renders for a
          catalog that could not be read. */}
      {rosterFailure !== undefined ? (
        <p
          role="status"
          data-testid="inspector-select-roster-failure"
          className="text-[11px] leading-snug text-amber-600 dark:text-amber-300"
        >
          {rosterFailureLabel}
          {/* An explicit space: the cause is a separate element, so without it
              the accessible name reads as one run-on word. */}
          {rosterFailure ? (
            <>
              {' '}
              <span className="break-words font-mono text-[10px] opacity-80">
                {rosterFailure}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

const SELECT_NONE_SENTINEL = '__inspector_select_none__';

export function InspectorCheckboxField({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: boolean;
  onCommit: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

export function InspectorRemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  // Calm by default (muted outline), escalating to destructive-red only on
  // hover — a full-width solid-red bar reads as alarming for what is a routine
  // "remove this element" footer action. The trash icon keeps intent clear.
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="w-full gap-1.5 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

export function InspectorEmptyState({ message }: { message: string }) {
  return <div className="text-xs italic text-muted-foreground p-4 text-center">{message}</div>;
}

/**
 * Helper to immutably splice an item in an array on a draft.
 * Returns a new array; never mutates input.
 */
export function spliceArray<T>(arr: T[] | undefined, index: number, replacement: T | null): T[] {
  const a = Array.isArray(arr) ? [...arr] : [];
  if (replacement === null) a.splice(index, 1);
  else a[index] = replacement;
  return a;
}

/**
 * Insert `item` at `index` immutably. Index out of range clamps to
 * [0, length]. Returns a new array; never mutates input.
 */
export function insertArray<T>(arr: T[] | undefined, index: number, item: T): T[] {
  const a = Array.isArray(arr) ? [...arr] : [];
  const i = Math.max(0, Math.min(a.length, index));
  a.splice(i, 0, item);
  return a;
}

/**
 * Append `item` to the end immutably. Convenience wrapper over
 * insertArray for the common "+ Add at end" case.
 */
export function appendArray<T>(arr: T[] | undefined, item: T): T[] {
  const a = Array.isArray(arr) ? [...arr] : [];
  a.push(item);
  return a;
}

/**
 * Move an item from `from` to `to` immutably. Out-of-range or no-op
 * moves return a new copy unchanged. Useful for ↑/↓ reorder buttons.
 */
export function moveArray<T>(arr: T[] | undefined, from: number, to: number): T[] {
  const a = Array.isArray(arr) ? [...arr] : [];
  if (from < 0 || from >= a.length) return a;
  const clampedTo = Math.max(0, Math.min(a.length - 1, to));
  if (clampedTo === from) return a;
  const [item] = a.splice(from, 1);
  a.splice(clampedTo, 0, item);
  return a;
}

/**
 * The designer's id minter. Its body moved to `./unique-id` (a module with no
 * React in it) so pure reconciliation modules can share this one minter without
 * pulling the components barrel into their unit tests — see that file. Re-
 * exported here because every existing call site imports it from `_shared`.
 */
export { uniqueId } from './unique-id.js';
