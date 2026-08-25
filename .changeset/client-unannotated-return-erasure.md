---
"@objectstack/client": minor
---

fix(client): bind the three verifiable methods of the unannotated return-type erasure population to their spec contracts (#11925)

**Return-type narrowing on a published SDK.** No runtime change — the value each
method resolves to is byte-identical before and after. Only the DECLARED type
moved, off `any`, which is precisely why a runtime test cannot observe it and
the pins for it are type-level.

`any` is assignable to everything and admits every property read, so for each
method below a consumer's code could stop compiling where it previously did
not: assigning the result to an unrelated annotation, reading a property the
bound type does not declare, or forwarding the value to a differently-typed
parameter.

## What changed, per family

**`client.packages.list` → `{ packages: InstalledPackage[]; total: number }`**
(was `{ packages: any[]; total: number }`). A consumer stops compiling if it
reads any key off a row that `InstalledPackage` does not declare. Note in
particular `source` (`'database' | 'registry' | 'both'`): the REST surface
spreads it onto each row, the dispatcher surface does not, and it is therefore
deliberately NOT declared — code reading `pkg.source` off this result compiles
today and will not after. `total` and the array envelope are unchanged.

**`client.packages.update` → `InstalledPackage`** (was `any`). This method
declared no envelope before, so nothing about the shape claim changed; a
consumer stops compiling if it reads an undeclared key off the returned row, or
assigns the result somewhere `InstalledPackage` does not fit.

**`ScopedProjectClient.packages.get` → `{ package: InstalledPackage }`** (was
`{ package: any }`). The `{ package }` envelope is unchanged; only the member
narrowed. A consumer stops compiling if it reads a key off `.package` that
`InstalledPackage` does not declare — again including `source`, which this
route does send and which stays undeclared for consistency with its already
bound `list` sibling.

## What deliberately did NOT change

The other 36 methods in the measured population keep their erased `any`, each
with a docblock stating why and pointing at the issue that carries it:
`meta.*` history/diagnostics (9) and eight `packages.*` routes have no published
response contract to bind to (#12038); `client.packages.get` has two mounted
surfaces that emit different envelopes and `install`/`enable`/`disable` declare
an envelope no surface emits (#12034); the 15 cloud `projects.*` methods call a
control plane that speaks snake_case while the `@objectstack/spec/cloud` rows are
camelCase, so binding to them would compile and be false (#12036).

No consumer loses anything by those staying `any` — they are exactly as
permissive as before.
