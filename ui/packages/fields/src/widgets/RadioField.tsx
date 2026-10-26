import React, { useId, useEffect } from 'react';
import { RadioGroup, RadioGroupItem, Label, EmptyValue } from '@object-ui/components';
import { isValueStillOffered, optionDisplayLabel, type OptionLike } from '@object-ui/core';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import { OptionsEmptyState } from './OptionsEmptyState.js';
import { useCascadingOptions } from './useCascadingOptions.js';

type Option = OptionLike;

/**
 * RadioField - choose exactly one value from a fixed option set, rendered as a
 * radio group. The stored value is the selected option value (string). Used for
 * the `radio` field type.
 *
 * Like the single `SelectField`, options support per-option `visibleWhen`
 * cascading + `dependsOn` gating (ADR-0058 / #2715), resolved through the shared
 * {@link useCascadingOptions} hook: the offered radios narrow against the live
 * form record + `current_user`, the control is gated behind a "select the parent
 * first" hint while a dependency is empty, and a value no longer offered (parent
 * changed / predicate flipped) is cleared.
 */
export function RadioField({
  value,
  onChange,
  field,
  readonly,
  className,
  dependentValues,
  dependsOn: dependsOnProp,
  emptyHint,
  dataSource: _dataSource,
  error,
  ...props
}: FieldWidgetComponentProps<string>) {
  const config = field as any;
  const rawOptions: Option[] = config?.options || [];
  const groupId = useId();
  const fieldName = props.name || config?.name || props.id || '';

  // Read through the declared type, not the untyped carrier (objectui#6153) — see SelectField.
  const dependsOn = field?.dependsOn ?? dependsOnProp;
  const { options, gated, dependsOnFields } = useCascadingOptions<Option>(
    rawOptions,
    dependsOn,
    dependentValues,
  );

  // Cascade clear: once the offered set no longer includes the current value
  // (parent changed / predicate flipped), drop it so no stale pair persists.
  useEffect(() => {
    if (readonly) return;
    // Never configured → nothing to prune against; see `MultiSelectField`'s
    // copy of this guard for the measured failure (objectui#4220).
    if (rawOptions.length === 0) return;
    // Gated → the authored list is withheld until the `dependsOn` parent is
    // chosen, so the empty offered set is missing information, not a verdict on
    // the stored value; clearing here fired on mount (objectui#4247). Same
    // reasoning, at length, in `MultiSelectField`.
    if (gated) return;
    if (value === undefined || value === null || (value as unknown) === '') return;
    // `null`, never `undefined`: the wire drops an own `undefined`, so the
    // clear was never saved (objectui#10291) — see `SelectField`.
    if (!isValueStillOffered(value, options)) onChange?.(null as unknown as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, gated]);

  // The host's group label — and its help text (objectui#4005) — have to be
  // consumed on EVERY surface this widget can render, not only the `RadioGroup`
  // (objectui#3990): both branches below return before that spread, which is how
  // a field-level `readonly: true` and a zero-option list ended up with a
  // published label id and a published description id and no consumer at all.
  // See `toHostGroupProps` — note the role it emits is `group`, not the
  // `radiogroup` the editable branch keeps: there is not one radio left in
  // either of these surfaces, which is also why the description has nowhere
  // else to go here.
  const hostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');

  if (readonly) {
    // `EmptyValue`'s own `aria-label` ("No value") is outranked by
    // `aria-labelledby` per accname, and on the `generic` role that placeholder
    // span carries it was never exposed as a name anyway.
    if (value == null || value === '') return <EmptyValue {...hostGroupProps} />;
    // Label from the raw set so a stored value hidden by `visibleWhen` still
    // renders its label rather than a bare id.
    const opt = rawOptions.find((o) => o.value === value);
    return <span {...hostGroupProps} className="text-sm">{opt ? optionDisplayLabel(opt) : String(value)}</span>;
  }

  // No offered options is unfillable — surface a legible state instead of an
  // empty radio group: the host's `emptyHint` when it computed one, else this
  // widget's own translated copy. Shared with the select / multiselect /
  // checkboxes so the four cannot drift again (objectui#3231).
  if (options.length === 0) {
    return (
      <OptionsEmptyState
        emptyHint={emptyHint}
        gated={gated}
        dependsOnFields={dependsOnFields}
        testId={fieldName ? `radio-empty-${fieldName}` : undefined}
        className="min-h-9"
        // This box IS the field in this state, so it is what the host label
        // names (objectui#3990).
        hostGroupProps={hostGroupProps}
      />
    );
  }

  return (
    // DOM pass-through onto the radiogroup (objectui#3318). It also carries the
    // host's group label: when the form renderer associates its `<FormLabel>` by
    // IDREF (`aria-labelledby`, objectui#3961) that key rides in this same
    // whitelist spread — `toDomProps` forwards the whole `aria-` family — so this
    // widget needs no branch of its own. `radiogroup` is already a member of the
    // group role family, so nothing here overrides it with `role="group"`: it is
    // the more specific role AND the correct carrier of `aria-invalid` below.
    //
    // Unlike Radix
    // `Select.Root` (#3306) this Root IS a real DOM element — a
    // `<div role="radiogroup">` — and `radiogroup` is exactly the role
    // WAI-ARIA designates to carry `aria-invalid` for a set of radios
    // (`radio` itself does not support it): the group's state is announced
    // when focus lands on any radio inside it.
    <RadioGroup
      {...toDomProps(props)}
      value={value ?? ''}
      onValueChange={onChange}
      disabled={props.disabled}
      className={className}
      // AFTER the spread so this widget's own computation wins (#3222).
      aria-invalid={!!error}
    >
      {options.map((opt) => {
        // Radix speaks strings — stringify the (possibly numeric,
        // #3090-widened) authored value at this boundary.
        const value = String(opt.value);
        const id = `${groupId}-${value}`;
        return (
          <div key={value} className="flex items-center space-x-2">
            <RadioGroupItem value={value} id={id} data-testid={`radio-option-${value}`} />
            <Label htmlFor={id} className="font-normal">{optionDisplayLabel(opt)}</Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}
