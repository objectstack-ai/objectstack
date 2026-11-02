---
'@object-ui/console': patch
---

fix(console): a refused form submit says a localized sentence, never the server's response body

Clause-②: no
Metadata-protocol: none

The Console form page (`/forms/NAME`, the in-app form and the public `/f/SLUG`) drew a refused write as the verb, the status and the raw response body, so a member without create rights read `Create failed (403): {"error":…,"code":"PERMISSION_DENIED","object":…}` in English on the banner and the toast. The page now reads the refusal the way the record dialog does, and the banner and the toast say the same sentence:

- a sentence the producer marked for the end user (`userMessage`), or a delegated administrator's scope refusal, as written;
- any other denial (`403`, `PERMISSION_DENIED`, `FORBIDDEN`) as the localized "You don't have permission to save this record.";
- the per-rule lines no input carries, one per line, as before;
- the server's own sentence for any other `4xx`, read out of the envelope (`error`, or the wrapped `error.message`), never the body itself;
- a `5xx`, or a refusal with no sentence (a proxy's markup page), as the localized "Could not save. Please try again."

The fields a refusal names are still marked under their inputs. No i18n key is added: both lines are the existing `form.noPermissionToSave` and `form.submitFailed`, present in all ten packs.
