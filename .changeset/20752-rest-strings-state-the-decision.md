---
'@objectstack/rest': patch
---

REST refusals, warnings and the served OpenAPI text no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

A few strings `@objectstack/rest` sends to callers and operators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `POST /data/:object/import` with a named mapping that declares a `javascript` transform: the `UNSUPPORTED_TRANSFORM` message now says the import path does not execute it (there is no server-side sandbox), so the import is refused rather than run with that transform skipped.
- `GET /openapi.json`: the built-in section's response description says the section is built from the routes this server actually mounts and that payload schemas are deliberately not invented; the request-body description says the document leaves the route-specific shape undescribed rather than invent one.
- The boot warning for a config that still sets the retired `api.requireAuth` drops its citation; it already says the key was removed and anonymous access to object data is always denied.
- `/discovery`'s `capabilities.transactionalBatch.description` cites ADR-0034 alone.

Text only: no status, error code, field, route or control flow moves. A client that matches the old message text (for example the tracker-number suffix the `UNSUPPORTED_TRANSFORM` message used to end with) needs the new spelling.
