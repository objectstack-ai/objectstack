---
'@objectstack/spec': patch
---

Notes in the `app` and `view` liveness ledgers that cited a tracker number which no longer resolves now either cite the commit that decided them or say the decision in words

Clause-②: no

Sixteen notes in the `app` and `view` ledgers cited a GitHub issue that no longer exists, so a
reader could not tell why a row carries its verdict. Each such note now either names the commit
that made the decision or, where the number alone carried the meaning, says what was decided.
The `liveness/` ledgers ship in this package's tarball, which is why this is a release note at
all. Note text only: no row's status, evidence, proof, producer or date changes, and no schema,
export or runtime behaviour changes.
