---
'@objectstack/mcp': patch
---

fix(mcp): the record data tools and the record resource answer a driver's own error code (`SQLITE_BUSY`) as `/api/v1/data` does, a sanitised server fault, never the driver's text

Clause-②: no
Metadata-protocol: none

A database driver's error carries its own code on `.code` (`SQLITE_BUSY`, `ECONNRESET`, Postgres `40P01`) and no HTTP status. `query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `delete_records`' selection read and the `objectstack://objects/{name}/records/{id}` resource read any thrown `code` as a coded refusal, so an agent got `{ "code": "SQLITE_BUSY", "message": "SQLITE_BUSY: database is locked" }` with no status. `/api/v1/data` answers the same throw `500 DATABASE_ERROR` `Internal data error` and logs the driver's text.

These faces now answer such a throw with the `/data` door's answer, read through that door's own classifier (`mapDataError`, `@objectstack/types`):

- `SQLITE_BUSY`: `{ "code": "DATABASE_ERROR", "message": "Internal data error", "status": 500 }` on the tools, `{ "error": "Internal data error", "code": "DATABASE_ERROR", "status": 500 }` on the resource;
- a driver code whose text names no store (`ECONNRESET`): `500 INTERNAL_ERROR` `Internal server error`.

The driver's code and text are logged once on the server as a `[5xx]` line instead of being sent.

The rule is the door's: a thrown code that declared no HTTP status, and that the door answers as a server fault, is a fault, not a refusal. So a code thrown with no status that the door does not recognise as a refusal (for example `RECORD_LOCKED` with no `status`) now answers the door's `500 INTERNAL_ERROR` here too; declare the status you mean to keep the code. A code thrown with its status (`RECORD_LOCKED` / 409, `SERVICE_UNAVAILABLE` / 503), a code the door answers as a refusal without one (`PERMISSION_DENIED`), and a sandboxed hook's coded refusal are answered as before. `run_action`, `resume_run` and the metadata tools are not changed.
