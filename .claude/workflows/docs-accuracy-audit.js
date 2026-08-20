export const meta = {
  name: 'docs-accuracy-audit',
  description: 'Audit + fix hand-written ObjectStack docs against actual implementation, with adversarial verification. Scope with args.docs; defaults to all hand-written docs.',
  whenToUse: 'Periodic or change-scoped documentation accuracy verification. Pass args.docs = [paths] to scope (e.g. output of scripts/docs-audit/affected-docs.mjs); omit for a full audit of every hand-written doc.',
  phases: [
    { title: 'Scope Preflight', detail: 'resolve every doc path on disk; abort naming any that does not exist' },
    { title: 'Audit & Fix', detail: 'one agent per doc: read, locate implementation, apply evidence-backed edits — except release-owned pages, which are reviewed read-only and produce findings to file as issues' },
    { title: 'Adversarial Verify', detail: 'second agent re-checks each applied fix against code, repairs regressions' },
  ],
}

// Default scope = every hand-written doc (content/docs/** minus references/). Callers
// normally pass a scoped subset via args.docs (e.g. only docs whose backing packages/
// code changed).
//
// The list is inline because it has to be: a workflow script runs in a `node:vm`
// context whose only globals are log/phase/console/budget/timers plus agent/parallel/
// pipeline/workflow/args, with code generation disabled — no require, no import, no
// filesystem. It cannot enumerate content/docs/ itself, nor read a JSON artifact.
//
// So it is GENERATED instead: `node scripts/docs-audit/check-audit-scope.mjs --write`
// derives it from the filesystem, and the same script without --write is a CI gate
// (`pnpm check:docs-audit-scope`) that fails when the block and content/docs/ disagree
// in EITHER direction. It used to be hand-kept behind a "keep in sync" comment, and by
// #4851 had rotted both ways at once — 16 entries pointing at files that no longer
// existed (the whole renamed protocol/objectos → protocol/kernel directory among them)
// and 48 existing docs missing from it — with every full-audit run reporting green.
// <generated:docs-audit-scope>
// GENERATED — do not hand-edit. `node scripts/docs-audit/check-audit-scope.mjs --write`
// derives this from the filesystem (every content/docs/**/*.mdx except
// references/, via `affected-docs.mjs --all`); the same script run without
// --write fails CI when the two disagree in either direction. See #4851: this
// list was hand-kept, 16 entries pointed at files that no longer existed and 48
// existing docs were absent from it, and a "FULL audit" reported green over both.
const ALL_HANDWRITTEN = [
  "content/docs/ai/actions-as-tools.mdx",
  "content/docs/ai/agents.mdx",
  "content/docs/ai/connect-mcp.mdx",
  "content/docs/ai/index.mdx",
  "content/docs/ai/knowledge-rag.mdx",
  "content/docs/ai/natural-language-queries.mdx",
  "content/docs/ai/skills-reference.mdx",
  "content/docs/ai/skills.mdx",
  "content/docs/api/client-sdk.mdx",
  "content/docs/api/data-api.mdx",
  "content/docs/api/data-flow.mdx",
  "content/docs/api/declarative-endpoints.mdx",
  "content/docs/api/environment-routing.mdx",
  "content/docs/api/error-catalog.mdx",
  "content/docs/api/error-handling-client.mdx",
  "content/docs/api/error-handling-server.mdx",
  "content/docs/api/index.mdx",
  "content/docs/api/metadata-api.mdx",
  "content/docs/api/plugin-endpoints.mdx",
  "content/docs/api/wire-format.mdx",
  "content/docs/automation/approvals.mdx",
  "content/docs/automation/connectors.mdx",
  "content/docs/automation/flows.mdx",
  "content/docs/automation/hook-bodies.mdx",
  "content/docs/automation/hooks.mdx",
  "content/docs/automation/index.mdx",
  "content/docs/automation/webhooks.mdx",
  "content/docs/automation/workflows.mdx",
  "content/docs/build-without-code.mdx",
  "content/docs/capabilities/ai.mdx",
  "content/docs/capabilities/analytics.mdx",
  "content/docs/capabilities/approvals.mdx",
  "content/docs/capabilities/automation.mdx",
  "content/docs/capabilities/data.mdx",
  "content/docs/capabilities/forms.mdx",
  "content/docs/capabilities/index.mdx",
  "content/docs/capabilities/integrations.mdx",
  "content/docs/capabilities/permissions.mdx",
  "content/docs/capabilities/request-template.mdx",
  "content/docs/capabilities/views.mdx",
  "content/docs/concepts/architecture.mdx",
  "content/docs/concepts/design-principles.mdx",
  "content/docs/concepts/index.mdx",
  "content/docs/concepts/metadata-driven.mdx",
  "content/docs/concepts/metadata-lifecycle.mdx",
  "content/docs/concepts/north-star.mdx",
  "content/docs/data-modeling/analytics.mdx",
  "content/docs/data-modeling/drivers.mdx",
  "content/docs/data-modeling/external-datasources.mdx",
  "content/docs/data-modeling/field-type-decision-tree.mdx",
  "content/docs/data-modeling/field-types.mdx",
  "content/docs/data-modeling/fields.mdx",
  "content/docs/data-modeling/formulas.mdx",
  "content/docs/data-modeling/index.mdx",
  "content/docs/data-modeling/indexing.mdx",
  "content/docs/data-modeling/objects.mdx",
  "content/docs/data-modeling/queries.mdx",
  "content/docs/data-modeling/relationships.mdx",
  "content/docs/data-modeling/schema-design.mdx",
  "content/docs/data-modeling/seed-data.mdx",
  "content/docs/data-modeling/validation-rules.mdx",
  "content/docs/data-modeling/validation.mdx",
  "content/docs/deployment/backup-restore.mdx",
  "content/docs/deployment/cli.mdx",
  "content/docs/deployment/environment-variables.mdx",
  "content/docs/deployment/index.mdx",
  "content/docs/deployment/production-readiness.mdx",
  "content/docs/deployment/publish-and-preview.mdx",
  "content/docs/deployment/seed-tenancy-repair.mdx",
  "content/docs/deployment/self-hosting.mdx",
  "content/docs/deployment/single-project-mode.mdx",
  "content/docs/deployment/tenancy-modes.mdx",
  "content/docs/deployment/troubleshooting.mdx",
  "content/docs/deployment/validating-metadata.mdx",
  "content/docs/getting-started/build-with-claude-code.mdx",
  "content/docs/getting-started/common-patterns.mdx",
  "content/docs/getting-started/examples.mdx",
  "content/docs/getting-started/glossary.mdx",
  "content/docs/getting-started/how-ai-development-works.mdx",
  "content/docs/getting-started/index.mdx",
  "content/docs/getting-started/quick-reference.mdx",
  "content/docs/getting-started/quick-start.mdx",
  "content/docs/getting-started/your-first-project.mdx",
  "content/docs/index.mdx",
  "content/docs/kernel/architecture.mdx",
  "content/docs/kernel/cluster.mdx",
  "content/docs/kernel/contracts/auth-service.mdx",
  "content/docs/kernel/contracts/cache-service.mdx",
  "content/docs/kernel/contracts/data-engine.mdx",
  "content/docs/kernel/contracts/index.mdx",
  "content/docs/kernel/contracts/metadata-service.mdx",
  "content/docs/kernel/contracts/storage-service.mdx",
  "content/docs/kernel/events.mdx",
  "content/docs/kernel/index.mdx",
  "content/docs/kernel/runtime-services/audit-service.mdx",
  "content/docs/kernel/runtime-services/data-service.mdx",
  "content/docs/kernel/runtime-services/email-service.mdx",
  "content/docs/kernel/runtime-services/examples.mdx",
  "content/docs/kernel/runtime-services/index.mdx",
  "content/docs/kernel/runtime-services/queue-service.mdx",
  "content/docs/kernel/runtime-services/settings-service.mdx",
  "content/docs/kernel/runtime-services/sharing-service.mdx",
  "content/docs/kernel/runtime-services/sms-service.mdx",
  "content/docs/kernel/runtime-services/storage-service.mdx",
  "content/docs/kernel/runtime-services/versioning.mdx",
  "content/docs/kernel/services-checklist.mdx",
  "content/docs/kernel/services.mdx",
  "content/docs/permissions/access-matrix.mdx",
  "content/docs/permissions/access-recipes.mdx",
  "content/docs/permissions/administrator-guide.mdx",
  "content/docs/permissions/attachments-access.mdx",
  "content/docs/permissions/authentication.mdx",
  "content/docs/permissions/authorization.mdx",
  "content/docs/permissions/delegated-administration.mdx",
  "content/docs/permissions/explain.mdx",
  "content/docs/permissions/field-level-security.mdx",
  "content/docs/permissions/index.mdx",
  "content/docs/permissions/permission-metadata.mdx",
  "content/docs/permissions/permission-sets.mdx",
  "content/docs/permissions/permissions-matrix.mdx",
  "content/docs/permissions/positions.mdx",
  "content/docs/permissions/profiles.mdx",
  "content/docs/permissions/record-view-auditing.mdx",
  "content/docs/permissions/rls.mdx",
  "content/docs/permissions/sharing-rules.mdx",
  "content/docs/permissions/sso.mdx",
  "content/docs/permissions/system-context.mdx",
  "content/docs/plugins/adding-a-metadata-type.mdx",
  "content/docs/plugins/anatomy.mdx",
  "content/docs/plugins/development.mdx",
  "content/docs/plugins/index.mdx",
  "content/docs/plugins/packages.mdx",
  "content/docs/protocol/backward-compatibility.mdx",
  "content/docs/protocol/diagram.mdx",
  "content/docs/protocol/index.mdx",
  "content/docs/protocol/kernel/config-resolution.mdx",
  "content/docs/protocol/kernel/error-handling.mdx",
  "content/docs/protocol/kernel/http-protocol.mdx",
  "content/docs/protocol/kernel/i18n-standard.mdx",
  "content/docs/protocol/kernel/index.mdx",
  "content/docs/protocol/kernel/lifecycle.mdx",
  "content/docs/protocol/kernel/metadata-service.mdx",
  "content/docs/protocol/kernel/plugin-spec.mdx",
  "content/docs/protocol/kernel/realtime-protocol.mdx",
  "content/docs/protocol/knowledge.mdx",
  "content/docs/protocol/objectql/index.mdx",
  "content/docs/protocol/objectql/query-syntax.mdx",
  "content/docs/protocol/objectql/schema.mdx",
  "content/docs/protocol/objectql/security.mdx",
  "content/docs/protocol/objectql/state-machine.mdx",
  "content/docs/protocol/objectql/types.mdx",
  "content/docs/protocol/objectui/actions.mdx",
  "content/docs/protocol/objectui/concept.mdx",
  "content/docs/protocol/objectui/index.mdx",
  "content/docs/protocol/objectui/layout-dsl.mdx",
  "content/docs/protocol/objectui/record-alert.mdx",
  "content/docs/protocol/objectui/widget-contract.mdx",
  "content/docs/releases/implementation-status.mdx",
  "content/docs/releases/index.mdx",
  "content/docs/releases/v12.mdx",
  "content/docs/releases/v13.mdx",
  "content/docs/releases/v14.mdx",
  "content/docs/releases/v15.mdx",
  "content/docs/releases/v16.mdx",
  "content/docs/releases/v17.mdx",
  "content/docs/releases/v9.mdx",
  "content/docs/ui/actions.mdx",
  "content/docs/ui/apps.mdx",
  "content/docs/ui/audience-based-interfaces.mdx",
  "content/docs/ui/create-vs-edit-form.mdx",
  "content/docs/ui/dashboards.mdx",
  "content/docs/ui/doc-pages.mdx",
  "content/docs/ui/field-grouping-and-order.mdx",
  "content/docs/ui/forms.mdx",
  "content/docs/ui/index.mdx",
  "content/docs/ui/pages.mdx",
  "content/docs/ui/public-data-collection.mdx",
  "content/docs/ui/setup-app.mdx",
  "content/docs/ui/translations.mdx",
  "content/docs/ui/views.mdx",
  "content/docs/upgrading.mdx",
]
// </generated:docs-audit-scope>

