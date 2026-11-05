---
'@objectstack/objectql': patch
---

refactor(objectql): `ObjectRepository` and `ScopedContext` in `engine.ts` are facades over their own facet modules, moved by the `engine.ts` codemod's second pass; no behaviour or published declaration changes

Clause-②: no
Metadata-protocol: none

- 20 of the 24 methods of the two classes keep their signatures and public docblocks on the class and forward, in one call, to an unedited copy of their body in `engine-object-repository.ts` or `engine-scoped-context.ts`. Each instance gets one host, built on first use (`engine-scoped-hosts.ts`), so a spy or a subclass override on an instance is still the method a body reaches.
- Four `ScopedContext` methods keep their bodies on the class, each named in the facade gate's registry with the card that will move it: `transaction` and the symbol-keyed `SEED_USER_GRANTS` method hand the instance itself on; `derive` and the symbol-keyed `APP_AUTHORED_HOOK_API` method set a private flag on another instance.
- Nothing to do on upgrade: the exported names, the published `.d.ts` surface and what every method does are the same.
