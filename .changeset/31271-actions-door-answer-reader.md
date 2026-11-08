---
'@objectstack/types': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(mcp): `run_action` and `resume_run` answer a thrown error the way `POST /api/v1/actions` does, through that door's one reader

Clause-②: yes (widening)
Metadata-protocol: none

MCP `run_action` and `resume_run` answered an error thrown while running an action differently from `POST /api/v1/actions/:object/:action`, which runs the same action:

| The action threw | MCP answered | `/actions` answers, and MCP now answers |
| --- | --- | --- |
| A sandboxed body's own `throw new Error('Not enough leave')` | the runner's wrapper as bare text, naming the body: `action 'NAME' threw: Error: Not enough leave` | `400`, `HOOK_ABORTED`, `Not enough leave` |
| A plain `Error` | its bare text, no code | `400`, `VALIDATION_ERROR`, its own sentence |
| A driver error with a string code (`SQLITE_BUSY`) | `{ code: 'SQLITE_BUSY', message }`, no status | `400`, `VALIDATION_ERROR`, `declaredCode: 'SQLITE_BUSY'` |
| A sandboxed body that crashed (`TypeError`), with or without a declared code | the wrapper with the native error text | `500`, `INTERNAL_ERROR`, `Internal server error` |

The tool error is `{ "error": { "code", "message", "status" } }` with `isError`, plus `declaredCode` and `userMessage` when the door serves them. The full wrapper and the fault line are logged on the server, as the door logs them. A coded refusal (a body that throws `{ code: 'RECORD_LOCKED', status: 409 }`) keeps its code, its own sentence and its status; the confirmation gate's `details` and the `PERMISSION_DENIED` withhold are unchanged. This supersedes the line in the `31218` changeset that says `run_action` and `resume_run` are unchanged.

A driver string code answers what `/actions` answers. `/api/v1/data` answers the same throw `500 DATABASE_ERROR`; that difference between the two REST doors is not changed here.

**New export (`@objectstack/types`): `actionsDoorAnswerOf(err, objectName?)` and its `ActionsDoorAnswer` type**, the `/api/v1/actions` door's answer to a thrown value, beside `mapDataError` (the `/api/v1/data` door's). The `/actions` door (`@objectstack/runtime`) now answers through it; its responses are unchanged byte for byte.
