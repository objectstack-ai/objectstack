---
'@objectstack/spec': patch
---

The liveness ledger's `form.sharing` and `formViews` rows quote the code that reads their keys as it now reads

Clause-②: no (only the two rows' evidence text changes and both statuses stay `live`: `ViewSchema` accepts `form.sharing` and `formViews` exactly as before, and no state count moves)

- `liveness/view.json`, row `form.sharing`: the evidence quoted a `slugMatchesPublicLink(sharing.publicLink, slug)` call that no longer exists. It now cites `packages/rest/src/form-routes.ts#findPublicFormView`, which loops over `anonymousFormIntakeCandidates(view)`, and the two rules in `packages/spec/src/ui/anonymous-form-intake.ts` it reads: `anonymousFormIntakeCandidates`, which hands each form's `sharing` to the slug rule, and `anonymousFormIntakeSlug`, which reads all three keys (`enabled`, `allowAnonymous` and `publicLink`). The `resolveFormBySlug` clause now says where `publicFormGrant` is set: in the submit door, for the match that `resolveFormBySlug` returns.
- `liveness/view.json`, row `formViews`: the evidence quoted `const formViews = view.formViews`, which no longer exists. It now quotes the line of `anonymousFormIntakeCandidates` that makes every `formViews` entry a candidate.
- The verdicts, the notes and every other row are unchanged.
