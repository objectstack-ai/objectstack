---
title: "Schema Type Reference"
description: "Complete API reference for all ObjectUI schema types with annotated examples"
---

# Schema Type Reference

This reference documents every ObjectUI schema type with annotated JSON examples. Each schema extends `BaseSchema` and can be rendered by the ObjectUI engine from pure JSON.

> **Import:** All types are available from `@object-ui/types`.
>
> ```typescript
> import type { PageNodeSchema, FormSchema, TableSchema, /* ... */ } from '@object-ui/types';
> ```

---

## Base Schema

**"A component node" is named `DeclaredNode`.** That is the object half a renderer
receives: a node of a declared type, keyed by the required `type` — the registry key that
selects the renderer. Every schema type in this reference extends `BaseSchema`, which
carries `type` and the shared keys tabled below. Use `DeclaredNode` for any position that
holds a node object: a slot's declared type, a prop, a type annotation in an example. A
value typed `BaseSchema` names no declared type (its `type` is any string), so it does not
fit a node slot or `SchemaRenderer`'s `schema` prop.

Reach for `SchemaNode` only where the wider union is genuinely correct. `SchemaNode` is
`DeclaredNode` (a node of a declared type) **plus** the primitive members that render as
text, so it is the right word
for a slot that also accepts a bare string (`children`) and the wrong word for a
position that must be an object: a renderer that narrows a slot with
`typeof node === 'object'` before reading its keys drops those primitive members on the
floor. Naming the union where only the object half is accepted is the mismatch
objectui#7082 had to correct nine times.

### SchemaNode

The foundational building block of ObjectUI. Every component in the system is described by a `SchemaNode`. It can be a node of a declared type, or a primitive value rendered as text.

```typescript
import type { DeclaredNode } from '@object-ui/types';

// The definition `@object-ui/types` declares
type SchemaNode = DeclaredNode | string | number | boolean | null | undefined;
```

