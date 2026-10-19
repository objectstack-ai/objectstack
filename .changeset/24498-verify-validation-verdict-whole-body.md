---
'@objectstack/verify': patch
---

fix(verify): the CRUD stage reads a refused create's whole answer before it calls the create a hard failure

Clause-②: no

- **A long validation message is `needs-fixture` again.** The stage used to cut a refused create's body to 280 characters and then look for the validation code in that cut. The `/data` door answers a validation refusal as `{ error, code, fields, object }`, with the app-authored message first, so a message long enough pushed `"code":"VALIDATION_FAILED"` past the cut. The object was then reported `create-failed`, a hard failure that makes `os verify` exit 1, although the app's own rule had refused the auto-derived record.
- **The verdict reads the whole body.** When the body is JSON, the stage reads the envelope's `code`: `VALIDATION_FAILED` on a 400 is `needs-fixture`. A body that is not JSON, or has no string `code`, is matched against the full text with the stage's original pattern.
- **Unchanged:** the stored `detail` still holds at most 280 characters, and the rule is the same: a 400 validation answer is `needs-fixture`, and anything else is `create-failed`.

A patch: the stage reads the same answer correctly. No export, accepted value or published shape changes.
