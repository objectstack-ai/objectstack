---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

fix(lint)!: publish-time checks for views, dashboards and the app shell that save and do not work

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered publish-refuses-views-and-dashboards-that-save-and-do-not-work -->

**BREAKING** for a list view filter keyed on a `formula` field: it was accepted before and is refused now, with the fix named in the finding. The schema is unchanged and stored metadata is not rewritten or refused at boot; the refusal comes at the next publish, and from `os validate` / `lint` / `compile` / `build`.

- `list-view-filter-field-virtual` (error): a list view's own `filter`, or a `userFilters.tabs[]` preset, keyed on a field computed on read (`formula`). The engine refuses every query filtered on such a field (`400 INVALID_FIELD`), so the view opens on that error every time. Refused at the runtime publish door on a `view` write and on an `object` write through the object's own `listViews`. A dotted key whose head is a formula stays `list-view-field-dotted`; the filter bar's field list (`userFilters.fields`) is not judged.
- `dashboard-without-widgets` (warning, every door): a dashboard with `widgets: []`, which opens on its header over an empty canvas. Advisory because the shape breaks no request and the platform's own create steps (Studio, the spec's create seed, `os generate dashboard`) write it and fill it afterwards.
- `list-view-kanban-group-field-uncategorical` (warning): a `kanban` board grouped by a field with no fixed set of lanes. A text, number or date field gets one lane per distinct value on the loaded cards and no lane for a value no card holds; a multi-valued field puts a card holding several values in one lane named by all of them. A `select` / `radio`, a boolean and a single-valued reference are silent. Runs on the runtime `view` and `object` doors.
- `app-navigation-empty` (warning): an app with no entry in `navigation` nor in any `areas[].navigation` (a separator or an empty group counts as nothing), and no navigation the stack contributes into it. It opens on the "no access" empty state for every member. Runs on the runtime `app` door.
- `object-unreachable-from-navigation` and `object-without-view` (warnings, `os validate` / `lint` / `build` only): an object no navigation entry opens (not judged: a `master_detail` child, an object another object names in `relatedLists`, an object a page names when navigation opens that page, an API-disabled object, and a stack with no app), and an object navigation opens as a list that declares no `listViews` entry and no bound `views` item, which then opens on the console's own "All records" tab. Fix: `listViews: { all: { type: 'grid', columns: [...] } }` on the object, or a `views` entry bound to it.

## FROM → TO

- `filter: [{ field: 'is_overdue', operator: 'equals', value: true }]` where `is_overdue` is a `formula` → `filter: [{ field: 'due_date', operator: 'lt', value: '{today}' }]` (the stored field the formula reads), or a stored field written when its sources change.

`@objectstack/lint` exports six rule id constants (`LIST_VIEW_FILTER_FIELD_VIRTUAL`, `LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL`, `DASHBOARD_WITHOUT_WIDGETS`, `APP_NAVIGATION_EMPTY`, `OBJECT_UNREACHABLE_FROM_NAVIGATION`, `OBJECT_WITHOUT_VIEW`) so `os explain` carries an entry for each; the two new rule functions are not exported. `@objectstack/spec` adds only the upgrade-guide entry `publish-refuses-views-and-dashboards-that-save-and-do-not-work`.
