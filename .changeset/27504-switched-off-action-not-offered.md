---
'@object-ui/core': patch
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
---

fix(console): a packaged action switched off for this deployment is no longer offered as a live button

Clause-②: yes (widening)
Metadata-protocol: none

An administrator can switch a packaged action off in Setup › Packaged automation. The action door then refuses it, but the console kept offering the button on the record header, in action bars and in list rows, so a click could only fail. The object reads now serve the names of the switched-off actions beside the object (#27842), and the console stops offering those actions everywhere it already hides an action whose capability the user lacks: the record header, action bars, record quick actions, list and related-list toolbars, row and bulk actions. Turning the action back on in Setup brings the button back.

`@object-ui/core` adds four exports for this: `isActionSwitchedOff(action)`, `markSwitchedOffActions(schema, served)`, `markSwitchedOffActionsByObject(objects, served)` and `ACTION_SWITCHED_OFF_KEY`. The data layer stamps a switched-off action entry under that symbol key, which survives a spread and never reaches JSON, so an action handed back to a metadata write never carries it.

What to do: nothing. A backend that does not serve the names hides nothing, as before.
