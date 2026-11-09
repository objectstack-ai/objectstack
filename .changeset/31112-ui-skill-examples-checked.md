---
'@objectstack/skills': patch
---

docs(skills): more of objectstack-ui's self-contained examples are type-checked by `check:skill-examples`

Clause-②: no
Metadata-protocol: none

Ten more fenced TypeScript blocks in `skills/objectstack-ui` carry the opt-in check marker, so 25 of its 33 are now compiled against the spec: the new-tab `defineAction` in `rules/actions.md` and the `kind: 'html'` page in `rules/pages.md` gain their import; the styled pricing card and the doc navigation item in `rules/pages.md` are typed as `PageComponent` and `NavigationItem[]`; four widget examples in `rules/dashboards.md` are typed as `DashboardWidget` (or its `options`); and the kanban and gantt examples in `rules/list-views.md` are typed as `ListView`, all from `@objectstack/spec/ui`. No example was wrong. The rest stay unmarked: bare-key fragments, the blocks whose file had no token headroom left for a wrapper, and the `SKILL.md` subform example, whose fence is indented inside a list item where the gate does not read it. No rule's teaching changes.
