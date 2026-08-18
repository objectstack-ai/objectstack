---
"@objectstack/spec": minor
---

Declare `viewMode` on `GanttConfigSchema` (the `gantt` view block): an optional enum of the gantt renderer's measured granularity vocabulary — `'day' | 'week' | 'month' | 'quarter' | 'year'`. The member list is measured from objectui `plugin-gantt` (`GanttView.tsx` `GanttViewMode` / `VIEW_MODES`), not invented. No spec-side default on purpose: the renderer resolves an omitted `viewMode` through its persisted-layout seeding before falling back to `'day'`, so a materialized default would read as an explicit author choice. Spec half of the objectui#5074 both-branches ruling (#9463); an out-of-vocabulary value is now refused at authoring instead of silently falling back.
