---
"@objectstack/console": minor
---

chore(console): refresh vendored `@object-ui/console` SPA to objectui@e6fd254

Bumps the pinned `.objectui-sha` from `6d4cc09` to `e6fd254` (14 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

Notable upstream changes pulled in:

- feat: book metadata display UI + book-driven documentation portal (ADR-0046 §6)
- feat: render object fieldGroups as full-width, collapsible form sections
- feat: full object forms (incl. master-detail) inside screen-flow wizard steps
- feat: action progress state + Undo affordance, action/flow completion messaging
- feat: CEL on action buttons + i18n for sort/filter builders and view/manage-views menus
- fix: public share link URL + ShareDialog audiences; grouped-view pagination + shared scrollbar
- fix: docs ToC scrolls in JS so `<base href>` no longer bounces to home
