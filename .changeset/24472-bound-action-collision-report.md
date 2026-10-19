---
'@objectstack/objectql': patch
---

fix(objectql): a bound action named like an action its target object already lists, with a different declaration, is reported at boot naming both packages; `registerAction` reports replacing another owner's handler

Clause-②: no (a warning only: no accept set narrows, no door answer moves, and no published surface gains a key; owes the seat's review of record before the queue)

- **The listing.** A top-level action bound by `objectName` to an object that already lists an action of the same name is still not attached: the object keeps serving its own declaration, as the action router does. When the two declarations differ, the boot now warns once per pair, at `kernel:ready`, naming the object, the action, the package whose declaration is served and the package whose declaration is not listed. Two packages binding different declarations of one name to a third package's object are reported the same way (the first one attached is served).
- **Not a collision.** One declaration carried twice is compared without its provenance stamps (`_packageId`, `_provenance`, the `_lock` envelope, `protection`) and without `objectName`, and is not reported: a same-stack bound action merged onto its object, or the same declaration shipped by two packages.
- **Later artifacts.** An artifact registered after the boot (a marketplace install, a ledger rehydrate) is judged once it has registered, for the pairs naming one of its packages; a pair the boot already reported is not reported again.
- **The handler.** `ObjectQL.registerAction` keys handlers by `OBJECT:ACTION`. A registration under a key another owner holds still replaces it (the last registration runs), and now warns, naming both owners: the action door runs the new owner's handler whichever declaration the object lists, and withdrawing that owner leaves the action with no handler. The same owner re-registering is silent, and so is the authored-action resync, which tears its set down first. A registration with no package is its own owner.
- **Unchanged.** Nothing is refused and no boot fails on it; the served `actions`, the router's precedence and which handler runs are as before. Measured on stock CRM, showcase and todo boots: no new warning.
- **Fix.** Rename one of the two actions, or drop the duplicate declaration.
