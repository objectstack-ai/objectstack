---
"@objectstack/objectql": patch
---

fix(objectql): single-quote the shadowed package id in the `[Registry] Collision` warning (#12609)

`patch`: a shipped operator-facing log message changes its punctuation, and
nothing in this repo parses the message beyond substring (`toContain`) test
assertions — no regex or char-level match on the quote character was found
(searched non-test `.ts`/`.tsx`/`.js` across the repo, and `content/`/`docs/`,
for the message text; the two other hits are prose references to the warning
by name, not parsers of its text). No public export, type, or behavior
changes.

## What changed

`SchemaRegistry.registerItem`'s cold-boot-order `[Registry] Collision`
warning (`packages/objectql/src/registry.ts`) double-quoted the shadowed
package id — `` `... is shipped by package "${shadowed._packageId}" ...` `` —
against this package's own convention: measured over non-test `.ts` under
`packages/objectql/src`, quoted identifiers in operator prose are
single-quoted 174 times against 37 double-quoted, and this line was one of
the 37. #12563 already settled the same ADR-0005 shadowing fact on the
automation side (`service-automation`) with single quotes
(`package 'crm'`), so an operator whose boot hits both packages' collision
warnings previously read one story in two spellings; this line now matches.

Byte-identical otherwise. Only the quote character around the interpolated
package id moved.

## Scope

One message, one site
(`packages/objectql/src/registry.ts`'s `is shipped by package` warning —
the guard that fires in the common cold-boot order, package registers
first). A sibling `[Registry] Collision` warning in the same file
(`ships from package`, the late-registration-order guard) also
double-quotes its package id and is the same defect class, but is a
different message and a different site — out of scope here, filed
separately rather than swept in.

## Test

No existing pin held this message's literal quote character (`toContain(PKG)`
assertions in `registry-collision-order.test.ts` matched either spelling); one
is added — asserting the corrected spelling present **and** the pre-fix
spelling absent, so it is red in both directions, not just green on the fix.

<!-- adr-0087: not-required (no-migration-prescription) Log-text punctuation only; no authorable key, schema, or stored shape changed, so there is nothing for a migration to rewrite. -->
