# Form Views & Master-Detail Forms

`form` and the named `formViews` live in the object's `defineView` container
([List Views](./list-views.md)). Field width, column count and the `sections`
ladder:
[Record Presentation](./navigation.md#record-presentation--surface-width--columns-are-auto-derived).

## Form Views

| Type | When to Use |
|:-----|:------------|
| `simple` | Stacked sections on one scrolling page — the default, at any field count |
| `tabbed` | One tab per section — only for sections read apart; a required field on another tab is flagged only on its tab, and the tab strip overflows on a phone |
| `wizard` | Step-by-step flow — guided data entry (onboarding, applications) |

**A long form stays `simple`: collapse what is rarely filled** with
`collapse: 'collapsed'` on the object's `fieldGroups` entry, or `collapsed: true`
on a form section listing its own `fields`. `columns` (form or section) is a
per-row ceiling a narrow screen lowers; unset, a section draws two, so set `3`
for a wide data-entry form. `modalSize` (`sm` to `full`) sizes the New / Edit
dialog; unset, the field count picks `lg` or `xl`.

**A public form** is a form view with
`sharing: { enabled: true, allowAnonymous: true, publicLink: 'slug' }`:
Web-to-Lead at `GET/POST /api/v1/forms/:slug`.

## Master-Detail Forms (parent + child line items)

To let users enter a record **together with its child line items** (invoice +
lines, project + tasks) and save them **atomically**, you almost never need a
custom page or form config. Prefer, in order:

1. **Relationship `inlineEdit` (default, zero UI config).** Declare it in the
   DATA MODEL — set `inlineEdit` on the child's `master_detail` field that
   references the parent. Every standard New/Edit form for the parent (modal,
   drawer, full-page) then auto-renders the children and saves parent + children
   in one atomic `/api/v1/batch`. **No view metadata needed.** A parent or child
   declaring `enable.apiMethods` must list `'bulk'`, or that save is refused
   `405 OBJECT_API_METHOD_NOT_ALLOWED`. The
   `true` / `'grid'` / `'form'` ladder and what each value picks:
   **objectstack-data → Relationships → Inline Editing**.

2. **Form view `subforms` (override / tuning).** Add to a form view only when you
   need to override the derived columns/order, or expose a child the
   relationship didn't mark inline:

   ```typescript
   form: {
     type: 'simple',
     sections: [{ group: 'invoice_header' }],  // a declared fieldGroup
     subforms: [
       { childObject: 'invoice_line', // set `columns` only to override
         title: 'Line Items', addLabel: 'Add line' },
     ],
   },
   ```

3. **`object-master-detail-form` page block (bespoke layout).** Use a page only
   for free-form layouts. Same `details: [{ childObject }]` shorthand.

**Line-item grid behaviors (`grid` mode).** The editable grid is a real
spreadsheet-style line editor, and
every behaviour is derived from the DATA MODEL — computed columns, catalog
typeahead auto-fill, persisted drag-reorder, and the live Subtotal → Tax → Total
stack: **objectstack-data → Relationships → Inline Editing**. Three things are
authored on this side: a trailing **ghost** row always exists, so never add an
"Add line" button to the grid (typing in the ghost materialises a row; an
untouched one is never persisted; a record-header action that inserts a priced
line is [Actions](./actions.md)); `autofill: false` opts one column out of the typeahead copy;
and the form's `taxRateField` overrides which parent field drives the totals.

## Field Conditional Rules in Forms

Conditions that belong to a field's lifecycle — `visibleWhen`, `readonlyWhen`,
`requiredWhen` — are declared on the **DATA MODEL field**, not in the form view;
ObjectUI forms consume them. Their semantics and server behaviour:
[objectstack-data → Conditional Field Rules](../../objectstack-data/SKILL.md#conditional-field-rules).
