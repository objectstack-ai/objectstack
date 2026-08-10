---
"@objectstack/spec": minor
---

fix(spec): `defineStack`'s action cross-reference walk now reaches INLINE page-element actions (#6889)

`validateCrossReferences` iterated `config.actions` — the registered action list — only.
An action authored **inline** on a page element (`element:button` → `properties.action`,
an `InlineActionSchema`) never enters that list, so no cross-reference check ever visited
one. The card's five-stack probe, re-measured on `main` before this change:

```
A registered modal -> object  :  REJECTED
B registered modal -> page    :  ACCEPTED
C registered modal -> nothing :  REJECTED
D inline     modal -> object  :  ACCEPTED   <- same target, opposite verdict
E inline     modal -> nothing :  ACCEPTED   <- dangling, builds clean
```

Row E is the defect on its own terms: a `target` naming neither a page nor an object nor
anything else built clean, shipped, and failed only when a user clicked — a
silent-until-clicked dead button, exactly the class row C exists to prevent. Inline is
also the shape AI authoring emits most readily (a button with its behaviour written right
there, no registry entry), so it was the one surface that most needed authoring-time
rejection and the one surface the walk did not visit. "Declared = enforced" held for
registered actions and not for inline ones.

**Now**: page `regions[].components[]`, `slots.*`, and nested container children are
walked, and every inline action found is subjected to the **same** two target checks as a
registered one — same rule, same message tail, same size gates. The `flow` arm rides the
same traversal, so an inline flow action naming no declared flow is rejected too.

Messages keep the registered wording and change only the subject, because an inline action
is located by page + path rather than by a registry entry and its `name` is optional:

```
Inline action 'new_task' on page 'home' (regions.0.components.2) references page
'nowhere' (via modal target) which is not defined in pages.
```

Scope of the modal arm is the maintainer's ruling on #6739 (2026-08-09): **a
`type: 'modal'` target names a PAGE, only** — so the inline arm mirrors the registered one
rather than also accepting an object name. `objectName` has no inline counterpart to
check: `InlineActionSchema` does not pick that key.

**Acceptance-face narrowing.** A stack carrying a dangling inline `modal`/`flow` target
now fails to build where it previously built clean. Census of the shipped corpus found
**zero** stacks affected: the one inline action in the reference corpus
(`examples/app-showcase`'s home CTA) is `type: 'form'` since #6739, and cloud's five
tenant-page buttons are all `type: 'url'`. Neither type is cross-referenced.
