---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/platform-objects': patch
---

Form help and refusals an author reads no longer carry service-interface names, ruling dates or another product's ids

Clause-②: no

Wording only: no schema, key, type, export or error-code change.

- The notify node's Template help (the `NotifyConfigSchema.template` describe and the Studio
  inspector's copy in `@objectstack/service-automation`) names the deployment's default locale in
  product words instead of `II18nService.getDefaultLocale()`, and drops its ruling date.
- `MANIFEST_ID_EXAMPLES` is now `com.acme.crm` and `org.example.help-desk` (was `com.steedos.crm`
  and `org.apache.superset`). The package-id refusal opens with the headline
  "Invalid package id 'VALUE'." and names the key in the sentence after it, so the headline alone
  carries no JSON path; the rule, the examples and the suggestion follow unchanged in substance. A
  caller that matched the old "on KEY. Expected reverse-domain notation" wording matches the
  headline, or compares against `manifestIdRefusal()` by reference, instead.
- Ruling dates leave the describes Studio renders as form help: field `required` and `multiple`,
  form-view field and section `visibleWhen`, section `collapsible` / `collapsed`, the redirect
  arm's `submitBehavior.url`, and page `kind` / `source` (the ADR citations stay). They also
  leave the refusals for padded grouping field names, `submitBehavior.url`, `features.*` in a
  form-view predicate, and the four filter comparand refusals (null ordering comparand,
  `{ $field }` in a list position, null list member, blank `$between` bound). Each sentence still
  states the rule, why it exists and the repair.
- The email-template form's Identity section help says how senders address a template instead of
  naming `IEmailService.sendTemplate`, in all four shipped locales.
- The action `description` help no longer ends in a dangling dash left behind by an earlier
  strip: "(one dialog, not two —)" now reads "(one dialog, not two)".
