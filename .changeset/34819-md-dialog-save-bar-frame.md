---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the master-detail record dialog keeps its Save bar at the dialog's bottom, and the form section navigation follows a scroll that lands inside its click hold

Clause-②: no
Metadata-protocol: none

**Save bar.** A record dialog whose form carries an inline sub-table (`subforms`) drew the master-detail form's Save bar as a sticky box inside the dialog's body scroller. A sticky box stops at its scroller's content edge, so the bar floated above the dialog's bottom by the scroller's bottom padding, and rose further as the body scrolled past the form's own end. The dialog now hands the form a frame of fixed height: the form scrolls its body in a box of its own and draws the bar as the row below it, outside the scrolled content. From the bar's bottom to the dialog's bottom is now the dialog's padding at every scroll position, maximized too — the same distance as the footer of a dialog without a sub-table. The form still owns its Save (ADR-0035 Decision §6), the close guard is unchanged, and the drawer and the record page keep the sticky bar.

**Section navigation.** After a click on a section entry, the navigation holds the highlight for 800 ms so the jump does not light up every section it passes. A scroll that landed inside that hold was never measured, so a refused submit right after a jump left the highlight on the clicked section while the form showed its first error. The navigation now measures once more when the hold ends. At the bottom of a short tail, where several headings are in view, the section the click picked keeps the highlight.
