/**
 * Permanent redirects from the pre-2026-07 docs IA (type-based: guides/concepts/
 * getting-started grab-bags) to the module-based IA (data-modeling, automation,
 * permissions, ui, api, ai, plugins, kernel, deployment, ...).
 *
 * This table is the single source of truth for the migration: next.config.mjs
 * serves it as HTTP redirects, and scripts used during the migration rewrote
 * in-content links from the same pairs. Exact entries come first; wildcard
 * catch-alls for retired sections must stay last (first match wins).
 */
export const docsRedirects = [
  // getting-started
  ['/docs/guides/cheatsheets/quick-reference', '/docs/getting-started/quick-reference'],
  ['/docs/guides/common-patterns', '/docs/getting-started/common-patterns'],
  ['/docs/guides/validating-metadata', '/docs/getting-started/validating-metadata'],
  // concepts
  ['/docs/getting-started/core-concepts', '/docs/concepts'],
  ['/docs/getting-started/architecture', '/docs/concepts/architecture'],
  ['/docs/concepts/terminology', '/docs/getting-started/glossary'],
  // data-modeling
  ['/docs/guides/data-modeling', '/docs/data-modeling'],
  ['/docs/guides/metadata/object', '/docs/data-modeling/objects'],
  ['/docs/guides/metadata/field', '/docs/data-modeling/fields'],
  ['/docs/guides/cheatsheets/field-type-gallery', '/docs/data-modeling/field-types'],
  ['/docs/guides/cheatsheets/field-type-decision-tree', '/docs/data-modeling/field-type-decision-tree'],
  ['/docs/guides/metadata/validation', '/docs/data-modeling/validation'],
  ['/docs/guides/cheatsheets/field-validation-rules', '/docs/data-modeling/validation-rules'],
  ['/docs/guides/formula', '/docs/data-modeling/formulas'],
  ['/docs/guides/cheatsheets/query-cheat-sheet', '/docs/data-modeling/queries'],
  ['/docs/guides/seed-data', '/docs/data-modeling/seed-data'],
  ['/docs/guides/external-datasources', '/docs/data-modeling/external-datasources'],
  ['/docs/guides/driver-configuration', '/docs/data-modeling/drivers'],
  ['/docs/guides/analytics-datasets', '/docs/data-modeling/analytics'],
  ['/docs/guides/airtable-dashboard-analysis', '/docs/data-modeling/analytics'],
  // automation
  ['/docs/guides/business-logic', '/docs/automation/hooks'],
  ['/docs/guides/hook-bodies', '/docs/automation/hook-bodies'],
  ['/docs/guides/metadata/flow', '/docs/automation/flows'],
  ['/docs/guides/metadata/workflow', '/docs/automation/workflows'],
  ['/docs/guides/solutions/approval-workflow', '/docs/automation/approvals'],
  ['/docs/concepts/webhook-delivery', '/docs/automation/webhooks'],
  // permissions
  ['/docs/guides/security', '/docs/permissions'],
  ['/docs/guides/authentication', '/docs/permissions/authentication'],
  ['/docs/guides/auth-sso', '/docs/permissions/sso'],
  ['/docs/concepts/authorization', '/docs/permissions/authorization'],
  ['/docs/guides/metadata/permission', '/docs/permissions/permission-metadata'],
  ['/docs/guides/cheatsheets/permissions-matrix', '/docs/permissions/permissions-matrix'],
  ['/docs/guides/solutions/data-automation-interface-access', '/docs/permissions/access-recipes'],
  // ui
  ['/docs/guides/metadata/app', '/docs/ui/apps'],
  ['/docs/guides/metadata/page', '/docs/ui/pages'],
  ['/docs/guides/metadata/view', '/docs/ui/views'],
  ['/docs/guides/metadata/dashboard', '/docs/ui/dashboards'],
  ['/docs/guides/public-forms', '/docs/ui/forms'],
  ['/docs/guides/metadata/doc', '/docs/ui/doc-pages'],
  ['/docs/concepts/setup-app', '/docs/ui/setup-app'],
  ['/docs/guides/solutions/create-vs-edit-form', '/docs/ui/create-vs-edit-form'],
  ['/docs/guides/solutions/field-grouping-and-order', '/docs/ui/field-grouping-and-order'],
  ['/docs/guides/solutions/role-based-interfaces', '/docs/ui/role-based-interfaces'],
  ['/docs/guides/solutions/public-data-collection', '/docs/ui/public-data-collection'],
  // api
  ['/docs/guides/api-reference', '/docs/api'],
  ['/docs/guides/client-sdk', '/docs/api/client-sdk'],
  ['/docs/guides/project-scoping', '/docs/api/environment-routing'],
  ['/docs/guides/data-flow', '/docs/api/data-flow'],
  ['/docs/guides/error-handling-client', '/docs/api/error-handling-client'],
  ['/docs/guides/error-handling-server', '/docs/api/error-handling-server'],
  ['/docs/guides/cheatsheets/error-catalog', '/docs/api/error-catalog'],
  ['/docs/guides/cheatsheets/wire-format', '/docs/api/wire-format'],
  // ai
  ['/docs/guides/ai-capabilities', '/docs/ai'],
  ['/docs/concepts/skills', '/docs/ai/skills'],
  ['/docs/guides/skills', '/docs/ai/skills-reference'],
  ['/docs/guides/plugin-chatbot-integration', '/docs/ai/chatbot-integration'],
  // plugins
  ['/docs/guides/plugins', '/docs/plugins'],
  ['/docs/guides/plugin-development', '/docs/plugins/development'],
  ['/docs/guides/packages', '/docs/plugins/packages'],
  ['/docs/concepts/packages', '/docs/plugins/packages'],
  ['/docs/guides/adding-a-metadata-type', '/docs/plugins/adding-a-metadata-type'],
  ['/docs/concepts/core/plugins', '/docs/plugins/anatomy'],
  // kernel
  ['/docs/concepts/core/architecture', '/docs/kernel/architecture'],
  ['/docs/concepts/core/events', '/docs/kernel/events'],
  ['/docs/concepts/core/services', '/docs/kernel/services'],
  ['/docs/concepts/core', '/docs/kernel'],
  ['/docs/guides/kernel-services', '/docs/kernel/services-checklist'],
  ['/docs/concepts/cluster-semantics', '/docs/kernel/cluster'],
  // deployment
  ['/docs/guides/cloud-deployment', '/docs/deployment'],
  ['/docs/guides/deployment-vercel', '/docs/deployment/vercel'],
  ['/docs/guides/production-readiness', '/docs/deployment/production-readiness'],
  ['/docs/guides/publish-and-preview', '/docs/deployment/publish-and-preview'],
  ['/docs/guides/environment-variables', '/docs/deployment/environment-variables'],
  ['/docs/guides/single-project-mode', '/docs/deployment/single-project-mode'],
  ['/docs/concepts/cloud-artifact-api', '/docs/deployment/cloud-artifact-api'],
  ['/docs/guides/objectql-migration', '/docs/deployment/migration-from-objectql'],
  ['/docs/guides/troubleshooting', '/docs/deployment/troubleshooting'],
  // protocol / releases
  ['/docs/guides/cheatsheets/protocol-diagram', '/docs/protocol/diagram'],
  ['/docs/guides/cheatsheets/backward-compatibility', '/docs/protocol/backward-compatibility'],
  ['/docs/concepts/implementation-status', '/docs/releases/implementation-status'],
  // retired pages / sections
  ['/docs/guides/standards', '/docs/concepts/design-principles'],
  ['/docs/guides/metadata', '/docs/concepts/metadata-driven'],
  ['/docs/guides/solutions', '/docs'],
  ['/docs/guides/cheatsheets', '/docs/getting-started/quick-reference'],
  // folder moves (wildcards — keep after exact entries)
  ['/docs/guides/runtime-services/:path*', '/docs/kernel/runtime-services/:path*'],
  ['/docs/guides/contracts/:path*', '/docs/kernel/contracts/:path*'],
  // safety net for anything else under retired sections — keep last
  ['/docs/guides/:path*', '/docs'],
];

/** Next.js redirects() entries derived from the table above. */
export function toNextRedirects() {
  return docsRedirects.map(([source, destination]) => ({
    source,
    destination,
    permanent: true,
  }));
}
