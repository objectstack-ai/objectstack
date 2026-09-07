---
"@objectstack/spec": patch
---

The Expression Protocol dialect table no longer names `cron-parser` as the `cron` engine. That package is not a dependency of any ObjectStack package; the row shipped to authors through the generated reference page (`content/docs/references/shared/expression.mdx`) and pointed them at the wrong library for field counts, alias vocabulary and second-field semantics.

The row now says what the code does: no cron syntax is judged at parse time; `croner` evaluates a cron expression only when `CronSchedule.expression` is scheduled (`toBoundaryJobSchedule` → `CronJobAdapter`, where an invalid pattern is refused); every other cron-typed slot is parsed and reaches no engine; and `@objectstack/formula`'s registered `cron` engine has no caller outside that package. Documentation only — no schema, accept set or behaviour changes.
