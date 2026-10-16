---
'@objectstack/platform-objects': minor
---

feat(platform-objects)!: Setup's organization, team, business-unit and user records carry no Discussion feed: `sys_organization`, `sys_team`, `sys_business_unit` and `sys_user` declare `enable.feeds: false`, so a comment create on one of their records answers `403 FEEDS_DISABLED`

Clause-②: no (narrowing: the comment create door refuses on four platform objects that accept it today)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is added, removed, renamed or re-shaped, and no stored row is rewritten or deleted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime write door: the existing `enable.feeds` gate now refuses a comment whose thread names one of four platform objects, and the remedy is in the request a caller sends to that door, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Setup's identity records are directory entries, not discussion surfaces. The four objects declared no `enable.feeds`, so they took the default (`true`), and the console drew "Discussion (0)" with a comment composer on every organization, team, business unit and user record.

What changes:

- **The record page.** The console reads the flag (`enable.feeds !== false`), so it no longer draws the Discussion feed or its composer on these four objects' records. The record's activity history is unchanged.
- **The data API.** A `sys_comment` create whose `thread_id` names one of these objects (`sys_user:USER_ID`, `sys_organization:ORG_ID`, `sys_team:TEAM_ID` or `sys_business_unit:UNIT_ID`) answers `403 FEEDS_DISABLED` and writes nothing, through REST, the SDK and every other caller of the data engine. An update that moves an existing comment into one of these threads is refused the same way.
- **Comments already stored** on these records are kept. They stay readable through the data API, and an edit that does not change `thread_id`, such as a body edit, still saves.

Unchanged: every other platform object and every application object keeps its own `enable.feeds` setting, and an object that declares none still accepts comments.

Remedy: stop creating comments on these four objects' records. A discussion about a user, a team or an organization belongs on a record of an object that keeps its feed on.
