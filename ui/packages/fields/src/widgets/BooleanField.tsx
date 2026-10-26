import React, { useId } from 'react';
import { Switch, Checkbox, Label, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useBooleanValueLabel } from './booleanValueLabel.js';

/**
 * BooleanField - Toggle input supporting switch and checkbox variants
 * Renders as Switch or Checkbox based on field widget configuration
 */
export function BooleanField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<boolean>) {
  const config = field as any;
  // Use simple type assertion for arbitrary custom properties not in BaseFieldMetadata
  const widget = config?.widget;
  // Generate unique ID using React's useId hook - must be before early returns (rules of hooks)
  const generatedId = useId();
  // Before the readonly early return for the same reason: the hook count must
  // not change when `readonly` flips.
  const booleanLabel = useBooleanValueLabel();
  /**
   * The HOST owns the control's id (objectui#3952).
   *
   * `<FormControl>` is a Radix `Slot` that hands its child the id its
   * `<FormLabel htmlFor>` already points at (`_r_N_-form-item`). This widget
   * used to REPLACE it with the field name, so the form's visible label
   * referenced an id no element carried: `label for="_r_3_-form-item"` against
   * `all ids in form = ["notifications"]`. Clicking the label — the normal
   * affordance for a switch/checkbox row — toggled nothing, on every generated
   * form in every app.
   *
   * `id` is a DECLARED key of the widget contract (`FieldWidgetDomProps`) and
   * `toDomProps` forwards it, so honouring it here is the contract's own
   * direction: the fix belongs at the consumer that discarded a delivered
   * value, not in the form renderer (AGENTS.md #0.1).
   *
   * The fallback chain stays for the STANDALONE hosts that hand down no id —
   * `FieldEditWidget` (the grid's inline cell editor) and a bare SDUI node.
   */
  const hostId = props.id;
  const id = hostId || config?.name || generatedId;
  const label = config?.label || 'Checkbox';
  /**
   * A host that supplies the id is a host that renders its own label for it
   * (that is what the id is FOR), so the widget's `sr-only` label would be the
   * second copy of one name — the other half of #3952, and why a naive
   * `getByText(label)` on a boolean field returned two nodes.
   *
   * Standalone it is the control's ONLY accessible name (`FieldEditWidget`
   * renders no label of its own), so there it stays. Deliberately keyed on the
   * host id rather than on `config.label`: inside a form the naming is the
   * host's job for EVERY widget — a text field in a label-less form row is
   * equally unnamed — and the generic `'Checkbox'` fallback emitted there was
   * an actively WRONG accessible name, not a safety net.
   */
  const emitOwnLabel = !hostId;

  if (readonly) {
    // Only a real boolean is a value of a boolean field (objectui#8593 — the
    // widget-side half of objectui#8582's ruling on `BooleanCellRenderer`).
    //
    // `@objectstack/spec`'s runtime value contract for `boolean` / `toggle` is
    // a bare `z.boolean()` (`data/field-value.zod.ts`, `valueSchemaFor`): the
    // class is "a JS boolean on the wire (driver read-coercion repairs SQL
    // 0/1)" and sits under `NON_TEXT_STORED_VALUE_TYPES` — stored "never text
    // on any backend". The truth table that turns `'true'` / `1` / `'0'` into
    // a boolean lives at the PRODUCER boundaries (objectql's
    // `coerceBooleanFields` and its `invalid_boolean` write refusal, `rest`'s
    // `parseBooleanCell` on CSV import), so a non-boolean reaching this branch
    // is a producer that skipped its repair, and a second copy of that table
    // here would be the widget-side dialect AGENTS.md #0.1 forbids.
    //
    // This branch used to read the value by TRUTHINESS. The string `'false'`,
    // the string `'0'`, `{}` and `[]` said "Yes" — an affirmative the record
    // never made — and `0`, `''`, `null` and `undefined` said "No", a negative
    // it never made either. Both directions are the same fabrication and both
    // now land on `EmptyValue`: the affordance every sibling widget in this
    // directory draws for an absent value in its readonly branch
    // (`NumberField`, `CurrencyField`, `PercentField`, `DateTimeField`,
    // `EmailField`, `PhoneField`, `RadioField`, `ObjectField`, …), which is
    // also what `BooleanCellRenderer` draws for the same input — the two
    // surfaces agree by this directory's convention, not by import. Its
    // accessible name ("No value") is a statement about the field's TYPE: the
    // record holds no boolean here. A real `false` is a value and still says
    // "No".
    if (typeof value !== 'boolean') return <EmptyValue />;
    // The word comes from the locale (objectui#11689), through the one helper
    // every read-only boolean word reads.
    return <span className="text-sm">{booleanLabel(value)}</span>;
  }

  const domProps = toDomProps(props);

  /**
   * WHICH ELEMENT carries `aria-invalid`, since this widget is the one of the
   * five in objectui#7126 that renders a composite: a control plus its
   * `sr-only` label inside a flex `div`.
   *
   * It goes on the Radix `Checkbox` / `Switch` -- each renders a real
   * `<button role="checkbox">` / `<button role="switch">`, which is the
   * focusable element a keyboard user lands on and the one assistive tech
   * reads control state from. `aria-invalid` is a GLOBAL ARIA attribute, valid
   * on both roles. The wrapper `div` is deliberately NOT the target: marking it
   * satisfies a row-wide query while telling a screen-reader user nothing,
   * which is exactly the hole objectui#5223 closed in the registry sweep and
   * the move that sweep now forbids by requiring a FOCUSABLE carrier.
   *
   * Written AFTER the DOM spread in both branches so this widget's own
   * computation wins (the objectui#3222 idiom, shared with `SelectField` /
   * `EmailField` / `NumberField`), and `!!undefined` yields an explicit
   * `"false"` so a valid field says so rather than staying mute. MARKING only:
   * the message TEXT stays with the host.
   */
  if (widget === 'checkbox') {
     return (
        <div className="flex items-center space-x-2">
            <Checkbox
                {...domProps}
                id={id}
                checked={!!value}
                onCheckedChange={(checked) => onChange(!!checked)}
                disabled={readonly || domProps.disabled}
                aria-invalid={!!error}
            />
            {emitOwnLabel && <Label htmlFor={id} className="sr-only">{label}</Label>}
        </div>
     )
  }

  return (
    <div className="flex items-center space-x-2">
        <Switch
            {...domProps}
            id={id}
            checked={!!value}
            onCheckedChange={onChange}
            disabled={readonly || domProps.disabled}
            aria-invalid={!!error}
        />
        {emitOwnLabel && <Label htmlFor={id} className="sr-only">{label}</Label>}
    </div>
  );
}
