---
"@objectstack/cli": patch
---

fix(cli): `resolveConfigPath` throws its two refusals so the ten `--json` faces emit their envelopes, and `os verify` gains the catch-all it never had (#15547)

Every `--json` face in this CLI declares that it answers an error path with a
payload. `resolveConfigPath()` was the one path that bypassed that declaration:
it wrote its refusal and then called `process.exit(1)` **directly**, so nothing
was thrown and the catch-all each command already carries — all of which sit
downstream of a throw — never ran. Ten published faces answered a missing config
file with an empty stdout.

Measured before this change on the published entry `packages/cli/bin/run.js`,
`NO_COLOR=1`, streams captured separately, exit read before any pipe — ten faces
(`build` · `compile` · `diff` · `i18n check` · `i18n extract` · `info` · `lint` ·
`migrate meta` · `validate` · `verify`) across both branches of the helper, 19
runs: **exit 1, stdout 0 bytes, stderr 296 B (explicit path) / 123 B
(auto-detect)** — and `JSON.parse` on that stdout throws in all 19. After: the
same 19 runs answer **exit 1 with a parseable document on stdout**, stderr
unchanged byte for byte.

The refusals now throw `ConfigRefusalError`. That is not a new contract — it is
this path being pulled back onto the one its callers had already published, so
it adds **zero** accept-set members and **zero** error codes.

Three properties hold it in place:

- **No face becomes a crash dump.** `os verify` had no `try` at all — measured,
  a throw through it produced an oclif error line and no payload where every
  sibling emitted an envelope — so it gains the catch-all its nine siblings
  already had, in this same change rather than after it.
- **The text face does not narrow.** The refusal and both hint lines are still
  written by the helper, to stderr, byte-identical: all 19 non-`--json` runs
  compare equal before and after on stdout, on stderr and on exit status. The
  catch-alls skip re-rendering the sentence a second time on stdout.
- **No error code is minted.** The thrown error carries neither `code` nor
  `httpStatus`, so `errorCodeFields()` contributes nothing and each face emits
  its own bare `{ error }`. Whether that shape is right is **#15549**'s open
  question, and this change deliberately does not answer it.

The `--json` stdout-purity instrument is widened with the fix rather than after
it: the pre-boot family's discovery moves into a shared module, the pin that
drives it now demands a document (empty stdout no longer passes) and compares
the text face's stderr as a whole string, and `json-stdout-purity.e2e.test.ts`
— whose own discovery is `bootSchemaStack`-based and cannot see a command that
fails above the kernel — reconciles against that population so neither half can
be lost silently.
