/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Button, Calendar, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { FieldWidgetComponentProps } from '../types.js';
import { toDomProps } from '../toDomProps.js';
import { DateField } from '../DateField.js';
import { DateTimeField } from '../DateTimeField.js';
import {
  toDateInputValue,
  toDateTimeInputValue,
  fromDateTimeInputValue,
  isImpossibleStoredDay,
} from '../nativeDateValue.js';
import {
  formatLocaleDateText,
  localeDatePattern,
  parseLocaleDateText,
  toLocalDay,
  fromLocalDay,
} from './localeDateText.js';
import { useFieldTranslation } from '../useFieldTranslation.js';

/**
 * The `date` and date-time controls of the form field widgets
 * (objectui#12622, objectui#12642).
 *
 * `fieldWidgetMap`'s `date` / `datetime` widgets — what a record form resolves
 * `field:date` / `field:datetime` to, and what `getLazyFieldWidget` hands the
 * action-param and bulk-action dialogs — draw the platform picker instead of
 * the browser's native input: a text box in the display locale's format (keyboard
 * entry), a calendar popover (the same `Calendar` the calendar view's date
 * popover opens, localized by the same resolver), a clear button, and
 * today / tomorrow shortcuts.
 *
 * ## The value written is unchanged
 *
 * Both faces go through the native adapters `DateField` / `DateTimeField` use
 * (`toDateInputValue`, `toDateTimeInputValue`, `fromDateTimeInputValue`), so a
 * `date` field writes `YYYY-MM-DD` and a `datetime` field writes an ISO
 * instant, exactly as the native inputs did; clearing writes `''` as the
 * native inputs did.
 *
 * ## Where the native input stays
 *
 * - The read-only face is `DateField` / `DateTimeField`'s own, rendered as is.
 * - `FieldEditWidget` (the grid's inline cell editor and the kanban
 *   required-fields dialog) draws THIS picker since objectui#12664, loaded
 *   lazily so it stays in its own chunk; the grid's cell seam blurs the
 *   control before Enter or a click outside commits, and that blur is where
 *   the typed text is read. plugin-detail's `InlineFieldInput` (the record
 *   page's details and highlights) delegates `date` and `datetime` to
 *   `FieldEditWidget` too since objectui#12759. The list filter rows are
 *   objectui#12743.
 * - A form whose `field:date` widget is not registered (no
 *   `@object-ui/fields` loaded) falls back to the form renderer's own
 *   `<input type={inputType}>`, with the `inputType` `ObjectForm` maps.
 */
export function DatePickerField(props: FieldWidgetComponentProps<string>) {
  return <TemporalPicker {...props} withTime={false} />;
}

/** The `datetime` face of {@link DatePickerField}. */
export function DateTimePickerField(props: FieldWidgetComponentProps<string>) {
  return <TemporalPicker {...props} withTime />;
}

function TemporalPicker({
  value,
  onChange,
  field,
  readonly,
  error,
  withTime,
  ...props
}: FieldWidgetComponentProps<string> & { withTime: boolean }) {
  const locale = useDisplayLocale();
  const { t } = useFieldTranslation();
  const noticeId = React.useId();
  const [open, setOpen] = React.useState(false);

  // The value in the native control's shape: `YYYY-MM-DD`, or the local wall
  // clock `YYYY-MM-DDTHH:mm`. `''` for an empty value and for a stored day that
  // does not exist (named in the notice below, as `DateField` names it).
  const impossible = isImpossibleStoredDay(value);
  const nativeValue = impossible ? '' : withTime ? toDateTimeInputValue(value) : toDateInputValue(value);
  const shown = formatLocaleDateText(nativeValue, locale, withTime);

  const [text, setText] = React.useState(shown);
  const [badText, setBadText] = React.useState<string | null>(null);
  // A new value or locale from outside replaces the text; typing does not
  // reach here until it is committed. Adjusted while rendering (React's
  // "storing information from previous renders"), not in an effect.
  const [lastShown, setLastShown] = React.useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    setText(shown);
    setBadText(null);
  }

  if (readonly) {
    const ReadonlyFace = withTime ? DateTimeField : DateField;
    return <ReadonlyFace value={value} onChange={onChange} field={field} readonly error={error} {...props} />;
  }

  const domProps = toDomProps(props);
  const disabled = !!domProps.disabled;

  /** Writes a native-shaped value (or `''`) in the field's stored shape. */
  const write = (next: string) => {
    const stored = withTime ? fromDateTimeInputValue(next) : next;
    setBadText(null);
    setText(formatLocaleDateText(next, locale, withTime));
    if (next !== nativeValue) onChange(stored);
  };

  const commitText = () => {
    const parsed = parseLocaleDateText(text, locale, withTime);
    if (parsed === null) {
      setBadText(text);
      return;
    }
    write(parsed);
  };

  /** A day picked in the calendar or by a shortcut keeps the value's time. */
  const pickDay = (day: Date | undefined) => {
    if (!day) return;
    const time = nativeValue.slice(11, 16) || '00:00';
    write(withTime ? `${toLocalDay(day)}T${time}` : toLocalDay(day));
    setOpen(false);
  };

  const shortcut = (offsetDays: number) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offsetDays);
    pickDay(day);
  };

  const selected = nativeValue ? fromLocalDay(nativeValue) : undefined;
  const pattern = localeDatePattern(locale, withTime);
  const notice = badText !== null
    ? t('fields.datePicker.invalid', { value: badText, format: pattern })
    : impossible
      ? t(withTime ? 'fields.dateTime.impossibleDay' : 'fields.date.impossibleDay', { value: String(value) })
      : null;
  const describedBy = notice
    ? [domProps['aria-describedby'], noticeId].filter(Boolean).join(' ')
    : domProps['aria-describedby'];

  return (
    <div className="space-y-1" data-slot="date-picker">
      <div className="relative">
        <Input
          {...domProps}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={cn('pr-16', domProps.className)}
          placeholder={pattern}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            commitText();
            domProps.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Commit, and keep a bare Enter from submitting the form with
              // the text not yet read.
              e.preventDefault();
              commitText();
            }
          }}
          disabled={disabled}
          // After the DOM spread, the objectui#3222 idiom `DateField` follows.
          aria-invalid={!!error || impossible || badText !== null}
          aria-describedby={describedBy}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {!disabled && (text || nativeValue) ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t('fields.datePicker.clear')}
              data-testid="date-picker-clear"
              onClick={() => write('')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled}
                aria-label={t('fields.datePicker.openCalendar')}
                data-testid="date-picker-trigger"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              {/* Opens on the value's month, and on today's with no value. */}
              <Calendar mode="single" defaultMonth={selected} selected={selected} onSelect={pickDay} autoFocus />
              <div className="flex items-center gap-2 border-t p-2">
                <Button type="button" variant="outline" size="sm" onClick={() => shortcut(0)}>
                  {t('fields.datePicker.today')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => shortcut(1)}>
                  {t('fields.datePicker.tomorrow')}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {notice ? (
        <p id={noticeId} className="text-xs text-destructive" data-testid="date-picker-notice">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