// --- Release-owned pages are IN SCOPE but READ-ONLY (#4920) -------------------
//
// AGENTS.md "Documentation Guardrails" — the row whose path column is exactly the
// prefix below — and CLAUDE.md's second ⛔ rule say the same thing:
//
//   `content/docs/releases/` | RELEASE-OWNED | Never edit in a code PR.
//   Release notes are written centrally at release time, compiled from changesets
//   + the ADR-0087 registries — not accreted a row per PR.
//
// This workflow's stated deliverable is an in-place mdx rewrite (see RULES below),
// so a full audit walked straight into that prohibition: 9 release pages in scope,
// each handed to an agent told to Edit it, and the follow-up PR from a run was
// precisely the PR the guardrail exists to stop.
//
// The ruling on #4920 was NOT to drop them from scope. Dropping them would leave
// some of the most-read pages in the docs permanently unaudited, and would create a
// SECOND definition of "which docs does this workflow cover" alongside the generated
// block above — #4851 had just finished paying for what happens when one subject has
// two hand-kept lists. So the scope is unchanged and only the DELIVERABLE forks:
// findings to file as issues, instead of edits written to disk.
//
// The fork has to be decidable inside the workflow VM (no filesystem, no require, no
// import — see the note on the generated block), which a path prefix is. And the
// prefix is not a curation of the guardrail, it is the guardrail's own path column
// copied verbatim, so there is still exactly one definition of "release-owned".
// `scripts/docs-audit/check-audit-scope.mjs` anchors the two together and goes red if
// AGENTS.md stops marking this exact path RELEASE-OWNED, if this constant stops
// matching the row, or if the derived scope stops containing release pages at all.
const RELEASE_OWNED_PREFIX = 'content/docs/releases/'
const isReleaseOwned = (doc) => doc.startsWith(RELEASE_OWNED_PREFIX)

