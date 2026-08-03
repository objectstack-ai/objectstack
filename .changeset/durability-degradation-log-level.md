---
"@objectstack/objectql": patch
"@objectstack/service-automation": patch
---

fix(convention): a best-effort degradation that costs DURABILITY logs `error`, not `warn` — and a gate that enforces it (#4632)

#4420: the durable suspended-run store attached to a table that was never
created. Every write failed into a `warn` nobody read, every restart dropped all
in-flight approvals, and the process reported perfect health the entire time —
the symptom surfaced a release after the cause. #4460 raised that **one** site to
`error`. This makes it the rule, because the *class* is what recurs.

**The rule** (AGENTS.md → "Degradation log levels") is a question, not an
adjective, so an agent can apply it while writing the `catch`:

> After the degradation, does the system still look "normal" from the outside,
> while something it claims is persisted has not actually landed?
> Yes → `error`. No → `warn`/`info` is right.

An `error` here owes two things in its first line: the **consequence** (what is
not durable, and that the system will keep looking healthy anyway) and the
**fix** (the composition change that restores durability, or the explicit opt-out
that makes the degradation deliberate). Say it once, not once per failed write.

**Sites raised to `error`** — each was reviewed individually; escalating a
functional degradation is the mirror-image failure and was deliberately avoided:

| Where | What was silently lost |
|:---|:---|
| `objectql` schema sync, per object | DDL never ran — the object stays registered, routed and rendered while its table/columns do not exist |
| `objectql` schema sync, summary | `info: Schema sync complete` printed over a pass with failures; now an `error` naming the count |
| `objectql` reload-time schema sync | a Studio edit adds a field, the UI shows it, the API accepts it, the column was never created |
| `ObjectQL.syncSchemas()` | an **empty** `catch` — marketplace install and template seeding wrote into tables this failure means do not exist, then reported success |
| `service-automation` wait-timer re-arm (4 paths) | runs stay persisted but nothing re-arms them: every approval paused before the restart hangs forever |

**Deliberately left at `warn`** — the rule cuts both ways, and over-applying it
trains everyone to skim `error`: the batch→sequential schema-sync fallback (it
*recovers*), and "no job service is registered" on the re-arm path (a declared
absence in a host that never composed auto-resume — nothing was promised and
then broken).

**It has teeth.** A convention that lives only in AGENTS.md is the same
"declared ≠ enforced" shape this repo keeps paying to fix, so
`pnpm check:durability-log-level` walks the AST for `catch` blocks guarding a
declared vocabulary of durability-critical operations and fails when one
degrades below `error` without rethrowing. It follows same-file helpers (so
extracting a reporter cannot quietly defeat it) and ships its own `--self-test`.
Deliberately narrow: it cannot *discover* a new durability seam, only stop known
ones from regressing — extend `DURABILITY_CRITICAL_CALLEES` in the same PR that
fixes a new one.

No API, schema or behaviour changes — only the level, and the text, of what
already-failing paths report.
