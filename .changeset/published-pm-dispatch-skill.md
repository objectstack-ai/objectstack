---
---

docs(skills): publish `objectstack-pm-dispatch` — the project-agnostic core of the PM dispatch loop, installable by any ObjectStack project (#4607).

The multi-agent delivery loop (backlog triage → claim → dispatch → structured
report → review → land) has only existed as repo-internal agent tooling under
`.claude/`. Third-party projects building on ObjectStack — hotcrm, customer
projects — run the same shape of work and had nothing to install. This adds the
generalized skill to the published `skills/` catalog:

- **Config over hardcoding.** The loop reads an optional
  `.claude/pm-dispatch.json` (`backlogRepo`, `repos`, `batch`, `mode`,
  `conventionsFile`, `routingLabelPrefix`); with no file the current repository
  is both the only shard and the backlog. Every project-specific gate — branch
  naming, release-note artifact, test commands, merge policy — is read from the
  project's own conventions file rather than baked into the skill, and that file
  wins on conflict.
- **The developer-agent operating procedure is embedded as a template** the PM
  pastes into each dispatch, so the loop works with no custom agent types:
  worktree-first, scope = the issue, contract-first (no lenient consumer
  fallback), the JSON report contract, `needs_decision` instead of guessing, and
  the container resource discipline (shared heavy-verify `flock`, heap cap,
  scoped builds, PID-only process operations, worktree cleanup).
- **The two-axis decision frame is kept verbatim** because both axes generalize:
  ① long-term architectural soundness for this project, ② making AI-authored
  code — especially AI-authored metadata — structurally hard to get wrong
  (tighten the producer, never make the consumer tolerant).
- **New: upstream reporting.** What an app project does when it finds a
  *platform* defect — stale-premise check against upstream first, minimal repro
  with pinned versions and the contract being cited, **never** a tolerant
  workaround in the app, an upstream issue backlinked with `Part of <app>#N` and
  carrying none of the upstream's queue labels, and the app-side task parked as
  `Blocked-by:` or as a version pin with a written unblock condition.

Catalog registration only — `metadata.domain: process`, no `metadata.internal`,
listed in `skills/README.md` and `content/docs/ai/skills-reference.mdx` via the
existing `build-skill-docs.ts` generator. The repo-internal `.claude` version is
untouched. Releases nothing: no published package's shipped files change
(`packages/spec` does not ship `scripts/`).