// Scope resolution. Omitting `args` entirely is the legitimate "audit
// everything" invocation; supplying `args` but not a usable `args.docs` array
// is a CALLER BUG and must say so.
//
// This used to be a single `?:` that fell back to ALL_HANDWRITTEN for both
// cases. The Workflow tool delivers `args` verbatim, so passing a JSON-encoded
// STRING instead of an object — an easy mistake, and one the tool's own docs
// warn about — left `args.docs` undefined, the ternary silently widened a
// 12-doc request to all 147, and the run burned ~294 agents on work nobody
// asked for. Nothing in the output said the scope had been ignored. Failing
// loudly costs one retry; failing quietly cost an hour.
if (args !== undefined && args !== null) {
  if (typeof args === 'string') {
    throw new Error(
      '[docs-accuracy-audit] `args` arrived as a string, not an object — pass a real JSON ' +
      'value (e.g. {"docs": ["content/docs/a.mdx"]}), not a JSON-encoded string. ' +
      'Refusing to silently audit all ' + ALL_HANDWRITTEN.length + ' docs instead.',
    )
  }
  if (args.docs !== undefined && (!Array.isArray(args.docs) || args.docs.length === 0)) {
    throw new Error(
      '[docs-accuracy-audit] `args.docs` must be a non-empty array of doc paths; got ' +
      JSON.stringify(args.docs) + '. Omit `args` entirely to audit all ' +
      ALL_HANDWRITTEN.length + ' hand-written docs.',
    )
  }
}
const DOCS = args && Array.isArray(args.docs) && args.docs.length ? args.docs : ALL_HANDWRITTEN
const WRITABLE_DOCS = DOCS.filter((d) => !isReleaseOwned(d))
const READONLY_DOCS = DOCS.filter(isReleaseOwned)
log(`scope: ${DOCS.length} doc(s)${DOCS === ALL_HANDWRITTEN ? ' — FULL audit (no args.docs given)' : ''}`)
if (READONLY_DOCS.length) {
  log(
    `  of which ${READONLY_DOCS.length} release-owned page(s) under ${RELEASE_OWNED_PREFIX} — ` +
    'audited READ-ONLY: findings only, never edited (AGENTS.md Documentation Guardrails; #4920)',
  )
}

