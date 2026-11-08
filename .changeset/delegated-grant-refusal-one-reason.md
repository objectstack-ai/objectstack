---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a delegated refusal names one reason for a target user the caller cannot read

Clause-②: no — no accept set changes at the write door: every write refused before is still refused, and every write admitted is still admitted. No error code, class or status is added: the answer is the gate's existing scope violation.
Metadata-protocol: none

- **Rule.** A target user is inside a delegated business-unit subtree only through a business unit of that subtree. A delegated administrator's direct permission-set grant whose target user is outside the subtree is refused with one answer, whether or not the user exists or holds a business-unit membership: `403 DELEGATION_SCOPE_VIOLATION`, the same sentence ("target user … is outside the delegated subtree") and the same details.
- **A target the caller cannot read.** A target user the grant names (a new grant, or a stored grant pointed at another user) is first asked of the caller's own read door, the question the engine's reference check asks of that user. A user the caller cannot read is answered as a user that does not exist, so it is outside the subtree and gets the same answer.
- **What a client sees.** A grant to a target user who holds no business-unit membership, or whom the caller cannot read, answers that scope violation, so a console shows its reason, as it does for every other target outside the subtree.
- **Unchanged.** A target user the caller reads, with a business unit inside the subtree, is admitted exactly as before.
