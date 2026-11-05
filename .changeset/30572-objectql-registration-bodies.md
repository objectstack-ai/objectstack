---
'@objectstack/objectql': patch
---

refactor(objectql): the bodies of `registerApp`, `registerDriver` and `registerHook` move into their facets

Clause-②: no
Metadata-protocol: none

- The bodies of `ObjectQL#registerApp` and `ObjectQL#registerDriver` move out of `engine.ts` into `engine-registration.ts`, and the body of `ObjectQL#registerHook` into `engine-hooks-and-functions.ts`; the methods stay on the class as one-call stubs with their signatures and docblocks. The built declaration files are byte-equal before and after, and no behaviour changes; only the source maps move. Nothing to do on upgrade.