// --- Scope preflight: every path in scope must resolve to a real file ---------
//
// `pnpm check:docs-audit-scope` already keeps ALL_HANDWRITTEN honest in CI, but it
// can only see the DEFAULT list. A caller-supplied `args.docs` — the normal way this
// workflow is invoked — is checked by nothing, and a bad path there fails exactly the
// way #4851's stale list did: the audit agent finds no file, reports `fixCount: 0`,
// and the run summary shows a doc that was "audited clean". So resolve the scope
// first and refuse to start if anything in it is missing.
//
// This has to go through an agent: the workflow VM has no filesystem. That makes the
// preflight a REPORT rather than a measurement, so its arithmetic is checked below —
// a verdict that does not account for every path, exactly once, is treated as a
// failed preflight, not as a pass. A guard whose own answer is unverified is how
// #4868 happened.
const PREFLIGHT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['command', 'present', 'missing'],
  properties: {
    command: { type: 'string' },
    present: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
  },
}

phase('Scope Preflight')
const preflight = await agent(
  `Resolve documentation paths against the repository working tree. This is a mechanical
existence check — do NOT read, summarise, judge or edit any file.

PROCEDURE:
1. From the repository root, run ONE shell command that tests every path below, e.g.
   \`for f in <paths>; do [ -f "$f" ] || echo "MISSING $f"; done\`
   (or an equivalent \`ls\`/\`test\` loop). Record the exact command you ran.
2. Return every path that resolves to an existing FILE under 'present', and every path
   that does not under 'missing'.
3. Every path below must appear in exactly one of the two arrays, spelled EXACTLY as
   given. Do not add, drop, normalise, deduplicate or re-order paths, and do not guess
   at a corrected path for a missing one — reporting the miss IS the deliverable.

PATHS (${DOCS.length}):
${DOCS.join('\n')}`,
  { label: `preflight:${DOCS.length} path(s)`, phase: 'Scope Preflight', schema: PREFLIGHT_SCHEMA },
)

if (!preflight || !Array.isArray(preflight.present) || !Array.isArray(preflight.missing)) {
  throw new Error(
    '[docs-accuracy-audit] scope preflight returned no usable verdict. Refusing to audit ' +
    DOCS.length + ' doc(s) whose paths were never resolved — an unresolved path produces ' +
    'an agent that reads nothing and reports "0 fixes", which is indistinguishable from a ' +
    'clean doc. Re-run the workflow.',
  )
}
{
  const accounted = [...preflight.present, ...preflight.missing]
  const inScope = new Set(DOCS)
  const seen = new Set(accounted)
  const foreign = accounted.filter((p) => !inScope.has(p))
  const unaccounted = DOCS.filter((p) => !seen.has(p))
  if (foreign.length || unaccounted.length || accounted.length !== DOCS.length) {
    throw new Error(
      '[docs-accuracy-audit] scope preflight did not account for the scope exactly once: ' +
      `${accounted.length} path(s) reported for ${DOCS.length} in scope` +
      (unaccounted.length ? `; never reported: ${unaccounted.slice(0, 10).join(', ')}` : '') +
      (foreign.length ? `; not in scope: ${foreign.slice(0, 10).join(', ')}` : '') +
      '. A preflight that cannot be reconciled with its own input is a failed preflight — ' +
      'not a pass. Re-run the workflow.',
    )
  }
}
if (preflight.missing.length) {
  throw new Error(
    `[docs-accuracy-audit] ${preflight.missing.length} of ${DOCS.length} doc path(s) in scope ` +
    'do not exist:\n  ' + preflight.missing.join('\n  ') +
    '\n\nRefusing to run: an audit agent pointed at a non-existent file reads nothing and ' +
    'reports "0 fixes", so the run would report success over docs nobody looked at (#4851 — ' +
    'that is how #4781 and #4817 survived ~2 months of green full audits). If these came from ' +
    'args.docs, fix the caller; if they came from the default list, run ' +
    '`node scripts/docs-audit/check-audit-scope.mjs --write`.',
  )
}
log(`preflight: all ${preflight.present.length} path(s) resolve (via \`${preflight.command}\`)`)

