---
'@objectstack/lint': patch
---

fix(lint): a default or create form that a form-type action opens by name is not reported as internal

Clause-②: no
Metadata-protocol: none

The advisory rule `form-view-internal-not-loaded` warned on every default form (`form`, `formViews.default`, an `isDefault` form view item) and every create form (`formViews.create`, `OBJECT.create`) that is not shared publicly. A `type: 'form'` action can still open one of those forms by its name, and the Console still loads it then, so for that form the warning said "no longer loaded" about a form users reach.

The rule now leaves such a form out. A form counts as opened by an action when the `target` of a `type: 'form'` action in the stack equals the name the form is served under: the item's own `name` for a stored form view item, and for a view container's form the name the spec's container expansion gives it (`OBJECT.form` for the default form, or its own `name`; `OBJECT.create` for `formViews.create`; a key collision's renamed name). The actions read are `actions[]`, `objects[].actions[]` and a page component's inline `properties.action`. An interpolated target, a shorter spelling, or an action of another type exempts nothing. The `os explain form-view-internal-not-loaded` text says so.

The warning still fires for every other internal create or edit form, with the same message and hint. Nothing is refused or accepted differently.
