---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a seed dataset whose `externalId` includes a reference the first load must leave empty now holds one row across loads, and the reference lands on that row once it resolves

Clause-②: no
Metadata-protocol: none

A dataset keyed on a composite `externalId` such as `['name', 'assignee']`, whose reference names a person who has not signed up yet, lands its row with that column empty. Every later load (each boot, each per-organization replay) inserted another copy: while the person stayed missing the record keyed empty, and once the person existed the record carried an id the stored row did not. Three loads left three rows.

Such a row now lands with an id derived from the key as the author wrote it (the person's natural key, never the id it resolves to), in its object and organization. A load whose natural key finds no row looks the row up by that id, and takes it only when its other key columns still match and its reference column is empty or already holds the resolved value. A row a person created never carries such an id, so it is never taken, and two records whose keys differ only in that reference stay two rows. Once the reference resolves it is written onto the row first landed: by the update under `mode: 'upsert'`, and under the default `mode: 'ignore'` by the pass-2 back-fill of that one column. Keys that resolve on the first load, and keys over plain fields, match exactly as before, with engine-minted ids.

An install that already holds such copies keeps them (remove the extras by hand); the next load lands at most one more row, the one the following loads find.
