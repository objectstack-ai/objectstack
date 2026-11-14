---
"@objectstack/rest": patch
---

`POST /analytics/dataset/query` (and each query of `POST /analytics/dataset/query/batch`), under the analytics service's plugin-wired admission: a holder whose own address is contended by a stored row two or more holders of the name could own (ADR-0150 D4) is now judged on its own dataset instead of being left undetermined. Such a row makes each of those holders' own exact read refuse the name, naming them; the door now reads each such holder's own dataset as the list scoped to it serves it (that list withholds the row), asks admission about it, names it in the `409` when the caller may query it, and never runs it.

Clause-②: yes (widening)
Metadata-protocol: none

Moved answers, when the name is refused (bare name, `?callerPackage=`, or `?package=` naming a contended holder) and its holders' own addresses are contended:

- admitted to two or more holders: `503 SERVICE_UNAVAILABLE` → `409 RESOURCE_CONFLICT` naming those holders;
- admitted to exactly one contended holder: `503` → `409` naming that holder only, nothing run;
- admitted to none: `503` → `404 NOT_FOUND`, byte-equal to the answer for a name nothing holds;
- admitted to exactly one holder whose address is not contended, every other holder contended and not admitted: `503` → `200`, that holder's dataset runs (the rule for one admitted holder of an ambiguity, now reached).

The stored row this arises from today is an App's customization-pair row that names none of the App's modules. A row bound to no package is declined at each holder's address for a dataset, so it moves no answer, before or after.

Also: the `503` the door still answers where a holder cannot be judged carries, on its logged cause, which holders could not be judged and why; its body is unchanged and names no holder. Unchanged: every refusal of a holder's own read in any other shape stays undetermined; a name the read resolves keeps its answer. No fix needed from callers.
