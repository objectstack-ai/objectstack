import React from 'react';
import { Input, EmptyValue, cn } from '@object-ui/components';
import { NumberFieldMetadata } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useBadInputRefusal, BadInputMessage, BAD_INPUT_BORDER } from './numberBadInput.js';
import { formatNumberFieldValue } from './number-format.js';

/**
 * NumberField - Numeric input with optional decimal precision
 * Supports min/max/step constraints and configurable decimal precision
 */
export function NumberField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<number>) {
  // Before the readonly return: hooks are unconditional (objectui#6780).
  const { refusal, readBadInput } = useBadInputRefusal('1234');
  const locale = useDisplayLocale();

  if (readonly) {
    if (value == null) return <EmptyValue />;
    // The text `NumberCellRenderer` shows for the same field and value: both
    // make the one `formatNumberFieldValue` call, with the width
    // `resolveFieldScale` answers, the field's grouping policy and the display
    // locale (objectui#11431). This printed the raw value, so a `scale: 2`
    // field holding `1234.5` read `1234.5` here and `1,234.50` in its table
    // cell. Only a number is formatted, as this widget's value type declares;
    // anything else still renders as it arrives, never coerced into a digit
    // the record does not hold.
    return (
      <span className="text-sm">
        {typeof value === 'number' ? formatNumberFieldValue(value, field, locale) : value}
      </span>
    );
  }

  const numberField = field as NumberFieldMetadata;
  // Step follows `scale` (decimal places), not `precision` (total digit count):
  // a decimal(10, 0) column has 0 decimal places, so the input should step by 1
  // (`scale: 0` is a valid declaration — hence the typeof check, not truthiness).
  // An explicit `step` in the metadata wins over the derived one.
  const scale = numberField?.scale;
  const step =
    typeof numberField?.step === 'number'
      ? numberField.step
      : typeof scale === 'number'
        ? Math.pow(10, -scale)
        : 'any';

  const domProps = toDomProps(props);

  /**
   * The blur arm objectui#6780 adds — this widget had no `onBlur` at all.
   *
   * React delivers no `onChange` when `.value` never leaves `''`, which is the
   * measured shape of PASTING `1e` into an empty box; `badInput` is still true
   * at blur time, so this is the only arm that sees that route.
   *
   * ⚠️ COMPOSES the host's `onBlur` rather than replacing it: `onBlur` is a
   * declared DOM pass-through key that `toDomProps` already delivers here, and
   * a bare handler written after the spread would silently drop it.
   */
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    readBadInput(e.target);
    domProps.onBlur?.(e);
  };

  return (
    <div className="space-y-1">
      <Input
        {...domProps}
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          // objectui#6780: ask the browser whether it can READ the box before
          // trusting `.value`. The emission below is deliberately unchanged —
          // see `numberBadInput.tsx` for why refusing would wipe the very text
          // the diagnostic points at.
          readBadInput(e.target);
          const val = e.target.value;
          onChange(val === '' ? (null as any) : Number(val));
        }}
        onBlur={handleBlur}
        placeholder={numberField?.placeholder}
        disabled={readonly || domProps.disabled}
        className={cn(refusal ? BAD_INPUT_BORDER : '', domProps.className)}
        // Surface the field's declared range so the browser's spinner/keyboard
        // affordances respect it (server-side validation still owns enforcement).
        min={typeof numberField?.min === 'number' ? numberField.min : undefined}
        max={typeof numberField?.max === 'number' ? numberField.max : undefined}
        step={step}
        // `refusal` is this widget's OWN reading and no host can produce it;
        // `error` keeps its single author (objectui#3222 / objectui#6716) —
        // the same two-name split `CurrencyField` and `PercentField` use.
        //
        // This was a CONDITIONAL spread (written only while `refusal` was
        // active) for as long as the widget did not read `error`: an
        // unconditional attribute computed from a prop it never consumed would
        // have stamped `"false"` over the correct value `<FormControl>`'s Radix
        // Slot hands down — the overwrite objectui#3222's e2e pins call out.
        // Reading `error` here is what retires that hazard, so the two halves
        // landed together (objectui#6803); neither is safe alone.
        aria-invalid={!!error || !!refusal}
      />
      <BadInputMessage refusal={refusal} />
    </div>
  );
}
