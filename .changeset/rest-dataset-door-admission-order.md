---
"@objectstack/rest": patch
---

`POST /analytics/dataset/query` (and each query of `POST /analytics/dataset/query/batch`) now judges, when the saved-dataset read refuses a name, which of the refused holders the caller is admitted to before it answers (ADR-0150 D3 after ADR-0149 D2, as the MCP tool `query_dataset` already does). Where the door judges, a holder the caller may not query is not a candidate and is not named, and a refusal from a holder's own read stays inside the judgement: it is never answered as it is.

Clause-②: yes (widening)
Metadata-protocol: none

Moved answers, for a caller admitted to fewer holders than the name has (bare name, `?callerPackage=`, and `?package=` naming a package that does not hold the name):

- admitted to none: `409 RESOURCE_CONFLICT` naming every holder → `404 NOT_FOUND`, byte-equal to the answer for a name nothing holds;
- two or more holders in contention and exactly one admitted: `409` → `200`, that holder's dataset runs;
- otherwise: `409` naming every holder → `409` naming only the admitted holders;
- a holder whose admission cannot be judged, its own read included, where it could change the answer: `409` naming every holder → `503 SERVICE_UNAVAILABLE`, nothing run, no holder named. This holds for every caller, one admitted to every holder included.

Moved for every caller: a holder whose saved dataset does not parse counts for no caller, as in `query_dataset`. With two holders in contention and only one of them parsing, a caller admitted to that one gets `200` and it runs, where the answer was `409` naming both.

Unchanged: a name the read resolves (one holder, the caller package's own or closure item, an exact `?package=` hit) keeps its answer, including `403` from the query's own read gates for a caller not admitted to it, and it never falls through to another package's dataset of the same name. Two refusals are not judged and still name every holder: one from a service whose admission is not the plugin-wired set, and one that names the environment or the platform as a candidate. No fix needed from callers.
