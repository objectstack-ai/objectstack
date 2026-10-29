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
  ['/docs/guides/validating-metadata', '/docs/deployment/validating-metadata'],
  // 2026-07 audience-first IA: tooling pages moved out of getting-started
  ['/docs/getting-started/cli', '/docs/deployment/cli'],
  ['/docs/getting-started/validating-metadata', '/docs/deployment/validating-metadata'],
  // concepts
  ['/docs/getting-started/core-concepts', '/docs/concepts'],
  ['/docs/getting-started/architecture', '/docs/concepts/architecture'],
  ['/docs/concepts/terminology', '/docs/getting-started/glossary'],
  // The architecture page was published as `north-star`; "North Star" now names
  // only docs/NORTH-STAR.md (goals and priority), so the page took an honest slug.
  ['/docs/concepts/north-star', '/docs/concepts/architecture-overview'],
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
  ['/docs/concepts/setup-app', '/docs/ui/apps'],
  // 2026-10-28: the Setup, Console and Studio pages were retired. Their
  // author-facing facts moved into apps, views, actions, approvals and
  // validating-metadata; the product tour is build-without-code.
  ['/docs/ui/setup-app', '/docs/ui/apps'],
  ['/docs/ui/console', '/docs/build-without-code'],
  ['/docs/ui/studio', '/docs/build-without-code'],
  ['/docs/guides/solutions/create-vs-edit-form', '/docs/ui/create-vs-edit-form'],
  ['/docs/guides/solutions/field-grouping-and-order', '/docs/ui/field-grouping-and-order'],
  // The page was renamed role-based -> audience-based (the direction
  // check:role-word enforces); the redirect kept the old destination.
  ['/docs/guides/solutions/role-based-interfaces', '/docs/ui/audience-based-interfaces'],
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
  // ai/chatbot-integration.mdx was deleted as cloud-only content, with no
  // successor page in this repo — its nav entry and inbound links were removed
  // rather than re-pointed. Lands on the section index, whose callout is what
  // now carries the in-product chat runtime's story.
  ['/docs/guides/plugin-chatbot-integration', '/docs/ai'],
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
  ['/docs/guides/deployment-vercel', '/docs/deployment/self-hosting'],
  ['/docs/guides/production-readiness', '/docs/deployment/production-readiness'],
  ['/docs/guides/publish-and-preview', '/docs/deployment/publish-and-preview'],
  ['/docs/guides/environment-variables', '/docs/deployment/environment-variables'],
  ['/docs/guides/single-project-mode', '/docs/deployment/single-project-mode'],
  // deployment/cloud-artifact-api.mdx was deleted in the same cloud-only sweep;
  // publish-and-preview dropped its cross-link instead of absorbing the content,
  // so there is no successor page. Section index, same as the objectql-migration
  // entry below.
  ['/docs/concepts/cloud-artifact-api', '/docs/deployment'],
  ['/docs/guides/objectql-migration', '/docs/deployment'],
  ['/docs/guides/troubleshooting', '/docs/deployment/troubleshooting'],
  // Retired deployment pages (maintainer ruling 2026-08-15). Docker /
  // self-hosting is the shipping path, so the Vercel guide lands on
  // self-hosting; the `@objectql/core` port guide has no successor page, so it
  // lands on the section index. The two `/docs/guides/*` entries ABOVE are
  // re-pointed at these same destinations rather than left aimed here: Next
  // matches this table once per request, so a chained entry would cost the old
  // URLs a second round trip (and every redirect hop is SEO signal lost).
  ['/docs/deployment/vercel', '/docs/deployment/self-hosting'],
  ['/docs/deployment/migration-from-objectql', '/docs/deployment'],
  // protocol / releases
  ['/docs/guides/cheatsheets/protocol-diagram', '/docs/protocol/diagram'],
  ['/docs/guides/cheatsheets/backward-compatibility', '/docs/protocol/backward-compatibility'],
  ['/docs/concepts/implementation-status', '/docs/releases/implementation-status'],
  // retired pages / sections
  ['/docs/guides/standards', '/docs/concepts/design-principles'],
  ['/docs/guides/metadata', '/docs/concepts/metadata-driven'],
  ['/docs/guides/solutions', '/docs'],
  ['/docs/guides/cheatsheets', '/docs/getting-started/quick-reference'],
  // `content/docs/references/cloud/` retired with the `@objectstack/spec/cloud`
  // subpath (#16325). The package & marketplace format pages moved to
  // `references/marketplace/`; the environment-artifact page documents the
  // `system/` declaration it only ever re-exported; the cloud control plane's
  // own contract pages (environment, environment-package, tenant,
  // developer-portal, marketplace-admin, app-store) have no successor page —
  // section index, same as the cloud-artifact-api entry above.
  ['/docs/references/cloud/marketplace', '/docs/references/marketplace/marketplace'],
  ['/docs/references/cloud/package', '/docs/references/marketplace/package'],
  ['/docs/references/cloud/package-version', '/docs/references/marketplace/package-version'],
  ['/docs/references/cloud/template-manifest', '/docs/references/marketplace/template-manifest'],
  ['/docs/references/cloud/environment-artifact', '/docs/references/system/environment-artifact'],
  // folder moves (wildcards — keep after exact entries)
  ['/docs/references/cloud/:path*', '/docs/references'],
  ['/docs/guides/runtime-services/:path*', '/docs/kernel/runtime-services/:path*'],
  ['/docs/guides/contracts/:path*', '/docs/kernel/contracts/:path*'],
  // ObjectOS layer-name retirement: the System Protocol section is now "kernel"
  // (:path* matches zero or more segments, so this also covers the bare URL)
  ['/docs/protocol/objectos/:path*', '/docs/protocol/kernel/:path*'],
  // safety net for anything else under retired sections — keep last
  ['/docs/guides/:path*', '/docs'],
];

