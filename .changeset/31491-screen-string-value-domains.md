---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a screen-flow resume refuses a non-string value for a text-like field before the pause is consumed (#31491)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped, and no flow an author wrote is refused. What moves is the answer a screen-flow resume gets when it sends a non-string for a text-like field, and nothing at rest holds that answer, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the screen-flow resume door (ruling A+).

- **Before.** A `type: 'text'`, `'textarea'`, `'email'`, `'url'` or `'phone'` screen field took any JSON value on resume, and the run consumed its suspension on it. An object then failed the run at the record write downstream, with no pause left: a corrected resume answered `RUN_NOT_FOUND`. A number was stored as the text it prints, a value the caller never sent.
- **Now.** The five kinds are one value domain, a JSON string. A present object, number, boolean or array is refused with `invalid_type` ("must be a string") inside `400 INVALID_SCREEN_INPUT` before the suspension is consumed, so the run stays paused and a corrected resume completes it. A value is not coerced: `42` is not read as `"42"`.
- **Unchanged.** An absent value, `null`, the empty string and a hidden field are not judged, and a missing required field is still refused as missing. Only the shape is checked: the format of an email, URL or phone number is not, and any other refusal of a string downstream keeps the operator restore as its exit. Untyped fields and the other kinds are not affected.
- **Headless callers.** An MCP `run_action` caller that supplies a non-string for one of these fields has not answered the screen, so the screen stays interactive, as it already does for a non-number on a numeric field.
- **For a caller that skips the console.** The resume bag carries a JSON string for these fields; the refusal names the field and says it must be a string.
- **Two console paths now stop at Submit.** The console posts what the screen serves it, so two authored shapes now get the 400 at Submit, with the run still paused: a text-kind field whose `options[].value` is a number or a boolean, when the user picks that option; and a text-kind field whose served `defaultValue` resolves to a non-string, when the user submits it unedited. The author fixes the screen (string option values, a string default) or types the field to match its values. No stored metadata changes, so there is nothing for `objectstack migrate meta` to rewrite.
