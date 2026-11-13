---
'@objectstack/objectql': minor
'@objectstack/spec': patch
---

fix(objectql)!: a running install or reload is asked the record-currency follow door once, at the end of its registration run

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered record-currency-follow-pair-refused-on-install-and-reload -->

**BREAKING** accept-set narrowing at the engine's `manifest` service (`@objectstack/objectql`): a code package or release artifact installed, upgraded or reloaded on a running server.

The record-currency follow door (ADR-0144 D2 and D6, amended) refuses two pairs: a record-mode amount whose `currencyField` path `MASTER_DETAIL.CODE` names no field of the parent, or a field that holds no ISO 4217 code; and a `summary` declaring `currencyMode: 'record'` over a child amount that follows no record's currency. `defineStack`, a single save, a publish and the batch writers already refuse them. A package registered on a running server was never asked: the pair registered and every write of the amount was then refused or mislabelled.

The registry now asks the door once, at the end of the outermost registration run, of every object layer the run registered: each package's `objects` and `objectExtensions`, its nested plugins' objects, and the artifact's top-level objects.

- **Was:** installed, upgraded or reloaded, the pair registered. **Now:** refused `INVALID_METADATA` / 422 in `defineStack`'s words, and the whole run is put back. `POST /api/v1/marketplace/install-local` answers `422 PLUGIN_REGISTER_FAILED` carrying the sentence, on the inline and the cloud-fetched branch, with nothing registered or ledgered; an upgrade leaves the installed version of every package serving.
- **A reload is one registration run.** Every package it re-registers and every object it ingests are judged together at its end. A refused pair refuses the whole reload: every package and object keeps the definition it served, and the log says `reload refused` with the pair. A package that cannot re-register for another reason is still skipped on its own while the others reload.
- **A pair another member completes passes.** The code field may come from the package's own `objectExtensions`, from a later package of the artifact, or from its top-level objects, and an upgrade or reload that moves the code field and the amount following it together is judged against the new parent.
- **A package that holds only one end is asked too.** The door reads the other end from the registry, so a package holding just the parent (or just the child) is refused over a child (or a parent) that another package or the environment holds, also when its own objects did not change. The refusal names the object and field that hold the declaration; when they are not the refused package's, the correction is their holder's (it upgrades its package or saves the environment's object), and the refused package is then installed again unchanged.
- **An owner under a tenant's overlay is not asked.** The overlay's body is what is served, so a package whose tenant added the followed code field still upgrades and reloads.

What an author does: name in the second segment of `currencyField` a field of the parent that declares `valueDomain: 'iso_4217_currency'`, or add that field in the same artifact; for a `record` roll-up, make the child amount follow the parent or drop `currencyMode: 'record'`. Then install or reload again.

What does not change: the cold boot registers every object it registered before (a package installed earlier with such a pair still loads at boot; its next upgrade or reload is refused until corrected, and so is that of a package holding only the other end), the stored-row hydration is not asked, a draft save is judged when it is published, and a pair whose other end is not registered is still no verdict.

`SchemaRegistry.restoringOnRefusal`: a nested call now puts back its own writes before it throws. Uncaught, the open run puts back the rest, so what is left is the same as before; a caller that catches it goes on with the open run as it stood before the nested one.
