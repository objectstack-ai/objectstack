---
"@objectstack/service-settings": minor
---

refactor!: settings error bodies stop hanging undeclared keys beside `code`/`message` (#4224)

Four `/api/settings/*` error branches spread ad-hoc context as SIBLINGS of `code`
and `message` inside `error`. `ApiErrorSchema` declares `code`, `message`,
`category?`, `httpStatus?`, `details?`, `requestId?` — and none of `namespace`,
`key`, `reason`, `fields`. The bodies passed every gate anyway: `ApiErrorSchema`
is a plain `z.object`, so unknown keys were **stripped** rather than rejected,
and `envelopeViolations` inspects only the body's top level. They were conformant
*by stripping*, not by declaration. The same module already used the declared
slot correctly one branch over (`SETTINGS_ACTION_FAILED` → `error.details`), so
this is one file speaking two dialects, not a missing capability.

**Wire change — FROM → TO.** In every case the values are unchanged; only their
position moves, into the `details` slot the contract declares:

| Code | HTTP | FROM | TO |
|---|---|---|---|
| `SETTINGS_FORBIDDEN` | 403 | `error.namespace` | `error.details.namespace` |
| `UNKNOWN_KEY` | 400 | `error.namespace`, `error.key` | `error.details.namespace`, `error.details.key` |
| `SETTINGS_LOCKED` | 409 | `error.namespace`, `error.key`, `error.reason` | `error.details.namespace`, `error.details.key`, `error.details.reason` |
| `SETTINGS_VALIDATION` | 400 | `error.namespace`, `error.fields` | `error.details.namespace`, `error.details.fields` |

**One-line fix for a consumer:** read `error.details.<key>` where you read
`error.<key>`, or `error.details?.<key> ?? error.<key>` if you support servers on
both sides of the change. The console's own fix (objectui#3078) is the tolerant
form.

**`SETTINGS_VALIDATION.fields` also changes shape**, because `fields` is the name
ADR-0114 (#3977) closed for `FieldError[]` and keeping a map under it would leave
one spelling meaning two shapes:

- **FROM** `{ [key]: message }` — a `Record<string, string>`, the constraint named
  only in the prose of the message.
- **TO** `FieldError[]` — `{ field, code, message, label, constraint? }`, where
  `code` is a member of the closed field-level catalog: `required` for an empty
  required specifier, `invalid_format` for a value that misses its declared
  `pattern` (which travels as `constraint.pattern`).

A consumer that rendered the map's values reads `f.message` per entry instead;
one that wants to branch on *why* a value was rejected can now read `f.code`
rather than substring-matching English. objectui's `extractFieldErrors` already
reads `details.fields`, so settings validation failures become renderable
per-field there with no further change.

**The exported `SettingsValidationError.fields` changes with it** — same
`Record<string, string>` → `FieldError[]` mapping — since the route only relays
what the service throws, and the constraint kind is knowable at the throw site
and nowhere after it.

`sendError`'s last parameter is tightened from `extra?: Record<string, unknown>`
to `ApiError`'s own optional fields, and its `code` from `string` to the closed
ADR-0112 `ErrorCode` union. That is what keeps this fixed: an undeclared sibling
is now a compile error at the call site rather than a key that quietly evaporates
at the schema boundary.
