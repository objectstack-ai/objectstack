---
"@objectstack/spec": minor
"@objectstack/client": minor
---

fix(spec,client)!: `GetTranslationsRequest` is locale-only — drop the
`namespace` / `keys` filters no server ever read (#3676)

`GetTranslationsRequestSchema` declared two optional filters, and the endpoint
description promised one of them ("...for the specified locale and optional
namespace"). Neither serving surface read either: the dispatcher domain body
(`runtime/src/domains/i18n.ts`) takes `parts[1]` / `query.locale`, and
service-i18n (`i18n-service-plugin.ts`) takes `req.params.locale`. Both return
the locale's whole bundle. The SDK meanwhile put both on the query string, so a
caller who passed `keys` to shrink the response shrank nothing and got no
indication the filter was inert — Prime Directive #10's declared ≠ enforced, the
same shape #1475 trimmed out of the validation-rule types.

Trimmed rather than implemented, on three counts:

- **No consumer.** No call site in this repo or `objectui` passed either field.
  The docs (`content/docs/api/client-sdk.mdx`, `skills/objectstack-i18n/SKILL.md`)
  already documented `getTranslations(locale)` as a full-bundle snapshot, so the
  schema was the outlier, not the docs. The one thing that did exercise them was
  a client test asserting the query string got *built* — it pinned the phantom
  rather than any behaviour, since no server read what it asserted was sent. It
  is replaced here by its inverse: a regression test that the request carries no
  filter query at all.
- **`keys` could not deliver what it advertises.** `II18nService.getTranslations`
  (`contracts/i18n-service.ts`) takes only `locale`, so a filter could only be a
  post-filter over an already-materialized bundle. `keys` reads as a payload
  optimization; a post-filter saves wire bytes but none of the server work, and
  widening the contract would break every implementer (`memory-i18n`,
  `file-i18n-adapter`) for a capability with no caller.
- **`keys` has no defined meaning against the current bundle shape.** Under the
  retired flat `o.`-dotted dialect, `keys: ['o.account.label']` was an obvious
  pick. #3778 settled the tree on one nested `TranslationData` shape, where a
  flat `string[]` is neither a path set nor a group set, and a filtered response
  would have to be rebuilt as a sparse nested tree to stay schema-valid. That is
  a design decision, and nothing is waiting on it.

`namespace` is the one that got *easier* — it now lands exactly on
`TranslationData`'s top-level groups, which is what its own description already
said ("e.g., objects, apps, messages"). It is still trimmed here: re-adding an
optional request field is additive and non-breaking the day the Studio's
per-module views actually need it, whereas shipping an unexercised filter path
now means dead code with tests to match, and a declared-but-unread field is
precisely the exemplar the next author copies.

BREAKING: the two schema fields and the `getTranslations(locale, options?)`
second parameter are removed with no deprecation cycle. Nothing worked through
them — a passed filter was silently ignored — so there is no behavior to
protect. Runtime impact is nil (the fields were optional and now strip); TS
callers passing them fail to compile, which is the intended signal.
