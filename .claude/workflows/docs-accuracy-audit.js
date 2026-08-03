export const meta = {
  name: 'docs-accuracy-audit',
  description: 'Audit + fix hand-written ObjectStack docs against actual implementation, with adversarial verification. Scope with args.docs; defaults to all hand-written docs.',
  whenToUse: 'Periodic or change-scoped documentation accuracy verification. Pass args.docs = [paths] to scope (e.g. output of scripts/docs-audit/affected-docs.mjs); omit for a full audit of every hand-written doc.',
  phases: [
    { title: 'Scope Preflight', detail: 'resolve every doc path on disk; abort naming any that does not exist' },
    { title: 'Audit & Fix', detail: 'one agent per doc: read, locate implementation, apply evidence-backed edits' },
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
  "content/docs/deployment/migration-from-objectql.mdx",
  "content/docs/deployment/production-readiness.mdx",
  "content/docs/deployment/publish-and-preview.mdx",
  "content/docs/deployment/self-hosting.mdx",
  "content/docs/deployment/single-project-mode.mdx",
  "content/docs/deployment/tenancy-modes.mdx",
  "content/docs/deployment/troubleshooting.mdx",
  "content/docs/deployment/validating-metadata.mdx",
  "content/docs/deployment/vercel.mdx",
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
  "content/docs/permissions/rls.mdx",
  "content/docs/permissions/sharing-rules.mdx",
  "content/docs/permissions/sso.mdx",
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
]
// </generated:docs-audit-scope>

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
log(`scope: ${DOCS.length} doc(s)${DOCS === ALL_HANDWRITTEN ? ' — FULL audit (no args.docs given)' : ''}`)

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
log(`Auditing ${DOCS.length} hand-written doc(s) (pipelined: audit -> adversarial verify per doc)`)

const results = await pipeline(
  DOCS,
  (doc) => agent(auditPrompt(doc), { label: `audit:${doc.replace('content/docs/', '')}`, phase: 'Audit & Fix', schema: FIX_LOG_SCHEMA }),
  (fixLog, doc) => {
    if (!fixLog) return null
    return agent(verifyPrompt(doc, fixLog), { label: `verify:${doc.replace('content/docs/', '')}`, phase: 'Adversarial Verify', schema: VERDICT_SCHEMA })
      .then((v) => ({ doc, fixLog, verdict: v }))
  }
)

const clean = results.filter(Boolean)
const totalFixes = clean.reduce((n, r) => n + (r.fixLog?.fixCount || 0), 0)
const totalRepairs = clean.reduce((n, r) => n + (r.verdict?.correctionsMade?.length || 0), 0)
const totalResidual = clean.reduce((n, r) => n + (r.verdict?.residualInaccuracies?.length || 0), 0)

// The preflight said every path resolved; the agents that actually opened the files
// are the authority on whether that was true. If they disagree, the run did NOT audit
// what it claims to have audited — say so by failing, after logging the work that did
// land (the edits are already on disk) rather than returning a summary that reads green.
const ghosts = clean.filter((r) => r.fixLog?.docExists === false).map((r) => r.doc)
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
  docsWithChanges: clean.filter((r) => (r.fixLog?.fixCount || 0) > 0 || (r.verdict?.correctionsMade?.length || 0) > 0).length,
  totalFixesApplied: totalFixes,
  totalVerifierRepairs: totalRepairs,
  totalResidualForFollowup: totalResidual,
  docsMissingVerifier: clean.filter((r) => !r.verdict).map((r) => r.doc),
  perDoc: clean.map((r) => ({
    doc: r.doc,
    fixes: r.fixLog?.fixCount || 0,
    docExists: r.fixLog?.docExists,
    implFound: r.fixLog?.implementationFound,
    confirmed: r.verdict?.confirmed,
    repairs: r.verdict?.correctionsMade?.length || 0,
    regressions: r.verdict?.regressionsFound || [],
    buildSafe: r.verdict?.buildSafe,
    residual: r.verdict?.residualInaccuracies || [],
  })),
}
