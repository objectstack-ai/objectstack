---
'@objectstack/objectql': patch
---

Clause-②: no

fix(objectql): the default-record-page and security-catalog refusals name an item made here, not shipped by a package, as "authored in this system"

- **What changed.** The holder text a `DEFAULT_RECORD_PAGE_CONFLICT` refusal prints for a page no package ships now reads `page "NAME", authored in this system`, and the holder text a `NAMESPACE_CONFLICT` refusal prints for the environment catalog reads `the environment catalog (an item authored in this system, not shipped by a package)`. Both said "authored in this environment". Inside the running system, user-facing copy names the system the user is in as "this system".
- **Unchanged.** Every error code, status and envelope field (`existing`, `incoming`, `existingHolder: { kind: 'environment' }`). "The environment catalog" is the documented name of that holder (ADR-0048), so it stays.
