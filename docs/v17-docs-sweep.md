# v17 docs sweep — log and playbook

The v17 train is still accumulating changesets, so the docs cannot be aligned
once and declared done — they need **re-sweeping until `changeset pre exit`**.
This file is both the playbook for running a sweep and the append-only log of
every run, so the next sweep (human or agent) starts from a watermark instead
of re-auditing everything.

Scope: hand-written prose — `content/docs/**` (excluding `references/`, which
regenerates from spec, and `releases/`, which *documents* the old shapes on
purpose) and `skills/**`. Note `content/docs/ai/skills-reference.mdx` and
`skills/README.md` are **generated** from `skills/*/SKILL.md`
(`pnpm --filter @objectstack/spec gen:skill-docs`) — fix the SKILL.md, then
regenerate; never edit the mirrors.

## How to run a sweep

1. Read the changesets added since the last run's watermark:
   `git diff --name-only --diff-filter=A <watermark>..HEAD -- '.changeset/*.md'`
   Extract every **removed / renamed / re-defaulted** surface (the `!:` entries
   first, but minors retire surfaces too under the launch-window convention).
2. Extend the fingerprint table below with any new removals, then grep each
   fingerprint over the scope. Judge every hit in context — a hit that
   *documents the removal* is correct; a hit that *teaches the removed surface*
   is drift.
3. Fix drift at the source (SKILL.md before its mirrors), regenerate, run:
   `pnpm check:release-notes check:doc-authoring check:role-word` and
   `pnpm docs:build`.
