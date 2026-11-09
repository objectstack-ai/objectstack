---
'@objectstack/objectql': patch
---

refactor(objectql): the `ObjectQL#delete` body moves into the delete-and-aggregate facet

Clause-②: no
Metadata-protocol: none

- The body of `delete` moves out of `engine.ts` into `engine-delete-and-aggregate.ts`, beside `aggregate`. The method stays on the class as a one-call stub with its signature and its docblock. Where the body handed the engine itself on (`ql: this` in the hook context), it reads the same engine through the host's `facade` entry, and its one static read (the reference probe batch size) goes through the forwarder the other facets already use.
- No behaviour changes and nothing to do on upgrade: the same statements run in the same order. The built declaration files are unchanged; the source maps move.
