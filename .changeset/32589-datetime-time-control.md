---
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

fix(fields): the date-time picker's popover picks the hour and minute

Clause-②: yes (widening: fields.datePicker.time, fields.datePicker.hour, fields.datePicker.minute)
Metadata-protocol: none

A `datetime` field on a record form (and in the action-param, bulk-action and inline editors that draw the same picker) opened a popover with a day calendar and the Today / Tomorrow shortcuts only. Picking a day wrote that day at the value's old time, or at `00:00` when the field was empty, and the only way to set an hour was to type the whole value into the text box.

The popover now carries an hour and a minute control under the calendar:

- **Hours** are labelled in the display locale's own clock, the one the text box shows (`06 PM` in English, `18时` in Chinese). **Minutes** are offered every 5 minutes; a value's own minute off that grid (`09:17`) is still offered and kept, so nothing stored is rounded. The step is fixed: no field key declares a time step.
- **Picking a day keeps the value's time.** With an empty field it writes the day at `00:00`, keeps the popover open and moves focus to the hour control, so the time is the next thing chosen instead of a midnight committed out of sight. Picking a time before a day writes it on today.
- **The value written is unchanged in shape:** the ISO instant of the local wall clock, through the same conversion the text box uses, so a picked time reads back as the time picked.

The `date` face is unchanged: no time row, and a day pick closes the popover.

New language-pack keys in all eleven packs: `fields.datePicker.time`, `fields.datePicker.hour` and `fields.datePicker.minute`.
