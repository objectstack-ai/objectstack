---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(spec): the Studio hook form offers a refusal's `reasons` and `params`

Clause-②: yes (widening)
Metadata-protocol: none

The hook form (`hookForm`) lays out a refusal entry as `message`, `status`, `reasons` and `params`, so a Studio author can declare the several sentences under one code and the named params that a hook's refusal catalogue accepts. `reasons` is a record keyed by the snake_case reason the body throws beside the code, each `{ message }`; it takes the same key-only record control as the catalogue, and the reason key rule it checks is the one the served `HookSchema` declares. `params` is a name list. The entry's `message` help text now says a `{{ name }}` hole fills a declared param, where it said the sentence takes no placeholders. The three new rows and the changed help text are translated in the ten locales of the platform's metadata-form bundles (`@objectstack/platform-objects`), and the console's zh-CN form labels (`@object-ui/app-shell`, shipped in `@object-ui/console`) name the three rows for the Pending changes sheet.

Nothing a metadata author can write changes: `reasons` and `params` were already accepted on a refusal entry; only the form now offers them. A catalogue that uses them already kept them through a Studio edit, and still does. A refusal with only `message` and `status` saves exactly as before.

In the metadata form (`@object-ui/app-shell`), removing the last entry of an optional record row now leaves the key absent rather than writing `{}`. The two read differently, though both draw the same empty list: an entry's `reasons: {}` refuses every reason the body throws under that code, where an absent `reasons` does not read the thrown reason; and a hook's `refusals: {}` refuses every code its body throws, where an absent catalogue leaves its throws as they were. A required record row, such as an object's `fields`, keeps `{}` as before.
