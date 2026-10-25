import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { formatDateTime } from '@object-ui/core';
import { useDisplayLocale } from '@object-ui/i18n';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { openNativePicker } from './openNativePicker.js';
import { toDateTimeInputValue, fromDateTimeInputValue, isImpossibleStoredDay } from './nativeDateValue.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/**
 * DateTimeField - Combined date and time picker widget
 * Displays both date and time in locale format when readonly
 */
export function DateTimeField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  // Before the readonly early return — the hook count must not depend on a
  // prop. See DateField for why the bare `toLocale*` calls were wrong
  // (objectui#4468).
  const locale = useDisplayLocale();
  const { t } = useFieldTranslation();
  const noticeId = React.useId();
  if (readonly) {
    if (!value) return <EmptyValue />;
    // `formatDateTime`'s DEFAULT (verbose) face — the one home for the
    // `datetime` display convention (objectui#7443), on the face the
    // maintainer ruled for this register on objectui#8209. This branch used to
    // compose `toLocaleDateString(locale)` and `toLocaleTimeString(locale)`
    // with NO options bag and join them with a space, so a readonly `datetime`
    // FORM field carried seconds (`7/4/2026 7:00:00 AM`) that no `datetime`
    // cell on the same screen showed — the objectui#4576 shape, one concept
    // with two option bags kept in step by nothing.
    //
    // The register is what picks the face: form / detail takes the verbose
    // default (`Jul 4, 2026, 07:00 AM` in `en`), which every non-cell caller
    // already gets; the sub-grid CELL takes `'compact'` (see `GridField`'s
    // `temporalText`). ⛔ The year is NOT dropped here: that rule is
    // `formatDate`'s date-only cell rule (`c15d7eca6`) and the ruling on
    // #8209 declines to extend it to `datetime`.
    //
    // An unparseable value now reaches `formatDateTime`'s shared empty face
    // (`—`) instead of the literal `Invalid Date Invalid Date`, exactly as
    // objectui#8194 left the four `date` widgets it converged.
    return <span className="text-sm">{formatDateTime(value, { locale })}</span>;
  }

  const domProps = toDomProps(props);
  /**
   * A stored value written on a day that does not exist (objectui#10474). The
   * adapter hands the control `""` for it — the control can paint such a day
   * only blank (measured in Chromium), and any real day would be one nobody
   * wrote. So the stored string is NAMED beside the control, with the invalid
   * marker on the control itself, and nothing is written until the user picks
   * a new value: the control emits only on a user edit.
   */
  const impossible = isImpossibleStoredDay(value);
  const describedBy = impossible
    ? [domProps['aria-describedby'], noticeId].filter(Boolean).join(' ')
    : domProps['aria-describedby'];

  /**
   * `aria-invalid` after the DOM spread below, the objectui#3222 idiom shared
   * with the other readers (`SelectField`, `EmailField`, `NumberField`):
   * `error` is the published validation slot
   * (`@objectstack/spec/ui`'s `FieldWidgetPropsSchema`) and `!!undefined`
   * yields an explicit `"false"`, so a valid field SAYS it is valid rather
   * than staying mute.
   *
   * There is no composite-target question here despite the name "picker": the
   * widget renders ONE `<input type="datetime-local">`, and the browser's date-and-time
   * picker is that same element's own UI, not a second element. So the
   * focusable control a keyboard user lands on IS the carrier -- no wrapper is
   * marked (the objectui#5223 line).
   *
   * Reading it here is what makes the delivery non-inert for `datetime-local`
   * (objectui#7126). The FORM path already announced correctly, because
   * `<FormControl>`'s Radix `Slot` value reached the input through the spread
   * untouched; every host WITHOUT that Slot -- `FieldEditWidget`, i.e. the
   * kanban required-fields dialog and the grid / detail inline editors --
   * hands the state over as the declared `error` prop (delivered since
   * `f08bcd9af`) and nothing read it. MARKING only: the message TEXT stays
   * with the host.
   */
  const control = (
    <Input
      {...domProps}
      type="datetime-local"
      // The record's value is ISO-8601 (`…T14:30:00.000Z`), which this control
      // rejects outright — it renders empty and the user reads that as a lost
      // value (objectui#3127). Convert in, and back out on the same basis.
      value={toDateTimeInputValue(value)}
      onChange={(e) => onChange(fromDateTimeInputValue(e.target.value))}
      onClick={(e) => {
        openNativePicker(e.currentTarget);
        domProps.onClick?.(e);
      }}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error || impossible}
      aria-describedby={describedBy}
    />
  );
  if (!impossible) return control;
  return (
    <div className="space-y-1">
      {control}
      <p id={noticeId} className="text-xs text-destructive" data-testid="datetime-impossible-day">
        {t('fields.dateTime.impossibleDay', { value: String(value) })}
      </p>
    </div>
  );
}
