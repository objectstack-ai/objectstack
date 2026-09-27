---
"@objectstack/spec": patch
---

`src/migrations/entries/README.md` — the ADR-0087 entry authoring rules now record that an entry's prose is scanned as source **twice**, and that the rule is never to spell a shape a live textual ratchet matches (#15130).

This file ships inside the package (`files[]` carries `README.md`, which matches at every depth — measured with `npm pack --dry-run`: 277 files, this one among them), so the rules an entry author reads are these.

- **The mechanism is the counter-intuitive part.** Every string an entry declares — `surface`, `replacement`, `reason`, `acceptanceCriteria` — is concatenated verbatim into the generated `src/migrations/registry.ts`, which is ordinary `.ts`. A repo-wide textual scan therefore reads the same sentence once in the entry file and once in the registry. The tree's one code/prose separator masks **comments** and leaves **string literals** intact by design, so a quoted example is code to every scan built on it, and prose in this package can turn **another package's** test red.
- **The rule is the broad one, and the parenthesis is its instance.** A rule worded as "quote a retired call site without its parentheses" would make counter-examples of entries that spell a parenthesised call and are green — they go unmatched only because no live ratchet enumerates *those* methods, which is a fact about today's ratchets rather than a licence. What an author controls is not spelling a shape some ratchet matches; the guidance is to name the surface rather than spell a call of it.

No schema, no export and no authorable key moves; the three existing rules in that section are unchanged and no entry was edited.
