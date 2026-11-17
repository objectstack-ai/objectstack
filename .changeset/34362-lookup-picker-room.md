---
'@object-ui/fields': patch
---

fix(fields): the lookup picker's list fits the room it is given, marks a cut row as "scroll for more", and lets an option's secondary fields wrap

Clause-②: no
Metadata-protocol: none

The lookup quick-picker's option list had a fixed 16rem height. With a one-line preview under each option, that height ends part-way through the fifth row, so the last visible option showed its name and lost its preview, with nothing saying the list scrolls. On a short window the popover was also taller than the room on either side of the field and ran off the screen. Radix already flips the popover to the side with more room, inside a dialog too; the list simply ignored how much room that side had.

- The popover is now no taller than the room Radix reports on the side it opens to. The search row keeps its height and the list takes what is left, up to the same 16rem.
- When options continue past the top or the bottom edge of the list, that edge fades out, so a row cut there reads as "scroll for more". The keyboard scrolls the active option clear of the fade.
- An option's preview wraps onto a second row when its columns do not fit side by side, so two text columns (an email and an account name, say) are no longer both cut to fit one row. A column that does not fit on two rows leaves whole, as before; a badge is never cut and a text value is never cut below its label. A text value that is still cut short shows its whole text on hover.
