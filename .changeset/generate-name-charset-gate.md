---
"@objectstack/cli": minor
---

feat(cli)!: `os generate` refuses a metadata name outside the charset `packages/spec` declares for an object `name`, before it derives anything from it (#16726)

Maintainer ruling, decision batch #82 (2026-09-08), option A — **a gate, not a sanitiser**. `os generate <type> <name>` used to accept any name at all; since #16724 it has refused names whose emitted TypeScript does not parse. It now also refuses, ahead of that check and ahead of every derivation, any name the object-`name` declaration in `@objectstack/spec` rejects. The refusal names the value and quotes the schema's own rule, and writes nothing.

⛔ Nothing is rewritten. The rejected alternative was to derive a legal identifier the way `os create` does, which decouples the name the author wrote from the name that gets emitted with nothing announcing it — the failure mode that multiplies silently when metadata is written in bulk. So the name you author and the name that lands in the file are always the same string.

**What this narrows:** kebab-case (`order-line`), uppercase (`Order`), dotted (`foo.bar`) and digit-initial (`2fast`) names were accepted before and are refused now — `order-line` used to generate `order_line.object.ts` binding `orderLine`. Write the snake_case name directly (`os g object order_line`). ⛔ No new charset was minted and no flag bypasses the gate; #16724's parse check is unchanged and stays as the backstop behind it (`class` passes the charset and is still refused for `object`, because `const class:` is not a declaration).
