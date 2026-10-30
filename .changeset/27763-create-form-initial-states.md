---
'@object-ui/core': patch
'@object-ui/plugin-form': patch
---

fix(plugin-form): a create form offers a `state_machine`-governed select only the machine's `initialStates`, so no option on it ends in `invalid_initial_state`

Clause-②: no
Metadata-protocol: none

An object's `state_machine` validation can declare `initialStates`, the values a new record may be created in; the server refuses an insert with any other value (`invalid_initial_state`). Create forms used to offer every option of that select anyway, so a user picking, say, `active` on the showcase "New Project + Tasks" form learned only from the refusal after submit that `planned` was the one value allowed.

Now every create form layout (the in-page form, the master-detail header, the drawer, the dialog, the tabbed and wizard forms) offers such a select only its `initialStates`, through the same field gate that already narrows an edit form to the moves from the stored value. Two rules hold:

- A machine that declares no `initialStates`, or that is `warning`/`info`, inactive or update-only, leaves the create form's options unconstrained, exactly where the server does not police the insert.
- The value the form opens with (a seeded `default: true` option or the caller's pre-fill) stays offered even outside `initialStates`, so the form never silently drops what it was handed; the server's refusal still names it.

`@object-ui/core` gains `stateMachineInitialValues(objectSchema, fieldName)`, the insert-side sibling of `stateMachineNextValues`.
