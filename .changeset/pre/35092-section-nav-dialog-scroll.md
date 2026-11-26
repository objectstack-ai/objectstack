---
'@object-ui/plugin-form': patch
---

fix(plugin-form): a section navigation jump in a grouped record dialog scrolls only the form, so the dialog keeps its title, navigation and footer in place

Clause-②: no
Metadata-protocol: none

In a record dialog with grouped sections, clicking the navigation entry of a short last section used to scroll the dialog box itself: the title and the section navigation moved out of the top of the dialog, a blank area opened below the footer, and nothing could scroll it back, so the user had to close the dialog and lose what they had typed. Two things made that possible, and both are fixed:

- The jump scrolled the section heading with an element `scrollIntoView`, which also scrolls every scrollable ancestor, the dialog's clipped (`overflow: hidden`) box included. It now scrolls only the heading's own scroller (the form's body, or the window for a full-page form) with `scrollTo`, keeping the heading's scroll margin.
- The dialog's form body is now `relative`, so the hidden native inputs a checkbox or a select mounts beside its control are clipped by the form body and scroll with it, instead of overflowing the dialog box.

The highlight rule, section folding and the required-field counts are unchanged. Nothing to migrate.
