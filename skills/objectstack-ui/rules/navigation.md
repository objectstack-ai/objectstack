# App Navigation & Run Modes

<!-- os:check -->
```typescript
import { App } from '@objectstack/spec/ui';

export const CrmApp = App.create({
  name: 'crm_enterprise',
  label: 'Enterprise CRM',
  icon: 'briefcase',
  // defaultAgent: 'build',                // ADR-0063 §2 — the resolvable set is exactly two
                                           // platform agents: `ask` (data surface) / `build`
                                           // (authoring, e.g. Studio). Any other name parses
                                           // but binds nothing at chat time. A data app like
                                           // this one omits the key — `ask` is the default.
  // hidden: true,                         // ADR-0045 — drop from the App Switcher but keep
                                           // routable & permission-checked; the shell surfaces
                                           // hidden apps (e.g. `account`) via the avatar menu.
  branding: {
    primaryColor: '#4169E1',
    logo: '/assets/crm-logo.png',
    favicon: '/assets/crm-favicon.ico',
  },
  navigation: [
    {
      id: 'group_sales', type: 'group', label: 'Sales', icon: 'chart-line',
      expanded: true,
      children: [
        { id: 'nav_lead',        type: 'object', objectName: 'lead',        label: 'Leads',         icon: 'user-plus' },
        { id: 'nav_opportunity', type: 'object', objectName: 'opportunity', label: 'Opportunities', icon: 'target' },
        // Open a specific named view instead of the object default:
        { id: 'nav_pipeline',    type: 'object', objectName: 'opportunity', viewName: 'pipeline_kanban', label: 'Sales Pipeline', icon: 'columns-3' },
        // One-off parameterized slice — lands on the bare data surface
        // (`/:objectName/data`, objectui ADR-0055) with removable URL filter
        // chips, NOT anchored to a saved view. Don't author a view for these:
        { id: 'nav_my_open',     type: 'object', objectName: 'opportunity', filters: { owner_id: '{current_user_id}', status: 'open' }, label: 'My Open Deals', icon: 'user-check' },
        { id: 'nav_dash',        type: 'dashboard', dashboardName: 'sales_dashboard', label: 'Sales Dashboard', icon: 'chart-bar' },
        { id: 'nav_report',      type: 'report',    reportName: 'opportunities_by_stage', label: 'Opps by Stage', icon: 'bar-chart-3' },
      ],
    },
    {
      id: 'group_approvals', type: 'group', label: 'Approvals', icon: 'check-circle',
      children: [
        // Reference system objects via `requiresObject` so the menu auto-hides
        // when the capability is not installed.
        { id: 'nav_approval_requests', type: 'object', objectName: 'sys_approval_request', label: 'Approval Requests', icon: 'inbox', requiresObject: 'sys_approval_request' },
      ],
    },
  ],
});
```

---

## Three Run Modes: Object Nav vs Filters Slice vs Interface Pages (ADR-0047 / objectui ADR-0055)

Object list UI has **three run modes**, selected by the navigation item shape:

| | Data mode (`type: 'object'`) | Bare slice (`type: 'object'` + `filters`) | Interface mode (`type: 'page'`) |
|:--|:--|:--|:--|
| What renders | ALL list views as switcher tabs | The URL-defined slice, no saved-view tabs | One curated page with its own list definition |
| Anchored to | Saved views | **The URL itself** (`/:objectName/data?filter[...]`) | Page config |
| User-created views | Allowed | "Save as view" exit only | Never |
| Quick filters | Auto-derived (or view `userFilters` — `dropdown` only) | Auto-derived + removable URL chips | Only what the author enabled |
| Visualization | Switchable (whitelist) | Switchable (URL filter state survives) | Locked unless whitelisted |

**Decision rule — default to data mode.** Generate ONLY objects + list views +
navigation pointing at objects. Escalate only on explicit signals:

