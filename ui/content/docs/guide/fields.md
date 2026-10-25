---
title: "Field Registry"
---

Object UI uses a **Field Registry** system to decouple the core engine from specific UI implementations of fields. This allows for rich extensibility and plugin support.

## Concept

The `@object-ui/fields` package serves as the "Universal Language" for rendering values. 

When a component like `<ObjectGrid>` needs to render a `date` field, it doesn't import a DatePicker directly. Instead, it asks the registry:

> *"Hey, give me the component responsible for rendering type 'date'."*

This architecture allows you to:
1.  **Override standard fields** (e.g. replace the native date picker with a fancy one).
2.  **Add new field types** (e.g. add a `rating` or `signature` field).
3.  **Keep bundles small** (heavy components like Code Editors are loaded only if their plugin is registered).

## Usage

### 1. Registering a Custom Field

You can register a custom renderer globally, typically at your app's entry point.

```tsx
// src/setup.tsx
import { registerFieldRenderer, type CellRendererProps } from '@object-ui/fields';

const MyRatingField = ({ value, onChange }: CellRendererProps) => {
  return (
    <div className="rating">
      {[1, 2, 3, 4, 5].map(star => (
        <span 
          key={star} 
          onClick={() => onChange?.(star)}
          style={{ color: star <= value ? 'gold' : 'grey' }}
        >
          ★
        </span>
      ))}
    </div>
  );
};

// Register it
registerFieldRenderer('rating', MyRatingField);
```

### 2. Using in Schema

Once registered, you can simply use the new type in your JSON schema.

```json
{
  "type": "form",
  "fields": [
    {
      "name": "customer_satisfaction",
      "type": "rating", 
      "label": "Satisfaction"
    }
  ]
}
```

## Standard Fields

Object UI comes with built-in support for the standard [ObjectStack Protocol](https://github.com/objectstack-ai/objectstack/tree/main/packages/spec) types:

| Type | Description |
|---|---|
| `text` | Single line text |
| `textarea` | Multi-line text |
| `number` | Numeric input |
| `currency` | Currency formatting |
| `percent` | Percentage values |
| `date` | Date picker |
| `datetime` | Date & Time picker |
| `boolean` | Checkbox / Switch |
| `select` | Dropdown |
| `lookup` | Reference to another object |
| `master_detail` | Parent-child relationship |
| `user` | Person picker — searches the `sys_user` object (a lookup specialized to users) |
| `owner` | Record owner — a `user` field, typically read-only and stamped with the current user |

## What a number field silently rewrites

`number`, `currency`, `percent` and `geolocation` render a native
`type="number"` input. The browser — not ObjectUI — decides what that box will
accept, and it rewrites some entries **before any widget code runs**. Two
different things can happen, and only one of them is announced.

### Announced: text the browser cannot read

If the box is left holding something that is not a complete number, the browser
reports `validity.badInput` and these widgets now say so: the control is marked
`aria-invalid="true"` and a message is drawn under it —

> Not saved: the text in this box is not a number. Enter a plain decimal (example: 1234.56).

The sentence follows the reader's language (objectui#8148) — it resolves through
the `fields.number.badInput` locale key, so a console running in Chinese,
Japanese or Arabic refuses in that language. The example numeral is the
widget's own (`1234` for `number`, `1234.56` for `currency`, `12.5` for
`percent`, `30.2741` / `120.1551` for the two `geolocation` boxes) and stays
verbatim in every language.

Measured in Chromium 141, typing any of `1e`, `1e-`, `1e+`, `5e`, `-`, `.`,
`+`, `-.` or `e` leaves the box **visibly displaying** what was typed while its
value reads empty. Before this was announced, the field simply stored nothing
and said nothing.

### ⚠️ NOT announced: entries the browser silently truncates

This is the important limitation, and it is deliberate rather than an oversight.

| you paste / type | the field stores |
|---|---|
| `1.2.3` | `1.23` |
| `0x10` | `10` |
| `12abc` | `12` |

**No warning is shown for these, and no widget-side check can add one.** The
browser filters the keystrokes or the pasted text as it arrives, so by the time
ObjectUI sees the field the discarded characters are already gone — there is
nothing left to detect. This is native `type="number"` behaviour; recovering it
would mean giving up the numeric keyboard on mobile and the `min`/`max`/`step`
spinner on every numeric field in the product.

