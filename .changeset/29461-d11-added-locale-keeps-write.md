---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform says the D11 close refuses a package-less write only where the row moves as a declared override, and an added email-template locale keeps that write

Clause-②: no
Metadata-protocol: none

- **Before.** The ADR-0146 customization paragraph said a pre-D11 unbound Setup row's package-less save, reset and rollback are refused once it is movable. That is false for a row of an email-template locale the base does not ship: `os migrate packageless-overlays` moves it as the pair's own member (`addedMember`, no `overrides`), and the close judges only the declared-override move, so that row's package-less write stays open before and after its move. The clause also left out publish, which the close refuses too.
- **Now.** The clause says the close covers a row movable as a declared override, lists save, publish, reset and rollback, and says an email-template row at a locale the base does not ship moves as the pair's own member and keeps that write. The file stays at its token ceiling: a duplicate "CLI Commands" pointer section is cut, its home the Part 3 pointer to `references/operations.md`. No rule is removed; no schema or behaviour changes.
