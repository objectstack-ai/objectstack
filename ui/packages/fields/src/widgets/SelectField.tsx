import React, { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  EmptyValue,
} from '@object-ui/components';
import { isValueStillOffered, optionDisplayLabel } from '@object-ui/core';
import { SelectFieldMetadata } from '@object-ui/types';
import { useFieldTranslation } from './useFieldTranslation.js';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { MultiSelectField } from './MultiSelectField.js';
import { OptionsEmptyState } from './OptionsEmptyState.js';
import { toHostControlProps } from './toHostGroupProps.js';
import { useCascadingOptions } from './useCascadingOptions.js';

/**
 * SelectField - dropdown selection widget.
 *
 * A field declared `multiple: true` selects zero-or-more values (spec:
 * `multiple` is valid on `select`), so it renders the multi-value chip picker
 * — the same widget the `multiselect` type uses. Single-value selects keep the
 * cascading dropdown below.
 *
 * The FORM no longer arrives here with `multiple` (objectui#3986):
 * `mapFieldTypeToFormType` now resolves a `select` + `multiple: true` field to
 * `field:multiselect`, so the object-form path renders `MultiSelectField`
 * directly under its own registry id — which is what carries the
 * `labelling: 'group'` declaration the host label needs. Deciding the widget at
 * the type-resolution layer is what keeps the declaration and the render from
 * disagreeing; a delegation invisible to the resolver could not.
 *
 * The branch below stays because it is NOT dead — measured entrances that reach
 * it with `multiple` set, none of which consult that resolver:
 *
 *  - **the inline grid editor** — `FieldEditWidget` looks `select` up in its own
 *    `EDIT_WIDGETS` table, which SHORT-CIRCUITS before the alias map is
 *    consulted, and forwards the whole metadata object as `field`;
 *  - **`ActionParamDialog`** — `paramToField` resolves through
 *    `resolveFormWidgetType`, which likewise returns `select` from
 *    `fieldWidgetMap` before reaching the alias map, and carries
 *    `multiple: param.multiple` on the field it builds;
 *  - **hand-written SDUI** — a `{ type: 'field:select' }` node whose metadata
 *    declares `multiple`, which addresses this widget by name.
 *
 * All three then inherit multi-select from here identically, with no drift.
 *
 * Both branches resolve per-option `visibleWhen` cascading / role-gating through
 * the shared {@link useCascadingOptions} hook (#2715), so single and multi stay
 * in lockstep.
 */
export function SelectField(props: FieldWidgetComponentProps<any>) {
  const config = props.field as SelectFieldMetadata | undefined;
  if ((config as any)?.multiple) {
    // NOT `toDomProps` — this is a widget-to-widget delegation, not a DOM
    // spread. `MultiSelectField` implements the same contract and needs the
    // whole of it (`value`, `onChange`, `field`, `dataSource`, …); narrowing
    // here to the DOM whitelist would hand it an empty widget.
    return <MultiSelectField {...props} />;
  }
  return <SingleSelectField {...(props as FieldWidgetComponentProps<string>)} />;
}

/**
 * SingleSelectField - single-value dropdown with configurable options.
 *
 * Supports cascading / role-gated options (#2284): each option may carry a
 * `visibleWhen` CEL predicate, evaluated against the live form record +
 * `current_user`, so the offered set narrows as a controlling field changes
 * (`record.country == 'cn'`) or by role (`'admin' in current_user.positions`). A
 * field declares which sibling fields drive its list via `dependsOn`; while any
 * of those is empty the control is gated with a "select the parent first" hint,
 * mirroring the dependent-lookup UX.
 */
