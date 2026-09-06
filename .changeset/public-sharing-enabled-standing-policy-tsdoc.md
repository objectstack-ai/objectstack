---
"@objectstack/spec": patch
---

Document `publicSharing.enabled` as the standing policy it is, and name the switched-off block among `resolveToken`'s `null` causes.

The TSDoc above `publicSharing.enabled` read "when false, no share links can be issued for this object" — true, but only the mint half. Since the switch became a standing policy held at every redemption, a block that is off also stops every existing link on it from resolving: links minted while it was on, and links minted through the system-context / `permissive` mint bypass alike. Re-enabling the block serves them again; no row moves. The comment now says so, in the shape the sibling `eligibility` predicate's prose already uses.

`IShareLinkService.resolveToken` enumerated the causes of its undifferentiated `null` — unknown, revoked, expired, audience, password, record gone, ineligible — without the switched-off block, so an implementer reading the list to enumerate refusal causes got an incomplete set. The list now carries it, in the position the gates run; the contract's design notes gain a matching entry beside the eligibility one, and the `isSystem` mint bypass is marked as mint-only.

Documentation only: no schema, shape or behaviour change, and the `.describe()` string that feeds the generated reference is untouched. `@objectstack/spec` ships the corrected text in its published type declarations and, for `object.zod.ts`, in the source file it publishes directly.
