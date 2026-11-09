---
'@objectstack/objectql': patch
---

refactor(objectql): the eight `ObjectQL` methods that kept an inferred return type spell it, and five of them move into their facets

Clause-②: no
Metadata-protocol: none

- `registerApp`, `registerHook`, `registerDriver`, `init`, `triggerHooks`, `destroy`, `setDatasourceMapping` and `getStatus` now declare their return type, copied from the published declaration file it was inferred into. The bodies of `getStatus`, `triggerHooks`, `setDatasourceMapping`, `init` and `destroy` move out of `engine.ts` into their facet modules (the methods stay on the class as one-call stubs). The built declaration files are byte-equal before and after, and no behaviour changes; only the source maps move. Nothing to do on upgrade.
