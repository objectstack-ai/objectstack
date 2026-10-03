---
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

Public forms: every declared means of withdrawing a form from anonymous intake is now honoured by every anonymous form door. Which forms a `view` opens to anonymous intake is now decided by one rule, `anonymousFormIntakeCandidates` (new in `@objectstack/metadata-core`, alongside `anonymousFormIntakeSlugs`, `anonymousFormIntakeSlug` and `publicFormSlug`), read by both the anonymous form endpoints in `@objectstack/rest` and the organization-scoped `view` write check in `@objectstack/metadata-protocol`, so the two can no longer disagree. A form is served anonymously only when its `sharing` config declares public sharing as `SharingConfigSchema` defines it; see the public forms guide for the required keys.
