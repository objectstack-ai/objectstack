---
'@object-ui/plugin-form': patch
'@object-ui/components': patch
---

fix(plugin-form): a grouped record dialog's section bar is a jump bar, not tabs: it is hidden when the sections fit, and a click marks the section it jumped to

Clause-②: no
Metadata-protocol: none

A create or edit dialog for an object with field groups and no authored form layout draws every group stacked, with a row of group names above them. That row is a jump bar: a click scrolls the form to the group. It was drawn as underlined tabs, so users expected a click to switch the content, and when every group fit the dialog a click had nothing to scroll and only the highlight moved, which looked like tabs that do not work.

- The bar is drawn as jump links (a `#` glyph and a pill per group), not as underlined tabs.
- The bar is hidden while every group fits the dialog body, and comes back when the content outgrows it (a group unfolding, a field appearing, a smaller window). The dialog header keeps its separator when the bar is hidden.
- A click marks the heading of the group it jumped to for a moment, so a jump to a group already in view still shows where it went.

The same rules apply to the full-page form's section bar. An authored `tabbed` layout keeps its tab strip, which switches the content as before; collapsed groups, the highlight rule and the error counts are unchanged. Nothing to migrate.
