import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { openNativePicker } from './openNativePicker.js';

/**
 * TimeField - Time picker input widget
 * Uses native time input for hour and minute selection
 */
export function TimeField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  if (readonly) {
    return <span className="text-sm">{value || <EmptyValue />}</span>;
  }

  const domProps = toDomProps(props);

  /**
   * `aria-invalid` after the DOM spread below, the objectui#3222 idiom shared
   * with the other readers (`SelectField`, `EmailField`, `NumberField`):
   * `error` is the published validation slot
   * (`@objectstack/spec/ui`'s `FieldWidgetPropsSchema`) and `!!undefined`
   * yields an explicit `"false"`, so a valid field SAYS it is valid rather
   * than staying mute.
   *
   * There is no composite-target question here despite the name "picker": the
   * widget renders ONE `<input type="time">`, and the browser's time
   * picker is that same element's own UI, not a second element. So the
   * focusable control a keyboard user lands on IS the carrier -- no wrapper is
   * marked (the objectui#5223 line).
   *
   * Reading it here is what makes the delivery non-inert for `time`
   * (objectui#7126). The FORM path already announced correctly, because
   * `<FormControl>`'s Radix `Slot` value reached the input through the spread
   * untouched; every host WITHOUT that Slot -- `FieldEditWidget`, i.e. the
   * kanban required-fields dialog and the grid / detail inline editors --
   * hands the state over as the declared `error` prop (delivered since
   * `f08bcd9af`) and nothing read it. MARKING only: the message TEXT stays
   * with the host.
   */
  return (
    <Input
      {...domProps}
      type="time"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => {
        openNativePicker(e.currentTarget);
        domProps.onClick?.(e);
      }}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error}
    />
  );
}
