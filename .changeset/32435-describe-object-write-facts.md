---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

fix(mcp, runtime): `describe_object` serves what a write needs — a select field's options, the default, `readonly` / `system`, and the object's validation rule messages — under the caller's view

Clause-②: yes
Metadata-protocol: none

The MCP `describe_object` tool answered each field as `{ name, type, label, required }` only, so an agent filling a select field guessed a value (often the label), was refused with `VALIDATION_FAILED`, and retried; audit columns such as `created_at` looked writable, and the object's validation rules were invisible until a write tripped one.

Each field now also carries `readonly` and `system` (always, as booleans), `options` as `{ value, label }` on a field that declares options (a picklist-bound field included, with its list's resolved options), and `defaultValue` when the field declares one. The answer gains `validations`: each ACTIVE rule's `name`, `type`, `message`, `severity`, `events` and the `fields` it names, a `conditional` rule's `then` / `otherwise` described the same way. A rule's condition, pattern or transition table is never served.

Everything is read from the object as the caller is served it, on both transports (HTTP and stdio): a field the caller cannot read is still absent, and a rule that names such a field anywhere — its fields, its condition or its message — is not described to that caller. The answer only gains keys; every key it carried before is unchanged, so a client reading the old four keys reads them as before.
