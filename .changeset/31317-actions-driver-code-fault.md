---
'@objectstack/types': patch
---

fix(types): `POST /api/v1/actions` answers a driver error carrying a string code the way `/api/v1/data` does, as a server fault

Clause-②: no (a status and code correction on an error answer: a driver fault inside an action body moves from a 400 refusal to the 5xx fault `/data` already answers; no accepted input and no success shape changes)
Metadata-protocol: none

An action body that hit a driver error carrying its own string code (`SQLITE_BUSY`, `ECONNREFUSED`, `57P01`) and no HTTP status was answered by `POST /api/v1/actions/:object/:action` as a client refusal: `400 VALIDATION_ERROR`, the driver's text as the message, and the driver's code in `declaredCode`. `/api/v1/data` answers the same throw as a server fault. The MCP `run_action` and `resume_run` tools answer what `/actions` answers, so they moved with it.

| The action threw | `/actions` answered | `/actions` and `/data` now answer |
| --- | --- | --- |
| `{ code: 'SQLITE_BUSY', message: 'SQLITE_BUSY: database is locked' }` | `400`, `VALIDATION_ERROR`, the driver text, `declaredCode: 'SQLITE_BUSY'` | `500`, `DATABASE_ERROR`, `Internal data error` |
| `{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' }` | `400`, `VALIDATION_ERROR`, the driver text, `declaredCode: 'ECONNREFUSED'` | `500`, `INTERNAL_ERROR`, `Internal server error` |

The driver's code and text are logged on the server instead, as a `driver fault` line.

- **Which throws move.** A throw that declared no status and whose `code` is not a closed ADR-0112 code, and only when the `/data` door's classifier (`mapDataError`) answers it as a server fault. `actionsDoorAnswerOf` (`@objectstack/types`) asks that classifier for this case; it holds no copy of its reading.
- **Unchanged.** A closed code with no status (`RECORD_LOCKED`, `PERMISSION_DENIED`) is still the `400` refusal with that code. A bare `Error` is still `400 VALIDATION_ERROR` with its own sentence. A throw that declared its status keeps it, and an unregistered code beside it still rides `declaredCode`. A sandboxed action body's coded refusal (`code: 'CREDIT_LIMIT'` with no status) is still the `400` refusal with `declaredCode`, which is what `/data` answers for it.
- **Stated cost.** An in-process action handler that throws its own unregistered code with no status, which `/data` also answers as a fault, now gets the fault answer here too and loses the code (the 2026-08-27 ruling on #12509: the discriminator is the status channel). It keeps its code by declaring the status it means.

This supersedes the line in the `31271` changeset that says a driver string code answers `400 VALIDATION_ERROR` with `declaredCode` at `/actions` and that the difference from `/data` is not changed.
