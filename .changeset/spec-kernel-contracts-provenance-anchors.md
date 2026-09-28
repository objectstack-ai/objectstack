---
'@objectstack/spec': patch
---

Provenance comments in `kernel/` and `contracts/` were re-anchored

Comment and docblock lines under `src/kernel` and `src/contracts` cited tracker
numbers that no longer resolve on GitHub. Each one now cites the commit in this
repository's history that decided the matter, or the ADR that records it, and
says in its own words what was decided. Where nothing could be anchored, the
sentence keeps its reason and the number is gone. Comments only: no type, schema,
export or runtime behaviour changes.
