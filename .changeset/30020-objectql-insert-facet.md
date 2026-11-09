---
'@objectstack/objectql': patch
---

refactor(objectql): the `ObjectQL#insert` body moves into the insert facet

Clause-②: no
Metadata-protocol: none

- The body of `insert` moves out of `engine.ts` into `engine-insert.ts`, beside `insertMany`. The method stays on the class as a one-call stub with its signature and its docblock. Where the body handed the engine itself on, it reads the same engine through the host's `facade` entry, and its one static read (the home-amount organization lookup) goes through the forwarder the other facets already use.
- No behaviour changes and nothing to do on upgrade: the same statements run in the same order. The built declaration files are unchanged; the source maps move.
