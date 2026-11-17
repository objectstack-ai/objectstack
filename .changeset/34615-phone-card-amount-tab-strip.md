---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
---

fix(ui): a phone list card shows its amount in full, and a form's tab strip no longer widens a phone screen

Clause-②: no
Metadata-protocol: none

- Phone list cards: the card's amount is the first shown column whose field type is `currency`. It used to share the subtitle line with the next column and was truncated with it (`CN¥1,2…`). It now has a line of its own under the subtitle, right-aligned and never truncated, with the status chip at that line's left. The subtitle shows the next shown column in its place. A list with no currency column draws its cards as before.
- Form field tabs (`fieldTabs`, also used by tabbed modal and tabbed forms): below the `sm` breakpoint a horizontal tab strip is capped at its container's width, and tabs that do not fit scroll sideways with no scrollbar drawn, so the page no longer scrolls sideways. The active tab is kept in view: on a tap, on `defaultFieldTab`, and when a failed submit jumps to the tab with the first error, whose red dot stays on the trigger. Desktop strips and vertical strips are unchanged.
