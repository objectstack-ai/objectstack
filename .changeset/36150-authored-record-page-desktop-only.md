---
'@object-ui/app-shell': minor
---

feat(app-shell): an authored record page is drawn on the desktop full page only; a phone and the side drawer draw the standard page

Clause-②: no
Metadata-protocol: semantic

What a `kind: 'full'` record page means changes: it is drawn on the desktop full page only. On a phone, and in every embedded record view (the side drawer a list opens, the split pane, an interface page's preview), the record draws the platform's standard page for its object, whether or not the object has an authored page. **Open full page** from the drawer still lands on the authored page.

The standard page keeps what the object declares: field groups and order, field permissions and visibility, the `record_header` / `record_more` actions, one tab per child table, the stage and the approval state. The authored page's layout does not apply there, nor anything that lives only on it: its tabs and sections, page-only related lists and blocks, banners, and `record_section` actions, which the standard page does not draw. To keep such an action reachable on a phone and in the drawer, add `record_more` to its `locations` (and leave it out of the authored header's `actions` list, so the full page still draws it once). There is no setting that keeps an authored page on the phone or in the drawer.

Unchanged: a slotted page (the standard page with slots filled) applies everywhere; a page named in the URL (`…/record/:id/page/:pageName`, print pages included) is drawn wherever that route renders; the platform's approval request (`sys_approval_request`) and user (`sys_user`) pages keep their own page on every surface.

Nothing to migrate: no metadata key changes, and the desktop full page draws exactly as before.
