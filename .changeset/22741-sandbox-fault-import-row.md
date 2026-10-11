---
'@objectstack/core': patch
'@objectstack/types': patch
---

An import row for the sandbox's own fault reads the create door's fault sentence, not the runner's diagnostic text (#22741)

The QuickJS runner raises some `SandboxError`s itself: a hook or action body that runs past its CPU budget or past the wall-clock ceiling, calls a capability it was not granted, or meets a failed install or marshal. These carry no `innerMessage`. `POST /api/v1/data/:object` and `/createMany` answer them `500 INTERNAL_ERROR` `Internal server error`. The sync `/import` row and the `/import/jobs` stored row answered the runner's text instead, for example `hook 'guard' exceeded CPU budget of 50ms (after 3 pump iterations)`.

- **`@objectstack/types`** exports `isSandboxOwnFault(error)`. It is `true` for an error whose `name` is `'SandboxError'` and whose `innerMessage` is not a non-empty string, which is how the runner marks the faults it raises itself. A body's refusal or crash carries `innerMessage` and answers `false`.
- **`@objectstack/core`**'s import row applies the rule a crashed body already gets: when the sandbox raised the error and the create door answers it with a 5xx, the row's `error` is the door's sentence. The row's `code` is unchanged (`IMPORT_ROW_FAILED`). A driver error, and an error a code-defined hook threw, keep the row text they had.
