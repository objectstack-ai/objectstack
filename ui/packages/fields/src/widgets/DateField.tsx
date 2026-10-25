import React from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { formatDate, toDisplayDate } from '@object-ui/core';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { openNativePicker } from './openNativePicker.js';
import { toDateInputValue, isImpossibleStoredDay } from './nativeDateValue.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/**
 * DateField - Date picker input widget
 * Uses native date input and displays locale-formatted date in readonly mode
 */
export function DateField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  // Before the readonly early return: the hook count must not depend on a prop
  // (objectui#4468). A bare `toLocaleDateString()` reads the MACHINE's locale,
  // which is how a Chinese form ended up with an `8/11/2026` value in it.
  const locale = useDisplayLocale();
  const { t } = useFieldTranslation();
  const noticeId = React.useId();
  if (readonly) {
    // The readonly face is `formatDate`'s DEFAULT style — the one home for the
    // `date` display convention (objectui#8194, following the maintainer's
    // ruling A behind `c15d7eca6`). It used to call `toLocaleDateString(locale)`
    // with NO options bag, i.e. `Intl`'s numeric default (`7/4/2026`), so it
    // never implemented the deliberate year-dropping decision `formatDate`
    // documents — and this widget's readonly face is what `FieldEditWidget`
    // renders in the grid / detail inline editors, right beside
    // `DateCellRenderer`'s `Jul 4`. Two faces for one value, picked by which
    // path the surface happened to take: `c15d7eca6`'s fact pattern verbatim.
    // A field that genuinely wants the year on every row is an explicit
    // `format` style honoured by both paths, never a second option bag.
    //
    // `undefined` in the positional slot is how the published signature
    // `formatDate(value, style?, options?)` asks for the default face; the
    // positional argument outranks `options.style` (objectui#7745).
    //
    // An UNPARSABLE value reaches that SAME affordance (objectui#8809).
    // `formatDate` answers this input with its own em-dash, and painting that
    // dash in the plain span below is naked punctuation to a screen reader: no
    // `data-slot` of `empty-value`, no accessible name. That is the
    // objectui#8475 / objectui#8491 class of defect, and it is the CARRIER
    // that is wrong here, not the glyph.
    //
    // The glyph does not move, and must not be read as moving: `EmptyValue`'s
    // own default glyph IS this em-dash. So this swaps the carrier only,
    // which is exactly why objectui#8194's landed pin stays green -- it reads
    // `container.textContent`, and that text is still a dash.
    //
    // That distinction is also what keeps this repair inside the card's
    // authority. objectui#8194 enumerated the four `formatDate` sites, fed
    // each this exact input and split them 3-1 ON PURPOSE, putting this face
    // on the dash side and `GridField` on the raw-string side ("showing the
    // user what is actually stored beats hiding it", objectui#3569). Moving
    // this face to the raw string would REVERSE that documented, pinned
    // choice -- a maintainer-level call, not this one's.
    //
    // Co-extensive with the dash it replaces, never wider: `toDisplayDate` IS
    // `formatDate`'s own parse step, so this branch answers exactly the
    // values the shared function answers with a dash for being UNREADABLE,
    // while the falsy guard just below still owns every value it answers with
    // a dash for being EMPTY. It read `new Date(value)` until objectui#10026
    // made that step refuse a date-only nonexistent day (`2026-02-30`), which
    // the engine's parse accepts — so the old spelling let exactly that input
    // through to the bare dash this branch exists to replace.
    if (!value) return <EmptyValue />;
    if (isNaN(toDisplayDate(value as unknown as string).getTime())) return <EmptyValue />;
    return <span className="text-sm">{formatDate(value, undefined, { locale })}</span>;
  }

  const domProps = toDomProps(props);
  /**
   * A stored value written on a day that does not exist (objectui#10567, the
   * date-only half of objectui#10474). `toDateInputValue` keeps such a day as
   * written, but an `<input type="date">` sanitises it to `""` (measured in
   * Chromium; the HTML value sanitisation algorithm for `date` says the same),
   * so the control alone would be objectui#3127's silent blank. The control is
   * handed `""` — the only thing it can paint — and marked invalid, and the
   * stored string is NAMED beside it: `DateTimeField`'s face for the same
   * value. Nothing is written until the user picks a new day: the control
   * emits only on a user edit.
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
   * widget renders ONE `<input type="date">`, and the browser's date
   * picker is that same element's own UI, not a second element. So the
   * focusable control a keyboard user lands on IS the carrier -- no wrapper is
   * marked (the objectui#5223 line).
   *
   * Reading it here is what makes the delivery non-inert for `date`
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
      type="date"
      // An API that hands back `2026-06-17T00:00:00.000Z` for a `date` field
      // would leave this control empty too (objectui#3127). The written-back
      // shape is unchanged: the control's own plain `YYYY-MM-DD`.
      value={impossible ? '' : toDateInputValue(value)}
      onChange={(e) => onChange(e.target.value)}
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
      <p id={noticeId} className="text-xs text-destructive" data-testid="date-impossible-day">
        {t('fields.date.impossibleDay', { value: String(value) })}
      </p>
    </div>
  );
}