`DeclaredNode` is the discriminated union, keyed by `type`, of every node type
`@object-ui/types` declares (the component schemas and the spec-declared
authoring nodes) and every type your application declares in
`CustomNodeRegistry`. Every node slot (`children`, `trigger`, `content`, a
view's `schema`) and `SchemaRenderer`'s `schema` prop take it, so an inline
child is checked against its own type's keys, and a `type` nothing declares is
refused. A type you register with `ComponentRegistry` joins it through
`CustomNodeRegistry`, an interface your application augments with
`declare module '@object-ui/types'`, one entry per registered type, keyed by
the type's name. The SchemaRenderer page's "Component Registry" section walks
through a registration and its entry.

### BaseSchema

All schema types extend `BaseSchema`. These shared properties are available on every component.

```json
{
  "type": "div",
  "id": "my-component",
  "name": "wrapper",
  "label": "Wrapper",
  "description": "A container element",
  "className": "p-4 bg-white rounded-lg",
  "visible": true,
  "visibleOn": "${data.showWrapper}",
  "disabled": false,
  "disabledOn": "${data.isLocked}",
  "testId": "wrapper-element",
  "ariaLabel": "Content wrapper",
  "children": []
}
```

One row per declared member, in declaration order, so the list can be checked against `BaseSchema` by reading the two side by side.

| Property | Type | Description |
|----------|------|-------------|
| `type` | `string` | **Required.** Component type identifier (e.g. `"page"`, `"form"`, `"table"`). |
| `id` | `string` | Unique instance identifier. |
| `name` | `string` | Component name, used for form fields and data binding. |
| `label` | `string \| I18nLabel` | Human-readable display label. `I18nLabel` is the spec's **inline locale map** (`string \| Record<string, string>`, keyed by BCP-47 locale tag such as `en` or `zh-CN`), resolved against the display locale by `resolveI18nLabel`. |
| `description` | `string \| I18nLabel` | Help text or tooltip content. Same inline-locale-map vocabulary and resolver as `label`. |
| `placeholder` | `string` | Hint text for input components. |
| `className` | `string` | Tailwind CSS utility classes. |
| `style` | `Record<string, string \| number>` | Inline CSS styles. Use sparingly — prefer `className`. |
| `data` | `any` | Arbitrary data attached to the node. `any` because the shape is defined by the consuming component rather than by `BaseSchema`. |
| `bind` | `string` | Data-scope path this node draws its rows or value from, resolved by `useDataScope()`. Honoured only by components that call it. |
| `body` | *retired* | ⛔ Refused by name (objectui#6771). `body` was a second child-list spelling `BaseSchema` declared beside `children`; it is now `never` on the TypeScript face and an alias refusal on the Zod mirror, and the refusal names `children`. |
| `children` | `SchemaNode \| SchemaNode[]` | Child components rendered inside this component — the child-list key, and since objectui#6771 the only one. Whether a given node type renders a child list at all is still per component; see the note below. The keys OTHER than this one through which a renderer hands nodes to `SchemaRenderer` (a dialog's `trigger`, a tab item's `content`, a page's `regions[].components`) are per type and declared once as `NODE_SLOT_DECLARATIONS` / `nodeSlotsFor` (objectui#11170); `objectui check`, the core schema validator and the SDUI parser walk those positions as they walk `children`. |
| `visible` | `boolean \| string \| { dialect?: string; source: string }` | Visibility control. Accepts a boolean, a predicate expression string, **or** the CEL envelope object (`{ dialect: 'cel', source }` — what `objectstack build` emits for every authored predicate) — the renderer evaluates this key rather than reading it as a boolean. The string-or-envelope half is `ExpressionWire`, the one wire type `visibleWhen` on form fields already carries. |
| `visibleWhen` | `string \| { dialect, source }` | Canonical conditional-visibility predicate (ADR-0089); the element is shown when it evaluates truthy. Typed as `@objectstack/spec`'s `EvaluatedExpressionInput`: a predicate string, or the envelope the spec's parse writes (`dialect` is `cel`, `cron` or `template`, and `source` is not blank). Evaluated **before** `visible` and `visibleOn`, and outranks both. |
| `visibleOn` | `string` | Expression for conditional visibility. **Deprecated** (ADR-0089) — use `visibleWhen`. |
| `hidden` | `boolean \| string \| { dialect?: string; source: string }` | Inverse of `visible` — the node is not rendered. Accepts a boolean, a predicate expression string **or** the CEL envelope object (`ExpressionWire`), which the renderer evaluates rather than reading as a boolean; `hiddenOn` remains the sibling spelling. |
| `hiddenOn` | `string` | Expression for conditional hiding. |
| `disabled` | `boolean \| string \| { dialect?: string; source: string }` | Disabled state. Accepts a boolean, a predicate expression string **or** the CEL envelope object (`ExpressionWire`), on the same evaluated path as `visible`. |
| `disabledOn` | `string` | Expression for conditional disabling. |
| `testId` | `string` | Test identifier, rendered as `data-testid`. |
| `ariaLabel` | `string \| KeyedI18nLabel` | Accessibility label, rendered as `aria-label`. `KeyedI18nLabel` is the **keyed** form (`{ key, defaultValue?, params? }`), resolved by `resolveKeyedI18nLabel` — **not** the `I18nLabel` that `label` and `description` carry. The two are structurally confusable and each returns nothing useful for the other's input. |

Two things the table cannot show in a cell:

- **A concrete schema may narrow an inherited member, and its own declaration wins.** Many component schemas restate `label`, `description` or `disabled` more narrowly than `BaseSchema` declares them, so the unions above are what a node gets when its own schema does not restate the key. Check the component's own property table before writing a predicate string or a locale map into an inherited slot.
- **⚠️ `body` and `children` WERE two channels, not one key with two spellings — and the second one is retired (objectui#6771).** Each renderer read one, the other, both, or neither, and `SchemaRenderer` strips both out of the props bag it spreads — so writing the channel a renderer did not read rendered an EMPTY element, with no error at authoring time, none at validation time and none at render time. That is the defect objectui#8284 named after seven cards had repaired one page of it each, and it was closed per component by measurement: each schema narrows to the channel its renderer actually reads and **tombstones the other as `never`**, refused by name on both published faces (objectui#9254 for the components that read exactly one channel, objectui#9256 for the ones that read neither). objectui#6771 then closed the class at its source: `children` is the one child-list spelling and `body` is refused on `BaseSchema` itself. ⇒ **whether a node type accepts a child list at all is still per component** — check the component's own section, where a node that renders no children tombstones `children` too.
- **This list is exhaustive for *declared* members; the two faces differ on *accepted* keys.** `BaseSchema` carries no index signature (objectui#8347), so on the TypeScript face an undeclared key, a misspelling included, is a compile error in a typed literal. Its tolerant Zod mirror is still `.passthrough()`, so the rendering face (and `safeValidateSchema`) keeps an undeclared key; the derived strict face, `StrictAnyComponentSchema`, refuses it. Absence from this table does not mean the tolerant face rejects a key.

---

## Layout Schemas

### PageNodeSchema

Top-level page container. Defines a full page with optional regions (header, sidebar, footer).

```json
{
  "type": "page",
  "title": "User Dashboard",
  "icon": "LayoutDashboard",
  "description": "Overview of user activity",
  "pageType": "app",
  "object": "User",
  "variables": [
    { "name": "userId", "type": "string", "defaultValue": "current" }
  ],
  "regions": [
    {
      "name": "header",
      "components": [{ "type": "text", "content": "Welcome back" }]
    }
  ],
  "children": [
    { "type": "card", "title": "Activity", "children": [] }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Page heading, drawn as the page's `h1` on every page type except `"record"`. A record page's heading is a `page:header` block. |
| `icon` | `string` | Lucide icon name for the page. |
| `description` | `string` | Line under the heading, drawn on every page type except `"record"`. |
| `pageType` | `PageType` | The page kind: `"record"` (the default), `"home"`, `"app"`, `"utility"` or `"list"`. See [Page types](#page-types) below. |
| `object` | `string` | ObjectQL object name this page operates on. |
| `template` | `string` | Template name for page layout. |
| `variables` | `PageVariable[]` | Page-level variables with types and defaults. |
| `regions` | `PageRegion[]` | Named layout regions (header, sidebar, footer). |
| `children` | `SchemaNode \| SchemaNode[]` | Main page content when the page declares no regions — one node, or a list of them. Spelled `body` until objectui#6771 retired that spelling. |
| `isDefault` | `boolean` | Whether this is the default page for the object. |
| `assignedProfiles` | *retired* | ⛔ Refused by name (objectui#9409). `@objectstack/spec` retired the key: ADR-0090 D2 deleted the Profile concept it was named after, and nothing ever enforced it, so a page that listed profiles stayed open to everyone who could reach it. Both published faces take the spec's tombstone: any value is a TypeScript error and a parse failure at `assignedProfiles`. Delete the key. Page audience comes from permission sets: gate the data the page shows with the object's permission sets, and grant those sets to people through positions. |
| `aria` | `AriaProps` | ARIA attributes for the page's root element: `ariaLabel` (a plain string, or an inline locale map such as `{ "en": "Orders", "fr": "Commandes" }`, resolved for the display locale) renders `aria-label`, `ariaDescribedBy` renders `aria-describedby`, and `role` renders `role`. This is the spec's inline vocabulary, not the keyed flat `ariaLabel` described under BaseSchema. The page adds no default role. |

#### Page types

`pageType` takes the five members of `@objectstack/spec`'s `PageTypeSchema`. It decides who
draws the page's heading and how wide the page's content may grow:

| `pageType` | Kind | Heading |
|------------|------|---------|
| `"record"` | A component-based record page. The default when `pageType` is omitted. | Draws neither `title` nor `description`. Put the heading in a `page:header` block in `children` or a region. |
| `"home"` | A landing page, laid out dashboard-style. It has the widest cap. | Draws `title` and `description`. |
| `"app"` | An app-level page with navigation context. | Draws `title` and `description`. |
| `"utility"` | A compact, focused page, such as settings or a form. It has the narrowest cap. | Draws `title` and `description`. |
| `"list"` | A record list or grid surface. | Draws `title` and `description`. |

On every type, a titled `page:header` block in the page takes the `h1` instead of `title`.
The page's own `description` still draws on every type except `"record"`. Any other value,
such as `"detail"`, `"form"`, `"dashboard"`, `"report"` or `"custom"`, is refused at
`pageType` when the schema is validated. The layout guide's
[Page Component](/docs/guide/layout#page-component) and
[Content Width](/docs/guide/layout#content-width) sections show each type in a page.

**Related:** [AppSchema](/docs/core/app-schema), [DivSchema](#divschema), [GridSchema](#gridschema)

---

### DivSchema

A generic container element. The simplest layout primitive.

```json
{
  "type": "div",
  "className": "flex items-center gap-4 p-6",
  "children": [
    { "type": "text", "content": "Hello World" },
    { "type": "button", "label": "Click me" }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `children` | `SchemaNode \| SchemaNode[]` | Child elements to render inside the div. |

**Related:** [GridSchema](#gridschema), [CardSchema](#cardschema)

---

### CardSchema

A styled container with optional header, body, and footer regions.

```json
{
  "type": "card",
  "title": "Revenue Summary",
  "description": "Monthly revenue breakdown",
  "variant": "outline",
  "hoverable": true,
  "header": [
    { "type": "badge", "label": "Live", "variant": "secondary" }
  ],
  "children": [
    { "type": "statistic", "label": "Total Revenue", "value": "$12,400" }
  ],
  "footer": [
    { "type": "button", "label": "View Details", "variant": "ghost" }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Card title text. |
| `description` | `string` | Subtitle / description text. |
| `variant` | `"default" \| "outline" \| "ghost"` | Visual style variant. |
| `hoverable` | `boolean` | Add hover elevation effect. |
| `clickable` | `boolean` | Make the entire card a click target. |
| `header` | `SchemaNode \| SchemaNode[]` | Content rendered in the card header. |
| `children` | `SchemaNode \| SchemaNode[]` | Main card content. Spelled `body` until objectui#6771 retired that spelling. |
| `footer` | `SchemaNode \| SchemaNode[]` | Content rendered in the card footer. |

**Related:** [DivSchema](#divschema), [GridSchema](#gridschema)

---

### GridSchema

A responsive grid layout. Columns can be a fixed number or responsive breakpoints.

```json
{
  "type": "grid",
  "columns": { "sm": 1, "md": 2, "lg": 3 },
  "gap": 6,
  "children": [
    { "type": "card", "title": "Card 1", "children": [] },
    { "type": "card", "title": "Card 2", "children": [] },
    { "type": "card", "title": "Card 3", "children": [] }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `columns` | `ColumnCount \| Partial<Record<BreakpointName, ColumnCount>>` | A column count from 1 to 12 (`ColumnCount`), or a responsive map of such counts keyed by breakpoint (`xs`, `sm`, `md`, `lg`, `xl`, `2xl`), e.g. `{ sm: 1, md: 2, lg: 3 }`. Any other count is refused with the set named (objectui#11491). The flat `smColumns` / `mdColumns` / `lgColumns` / `xlColumns` keys are retired and refused by name; the breakpoint map is the one spelling (objectui#11505). |
| `gap` | `0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 \| 12` | Gap step between grid items; `0` is none (default `4`). Any other number is refused with the set named (objectui#11474). |
| `children` | `SchemaNode \| SchemaNode[]` | Grid items. |

**Related:** [DivSchema](#divschema), [CardSchema](#cardschema), [DashboardComponentSchema](#dashboardcomponentschema)

---

### TabsSchema

A tabbed interface for organizing content into switchable panels.

```json
{
  "type": "tabs",
  "defaultValue": "overview",
  "orientation": "horizontal",
  "items": [
    {
      "value": "overview",
      "label": "Overview",
      "icon": "Info",
      "content": { "type": "div", "children": [{ "type": "text", "content": "Overview content" }] }
    },
    {
      "value": "settings",
      "label": "Settings",
      "icon": "Settings",
      "content": { "type": "form", "fields": [] }
    }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `defaultValue` | `string` | Initially active tab value. |
| `value` | `string` | Controlled active tab value. |
| `orientation` | `"horizontal" \| "vertical"` | Tab bar orientation. |
| `items` | `TabItem[]` | Tab definitions, each with `value`, `label`, `icon`, `content`, and optional `disabled`. |

**Related:** [CardSchema](#cardschema), [PageNodeSchema](#pagenodeschema)

---

## Form Schemas

### FormSchema

A complete form with fields, validation, layout, and actions.

```json
{
  "type": "form",
  "layout": "horizontal",
  "columns": 2,
  "validationMode": "onBlur",
  "submitLabel": "Save Changes",
  "showCancel": true,
  "cancelLabel": "Discard",
  "defaultValues": {
    "name": "",
    "email": "",
    "role": "viewer"
  },
  "fields": [
    { "name": "name", "label": "Full Name", "type": "text", "required": true },
    { "name": "email", "label": "Email", "type": "email", "required": true },
    { "name": "role", "label": "Role", "type": "select", "options": [
      { "label": "Admin", "value": "admin" },
      { "label": "Editor", "value": "editor" },
      { "label": "Viewer", "value": "viewer" }
    ]}
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `fields` | `FormField[]` | Field definitions for the form. |
| `defaultValues` | `Record<string, any>` | Initial form values. |
| `layout` | `"vertical" \| "horizontal"` | Field label placement. |
| `columns` | `number` | Number of columns for field layout. |
| `validationMode` | `"onSubmit" \| "onBlur" \| "onChange" \| "onTouched" \| "all"` | When validation triggers. |
| `submitLabel` | `string` | Text for the submit button. |
| `cancelLabel` | `string` | Text for the cancel button. |
| `showCancel` | `boolean` | Whether to show a cancel button. |
| `showActions` | `boolean` | Whether to show the action buttons row. |
| `resetOnSubmit` | `boolean` | Reset form after successful submit. |
| `disabled` | `boolean` | Disable every input and the submit button. (`mode` is retired on this node and fails validation; for a create / edit / view form use [ObjectFormSchema](#objectformschema).) |
| `actions` | `SchemaNode[]` | Custom action buttons to replace defaults. |

**Related:** [InputSchema](#inputschema), [SelectSchema](#selectschema), [ObjectFormSchema](#objectformschema)

---

### InputSchema

A text input field supporting multiple input types with validation.

```json
{
  "type": "input",
  "name": "email",
  "label": "Email Address",
  "inputType": "email",
  "placeholder": "you@example.com",
  "required": true,
  "description": "We'll never share your email",
  "maxLength": 255
}
```

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Field name for form data binding. |
| `inputType` | `string` | HTML input type: `"text"`, `"email"`, `"password"`, `"number"`, `"tel"`, `"url"`, `"search"`, `"date"`, `"time"`, `"datetime-local"`. |
| `placeholder` | `string` | Placeholder text. |
| `required` | `boolean` | Whether the field is required. |
| `readOnly` | `boolean` | Render as read-only. |
| `error` | `string` | Error message to display. |
| `min` / `max` | `number` | Numeric range constraints. |
| `step` | `number` | Step increment for number inputs. |
| `maxLength` | `number` | Maximum character length. |
| `pattern` | `string` | Regex pattern for validation. |

**Related:** [FormSchema](#formschema), [SelectSchema](#selectschema)

---

### SelectSchema

A dropdown select field with predefined options.

```json
{
  "type": "select",
  "name": "priority",
  "label": "Priority",
  "placeholder": "Choose priority...",
  "required": true,
  "options": [
    { "label": "🔴 Critical", "value": "critical" },
    { "label": "🟠 High", "value": "high" },
    { "label": "🟡 Medium", "value": "medium" },
    { "label": "🟢 Low", "value": "low" }
  ],
  "defaultValue": "medium"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Field name for form data binding. |
| `options` | `SelectOption[]` | Array of `{ label, value }` objects. |
| `placeholder` | `string` | Placeholder text when no value selected. |
| `required` | `boolean` | Whether selection is required. |
| `defaultValue` | `string` | Initial selected value. |
| `error` | `string` | Error message to display. |

**Related:** [FormSchema](#formschema), [InputSchema](#inputschema)

---

### ButtonSchema

An interactive button with variants, icons, and loading states.

```json
{
  "type": "button",
  "label": "Deploy to Production",
  "variant": "default",
  "size": "lg",
  "icon": "Rocket",
  "iconPosition": "left",
  "loading": false,
  "buttonType": "submit"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `label` | `string` | Button text. |
| `variant` | `"default" \| "secondary" \| "destructive" \| "outline" \| "ghost" \| "link"` | Visual style. |
| `size` | `"default" \| "sm" \| "lg" \| "icon"` | Button size. |
| `icon` | `string` | Lucide icon name. |
| `iconPosition` | `"left" \| "right"` | Icon placement relative to label. |
| `loading` | `boolean` | Show loading spinner and disable interaction. |
| `buttonType` | `"button" \| "submit" \| "reset"` | HTML button type. |

**Related:** [ActionSchema](#actionschema), [FormSchema](#formschema)

---

## Data Display Schemas

### TableSchema

A simple static table: it renders inline `data` against `columns`, nothing
more. For row hover highlighting, striping, sorting, filtering, selection or
inline editing use the interactive `data-table` — the static `table` deliberately
does not implement those (objectui#5474 retired the keys that once suggested it
did; authoring them is now refused by validation instead of silently ignored).

```json
{
  "type": "table",
  "caption": "Recent Orders",
  "columns": [
    { "accessorKey": "id", "header": "#", "width": 60 },
    { "accessorKey": "customer", "header": "Customer" },
    { "accessorKey": "amount", "header": "Amount", "cellClassName": "text-right" },
    { "accessorKey": "status", "header": "Status" }
  ],
  "data": [
    { "id": 1, "customer": "Acme Corp", "amount": "$1,200", "status": "Paid" },
    { "id": 2, "customer": "Globex Inc", "amount": "$3,400", "status": "Pending" }
  ],
  "footer": { "type": "text", "content": "Showing 2 of 156 orders" }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `caption` | `string` | Table caption / title text. |
| `columns` | `StaticTableColumn[]` | Column definitions — the static subset: `accessorKey` (the row key to read) and `header` (heading text) are required; `width`, `className`, and `cellClassName` are the only other keys this renderer honours. Interactive column keys (`align`, `sortable`, `filterable`, `resizable`, `editable`, `cell`, `fixed`, `minWidth`, `type`) belong to `data-table`'s rich `TableColumn` and are refused here. |
| `data` | `any[]` | Array of row data objects. |
| `footer` | `SchemaNode \| string` | Footer content below the table. |

**Related:** [ObjectGridSchema](#objectgridschema)

---

### ChartSchema

A chart visualization supporting multiple chart types.

```json
{
  "type": "chart",
  "chartType": "bar",
  "title": "Monthly Revenue",
  "description": "Revenue by month for 2024",
  "height": 350,
  "showLegend": true,
  "showGrid": true,
  "animate": true,
  "xAxisKey": "month",
  "data": [
    { "month": "Jan", "Revenue": 4200, "Expenses": 3100 },
    { "month": "Feb", "Revenue": 5100, "Expenses": 3400 },
    { "month": "Mar", "Revenue": 4800, "Expenses": 3200 },
    { "month": "Apr", "Revenue": 6200, "Expenses": 3800 },
    { "month": "May", "Revenue": 5800, "Expenses": 3600 },
    { "month": "Jun", "Revenue": 7100, "Expenses": 4000 }
  ],
  "series": [
    {
      "name": "Revenue",
      "color": "#3b82f6"
    },
    {
      "name": "Expenses",
      "color": "#ef4444"
    }
  ]
}
```

The rows live on the chart node's own `data`, one object per row keyed by column
name. Each series' `name` (or `dataKey`) selects the column it plots within those
rows, and `xAxisKey` names the column on the category axis. A series carries no
numbers of its own: `ChartDataSeries.data` is a retirement tombstone
(objectui#6896) and an authored array is refused by name at parse.

| Property | Type | Description |
|----------|------|-------------|
| `chartType` | `ChartType` | **Required.** One of the `@objectstack/spec` `ChartType` families: `"bar"`, `"horizontal-bar"`, `"column"`, `"line"`, `"area"`, `"pie"`, `"donut"`, `"funnel"`, `"scatter"`, `"treemap"`, `"sankey"`, `"combo"`, `"gauge"`, `"solid-gauge"`, `"metric"`, `"kpi"`, `"bullet"`, `"radar"`, `"table"`, `"pivot"`. Any other value is refused with the set named (objectui#11521). The single-value families draw the first series' value in the first row as one number, and the tabular families draw a notice that points at the data-table and pivot components; the others plot the series. |
| `title` | `string` | Chart title. |
| `description` | `string` | Chart description / subtitle. |
| `categories` | `string[]` | An **alternative series list** — column names to plot, read only when `series` is absent, and ignored outright when it is present. Not axis labels: the category axis comes from `xAxisKey`. |
| `series` | `ChartDataSeries[]` | Data series. Each entry's `name` (or `dataKey`) names the column it plots within a `data` row; optional `label`, `color`, a per-series `type` (`"bar"`, `"line"`, `"area"`) for combo charts, `stack`, `yAxis` (`"left"` / `"right"`), `variant` (`"primary"` / `"comparison"`), `dashArray` and `opacity`. `chartType` on a series is refused by name — it is the renderer's internal spelling of `type`; write `type`. |
| `data` | `Array<Record<string, any>>` | Rows to plot — one object per row, keyed by column name. |
| `xAxisKey` | `string` | Row key holding the category (x) axis. The bare-string `xAxis: "month"` spelling folds onto this key at parse. |
| `xAxis` | `ChartAxis` | The category axis as `@objectstack/spec`'s axis object: `field` (required — the category column; `xAxisKey` wins when both are written), `title`, `format`, `min`, `max`, `stepSize`, `showGridLines`, `position`, `logarithmic`. Strict: an undeclared key is refused at parse. |
| `yAxis` | `ChartAxis[]` | The value axes — a **list** of the same axis object, one entry per axis; a second entry declares the right-hand axis. A single object or a bare string is refused. |
| `height` / `width` | `string \| number` | Chart dimensions. |
| `showLegend` | `boolean` | Display the legend. |
| `showGrid` | `boolean` | Display grid lines. |
| `animate` | `boolean` | Enable entry animations. |
| `config` | `Record<string, any>` | Additional chart library configuration. |

**Related:** [DashboardComponentSchema](#dashboardcomponentschema), [CardSchema](#cardschema)

---

### TreeViewSchema

A hierarchical tree component for nested data with expand/collapse and selection.

```json
{
  "type": "tree-view",
  "multiSelect": false,
  "showLines": true,
  "defaultExpandedIds": ["root", "src"],
  "nodes": [
    {
      "id": "root",
      "label": "project",
      "icon": "Folder",
      "children": [
        {
          "id": "src",
          "label": "src",
          "icon": "Folder",
          "children": [
            { "id": "app", "label": "App.tsx", "icon": "FileCode" },
            { "id": "index", "label": "index.ts", "icon": "FileCode" }
          ]
        },
        { "id": "readme", "label": "README.md", "icon": "FileText" }
      ]
    }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `nodes` | `TreeNode[]` | Optional. Nested tree data — the spelling the renderer reads FIRST, and the one the component's own `inputs` and `defaultProps` use. Each node has `id`, `label`, optional `icon` and `children`. |
| `data` | `TreeNode[]` | Optional. Nested tree data, read only when `nodes` is absent (the renderer reads `nodes` first — objectui#6939). |
| `defaultExpandedIds` | `string[]` | Node IDs expanded on initial render. |
| `defaultSelectedIds` | `string[]` | Node IDs selected on initial render. |
| `expandedIds` | `string[]` | Controlled expanded state. |
| `selectedIds` | `string[]` | Controlled selection state. |
| `multiSelect` | `boolean` | Allow selecting multiple nodes. |
| `showLines` | `boolean` | Show tree connector lines. |

**Related:** [TableSchema](#tableschema)

---

## CRUD Schemas

### CRUDSchema — retired

`CRUDSchema` and the `crud` node type were **removed** in objectui#5373 under
ADR-0049 (enforce-or-remove). The type had four declaration faces — a TypeScript
interface, a zod mirror, a branch in the schema validator and a `CRUDBuilder` —
and no registered renderer, for the whole life of the key. A node that spelled it
painted the OBJUI-001 "Unknown component type" panel, so this page was teaching a
shape that could not render.

There is no drop-in replacement, because a CRUD screen is a composition rather
than one node. Build it from the shapes that do render:

| What `CRUDSchema` promised | What to author instead |
|---|---|
| The record table, with toolbar, filters, pagination and row/batch actions | [ObjectGridSchema](#objectgridschema) |
| The create/edit form | [ObjectFormSchema](#objectformschema) |
| The single-record read view | [DetailSchema](#detailschema) / [DetailViewSchema](#detailviewschema) |
| Whole-object screens that bundle the above | [ObjectViewSchema](#objectviewschema) |

The `defaultSort` and `defaultSortOrder` keys documented here were `CRUDSchema`'s
own — a flat field name plus a separate direction. They are gone with it.
[ObjectGridSchema](#objectgridschema) used to declare its own, differently shaped
`defaultSort` (an object with `field` and `order`); that key has since been
retired too — see the note under [ObjectGridSchema](#objectgridschema).

Authoring `crud` is now refused by name: `validateSchema` from `@object-ui/core`
returns a `RETIRED_TYPE` error on `schema.type` naming the migration above, and
`objectui check` reports the type as unknown.

---

### ActionSchema

A powerful action definition supporting API calls, confirmations, dialogs, chaining, and conditional execution.

```json
{
  "type": "action",
  "label": "Submit Order",
  "level": "primary",
  "icon": "Send",
  "actionType": "ajax",
  "api": "/api/orders",
  "method": "POST",
  "data": { "status": "submitted" },
  "confirmText": "This will send the order to the warehouse.",
  "successMessage": "Order submitted successfully",
  "errorMessage": "Failed to submit order",
  "chain": [
    {
      "type": "action",
      "label": "Refresh",
      "actionType": "button",
      "reload": true
    }
  ],
  "chainMode": "sequential",
  "condition": "${data.items.length > 0}",
  "retry": {
    "maxAttempts": 3,
    "delay": 1000
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `label` | `string` | **Required.** Action display text. |
| `level` | `string` | Semantic level: `"primary"`, `"secondary"`, `"success"`, `"warning"`, `"danger"`, `"info"`. |
| `icon` | `string` | Lucide icon name. |
| `actionType` | `string` | Action kind: `"button"`, `"link"`, `"dropdown"`, `"ajax"`, `"confirm"`, `"dialog"`. |
| `api` | `string` | API endpoint for `ajax` actions. |
| `method` | `string` | HTTP method: `"GET"`, `"POST"`, `"PUT"`, `"DELETE"`, `"PATCH"`. |
| `data` | `any` | Request body data. |
| `confirmText` | `string` | Confirmation message shown before executing — the one confirm spelling, addressed by the translation bundle. (A structured `confirm` object was retired in objectui#4314.) |
| `dialog` | `object` | Modal dialog with `title`, `content`, `size`, `actions`. |
| `chain` | `ActionSchema[]` | Actions to execute after this action completes. |
| `chainMode` | `"sequential" \| "parallel"` | How chained actions execute. |
| `condition` | `boolean \| string \| { dialect?, source }` | Execution gate — the action runs only while this predicate holds (boolean, bare CEL, `${...}` template, or the normalized envelope). Declared and false skips the action; absent executes it. It is a **gate, not a branch**: express a branch as separate actions with mutually exclusive `condition`s. (The `{ expression, then, else }` branch shape was retired in objectui#3917 — nothing read it, so it ran unconditionally.) |
| `successMessage` / `errorMessage` | `string` | Toast messages on success/failure. |
| `reload` | `boolean` | Reload data after action completes. |
| `redirect` | `string` | URL to navigate to after action. |
| `retry` | `object` | Retry config with `maxAttempts` and `delay`. |

**Related:** [DetailSchema](#detailschema), [ButtonSchema](#buttonschema)

---

### DetailSchema

A single-record detail view with grouped fields, actions, and tabs.

```json
{
  "type": "detail",
  "title": "Order #1042",
  "api": "/api/orders/1042",
  "showBack": true,
  "groups": [
    {
      "title": "Customer Info",
      "fields": [
        { "name": "customer", "label": "Customer", "type": "text" },
        { "name": "email", "label": "Email", "type": "text" },
        { "name": "created", "label": "Created", "type": "date", "format": "MMM d, yyyy" }
      ]
    },
    {
      "title": "Order Details",
      "fields": [
        { "name": "total", "label": "Total", "type": "text" },
        { "name": "status", "label": "Status", "type": "badge" }
      ]
    }
  ],
  "actions": [
    { "type": "action", "label": "Edit", "icon": "Pencil", "level": "primary" },
    { "type": "action", "label": "Delete", "icon": "trash", "level": "danger", "actionType": "confirm" }
  ],
  "tabs": [
    {
      "key": "items",
      "label": "Line Items",
      "content": { "type": "table", "columns": [], "data": [] }
    },
    {
      "key": "history",
      "label": "History",
      "content": { "type": "timeline", "items": [] }
    }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Detail page title. |
| `api` | `string` | API endpoint to fetch record data. |
| `resourceId` | `string \| number` | ID of the record to display. |
| `groups` | `array` | Field groups, each with `title`, `description`, and `fields`. |
| `actions` | `ActionSchema[]` | Available actions (edit, delete, etc.). |
| `tabs` | `array` | Additional tabbed content with `key`, `label`, and `content`. |
| `showBack` | `boolean` | Show a back navigation button. |
| `loading` | `boolean` | Show loading state. |

> **Handler keys are not authorable in JSON, and this face refuses three of them by name.** `onBack` has been a named refusal since objectui#7344; since objectui#7804 this face also declares `onNavigate` and `onAddComment` as objectui#6124 **runtime slots**: a React host supplies the function through the TypeScript interface or as a React prop, and the validator **refuses the key by name** — the message leads with the slot's label (`SPA navigation callback`, `New comment callback`), states that the key "is a RUNTIME SLOT for a host-supplied function, not authorable metadata (objectui#6124): JSON has no function value, and no handler key consumes a declarative action object", and closes by pointing at the node-type spelling (`{ "type": "toast", … }`, an `action:button` node). Until then an authored `onNavigate: { "action": "toast" }` parsed **green** — `BaseSchema` is `.passthrough()`, so a key no arm declares is not refused, it stops being judged and the value is kept — and because every read site only tests the key for truthiness, the kept object then reached a call site expecting a function: `handleBack`, `handleEdit` and the post-delete redirect call `schema.onNavigate(url, { replace })` in `DetailView`'s own body, while `onAddComment` is forwarded as a prop into the comment composer, which renders *because* the key is truthy and then awaits it on send. ⚠️ `onTabChange` is a fourth handler key this view reads and it is **still undeclared** — and where the `object-kanban` board's third key, `onCardMove`, has been a **tombstone** refused by name since objectui#9342, an authored `onTabChange` is not refused at all: it is **kept**, read through a cast and handed to the tab strip's `onValueChange`, so it still reaches a call site expecting a function at the first tab switch. That gap is open on objectui#7804.

**Related:** [DetailViewSchema](#detailviewschema), [ObjectGridSchema](#objectgridschema)

---

## ObjectQL Schemas

These schemas integrate with [ObjectStack](https://objectstack.ai) for automatic data fetching, but work with any backend through the `data` prop.

### ObjectGridSchema

A data grid that auto-fetches from an ObjectQL object definition. Includes search, filters, pagination, grouping, and inline editing.

An authored `object-grid` node takes its props in its `properties` bag, whose members are `@objectstack/spec`'s `ComponentPropsMap['object-grid']` row. `objectui validate` judges the bag against that row and refuses a prop written flat on the node by name, naming its bag member, as the spec's own page component does (objectui#11276). `SchemaRenderer` hoists the bag onto the node before `ObjectGrid` runs, so `ObjectGridSchema` is the node as the renderer reads it, and the table below lists its members. Base props such as `className` stay on the node, beside the bag. `description` is a bag member: the spec's row declares it (objectstack#20694), so written on the node it is refused by name and pointed at `properties.description` (objectui#11227).

```json
{
  "type": "object-grid",
  "properties": {
    "objectName": "Contact",
    "description": "Manage your contacts",
    "title": "All Contacts",
    "searchableFields": ["name", "email", "company"],
    "resizable": true,
    "columns": [
      { "field": "name" },
      { "field": "email" },
      { "field": "company" },
      { "field": "phone" },
      { "field": "status", "label": "Status", "sortable": true }
    ],
    "sort": [{ "field": "name", "order": "asc" }],
    "operations": {
      "create": true,
      "update": true,
      "delete": true,
      "export": true
    },
    "rowActions": ["edit", "delete"],
    "pagination": {
      "pageSize": 25,
      "pageSizeOptions": [10, 25, 50, 100]
    }
  }
}
```

Every key in this example is one the grid reads (objectui#11068). It used to
also author `showFilters` (now retired on this node, below), `striped` and
`operations.read`, which nothing reads, and `selection: { enabled, mode }` and
`pagination.enabled`, which the validator refuses: selection is spelled `selection: { type: 'multiple' }` (`'none'`,
`'single'` or `'multiple'`), and `pagination` declares no on switch — its
presence enables paging. It also authored `emptyState`, which the grid reads but
the spec's row did not declare until objectstack#20694; it is authorable in the
`properties` bag now (see its row below).

| Property | Type | Description |
|----------|------|-------------|
| `objectName` | `string` | **Required**, unless a `dataSource` binding names the object (`"dataSource": { "object": "Contact" }`), which the registration lands here (objectui#11117). ObjectQL object API name. |
| `label` | `string \| I18nLabel` | Grid label: the table caption, the export file title and the record-detail overlay heading. The canonical spelling; the deprecated `title` is read only when `label` is absent. A per-locale map (`{ "en": "Accounts", "zh-CN": "客户" }`) resolves against the display locale (the workspace's regional default when one is configured, otherwise the active UI language) (objectui#10993). |
| `columns` | `string[] \| ListColumn[]` | Columns to display. Either a plain array of field names (`["name", "email"]`), which auto-resolve from object metadata, or an array of `ListColumn` objects whose identity key is `field` (`{ "field": "status", "label": "Status" }`) — never `name`. **Do not mix the two forms in one array:** the array is dispatched on its first entry, so column objects sitting behind a bare string are dropped. |
| `filter` | `any[]` | Pre-applied filter conditions. |
| `sort` | `SortConfig[]` | Default sort configuration. The string clause (`"name desc"`) was retired in objectui#8221 and now fails validation. |
| `description` | `string \| I18nLabel` | One line of help text drawn above the grid; a per-locale map resolves like `label` (objectui#11068). Authored in the `properties` bag: the spec's row declares it (objectstack#20694, objectui#11227). |
| `searchableFields` | `string[]` | Fields included in search. |
| `selection` | `SelectionConfig` | Row selection configuration. |
| `pagination` | `PaginationConfig` | Pagination settings. |
| `operations` | `object` | Enabled CRUD operations. |
| `rowActions` / `bulkActions` | `string[]` | Action identifiers for rows and batch selection. `bulkActions` is the spec-aligned key; `batchActions` is a legacy alias that takes precedence when both are set. |
| `editable` | `boolean` | Enable inline cell editing. |
| `grouping` | `GroupingConfig` | Row grouping configuration. **Server-side**: the set of groups, every group count and every per-group aggregation come from the group header query (`dataSource.queryGroupHeaders`), and each group's rows are paged by the server. Rows handed in whole are grouped in the browser (exact); over a data source with no header query, a grid that fetches its own rows refuses grouping with an error naming `queryGroupHeaders`. |
| `frozenColumns` | `number` | Number of columns frozen on scroll. |
| `conditionalFormatting` | `ConditionalFormattingRule[]` | Row styling rules, each `{ condition, style }` — a CEL `condition` over the row's `record.*` and a CSS `style` map, the rule a list view declares; the first matching rule styles the row. The native `{ field, operator, value }` rule, its `expression`, and a colour written beside `condition` (rather than inside `style`) are retired (objectui#11533): `@object-ui/types` refuses them by name on `ObjectGridSchema`, the `object-view` `table` slot and `list-view`. `{ field: 'priority', operator: 'equals', value: 'high', backgroundColor: '#fee2e2' }` is `{ condition: "record.priority == 'high'", style: { backgroundColor: '#fee2e2' } }`. In an authored node's `properties` bag the member is `@objectstack/spec`'s row member, judged by the installed spec. A grid stored with a retired rule still paints it. |
| `navigation` | `ViewNavigationConfig` | SPA navigation configuration. |
| `emptyState` | `EmptyState` — `{ title?, message?, icon?, link? }` | Drawn in place of an empty table: a Lucide `icon`, a `title` (default: the table's "No results found"), a `message` (default: none) and one `link: { label, url }` the user follows (default: none), opened as a `type: 'url'` action opens it, through the action runner (objectui#12270). `title`, `message` and the link's `label` are `string \| I18nLabel`, each resolved against the display locale; a map with no usable entry keeps that member's default. Not drawn when a term in the grid's own server-side search box emptied it — the table and its search box stay (objectui#11068). Authored in the `properties` bag: the spec's row declares it as the list view's own `EmptyStateSchema` (objectstack#20694, objectui#11227). |

> **`name`, `placeholder`, `rowSpecActions` and `bulkSpecActions` are retired on
> this node (objectui#11068).** Nothing ever read them: `rowSpecActions` /
> `bulkSpecActions` were second spellings of `rowActions` / `bulkActions`, and a
> grid is neither a form field (`name`) nor an input (`placeholder`). Both faces of
> `@object-ui/types` refuse them by name. Write `rowActions`, `bulkActions`, `id`
> or `label`, and `emptyState: { "message": … }` instead.

> **`showFilters` is retired on this node too (objectui#11068).** An `object-grid`
> has no filter UI, and nothing read the key. The filter builder is the
> `list-view` toolbar's: author a `list-view` node and switch it with
> `"userActions": { "filter": true }`. To narrow the rows a grid fetches, write
> `filter`. Both faces of `@object-ui/types` refuse an authored `showFilters` on an
> `object-grid` by name. An [`object-view`](#objectviewschema)'s own `showFilters`,
> below, is a different key and is unchanged.

> **`defaultSort` is retired (objectui#5861).** `ObjectGridSchema` used to accept a
> legacy single-entry `defaultSort: { field, order }` beside `sort`. The installed
> `@objectstack/spec` protocol refuses it by name (a retired-key tombstone), and no
> renderer reads it any more: a grid that still carries it renders **unsorted**, and
> `@object-ui/types` refuses it on both faces (a `?: never` member and a named zod
> refusal). Rename the key to `sort` and wrap the value in an array —
> `"defaultSort": { "field": "name", "order": "asc" }` becomes
> `"sort": [{ "field": "name", "order": "asc" }]`, as in the example above.

**Related:** [ObjectViewSchema](#objectviewschema), [TableSchema](#tableschema)

---

### ObjectFormSchema

A smart form that auto-generates fields from an ObjectQL object. Supports simple, tabbed, wizard, split, drawer, and modal layouts.

An authored `object-form` node takes its props in its `properties` bag, whose members are `@objectstack/spec`'s `ComponentPropsMap['object-form']` row. `objectui validate` judges the bag against that row and refuses a prop written flat on the node by name, naming its bag member, as the spec's own page component does (objectui#10859). `SchemaRenderer` hoists the bag onto the node before `ObjectForm` runs, so `ObjectFormSchema` is the node as the renderer reads it, and the table below lists its members.

```json
{
  "type": "object-form",
  "properties": {
    "objectName": "Contact",
    "mode": "create",
    "formType": "tabbed",
    "title": "New Contact",
    "layout": "vertical",
    "columns": 2,
    "fields": ["firstName", "lastName", "email", "phone", "company"],
    "sections": [
      {
        "label": "Basic Info",
        "fields": ["firstName", "lastName", "email"]
      },
      {
        "label": "Details",
        "fields": ["phone", "company", "address"]
      }
    ],
    "showSubmit": true,
    "submitText": "Create Contact",
    "showCancel": true,
    "cancelText": "Cancel"
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `objectName` | `string` | **Required.** ObjectQL object API name. |
| `mode` | `"create" \| "edit" \| "view"` | **Required.** Form interaction mode. |
| `formType` | `string` | Layout type: `"simple"`, `"tabbed"`, `"wizard"`, `"split"`, `"drawer"`, `"modal"`. Aligned with `@objectstack/spec` `FormViewSchema.type`. |
| `recordId` | `string \| number` | Record ID for edit/view modes. |
| `fields` | `string[]` | Field API names to include (auto-resolved from object metadata). |
| `customFields` | `FormField[]` | Manually defined fields that override auto-generated ones. |
| `sections` | `ObjectFormSection[]` | Field sections (simple groups, tabs, or wizard steps depending on `formType`). Spec-aligned key. |
| `groups` | `array` | **Deprecated.** Legacy alias of `sections` (spec defines `groups` as an alias); normalized into `sections` when `sections` is absent. Legacy shape: `title`→`label`, `defaultCollapsed`→`collapsed`. Not a member of the spec's `object-form` row, so an authored bag refuses it; write `sections`. |
| `layout` | `string` | Label layout: `"vertical"`, `"horizontal"`. The spec row retired `"inline"` and `"grid"` (both rendered as `"vertical"`), so an authored bag refuses them; for several columns set `columns`. |
| `columns` | `number` | Number of form columns. |
| `submitText` / `cancelText` | `string \| I18nLabel` | Button labels. |
| `title` / `description` | `string \| I18nLabel` | Heading and subtitle of the drawer and modal presentations. |
| `nextText` / `prevText` | `string \| I18nLabel` | Wizard step-button labels. |
| `successMessage` | `string \| I18nLabel` | Toast shown after a successful submit. |
| `showSubmit` / `showCancel` / `showReset` | `boolean` | Toggle action buttons. |
| `drawerSide` | `string` | Drawer position: `"top"`, `"bottom"`, `"left"`, `"right"`. |
| `modalSize` | `string` | Modal size: `"sm"`, `"default"`, `"lg"`, `"xl"`, `"full"`. |
| `modalCloseButton` | `boolean` | Show the modal's close (X) button. Default `true`; `false` hides it. The modal still closes on Escape, and on the Cancel action when that is shown. |

#### Spec alignment & extension keys

`ObjectFormSchema` keys fall into four classes (#2545):

- **Spec-aligned** — same name and semantics as `@objectstack/spec` `FormViewSchema`: `title`, `description`, `layout`, `columns`, `sections`, `defaultTab`, `tabPosition`, `allowSkip`, `showStepIndicator`, `splitDirection`/`splitSize`/`splitResizable`, `drawerSide`/`drawerWidth`, `modalSize`, `subforms`, `submitBehavior` (plus `formType` ↔ spec `type`).
- **Component-contract keys** — not on `FormViewSchema`, but members of the spec's `ComponentPropsMap['object-form']` row, the `object-form` block's own props contract: `showSubmit`/`submitText`, `showCancel`/`cancelText`, `showReset`, `nextText`/`prevText`, `successMessage`, `navigateOnSuccess`, `resetOnSuccess`, `modalCloseButton`, `initialValues`, `fields`, `customFields`. `submitText`, `cancelText`, `nextText`, `prevText` and `successMessage` are `I18nLabel` there, as `title` and `description` are. This list was read off the installed `@objectstack/spec`'s `ComponentPropsMap['object-form']` row; nothing re-derives it, so check that row itself before relying on it.
- **Envelope key** — `className` is on neither `FormViewSchema` nor the `object-form` row, but on the spec's `PageComponentSchema`, the envelope every page node carries beside `type` and `properties`.
- **Runtime-only** — non-serializable renderer concerns that never appear in view metadata: `mode`, `recordId`, `open`/`onOpenChange`, `readOnly`, and all callbacks (`onSuccess`, `onError`, `onCancel`, `onStepChange`, `submitHandler`).

`I18nLabel` is `@objectstack/spec`'s label union: a plain string, or an inline per-locale map such as `{ "en": "Save order", "zh-CN": "保存订单" }`. `ObjectForm` resolves a map against the active UI language before any presentation reads it (objectui#10993).

**Related:** [FormSchema](#formschema), [ObjectViewSchema](#objectviewschema)

---

### ObjectViewSchema

A complete object management interface combining grid, form, search, filters, and view switching.

```json
{
  "type": "object-view",
  "objectName": "Deal",
  "title": "Sales Pipeline",
  "description": "Manage your deals",
  "defaultViewType": "kanban",
  "showSearch": true,
  "showFilters": true,
  "showCreate": true,
  "showViewSwitcher": true,
  "operations": {
    "create": true,
    "read": true,
    "update": true,
    "delete": true
  },
  "searchableFields": ["name", "company", "owner"],
  "listViews": {
    "all": {
      "label": "All Deals",
      "columns": ["name", "stage", "value", "owner", "closeDate"],
      "filter": [],
      "sort": [{ "field": "value", "order": "desc" }]
    },
    "my-deals": {
      "label": "My Deals",
      "columns": ["name", "stage", "value", "owner", "closeDate"],
      "filter": [{ "field": "owner", "operator": "equals", "value": "{current_user_id}" }]
    }
  },
  "defaultListView": "my-deals",
  "table": {
    "columns": ["name", "stage", "value", "owner", "closeDate"],
    "pageSize": 25
  },
  "form": {
    "formType": "drawer",
    "drawerSide": "right",
    "fields": ["name", "stage", "value", "owner", "closeDate", "notes"]
  }
}
```

`{current_user_id}` in the `my-deals` filter is the spec's context token (`CONTEXT_TOKENS` in `@objectstack/spec/data`): the `object-view` node resolves it to the signed-in user's id before the query runs (objectui#10506), through the same `resolveFilterPlaceholders` from `@object-ui/core` that the app-shell host, the charts and the dashboard widgets call, with the user taken from the nearest `FilterScopeProvider` (`@object-ui/react`; the console shell mounts one). With no provider mounted the token is left as written and the filter is never widened: the ObjectStack server resolves the literal token for a signed-in request and refuses the request otherwise (the REST face answers 401 at its auth gate before the filter is read, and where a guest context reaches the engine the resolver answers 400), and a backend with no resolver of its own matches no record.

| Property | Type | Description |
|----------|------|-------------|
| `objectName` | `string` | **Required.** ObjectQL object API name. |
| `title` | `string` | View title. |
| `defaultViewType` | `string` | Initial view: `"grid"`, `"kanban"`, `"gallery"`, `"calendar"`, `"timeline"`, `"gantt"`, `"map"`. |
| `listViews` | `Record<string, …>` | Named list views with filters and sort. Each entry is `@objectstack/spec`'s `ObjectListViewSchema`: it needs `columns`, takes `filter` as `{ field, operator, value }` rules, and puts view-kind config in the top-level block of that kind (`kanban`, `calendar`, …). A legacy `options` bag is refused. |
| `defaultListView` | `string` | Key of the default list view. |
| `table` | grid keys of [ObjectGridSchema](#objectgridschema) | The grid keys the view hands the grid it draws; any other grid key is refused (objectui#10976). The key list is in the `@object-ui/plugin-view` guide. |
| `form` | `Partial<ObjectFormSchema>` | Form configuration overrides. |
| `showSearch` / `showFilters` / `showCreate` | `boolean` | Toggle toolbar features. |
| `showViewSwitcher` | `boolean` | Show view type toggle (grid, kanban, etc.). |
| `operations` | `object` | Enabled CRUD operations. |
| `navigation` | `ViewNavigationConfig` | SPA-aware navigation. |

**Related:** [ObjectGridSchema](#objectgridschema), [ObjectFormSchema](#objectformschema), [ViewSwitcherSchema](#viewswitcherschema)

---

## Complex Schemas

### ObjectKanbanSchema

A drag-and-drop Kanban board. The `object-kanban` type key validates the shape the registered renderer (`@object-ui/plugin-kanban`) reads: bind the board to an object with `objectName` + `groupBy` — the lanes come from the group field's options — or hand it rows on `data`.

> **The bare `kanban` node type key is retired** (objectui#8802, ruled 2026-09-09). It published two faces that disagreed with each other, and `object-kanban` is now the one spelling. A `{ "type": "kanban" }` document is refused by name and told to write `object-kanban`.
>
> ⚠️ The **stored view type** `"kanban"` — what `listViews[].type` and `defaultViewType` hold — is a **different layer and is unchanged**. Do not rewrite it: a saved kanban view already renders through the `object-kanban` node type, because `ObjectView` maps the stored type onto it.

```json
{
  "type": "object-kanban",
  "objectName": "tasks",
  "groupBy": "status",
  "titleField": "title",
  "cardFields": ["assignee", "due_date"]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `objectName` | `string` | Object to fetch records from. |
| `groupBy` | `string` | Field whose values become the lanes (maps to column ids). **Optional** since objectui#8990, matching `@objectstack/spec`. A board that omits it draws whatever lanes `columns` declares — and holds **no cards**, because records are only distributed once a lane key exists. |
| `columns` | `string[] \| KanbanLane[]` | Swimlane definitions — an array of `{ id, title }` lanes (one per `groupBy` value), **or** an array of bare value strings; never a mix. **Not** a field projection (that is `cardFields`). A lane's `cards` is optional: an object-bound board buckets records into the lane by `groupBy`, and only a static board writes a lane's cards itself. A record lands in a lane when its stored `groupBy` value equals the lane **`id`** (the option value, compared case-insensitively); the lane `title` is display only and never decides membership (objectui#10069). A record matching no lane id is shown in a trailing *Uncategorized* lane and named in a console warning. |
| `titleField` | `string` | Field used as the card title. |
| `cardFields` | `string[]` | Fields rendered on each card. |
| `swimlaneField` | `string` | Record field that splits the board into horizontal swimlanes, across the `groupBy` columns. Declared on both faces since objectui#11355, with the type `@objectstack/spec`'s `object-kanban` row gives it. With the key absent the board falls back to `grouping.fields[0].field`. |
| `grouping` | `GroupingConfig` | The fallback for `swimlaneField`: with that key absent, the board splits into swimlanes by `grouping.fields[0].field`, and reads nothing else in the block. The type is `@objectstack/spec`'s `GroupingConfig` (`{ fields: [{ field, order?, collapsed? }] }`), the one the `object-kanban` row and `object-grid` take, by reference on both faces since objectui#11216: at least one entry, no undeclared key, and a `field` written without leading or trailing spaces. |
| `filter` | `any[]` | Query filter, forwarded verbatim as `$filter`. |
| `limit` | `number` | Fetch window for the board (default 100). |
| `coverImageField` | `string` | Field whose URL renders as the card cover image. |
| `conditionalFormatting` | `KanbanConditionalFormattingRule[]` | Card colouring rules, each `{ condition, style }` — a CEL `condition` over the card's `record.*` and a CSS `style` map, the rule a list view declares; the first matching rule styles the card. The native `{ field, operator, value }` rule and a colour written beside `condition` (rather than inside `style`) are retired and refused by name (objectui#11522): `{ field: 'priority', operator: 'equals', value: 'high', backgroundColor: '#fee2e2' }` is `{ condition: "record.priority == 'high'", style: { backgroundColor: '#fee2e2' } }`. |
| `navigation` | `ViewNavigationConfig` | What a card click opens — the spec's `NavigationConfig` by reference, the type `ObjectGridSchema.navigation` uses: `mode` (`page`, `drawer`, `modal`, `split`, `popover`, `new_window` or `none`) with `size`, `openNewTab` and `preventNavigation`. With the key absent a click opens the record in a drawer. `page` — and a block written without `mode`, which takes the spec's `page` default — opens the record page through the record navigator the host publishes (objectui#11293); the console publishes one on its custom pages, record pages and list views, and under a host that publishes none the click opens nothing. |

> `groupField` is refused by name (objectui#7322): the renderer reads `groupBy`.

> **`quickAdd` and `allowCollapse` were rows of the table above and are not authorable on this board.** `allowCollapse` is **refused by name** by the strict authoring face, which does not declare it at all — a document carrying it fails validation rather than merely going unread, and `@object-ui/plugin-kanban` has no read site for it. `quickAdd` is **retired** on this board (objectui#8285, director seat, decision batch 91): the Quick Add control is gated on an `onQuickAdd` handler as well, and no `object-kanban` path supplies one, so the key never drew anything, and the ruling retired it rather than add inline record creation. The strict face tombstones it (refused by name), `ObjectKanban` no longer forwards it, and `@object-ui/sdui-parser` answers it with the ordinary `unknown-prop` warning. `@object-ui/types` mirrors this face and agrees on both: each is `never` on its TypeScript face and a retirement tombstone on its Zod face (objectui#8801, objectui#8285). The Quick Add pair itself lives on the `KanbanRenderer` component, which a React host mounts directly.

> `columns` is declared on this face since objectui#8913, as the pair of array shapes `@objectstack/spec` declares — an array of `{ id, title }` lanes, **or** an array of bare value strings. A **mixed** array is refused: the renderer decides which shape it has from the first element alone, so a mix yields a blank lane and mis-bucketed cards. A lane accepts `id`, `title`, `cards`, `limit`, `className` and `collapsed`, which are the members the board implementations read; `id` is a **string** — the authored face keeps that narrowing, and since objectui#8993 a non-string lane id no longer renders every card twice: the bucketer's leftover sweep keys membership the way the injection already did (a lane `1` takes the group `'1'`). When a lane carries `cards`, each card is judged — a card with no `title` is refused. An undeclared lane key is accepted and dropped, not refused, which is this tolerant face's posture; the strict authoring face refuses it by name.
>
> ⚠️ The **bare-string array applies only to a board with no `groupBy`.** It is declared so this package does not refuse an authoring the protocol allows. The renderer reads a bare-string lane list only when a board has no `groupBy` — so on a board that *does* declare one the strings are ignored and the lanes come from the group field's picklist options or from the data. Since objectui#8990 made `groupBy` optional, a lane-less board is a valid authoring and this arm is live on it: the lanes are drawn, titled by the **raw strings** (a grouped board titles its lanes with the picklist *labels* instead). ⚠️ Such a board holds **no cards** — with no lane key the records are never distributed — and dragging a card writes nothing back. It is lane headings, not a populated board; to control the lanes of a working board, declare `groupBy` and write the `{ id, title }` array.
>
> Of the other keys the retired `kanban` arm alone declared, `cardTitle` (objectui#9606), `navigation` (objectui#8652), `swimlaneField` (objectui#11355) and `grouping` (objectui#11216) are declared on this face. `grouping` was the last of them: until objectui#11216 it was kept unjudged here and refused by name on the strict authoring face.

> **Handler keys are not authorable in JSON, and all three now say so by name.** Since objectui#7804 this face declares `onCardClick` as an objectui#6124 **runtime slot**: a React host supplies the function through the TypeScript interface or as a React prop, and this validator **refuses the key by name** with a message pointing at the node-type spelling (`{ "type": "toast", … }`, an `action:button` node). Until then an authored `onCardClick: { "action": "toast" }` parsed **green** — `BaseSchema` is `.passthrough()`, so a key no arm declares is not refused, it stops being judged and the value is kept, then reaches a call site expecting a function. ⭐ The other two keys are **tombstones**, not runtime slots, so their TypeScript twins are `?: never` rather than callable. `onCardMove` has been one since objectui#9342: an authored one reached **nothing** even as a function, because an object-bound board substitutes its own mover, and the mover lives on `KanbanRenderer`'s React prop of the same name, a sibling of its `schema`. `onQuickAdd` has been one since objectui#11234: a supplied one reached the board and was never called, because its partner `quickAdd` is retired here. `ObjectKanban` renders an internal board that takes the Quick Add pair only as explicit props and supplies neither half; the pair lives on `KanbanRenderer`'s `schema`, for a React host.

> `data` and `bind` are [`BaseSchema`](#baseschema) members, not narrowed here, but this face requires **one of** `bind`, `data`, `objectName` — the renderer's own record-source ladder (an external `data` prop → `bind` via `useDataScope` → this schema's own `data` → a fetch keyed by `objectName`) — or a `dataSource` binding whose `object` names the object, which the registration's `ElementDataSourceGate` lands on `objectName` before the board reads it (objectui#11117). A purely static board (lanes carrying their own cards, no record source) authors `"groupBy"` and `"data": []`. ⚠️ The record-source rule is **separate** from the lane key and is unaffected by objectui#8990: omitting `groupBy` is fine, omitting all of `bind` / `data` / `objectName` with no binding is still refused, at the refinement rather than at `groupBy`.

**Related:** [ObjectViewSchema](#objectviewschema), [ObjectGridSchema](#objectgridschema)

---

### DashboardComponentSchema

A widget-based dashboard with configurable grid layout and auto-refresh.

```json
{
  "type": "dashboard",
  "columns": 4,
  "gap": 6,
  "refreshIntervalSeconds": 30,
  "widgets": [
    {
      "id": "revenue",
      "type": "metric",
      "title": "Total Revenue",
      "layout": { "x": 0, "y": 0, "w": 1, "h": 2 },
      "dataset": "sales",
      "values": ["revenue"]
    },
    {
      "id": "sales_trend",
      "type": "area",
      "title": "Sales Trend",
      "layout": { "x": 1, "y": 0, "w": 2, "h": 4 },
      "dataset": "sales",
      "dimensions": ["day"],
      "values": ["revenue"]
    },
    {
      "id": "open_tasks",
      "type": "table",
      "title": "Open Tasks by Owner",
      "layout": { "x": 3, "y": 0, "w": 1, "h": 4 },
      "dataset": "tasks",
      "dimensions": ["owner"],
      "values": ["open_count"]
    }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `columns` | `number` | Number of grid columns. |
| `gap` | `number` | Gap between widgets (Tailwind spacing scale). |
| `widgets` | `(DashboardWidgetSlotComponentSchema \| DashboardWidgetSchema)[]` | **Required.** Each entry is a widget or a component node. A widget (`DashboardWidgetSchema`) names itself with `id`, `title` and `description`, sizes itself with `layout: { x, y, w, h }`, and holds its content either as a family named in `type` bound to a `dataset` (with that family's settings under `options`), or as a registered component node in `component`; its full key set is the spec's `DashboardWidget` plus objectui's own. A component node (`DashboardWidgetSlotComponentSchema`) sits in the slot directly: its `type` is a member of the closed `DASHBOARD_COMPONENT_WIDGET_TYPES` set, such as `metric-card`, its other keys are that component's own props, and it is placed by the same `layout` a widget is, which the editable grid's Save Layout writes onto every entry. |
| `refreshIntervalSeconds` | `number` | Auto-refresh interval in **seconds** — the renderer multiplies by 1000. Renamed from `refreshInterval`, which this table documented as milliseconds and which it never was (objectui#7783). |

A widget's size is its `layout`: `w` and `h` are the grid columns and rows it spans, and `x` and `y` are its position on the editable grid (`DashboardGridLayout`). `layout` takes all four numbers or is left out. `colSpan`, `rowSpan` and `body` are **not** widget keys: `DashboardWidgetSchema` is strict (objectui#6002) and refuses all three by name. The size is `layout.w` / `layout.h`, and the content is `type` + `dataset` (with `options`) or `component`.

A widget's data is a `dataset` (ADR-0021): `values` names the measures it shows and `dimensions` the dimensions it groups them by, both selected from the dataset by name. The family in `type` decides how the result is drawn: `metric` shows its one measure as a number; `table` lists a row per dimension value; a chart family (`area`, `bar`, `line`, `pie`, …) plots one series per measure over the dimension. A widget never carries rows. `options.data`, `options.xField` / `options.yField`, a metric's `options.value` / `options.description` / `options.trend`, and a `component` chart's `chartType` / `xAxisKey` / `series` are not widget keys, and `StrictAnyComponentSchema` refuses each of them by name (objectui#11228). The widget's own `description` is the subtitle under its `title` in the card header.

**Related:** [GridSchema](#gridschema), [ChartSchema](#chartschema), [CardSchema](#cardschema)

---

### CalendarViewSchema

A multi-view calendar computed from the node's `data` records. There is no
authorable `events` key: the renderer builds one event per record in `data`,
reading the fields the field-name properties point at (objectui#5667; an
authored `events` is dropped by design, objectui#4433).

```json
{
  "type": "calendar-view",
  "view": "month",
  "currentDate": "2024-03-15T12:00:00.000Z",
  "data": [
    {
      "id": "evt-1",
      "title": "Team Standup",
      "start": "2024-03-15T09:00:00",
      "end": "2024-03-15T09:30:00",
      "color": "#3b82f6"
    },
    {
      "id": "evt-2",
      "title": "Sprint Review",
      "start": "2024-03-15T14:00:00",
      "end": "2024-03-15T15:00:00",
      "color": "#8b5cf6",
      "allDay": false
    }
  ],
  "allowCreate": true,
  "className": "h-[600px] border rounded-lg"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `data` | `any` | Records rendered as events — an array, or a binding expression that resolves to one. |
| `titleField` | `string` | Record field for the event title. Default `"title"`. |
| `startDateField` | `string` | Record field for the event start date/time. Default `"start"`. |
| `endDateField` | `string` | Record field for the event end date/time. Default `"end"`. |
| `allDayField` | `string` | Record field for the all-day flag. Default `"allDay"`. |
| `colorField` | `string` | Record field for the event color. Default `"color"`. |
| `view` | `CalendarViewMode` | View mode: `"month"`, `"week"`, `"day"` — the full union. `"agenda"` was retired in `b55a34647` and now fails validation. Default `"month"`. |
| `currentDate` | `string \| Date` | Initial calendar date — an ISO date string when authored as JSON. |
| `allowCreate` | `boolean` | Show the "New event" affordance; clicking it dispatches a `create` action. Default `false`. |
| `onEventClick` | `function` | Host-only: forwarded when a React host supplies a function; authored JSON cannot produce one. |
| `onViewChange` | `function` | Host-only: same rule as `onEventClick`. |

Nine formerly declared keys — `events` (was required, and dropped by the
renderer), `defaultView`, `defaultDate`, `date`, `views`, `editable`,
`onEventCreate`, `onEventUpdate`, `onDateChange` — were retired in
objectui#5667: nothing read them on the authored-node path.

**Related:** [ObjectViewSchema](#objectviewschema), [DashboardComponentSchema](#dashboardcomponentschema)

---

## View Schemas

### DetailViewSchema

An enhanced detail view for a single record with sections, tabs and navigation.

```json
{
  "type": "detail-view",
  "title": "Contact Details",
  "objectName": "Contact",
  "resourceId": "contact-123",
  "layout": "grid",
  "columns": 2,
  "showBack": true,
  "backUrl": "/contacts",
  "showEdit": true,
  "editUrl": "/contacts/contact-123/edit",
  "showDelete": true,
  "deleteConfirmation": "Are you sure you want to delete this contact?",
  "sections": [
    {
      "title": "Personal Information",
      "icon": "User",
      "columns": 2,
      "collapsible": true,
      "fields": [
        { "name": "firstName", "label": "First Name", "type": "text" },
        { "name": "lastName", "label": "Last Name", "type": "text" },
        { "name": "email", "label": "Email", "type": "email" },
        { "name": "avatar", "label": "Photo", "type": "image" }
      ]
    }
  ],
  "tabs": [
    {
      "key": "activities",
      "label": "Activities",
      "icon": "Activity",
      "badge": 5,
      "content": { "type": "timeline", "items": [] }
    }
  ],
  "actions": [
    { "type": "action", "label": "Send Email", "icon": "Mail", "level": "primary" }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Detail page title. |
| `objectName` | `string` | ObjectQL object name for data binding. |
| `resourceId` | `string \| number` | Record ID to display. |
| `api` | `string` | API endpoint to fetch record data. |
| `data` | `any` | Static data (if not fetching from API). |
| `layout` | `"vertical" \| "horizontal" \| "grid"` | Field layout mode. |
| `columns` | `number` | Grid columns (for grid layout). |
| `sections` | `DetailViewSection[]` | Field groups with `title`, `icon`, `fields`, `collapsible`. |
| `fields` | `DetailViewField[]` | Direct fields (without sections). |
| `tabs` | `DetailViewTab[]` | Tabbed content with `key`, `label`, `icon`, `badge`, `content`. |
| `related` | ⛔ **RETIRED** | Retired in objectui#7997 (ADR-0049 enforce-or-remove). Authoring it is now refused by name on both faces. Author a `record:related_list` block instead — see below. |
| `actions` | `ActionSchema[]` | Available actions. |
| `showHeader` | `boolean` | Draw the view's own heading — the title, follow-star and copy-id chip above the fields. Drawn unless `false`. `record:details` sets it from its own `showHeader` on the `detail-view` it builds, so the type is that spec row's. Declared since objectui#11355. |
| `showBack` / `backUrl` | `boolean` / `string` | Back navigation. |
| `showEdit` / `editUrl` | `boolean` / `string` | Edit navigation. |
| `showDelete` / `deleteConfirmation` | `boolean` / `string` | Delete with confirmation message. |
| `header` / `footer` | `SchemaNode` | Custom header/footer content. |

> **Retired: `related`** (objectui#7997, ADR-0049 enforce-or-remove).
> Author a `record:related_list` block instead.
>
> Until objectui#7997 this block carried its own `related` array, and this page
> taught it with `{ "name": ..., "label": ... }` columns. That array is retired
> under ADR-0049 enforce-or-remove: it was a second entry to a capability
> `@objectstack/spec` already governs, it mirrored no protocol schema, and it
> drifted from the renderer it fed. Authoring it is now **refused by name** on
> both the TypeScript and the JSON face — it is not silently ignored.
>
> Related lists have one declared entry now, and it renders through the same component:
>
> ```json
> {
>   "type": "record:related_list",
>   "properties": {
>     "objectName": "order",
>     "relationshipField": "contact_id",
>     "title": "Recent Orders",
>     "columns": ["id", "total", "status"]
>   }
> }
> ```
>
> The block's props go in its `properties` bag, the spec's
> `ComponentPropsMap['record:related_list']` row: `objectui validate` and the
> spec's page component both refuse them written flat on the node.
>
> ⚠️ `columns` here is an array of **field-name strings**, not column objects —
> that is what the protocol declares (`RecordRelatedListProps.columns`), and the
> header and cell formatting are derived from the related object's schema, so a
> field label rename reaches the list for free. `relationshipField` names the
> field on the RELATED object that points back at this record, and replaces the
> retired form's `api` endpoint.
>
> ⚠️ The block reads the parent record from the record page's `RecordContext`,
> so author it on a record page. Placed anywhere it cannot resolve a parent id
> it scopes to nothing and renders an empty list.

> **Due/deadline fields: `dueLike` and `settledWhen`.** A deadline is declared
> on the object's field metadata, never on a field entry: `dueLike` and its
> partner `settledWhen` are `@objectstack/spec`'s `FieldSchema.dueLike` and
> `FieldSchema.settledWhen`, both for `date` / `datetime` fields only. A
> `DetailViewField` entry carries neither — the detail view reads both from the
> object field it draws. See [Date Field](/docs/fields/date) and
> [Overdue Affordance](/docs/fields/datetime#overdue-affordance).
>
> `settledWhen` is a CEL predicate over the record (`record.status == 'done'`),
> accepted only beside `dueLike: true`. The detail view evaluates it against
> the record it shows: while it holds, the deadline is settled and the cell
> paints no overdue wording or colour. Nothing is inferred from a field's
> name: an undeclared date in the past reads as any past date does.

**Related:** [DetailSchema](#detailschema), [ObjectViewSchema](#objectviewschema)

---

### ViewSwitcherSchema

A toggle control that switches between different view types (list, grid, kanban, calendar, etc.).

```json
{
  "type": "view-switcher",
  "defaultView": "list",
  "variant": "tabs",
  "position": "top",
  "persistPreference": true,
  "storageKey": "contacts-view-pref",
  "views": [
    {
      "type": "list",
      "label": "List View",
      "icon": "List",
      "schema": {
        "type": "object-grid",
        "properties": {
          "objectName": "Contact",
          "columns": ["name", "email", "phone"]
        }
      }
    },
    {
      "type": "grid",
      "label": "Card View",
      "icon": "LayoutGrid",
      "schema": {
        "type": "grid",
        "columns": 3,
        "children": []
      }
    },
    {
      "type": "kanban",
      "label": "Kanban",
      "icon": "Kanban",
      "schema": {
        "type": "object-kanban",
        "objectName": "tasks",
        "groupBy": "status"
      }
    }
  ]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `views` | `array` | **Required.** Available views, each with `type`, `label`, `icon`, and `schema`. |
| `defaultView` | `ViewType` | Initially active view: `"list"`, `"detail"`, `"grid"`, `"kanban"`, `"calendar"`, `"timeline"`, `"map"`. |
| `activeView` | `ViewType` | Controlled active view. |
| `variant` | `"tabs" \| "buttons" \| "dropdown"` | Switcher UI style. |
| `position` | `"top" \| "bottom" \| "left" \| "right"` | Switcher position relative to content. |
| `persistPreference` | `boolean` | Save the user's view preference to storage. |
| `storageKey` | `string` | Storage key for persisting the preference. |
| `onViewChange` | `string` | Event name dispatched on `window` as a `CustomEvent` when the view changes (`detail: { view }`). An event NAME, not a callback or a handler expression. |

**Related:** [ObjectViewSchema](#objectviewschema), [ObjectKanbanSchema](#objectkanbanschema), [CalendarViewSchema](#calendarviewschema)

---

## Schema Composition

Schemas are designed to compose. Nest any `SchemaNode` inside another to build complex interfaces:

```json
{
  "type": "page",
  "pageType": "app",
  "title": "CRM Dashboard",
  "children": [
    {
      "type": "grid",
      "columns": { "sm": 1, "lg": 2 },
      "gap": 6,
      "children": [
        {
          "type": "card",
          "title": "Quick Stats",
          "children": {
            "type": "dashboard",
            "columns": 2,
            "widgets": [
              { "type": "metric-card", "title": "Leads", "value": "142" },
              { "type": "metric-card", "title": "Revenue", "value": "$24k" }
            ]
          }
        },
        {
          "type": "card",
          "title": "Recent Activity",
          "children": {
            "type": "tabs",
            "items": [
              { "value": "deals", "label": "Deals", "content": { "type": "table", "columns": [], "data": [] } },
              { "value": "tasks", "label": "Tasks", "content": { "type": "table", "columns": [], "data": [] } }
            ]
          }
        }
      ]
    },
    {
      "type": "object-grid",
      "properties": {
        "objectName": "Lead",
        "title": "All Leads",
        "showSearch": true,
        "columns": ["name", "company", "status", "value"]
      }
    }
  ]
}
```

## Type Imports

Import only the types you need:

```typescript
// Layout
import type { PageNodeSchema, DivSchema, CardSchema, GridSchema, TabsSchema } from '@object-ui/types';

// Forms
import type { FormSchema, InputSchema, SelectSchema, ButtonSchema } from '@object-ui/types';

// Data Display
import type { TableSchema, ChartSchema, TreeViewSchema } from '@object-ui/types';

// CRUD
import type { ActionSchema, DetailSchema } from '@object-ui/types';

// ObjectQL
import type { ObjectGridSchema, ObjectFormSchema, ObjectViewSchema } from '@object-ui/types';

// Complex
import type { DashboardComponentSchema, CalendarViewSchema } from '@object-ui/types';

// Views
import type { DetailViewSchema, ViewSwitcherSchema } from '@object-ui/types';

// Base
import type { BaseSchema, SchemaNode } from '@object-ui/types';
```

## Next Steps

- **[Schema Overview](/docs/guide/schema-overview)** — High-level guide to ObjectUI schemas
- **[Quick Start](/docs/guide/quick-start)** — Build your first ObjectUI application
- **[Expressions](/docs/guide/expressions)** — Dynamic expressions with `visibleOn`, `disabledOn`
- **[Fields Guide](/docs/guide/fields)** — Deep dive into form fields
- **[Plugin Development](/docs/guide/plugin-development)** — Build custom schema renderers
