---
'@objectstack/rest': patch
---

fix(rest)!: `POST /analytics/dataset/query` refuses an unknown key on its request body, and a body naming both `dataset` and `datasetName`, instead of answering 200 (#29156)

Clause-②: no (narrowing) — the dataset query door refuses two request bodies it served before: one carrying a key beside `selection` that the door does not read, and one naming both `dataset` and `datasetName`. Nothing is widened, and no published spec schema moves.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, spec schema, export or type changes: this is the REST door's own request body, which reads the same four keys as before. The refusal names each key it did not understand and where it belongs, so the caller's fix is in the answer and there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at `POST /analytics/dataset/query` (`@objectstack/rest`).

- **Before.** The door read `selection`, `previewDrafts`, `dataset` and `datasetName` off the body and ignored every other key. A `runtimeFilter` written beside `selection` instead of inside it answered 200 with the UNFILTERED aggregate, and `bogus: 1` beside `selection` answered 200 too. A body naming both `dataset` and `datasetName` ran the inline definition and dropped the name without a word.
- **Now.** Any other top-level key answers `400 VALIDATION_FAILED` naming it ("Unrecognized key(s) on this dataset query: …"), with one `details.fields[]` entry per key (`code: unknown_field`), and the query is not run. A misplaced selection member names its place: `runtimeFilter`, `filter`, `filters` and `where` say "did you mean `selection.runtimeFilter`?", and any other selection member (`dimensions`, `measures`, `order`, …) says "did you mean `selection.KEY`?". `dataset` beside `datasetName` answers `400 VALIDATION_FAILED` naming both.
- **Unchanged.** `{ datasetName, selection }`, `{ dataset, selection }` and `previewDrafts` are served as before, and the analytics service receives the same arguments. A `null` `dataset` beside a `datasetName` still runs the saved dataset. The refusals inside `selection` are unchanged.
- **Who sees it.** A caller that sends a key the door never read. `@objectstack/client`'s `analytics.queryDataset`, the Console's dashboards, reports and dataset preview, and `@objectstack/verify` send only the four keys above, and never both `dataset` and `datasetName`.

**The remedy.** Move a selection member inside `selection` (`{ datasetName, selection: { measures, runtimeFilter } }`), drop any other key, and send exactly one of `dataset` (an inline definition) or `datasetName` (a saved one).
