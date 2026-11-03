---
'@object-ui/app-shell': patch
---

fix(app-shell): a ⌘K record hit opens under the app that lists its object, not under the app the palette was opened in (#28890)

Clause-②: no
Metadata-protocol: none

An app whose navigation names no object (a component-only app, such as cloud's Account app) searches every object from the command palette, so its hits name objects it does not list. Each hit opened under that app all the same, and the record page drew its sidebar and app switcher, neither of which reaches the object: an environment found from the Account app opened in the Account app, not in the Cloud app that lists environments.

- **Now.** A record hit opens under the palette's own app when that app lists the hit's object; otherwise under the first app the user can open (active, not hidden, in metadata order) that lists it; and under the palette's own app when none does. "Lists" means a `type: 'object'` entry naming the object, at any depth of the app's `navigation` or of any `areas[].navigation`, among the entries the member is shown there.
- **Unchanged.** When the palette's app lists the object, the hit opens there as before. The palette's search scope is untouched: an app with no object navigation still searches every object.
