---
'@object-ui/app-shell': patch
---

fix(app-shell): a screen-flow wizard step toasts "Saved — next step" only when it saved a record

Clause-②: no
Metadata-protocol: none

In a screen-flow wizard, every step that led to another screen showed the toast "Saved — next step", even a step that only collected input. In a wizard that creates its record on step 3, steps 1 and 2 told the user something was saved when nothing was.

What changes:

- A step with plain input fields that leads to another screen now shows no toast. The next screen appearing is the answer.
- An `object-form` step still shows "Saved — next step", because it saved its record before the run moved on.
- The toast at the end of the run is unchanged.

The step button still reads "Submit" on every step. The paused screen the server sends does not say whether it is the last one, so the dialog cannot tell a middle step from the final one yet.

What to do: nothing. Nothing a flow declares changes.
