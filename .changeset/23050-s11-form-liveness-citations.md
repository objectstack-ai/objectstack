---
'@objectstack/spec': patch
---

The liveness ledger's three public-form rows cite the code that reads their keys where it now lives

Clause-②: no (only the rows' evidence paths move and every status stays `live`: `ViewSchema` accepts `form.sections`, `form.sharing` and `formViews` exactly as before, and no state count moves)

- `liveness/view.json`: the `form.sections` and `form.sharing` rows cited `packages/rest/src/rest-server.ts` for the two public form doors, `GET /forms/:slug` and `POST /forms/:slug/submit`. `@objectstack/rest` moved the body of the registrar that mounts them, `RestServer#registerFormEndpoints`, to `packages/rest/src/form-routes.ts` with no behaviour change, so their three path references follow it.
- `liveness/view.json`: the `formViews` row cited the doors' `findPublicFormView`, which moved with that body and reaches every form view through `anonymousFormIntakeCandidates`. The row now cites that rule where it is declared, `packages/spec/src/ui/anonymous-form-intake.ts#anonymousFormIntakeCandidates`, the code on the read path that names `formViews`.
- The quoted code, the verdicts and the notes are unchanged.
