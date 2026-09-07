---
"@objectstack/spec": patch
---

The `DisasterRecoveryPlan` docblock example no longer teaches a cron dialect the platform's scheduler refuses.

`DisasterRecoveryPlanSchema`'s `@example` block spelled its six-hourly backup schedule `'0 0/6 * * *'`. A numeric prefix before the step (`0/6`) is Quartz-style stepping. The only cron parser this platform runs is `croner` — reached through `CronJobAdapter`, which hands every scheduled expression to `new Cron(...)` — and it refuses that spelling. Measured against the `croner` 10.0.1 copy installed for `@objectstack/service-job`:

```
new Cron('0 0/6 * * *')
  -> TypeError: CronPattern: Syntax error, stepping with numeric prefix ('0/6')
     is not allowed. Use wildcard (asterisk-slash-step) or range (min-max/step) instead.
```

The example now reads `'0 0,6,12,18 * * *'`, which the same parser accepts and which fires at 00:00, 06:00, 12:00 and 18:00 — the instants the old spelling was written to mean. The sibling example `'0 2 * * *'` on the same schema is accepted unchanged; it was the positive control for the measurement, so the refusal above is a reading rather than a broken probe.

The wildcard-step spelling croner's own error message suggests, and which this schema's tests use, is **not writable in this position**: inside a `/** … */` block comment the step separator closes the comment, and the file stops parsing (measured — esbuild refuses it at the example's own line). The enumerated form is the equivalent that survives a docblock, and both forms were measured to produce identical firing instants.

Nothing fires differently, because nothing fires at all: `BackupConfig.schedule` is declared-but-unwired and reaches no scheduler, and `CronExpressionInputSchema` judges no cron syntax at parse time by design (`shared/expression.zod.ts`) — so the bad example sat in a position that is deliberately undefended. The accept set of every schema is unchanged by this edit, and no export moves. What changes is what an author copying the example gets: the docblock publishes verbatim into the shipped `dist/system/index.d.ts`, so it is the text an editor shows on hover.
