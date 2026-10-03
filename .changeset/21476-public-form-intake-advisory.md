---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

Public forms on a walled tenancy posture: saving or publishing a view whose public form cannot take anonymous intake now tells the author why, on the response.

Clause-②: yes (widening)

On a walled posture (`group` or `isolated` in force), an open public form whose object is walled by an organization column cannot take an anonymous submission: the submission carries no organization, and an insert without one into a walled object is refused. The two anonymous form endpoints already answer such a form as a withdrawn one (`404 FORM_NOT_FOUND`), and the administrator's read of the view (`GET /meta/view/:name`) already states why in `_diagnostics.warnings`.

- **`@objectstack/metadata-protocol`**: saving the view (`PUT /meta/view/:name`) or publishing its draft (`POST /meta/view/:name/publish`, and a package's batch publish) now answers success with one `warning` advisory per such form, under `advisories`, with rule `public-form-intake-unavailable`. It is located at the form's `sharing` (for example `views[0].formViews.contact.sharing`), its `message` is the same text the administrator's read states, and its `hint` is the remedy: if the object's rows belong to no organization, declare `tenancy: { enabled: false }` on it. The write is never refused. The advisory reads the posture in force from the `tenancy` service, which is what the anonymous endpoints read: a single-posture deployment, a deployment whose walled posture is degraded to `single`, a deployment with no tenancy service, and a form bound to a tenancy-disabled object get no advisory, and a draft save is not judged. The publish refusal for an unstamped platform schedule flow still reads the requested posture, as before.
- **`@objectstack/metadata-core`**: the intake-availability rule moved here from `@objectstack/rest` and is exported, so the anonymous endpoints, the administrator's read and the publish advisory read one answer: `anonymousFormIntakeUnavailability(object, posture, readObjectSchema)` (`null` when the form can take intake, otherwise the object, the posture and the wall column; it judges the object's effective schema, with the injected `organization_id`), `anonymousFormIntakePosture(tenancy)` (the posture in force, as a tenancy service reports it), `anonymousFormIntakeUnavailableMessage` and `anonymousFormIntakeUnavailableRemedy` (the reason and its remedy), `anonymousFormSharingPath` and `anonymousFormObjectName`, and the type `AnonymousFormIntakeUnavailable`.
- **`@objectstack/rest`**: the anonymous form endpoints and the administrator's read import that rule instead of holding their own copy. Their answers are unchanged.
