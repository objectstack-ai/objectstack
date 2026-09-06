# App or platform — which work belongs where

Routed here from `AGENTS.md`. This boundary was decided ad hoc three times in one day, by
three seats, each from scratch, and the three derivations differed. It is one rule, not new
policy: the rule those decisions already followed, written down so it stops being re-derived.

Lessons here are self-contained by the 2026-08-12 ruling — failure mode, discipline and
boundary in the text, no issue number to dereference.

## The deciding question

**Could this be written by something that has only the metadata, and no knowledge of this
company?**

| Answer | Belongs in |
|:--|:--|
| **No** — it encodes the company's own judgement | the **metadata app**: a discount ceiling, who a case is assigned to, how won/lost is booked; its own objects, views and flows |
| **Yes** — it only asks whether the metadata is self-consistent | the **platform**: reference integrity, translation coverage, view rosters, sharing-rule coverage, CRUD round-trips, RLS probes per declared position |
| the subject is platform behaviour, the cost lands on the app | the **platform**, and it is a **gap** until it does — asserting what a hook does inside the platform's own sandbox is one |

The second row is the one that pays. An app that hand-writes it is hand-writing a
consistency proof the platform can derive once, for every app, and check on every build.

## The second question, for a capability an app wants published

**If a second app needed this, would it copy the implementation?** Yes ⇒ platform.

One consumer is a **use**; two is a **contract**. A resolution wanted by four call sites
inside a single package stays package-private on exactly this test — the home question gets
decided when a second consumer is actually in hand, and a symbol that was never published
can move without a major. ⛔ The dependency graph is not the test: check the real edges
before claiming two packages cannot import each other, because three of six directed edges
usually already exist.

⛔ This question decides what a package **in this monorepo** exports. It is contributor
guidance and must not ship to customers, who cannot act on it.

## ⛔ Anti-pattern 1 — an app hand-copies a platform rule

The copy diverges from the rule the build actually applies, so the app stays green while
the platform refuses. The divergence is invisible until the two disagree, and then the
app's own test suite is the thing arguing for the wrong answer.

Measured twice. A card wanting the platform's hook-body lowering pass turned out to want
half a command that already ships (`os build --strict-body`, which turns "bundled instead
of lowered" into exit 1 — `packages/cli/src/commands/compile.ts`, of which `build` is an
alias) and half an `os lint` rule that exists nowhere in the tree. One level up, the same
shape ships a rule claiming "0 findings over the corpus" against a corpus that is not the
app it names.

⇒ Before hand-writing against platform behaviour, grep the CLI for the command that already
does it, and confirm the rule you are citing exists.

## ⛔ Anti-pattern 2 — a capability that under-delivers silently

Worse than none. `os verify` once derived **zero** cases on a multi-package app and reported
success. `packages/cli/src/commands/verify.ts` states the shape in its own header: *a
verifier that under-verifies reports success it never established*.

An app that meets one of these writes its own harness and never comes back — so the loss is
permanent, and it is invisible, because the capability is still reporting green.

**The order is therefore fixed: make the derived half trustworthy first, then take the
hand-written half back.** Reversing it just deletes protection. The fix for the `os verify`
case landed as an ordered pair — ledger the four losses first so the fix has something to be
checked against, then close them — which is this rule executed.
