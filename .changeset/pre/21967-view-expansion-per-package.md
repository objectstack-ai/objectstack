---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): another package's withdrawal of a form holds at the anonymous form endpoints, whatever packages' copies of a view container are saved

Clause-②: no

- **What was wrong.** Where packages ship the same view container, the view list (`getMetaItems` for `view`) served one item for each name a saved environment-wide copy of that container expands: the copy's own expansion. Every other package's item of that name, shipped or saved, was left out. The anonymous form endpoints judge a withdrawal against the environment-wide view list, so they could miss another package's withdrawal of such a form.
- **What it does now.** The view list serves each package its own item of such a name:
  - a package's saved copy of the container serves that package's item of each name it expands;
  - a package-less saved copy stands in for every package that has no copy of its own (ADR-0048);
  - any other package keeps its own item.

  So another package's withdrawal of a form holds at the anonymous form endpoints, whatever packages' copies of the container are saved. The organization-scoped save check reads the same list, so it judges each package's item too.
- **A stored view row of exactly such a name** keeps its own package's slot only. A package-less row still serves every package's slot. Before, any package's row of the name kept every package's copy expansion of it out of the list.
- **The by-name read agrees.** `getMetaItem` naming a package serves the item that package's slot in the list serves. Where no copy belongs to that package, a package-less copy now stands in for it. A list scoped to a package (`GET /api/v1/meta/view?package=`) serves the same item in each slot the package lists. A package-less copy adds no item to that list.
- **What does not change.** Within one package, a later expansion of a name still replaces an earlier one, and the save door's view container collision check is unchanged. A by-name read that names no package answers as before. No key, export, status or error code changes.
