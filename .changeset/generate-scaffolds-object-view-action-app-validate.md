---
"@objectstack/cli": patch
---

fix(cli): `os generate` scaffolds `object`, `view`, `action` and `app` that `os validate` accepts (#14336)

Four of the seven `os generate` templates wrote artifacts the platform's own
validator refused, so an author following the documented path got a file their
own toolchain rejected. `#14087` fixed `flow` and recorded these four in a
shrink-only ledger; this empties it. Measured through the same harness, on the
same two steps `os validate` performs — schema parse, then the author-time rule
registry:

```
objects[0].sharingModel  security-owd-unset — declares no sharingModel (OWD)
views[0].list            unrecognized key(s) on this list view: `pageSize`
views[0]                 unrecognized key(s) on this view container: `type`, `objectName`
actions[0].type          invalid option: expected "script"|"url"|"modal"|"flow"|"api"|"form"
actions[0]               unrecognized key(s) on this action: `handler`
apps[0].navigation       expected array, received object
```

**`object`** now authors `sharingModel: 'private'`. This is not a new decision:
`security-owd-unset` is an error-severity rule asking for an authored org-wide
default, and `#9666` already took that decision for the `os init` templates —
this emits the same value with the same explanation, so both doors an author
can arrive through agree.

**`view`** now emits a view CONTAINER instead of a flat list view. The
container's slots are `list` / `form` / `listViews` / `formViews`; `type`
belongs to a single view and the object binding is `object`, not `objectName`.
The flat shape mattered beyond the refusal — it parses to an *empty* container,
so zero views register and the Console renders nothing. `pageSize` moved to
`pagination`, which is the schema that declares it.

**`action`** now emits `type: 'flow'` with `target` naming the flow, which is
what its `handler: { type: 'flow', target }` block was trying to express.
`custom` is not an `ActionType`, and the second handler slot was removed in
protocol 17 so no consumer has two places to disagree about. The target is the
name `os g flow NAME` writes, so the two scaffolds compose.

**`app`** now emits `navigation` as the array of nav items it is declared as,
carrying one real `type: 'object'` entry rather than the `{ type: 'sidebar',
items: [] }` wrapper, which is not on the authoring surface at all. The entry
points at the object `os g object NAME` writes.

`KNOWN_UNVALIDATED_SCAFFOLDS` is now empty, so every generator on the roster is
held to the clean pin: a template that stops validating is red on the day it
lands. The ledger stays shrink-only — a red there is a template to fix, never a
line to add. No other generator's output changed.
