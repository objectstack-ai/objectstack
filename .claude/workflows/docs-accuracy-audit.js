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
const ALL_HANDWRITTEN = ["content/docs/concepts/architecture.mdx","content/docs/concepts/cloud-artifact-api.mdx","content/docs/concepts/cluster-semantics.mdx","content/docs/concepts/core/architecture.mdx","content/docs/concepts/core/events.mdx","content/docs/concepts/core/index.mdx","content/docs/concepts/core/plugins.mdx","content/docs/concepts/core/services.mdx","content/docs/concepts/design-principles.mdx","content/docs/concepts/implementation-status.mdx","content/docs/concepts/index.mdx","content/docs/concepts/metadata-driven.mdx","content/docs/concepts/metadata-lifecycle.mdx","content/docs/concepts/north-star.mdx","content/docs/concepts/packages.mdx","content/docs/concepts/setup-app.mdx","content/docs/concepts/skills.mdx","content/docs/concepts/terminology.mdx","content/docs/concepts/webhook-delivery.mdx","content/docs/getting-started/architecture.mdx","content/docs/getting-started/cli.mdx","content/docs/getting-started/core-concepts.mdx","content/docs/getting-started/examples.mdx","content/docs/getting-started/glossary.mdx","content/docs/getting-started/index.mdx","content/docs/getting-started/quick-start.mdx","content/docs/guides/adding-a-metadata-type.mdx","content/docs/guides/ai-capabilities.mdx","content/docs/guides/airtable-dashboard-analysis.mdx","content/docs/guides/analytics-datasets.mdx","content/docs/guides/api-reference.mdx","content/docs/guides/auth-sso.mdx","content/docs/guides/authentication.mdx","content/docs/guides/business-logic.mdx","content/docs/guides/cheatsheets/backward-compatibility.mdx","content/docs/guides/cheatsheets/error-catalog.mdx","content/docs/guides/cheatsheets/field-type-decision-tree.mdx","content/docs/guides/cheatsheets/field-type-gallery.mdx","content/docs/guides/cheatsheets/field-validation-rules.mdx","content/docs/guides/cheatsheets/permissions-matrix.mdx","content/docs/guides/cheatsheets/protocol-diagram.mdx","content/docs/guides/cheatsheets/query-cheat-sheet.mdx","content/docs/guides/cheatsheets/quick-reference.mdx","content/docs/guides/cheatsheets/wire-format.mdx","content/docs/guides/client-sdk.mdx","content/docs/guides/cloud-deployment.mdx","content/docs/guides/common-patterns.mdx","content/docs/guides/contracts/auth-service.mdx","content/docs/guides/contracts/cache-service.mdx","content/docs/guides/contracts/data-engine.mdx","content/docs/guides/contracts/index.mdx","content/docs/guides/contracts/metadata-service.mdx","content/docs/guides/contracts/storage-service.mdx","content/docs/guides/data-flow.mdx","content/docs/guides/data-modeling.mdx","content/docs/guides/deployment-vercel.mdx","content/docs/guides/driver-configuration.mdx","content/docs/guides/environment-variables.mdx","content/docs/guides/error-handling-client.mdx","content/docs/guides/error-handling-server.mdx","content/docs/guides/formula.mdx","content/docs/guides/hook-bodies.mdx","content/docs/guides/index.mdx","content/docs/guides/kernel-services.mdx","content/docs/guides/metadata/app.mdx","content/docs/guides/metadata/dashboard.mdx","content/docs/guides/metadata/doc.mdx","content/docs/guides/metadata/field.mdx","content/docs/guides/metadata/flow.mdx","content/docs/guides/metadata/index.mdx","content/docs/guides/metadata/object.mdx","content/docs/guides/metadata/page.mdx","content/docs/guides/metadata/permission.mdx","content/docs/guides/metadata/validation.mdx","content/docs/guides/metadata/view.mdx","content/docs/guides/metadata/workflow.mdx","content/docs/guides/objectql-migration.mdx","content/docs/guides/packages.mdx","content/docs/guides/plugin-chatbot-integration.mdx","content/docs/guides/plugin-development.mdx","content/docs/guides/plugins.mdx","content/docs/guides/production-readiness.mdx","content/docs/guides/project-scoping.mdx","content/docs/guides/public-forms.mdx","content/docs/guides/publish-and-preview.mdx","content/docs/guides/runtime-services/audit-service.mdx","content/docs/guides/runtime-services/data-service.mdx","content/docs/guides/runtime-services/email-service.mdx","content/docs/guides/runtime-services/examples.mdx","content/docs/guides/runtime-services/index.mdx","content/docs/guides/runtime-services/queue-service.mdx","content/docs/guides/runtime-services/settings-service.mdx","content/docs/guides/runtime-services/sharing-service.mdx","content/docs/guides/runtime-services/storage-service.mdx","content/docs/guides/runtime-services/versioning.mdx","content/docs/guides/security.mdx","content/docs/guides/seed-data.mdx","content/docs/guides/single-project-mode.mdx","content/docs/guides/skills.mdx","content/docs/guides/standards.mdx","content/docs/guides/troubleshooting.mdx","content/docs/index.mdx","content/docs/protocol/index.mdx","content/docs/protocol/knowledge.mdx","content/docs/protocol/objectos/config-resolution.mdx","content/docs/protocol/objectos/error-handling.mdx","content/docs/protocol/objectos/http-protocol.mdx","content/docs/protocol/objectos/i18n-standard.mdx","content/docs/protocol/objectos/index.mdx","content/docs/protocol/objectos/lifecycle.mdx","content/docs/protocol/objectos/metadata-service.mdx","content/docs/protocol/objectos/plugin-spec.mdx","content/docs/protocol/objectos/realtime-protocol.mdx","content/docs/protocol/objectos/runtime-capabilities.mdx","content/docs/protocol/objectql/index.mdx","content/docs/protocol/objectql/query-syntax.mdx","content/docs/protocol/objectql/schema.mdx","content/docs/protocol/objectql/security.mdx","content/docs/protocol/objectql/state-machine.mdx","content/docs/protocol/objectql/types.mdx","content/docs/protocol/objectui/actions.mdx","content/docs/protocol/objectui/concept.mdx","content/docs/protocol/objectui/index.mdx","content/docs/protocol/objectui/layout-dsl.mdx","content/docs/protocol/objectui/record-alert.mdx","content/docs/protocol/objectui/widget-contract.mdx","content/docs/releases/index.mdx","content/docs/releases/v9.mdx"]

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
