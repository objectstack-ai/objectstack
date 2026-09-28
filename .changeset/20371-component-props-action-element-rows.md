---
"@objectstack/spec": minor
---

`ComponentPropsMap` declares `action:button`, `action:group`, `action:menu`, `action:icon`, `element:definition-list` and `element:repeater` — six blocks in objectui's curated public vocabulary that had no row (#20371). Each row is strict from birth, with its key set measured from the objectui renderer's own read points at the `.objectui-sha` pin, not transcribed from objectui's `UIActionSchema`, the registrations' `inputs`, or this package's object-metadata `ActionSchema`.

Clause-②: yes

Six new declared rows on a published surface, and two types the `element:` vocabulary now answers for, so the accept set a consumer writes against grows. Nothing previously accepted by a declared row is refused and nothing is retired.

What changes at the authoring doors (`os validate` / `os build` / `os lint`):

- **`element:definition-list` and `element:repeater` are no longer refused as `component-type-unknown`.** Both sit inside the reserved `element:` namespace; with no enum member and no row, the vocabulary refused them although objectui registers, publishes and offers both in the Studio page designer. They join the `element:` vocabulary through their rows (no enum member), and a typo inside the namespace (`element:repeatr`) is still refused.
- **The props gate now judges all six.** The four `action:*` types sat outside every reserved namespace, so an authored `properties` bag on them was skipped — a misspelled key parsed, stored and did nothing. Findings stay at the gate's existing warning tier.

Measured decisions worth knowing when you author these blocks:

- **`action:button` / `action:icon`** — `name` is optional (the renderer reads `name ?? label`). The executor is `actionType`; `type` inside `properties` is refused with a rename to `actionType` (on a page component `type` is the component itself). `visible` / `disabled` take a boolean, a CEL string or a `{ dialect, source }` envelope. The legacy `enabled` fallback and the host-only `autoTrigger` flag are refused with a prescription. `action:icon` reads no `size`. `objectName` names the object the action acts on (forwarded to the runner; omitted, the action acts on the page's object).
- **`action:group` / `action:menu`** — `actions` is a LIST of action objects (a member's executor is its own `type`); a bare list of action names is refused. A member's `objectName` rides the member object; the containers themselves read no `objectName`. `action:group` reads no group-level `name`, so it is refused with a prescription. `variant` / `size` take the Button primitive's vocabulary; `primary` and `md` are accepted only on `action:button` (and `primary` on `action:icon`), where the renderer maps them.
- **`element:definition-list`** — `items` of strict `{ term, description? }`; `columns` is the NUMBER `1` or `2` (the string `'2'` renders one column and is refused).
- **`element:repeater`** — `object` is required; `filter` / `sort` take the family's one orthography (`ViewFilterRule[]`, `SortItem[]`); `fields` takes a field name or `{ field }` (an unrendered `label` is refused).