- **`filters` slice** — the entry is a one-off / parameterized condition
  (dashboard drill-through, "assigned to me" link, a shared URL). Don't
  author a view for it; a slice graduates to a named view only when it is
  curated and reused. Values support `{current_user_id}` / `{current_org_id}`.
  Never treat it as security: the surface shows what row-level permissions
  allow. (Canonical rules: objectui ADR-0055, "parameterized bare data
  surface".)
- **Interface page** — persona split ("sales reps see…", customer portal,
  给业务部门的简化界面); capability narrowing ("users must not change views",
  "only filter by X"); curation language (workspace / 工作台 / "Airtable
  interface-like").

Ambiguity resolves to **no page and no view** — data mode is a functional
superset; a missing page costs polish, a superfluous page (or a view authored
for a one-off slice) is a permanently-maintained duplicate asset.

> One-sentence rule: prefer the object's default view over a pinned
> `viewName`; prefer URL `filters` over authoring a view for one-off slices;
> prefer a named view over a page; use a page only for composition a single
> object view cannot express. Every target appears exactly once.

**The iron rule (revised):** an interface page **IS the view definition**. It
binds an object (`interfaceConfig.source`) and carries its **own** `columns` /
`sort` / `filterBy` directly (Airtable parity — there is no "inherit from a
named view" concept), plus presentation policy (`userFilters`,
`appearance.allowedVisualizations`, `userActions`). The old
`sourceView` ("inherit from a named object view") is **deprecated** legacy: it
is still honored at runtime as a fallback when the page defines no `columns` of
its own, but new pages define `columns`/`sort`/`filterBy` on the page.

<!-- os:check -->
```typescript
import { definePage } from '@objectstack/spec/ui';

export const TaskWorkbenchPage = definePage({
  name: 'task_workbench',
  label: 'Task Workbench',
  type: 'list',
  object: 'task',
  interfaceConfig: {
    source: 'task',
    columns: ['subject', 'status', 'due_date'],  // the page IS the view definition
    sort: [{ field: 'due_date', order: 'asc' }],
    filterBy: [{ field: 'status', operator: 'not_equals', value: 'done' }],
    userFilters: { element: 'dropdown', fields: [{ field: 'status' }] },
    appearance: { allowedVisualizations: ['grid'] },  // locked
    userActions: { sort: true, search: true, filter: false },
  },
});
```

---

## Record Presentation — surface, width & columns are auto-derived

A record's create / edit / detail **presents itself adaptively**. You do **not**
author the surface, the overlay width, or the column count — all three are derived
at runtime from how heavy the record is + the client viewport, because an author
(especially an AI) cannot know the client's screen. **Write the data (fields,
`fieldGroups`); let the platform lay it out.**

- **Surface (page vs drawer).** Derived from field count: a field-heavy object
  opens create/edit/detail as a **full page**; a light one as a **drawer**. Mobile
  always pages. Don't set it. To force it for a specific object, set
  `navigation.mode` (`page` | `drawer` | `modal`) on the list view (or object) — or,
  for bespoke layout, assign a record `Page` (below).
- **Field width.** Use the relative **`span: 'full'`** to make a field take the
  whole row; otherwise **omit it** (`auto` sizes by widget type × current columns —
  textarea / rich-text / file take the row automatically). Do **not** use the
  absolute `colSpan` — it only lines up at one width and is deprecated.
- **Overlay width.** Never author pixels. If you must nudge, use the **`size`**
  bucket (`sm` | `md` | `lg` | `xl` | `full`) on `navigation`; the pixel
  `width` / `drawerWidth` are deprecated (they can't be chosen without knowing the
  client viewport).
- **Column count.** Not authored. The form grid follows its **real rendered width**
  via container queries — the same form is 1 column in a narrow drawer and up to 4
  on a wide page. Author *grouping* with `fieldGroups` + `Field.group`; the columns
  adapt themselves.
- **`sections` are the escape hatch — reach for them last.** The ladder, in
  order: (1) **derive** — declare `fieldGroups` + `Field.group` and author no
  `sections` at all; (2) **reference** — when one surface needs a local
  arrangement, a section may name a declared group, `{ group: 'contact_info' }`,
  and inherits its members, label and presentation (restating a key the group
  declares is refused at parse); (3) **enumerate** — `{ label, fields: [...] }`
  only for a named-customer requirement a group reference genuinely cannot
  express (a cross-group entry combination, a wizard/pane structure), with that
  reason in a comment beside it. A hand-enumerated section re-copies membership
  the object already owns and goes stale on the next field added, so rung 3 is
  an exception, never a default.

> **Rule of thumb: presentation (surface / width / columns) is not metadata.**
> Write fields + semantic roles; the renderer decides the pixels. Reach for
> `navigation.mode` / `size` / a `Page` only to *override* — never as the default.
