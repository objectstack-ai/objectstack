export const meta = {
  name: 'docs-accuracy-audit',
  description: 'Audit + fix hand-written ObjectStack docs against actual implementation, with adversarial verification. Scope with args.docs; defaults to all hand-written docs.',
  whenToUse: 'Periodic or change-scoped documentation accuracy verification. Pass args.docs = [paths] to scope (e.g. output of scripts/docs-audit/affected-docs.mjs); omit for a full audit of every hand-written doc.',
  phases: [
    { title: 'Audit & Fix', detail: 'one agent per doc: read, locate implementation, apply evidence-backed edits' },
    { title: 'Adversarial Verify', detail: 'second agent re-checks each applied fix against code, repairs regressions' },
  ],
}

// Default scope = every hand-written doc (content/docs/** minus references/). Keep in
// sync with `node scripts/docs-audit/affected-docs.mjs --all`. Callers normally pass a
// scoped subset via args.docs (e.g. only docs whose backing packages/ code changed).
const ALL_HANDWRITTEN = ["content/docs/ai/actions-as-tools.mdx","content/docs/ai/agents.mdx","content/docs/ai/chatbot-integration.mdx","content/docs/ai/index.mdx","content/docs/ai/knowledge-rag.mdx","content/docs/ai/natural-language-queries.mdx","content/docs/ai/skills-reference.mdx","content/docs/ai/skills.mdx","content/docs/api/client-sdk.mdx","content/docs/api/data-api.mdx","content/docs/api/data-flow.mdx","content/docs/api/environment-routing.mdx","content/docs/api/error-catalog.mdx","content/docs/api/error-handling-client.mdx","content/docs/api/error-handling-server.mdx","content/docs/api/index.mdx","content/docs/api/metadata-api.mdx","content/docs/api/plugin-endpoints.mdx","content/docs/api/wire-format.mdx","content/docs/automation/approvals.mdx","content/docs/automation/flows.mdx","content/docs/automation/hook-bodies.mdx","content/docs/automation/hooks.mdx","content/docs/automation/index.mdx","content/docs/automation/webhooks.mdx","content/docs/automation/workflows.mdx","content/docs/concepts/architecture.mdx","content/docs/concepts/design-principles.mdx","content/docs/concepts/index.mdx","content/docs/concepts/metadata-driven.mdx","content/docs/concepts/metadata-lifecycle.mdx","content/docs/concepts/north-star.mdx","content/docs/data-modeling/analytics.mdx","content/docs/data-modeling/drivers.mdx","content/docs/data-modeling/external-datasources.mdx","content/docs/data-modeling/field-type-decision-tree.mdx","content/docs/data-modeling/field-types.mdx","content/docs/data-modeling/fields.mdx","content/docs/data-modeling/formulas.mdx","content/docs/data-modeling/index.mdx","content/docs/data-modeling/indexing.mdx","content/docs/data-modeling/objects.mdx","content/docs/data-modeling/queries.mdx","content/docs/data-modeling/relationships.mdx","content/docs/data-modeling/schema-design.mdx","content/docs/data-modeling/seed-data.mdx","content/docs/data-modeling/validation-rules.mdx","content/docs/data-modeling/validation.mdx","content/docs/deployment/cloud-artifact-api.mdx","content/docs/deployment/environment-variables.mdx","content/docs/deployment/index.mdx","content/docs/deployment/migration-from-objectql.mdx","content/docs/deployment/production-readiness.mdx","content/docs/deployment/publish-and-preview.mdx","content/docs/deployment/single-project-mode.mdx","content/docs/deployment/troubleshooting.mdx","content/docs/deployment/vercel.mdx","content/docs/getting-started/cli.mdx","content/docs/getting-started/common-patterns.mdx","content/docs/getting-started/examples.mdx","content/docs/getting-started/glossary.mdx","content/docs/getting-started/index.mdx","content/docs/getting-started/quick-reference.mdx","content/docs/getting-started/quick-start.mdx","content/docs/getting-started/validating-metadata.mdx","content/docs/index.mdx","content/docs/kernel/architecture.mdx","content/docs/kernel/cluster.mdx","content/docs/kernel/contracts/auth-service.mdx","content/docs/kernel/contracts/cache-service.mdx","content/docs/kernel/contracts/data-engine.mdx","content/docs/kernel/contracts/index.mdx","content/docs/kernel/contracts/metadata-service.mdx","content/docs/kernel/contracts/storage-service.mdx","content/docs/kernel/events.mdx","content/docs/kernel/index.mdx","content/docs/kernel/runtime-services/audit-service.mdx","content/docs/kernel/runtime-services/data-service.mdx","content/docs/kernel/runtime-services/email-service.mdx","content/docs/kernel/runtime-services/examples.mdx","content/docs/kernel/runtime-services/index.mdx","content/docs/kernel/runtime-services/queue-service.mdx","content/docs/kernel/runtime-services/settings-service.mdx","content/docs/kernel/runtime-services/sharing-service.mdx","content/docs/kernel/runtime-services/storage-service.mdx","content/docs/kernel/runtime-services/versioning.mdx","content/docs/kernel/services-checklist.mdx","content/docs/kernel/services.mdx","content/docs/permissions/access-recipes.mdx","content/docs/permissions/authentication.mdx","content/docs/permissions/authorization.mdx","content/docs/permissions/field-level-security.mdx","content/docs/permissions/index.mdx","content/docs/permissions/permission-metadata.mdx","content/docs/permissions/permission-sets.mdx","content/docs/permissions/permissions-matrix.mdx","content/docs/permissions/profiles.mdx","content/docs/permissions/roles.mdx","content/docs/permissions/sharing-rules.mdx","content/docs/permissions/sso.mdx","content/docs/plugins/adding-a-metadata-type.mdx","content/docs/plugins/anatomy.mdx","content/docs/plugins/development.mdx","content/docs/plugins/index.mdx","content/docs/plugins/packages.mdx","content/docs/protocol/backward-compatibility.mdx","content/docs/protocol/diagram.mdx","content/docs/protocol/index.mdx","content/docs/protocol/knowledge.mdx","content/docs/protocol/objectos/config-resolution.mdx","content/docs/protocol/objectos/error-handling.mdx","content/docs/protocol/objectos/http-protocol.mdx","content/docs/protocol/objectos/i18n-standard.mdx","content/docs/protocol/objectos/index.mdx","content/docs/protocol/objectos/lifecycle.mdx","content/docs/protocol/objectos/metadata-service.mdx","content/docs/protocol/objectos/plugin-spec.mdx","content/docs/protocol/objectos/realtime-protocol.mdx","content/docs/protocol/objectos/runtime-capabilities.mdx","content/docs/protocol/objectql/index.mdx","content/docs/protocol/objectql/query-syntax.mdx","content/docs/protocol/objectql/schema.mdx","content/docs/protocol/objectql/security.mdx","content/docs/protocol/objectql/state-machine.mdx","content/docs/protocol/objectql/types.mdx","content/docs/protocol/objectui/actions.mdx","content/docs/protocol/objectui/concept.mdx","content/docs/protocol/objectui/index.mdx","content/docs/protocol/objectui/layout-dsl.mdx","content/docs/protocol/objectui/record-alert.mdx","content/docs/protocol/objectui/widget-contract.mdx","content/docs/releases/implementation-status.mdx","content/docs/releases/index.mdx","content/docs/releases/v9.mdx","content/docs/ui/apps.mdx","content/docs/ui/create-vs-edit-form.mdx","content/docs/ui/dashboards.mdx","content/docs/ui/doc-pages.mdx","content/docs/ui/field-grouping-and-order.mdx","content/docs/ui/forms.mdx","content/docs/ui/index.mdx","content/docs/ui/pages.mdx","content/docs/ui/public-data-collection.mdx","content/docs/ui/role-based-interfaces.mdx","content/docs/ui/setup-app.mdx","content/docs/ui/views.mdx"]

const DOCS = (args && Array.isArray(args.docs) && args.docs.length) ? args.docs : ALL_HANDWRITTEN

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
- The repo is github.com/objectstack-ai/framework (NOT objectstack-ai/spec). Fix broken cross-repo links/paths accordingly.
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

const FIX_LOG_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['doc', 'implementationFound', 'fixesApplied', 'fixCount', 'unresolved', 'notes'],
  properties: {
    doc: { type: 'string' },
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
1. Read the entire doc (${doc}).
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
    implFound: r.fixLog?.implementationFound,
    confirmed: r.verdict?.confirmed,
    repairs: r.verdict?.correctionsMade?.length || 0,
    regressions: r.verdict?.regressionsFound || [],
    buildSafe: r.verdict?.buildSafe,
    residual: r.verdict?.residualInaccuracies || [],
  })),
}
