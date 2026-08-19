---
"@objectstack/spec": minor
"@objectstack/types": minor
"@objectstack/runtime": patch
"@objectstack/rest": patch
"@objectstack/client": patch
---

feat(contract): a hook refusal can mark its message user-facing — `userMessage`, the producer-side opt-in channel (#9934, producer half of objectui#5210)

<!-- adr-0087: not-required (no-migration-prescription) Purely additive: one
new OPTIONAL field on the two error-envelope schemas, a new shared reader in
@objectstack/types, and passthrough plumbing at the boundaries. Nothing
authorable is renamed, retired, aliased or tombstoned, so there is no
conversion to register. Unmarked errors produce byte-identical wire bodies. -->

The console form deliberately discards the server `message` on 403 and
substitutes a generic string — the recorded #3821 fix for platform diagnostics
leaking to end users. That substitution also suppressed every deliberate,
localized refusal an application hook author wrote (11 real hook guards in the
objectui#5210 report), and incentivized misusing 400 for permission refusals.
The maintainer-accepted ruling (2026-08-19, option 1): give the AUTHOR a
producer-side way to mark a refusal message user-facing, once, at the contract
level — status-agnostic, with #3821 preserved by construction for everything
unmarked.

**The marking**: set `userMessage` (non-empty string) on the thrown error at
throw time. It is a text-carrying field, not a boolean beside `message` — the
mark and the marked text are one value, so no boundary that rewraps or
substitutes `message` can promote platform prose into the marked channel, and
platform/driver code never sets it.

- `@objectstack/spec`: `ApiErrorSchema.userMessage` and
  `EnhancedApiErrorSchema.userMessage` (optional, additive).
- `@objectstack/types`: `declaredUserMessage(error)` — the ONE "is this
  marked?" read (non-empty string, nothing invented) — and
  `ThrownHttpError.userMessage` on `resolveThrownHttpError`.
- `@objectstack/rest`: `mapDataError` / `resolveErrorResponse` ride a declared
  marking onto whatever envelope classification chose (flat body top-level
  `userMessage`, truncated at the same #5423 bound as the 4xx message).
- `@objectstack/runtime`: the QuickJS side-channel carries `userMessage`
  across the sandbox boundary (both directions, joining `code`/`fields`/
  `status`), and the dispatcher door emits it as a declared sibling in the
  nested envelope.
- `@objectstack/client`: the SDK attaches `err.userMessage` from both wire
  dialects, so a UI renders it verbatim when present and keeps its generic
  substitution when absent.

The consumer half — the console form rendering a marked message instead of the
generic `form.noPermissionToSave` — is objectui#5210.
