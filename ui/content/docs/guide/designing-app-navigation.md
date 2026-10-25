---
title: "Designing App Navigation"
description: "How to choose between object navigation, named views, custom pages, and dashboards when composing an app"
---

# Designing App Navigation

When you compose an app, the same requirement can often be expressed three
ways: a plain object menu entry, an object entry pinned to a named view, or a
custom page that embeds views. They are **not** interchangeable — this guide
gives you the decision rules. (The canonical, agent-facing version lives in
`skills/objectui/guides/app-composition.md`; keep the two in sync.)

## The Three Ways to Reach a List

Say your app has a `project` object:

| You write | User lands on | You get for free |
|---|---|---|
| `{ "type": "object", "objectName": "project" }` | `/apps/my_app/project` — the object's **default view** | The full object shell: view switcher, object actions, a create button, record detail routing, search and recent-items integration |
| `{ "type": "object", "objectName": "project", "viewName": "project.by_status" }` | `/apps/my_app/project/view/project.by_status` | The same shell, with the entry **anchored** to a named view — users can still switch |
| `{ "type": "object", "objectName": "project", "filters": { "status": "open" } }` | `/apps/my_app/project/data?filter[status]=open` — the **bare data surface** | URL-defined conditions over everything permissions allow, bound to **no saved view**. Conditions show as removable chips; the full filter/sort/group toolbar is available; "Save as view" turns the slice into a named view |
| `{ "type": "page", "pageName": "project_overview" }` | `/apps/my_app/page/project_overview` | Nothing but your page schema. View switching, actions, and record links must be assembled by hand |

The key asymmetry: a page can imitate the other two, but it **loses the object
shell** — and every future improvement to that shell (new actions, better view
switching, permission trimming) will skip your page.

> **Creating a view at runtime ("Add View" / "Save as view").** Both entry
> points stage the new view as a per-item **draft** (ADR-0034) — invisible to
> other users until you Publish. Its identity is the canonical qualified name
> `<object>.<key>` (e.g. `project.by_status`), used as the metadata row key,
> the `body.name`, and the ViewTabBar tab id alike, so the draft → preview →
> publish loop resolves to a single row. After creating, the console navigates
> you to the new view in **draft-preview mode** (`?preview=draft`) so you can
> verify it and Publish from the DraftPreviewBar in one click. The create
> dialog asks for a display label **and** a machine key; the key auto-fills
> from the label for Latin text, and must be typed for non-Latin (CJK, …)
> labels rather than falling back to a random name.

## The Rule of Least Power

Use the least powerful construct that expresses the requirement:

1. **Default: one plain `object` entry per core business object.**
   No `viewName`. The default view is defined by view metadata, so the
   navigation layer stays decoupled from presentation.

2. **Add `viewName` when the menu item is a named slice.**
   If the label is a *perspective* — "By Status", "Due This Week",
   "My Tasks" — create a named view (convention: `<object>.<key>`, e.g.
   `project.by_status`) and anchor the entry to it. `viewName` sets the
   entry point; it does not lock the user in.

3. **Use `filters` for one-off or parameterized slices.**
   A dashboard drill-through, a shared link, "records assigned to me" — put
   the condition in the URL (`filters: { "owner_id": "{current_user_id}" }`)
   and let it land on the bare data surface instead of authoring a view.
   Promote the slice to a named view only when it's curated and reused.
   Note the surface is not a security feature: it shows exactly what
   row-level permissions already allow.

4. **Create a page only for composition a single object view cannot express.**
   Multiple objects side by side or in tabs, KPI cards mixed with lists,
   onboarding or static content, parameterized pages. A page that wraps a
   single object's single view is an anti-pattern.

5. **Use `dashboard` for metric/chart aggregation and `report` for tabular
   analysis** — don't rebuild them as pages of chart blocks.

6. **One entry per target.** Don't offer the same object through both a plain
   entry and a page that wraps its default view. If one object needs several
   menu entries, make all of them named-view entries — mixing styles breaks
   active-state highlighting in the sidebar.

As a rule of thumb, in a typical business app about 80% of navigation entries
should be `object` entries (with or without `viewName`); pages are for the
home screen, onboarding, and cross-object workbenches.

## Write Spec-Shaped Items

Navigation is a discriminated union on `type`. Each type has its own target
field — there is no generic `path` and no `kind`:

```json
{
  "navigation": [
    { "id": "nav_projects", "type": "object", "objectName": "project", "label": "Projects" },
    { "id": "nav_by_status", "type": "object", "objectName": "project", "viewName": "project.by_status", "label": "By Status" },
    { "id": "nav_my_open", "type": "object", "objectName": "project", "filters": { "owner_id": "{current_user_id}", "status": "open" }, "label": "My Open Projects" },
    { "id": "nav_kpis", "type": "dashboard", "dashboardName": "company_kpis", "label": "KPIs" },
    { "id": "nav_workbench", "type": "page", "pageName": "cross_object_workbench", "label": "Workbench" },
    { "id": "nav_docs", "type": "url", "url": "https://docs.example.com", "target": "_blank", "label": "Docs" }
  ]
}
```

Requirements:

- `id` (snake_case) and `type` are mandatory on every item. `label` is
  optional: an entry without one shows its target's **current** label, resolved
  when the navigation renders — the view's label for an entry that names a
  labelled view, else the object's or dashboard's label, else the target's
  machine name. A renamed object, view or dashboard therefore shows its new
  name on the next load without touching the navigation. Entries of other types
  fall back to their target's name (`pageName`, `reportName`, the `url`) and a
  group to its `id`, so give those a `label`. A `label` you do write renders
  verbatim. Never write an empty `label` — omit the key instead.
- The target field must match the type: `objectName`, `pageName`,
  `dashboardName`, `reportName`, or `url`. Keys like `path` or `kind` are
  ignored at runtime and rejected at save.
- A `doc` entry opens the package documentation portal instead of a data
  surface. It names a `book` (opens the book at its first readable page), a
  `doc` (opens that page — the doc's name, i.e. its source filename stem such
  as `crm_lead_guide`, never `crm_lead_guide.md` or a path), or both (that page
  in that book). At least one of the two is required. Name the book by its
  `name`, even when it declares a `slug`: the docs portal resolves the name and
  redirects to the book's canonical `slug` URL. Who may read a book is the
  book's `audience`, enforced by the server —
  the entry itself carries only the usual `visible` / `requiredPermissions`
  gates. You do not repeat the audience on the entry: a member who may not
  read what it opens — a doc outside their audience, a book whose audience
  excludes them or with no page they can read — does not see the entry. The
  server leaves it out of the app it serves that member, and the console's
  menu hides it too, from the member's own list of readable docs and books.
- Put items under the `navigation` key. `menu` is deprecated legacy and only
  kept for backward compatibility.

Object entries also support record deep-links — `recordId` (with template
variables like `{current_user_id}`) opens a specific record, which is how
"My Profile"-style entries are built.

## Quick Checklist

Before publishing an app, scan the navigation for:

- Pages that merely wrap a single object view → replace with an object entry.
- Items carrying `path`/`kind` → rewrite as typed items.
- The same object reachable twice (plain entry + wrapper page) → keep one.
- View names not following `<object>.<key>`, ids not snake_case → rename.
