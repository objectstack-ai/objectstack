/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, isRealCalendarDate, toDisplayDate } from '@object-ui/core';
import type { DatePickerSchema } from '@object-ui/types';
import { Calendar, Button, Popover, PopoverTrigger, PopoverContent, Label } from '../../ui';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../../lib/utils';
import { useDisplayDateLocale } from '../../lib/date-fns-locale';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

/**
 * The day the trigger labels and the calendar selects (objectui#10844).
 *
 * `value` is a `Date` once the calendar has been used (`onSelect` hands one
 * back), but an authored or bound value arrives as the ISO string
 * `DatePickerSchema.value` admits, and date-fns and react-day-picker parse a
 * string with the engine's own `Date` parse. That reads a DATE-ONLY string as
 * UTC midnight, so west of UTC `2024-01-15` was labelled and selected as
 * January 14th. A date-only string naming a real day is therefore read through
 * the shared parse step, which rebuilds it at LOCAL midnight of that day (the
 * objectui#10183 convention).
 *
 * Everything else passes UNCHANGED, so the engine parses it exactly as before:
 * a `Date`, a date-time string (an instant, shown in the viewer's zone), and a
 * string that is no real date-only day. The last includes an unparseable
 * string, on which the trigger's `format` throws as it always has, and a
 * date-only string naming a day its month does not have (`2024-02-30`), which
 * the engine still rolls forward. Refusing that one here, as `toDisplayDate`
 * does, would hand `format` an Invalid Date and make it throw where it
 * rendered before.
 */
function toPickerDay(value: Date | string | undefined): Date | string | undefined {
  return typeof value === 'string' && isRealCalendarDate(value) ? toDisplayDate(value) : value;
}

ComponentRegistry.register('date-picker',
  ({ schema, className, value, onChange, ...props }: { schema: DatePickerSchema; className?: string; value?: Date | string; onChange?: (date: Date | undefined) => void; [key: string]: any }) => {
    // `schema.format` is a date-fns pattern, and it is spelled in the display
    // locale: `PPP` and the textual tokens name months and weekdays in the
    // session's language (objectui#10722).
    const locale = useDisplayDateLocale();
    const day = toPickerDay(value);
    // The calendar's props are typed `Date`; a string left in `day` is one the
    // engine parses, which react-day-picker's date-fns comparisons did with
    // `value` before (see `toPickerDay`). The cast states that, it converts
    // nothing.
    const calendarDay = day as Date | undefined;

    const handleSelect = (date: Date | undefined) => {
      if (onChange) {
        onChange(date);
      }
    };

    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...triggerProps 
    } = props;

    return (
      <div 
        className={`grid w-full max-w-sm items-center gap-1.5 ${schema.wrapperClass || ''}`}
        data-obj-id={dataObjId}
        data-obj-type={dataObjType}
        style={style}
      >
        {schema.label && <Label htmlFor={schema.id}>{schema.label}</Label>}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id={schema.id}
              variant="outline"
              className={cn(
                'w-full justify-start text-left font-normal',
                !value && 'text-muted-foreground',
                className
              )}
              {...toFormControlDomProps(triggerProps)}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {day ? format(day, schema.format || 'PPP', { locale }) : <span>{schema.placeholder || 'Pick a date'}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            {/*
              Opens on the value's month, and on today's with no value
              (objectui#10799): react-day-picker's `selected` does not move the
              month it opens on. The content unmounts on close, so each open
              reads the current value.
            */}
            <Calendar
              mode="single"
              defaultMonth={calendarDay}
              selected={calendarDay}
              onSelect={handleSelect}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Date Picker',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'placeholder', type: 'string' },
      { name: 'format', type: 'string', description: 'date-fns format string (e.g., "PPP", "yyyy-MM-dd")' },
      { name: 'id', type: 'string', required: true }
    ],
    defaultProps: {
      label: 'Date',
      placeholder: 'Pick a date',
      format: 'PPP',
      id: 'date-picker-field'
    }
  }
);
