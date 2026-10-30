---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio's report and widget dataset pickers offer New dataset, which saves a draft dataset in the package and binds it (#27518)

Clause-②: no
Metadata-protocol: none

An author who had just built a package's objects could not report or chart on them from the Studio: the New report dialog's dataset picker and the dashboard widget inspector's listed only the datasets that already existed (in a fresh app, the platform's own), and nothing in the Studio made one.

- **New dataset.** Both pickers now carry a **New dataset** button. Its dialog asks for a name, the object the dataset reads (preselected when the package has exactly one), and optionally the fields to group by (select, radio, boolean, lookup and master-detail fields) and the number fields to total. It saves a `dataset` draft in the current package through the same draft door as every other Studio item; the dataset always counts its records (the spec's create seed), each picked group-by field becomes a dimension and each picked total a `sum` measure. The picker then reads its catalog again and selects the new dataset. A name any dataset already holds, published or draft, is refused and nothing is written.
- **The package's datasets first.** The Studio's pickers read the draft-overlaid dataset catalog, so a draft dataset is offered and its measures resolve before the package publishes, and they list the package's own datasets before the others.
- **The empty state names the way out.** While no dataset reads one of the package's objects, whatever else the catalog holds, the picker says so and points at New dataset. The New report dialog's old "There is no dataset to report on yet" line is replaced by that line and the button.
- **Unchanged.** Nothing is derived for the author (no implicit datasets). Setup's editors and the Create view dialog keep reading the published catalog and have no entry. The dataset written is an ordinary `dataset` document: Setup › Datasets edits it afterwards.
- **i18n.** The `studio` namespace gains `engine.studio.interfaces.newDataset.*` (en, zh) and drops `engine.studio.interfaces.create.noDatasets`.
