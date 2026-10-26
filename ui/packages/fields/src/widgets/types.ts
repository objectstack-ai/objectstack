import type { AriaAttributes, FocusEventHandler, MouseEventHandler } from 'react';
import type { DependsOnInput, FieldMetadata } from '@object-ui/types';

/**
 * DOM pass-through: what a widget's `...props` spread may legitimately put on
 * the element it renders.
 *
 * A NAMED type rather than an inline block of {@link FieldWidgetComponentProps}
 * so the compiler can bind it to its runtime executor in BOTH directions
 * (objectui#3291). `toDomProps` asserts:
 *
 *  - every key it forwards is declared on the widget contract — deleting one
 *    here without deleting it there is a compile error;
 *  - every key of THIS type is one it forwards — adding one here without
 *    adding it to `DOM_PASS_THROUGH_KEYS` is a compile error too.
 *
 * The second direction is the one that matters for the failure mode this repo
 * treats as first-class: DECLARED BUT NOT DELIVERED (objectui#3290's
 * `aria-required` that never reached a control, objectui#3222's validation slot
 * nobody produced). Without it, a key added here would type-check, read as
 * supported, and silently never reach the DOM — and the leak test cannot see
 * that class of bug, because it looks for attributes that ARRIVE, not for ones
 * that go missing.
 *
 * `className` and `disabled` are deliberately NOT here. They are DOM-legal and
 * `toDomProps` does forward them, but they are declared on the controlled-input
 * block of {@link FieldWidgetComponentProps} because widgets also INTERPRET
 * them (className is composed with the widget's own classes; disabled is OR-ed
 * with readonly). They are therefore bound in the forward direction only.
 *
 * `AriaAttributes` and the `data-${string}` family are matched by prefix at
 * runtime rather than key-by-key, so they are intersected in separately.
 *
 * Adding a key here is a contract change: say who produces it and who reads it.
 */
export type FieldWidgetDomProps = {
  id?: string;
  /** react-hook-form's field name, spread in by the form renderer. */
  name?: string;
  autoFocus?: boolean;
  tabIndex?: number;
  onBlur?: FocusEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onClick?: MouseEventHandler<HTMLElement>;
};

