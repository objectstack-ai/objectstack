---
'@objectstack/plugin-security': patch
---

Every built-in permission set says who holds it, in English, Chinese, Japanese and Spanish

Clause-②: no
Metadata-protocol: none

Setup → Permission Sets lists the platform's own permission sets beside every app's. Five of them (*Administrator — Full Access*, *Organization Administrator*, *Member — Standard Access*, *Viewer — Read-Only* and *External Member — Own Records*) had no description, and the no-bypass organization administrator set and the three MCP agent sets had descriptions written for platform engineers. An administrator picking a set for a new user could not tell an administrator set from a member set.

Each built-in set now has one plain sentence saying who holds it and what it opens or withholds. For example, *Organization Administrator* reads "Owners and admins of an organization: full control of its records and members in Setup, but no app authoring or platform-wide settings." The sentences are translated into zh-CN, ja-JP and es-ES through the permission-set group of the translation bundle (`permissions.<name>.description`), so the page shows them in the user's language. The engineering detail that used to be in the no-bypass and MCP descriptions is now in code comments.

No set's grants, name or label changed. This changes only the text shown about each set, not its permissions.
