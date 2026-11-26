---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a state-machine row in the validations panel can say its state may be cleared, and editing the row keeps that

Clause-②: no
Metadata-protocol: none

A `state_machine` rule judges a clear of its field (`null` or `''`) as a transition to `''`, allowed only from a state that lists `''` among its targets. The Studio validations panel parsed a row's next states with the empty entries dropped, so an admin could not make a state clearable from Studio, and editing a row that already listed `''` silently removed it, after which users who cleared the field were refused again.

Each transition row now has a "May be cleared" checkbox that adds or removes the `''` target. The "Next states" box shows and edits the named targets only, and an edit to it keeps an existing `''` (written as the row's last target), so a rule with `paused: ['open', '']` is written back unchanged. Nothing changes in what the server accepts or how it judges a transition.
