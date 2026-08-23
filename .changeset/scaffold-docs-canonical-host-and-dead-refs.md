---
"create-objectstack": patch
---

fix(create-objectstack): converge scaffold docs on the canonical host and drop the last two dead monorepo references (#10990, #11022)

A freshly scaffolded project shipped a handful of text lines a reader with
only their own project — no monorepo, no `docs/adr/`, no issue tracker —
could not follow:

- `templates/AGENTS.md` linked `https://objectstack.com/docs`, a domain that
  is not this project's docs site at all (not even a redirecting alias).
- `templates/blank/Dockerfile` and `templates/blank/docker-compose.yml` both
  linked `https://docs.objectstack.ai/...`, an accepted-but-unratified alias.
  All three now point at the ruled canonical origin, `https://objectstack.ai`
  (maintainer ruling, 2026-08-21).
- `templates/blank/README.md` cited `ADR-0097` and named "the ObjectStack
  framework repo" as the home of `skills/` — both rewritten self-contained,
  keeping the fact each was carrying: the connector-materialization line now
  links the public [Automation → Connectors](https://objectstack.ai/docs/automation/connectors)
  page, and the skills line now names the followable
  `npx skills add objectstack-ai/objectstack/skills` install the scaffolder's
  own closing output already uses.

`packages/create-objectstack/src/starter-comments-self-contained.test.ts`
(#10324) gains two pin obligations these two fixes call for: a host-convergence
assertion driven by the same `shippedFiles()` walker that already enumerates
everything a scaffold ships (no other repo gate's population reaches these
template files — `check:published-readme-links` reads publishable packages'
published markdown only), and a fifth `MONOREPO_ONLY` pattern that catches a
prose-shaped reference to this repo ("the ObjectStack framework repo") the
first four, syntax-shaped patterns could not. The self-retiring `EXCLUDED`
entry for `blank/README.md` is removed now that the file cites nothing
monorepo-only.
