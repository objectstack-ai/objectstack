---
"@objectstack/spec": patch
---

docs(spec): state the retired `allowRestore` / `allowPurge` parse-time accept set exactly (#17425)

Documentation only — no schema, no key, no exported symbol and no accepted value moves. What changes is what the tombstone's own prose claims about itself, in the three places a consumer reads it: the `permission.zod.ts` docblocks (published in the tarball, both as `dist/*.d.ts` and as the `src/**/*.zod.ts` sources this package ships), and the two hand-written permission docs pages.

The prose said the retired bits are refused, and separately that "every other value" lands on the tombstone. Read together those two sentences describe a truthy/falsy split, and that is not what the schema does. Measured on this tree, `ObjectPermissionSchema` tolerates exactly ONE value: the boolean literal `false` the published 17.x toolchain materialized into every permission entry of every artifact it built, accepted as inert residue and silently stripped under the retired-defaulted-key class rule. Every other value of any type — including the string `"false"`, the number `0` and `null` — is refused exactly like `true`, with `code: 'invalid_type'`, `expected: 'never'` and the same guidance string, at the key's own path.

The consequence consumers were missing is now stated with it: a successfully parsed permission entry can carry neither key on any input that came from JSON, so a post-parse guard against either bit is dead code — presence, truthiness and `=== true` alike can never be true on validated data. A `false`-versus-other distinction is observable only to pre-parse tooling reading raw sources, where the retired default is inert legacy residue and any other value is a hard ADR-0049 violation.

One measured exception is documented and pinned, because it is the only post-parse observation that survives: an in-memory TypeScript input carrying an explicit `undefined` for either key parses and keeps the key as an own property whose value is `undefined`, so a presence check can be true there. JSON cannot spell it, and a serialize round-trip drops it again.

<!-- adr-0087: not-required (no-migration-prescription) nothing authorable changes shape: no spec key, no Zod schema and no exported symbol is added, removed, renamed or narrowed, and no accepted value moves in either direction, so `os migrate meta` has no edit to make and no ledger id to carry. The retirement this prose describes was registered by its own change; this one only describes it accurately. -->
