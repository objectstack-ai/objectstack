---
'@objectstack/objectql': patch
---

refactor(objectql): the `ObjectQL#update` body moves into its own facet

Clause-②: no
Metadata-protocol: none

- The body of `update` moves out of `engine.ts` into a new facet module, `engine-update.ts`, the one the engine's section table already named for it. The method stays on the class as a one-call stub with its signature and its docblock. Where the body handed the engine itself on, it reads the same engine through the host's `facade` entry, and its one static read (the home-amount organization lookup) goes through the forwarder the other facets already use.
- No behaviour changes and nothing to do on upgrade: the same statements run in the same order. The built declaration files are unchanged; the source maps move.
