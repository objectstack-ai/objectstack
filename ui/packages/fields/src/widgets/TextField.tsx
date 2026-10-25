import React from 'react';
import { Input, Textarea, EmptyValue } from '@object-ui/components';
import type { TextFieldMetadata, TextareaFieldMetadata } from '@object-ui/types';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * TextField - Standard single-line or multi-line text input
 * Automatically renders as a textarea when rows are configured in field metadata
 */
export function TextField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const fieldData = field;

  if (readonly) {
    return <span className="text-sm">{value || <EmptyValue />}</span>;
  }

  // Cast for rows property
  const rows = (fieldData as unknown as TextareaFieldMetadata)?.rows;

  const domProps = toDomProps(props);

  // The spec's `maxLength` (objectui#10179), read the way `TextAreaField`
  // reads it and put on whichever element renders below. `TextFieldMetadata`
  // and `TextareaFieldMetadata` both declare it by reference to
  // `FieldSchema.maxLength` (objectui#11070), so the read is compiler-checked.
  // `toDomProps` forwards no `maxLength`, so this read is the only way a
  // declared ceiling reaches the input. The retired snake_case `max_length`
  // is read by no widget.
  const maxLength = (fieldData as TextFieldMetadata | TextareaFieldMetadata | undefined)?.maxLength;

  /**
   * `aria-invalid` is written AFTER the DOM spread in both branches below, the
   * objectui#3222 idiom the other readers already share (`SelectField`,
   * `EmailField`, `NumberField`): `error` is the published validation slot
   * (`@objectstack/spec/ui`'s `FieldWidgetPropsSchema`), and `!!undefined`
   * yields an explicit `"false"` so a valid field SAYS it is valid rather than
   * staying mute.
   *
   * Reading it here is what makes the delivery non-inert for `text`
   * (objectui#7126). In the FORM this widget was already announced correctly —
   * `<FormControl>` is a Radix `Slot` and its `aria-invalid` reached the input
   * through the spread untouched. Every OTHER host of this widget was not:
   * `FieldEditWidget` renders no Slot, so the kanban required-fields dialog and
   * the grid / detail inline editors hand the state over as the declared
   * `error` prop (delivered since `f08bcd9af`) and nothing read it — the red
   * "Required" hint was on screen while assistive tech was told nothing.
   *
   * MARKING only. The message TEXT stays with the host (`<FormMessage/>` in the
   * form, the red hint in the dialog); a widget that printed it too would show
   * the user the same sentence twice.
   */
  if (rows && rows > 1) {
    return (
      <Textarea
        {...domProps}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fieldData?.placeholder}
        maxLength={maxLength}
        disabled={readonly || domProps.disabled}
        aria-invalid={!!error}
      />
    );
  }

  return (
    <Input
      {...domProps}
      type={fieldData?.type === 'password' ? 'password' : 'text'}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={fieldData?.placeholder}
      maxLength={maxLength}
      disabled={readonly || domProps.disabled}
      aria-invalid={!!error}
    />
  );
}
