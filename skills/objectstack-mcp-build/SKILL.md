---
name: objectstack-mcp-build
description: >
  Build or change an ObjectStack app's metadata through its MCP draft door
  (list_metadata_items, get_metadata_item, save_metadata_draft, list_drafts,
  delete_metadata_draft), with no project files: read what exists, load the
  type's domain skill, save a draft, read the publish verdict the save answers,
  repair it, and hand the Studio review route to a person. Use when connected
  to an environment over MCP and asked to add or change an object, field, view,
  page, dashboard, flow, action or permission there, before the first save
  ("build an app", "add a field", "建一个应用", "加个字段", "做个审批流"). Do not
  use for metadata written in a project's files (the domain skills cover
  that) or to answer a question from the app's records (objectstack-ask).
license: Apache-2.0
compatibility: Requires an environment whose @objectstack/runtime 18.x serves the MCP draft door (none through 18.6.0 does), on a connection granted metadata:write
metadata:
  author: objectstack-ai
  version: "18.6.0"
  domain: process
  tags: mcp, build, draft, save_metadata_draft, verdict, studio, no-project, 草稿
---

# Building an ObjectStack app through the MCP draft door

This door saves drafts only: it has no publish tool, and a person reviews and
publishes them in Studio. This skill is the order of work. Each type's keys,
values and traps stay in its domain skill, and each tool's own description is
the authority on its arguments and its reply.

## 1. Check the door

- The tools are `list_metadata_items`, `get_metadata_item`, `list_drafts`,
  `save_metadata_draft` and `delete_metadata_draft`. A connection lists them
  only with the `metadata:write` scope, for a user who may manage metadata.
- Not listed: say you cannot author here and stop.
- Refused `PERMISSION_DENIED`: relay its message and stop what it refuses,
  the door or one type or item. Never write records instead.

## 2. Read what exists

- `list_metadata_items` for each type you will write, then `get_metadata_item`
  for every item you will change or name (an object before a view or flow on
  it). `describe_object` reads an object's fields where the connection lists it.
- Change an item by reading it whole, editing that, and saving the whole item.
  Reuse the names that exist, their namespace prefix included; never guess one.
- A save names a package. An item you change stays in the one its list entry
  names. For a new item with none named, a save without one is refused with
  the writable packages listed: use the only one, or ask which of several.

## 3. Load the type's domain skill

Load the type's domain skill before you write it: its text is your contract.
Follow its `node_modules` pointers where you can read files. Else read the
lean contract (`contract: true`), drill into your key with `contractPath`,
and let the save check you. Write only keys these show.

| You write | Skill |
|:--|:--|
| An object, field, validation, permission set or seed | objectstack-data |
| A view, app, page, dashboard, report, dataset or action | objectstack-ui |
| A flow, approval, job or webhook | objectstack-automation |
| An agent skill, tool or knowledge source | objectstack-ai |
| A translation | objectstack-i18n |
| Any expression: a formula, condition or filter | objectstack-formula |

An item is JSON: the literal a TypeScript project passes to its `define…`
helper.

## 4. Save, then read the verdict

- `save_metadata_draft`, one item a call, an object before what reads it.
- A refused save saved nothing: fix what its `error` names and save again.
- An accepted save parsed, and its reply says what a publish would answer:

| The reply shows | What you do |
|:--|:--|
| `verdict.refusals` not empty | A publish would refuse the draft. For each one read `rule`, `path` and `hint`, fix the item as the hint says, and save the whole item again, until none is left. |
| `verdict.publishable: true` | The item is done. Tell the user what `verdict.advisories` say. |
| `verdict: null` | The draft is saved and not judged; `verdictWithheld` or `verdictError` says why. Say so, and do not call it publishable. |

- Never clear a refusal by dropping what the user asked for. Where the hint
  leaves a choice only the user can make, ask.
- `list_drafts` before you report: every pending draft in the environment,
  each with its verdict. Not all are yours. `delete_metadata_draft` discards
  a draft, never a published item.

## 5. Hand over to a person

- Nothing you saved is live. Never say an item is published, live or in use,
  and never look for another way to publish.
- Report each draft you saved: its type, name and package, whether its
  verdict is publishable, and any refusal you could not repair.
- Give the save reply's `review` routes as written (`changes` for the package,
  `item` for one draft): Console routes where a person reviews and publishes.
