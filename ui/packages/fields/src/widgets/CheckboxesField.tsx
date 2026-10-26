import React, { useId, useEffect } from 'react';
import { Checkbox, Label, EmptyValue, Badge } from '@object-ui/components';
import { optionDisplayLabel, type OptionLike } from '@object-ui/core';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import { OptionsEmptyState } from './OptionsEmptyState.js';
import { useCascadingOptions } from './useCascadingOptions.js';

type Option = OptionLike;

/**
 * CheckboxesField - select zero or more values from a fixed option set, rendered
 * as a list of checkboxes. The stored value is a string[]. Used for the
 * `checkboxes` field type.
 *
 * Options support the same per-option `visibleWhen` cascading + `dependsOn`
 * gating as `MultiSelectField` (ADR-0058 / #2715), resolved through the shared
 * {@link useCascadingOptions} hook: the offered boxes narrow against the live
 * form record + `current_user`, the control is gated behind a "select the parent
 * first" hint while a dependency is empty, and selections no longer offered
 * (parent changed / predicate flipped) are pruned from the array.
 */
export function CheckboxesField({
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
}: FieldWidgetComponentProps<string[]>) {
  const config = field as any;
  const rawOptions: Option[] = config?.options || [];
  const selected: string[] = Array.isArray(value) ? value : value == null ? [] : [value as unknown as string];
  const groupId = useId();
  const fieldName = props.name || config?.name || props.id || '';

  // Read through the declared type, not the untyped carrier (objectui#6153) — see SelectField.
  const dependsOn = field?.dependsOn ?? dependsOnProp;
  const { options, gated, dependsOnFields } = useCascadingOptions<Option>(
    rawOptions,
    dependsOn,
    dependentValues,
  );

  // Cascade clear: prune selected values the offered set no longer includes
  // (parent changed / predicate flipped), keeping the ones still valid — the
  // per-element clear the multi-value case needs (cf. the scalar select/radio).
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
    if (selected.length === 0) return;
    const stillOffered = selected.filter((v) => options.some((o) => o.value === v));
    if (stillOffered.length !== selected.length) onChange(stillOffered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, gated]);

  // The host's group label — and its help text (objectui#4005) — have to be
  // consumed on EVERY surface this widget can render, not only the editable one
  // (objectui#3990): both branches below return before the editable container's
  // `groupDomProps` spread, which is how a field-level `readonly: true` and a
  // zero-option list ended up with a published label id and a published
  // description id and no consumer at all. Neither surface renders a checkbox,
  // so neither has anywhere else to put the description. See
  // `toHostGroupProps`.
  const hostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');

  if (readonly) {
    // The readonly display of a checkbox set is the set of CHECKED labels — a
    // set of values, so the same `group` answer as the editable list.
    // `EmptyValue` is that surface with nothing in it; its own `aria-label`
    // ("No value") is outranked by `aria-labelledby` per accname, and on the
    // `generic` role that span carries it was never exposed anyway.
    if (selected.length === 0) return <EmptyValue {...hostGroupProps} />;
    return (
      <div {...hostGroupProps} className="flex flex-wrap gap-1">
        {selected.map((v) => {
          // Label from the raw set so a stored value hidden by `visibleWhen`
          // still renders its label rather than a bare id.
          const opt = rawOptions.find((o) => o.value === v);
          return <Badge key={v} variant="outline">{opt ? optionDisplayLabel(opt) : v}</Badge>;
        })}
      </div>
    );
  }

  // No offered options is unfillable — surface a legible state instead of an
  // empty checkbox list: the host's `emptyHint` when it computed one, else this
  // widget's own translated copy. Shared with the select / multiselect / radio
  // so the four cannot drift again (objectui#3231).
  if (options.length === 0) {
    return (
      <OptionsEmptyState
        emptyHint={emptyHint}
        gated={gated}
        dependsOnFields={dependsOnFields}
        testId={fieldName ? `checkboxes-empty-${fieldName}` : undefined}
        className="min-h-9"
        // This box IS the field in this state, so it is what the host label
        // names (objectui#3990).
        hostGroupProps={hostGroupProps}
      />
    );
  }

  const toggle = (v: string, checked: boolean) => {
    const next = checked ? [...selected.filter((x) => x !== v), v] : selected.filter((x) => x !== v);
    onChange(next);
  };

  // DOM pass-through (objectui#3318): the container carries the form
  // renderer's id / aria-describedby, but NOT its `aria-invalid` — a plain
  // wrapper div is not where assistive tech reads the invalid state. That
  // state goes onto every focusable checkbox below (`checkbox` is an
  // aria-invalid-supporting role), computed from the published `error` slot
  // (#3222). The per-item ids below stay authoritative for their labels.
  // `name` is withheld too: it is only DOM-legal on form controls, and on
  // this div it is exactly the leak #3291 sweeps for.
  const {
    'aria-invalid': _hostAriaInvalid,
    name: _domName,
    ...groupDomProps
  } = toDomProps(props);
  // When the host associated its visible label with this container by IDREF
  // (`aria-labelledby`, objectui#3961) the container IS the labelled group, so it
  // answers with the matching role — without one, the name sits on a generic
  // `div` and contributes nothing: `label for` pointing here was already inert
  // (`HTMLLabelElement.control` is null for a div), which is the whole defect.
  // Absent (standalone: the inline grid editor, a bare SDUI node) nothing is
  // emitted and the markup is unchanged.
  const isLabelledGroup = groupDomProps['aria-labelledby'] != null;

  return (
    <div
      {...groupDomProps}
      role={isLabelledGroup ? 'group' : undefined}
      className={className}
      data-testid={fieldName ? `checkboxes-${fieldName}` : undefined}
    >
      {options.map((opt) => {
        // Multi-value fields store string arrays — stringify the (possibly
        // numeric, #3090-widened) authored value at this boundary.
        const value = String(opt.value);
        const id = `${groupId}-${value}`;
        return (
          <div key={value} className="flex items-center space-x-2 py-0.5">
            <Checkbox
              id={id}
              checked={selected.includes(value)}
              onCheckedChange={(checked) => toggle(value, !!checked)}
              disabled={props.disabled}
              aria-invalid={!!error}
              data-testid={`checkboxes-option-${value}`}
            />
            <Label htmlFor={id} className="font-normal">{optionDisplayLabel(opt)}</Label>
          </div>
        );
      })}
    </div>
  );
}
