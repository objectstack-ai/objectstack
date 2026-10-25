---
title: Record Edit Modes
description: Choose between modal and full-page record forms with the editMode metadata flag.
---

# Record Edit Modes

ObjectUI's default console shell (`@object-ui/app-shell`) supports two ways
to render the create/edit form for a record:

- **Modal** (default) — the form opens in an overlay dialog above the
  current view. Best for short forms, quick edits, and contextual data
  entry.
- **Page** — the form takes over a full route. Best for long forms,
  multi-tab or wizard layouts, or anywhere you need a deep-linkable URL
  that survives a refresh and integrates with the browser back button.

Both modes use the same `<ObjectForm>` pipeline under the hood, so all
field types, sections, validations, and visibility expressions work
identically in either mode.

## Choosing a mode

Set `editMode` on the object metadata:

```jsonc
// metadata/objects/account.json
{
  "name": "account",
  "label": "Account",
  "editMode": "page",       // "modal" (default) | "page"
  "fields": {
    "name":     { "type": "text",     "label": "Name", "required": true },
    "industry": { "type": "picklist", "label": "Industry" },
    "owner":    { "type": "lookup",   "label": "Owner", "reference": "user" }
  }
}
```

Omitting `editMode` (or setting it to `"modal"`) keeps the existing
behavior — clicking **Create** or **Edit** opens the global `ModalForm`
overlay.

## URL patterns

When `editMode: "page"` is set, the console renders the form on a
dedicated route under the active app:

| Action | URL |
|--------|-----|
| Create | `/apps/:appName/:objectName/new` |
| Edit   | `/apps/:appName/:objectName/record/:recordId/edit` |

Examples (for an app `sales` and an object `account`):

- Create: `https://your-console.example/apps/sales/account/new`
- Edit:   `https://your-console.example/apps/sales/account/record/0015e000abcd/edit`

These URLs are stable. Users can bookmark them, share them in chat, or
refresh the page mid-edit (the form rehydrates from the URL `:recordId`).

## Triggering the routes from JSON

In addition to the implicit "click create/edit on a list" entry point,
two declarative actions let you open the page-mode routes from an
`action:button` in metadata. Every prop of the block lives in the node's
`properties` bag, as `@objectstack/spec` declares it. The handler name goes
in `properties.actionType`: that is the key the button renderer forwards to
the action runner as the action's type, and the runner dispatches to the
handler registered under it. Arguments are static values, and they go in
the same bag as `properties.params`:

```jsonc
{
  "type": "action:button",
  "properties": {
    "label": "New Account",
    "icon":  "plus",
    "actionType": "navigate_create",
    "params": { "objectName": "account" }
  }
}
```

`navigate_edit` additionally needs the record to open. `properties.params`
values are templates: every string inside it, at any depth, is evaluated
the same way other `properties` values are, so a button on a record page
names the record it sits on with `${record.id}`:

```jsonc
{
  "type": "action:button",
  "properties": {
    "label": "Edit",
    "icon":  "pencil",
    "actionType": "navigate_edit",
    "params": {
      "objectName": "account",
      "recordId":   "${record.id}"
    }
  }
}
```

`record` is the record the page is bound to. A template that cannot be
evaluated (on a page with no bound record, or with a misspelled root
such as `${recrod.id}`) reaches the handler as its raw `${…}` text, and
the development console reports it under `properties.params.recordId`, so
a wrong template stays visible. A misspelled field on a bound record
(`${record.idd}`) is not an error: it resolves to nothing.

⚠️ Do not write these values as a node-level `params` object. An
action's `params` has one meaning: the `ActionParam[]` list of inputs to
collect from the user before the action runs. A node-level `params`
object is ignored (a development build logs a warning naming
`properties.params`). Metadata written from an earlier version of this
guide moves the object unchanged from `params` to `properties.params`.

For a per-row **Edit** in a list, use the list view's built-in **Edit**
entry point: under `editMode: "page"` it already routes to the same URL
(see *Migrating an existing object* below).

When invoked from inside an `ObjectView`, the action context already
carries the active `objectName`, so `properties.params` may be omitted
entirely:

```jsonc
{
  "type": "action:button",
  "properties": {
    "label": "New",
    "actionType": "navigate_create"
  }
}
```

## Behavior summary

| Aspect | Modal | Page |
|--------|-------|------|
| Default | ✅ | — |
| Deep-linkable URL | ❌ | ✅ |
| Survives refresh | ❌ | ✅ |
| Back button closes form | n/a | ✅ |
| Best for | quick edits | long / multi-section forms |

## Migrating an existing object

The change is additive — existing apps continue to work unchanged. To
migrate a single object to page mode:

1. Add `"editMode": "page"` to the object metadata.
2. (Optional) Adjust the form layout — page mode pairs well with
   `formType: "tabbed"` or `formType: "wizard"` for long forms.
3. Reload the console. Existing **Create** / **Edit** entry points
   automatically route to the new pages; no UI code changes required.

## See also

- [`@object-ui/app-shell` README](https://www.objectui.org/docs/layout/app-shell)
- [`ObjectForm` API](../plugins/plugin-form.mdx)
- [Schema rendering](./schema-rendering.md)
