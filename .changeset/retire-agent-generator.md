---
"@objectstack/cli": minor
---

fix(cli): **BREAKING** — the `agent` generator is retired, and `os g agent` now says why and points at skills (ADR-0063 §2, #10359)

**⛔ If a script, a Makefile or a CI step in your project runs `os g agent`, it
will now exit 1.** That is the intended outcome and the one way this change can
interrupt you: the command is gone, deliberately, and the failure is how you
find out. Everything it used to produce was already being discarded — read on.

`minor`, not `major`: during the launch window this stack ships breaking changes
as `minor` (pre-1.0 semantics under lockstep versioning — see
`scripts/check-changeset-no-major.mjs`).

**What the command actually did.** `os g agent <name>` scaffolded a typed
`AI.Agent` into `src/agents/`. Per ADR-0063 §2 (which reversed ADR-0040 §3) the
kernel ships exactly **two** agents — `ask` and `build` — bound by surface and
never picked from a roster, and the runtime catalog **filters out every
non-platform agent record**. So the scaffolded file parsed, passed
`os validate`, published without complaint, and then never appeared anywhere.
No error at any step. An author who followed the documented example got a file,
a green validate, a successful publish, and nothing to show for it.

**Why the roster entry was not simply deleted.** A deleted type falls through to
`Unknown type: agent` plus a list of what is left, which tells the author their
spelling is not on the list and invites them to hunt for the right spelling of
something that no longer exists — the same silence, one step earlier. `agent` is
now a **retirement ledger entry** instead, and the refusal carries both halves:
the decision that withdrew the surface, and the surface to author in its place.
What you see:

```
  ✗ `os g agent` was retired — agents are platform-internal (ADR-0063 §2).

  The kernel ships exactly two agents, `ask` and `build`, bound by surface.
  An agent you author still parses and still publishes — and the runtime
  catalog then filters it out, so it never appears and nothing tells you.
  This command scaffolded exactly that file, so it is retired, not repaired.

  Author a SKILL instead. Skills (plus tools / MCP) are the third-party
  extension primitive ADR-0063 names — the live surface this one was not.

  Scaffold one — the file lands where the loader looks for it:

      os g skill <name>    ->  src/skills/<name>.skill.ts

  It writes a `defineSkill` template with `surface` and `tools` filled in
  and explained, ready to edit.

  Docs: https://objectstack.ai/docs/ai/agents
```

**The call is not mechanically rewritable.** A skill is a different artifact
with a different schema, not a renamed agent, so delete the `os g agent` call
rather than renaming it — then run `os g skill` and fill the template in. (This
message originally said no scaffolder existed; `os g skill` shipped in the same
release, so the text above is what the command prints today.)

`agent` leaves the generator roster, which is `object`, `view`, `action`,
`flow`, `dashboard`, `app` — plus `skill`, added in this same release. The docs
that advertised the retired one — the `os g agent support`
example, the `agent` / `src/agents/` row of the Available types table, and
`os g agent sales-assistant` in the Typical Workflow block — are gone from
`content/docs/deployment/cli.mdx`, which carries the retirement note instead;
`packages/cli/README.md`'s type roster follows. The quick-start project-layout
map, which listed `src/agents` as the directory an app author writes AI metadata
into, now names `src/skills`.

<!-- adr-0087: not-required (no-migration-prescription) A CLI COMMAND NAME is an invocation surface, not authorable metadata. There is no authorable key, no `sys_metadata` row and no schema to tombstone here, so there is nothing for `objectstack migrate meta` to rewrite, nothing for `spec-changes.json` to project and no FROM -> TO spelling for the upgrade guide to carry: a skill is a different artifact rather than a renamed agent, so even with `os g skill` shipping in this same release there is no FROM -> TO call rewrite to prescribe — the author deletes the call and fills in a scaffolded template. Nor is the ledger the only notification channel this time, which is the difference from `http-request-errors-total-retired` (where an operator's Grafana panel silently drew a flat zero and the entry was the sole way to say so): the command itself now refuses, exits 1, names ADR-0063 and points at skills at the exact moment and place of use. Same reasoning shape as ADR-0087's D7 addendum, one surface over — there the compiler carries the notice, here the CLI does. -->
