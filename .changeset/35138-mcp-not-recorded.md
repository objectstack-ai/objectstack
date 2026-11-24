---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/core': patch
'@objectstack/service-analytics': patch
---

feat(mcp): a refused record read says the data is not recorded, in the caller's language

Clause-②: yes (widening)
Metadata-protocol: none

When `query_records`, `aggregate_records` or `get_record` is refused and the call named an object, or a field, that the caller's own schema does not show (the object as `describe_object` serves it to them), the refusal now carries two members beside it, on the HTTP and the stdio server alike:

- `notRecorded`: what is not recorded, as the caller sent it: `{ "object": "<name>" }`, or `{ "object": "<name>", "fields": ["<name>", …] }` for the field names the call sent that the schema does not show, in the order sent. Every sent name is read by its head on every channel (`where`, `fields`, `orderBy`, `groupBy`, an aggregation's `field` and `filter`), so `owner.name` is judged by `owner`, and a dotted name whose head the schema shows is never named.
- `ifNotRecorded`: one sentence, in the caller's language (English, Simplified and Traditional Chinese, Japanese), telling the model to say the data is not recorded, never to report 0 or an empty result for it, and not to answer with another object or field in its place.

The answer names only what the caller can see: both members are built from the names the caller sent and from the caller's served schema, and nothing else. The refusal itself (`isError`, its `code`, `message` and `status`) is unchanged, byte for byte. A read that answers, a refusal about a field the caller's schema shows, a server fault, and a refusal whose schema read cannot be made carry no member. `id`, `created_at` and `updated_at`, which every object answers, are never named.

The language is chosen by one shared picker, `pickSentenceLocale` (with `platformLocaleNamedBy`), now exported from `@objectstack/core`: the first of the caller's locales (the request's, then the workspace default) that names a language the sentence is written in, else `en`. The dataset tools' `nextStep` and `sourceLine` (`@objectstack/service-analytics`) use the same picker, with unchanged behaviour. `McpDataBridge` gains an optional `userTextLocales()` member: the HTTP bridge answers the request's ladder, the stdio bridge the principal's ladder and then the i18n service's default. A bridge without it is answered in `en`.