4. Append a run entry at the bottom: watermark, fingerprints added, files
   fixed, false positives (so the next run can skip re-judging them), and
   out-of-scope findings (file an issue per Prime Directive #10).

Complementary deep pass: the fingerprint grep above is cheap and targeted at
*removals*; for a full implementation-accuracy re-verification of prose that
merely *references* changed code, use the `docs-accuracy-audit` workflow the
`docs-drift-check` PR bot advertises — scope it with
`node scripts/docs-audit/affected-docs.mjs <since-rev>` and pass the list as
`args.docs`. Worth one scoped run before `changeset pre exit`.

## Fingerprints (v17 removals/renames → what a hit means)

| Pattern | Drift if the doc… | Source changeset |
|---|---|---|
| `conditionalRequired` | teaches it instead of `requiredWhen` | retire-three-deprecated-aliases |
| `action.execute` (as authored key) | teaches it instead of `target` | retire-three-deprecated-aliases |
| `knowledge.topics` | teaches it instead of `sources` | retire-three-deprecated-aliases |
| `agent.tools` / inline tool arrays on agents | teaches the removed slot instead of `skills` | ai-agent-authoring-and-tools-removal |
| `tool.requiresConfirmation` (on **AIToolSchema**) | teaches the removed flag — the action-level `ai.requiresConfirmation` **survives**, do not "fix" it | tool-requires-confirmation-removed |
| `ai.nlq` / `ai.suggest` / `ai.insights` | presents the phantom SDK surface as callable | remove-dead-sdk-surface |
| `client.permissions/realtime/workflow/views` CRUD, notifications device/preference, `listTemplates`, `--template` | presents removed SDK/CLI surface | remove-dead-client-surfaces, drop-dead-* |
| GraphQL as *our* API surface (`/graphql`, `handleGraphQL`, "REST/GraphQL endpoints", `graphql` service, `plugin-graphql`) | advertises the removed surface — external-datasource `'graphql'` protocol and generic industry mentions are **not** drift | remove-graphql-surface |
| `ObjectStackProtocol` (interface/schema) | presents the dissolved alias as the contract | v17-dissolve-protocol-alias |
| `enable.trash` / `enable.mru` | says the flag *exists* (even as "exists but unenforced") | remove-enable-trash-mru |
| legacy `apiMethods` values (`upsert`, `aggregate`, `search`, `history`, `restore`, `purge`, `import`, `export` **inside an apiMethods list**) | teaches authoring them | apimethod-enum-shrink |
| sharing `accessLevel: 'full'`, recipient `group` / `guest`, owner-type rules | presents them as authorable, or as "declared but not enforced" (they no longer parse) | sharing-rule-recipient-reconcile, fix(sharing) #3865 |
| `allowExport` unset ⇒ export allowed | claims export inherits read | export-axis-opt-in |
| `SkillSchema.permissions` | teaches the removed field | prune-skill-permissions |
| Node `18` as a floor | states an out-of-date prerequisite | engines-node-22 |
| `PortalSchema`, `AuditConfig`, Capabilities-descriptor cluster, `FeatureFlagSchema`, `DEFAULT_*_ROUTES`, report `aria`/`performance`, `ReportColumn/GroupingSchema` | teaches a pruned cluster | prune-* family |
| `GetTranslationsRequest` `namespace`/`keys` filters | teaches the dropped filters | i18n-translations-request-drop-phantom-filters |

## Run log

### 2026-07-29 — run 1 (baseline)

- **Watermark:** framework `a641d10` (origin/main, post-#3906) · 305 changesets
  present · objectui pin `4a4829d0ef39`.
- **Fixed (drift → corrected):**
  - `kernel/services-checklist.mdx` — claimed 17 kernel services incl.
    `graphql` and governance by the `ObjectStackProtocol` interface; now 16
    services, per-domain contracts, all graphql rows/diagram entries removed,
    `plugin-ai` row no longer names the phantom NLQ/suggest/insights surface.
  - `permissions/authorization.mdx` — anonymous-deny row listed `/graphql` +
    `handleGraphQL` (removed from the matrix in v17); gate 4 said owner-type
    rules are "declared but seed-skipped" (they no longer parse).
  - `permissions/permissions-matrix.mdx` — sharing enforcement status still
    described the pre-#1878 declared-but-skipped posture.
  - `permissions/index.mdx` — status blurb said `group` recipients are
    "declared but not enforced" (renamed to `team`; owner/`guest` pruned).
  - `protocol/kernel/http-protocol.mdx` — said `enable.trash` "exists as an
    object flag" (removed in v17; authoring it is now a parse error).
  - `protocol/objectql/index.mdx`, `protocol/objectql/schema.mdx`,
    `permissions/field-level-security.mdx` — "REST/GraphQL" in diagrams,
    comments and prose.
  - `skills/objectstack-api/SKILL.md` — description advertised "REST/GraphQL
    endpoints" and a "REST/GraphQL generator"; mirrors regenerated
    (`content/docs/ai/skills-reference.mdx`, `skills/README.md`).
- **Judged, not drift (skip re-checking):**
  - `data-modeling/fields.mdx` (documents the `conditionalRequired` removal),
    `data-modeling/objects.mdx` `apiMethods` row, `api/plugin-endpoints.mdx`
    (documents the nlq/suggest/insights inversion), `api/client-sdk.mdx`,
    `permissions/permission-sets.mdx` + `sharing-rules.mdx` (already teach the
    v17 posture) — all corrected at change time by their changesets.
  - `ai.requiresConfirmation` hits in `ai/connect-mcp.mdx`,
    `ai/actions-as-tools.mdx`, `protocol/objectui/actions.mdx` — the surviving
    action-level key, not the removed tool-level one.
  - `automation/webhooks.mdx` "GraphQL subscriptions" — an out-of-scope
    comparison in a "what this is not" list, not our surface.
  - `ExecutionContext.tenantId` mentions — the internal field survives; only
    the hook/action `ctx.tenantId` alias was removed (v16).
- **Out of scope, logged for follow-up:**
  - `packages/spec/src/system/core-services.zod.ts` — the `'ai'` enum member's
    comment still reads "AI Engine (NLQ, Chat, Suggest, Insights)"; comment-only
    spec fix, belongs in a spec-touching PR.
  - `content/docs/releases/implementation-status.mdx` — "Last Updated June
    2026", predates the whole v17 window; needs a regeneration pass of its own
    rather than spot fixes.
- **Not yet swept:** `examples/**` inline prose and `docs/**` (internal);
  lower-priority — user-facing `content/docs` + `skills` covered first.

<!-- Append the next run above this line, newest last. -->
