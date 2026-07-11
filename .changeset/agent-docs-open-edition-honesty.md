---
"@objectstack/spec": patch
---

Agent capability — open-edition honesty pass (docs + liveness annotation), no
behavior change:

- The `agent`/`skill`/`tool`/`action` liveness files cite
  `packages/services/service-ai/...` as evidence, but that tree is a stale,
  untracked build artifact — the real runtime is the closed cloud
  `@objectstack/service-ai`. Each file's `_note` now says so explicitly, so an
  auditor reading the ledger understands these props are `live` because a
  CLOUD/EE runtime consumes them and the OPEN framework edition does not.
- Docs (`content/docs/ai`): removed the `aggregate_data` over-claim from
  Natural Language Queries — the open MCP surface registers 9 tools and
  `query_records` has no aggregation args; `aggregate_data` is a cloud data
  tool. And disambiguated the two things called "skill" (authoring `SKILL.md`
  modules vs. runtime `defineSkill` agent capability bundles) with cross-linked
  callouts on both pages.
