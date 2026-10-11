---
"@objectstack/spec": patch
"@objectstack/client": patch
"@objectstack/rest": patch
"@objectstack/cli": patch
---

docs: the suggested-binding acceptance is deployment-level and takes effect

Clause-②: no

Text only. These are the published sentences that describe what confirming a package's `isDefault` suggestion does. They now match the behaviour `@objectstack/plugin-security` ships in this release.

- `@objectstack/spec`: `ISecurityService.listAudienceBindingSuggestions`, `confirmAudienceBindingSuggestion` and `dismissAudienceBindingSuggestion` keep "writes the binding" for the confirm. The text now also says what that means: a `manage_metadata` holder accepts once for the deployment, `everyone`'s definition is derived again, and a dismiss on an accepted suggestion revokes it. The package-level `isDefault` note keeps "an admin confirms in Setup" and adds who that admin is.
- `@objectstack/client`: the `security.suggestedBindings.confirm` and `.dismiss` TSDoc.
- `@objectstack/rest`: the route summaries of the confirm and dismiss routes. Paths and envelopes are unchanged.
- `@objectstack/cli`: the ownership-inventory citation for `sys_audience_binding_suggestion` now says the record is deployment-level and owned by the Default Organization.
