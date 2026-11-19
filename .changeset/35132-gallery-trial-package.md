---
'@objectstack/scenarios': patch
---

feat(scenarios): the gallery export writes each app as a package a customer can install and try (listing text, business-function facet, sample data), and the gallery check refuses an app with no sample data

Clause-②: yes
Metadata-protocol: none

The exporter now adds three things to each app's `source/`. It adds them after the run is scored, so the AI's build is never graded on them, and it never writes them into the run's own project.

- `objectstack.manifest.json` gets the card's listing text and facet. `displayName` and `description` are the card's English title and one-sentence requirement. The Chinese pair goes under `translations.zh`. `businessFunctions` is the card's own list, primary first. The build's other keys are kept.
- `src/sample-data.json` holds the card's seed rows as stack `data:` datasets: one per object, named with the app's namespace, keyed on the card's row id (`externalId: 'id'`). Lookup values name row ids of the same load. A user-handle field (`run.userHandleFields`) is left out of every row, because its value names a user of the run's own environment, and the app README says which field was left out.
- `objectstack.config.ts` gets one import line and `data: gallerySampleData` as the first property of its default-exported `defineStack({ … })` literal. Every other byte stays as the AI wrote it. The export is refused, with the reason, in four cases: the default export is not such a literal, the literal already declares `data:` or spreads a value, a seeded object is missing from the build, or the build already wrote `src/sample-data.json`.

Measured on `travel_expense`: the blank scaffold's `objectstack.config.ts`, with the recorded build's objects and the 757 seed rows added this way, passes `objectstack validate`. A dataset naming an object the build lacks is refused there ("Seed data references object … which is not defined in objects"), which shows the validator reads the imported file.

`export-gallery --check` has a new finding, `app-sample-data`. It reports an app whose `source/` has no `src/sample-data.json`, a file that is not a non-empty list of datasets the spec's `SeedSchema` accepts (each with at least one record), or a `source/objectstack.config.ts` that does not import it. A gallery tree written by an earlier exporter has no sample-data file, so the check reports each of its apps until the next refresh exports them again. The check writes nothing and deletes no app.

`installModes` and `solutionType` are not written yet: `installModes: ['unmanaged']` makes `defineStack` refuse an app that carries code `plugins` or `capability` items, which an app on the standard scaffold does. `typescript` moves from a dev dependency to a dependency. The exporter loads it, with a dynamic import, only when it edits a config.