const PACKAGE_MAP = `ObjectStack is a metadata-driven application framework. Implementation lives in packages/:
- packages/spec — Zod schemas for every metadata type (.zod.ts); source of truth for shapes & enums. Also packages/spec/src/{data,ui,...}.
- packages/core — kernel: plugin system, service registry, lifecycle, events.
- packages/runtime — runtime services (data, email, queue, settings, sharing, storage, audit, versioning).
- packages/services — service contracts/interfaces (IAuthService, IDataEngine, etc.).
- packages/metadata, metadata-core, metadata-fs — metadata loading/registry (meta.getItem(type, name)).
- packages/cli — the \`os\` CLI; commands in packages/cli/src/commands/ (dev.ts, init.ts, serve.ts, meta/, data/, cloud/, etc.).
- packages/client + client-react — client SDK; public surface in packages/client/src/index.ts.
- packages/rest — REST API; data routes mounted under /api/v1/data/{object}.
- packages/objectql — ObjectQL query engine + types.
- packages/formula — CEL formula engine.
- packages/triggers, observability, mcp, connectors, adapters, platform-objects.
- packages/plugins/* — plugin-auth, plugin-security, plugin-sharing, plugin-approvals, plugin-email, plugin-webhooks, plugin-reports, plugin-audit, plugin-dev, plugin-hono-server, driver-*, knowledge-*, embedder-*.
- apps/console — the admin console app; apps/docs — this docs site.`

const HOUSE_FACTS = `ESTABLISHED CORRECTIONS from prior doc-accuracy audits (PR #1866 + #1904) — already applied across the docs. Treat as strong priors and apply CONSISTENTLY; re-verify against current code only if a doc's usage looks context-specific:
- CLI binary is \`os\`. There is NO \`os studio\` command — the UI dev command is \`os dev --ui\` (verify in packages/cli/src/commands/dev.ts).
- Metadata access by type+name: \`meta.getItem('object', name)\` — NOT \`client.meta.getObject()\`.
- \`client.ai.chat()\` was REMOVED — do not reference it.
- Approvals are request-id based (ADR-0019): \`client.approvals.*\` — NOT \`client.workflow.approve/reject\`.
- There are NO \`defineProfile\` / \`defineAction\` / \`defineHook\` / \`definePlugin\` helper functions.
- Security model is the real PermissionSet schema (objects/fields, allowCreate/allowRead/allowEdit/allowDelete/..., isProfile) — NOT a Salesforce-style Profile type with objectPermissions/fieldPermissions. FLS non-editable write REJECTS with PermissionDeniedError (403), it is not silently stripped. OWDModel values are public_read / public_read_write.
- Formulas/conditions use CEL — NOT Salesforce UPPERCASE functions.
- Console/portal path is /_console — NOT /_studio.
- REST data path is /api/v1/data/{object} — NOT /api/v1/{object}. REST routes carry the /v1 prefix.
- Env vars are OS_AUTH_SECRET (not AUTH_SECRET) and OS_PORT (not PORT); nested keys use single underscore unless the schema says otherwise. Mock-server toggle is VITE_USE_MOCK_SERVER (no VITE_RUNTIME_MODE or ?mode= switch).
- The repo is github.com/objectstack-ai/objectstack (NOT objectstack-ai/spec). Fix broken cross-repo links/paths accordingly.
- Package names: @objectstack/<x> (e.g. @objectstack/service-cache, NOT @objectstack/services/service-cache). Some types only export via subpaths (e.g. @objectstack/spec/ui).
- Auto-generated reference docs live in content/docs/references/ and are OUT OF SCOPE — never edit them.`

const RULES = `HARD RULES:
1. Edit the doc FILE IN PLACE with Edit/Write. The edits to disk are the real deliverable; your structured output is just a log of what you changed.
2. PRESERVE frontmatter (the --- title/description block) EXACTLY. Do NOT move, rename, or change the file's path or slug.
3. Keep MDX/JSX valid: <Callout>, <Tabs>, <Steps>, code fences, import lines must stay well-formed.
4. EVERY factual fix must be backed by evidence you actually read — cite file:line. If you cannot find code confirming a claim is wrong, DO NOT change it. Record it under 'unresolved' instead.
5. Do not fabricate APIs, flags, paths, or features. If the doc describes a feature that does NOT exist in code (removed/aspirational), remove it or qualify it as not-yet-implemented — backed by grep-empty evidence.
6. Make minimal, precise edits — fix what is wrong, leave correct prose alone.
7. Verify code samples, CLI commands, API method names, config keys, env vars, file paths, enum values, and links against the actual implementation.`

// The read-only counterpart of RULES, for release-owned pages. Rule 1 of RULES
// ("Edit the doc FILE IN PLACE … the edits to disk are the real deliverable") is
// exactly what must not happen here, so this is a separate text rather than RULES
// with a caveat bolted on — an agent handed both a "you must edit" and a "you must
// not edit" instruction resolves the contradiction however it likes.
const READONLY_RULES = `HARD RULES — THIS PAGE IS RELEASE-OWNED AND READ-ONLY:
1. DO NOT edit, create, move, rename or delete this file or ANY file under ${RELEASE_OWNED_PREFIX}. No Edit, no Write, no shell command that modifies the working tree. These pages are RELEASE-OWNED (AGENTS.md "Documentation Guardrails"): release notes are written centrally at release time, compiled from changesets + the ADR-0087 registries, and a code PR that edits them is the exact PR that guardrail exists to stop. Leaving the file untouched is not a partial result — it is the correct result.
2. Your deliverable is the FINDING LIST. Each finding gets filed as an issue by the caller of this workflow, by someone who has not read the page and will not redo your research: name the location, state what is wrong, and say what it should say instead.
3. EVERY finding must be backed by implementation you actually read — cite file:line under packages/. If you cannot find code that contradicts the page, it is NOT a finding. Put the suspicion under 'unresolved' instead; an unresolved item is a real, useful outcome here.
4. Do not fabricate APIs, flags, paths or features, and do not report wording, tone, formatting or structure preferences. Implementation accuracy only.
5. A release page is a HISTORICAL record: it describes what shipped in a given version. "The current API differs" is therefore not automatically an error. Classify each finding: 'never-true' (the page was wrong when written), 'no-longer-true' (accurate for its version, but the page states it as present tense / current behaviour and now misleads), or 'ambiguous' (cannot tell without the release's own history). The three want different fixes, and only you have the evidence to tell them apart.
6. Auto-generated reference docs (content/docs/references/) are out of scope and so is every page outside the target — do not wander.`

