---
'@objectstack/spec': minor
---

React-tier `<ListView>`: the `onNavigate` declaration becomes
`(recordId, action: 'view' | 'new_window') => void` — a declared value **no branch ever
emitted** is removed, and the value **two reference call sites do emit** is added.

`REACT_BLOCKS`' ListView overlay declared the second argument as `'view' | 'edit'`. That
sentence was false in both directions. `'edit'` is emitted by no call site in the
reference implementation and read by no branch; `'new_window'` — what a Cmd/Ctrl- or
middle-click, and an authored `navigation: { mode: 'new_window' }`, actually send — was
not declared at all. An author reading this contract wrote a handler with one dead arm
and one missing arm.

The second argument is a navigation-MODE token with a **closed vocabulary**, and the
declaration now says so. That closedness is not new: the protocol's own retirement note
for `view.list.navigation.view` (removed in 17.5.0, ADR-0049) records that anything
outside the mode vocabulary "matched no branch". What this change corrects is the
membership of the vocabulary, not its closedness.

## FROM → TO

| you wrote | write instead |
| --- | --- |
| `onNavigate={(id, action) => { if (action === 'edit') … }}` | delete that arm — nothing ever called it |
| a handler with no `'new_window'` arm | handle `'new_window'`: open the record in a new browser tab. Omitting the arm leaves the modifier-click path doing nothing |
| `onNavigate={(id) => …}` (one argument) | unchanged — the arity is untouched |

**The one-line fix:** replace the `'edit'` arm with a `'new_window'` arm.

Scope: this moves a **declaration**, not a type or a runtime check. `REACT_BLOCKS` types
this prop as a documentation string (`ReactBlockDef[]`), so no `.d.ts` signature moves
and nothing that compiles today stops compiling. The behaviour it describes is the
reference implementation's, which already emits exactly these two values; the sibling's
four declaration faces are corrected under objectui#9547 and its bump to
`@objectstack/spec` >= 17.5.0.

Clause-②: yes
