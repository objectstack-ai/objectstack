---
'@objectstack/spec': minor
---

fix(spec): a `joined` report refuses a top-level `dataset` / `rows` / `columns` / `values`, pointing each onto `blocks[]` (#19856)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

A `joined` report selects nothing itself: each block binds its own `dataset` and
selects its own `rows` / `columns` / `values`, and the renderer's joined branch
reads `blocks` and returns before it reads any top-level selection key.
`ReportSchema` already refused a container-level `order` for exactly that
reason, but the four selection keys beside it parsed green and were then dropped
without a word. Each is now refused at its own path:

```
FROM  ReportSchema.safeParse({ name: 'overview', label: 'Overview', type: 'joined',
        blocks: [/* … */], dataset: 'tasks', values: ['task_count'] })
      -> { success: true }             // both keys silently ignored at render

TO    -> { success: false, issues: [
           { code: 'custom', path: ['dataset'],
             message: 'a `joined` report selects per block — move `dataset` onto `blocks[]`, or delete it; on the container it selects nothing.' },
           { code: 'custom', path: ['values'],
             message: 'a `joined` report selects per block — move `values` onto `blocks[]`, or delete it; on the container it selects nothing.' } ] }
```

**Fix.** Move the key onto the `blocks[]` entries that need it, or delete it.
Either way the report renders exactly as before, because the container value was
never read.

**What does not change.** A present `dataset` and a NON-EMPTY list are refused;
an empty `rows` / `columns` / `values` list selects nothing and still parses (the
same threshold as the container `order` refusal, whose message is unchanged). A
joined report's container `runtimeFilter` and `drilldown` — the two container keys
the joined branch does read — parse as before, and every non-joined report is
untouched. An aliased spelling (`measures` → `values`, `dataSet` → `dataset`, …)
is still renamed first, and the renamed key on a joined container then meets this
refusal.

<!-- adr-0087: registered ui-report-joined-container-selection-refused -->
