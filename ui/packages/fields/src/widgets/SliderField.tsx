import React from 'react';
import { Slider } from '@object-ui/components';
import type { SliderFieldMetadata } from '@object-ui/types';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';

/**
 * Slider field widget - provides a range slider input
 * Supports numeric values with configurable min, max, and step
 *
 * ## Where the host's facts go, and why (objectui#3318)
 *
 * This widget used to read exactly two keys off its props (`disabled`,
 * `className`) and forward nothing else, so everything `<FormControl>`'s Slot
 * delivered was dropped on the floor. Measured on `origin/main`, a real form
 * with a required slider that had just failed validation:
 *
 * ```
 * ariaInvalidTrue=[]   labelFor=…-form-item -> DANGLING
 * descConsumers=0      ids=[]   <- no element of the row carried an id at all
 * ```
 *
 * Three channels, one cause. The DOM pass-through now goes to the THUMB — the
 * `span[role="slider"]` a keyboard user lands on, which is where ARIA state
 * belongs — through the `thumbProps` the primitive grew for this
 * (`lib/slider-thumb.ts`; the shadcn `ui/slider.tsx` renders its thumb
 * internally and exports only `Slider`, so it cannot be addressed from here
 * the way objectui#3306 addressed `SelectTrigger`).
 *
 * The split of which keys stay on Root is `SelectField`'s, key for key:
 *
 * - `name`: Root owns the hidden input that takes part in form submission; on
 *   a `span` it is not even DOM-legal, and is exactly the leak objectui#3291
 *   sweeps for.
 * - `disabled`: Root is the single authority (it disables the thumb and the
 *   hidden input together); forwarding the raw prop to the thumb as well would
 *   give the state a second, OR-merged author.
 *
 * The visible label reaches the thumb by IDREF, not by `for`: a
 * `span[role="slider"]` is not one of HTML's labelable elements, so this widget
 * is declared `labelling: 'group'` for the same reason `file` is — see
 * `FIELD_WIDGET_LABELLING` in `../index` and objectui#3961. No extra
 * `role="group"` wrapper: there is one control here, and `slider` is a role
 * that carries a name perfectly well on its own.
 */
export function SliderField({
  value,
  onChange,
  field,
  readonly,
  error,
  ...props
}: FieldWidgetComponentProps<number>) {
  // Slider configuration, read through the keys `SliderFieldMetadata` declares
  // (objectui#10066). A structural view rather than the full interface: this
  // widget also serves `progress` fields, so asserting `type: 'slider'` would
  // claim more than the carrier guarantees.
  const sliderField = field as Pick<SliderFieldMetadata, 'min' | 'max' | 'step'>;
  const min = sliderField?.min ?? 0;
  const max = sliderField?.max ?? 100;
  const step = sliderField?.step ?? 1;

  if (readonly) {
    // No control to name or describe here, so this read-only row is the only
    // surface the host's label and help text have (objectui#3990 / #4005).
    return (
      <div {...toHostGroupProps(props, 'instead-of-the-inputs')} className="flex items-center gap-2">
        <span className="text-sm font-medium">{value ?? min}</span>
        <span className="text-xs text-muted-foreground">/ {max}</span>
      </div>
    );
  }

  // `name` and `disabled` stay on Root for the contract reasons in this
  // widget's doc comment above. `className` is withheld for a third, purely
  // mechanical one: the primitive spreads `thumbProps` AFTER the thumb's own
  // classes, so a host className routed through here would REPLACE the thumb's
  // shape rather than compose with it. It goes to Root below, exactly as before.
  const {
    name: domName,
    disabled: _domDisabled,
    className: _domClassName,
    ...thumbDomProps
  } = toDomProps(props);

  return (
    <div className="flex items-center gap-4">
      <Slider
        name={domName}
        value={[value ?? min]}
        onValueChange={(values) => onChange(values[0])}
        min={min}
        max={max}
        step={step}
        disabled={readonly || props.disabled}
        className={props.className}
        thumbProps={{
          ...thumbDomProps,
          // AFTER the spread so this widget's own computation wins, the #3222
          // discipline: `error` is the published validation slot
          // (`FieldWidgetPropsSchema`), and `!!undefined` must yield an explicit
          // `"false"` — a valid field SAYS it is valid rather than staying mute.
          'aria-invalid': !!error,
        }}
      />
      <span className="text-sm font-medium w-12 text-right">{value ?? min}</span>
    </div>
  );
}
