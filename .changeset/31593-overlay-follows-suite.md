---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a tenant's edit follows its item across the packages of one App

Clause-②: no — no accept set changes; the lookup scope widens only within one suite (triage 6724363147)
Metadata-protocol: none

When a later version of an App moves an item from one of its packages to another (an ADR-0130 D4 suite split such as a flat App becoming an App plus modules, or the rollback of one), the item's reads no longer drop the tenant's edit of it. Before, the edit was still stored and every read served the vendor's item: the reads looked for the edit under the package that ships the item now, and the edit names the package that shipped it at the time of the edit.

- **What follows.** The App pair's (`<app>.custom`) declared override whose `overrides.package` names a former owner of the item, and a row bound to the former owner itself (a Regime O save stored before ADR-0146 D11 closed saves naming the read-only base). Each is served at the package that ships the item now, by name (with and without `?package=`), in the list and as the layered read's `effective`.
- **Same App, read from the install record.** Two installed packages are of one App when `appOf` answers the same App for both over the registry's installed manifests. When the former owner is no longer installed (a rollback), the record is the row's binding to the App's pair, which the save door admits only for a package of that App. Never an id or name prefix.
- **What never follows.** A row bound to, or declaring, a package of another App; a row of another App's pair; a row whose former owner still ships the item (it stays that package's edit); an `object` (it takes no tenant overlay, `ITEM_LOCKED`); and, between two former owners' rows, neither.
- **Nothing is written.** The row keeps its binding and body, so a rollback needs no reverse step; the next save of the item writes the current owner's address, as every save does.
