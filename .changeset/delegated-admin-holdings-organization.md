---
'@objectstack/plugin-security': patch
---

The delegated-admin gate now counts a `sys_user_position` holding only where the runtime grants it. Self-delegation's "you currently hold this position" check (ADR-0091 D3 rule 4) no longer accepts a holding stamped for a different organization — a user can no longer self-delegate a position in an organization where they hold nothing just because they hold a same-named position elsewhere. Organization-less holdings still count, exactly as the runtime authz resolver grants them in every organization. The binding blast-radius check (ADR-0090 D12) likewise counts only the assignments the bound position row reaches — its own organization's plus organization-less ones — so another organization's same-named assignments no longer refuse a binding as outside the subtree or push it over the assignment cap. An organization-less (`single` posture) caller is unchanged.
