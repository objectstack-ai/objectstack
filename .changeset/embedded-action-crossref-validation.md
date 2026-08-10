---
"@objectstack/spec": minor
---

fix(spec): `defineStack`'s action cross-reference walk now reaches OBJECT-EMBEDDED actions (#7397)

The same defect as #6889, one authoring position over. `validateCrossReferences` iterated
the registered list (`config.actions`) and — since #6889 — inline page-element actions.
Neither walk visited actions authored directly on an object
(`config.objects[].actions[]`), even though that position carries the **full
`ActionSchema`**: the identical symbol the registered collection uses, not a narrower
embedded shape. So a `type: 'modal'` or `type: 'flow'` target written there was never
resolved. The card's ten-row probe, measured on `main` before this change — every stack
declares both a page and a flow, so the plugin size-gate cannot explain the acceptances,
and each embedded row's registered twin is built from the same helper with the same
arguments:

```
a embedded   modal -> page    :  ACCEPTED   (h registered: ACCEPTED)
b embedded   modal -> nothing :  ACCEPTED   (f registered: REJECTED)  <- split
c embedded   flow  -> nothing :  ACCEPTED   (g registered: REJECTED)  <- split
d embedded   modal -> object  :  ACCEPTED   (i registered: REJECTED)  <- split
e embedded   flow  -> flow    :  ACCEPTED   (j registered: ACCEPTED)
```

Rows b/f, c/g and d/i are the **same action object in two authoring positions with
opposite verdicts**. Row b is the defect on its own terms — a target naming nothing at all
built clean, shipped, and failed only when a user clicked it.

Why the registered walk could not already cover it: `validateCrossReferences` runs
**before** `mergeActionsIntoObjects`, and that merge only ever copies top-level → object
(by `objectName`), never the reverse. An action authored only on the object therefore
never appeared in the validated `config.actions` at all.

**Now**: `config.objects[].actions[]` is walked and every action found is subjected to the
**same** two target checks as a registered one — same rule, same message tail, same size
gates. Messages keep the registered wording from `references` onward and change only the
subject, because an embedded action is located by its owning object (`name` is required at
this position, so it is always available):

```
Action 'new_task' on object 'task' references page 'nowhere' (via modal target) which is
not defined in pages.
```

Scope of the modal arm is the maintainer's ruling on #6739 (2026-08-09): **a
`type: 'modal'` target names a PAGE, only** — so this arm mirrors the registered one
rather than also accepting an object name, closing the d/i split exactly as #6889 closed
the inline one. `objectName` is deliberately left unchecked at this position: the key does
exist on this shape, but what it should mean on an action already embedded on an object —
a mere existence check, or a consistency check against the owning object's name — is an
open contract question filed separately rather than settled as a side effect of this walk.

**Acceptance-face narrowing.** A stack carrying a dangling embedded `modal`/`flow` target
now fails to build where it previously built clean. Census of the shipped corpus found
**zero** stacks affected: no object in the reference corpus hand-authors a `modal`- or
`flow`-typed action at this position, and the ordinary way `objects[].actions[]` gets
populated — the top-level → object merge — runs after validation and is unaffected. A
vacuity guard pins that merged shape so the census cannot go stale silently.
