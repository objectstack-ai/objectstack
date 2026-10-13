---
'@objectstack/spec': minor
'@objectstack/metadata-core': patch
---

`@objectstack/spec/ui` now exports the rule that decides which forms a `view` body opens to anonymous intake, so a console reads "published" from the same rule the server's anonymous form doors serve

Clause-②: yes (widening)

- **New on `@objectstack/spec/ui`:** `publicFormSlug`, `anonymousFormIntakeSlug`, `anonymousFormIntakeCandidates`, `anonymousFormIntakeSlugs` and the `AnonymousFormIntakeCandidate` type. They lived only in `@objectstack/metadata-core`, which a browser console should not depend on. They are pure functions with no imports, beside the `SharingConfigSchema` they read.
- **What they decide is unchanged.** A form is open when its `sharing` has `enabled === true`, `allowAnonymous === true` and a non-empty `publicLink`. The scan covers the same three shapes in the same order: the nested `form`, every `formViews` entry, then the `config` of a `viewKind: 'form'` item.
- **`@objectstack/metadata-core` re-exports the same functions** from `@objectstack/spec/ui`. They are the spec's own bindings, not wrappers or copies, so there is still one copy of the rule. Its exports, names and types are unchanged, and `@objectstack/rest` and `@objectstack/metadata-protocol` keep importing from it. Its built output now loads `@objectstack/spec/ui` to get them.
- **Not covered by the new export:** whether another metadata layer withdraws a form (`anonymousFormIntakeWithdrawnIn`), and whether the deployment's tenancy posture lets the form take an anonymous submission (`anonymousFormIntakeUnavailability`). These two read server state and stay in `@objectstack/metadata-core`. `anonymousFormObjectName`, which names the object a form submits into, stays there beside them; it is a pure read of the form and the view, not of server state. A form the new functions call open can still be withheld by a withdrawal in another layer or by the posture.