function SingleSelectField({
  value,
  onChange,
  field,
  readonly,
  error,
  dependentValues,
  dependsOn: dependsOnProp,
  emptyHint,
  dataSource: _dataSource,
  ...props
}: FieldWidgetComponentProps<string>) {
  const config = field as SelectFieldMetadata;
  const rawOptions = config?.options || [];
  const { t } = useFieldTranslation();
  // Stable hook for automation/e2e — react-hook-form + Radix Select cannot be
  // driven by synthetic DOM events, so e2e must target the trigger/options by a
  // deterministic testid keyed on the field name. `props.name` is the
  // react-hook-form field name spread in by the form renderer (FormField).
  const fieldName = props.name || (config as any)?.name || props.id || '';

  // The cascade key is read THROUGH THE DECLARED TYPE — `BaseFieldMetadata.dependsOn`,
  // the spec's field-level spelling, which every `FieldMetadata` member inherits
  // (objectui#6153; formerly reached through an `as any`). Metadata wins over the prop.
  const dependsOn = field?.dependsOn ?? dependsOnProp;
  const { options, gated, dependsOnFields } = useCascadingOptions(
    rawOptions,
    dependsOn,
    dependentValues,
  );

  // Cascade clear: once the offered set no longer includes the current value
  // (parent changed / predicate flipped), drop it so no stale pair persists.
  useEffect(() => {
    if (readonly) return;
    // Never configured → nothing to prune against; see `MultiSelectField`'s
    // copy of this guard for the measured failure (objectui#4220). Kept
    // identical across the four option widgets: an authored list is what the
    // cascade prunes, and all four render the same `OptionsEmptyState` when
    // there is none.
    if (rawOptions.length === 0) return;
    // Gated → the authored list is withheld until the `dependsOn` parent is
    // chosen, so the empty offered set is missing information, not a verdict on
    // the stored value; clearing here fired on mount (objectui#4247). Same
    // reasoning, at length, in `MultiSelectField`.
    if (gated) return;
    if (value === undefined || value === null || (value as unknown) === '') return;
    // A cleared scalar is `null`, never `undefined` (objectui#10291). The
    // write contract reads an explicit `null` as "clear the stored value" and
    // an absent key as "leave it unchanged" — and `undefined` becomes the
    // absent key on the wire, because `JSON.stringify` omits it. Emitting
    // `undefined` here showed the user an emptied field that no save ever
    // wrote, on every host (inline edit and forms alike), while the
    // multi-value prune beside it wrote a real array. `null` is the sentinel
    // the other clearing widgets in this package already emit.
    if (!isValueStillOffered(value, options)) onChange?.(null as unknown as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, gated]);

  if (readonly) {
    const option = rawOptions.find((o) => o.value === value);
    const display = option ? optionDisplayLabel(option) : value;
    return display ? <span className="text-sm">{display}</span> : <EmptyValue />;
  }

  // A select with no options is unfillable — a silently-empty Radix dropdown
  // reads as "broken widget" and hides the real cause. Surface a legible state:
  // the host's `emptyHint` when it computed one (it knows the controlling
  // fields' LABELS), else this widget's own translated copy. Shared with the
  // other option widgets so the four cannot drift again (objectui#3231).
  if (options.length === 0) {
    return (
      <OptionsEmptyState
        emptyHint={emptyHint}
        gated={gated}
        dependsOnFields={dependsOnFields}
        testId={fieldName ? `select-empty-${fieldName}` : undefined}
        className="h-9"
        // This widget declares `labelling: 'control'`, so the host emits a
        // plain `<label for>` and expects a LABELABLE element to be there.
        // Returning early used to answer that with nothing: the host id
        // reached no element and the `for` dangled (objectui#8803, the
        // registered-widget half of objectui#3991). Handing the box this bag
        // makes it an `<output>` carrying that id — see `OptionsEmptyState`
        // for the readings that ruled out the alternatives.
        hostControlProps={toHostControlProps(props)}
      />
    );
  }

  // Radix `Select.Root` renders no DOM element of its own — anything it does
  // not recognise (every `aria-*` / `data-*` a host hands this widget) is
  // silently DROPPED, never reaching a real element. That is how a required
  // select failed validation with the red message on screen while assistive
  // tech was told nothing (objectui#3306): the form renderer's `aria-invalid`
  // / `aria-describedby` / `aria-required` landed on Root and vanished. The
  // DOM pass-through therefore goes to `SelectTrigger` — the focusable
  // `<button role="combobox">` a user and their screen reader actually
  // interact with — with two deliberate exceptions kept on Root:
  //
  // - `name`: the ONE whitelist key Root genuinely consumes — it forwards it
  //   to the hidden native `<select>` that takes part in form submission.
  //   On the trigger it would sit uselessly on a non-submitter `<button>`.
  // - `disabled`: Root is the single authority (it disables trigger, item
  //   interaction and the hidden select together); forwarding the raw prop to
  //   the trigger as well would give the state a second, OR-merged author.
  const { name: domName, disabled: _domDisabled, ...triggerDomProps } = toDomProps(props);

  // `null` is how an empty value arrives — the cascade clear above emits it
  // (objectui#10291), and so does a record whose column is empty. Radix shows
  // the placeholder only for `''` / `undefined`, so a raw `null` paints a blank
  // trigger; `''` is the controlled spelling of "nothing chosen".
  //
  // `undefined` maps to `''` too, but only for a host that OWNS the value — one
  // that hands this widget an `onChange` (objectui#11804). A create form keeps
  // a field nobody seeded as `undefined` until the user picks, so Radix's
  // `Select` started uncontrolled and flipped to controlled on that first pick,
  // logging "Select is changing from uncontrolled to controlled". Controlled
  // from the first render, it never flips. Display is unchanged (Radix renders
  // `''` and `undefined` alike), and so is what gets saved: this is the
  // control's value only — the host's own state still holds `undefined`, and
  // `onValueChange` fires on a pick exactly as before. A host with no
  // `onChange` (a bare SDUI `field:select` node) still gets `undefined` and
  // stays uncontrolled: mapped to `''`, its control would freeze on the
  // placeholder, since nothing would ever hand it the picked value back.
  const controlValue =
    (value as string | null) === null || (value === undefined && typeof onChange === 'function')
      ? ''
      : value;

  return (
    <Select
      name={domName}
      value={controlValue}
      onValueChange={onChange}
      disabled={readonly || props.disabled}
    >
      <SelectTrigger
        {...triggerDomProps}
        data-testid={fieldName ? `select-trigger-${fieldName}` : undefined}
        // AFTER the spread so this widget's own computation wins, the #3222
        // discipline: `error` is the published validation slot
        // (`FieldWidgetPropsSchema`), and `!!undefined` must yield an explicit
        // `"false"` — a valid field SAYS it is valid rather than staying mute.
        aria-invalid={!!error}
      >
        <SelectValue placeholder={config?.placeholder || t('common.selectOption')} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} data-testid={`select-option-${option.value}`}>
            {optionDisplayLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
