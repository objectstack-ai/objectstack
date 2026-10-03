---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

Public forms: every declared means of withdrawing a form from anonymous intake is now honoured by every anonymous form door. Which forms a `view` opens to anonymous intake is now decided by one rule, `anonymousFormIntakeCandidates` (new in `@objectstack/metadata-core`, alongside `anonymousFormIntakeSlugs`, `anonymousFormIntakeSlug` and `publicFormSlug`), read by both the anonymous form endpoints in `@objectstack/rest` and the organization-scoped `view` write check in `@objectstack/metadata-protocol`, so the two can no longer disagree. A form is served anonymously only when its `sharing` config declares public sharing as `SharingConfigSchema` defines it: `sharing.enabled: true`, `sharing.allowAnonymous: true` and a `sharing.publicLink` slug. `enabled` defaults to `false`, so a form that set only `allowAnonymous` and `publicLink` is no longer served on the anonymous endpoints (`404 FORM_NOT_FOUND`). Migration: add `enabled: true` to the form's `sharing` block (and to any stored overlay of it) to keep it public; see the public forms guide.