⛔ **So do not read "no warning" as "the value is correct."** A warning means the
browser could not read the box at all. Silence means the browser read
*something* — which may be less than you typed. When exact input matters
(reference codes, serial numbers, anything where `1.2.3` is meaningful), declare
a `text` field, not a numeric one.

## Polymorphic pointer pairs (`referenceVia`)

A `text` field that declares `referenceVia` holds a record id of the object its
sibling column names, row by row: `sys_approval_request.record_id` points at the
record `object_name` names, and `sys_activity.source_id` at the one
`source_object` names. The record details grid resolves the pair from the row
with `resolveRecordPointer(field, row)` and draws it with the renderer
registered under `RECORD_POINTER_CARD_TYPE`. The fields package's default draws
the record id as text; the console registers a record preview card there, so a
pointer field on a record page shows the record it points at. When the card
could read that record, its title links to the record's page in the current
app, built by the same record-link builder the page's lookup values use; a
record the reader cannot read is drawn with no link, and the card never says
why. Nothing is authored for this: the `referenceVia` declaration on the field
is the whole contract. List cells are not a call site yet.

When the platform deletes the record a pointer names, it can say so on the row.
A pointer field that also declares `referenceDeletedWhen: { field, value }`
names a sibling `select` field and the option the platform writes there, as
`sys_approval_request.record_id` declares
`{ field: 'cancel_reason', value: 'record_deleted' }`. On a row holding that
option the details grid draws a tombstone in the option's own label (localized
when the console's bundle localizes it), reads nothing and links nothing. A
record the card cannot read on any other row still gets the cause-free text:
only the declaration means deleted.

## Naming a registry item by name (`position-ref`, `permission-ref`)

A `text` field that stores the **machine name** of one item of a metadata
registry — a position, a permission set — declares the matching widget, and the
record form lists that registry instead of asking for a typed name:

```json
{
  "position": {
    "type": "text",
    "label": "Position",
    "required": true,
    "maxLength": 100,
    "widget": "position-ref"
  }
}
```

| Widget | Lists | Stores |
|---|---|---|
| `position-ref` | the `position` registry (`GET /api/v1/meta/position`) | the position's `name` |
| `permission-ref` | the `permission` registry (`GET /api/v1/meta/permission`) | the permission set's `name` |

Like every `widget` value, the name is looked up as `field:<widget>`. Each item
reads as its label beside its name, and the value written is the name alone: no
label, no id. A stored name the registry does not list stays on screen, flagged
*not found*, so a renamed or removed item is visible rather than dropped.
`position-ref` leaves out the audience anchors, the spec's
`AUDIENCE_ANCHOR_POSITIONS` (`everyone`, `guest`), because the server refuses an
anchor as a grant target; a stored anchor still shows as its own option. The
list comes from the data source's `listMetadataItems(type)`. When the adapter
has none, the list is empty, or the load fails, the field is a text box that
takes the typed name; a failure is shown with its cause, and the box stays
editable.

## A widget's face on the record heading

A `text` field that declares `widget: 'recipient-picker'` or `widget: 'object-ref'` is drawn
in a list column through the read cell registered under that widget's key, which names what
the stored value references. When that field is also the object's `nameField`, the record
page heading draws the value through the same cell: a record share heads its page with the
recipient's name, not the user id it stores. Nothing is authored for this; the `widget`
declaration on the field is the whole contract.

The heading lives in `@object-ui/components`, which this package depends on and so cannot be
imported from here the other way round. `@object-ui/components` therefore owns a slot,
`setFieldReadFaceResolver` / `resolveFieldReadFace`, and this package fills it when it loads with the
lookup the list cells make. The widget's key draws the stored text until a host registers a
face under it (the console registers its own), and while it does, the heading prints the
stored value as before. So does a host that does not load `@object-ui/fields`.

## Using Renderers in Custom Components

If you are building your own custom component (like a Kanban board card), you can leverage the registry to render fields without reinventing the wheel.

```tsx
import { getCellRenderer } from '@object-ui/fields';

export const KanbanCard = ({ task }: { task: { name: string; assignee: string } }) => {
  // Get the standard renderer for a 'user' type field
  const UserRenderer = getCellRenderer('user');
  
  return (
    <div className="card">
      <h3>{task.name}</h3>
      <div className="assignee">
        <UserRenderer 
          value={task.assignee} 
          field={{ type: 'user', name: 'assignee' }} 
        />
      </div>
    </div>
  );
};
```
