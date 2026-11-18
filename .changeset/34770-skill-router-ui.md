---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui's SKILL.md is a router: first checks, run-time traps, where each rule lives

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/SKILL.md` goes from 15.7 KB to 9.0 KB and now holds three things. No rule's teaching changes; text moved, and the page says where it went.

- **First checks.** The installed `@objectstack/spec` version against the skill's `compatibility` line; the object's declaration and the project's own view, app, action and dataset files; the type's contract (`references/_index.md` points at the Zod source in `node_modules/@objectstack/spec/src/`, which decides what to write; a running environment serves the parsed shape as JSON Schema at `GET /api/v1/meta/types`, where a defaulted key reads as required); `os validate` before reporting done.
- **Seven traps that parse and then fail at run time.** A long form stays `simple`; a record with its line items is `inlineEdit` on the child's `master_detail` field (and `enable.apiMethods` must list `'bulk'`); a persisted chart binds a declared dataset; a filter token is presentation scope, not security; the object declares its record page. Two keep their own headings: `List Views` (keep the view kind the request names, with the nine kinds) and `Actions` (an operation is an `action` whose body calls the API).
- **Where to go.** One table from the task to the file to open: list views, form views, navigation, record page, actions, dashboards and reports, pages and docs, and the React-tier block contract.

The Navigation Item Types, Action Types and Report Types tables stay in `SKILL.md`, with the item and action keys behind their homes.

Where the rest moved, each under its old heading text:

- `rules/list-views.md` now carries **Form Views** (the three types, the long-form paragraph, the public form), **Master-Detail Forms (parent + child line items)** and **Field Conditional Rules in Forms**, plus the column-count pitfall under Column Features.
- `rules/navigation.md` opens with `App.create`, the one-App-per-package rule, each navigation item type's keys (`label` and `icon` on every type but `separator`), `requiresObject` / `requiresService` and the `AppContextSelector` note.
- `rules/actions.md` opens with what an action is, where it is registered, and why a record button needs a placement and a `js` body with `api.write`; a bare field ref in `visible` or `disabled` fails `os validate`, and a parameterized bulk mutation is `script`.
- `rules/dashboards.md` says an omitted widget `layout` auto-flows, `position` is not a widget key, and a widget binding that resolves to nothing declared fails `os validate`.
- `rules/pages.md` points at objectstack-query `rules/filters.md` for relative-date placeholders.

A reader who linked `SKILL.md#date-macros--filter-placeholders`, `#master-detail-forms-parent--child-line-items`, `#form-views`, `#common-pitfalls` or `#verify-your-work` finds those headings gone from `SKILL.md`: the first is trap 4 and objectstack-query `rules/filters.md`; the second and third are in `rules/list-views.md`; `#common-pitfalls` is in `rules/list-views.md` (Column Features) and `rules/dashboards.md`; `#verify-your-work` is first check 4, with what the gate catches in `rules/actions.md` and `rules/dashboards.md`.
