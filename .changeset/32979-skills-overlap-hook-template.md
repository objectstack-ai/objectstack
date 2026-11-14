---
'@objectstack/skills': patch
---

docs(skills): a vetted hook template refuses two records of one owner over overlapping time

Clause-②: no
Metadata-protocol: none

The platform has no declarative way to say "two leave requests of one person may not overlap": a validation rule sees one record and a unique index compares equal values only. That rule stays in a hook script for now, and the published data skill now carries the form to copy.

- **`@objectstack/skills`** (`objectstack-data`, `references/data-hooks.md`): Common Patterns gains pattern 5, a `beforeInsert` + `beforeUpdate` hook with a sandboxed `body`. On update it merges the stored row under the patch and leaves the record itself out of the count; it names the ignored statuses with `$nin`, so a status added later, or a row with no status, still counts; `datetime` ranges are half-open, so 18:00–21:30 and 21:30–23:00 do not overlap, while a `date` range's end day is inclusive, so the same day cannot be booked twice; it declares `runAs: 'system'`, so the count also sees rows the saver cannot read; and it refuses through a declared `refusals` entry (`OVERLAP`, `409`). Its known limits are stated next to it: two concurrent saves can both pass, a recycle-bin restore runs no insert hook, an import with automations off skips hooks, rows of one bulk insert or update do not see each other, and a row with no start or end is neither checked nor counted. The `object`, `events`, `priority`, `async` and `onError` subsections under Key Properties, and the `previous` example under Hook Context API, are removed: each restated the comments of the `defineHook` example, the sandbox `ctx` table, the Before vs After table or Best Practices. No schema, runtime or behaviour changes.
- The record hooks page (`content/docs/automation/hooks.mdx`) carries the same template with the reason for each line and the same limits.
