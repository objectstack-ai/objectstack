---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/objectql': minor
'@objectstack/cli': minor
'@objectstack/lint': minor
---

feat(spec): a hook declares its refusal catalogue, and its body refuses by code, answered in the caller's language

Clause-②: yes (widening)
Metadata-protocol: added

A hook can now declare `refusals`: one entry per SCREAMING_SNAKE code, each with the `message` the user reads and an optional 4xx `status` (default `400`). A sandboxed `body` then refuses by code only: it throws an error carrying a declared `code`, and the body runner answers with the entry. The message is translated through `hooks.<hook>.refusals.<CODE>.message` in the caller's locale, the code reaches the caller's error envelope, and the status is the entry's. The body's own error text and `status` are not what the caller reads.

- **Spec.** `HookSchema.refusals` (`HookRefusalSchema`: `message`, `status?`). A new `hooks` group on the translation bundle, `hooks.<hook>.refusals.<CODE>.message`, and `hookRefusalMessageKey`. `HookContext.session.locale` declares the caller's locale.
- **Undeclared codes are refused loudly.** A code the body throws literally (`{ code: 'X' }`, or `e.code = 'X'; throw e`) that the catalogue does not declare fails the save at `body.source`. Any other undeclared code, and a throw with no code, is a `500` fault at run time that names the hook and the code. This applies only to a hook that declares `refusals`; a hook without one is answered exactly as before.
- **Runtime.** The body runner resolves the throw against the catalogue and picks the translation through the `i18n` service, negotiated against the locales it holds. An error a `ctx.api` call raised that the body lets leave unchanged, a crash, and the sandbox's own faults pass through untouched. ObjectQL copies the request's locale onto the hook session.
- **CLI.** `os i18n extract` scaffolds one key per declared entry and `os i18n check` counts them, in a new `hook` coverage bucket.
- **Lint.** A translation keyed to a hook the stack does not define, or to a code its `refusals` does not declare, is reported as `translation-target-unknown`.

Nothing to do for existing hooks. To use it, declare `refusals` on a sandboxed hook and throw its codes.