// `docExists` is required and reported by the agent that actually opens the file —
// the preflight above is a separate call path, and #4868's lesson is that a self-check
// running somewhere other than the real path proves nothing about the real path. It is
// the difference between "audited, no problems found" and "there was nothing there".
const FIX_LOG_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['doc', 'docExists', 'implementationFound', 'fixesApplied', 'fixCount', 'unresolved', 'notes'],
  properties: {
    doc: { type: 'string' },
    docExists: { type: 'boolean' },
    implementationFound: { type: 'boolean' },
    fixesApplied: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['category', 'summary', 'before', 'after', 'evidence'],
      properties: {
        category: { type: 'string', enum: ['broken-example', 'inaccurate-api', 'outdated-path', 'outdated-env', 'security-model', 'fabricated-feature', 'broken-link', 'naming-drift', 'enum-drift', 'other'] },
        summary: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, evidence: { type: 'string' },
      } } },
    fixCount: { type: 'number' },
    unresolved: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

// The read-only channel's output. Deliberately NOT shaped like FIX_LOG_SCHEMA: there
// is no `fixesApplied`/`fixCount` to report zero of, because "0 fixes" is the value
// #4851 showed to be indistinguishable from "nothing was there". A release page's
// result is a list of findings whose length is the count — one source of truth, no
// self-reported tally to disagree with it.
//
// `filesEdited` is required and must come back false. The VM cannot see the working
// tree, so this is the agent's own admission — but an agent that admits it edited a
// release-owned page fails the run by name, which beats discovering the edit in review
// (or not discovering it).
const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['doc', 'docExists', 'filesEdited', 'implementationFound', 'findings', 'unresolved', 'notes'],
  properties: {
    doc: { type: 'string' },
    docExists: { type: 'boolean' },
    filesEdited: { type: 'boolean' },
    implementationFound: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['kind', 'category', 'location', 'inaccuracy', 'suggestedFix', 'evidence'],
      properties: {
        kind: { type: 'string', enum: ['never-true', 'no-longer-true', 'ambiguous'] },
        category: { type: 'string', enum: ['broken-example', 'inaccurate-api', 'outdated-path', 'outdated-env', 'security-model', 'fabricated-feature', 'broken-link', 'naming-drift', 'enum-drift', 'other'] },
        location: { type: 'string' }, inaccuracy: { type: 'string' }, suggestedFix: { type: 'string' }, evidence: { type: 'string' },
      } } },
    unresolved: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['doc', 'fixesReviewed', 'confirmed', 'correctionsMade', 'regressionsFound', 'buildSafe', 'residualInaccuracies'],
  properties: {
    doc: { type: 'string' },
    fixesReviewed: { type: 'number' },
    confirmed: { type: 'number' },
    correctionsMade: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'why', 'evidence'], properties: { what: { type: 'string' }, why: { type: 'string' }, evidence: { type: 'string' } } } },
    regressionsFound: { type: 'array', items: { type: 'string' } },
    buildSafe: { type: 'boolean' },
    residualInaccuracies: { type: 'array', items: { type: 'string' } },
  },
}

function auditPrompt(doc) {
  return `You are auditing a single hand-written ObjectStack documentation file for IMPLEMENTATION ACCURACY and fixing it in place.

TARGET DOC: ${doc}

${PACKAGE_MAP}

${HOUSE_FACTS}

${RULES}

PROCEDURE:
1. Read the entire doc (${doc}). If that path does not exist, STOP: return docExists
   false, fixCount 0, and say so in notes. Do NOT substitute a similar path, and do not
   report "no inaccuracies" — a file you could not open was not audited, and the two
   must never be reported the same way.
2. For each technical claim — code sample, CLI command, client/server API call, method/type name, config key, enum value, env var, file path, route, link — LOCATE the backing implementation under packages/ (Grep/Glob/Read; ripgrep via Bash is fine) and confirm whether the doc matches reality.
3. Apply evidence-backed fixes directly with Edit. Preserve frontmatter and MDX validity.
4. If a section documents a non-existent/removed/aspirational feature, remove it or qualify it as not-yet-implemented (with grep-empty evidence).
5. Return a structured log of every fix with file:line evidence, plus anything suspected-but-unconfirmed under 'unresolved'.

A doc with no real inaccuracies should return fixCount 0 — do not invent changes. The edits you write to disk ARE the deliverable.`
}

