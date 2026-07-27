---
"@objectstack/spec": minor
---

feat(spec)!: remove `SkillSchema.permissions` — it never gated anything (#3686)

Owner decision on the enforce-or-prune call filed in #3686: **prune**.

`skill.permissions` was declared, surfaced in the Studio authoring form under a
section labelled *"Access — Required permissions to use this skill"*, and echoed
by the objectui preview — but **no runtime ever read it**. The cloud
`SkillRegistry` selects skills by `active` / `triggerConditions` / `tools` only.
A security-shaped field that enforces nothing is worse than no field: it invites
an author (or an AI) to believe a skill is gated when it is not. Same disposition
as agent `visibility` (#1901) and the `PolicySchema` tree (#2387).

Removed: the schema property, the form's whole `Access` section (it existed only
for this field), its generated i18n keys, the liveness-ledger entry, and the
`permissions` line from the objectstack-ai skill doc's `os:check` example. The
objectui preview's "Required Permissions" panel is removed in the companion
objectui change.

**Migration** — gate access where it is actually enforced:
- **Agent level** — `access` / `permissions` on `defineAgent` ARE enforced at the
  chat route (403 for a caller missing any of them, #1884). Bind the restricted
  skill only to a restricted agent.
- **Action level** — gate the underlying actions the skill's tools invoke via
  permission sets (ADR-0066).

`SkillSchema` is non-strict, so an existing `permissions:` key is silently
stripped on parse rather than rejected — no boot break, but it stops appearing
anywhere.