/**
 * Props every field widget in this package receives at RUNTIME.
 *
 * Named `FieldWidgetComponentProps`, not `FieldWidgetProps` (objectui#3161,
 * objectstack#4115 ledger batch 7), adopting the name `@object-ui/app-shell`
 * settled on for the same split in objectui#3169: `@objectstack/spec/ui` owns
 * `FieldWidgetProps` for the DECLARED widget-plugin contract — a zod object
 * (`FieldWidgetPropsSchema`) a plugin manifest is validated against, with
 * `field` narrowed to `{ name?, label?, type: <the FieldType enum> }` and
 * `readonly` / `required` carrying `.default()`s. This is the React interface
 * the widgets in this directory actually implement, against
 * `@object-ui/types`'s much richer `FieldMetadata`.
 *
 * The two are NOT interchangeable, but they no longer disagree on the
 * validation slot: this type used to call it `errorMessage` while the spec
 * calls it `error`, so a widget written to the published contract read
 * `undefined` forever. objectui#3222 resolved that in the direction the
 * contract points — the slot below IS the spec's `error`, and the form
 * renderer now produces it (see `error`'s own doc comment). Reading
 * `props.required` off this type is still a compile error rather than a
 * silent `any`; that key is deliberately NOT lowered here (see below).
 *
 * ## Why `required` is still absent, though the spec declares it
 *
 * The required MARKER is drawn exactly once, by the form renderer's
 * `<FormLabel>` (the `*` with `aria-label="required"`, which the label
 * association folds into the control's accessible name). Handing `required`
 * to widgets would give that marker a second possible author, and the very
 * next AI-written widget draws its own asterisk — the same double-display
 * failure that keeps the validation TEXT out of the widget below. The a11y
 * state a widget genuinely could carry is `aria-required` on the input, and
 * that needs no new key at all: `AriaAttributes` is already part of this type
 * and every widget already forwards it to its control. Tracked separately;
 * do not add `required` here to "align" without that decision.
 *
 * ## Why there is no `[key: string]: any` (objectui#3221)
 *
 * This type used to end in an index signature, "load-bearing" for the widgets'
 * `...props` spreads. It was also why every drift above was invisible: **a type
 * that claims to have every key can never be reported as missing one** (the
 * objectstack#4075 mechanism). `props.required` and `props.error` were legal
 * reads typed `any` and always `undefined` at runtime; a misspelled prop
 * (`readOnly` for `readonly`, `onchange` for `onChange`) compiled; and any
 * structural/parity comparison against the type was useless *in principle*,
 * which is why the batch-7 symbol guard was the only detector that could see
 * the collision at all.
 *
 * It is replaced by the CLOSED set below: the controlled-input contract, the
 * host plumbing the form renderer genuinely forwards, and a DOM pass-through
 * allowance. `data-*` is an open family by design (it is open in HTML too) and
 * is expressed as a template-literal index signature, which — unlike
 * `[key: string]` — leaves `keyof` finite, so an undeclared prop still fails.
 *
 * ## Why there is no `schema` (objectui#3233)
 *
 * `schema` used to be declared here as a SECOND carrier for what `field`
 * already means — `SchemaRenderer` handed the SDUI node down as `schema`, the
 * form renderer forwarded `schema={props.field || props.schema || props}`
 * *alongside* `field`, and ~30 widgets resolved their config as
 * `field || schema`. One concept, two keys, two producers: exactly the
 * consumer-side tolerance AGENTS.md #0.1 forbids, and exactly the shape that
 * lets an AI-written widget pick the wrong spelling and still "work" under one
 * host while reading `undefined` under another.
 *
 * v17 converged it at the PRODUCERS. `field` is the only carrier a widget ever
 * sees; the SDUI node → `field` translation happens once, in this package's
 * registry adapter (`withFieldCarrier`), not ~30 times in the widgets. Reading
 * `props.schema` is now a compile error rather than a silent second contract.
 *
 * Adding a key here is a contract change: say who produces it and who reads it.
 */
