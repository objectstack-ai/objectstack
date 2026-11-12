---
'@objectstack/metadata': patch
---

fix(metadata): a stored package-less row the boot pass files under the host's package is one holder of an action name, not two, when a read naming no package is judged over the loaders (ADR-0150 D4)

Clause-②: no — the fix removes a refusal ADR-0150 D4 already denies ("A package-less row that bears a package-held name is a customization, never a second item. … it never arms beside the item it shadows (E1) and never makes the name ambiguous."). On a host that declares its package, `MetadataManager.get('action', NAME)` and `getDiagnosed` of a name one package's stored row holds beside a package-less stored row saved last go from `409 RESOURCE_CONFLICT` naming that package, the host's package and the environment to the package-less row, the answer before the bare read was judged over the loaders; beside a package's row bound to an object and an object-less package-less row saved last, from `409` naming the package and the host's package to the environment's own item; beside two packages' rows, the `409` names the two packages and the environment and no longer the host's package.
Metadata-protocol: none — no key, value or metadata type an author writes changes; what moves is how many holders a read naming no package counts for one stored row.

On a host that declares its package (`MetadataPlugin`'s `packageId`), the boot priming pass stamps every item it registers that carries no package with the host's package, a package-less `sys_metadata` row included, so the registry holds that row in the host's slot. A read naming no package of an action name a package holds in memory is judged over the registry's slots and the loaders' stored slots together, and the loaders still store that row package-less: the one row was counted twice, once as the host's package and once as the environment, and the refusal named a holder that does not exist.

The judged view now files such a row (an item a stored-row loader, `datasource:`, handed out for no package, held in a package's registry slot, that a loader still stores) the way the store files a write that carries no package: in the slot of the name's one package holder, as its customization, or else in the name's bare slot, as the environment's own item. Its registry slot is not counted beside it.

| Rows of `helper` (host declaring another package) | FROM | TO |
|:--|:--|:--|
| one package's row, a package-less row saved last | `409` naming the package, the host's package and the environment | the package-less row |
| one package's row bound to an object, an object-less package-less row saved last | `409` naming the package and the host's package | the environment's own item |
| two packages' rows, a package-less row saved last | `409` naming the two packages, the host's package and the environment | `409` naming the two packages and the environment |

Unchanged: a host declaring no package or the holder's own package; the package's row saved last; every read that names a package; every other type stored per `(package, name)` (their bare read reads the registry alone, and answers the package-less row as before); a host's own item registered in memory, which is still a holder; and a removal naming no package, which judges the same view without this filing.

No first-party composition wires a `DatabaseLoader` under a host that declares its package with a package-less action row beside a package's, so no answer changes in this repository.
