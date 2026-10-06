---
'@objectstack/metadata-protocol': patch
---

The view list serves one item per package for a view name that several installed packages ship, whether or not a view row is stored

- Where two installed packages ship a view of the same name, the list read (`getMetaItems` for `view`) now serves each package's item of that name, as it already did while no view row was stored. Only a name that a stored view container's expansion writes is upserted by name.
- The environment-wide view list is the layer the anonymous form endpoints judge a withdrawal against. A package-less organization copy of the view, stored before one package withdrew the form, is now judged against every package's body of the name there, so it stays closed whichever package withdraws.
