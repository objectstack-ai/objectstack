---
'@objectstack/spec': minor
---

`record:json` is a declared page component type — one key of the bound record drawn as indented JSON behind a required, fail-closed `requiredPermissions` gate — with a strict `ComponentPropsMap` row

Clause-②: yes

- **New `PageComponentType` member:** `record:json`, in the reserved `record` namespace. One node draws the value under one key of the bound record as indented JSON, in a panel that starts collapsed, with a copy control. Declared spec first: objectui draws it and `@objectstack/plugin-approvals` places it on the approval request page after this release.
- **Its `ComponentPropsMap` row (`RecordJsonProps`) is strict and has three keys:**
  - `field` (required) — the key to draw, in the snake_case machine-name grammar. It may be a declared field or a key the record's read route serves beside the declared fields (`payload` on a `sys_approval_request` row), so it is not checked against the object's fields: a misspelled `field` draws nothing, and no publish check reports it.
  - `label` (optional) — the collapsed panel's summary line, a string or an inline locale map.
  - `requiredPermissions` (required, at least one non-empty name) — capabilities the user must all hold. It fails CLOSED: a client that cannot resolve the user's capabilities draws nothing, and so does a user missing any of them. Presentation only — it authorises nothing, and the read route still serves the value.
- **The record blocks' own `requiredPermissions` is unchanged.** On `record:details`, `record:highlights`, `record:related_list` and `record:quick_actions` it stays optional and fail-open; the same key name on `record:json` is a separate declaration with its own describe.
- **Refusals.** Any other key in `properties` is refused by name (`component-props-unknown-key` at `os validate` / `os build` / `os lint`); a node with no `field` or no `requiredPermissions`, or with `requiredPermissions: []`, is refused at parse. Inside a page that declares `print`, the type is refused with its own reason (a collapsed panel behind a per-viewer gate).
- **Consumers.** A consumer that derives coverage from `PageComponentType.options` or `ComponentPropsMap` — a designer palette, a renderer registry — sees one more member to classify.
