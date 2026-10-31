---
'@objectstack/objectql': patch
---

fix(objectql)!: a tenant's reworded copy of a packaged validation rule is one rule with the package's, run once with the tenant's sentence: the registry fold merges validation rules by name (#27949)

Clause-②: no (narrowing) — a tenant overlay's same-named copy of a packaged or extension-contributed rule no longer runs its own condition: the package's rule runs, with the copy's `message` and `active`. A write the copy's condition alone refused, or that only the package's rule refuses, is judged by the package's rule. Rules of different names are unchanged.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row needs rewriting: the fold reads a stored overlay row as it is, taking a copied rule's message and active from it and the rest from the package. Nothing is tombstoned, and an author has no code to change. -->

**BREAKING** for a tenant overlay that copies a packaged rule (`@objectstack/objectql`, served by every object read and the write door through the registry fold). ADR-0029 D9.2a gains a dated note: "validations stay additive" means rules of different names add; a same-named rule merges by name, with the condition owned by the package.

- **Before.** The fold concatenated `validations`. A Studio GET, edit and PUT of an object stores a copy of every rule the read served, so a tenant who reworded an extension's rule held a copy beside the extension's original: both ran, and a refused write reported the rule twice, once in each sentence. A copy of the owner's rule ran as stored, so a later package fix to that rule never reached the tenant.
- **Now.** A rule's identity within an object is its `name`. Two rules of one name are one rule. A tenant overlay's copy of a rule a code layer ships (the owner or an extension) runs as the package declares it, with the copy's `message` and `active`. `active: false` switches the rule off. A refused write reports it once, in the tenant's sentence, and a package fix to the rule reaches the tenant.
- **A copy that changes more than `message` and `active`** (its `type`, its condition, or any other key the package owns) does not run its own version. The package's rule runs, and the registry names the copy once at `error` (`validation_rule_copy_changed`), with the prescription: to change the condition, add a rule under a new name, or change it in the package. Loading a stored copy only reports it and never fails the boot or an upgrade. `SchemaRegistry.tenantRuleCopyRefusal(name, body)` returns that refusal (`ValidationRuleCopyRefusedError`, `INVALID_METADATA`, 422) for a body before it is stored; refusing such a save at the metadata save door is a follow-up change.
- **Unchanged.** A rule of a new name, the tenant's or an extension's, is added. A rule the overlay leaves out stays out. Between two code layers a later layer's same-named rule replaces the earlier one, as a field does. `getPackagedObjectBase` serves the packaged rules merged by name the same way.
- **Who sees it.** A tenant whose overlay rewords or switches off a packaged rule: the rule now runs once. A tenant whose overlay changed a packaged rule's condition: the package's condition runs instead, and the boot log names the rule. To keep a different condition, add it as a rule under a new name.
