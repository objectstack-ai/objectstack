---
'@objectstack/spec': patch
---

The protocol 16 → 17 conversion summaries, the `autonumberFormat` description and two metadata route descriptions no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

A conversion's `summary` is the line an author reads when upgrading metadata: it is the "Change" column of `docs/protocol-upgrade-guide.md`'s protocol 16 → 17 table, the `to` text of `spec-changes.json`'s `converted[]` records, and what `os migrate meta --json` reports under `specChanges`. Fifty-six of the protocol-17 summaries pointed at an issue-tracker number for the reason behind a rewrite. The number goes; where the sentence did not already say what was decided, it now does. For example:

- `action-execute-to-target` says the spec and the renderer had resolved `execute` / `target` in opposite directions, so one key now names the handler.
- `stack-api-require-auth-removed` names the declarations that replaced the deployment-wide opt-out: a public form, a share link or `book.audience: 'public'`.
- `retry-policy-converged` says why the merged default is 0 / 1: retry is opt-in, because a retry replays whatever the attempt already did.
- The flow-node alias entries say each one was an undeclared executor fallback that graduates into the conversion layer.

The same goes for `FieldSchema.autonumberFormat`'s description (the `{0000}` default is a contract default every driver and the engine fallback read) and the descriptions of `GET /meta/:type/:name/layers` and `POST /meta/:type/:name/publish`.

Text only: no conversion's id, surface, protocol step, transform or order changes, and no schema key, shape or default moves. A tool or test that matches the old summary text (for example a tracker-number suffix) needs the new spelling. The protocol 17 → 18 summaries are a later change.
