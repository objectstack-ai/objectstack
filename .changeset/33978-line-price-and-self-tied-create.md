---
'@objectstack/skills': patch
---

docs(skills): an action that adds a child line sets the line's price, and a create policy tied to the caller gets a `current_user` default

Clause-②: no
Metadata-protocol: none

`objectstack-ui` `rules/actions.md` teaches that an action inserting a line item reads the price from the source the build declares (or takes it as a required param), because `lookupAutofill` and a stored `expression` do not fill it on a server-side insert. `objectstack-data` `rules/security.md` teaches that a `check` over a field the request never names refuses a plain create, and that `defaultValue: 'current_user'` on the tying `user` field fills it before `check` is judged. One eval case each.
