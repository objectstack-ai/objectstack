---
'@objectstack/runtime': patch
---

feat(runtime): `@objectstack/runtime` exports the package disable door's dependent-rule verdict, `readPackageDisableDependents`, and its sentence, `formatPackageDisableDependents`, with the `DisableDependentRule` type

Clause-②: yes
Metadata-protocol: none

`readPackageDisableDependents(registry, packageId)` answers the validation rules a disable of the package would leave reading a field it adds through `objectExtensions`: each as `{ packageId, object, rule, fields }`, from any enabled package (declared dependent or not, an app's `.custom` pair included), ordered by package, object and rule. It reads the registry and writes nothing, and answers an empty list for a package that withholds nothing. `formatPackageDisableDependents(lead, dependents)` spells the refusal's message: `lead`, every rule as `package · object · rule (reads FIELD, …)`, then the remedy.

They are the same two functions `PATCH /packages/:id/disable` and `POST /packages` with `enableOnInstall: false` ask, now on the package entry, so a host door that takes a package out of service another way (a control plane's per-install disable, a soft-disable uninstall) asks the same scan before its write and answers the same `409 PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE` (the code is in the `@objectstack/spec` error-code ledger) instead of keeping a second copy. Nothing existing changes: every door answers exactly as before.
