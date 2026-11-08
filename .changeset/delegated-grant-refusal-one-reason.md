---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a delegated refusal names one reason for a target user the caller cannot read

Clause-②: no — every write the delegated-administration gate refused it still refuses, and every write it admitted it still admits. No error code, class or status is added: the answer is the gate's existing scope violation.
Metadata-protocol: none

- **Rule.** A target user is inside a delegated business-unit subtree only through a business unit of that subtree. A delegated administrator's direct permission-set grant whose target user is outside the subtree is refused with one answer, whether or not the user exists or holds a business-unit membership: `403 DELEGATION_SCOPE_VIOLATION`, the same sentence ("target user … is outside the delegated subtree") and the same details. This holds for a new grant, a grant pointed at another user and a stored grant removed.
- **What a client sees.** A grant to a target user who holds no business-unit membership answers that scope violation, so a console shows its reason, as it does for every other target outside the subtree.
- **Unchanged.** A target user with a business unit inside the subtree is judged exactly as before.
