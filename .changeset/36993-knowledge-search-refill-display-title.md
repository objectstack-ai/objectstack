---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): search refills after the permission filter, and a hit's title is the object's display field

Clause-②: no
Metadata-protocol: none

- **Search refills after the permission filter.** The permission re-check runs after ranking, so a caller who may read few of the matching rows used to get a short or empty answer. For a caller who is not the system identity, each `object` source is now asked for `topK × 5` hits; when the hits that survive the re-check name fewer than `topK` records (several passages of one record count once), each `object` source that answered as many as it was asked is asked once more, for `topK × 20` (the cap). At most two rounds; an adapter that answers fewer than it was asked is not asked again. A `file` / `http` source, and every source for the system identity, is asked for `topK` once. The answer is still at most `topK` hits; how many the re-check removed is logged at `debug`, never returned.
- **A hit's title is the object's display field** (ADR-0161 K5; ADR-0079 `resolveDisplayField`: `nameField`, else the derived title field), not a field that happens to be named `title`. A credential-class or `internal` display field, an empty value, or an object with no display field gives no title; a source over an object with no registered definition still reads `title`. The source admission's field gate asks about the same field: a source whose object's display field the caller may not query is not searched for that caller at all. A declared field named `title` still gates the source too, because documents indexed before this change carry its value until a complete reindex writes them again.
- The title enters `docHash`, so the next complete reindex rewrites the documents whose title changed.
