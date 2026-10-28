---
'@object-ui/console': patch
---

fix(console): a share link to a non-chat record shows the record's fields as read-only rows, not raw JSON

Clause-②: no
Metadata-protocol: none

- **Before.** The share-link page `/s/:token` printed `JSON.stringify(record)` in a code block for every object except `ai_conversations`: field API names, unformatted values and nested objects as JSON.
- **Now.** The page renders one read-only row per key the resolve answer carries. The label is the key humanized (`annual_revenue` reads "Annual Revenue"). The value is formatted by its JSON shape: ISO dates and date-times in the visitor's locale, numbers grouped, booleans as Yes / No, lists and nested objects as short text, and an empty value as a dash. System fields such as `id` and `created_at` are shown after the business fields. A record with no fields left reads "No data".
- **Unchanged.** The page shows exactly the fields the server returned: redacted fields stay absent and the "Some fields are hidden by the owner" line still renders. The `ai_conversations` transcript, the resolve request, its headers and the password flow do not change.
- **Not yet.** Field labels and field types are not in the resolve answer, and an anonymous visitor cannot read the object's metadata, so authored labels, picklist labels, currency and lookup names do not show yet.