function readOnlyReviewPrompt(doc) {
  return `You are reviewing a single RELEASE-OWNED ObjectStack documentation page for IMPLEMENTATION ACCURACY. This page is audited READ-ONLY: you report, you do not fix.

TARGET DOC (do not modify): ${doc}

${PACKAGE_MAP}

${HOUSE_FACTS}

${READONLY_RULES}

PROCEDURE:
1. Read the entire doc (${doc}). If that path does not exist, STOP: return docExists
   false, an empty findings array, and say so in notes. Do NOT substitute a similar
   path, and do not report "no inaccuracies" — a file you could not open was not
   reviewed, and the two must never be reported the same way.
2. For each technical claim — code sample, CLI command, client/server API call,
   method/type name, config key, enum value, env var, file path, route, link — LOCATE
   the backing implementation under packages/ (Grep/Glob/Read; ripgrep via Bash is
   fine) and confirm whether the page matches reality.
3. Record every contradiction you can evidence as a finding, with its kind
   (never-true / no-longer-true / ambiguous), where on the page it is, what is wrong,
   what it should say instead, and the file:line you read. Anything suspected but not
   evidenced goes under 'unresolved'.
4. Do NOT edit the file. Return filesEdited false. If you edited it by reflex, revert
   it and say so in notes — this run will fail on purpose rather than carry an edit to
   a release-owned page into a PR.

A page with no evidenced inaccuracies returns an empty findings array — do not invent
findings to look productive. The finding list IS the deliverable; each entry becomes an
issue.`
}

function verifyPrompt(doc, fixLog) {
  return `You are the ADVERSARIAL VERIFIER for an implementation-accuracy fix just applied to an ObjectStack doc. Assume the previous agent may have over-corrected or introduced errors.

TARGET DOC (already edited): ${doc}

FIX LOG from the audit agent (JSON):
${JSON.stringify(fixLog).slice(0, 6000)}

${PACKAGE_MAP}

${HOUSE_FACTS}

${RULES}

PROCEDURE:
1. Read the current (edited) doc.
2. For EACH applied fix, independently verify the "after" value against the cited evidence AND the live code (re-grep/re-read — do NOT trust the evidence string blindly).
3. Hunt for REGRESSIONS: broken MDX/JSX, altered frontmatter, changed slug, previously-correct content replaced with something wrong, or a NEW inaccuracy.
4. If you find a wrong fix or regression, REPAIR it in place with Edit (same hard rules). Record each repair under correctionsMade with evidence.
5. Confirm frontmatter intact and the file is MDX/build-safe.
6. List remaining suspected inaccuracies under residualInaccuracies (report only; do not fix speculative items).

Return the verdict.`
}

phase('Audit & Fix')
log(
  `Auditing ${DOCS.length} hand-written doc(s): ${WRITABLE_DOCS.length} editable ` +
  `(audit -> adversarial verify per doc)` +
  (READONLY_DOCS.length ? `, ${READONLY_DOCS.length} release-owned (read-only review, findings only)` : ''),
)

// One pipeline over the whole scope, two deliverables. Routing by `isReleaseOwned`
// inside the stages — rather than by running two pipelines, or by filtering the
// release pages out up front — is deliberate: there is no code path here on which a
// doc in scope produces no result at all, which is the shape a "skip" would take.
const results = await pipeline(
  DOCS,
  (doc) => isReleaseOwned(doc)
    ? agent(readOnlyReviewPrompt(doc), { label: `review:${doc.replace('content/docs/', '')}`, phase: 'Audit & Fix', schema: FINDING_SCHEMA })
    : agent(auditPrompt(doc), { label: `audit:${doc.replace('content/docs/', '')}`, phase: 'Audit & Fix', schema: FIX_LOG_SCHEMA }),
  (auditLog, doc) => {
    if (!auditLog) return null
    // No adversarial verifier for release-owned pages: the verifier's job is to
    // re-check APPLIED EDITS and repair over-corrections, and there are none. The
    // guard against a bad finding is that it must carry file:line evidence and is
    // read by a human before it becomes an issue.
    if (isReleaseOwned(doc)) return { doc, readOnly: true, findingLog: auditLog }
    return agent(verifyPrompt(doc, auditLog), { label: `verify:${doc.replace('content/docs/', '')}`, phase: 'Adversarial Verify', schema: VERDICT_SCHEMA })
      .then((v) => ({ doc, readOnly: false, fixLog: auditLog, verdict: v }))
  }
)

const clean = results.filter(Boolean)
const edited = clean.filter((r) => !r.readOnly)
const reviewed = clean.filter((r) => r.readOnly)
const totalFixes = edited.reduce((n, r) => n + (r.fixLog?.fixCount || 0), 0)
const totalRepairs = edited.reduce((n, r) => n + (r.verdict?.correctionsMade?.length || 0), 0)
const totalResidual = edited.reduce((n, r) => n + (r.verdict?.residualInaccuracies?.length || 0), 0)
const totalFindings = reviewed.reduce((n, r) => n + (r.findingLog?.findings?.length || 0), 0)

// The read-only channel's headline, emitted BEFORE any of the failure paths below so
// it survives a failing run. #4920's rejected option was deleting the release pages
// from scope; a run that says nothing about them is that option, reached by accident.
// So this line is unconditional whenever release pages are in scope — including when
// the count is zero, which is a reviewed-and-clean result, not an absence.
if (READONLY_DOCS.length) {
  log(`releases (read-only): ${totalFindings} finding(s) — file issues, do not edit`)
}

