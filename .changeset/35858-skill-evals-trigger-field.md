---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

skill-evals: a trigger turn installs the round's selection of bundles, not its own bundle alone

A `should_trigger` turn's project now holds every bundle of the round's selection (the `--skills` bundles, or every bundle), so a skill description competes with its neighbours' as it does in a real project. A should-load case passes only when its own bundle loads. Each record lists `installed` and `trigger.othersLoaded`, and the trigger table names the other bundles each case loaded. A turn whose init line misses an installed bundle is `invalid`. `--trigger-field own` installs the case's bundle alone, as rounds recorded before did. `round.json` records `triggerField`, the summary header names it, and `--regrade` keeps it. Under `--triggers-only`, a `--skills` bundle with no trigger case is installed as a competitor instead of being refused, as long as another named bundle has a trigger case.
