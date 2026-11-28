---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

fix(spec)!: a book audience names one gate, and a gated book claims its pages by name

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no `skills/` page teaches the book audience forms; `content/docs/ui/doc-pages.mdx` documents both refusals in this change

<!-- adr-0087: registered book-audience-two-gates-and-catch-all-claim-refused -->

**BREAKING** for two book shapes (ADR-0046 §6.7) that were accepted and meant less than they said. Stored books are not rewritten or refused at boot; the next save or publish of such a book is refused with the fix named.

- **`@objectstack/spec`.** `BookAudienceSchema` refuses an `audience` naming both `permissionSet` and `systemPermission`. The older `{ permissionSet }` arm is a plain object, so the pair used to parse as the set form with the capability stripped: the author believed the book was gated on a capability, and it was gated on one set. `defineStack`, `os validate` and the `/meta` save now refuse it, and the message says which key to keep. Only the second gate key is refused: every other shape that parsed before still parses the same way.
- **`@objectstack/lint`.** New error `book-gated-catch-all-include` (`validateBookAudienceClaims`): a book whose `audience` is `{ permissionSet }` or `{ systemPermission }` with a group claiming docs by `include: '*'`. A package scope leaves out only a doc stamped with another package, so a stored doc bound to no package is in every scope, and the catch-all claimed it too and hid it from every reader outside the audience. It runs on `os validate`, `os build` and `os lint`, and at the runtime publish gate on a book write (Studio, REST `/meta`, MCP).

## FROM → TO

- `audience: { permissionSet: 'crm_admin', systemPermission: 'setup.access' }` → `audience: { systemPermission: 'setup.access' }` (everyone holding the capability through any set) or `audience: { permissionSet: 'crm_admin' }` (the holders of that one set).
- `audience: { systemPermission: 'crm.runbook' }` with `groups: [{ key: 'all', label: 'All', include: '*' }]` → `include: 'crm_runbook_*'` (the package's doc namespace), a tag include `{ tag: 'runbook' }`, or pinned `pages`.