export type FieldWidgetComponentProps<T = any> = {
  /* ── The controlled-input contract every widget implements ─────────────── */

  value: T;
  onChange: (val: T) => void;
  /**
   * The field's metadata, and the SINGLE carrier for it (objectui#3233).
   *
   * Deliberately the looser `@object-ui/types` shape rather than the spec's,
   * to avoid a circular dependency for now.
   *
   * Every host produces it: the form renderer's `renderFieldComponent`, the
   * inline-edit hosts (`FieldEditWidget`), `ActionParamDialog` /
   * `BulkActionDialog`, and — since #3233 — the registry adapter that adapts
   * `SchemaRenderer`'s SDUI node onto this contract (`withFieldCarrier` in
   * `packages/fields/src/withFieldCarrier.tsx`). A widget reads `props.field`
   * and nothing else; there is no second key to check.
   */
  field: FieldMetadata;
  readonly?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * The active validation message for this field, named as
   * `@objectstack/spec/ui`'s `FieldWidgetPropsSchema` names it (objectui#3222).
   *
   * **Producer**: the form renderer, from react-hook-form's
   * `fieldState.error?.message` (`packages/components/src/renderers/form/
   * form.tsx`). Before #3222 nothing in the repo produced it under EITHER
   * spelling, so the seven widgets computing `aria-invalid={!!errorMessage}`
   * were computing it from a permanent `undefined` — `aria-invalid` was never
   * once set and a screen reader was never told the field had failed.
   *
   * **Consumer**: a widget reads this ONLY to drive `aria-invalid` on the
   * control it renders. The message TEXT stays with the form renderer's
   * `<FormMessage/>`; a widget that also renders it double-displays it.
   */
  error?: string;
  /**
   * Upload widgets (`file`/`image`/`avatar`) fire this when their in-progress state
   * flips, so a host can block submit until a presigned upload settles. Other
   * widgets ignore it.
   */
  onUploadingChange?: (uploading: boolean) => void;

  /* ── Host plumbing: what a rendering host actually forwards ─────────────── */

  /**
   * DataSource for widgets that query records (lookup / user / object-ref /
   * recipient-picker). Injected by the form renderer for the field types that
   * need it, and passed directly by inline-edit hosts. Option widgets
   * destructure it purely to keep it off their DOM spread.
   *
   * `grid` was listed here with zero consumers (objectui#4814): `GridField.tsx`
   * never reads `dataSource`, and no data-source table has ever contained the
   * key, so the claim described a wiring that did not exist. `owner` is absent
   * for a different reason — the spelling itself is retired (same card).
   *
   * Left structural (`unknown`): `@object-ui/fields` must not depend on a
   * concrete adapter — every consumer narrows it itself.
   */
  dataSource?: unknown;
  /**
   * Live sibling-field values driving cascading / role-gated options and
   * dependent lookups (ADR-0058, #2215/#2284). The form renderer passes the
   * in-progress record.
   *
   * ⚠️ This used to add "widgets fall back to `SchemaRendererContext`". They
   * never could: they spelled such a fallback (`?? ctx.formValues ?? ctx.data`)
   * while `SchemaRendererContextType` declares exactly `dataSource` / `debug` /
   * `debugFlags` / `apiFetch`, so neither member could be supplied by any host
   * and the fallback was unconditionally empty. Those reads were retired under
   * ADR-0049 enforce-or-remove (objectui#7206) — this prop is the one channel
   * that carries a record, and a widget reached without it gates.
   */
  dependentValues?: Record<string, unknown>;
  /**
   * Controlling field(s) that gate this field's option list. Normally declared
   * on the field metadata; accepted as a prop so a host can drive the gate for
   * a field it synthesised. Field metadata wins when both are present.
   */
  dependsOn?: DependsOnInput;
  /**
   * Controlling-field name → its human LABEL, for widgets that have to NAME a
   * sibling field in user-visible copy (the dependent-lookup gate hint).
   *
   * Only the form renderer knows a field's label — the widget sees its own
   * metadata and a `dependsOn` list of API names. Without this map the gate
   * sentence interpolated the raw API name into every locale, `en` included
   * ("Select crm_account first"), which is an internal identifier leaking into
   * the UI, not merely an untranslated word (objectstack#5407). This is the
   * lookup-side counterpart of `emptyHint`, which the form already resolves to
   * labels for the fixed-option widgets. A name with no entry falls back to
   * itself, so a host that passes nothing renders exactly what it did before.
   */
  dependsOnLabels?: Record<string, string>;
  /**
   * Hint shown when an option list cannot be filled — typically a
   * dependency-gated list still waiting on its controlling field (#2284).
   * Forwarded by the form renderer, which resolves the controlling fields to
   * their human LABELS. **When supplied it wins**; the option widgets fall back
   * to their own translated copy only when a host computed none (objectui#3231
   * — they used to discard this prop and always render their own hardcoded
   * English). See `OptionsEmptyState`, the single consumer.
   */
  emptyHint?: string;
  /**
   * Render as a single-line, borderless control for a grid cell (the inline
   * editor and the line-item grid set it) instead of the full form layout.
   */
  compact?: boolean;
  /**
   * Receive the FULL selected record rather than just its id, so a host can
   * auto-fill sibling fields from it (a line-item grid copying a product's
   * price). When provided, the host owns the resulting value change.
   */
  onSelectRecord?: (record: Record<string, any>) => void;
  /**
   * Offer a "create new" affordance in a record picker, carrying whatever the
   * user had typed. Also declarable on the field metadata.
   */
  onCreateNew?: (searchQuery: string) => void;

  /* ── DOM pass-through ───────────────────────────────────────────────────── */
  //
  // Lives in the named {@link FieldWidgetDomProps} above, because that is what
  // lets the compiler bind the declaration to `toDomProps` — its runtime
  // executor — in BOTH directions (objectui#3291). Add a DOM key THERE, not
  // here, and the compiler will make you add it to the whitelist too.
} & FieldWidgetDomProps & AriaAttributes & {
  /**
   * Arbitrary `data-*` attributes (test ids, analytics hooks). Open by design,
   * but a template-literal key — `keyof` stays finite, so this does NOT
   * reintroduce the index signature objectui#3221 removed: `props.required`
   * is still an error, `props['data-testid']` is still fine.
   */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
};
