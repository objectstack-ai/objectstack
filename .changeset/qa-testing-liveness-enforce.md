---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

fix(spec,cli): govern the QA testing domain and enforce `TestSuiteSchema` at the `os test` load site (#6247)

`packages/spec/src/qa/testing.zod.ts` declares the Quality Protocol — test
suites, scenarios, steps, actions, assertions — and had no liveness ledger, so
the ADR-0049 enforce-or-remove machinery had never looked at it. #6247 filed it
as **declared-but-inert on zero runtime consumers**, and that reading was wrong:
the grep behind it matched only `*Schema` identifiers, while every consumer here
reads the **type** names (`QA.TestSuite`, `QA.TestStep`, `QA.TestAction`). What
it missed is a complete execution chain — core's `TestRunner` and
`HttpTestAdapter` (whose `action.type` switch labels *are* the
`TestActionTypeSchema` values), published through `export * as QA`, driven by the
shipped, documented CLI command `os test`. The retire ruling that followed from
the bad reading was withdrawn; this is the enforce leg.

**The real gap was narrower and genuine.** The type was the contract and the
schema had no `parse` site anywhere in the platform: `os test` loaded suites with
`JSON.parse(content) as QA.TestSuite`, next to the schema author's own
`// Should validate with Zod`. A type assertion checks nothing at runtime, so a
malformed suite failed late and in the wrong place — a missing `scenarios`
TypeError'd inside the runner with no idea which file it came from, a misspelled
`steps` key reported the scenario **passed** having executed nothing, and a bad
`action.type` died in the HTTP adapter's `default:` branch mid-run, after earlier
steps had already written records. `os test` now parses at the load boundary and
refuses a bad suite there, naming the file, listing the issues and quoting the
expected shape; a refusal counts as one failed suite rather than killing the run.
Valid suites load and execute unchanged.

**`packages/spec/liveness/qa.json`** seeds the ledger, governed through the same
`SPEC_ONLY_SCHEMAS` override as `query`/`webhook`/`validation` — a QA suite is a
file an author writes, not stack metadata, so there is no registry to fold it
onto and the override *is* its governance. Four live rows (`scenarios.id`,
`.setup`, `.steps`, `.teardown`) carry `file:line` evidence into the runner;
step, action and assertion keys sit below the gate's one-level walk and their
measurements are recorded in the notes rather than fanned into rows the gate
would not check. Five dead rows are recorded honestly, two of which go onto the
enforce-or-remove worklist: `scenarios.tags` advertises filtering that `os test`
has no flag to express, and `scenarios.requires` declares param/plugin
preconditions nothing checks, so a suite naming an absent plugin runs anyway and
fails later as an unexplained HTTP error. None is marked `authorWarn`, and the
omission is deliberate — the author-side lint walks stack collections, a QA suite
belongs to no stack, and a warn flag that can never be emitted would be a silent
no-op inside the mechanism built to catch them.
