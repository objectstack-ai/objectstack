---
"@objectstack/spec": patch
---

`KnowledgeRefreshPolicy.cron` no longer tells authors that the `cron` dialect engine judges their syntax "when the expression is evaluated". Both halves of that sentence were false: nothing evaluates `refresh.cron` — `service-knowledge` reads `refresh.onRecordChange` and never `refresh.cron` — and `@objectstack/formula`'s registered `cron` engine has no caller outside that package, so it was never going to issue that verdict either. The claim shipped to authors through the generated reference page (`content/docs/references/ai/knowledge-source.mdx`), naming both an engine that never sees the value and an event that never happens.

The docblock, the `.describe()` and the slot's two pin-test comments now say what is true today, matching the wording of the already-corrected Expression Protocol dialect table: cron syntax is not checked at parse time and no engine evaluates this slot — `croner` judges a cron pattern only where a schedule is wired (`CronSchedule.expression`, a different slot) — so the verdict belongs to whatever external scheduler the author hands the value to. Documentation only: no exported symbol, no authorable key and no accept-set movement; the parse behaviour is byte-for-byte unchanged, and the pin that proves `'not a cron'` still normalizes is untouched.
