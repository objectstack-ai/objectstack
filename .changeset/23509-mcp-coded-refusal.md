---
'@objectstack/mcp': minor
---

fix(mcp): the data tools, `list_actions` and the record resource answer a coded refusal with its `code` (and `status`) beside the message, on stdio and Streamable HTTP alike (#23509)

Clause-②: yes (widening)

**What was wrong.** When a producer refused with an ADR-0112 envelope (`code`, `status`, the message), these surfaces handed an MCP client the message alone. The code is the half a client branches on. The refusals affected:

- a key whose owner is held: `MFA_REQUIRED` / 403, refused "with the same code" at every seam;
- `RECORD_NOT_FOUND` / 404;
- the exposure refusals `OBJECT_API_DISABLED` / 404 and `OBJECT_API_METHOD_NOT_ALLOWED` / 405;
- the permission and validation codes.

`run_action` and `resume_run` already rendered the code. The other tools did not, and neither did the record resource.

**What a client reads now.** The tools render through the shape `run_action` already answers with. The record resource adds the code beside its unchanged `error` sentence, in the `{ error, code, status }` vocabulary the sibling resources `objectstack://objects` and `objectstack://objects/{objectName}` already use. A refusal's message is unchanged on both.

## FROM → TO

| surface | refusal | FROM | TO |
|:--|:--|:--|:--|
| tools `list_objects`, `describe_object`, `validate_expression`, `query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `list_actions` | coded | `isError: true`; the text is the message | `isError: true`; the text is the JSON `{ "error": { "code", "message", "status", "details" } }`. `status` and `details` appear only when the refusal carries them. |
| resource `objectstack://objects/{objectName}/records/{recordId}` (stdio) | coded | `{ "error": MESSAGE }` | `{ "error": MESSAGE, "code", "status", "details" }`. `status` and `details` appear only when the refusal carries them. `error` stays the same string. |
| either | no code (a plain `Error`, a thrown string, an empty or non-string `code`) | the message | unchanged, byte-identical |

**Reading it.** For a tool error, parse the text. If it is an object with `error.code`, branch on the code and show `error.message`. Otherwise the text is the message. For the record resource, `typeof body.error === 'string'` still tells a refusal from a row, and `body.code` is present when the refusal carried one.
