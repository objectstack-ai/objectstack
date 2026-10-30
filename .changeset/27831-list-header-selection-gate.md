---
'@object-ui/app-shell': patch
'@object-ui/core': patch
'@object-ui/plugin-grid': patch
'@object-ui/types': patch
---

fix(app-shell): a single-record action in a list's header is disabled, with the reason, unless exactly one row is selected, and is not drawn where the rows cannot be selected

Clause-②: yes (widening)
Metadata-protocol: none

On a list, a header action that runs on one record (for example Tasks → **Reassign…**, placed at `list_item` and `list_toolbar`) was drawn enabled with nothing selected, and said "select a row first" only after a click. Where the grid draws no row checkboxes, it could never work.

- **0 rows or several rows:** the action is drawn disabled. Its tooltip and accessible description are the refusal a click already gave ("This action runs on a single record — select a row first." / "… select exactly one row."), in the session's language, from the existing `actions.selectRowFirst` / `actions.selectExactlyOneRow` keys.
- **Exactly one row:** the action is enabled and runs as before.
- **A list whose rows cannot be selected:** the action is not drawn.
- **Object-level actions** (declared at `list_toolbar` only) are unchanged with no rows selected. With several rows selected they are disabled with the "select exactly one row" reason, because a click is refused the same way.
- **The header has no rule of its own.** It asks the action runner for the early refusal a launch would get (the dispatch handler's `refuseBeforeInput`, the same check that refuses a click before any dialog opens). That check stays as the backstop, for example for a `?runAction=` deep link.

New public members (additive):

- `@object-ui/core`: `ActionRunner.launchRefusal(action)` returns the early refusal `execute` would give the action against the runner's current context, translated by its key, or `undefined` if there is none. It runs, sends and shows nothing. `ActionRunner.subscribeContext(listener)` calls `listener` after every `updateContext` and returns an unsubscribe function.
- `@object-ui/types`: `ActionContext.selectionAvailable?: boolean` tells whether the list publishing `selectedRecords` lets its rows be selected at all.
- `@object-ui/plugin-grid`: `ObjectGrid` publishes `selectionAvailable` beside `selectedRecords` in the action context, and clears it when it unmounts.
