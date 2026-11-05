---
'@object-ui/app-shell': patch
---

feat(app-shell): Studio customizes an installed package's page into the base's customization package (#30063)

Clause-②: no
Metadata-protocol: none

On a read-only (installed or code-shipped) package, a page opened in the Interfaces pillar now offers Customize, the same button a dashboard, report or view shows. Before, Studio showed the page as read-only with no way to change it, although the server already serves a page override from the paired customization package (`<base>.custom`).

- Customize unlocks the page designer. Nothing is written until an edit is saved. The first saved edit copies the whole page into the pair, declaring `overrides: { package: <base>, basedOn: <base manifest version> }`. Later edits update that copy. The base package is never written.
- The edit is a draft in the pair's pending changes; once published, the running app serves the customized page at its usual address.
- The page's header carries the override mark, whose popover offers "Restore package original": it deletes the pair's draft and copy of the page after a confirmation, and the shipped page reads back.
- The Interfaces rail marks a customized page, "only customizations" counts and lists it, and the All metadata directory's page tile counts it.

A customized page is a whole copy: a change the vendor ships to that page in a later version does not appear until the customization is restored and redone. A writable package's page editing is unchanged. No spec, server or metadata-type change.