// A release page that produced NO result was silently skipped, which is exactly the
// outcome the read-only channel exists to prevent. `results.filter(Boolean)` above is
// where such a doc would vanish without a trace, so reconcile against the scope by name.
const skippedReadOnly = READONLY_DOCS.filter((d) => !reviewed.some((r) => r.doc === d))
if (skippedReadOnly.length) {
  throw new Error(
    `[docs-accuracy-audit] ${skippedReadOnly.length} of ${READONLY_DOCS.length} release-owned ` +
    'page(s) in scope produced no review result:\n  ' + skippedReadOnly.join('\n  ') +
    '\n\nThese pages are in scope precisely so they are not skipped (#4920): the audit does ' +
    'not edit them, it reports findings on them. A run that neither edits nor reports has ' +
    'dropped them from the audit — the option that ruling rejected. Re-run the workflow.',
  )
}

// A release-owned page the agent admits it edited. The edit is already on disk, so the
// run fails naming the files rather than letting them ride along into a PR — the exact
// PR AGENTS.md's Documentation Guardrails forbid.
const illegallyEdited = reviewed.filter((r) => r.findingLog?.filesEdited === true).map((r) => r.doc)
if (illegallyEdited.length) {
  throw new Error(
    `[docs-accuracy-audit] ${illegallyEdited.length} release-owned page(s) were EDITED by their ` +
    'read-only review agent:\n  ' + illegallyEdited.join('\n  ') +
    '\n\n`' + RELEASE_OWNED_PREFIX + '` is RELEASE-OWNED (AGENTS.md "Documentation Guardrails"): ' +
    'release notes are compiled centrally at release time and must never be edited by a code PR. ' +
    'Revert these files (`git checkout -- <paths>`) before doing anything else with this run; the ' +
    'findings are still in the result, and belong in issues.',
  )
}

// The preflight said every path resolved; the agents that actually opened the files
// are the authority on whether that was true. If they disagree, the run did NOT audit
// what it claims to have audited — say so by failing, after logging the work that did
// land (the edits are already on disk) rather than returning a summary that reads green.
const ghosts = clean.filter((r) => (r.readOnly ? r.findingLog : r.fixLog)?.docExists === false).map((r) => r.doc)
if (ghosts.length) {
  log(`audited ${clean.length - ghosts.length} doc(s), ${totalFixes} fix(es), ${totalRepairs} verifier repair(s) before failing`)
  throw new Error(
    `[docs-accuracy-audit] ${ghosts.length} doc(s) in scope could not be opened by their audit ` +
    'agent, after the scope preflight reported every path as resolving:\n  ' + ghosts.join('\n  ') +
    '\n\nThe preflight and the real read path disagree — trust the read path. Re-check the ' +
    'scope (`node scripts/docs-audit/check-audit-scope.mjs`) before believing any result ' +
    'from this run.',
  )
}

return {
  docsProcessed: clean.length,
  docsDropped: DOCS.length - clean.length,
  docsWithChanges: edited.filter((r) => (r.fixLog?.fixCount || 0) > 0 || (r.verdict?.correctionsMade?.length || 0) > 0).length,
  totalFixesApplied: totalFixes,
  totalVerifierRepairs: totalRepairs,
  totalResidualForFollowup: totalResidual,
  docsMissingVerifier: edited.filter((r) => !r.verdict).map((r) => r.doc),
  // The release-owned channel, reported separately and in full: its deliverable is not
  // a diff, it is this list, and it is only worth anything if someone files it.
  releaseOwnedReadOnly: {
    prefix: RELEASE_OWNED_PREFIX,
    docsReviewed: reviewed.length,
    findings: totalFindings,
    action: `releases (read-only): ${totalFindings} finding(s) — file issues, do not edit`,
    why: 'AGENTS.md "Documentation Guardrails": content/docs/releases/ is RELEASE-OWNED — never edited by a code PR. In scope, read-only (#4920).',
    perDoc: reviewed.map((r) => ({
      doc: r.doc,
      docExists: r.findingLog?.docExists,
      implFound: r.findingLog?.implementationFound,
      findings: r.findingLog?.findings || [],
      unresolved: r.findingLog?.unresolved || [],
      notes: r.findingLog?.notes,
    })),
  },
  // Both channels appear here, in DIFFERENT shapes on purpose: a read-only entry has
  // no `fixes` key to read as `0`, so it cannot be mistaken for a page that was audited
  // and found clean.
  perDoc: clean.map((r) => r.readOnly
    ? {
      doc: r.doc,
      channel: 'read-only',
      docExists: r.findingLog?.docExists,
      implFound: r.findingLog?.implementationFound,
      findings: (r.findingLog?.findings || []).length,
      unresolved: r.findingLog?.unresolved || [],
      note: 'release-owned — file issues, do not edit',
    }
    : {
      doc: r.doc,
      channel: 'edit',
      fixes: r.fixLog?.fixCount || 0,
      docExists: r.fixLog?.docExists,
      implFound: r.fixLog?.implementationFound,
      confirmed: r.verdict?.confirmed,
      repairs: r.verdict?.correctionsMade?.length || 0,
      regressions: r.verdict?.regressionsFound || [],
      buildSafe: r.verdict?.buildSafe,
      residual: r.verdict?.residualInaccuracies || [],
    }),
}