/**
 * The blog moved to the product site. www.objectos.ai is the one blog
 * (maintainer ruling 2026-10-26: product site vs developer site); the four
 * posts this site published under `/blog/<slug>` were imported there under the
 * same slugs, at `/en/blog/<slug>/` (the product site's locales are its own
 * concern — English is the canonical import). Every old URL answers a permanent
 * redirect to its counterpart, and the index to the product blog's index.
 *
 * Both spellings a reader can hold are listed: the public `/blog/<slug>` and the
 * locale-prefixed `/en/blog/<slug>` every post was prerendered under (the
 * default locale of `apps/docs/lib/i18n.ts`, hidden from public URLs by
 * `proxy.ts`). Next evaluates `redirects()` BEFORE the proxy, so the prefixed
 * form goes straight to the product site instead of paying the proxy's 307 to
 * `/blog/<slug>` first.
 *
 * Deliberately a second table, not rows in `docsRedirects`:
 * `scripts/check-docs-redirects.mjs` resolves every destination of that table
 * against `content/docs` and reports an off-site destination as UNRESOLVABLE
 * — correct for a docs redirect, meaningless for a cross-site one. This table
 * is outside that gate's reach; what holds it honest is the product site
 * serving the slugs below (its import is the precondition for landing this
 * table at all) and `scripts/check-published-readme-links.mjs`, which reads
 * `docsRedirects` alone and is unaffected.
 *
 * The `.mdx` sources under `content/blog` and the `app/[lang]/blog` route are
 * still in the tree while these redirects go live; removing them is the
 * follow-up, once the redirects are measured answering on production.
 */
/**
 * The product site's origin. Declared here — the one dependency-free module
 * both halves can read — and re-exported by `lib/layout.shared.tsx` as
 * `PRODUCT_SITE_URL` for the nav, the home page and the footer line, so the
 * cross-site links and the cross-site redirects can never name two hosts.
 */
export const PRODUCT_SITE_ORIGIN = 'https://www.objectos.ai';

/** The posts imported by the product site, by slug — one redirect pair each. */
export const MOVED_POSTS = [
  'context-window-is-the-constraint',
  'metadata-driven-architecture',
  'protocol-first-development',
  'the-ontology-is-the-software',
];

/** `''` is the public spelling; `/en` the prerendered one (see above). */
const BLOG_PATH_PREFIXES = ['', '/en'];

export const blogRedirects = BLOG_PATH_PREFIXES.flatMap((prefix) => [
  [`${prefix}/blog`, `${PRODUCT_SITE_ORIGIN}/en/blog/`],
  ...MOVED_POSTS.map((slug) => [`${prefix}/blog/${slug}`, `${PRODUCT_SITE_ORIGIN}/en/blog/${slug}/`]),
]);

/** Next.js redirects() entries derived from the two tables above. */
export function toNextRedirects() {
  return [...docsRedirects, ...blogRedirects].map(([source, destination]) => ({
    source,
    destination,
    permanent: true,
  }));
}
