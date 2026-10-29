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

/**
 * This site's own origin, declared here for the same reason as
 * `PRODUCT_SITE_ORIGIN`: `lib/site.ts` re-exports it as `SITE_ORIGIN` for the
 * sitemap, `robots.txt` and the canonical links, and the cross-host redirects
 * below name it, so the two can never name two hosts.
 */
export const DOCS_SITE_ORIGIN = 'https://objectstack.ai';

/**
 * The hosts the retired ObjectUI docs site answered on. `has` values are
 * anchored regular expressions in Next (`^…$`), matched against the request's
 * hostname with any port removed.
 */
export const OBJECTUI_HOST_PATTERN = '(?:www\\.)?objectui\\.org';

/**
 * www.objectui.org folded into this site: its pages moved to `/docs/frontend`
 * (the ObjectUI SDK and its renderers), into the metadata pages they described,
 * and into the generated component reference. Each row is an old objectui.org
 * path and the path on THIS site that carries its content now.
 *
 * The rows are host-scoped (`has: [{ type: 'host' }]`, see `toNextRedirects`):
 * they fire only for a request whose host is objectui.org or www.objectui.org,
 * and answer a permanent redirect to the same path on `DOCS_SITE_ORIGIN`. So
 * they are inert until those domains point at this Vercel project, and they
 * can never shadow one of this site's own URLs: `/docs/plugins` on objectui.org
 * is the old plugin gallery, `/docs/plugins` here is the plugins section.
 *
 * Every published path of the old site has a row: the 183 pages under its
 * `content/docs` at the fold, by their URL. The final row catches everything
 * else the site served (the home page, the playground, `llms.txt`, OG images)
 * and sends it to the SDK section's landing page. First match wins, so it stays
 * last.
 *
 * `scripts/check-docs-redirects.mjs` holds this table to the same rules as
 * `docsRedirects`, judged on the host the destination is served from: every
 * destination resolves to a real page under `content/docs`, and none is a
 * source of `docsRedirects` (that would be a second hop).
 */
export const objectuiRedirects = [
  // The ObjectUI SDK guide and the renderer-type pages, now under /docs/frontend.
  ['/docs', '/docs/frontend'],
  ['/docs/guide/quick-start', '/docs/frontend/quick-start'],
  ['/docs/guide/building-crud-app', '/docs/frontend/building-crud-app'],
  ['/docs/guide/architecture-overview', '/docs/frontend/architecture-overview'],
  ['/docs/guide/schema-overview', '/docs/frontend'],
  ['/docs/guide/schema-rendering', '/docs/frontend/schema-rendering'],
  ['/docs/guide/component-registry', '/docs/frontend/component-registry'],
  ['/docs/guide/fields', '/docs/frontend/fields'],
  ['/docs/guide/plugins', '/docs/frontend/plugins'],
  ['/docs/guide/plugin-development', '/docs/frontend/plugin-development'],
  ['/docs/guide/data-source', '/docs/frontend/data-source'],
  ['/docs/guide/layout', '/docs/frontend/layout'],
  ['/docs/guide/theming', '/docs/frontend/theming'],
  ['/docs/guide/troubleshooting', '/docs/frontend/troubleshooting'],
  ['/docs/core/schema-renderer', '/docs/frontend/schema-rendering'],
  ['/docs/layout/app-shell', '/docs/frontend/app-shell'],
  ['/docs/layout/sidebar-nav', '/docs/frontend/sidebar-nav'],
  ['/docs/api/schema-reference', '/docs/ui/components'],
  ['/docs/utilities/cli', '/docs/frontend/cli'],
  ['/docs/utilities/create-plugin', '/docs/frontend/create-plugin'],
  ['/docs/utilities/data-objectstack', '/docs/frontend/data-objectstack'],
  ['/docs/plugins', '/docs/frontend/plugins'],
  ['/docs/plugins/plugin-calendar', '/docs/frontend/plugins/plugin-calendar'],
  ['/docs/plugins/plugin-charts', '/docs/frontend/plugins/plugin-charts'],
  ['/docs/plugins/plugin-chatbot', '/docs/frontend/plugins/plugin-chatbot'],
  ['/docs/plugins/plugin-dashboard', '/docs/frontend/plugins/plugin-dashboard'],
  ['/docs/plugins/plugin-detail', '/docs/frontend/plugins/plugin-detail'],
  ['/docs/plugins/plugin-editor', '/docs/frontend/plugins/plugin-editor'],
  ['/docs/plugins/plugin-form', '/docs/frontend/plugins/plugin-form'],
  ['/docs/plugins/plugin-gantt', '/docs/frontend/plugins/plugin-gantt'],
  ['/docs/plugins/plugin-grid', '/docs/frontend/plugins/plugin-grid'],
  ['/docs/plugins/plugin-kanban', '/docs/frontend/plugins/plugin-kanban'],
  ['/docs/plugins/plugin-list', '/docs/frontend/plugins/plugin-list'],
  ['/docs/plugins/plugin-map', '/docs/frontend/plugins/plugin-map'],
  ['/docs/plugins/plugin-markdown', '/docs/frontend/plugins/plugin-markdown'],
  ['/docs/plugins/plugin-report', '/docs/ui/reports'],
  ['/docs/plugins/plugin-timeline', '/docs/frontend/plugins/plugin-timeline'],
  ['/docs/plugins/plugin-view', '/docs/frontend/plugins/plugin-view'],
  ['/docs/components/basic/button-group', '/docs/frontend/renderers#basic'],
  ['/docs/components/basic/div', '/docs/frontend/renderers#basic'],
  ['/docs/components/basic/navigation-menu', '/docs/frontend/renderers#basic'],
  ['/docs/components/basic/pagination', '/docs/frontend/renderers#basic'],
  ['/docs/components/basic/separator', '/docs/frontend/renderers#basic'],
  ['/docs/components/basic/sidebar', '/docs/frontend/renderers#basic'],
  ['/docs/components/complex/carousel', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/data-table', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/filter-builder', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/filter-ui', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/resizable', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/scroll-area', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/sort-ui', '/docs/frontend/renderers#complex'],
  ['/docs/components/complex/view-switcher', '/docs/frontend/renderers#complex'],
  ['/docs/components/data-display/avatar', '/docs/frontend/renderers#data-display'],
  ['/docs/components/data-display/breadcrumb', '/docs/frontend/renderers#data-display'],
  ['/docs/components/data-display/kbd', '/docs/frontend/renderers#data-display'],
  ['/docs/components/data-display/list', '/docs/frontend/renderers#data-display'],
  ['/docs/components/data-display/statistic', '/docs/frontend/renderers#data-display'],
  ['/docs/components/data-display/tree-view', '/docs/frontend/renderers#data-display'],
  ['/docs/components/disclosure/collapsible', '/docs/frontend/renderers#disclosure'],
  ['/docs/components/disclosure/toggle-group', '/docs/frontend/renderers#disclosure'],
  ['/docs/components/feedback/empty', '/docs/frontend/renderers#feedback'],
  ['/docs/components/feedback/loading', '/docs/frontend/renderers#feedback'],
  ['/docs/components/feedback/progress', '/docs/frontend/renderers#feedback'],
  ['/docs/components/feedback/skeleton', '/docs/frontend/renderers#feedback'],
  ['/docs/components/feedback/sonner', '/docs/frontend/renderers#feedback'],
  ['/docs/components/feedback/spinner', '/docs/frontend/renderers#feedback'],
  ['/docs/components/feedback/toast', '/docs/frontend/renderers#feedback'],
  ['/docs/components/form/calendar', '/docs/frontend/renderers#form'],
  ['/docs/components/form/checkbox', '/docs/frontend/renderers#form'],
  ['/docs/components/form/combobox', '/docs/frontend/renderers#form'],
  ['/docs/components/form/command', '/docs/frontend/renderers#form'],
  ['/docs/components/form/date-picker', '/docs/frontend/renderers#form'],
  ['/docs/components/form/file-upload', '/docs/frontend/renderers#form'],
  ['/docs/components/form/form', '/docs/frontend/renderers#form'],
  ['/docs/components/form/input-otp', '/docs/frontend/renderers#form'],
  ['/docs/components/form/input', '/docs/frontend/renderers#form'],
  ['/docs/components/form/radio-group', '/docs/frontend/renderers#form'],
  ['/docs/components/form/select', '/docs/frontend/renderers#form'],
  ['/docs/components/form/slider', '/docs/frontend/renderers#form'],
  ['/docs/components/form/switch', '/docs/frontend/renderers#form'],
  ['/docs/components/form/textarea', '/docs/frontend/renderers#form'],
  ['/docs/components/form/toggle', '/docs/frontend/renderers#form'],
  ['/docs/components/layout/aspect-ratio', '/docs/frontend/renderers#layout'],
  ['/docs/components/layout/page', '/docs/frontend/renderers#layout'],
  ['/docs/components/navigation/header-bar', '/docs/frontend/renderers#navigation'],
  ['/docs/components/overlay/alert-dialog', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/context-menu', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/dialog', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/drawer', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/dropdown-menu', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/hover-card', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/menubar', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/popover', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/sheet', '/docs/frontend/renderers#overlay'],
  ['/docs/components/overlay/tooltip', '/docs/frontend/renderers#overlay'],
  // Pages merged into the metadata pages. The Console and Studio guides aim at
  // where their facts went, never at the retired /docs/ui/{console,studio}
  // pages, which redirect themselves (a chain).
  ['/docs/fields/auto-number', '/docs/data-modeling/field-types#autonumber'],
  ['/docs/fields/boolean', '/docs/data-modeling/field-types#boolean'],
  ['/docs/fields/currency', '/docs/data-modeling/field-types#currency'],
  ['/docs/fields/date', '/docs/data-modeling/field-types#date'],
  ['/docs/fields/datetime', '/docs/data-modeling/field-types#datetime'],
  ['/docs/fields/email', '/docs/data-modeling/field-types#email'],
  ['/docs/fields/file', '/docs/data-modeling/field-types#media-types'],
  ['/docs/fields/formula', '/docs/data-modeling/field-types#formula'],
  ['/docs/fields/grid', '/docs/data-modeling/field-types#master_detail'],
  ['/docs/fields/image', '/docs/data-modeling/field-types#image'],
  ['/docs/fields/location', '/docs/data-modeling/field-types#location'],
  ['/docs/fields/lookup', '/docs/data-modeling/field-types#lookup'],
  ['/docs/fields/number', '/docs/data-modeling/field-types#number'],
  ['/docs/fields/object', '/docs/data-modeling/field-types#json'],
  ['/docs/fields/password', '/docs/data-modeling/field-types#password'],
  ['/docs/fields/percent', '/docs/data-modeling/field-types#percent'],
  ['/docs/fields/phone', '/docs/data-modeling/field-types#phone'],
  ['/docs/fields/rich-text', '/docs/data-modeling/field-types#richtext'],
  ['/docs/fields/select', '/docs/data-modeling/field-types#select'],
  ['/docs/fields/summary', '/docs/data-modeling/field-types#summary'],
  ['/docs/fields/text', '/docs/data-modeling/field-types#text'],
  ['/docs/fields/textarea', '/docs/data-modeling/field-types#textarea'],
  ['/docs/fields/time', '/docs/data-modeling/field-types#time'],
  ['/docs/fields/url', '/docs/data-modeling/field-types#url'],
  ['/docs/fields/user', '/docs/data-modeling/field-types#user'],
  ['/docs/fields/vector', '/docs/data-modeling/field-types#vector'],
  ['/docs/fields/widget-props', '/docs/data-modeling/field-types#how-the-console-renders-a-field'],
  ['/docs/guide/console', '/docs/build-without-code'],
  ['/docs/guide/metadata-diagnostics', '/docs/deployment/validating-metadata#metadata-diagnostics-on-load'],
  ['/docs/guide/flow-designer', '/docs/automation/flows'],
  ['/docs/guide/notifications', '/docs/build-without-code'],
  ['/docs/guide/slotted-pages', '/docs/ui/pages#record-pages'],
  ['/docs/guide/record-edit-modes', '/docs/ui/create-vs-edit-form#modal-or-page-editmode'],
  ['/docs/guide/designing-app-navigation', '/docs/ui/apps#designing-the-navigation'],
  ['/docs/guide/dashboard-filters', '/docs/ui/dashboards#filter-controls-and-options'],
  ['/docs/guide/public-forms', '/docs/ui/forms#6-internal-forms-_consoleformsname'],
  ['/docs/guide/user-state-persistence', '/docs/ui/views#a-users-list-state-never-writes-the-view'],
  ['/docs/guide/expressions', '/docs/ui/pages#expression-holes-in-element-properties'],
  ['/docs/guide/print-pages', '/docs/ui/print-pages#print-in-the-browser'],
  ['/docs/guide/react-pages', '/docs/ui/react-pages'],
  ['/docs/guide/agent-skills', '/docs/ai/skills#the-skill-catalog'],
  ['/docs/core/app-schema', '/docs/ui/apps#action-navigation'],
  ['/docs/core/report-schema', '/docs/ui/reports'],
  ['/docs/core/enhanced-actions', '/docs/ui/actions#collect-input-and-shape-the-ux'],
  ['/docs/core/theme-schema', '/docs/ui/apps#branding'],
  ['/docs/layout/page-header', '/docs/ui/pages#the-page-header'],
  // Component pages replaced by the generated component reference.
  ['/docs/components', '/docs/ui/components'],
  ['/docs/components/basic/icon', '/docs/ui/components/ui#icon'],
  ['/docs/components/basic/image', '/docs/ui/components/ui#image'],
  ['/docs/components/basic/span', '/docs/ui/components/html#span'],
  ['/docs/components/basic/text', '/docs/ui/components/ui#text'],
  ['/docs/components/complex/table', '/docs/ui/components/html#table'],
  ['/docs/components/data-display/alert', '/docs/ui/components/ui#alert'],
  ['/docs/components/data-display/badge', '/docs/ui/components/ui#badge'],
  ['/docs/components/disclosure/accordion', '/docs/ui/components/ui#accordion'],
  ['/docs/components/form/button', '/docs/ui/components/ui#button'],
  ['/docs/components/form/label', '/docs/ui/components/html#label'],
  ['/docs/components/layout/box', '/docs/ui/components/ui#box'],
  ['/docs/components/layout/card', '/docs/ui/components/ui#card'],
  ['/docs/components/layout/container', '/docs/ui/components/ui#container'],
  ['/docs/components/layout/flex', '/docs/ui/components/ui#flex'],
  ['/docs/components/layout/grid', '/docs/ui/components/ui#grid'],
  ['/docs/components/layout/stack', '/docs/ui/components/ui#stack'],
  ['/docs/components/layout/tabs', '/docs/ui/components/ui#tabs'],
  // Pages deleted outright: the nearest section index.
  ['/docs/guide', '/docs/frontend'],
  ['/docs/guide/architecture', '/docs/frontend'],
  ['/docs/guide/console-architecture', '/docs/frontend'],
  ['/docs/guide/deployment', '/docs/frontend'],
  ['/docs/guide/objectos-integration', '/docs/frontend'],
  ['/docs/guide/release-notes', '/docs/frontend'],
  ['/docs/guide/schema-catalog', '/docs/frontend'],
  ['/docs/guide/schema-playground', '/docs/frontend'],
  ['/docs/blocks', '/docs/frontend'],
  ['/docs/blocks/authentication', '/docs/frontend'],
  ['/docs/blocks/dashboard', '/docs/frontend'],
  ['/docs/blocks/ecommerce', '/docs/frontend'],
  ['/docs/blocks/forms', '/docs/frontend'],
  ['/docs/blocks/marketing', '/docs/frontend'],
  ['/docs/api', '/docs/frontend'],
  ['/docs/utilities', '/docs/frontend'],
  ['/docs/utilities/runner', '/docs/frontend'],
  ['/docs/utilities/vscode-extension', '/docs/frontend'],
  ['/docs/rfcs/0001-clipboard-paste', '/docs/frontend'],
  ['/docs/plugins/plugin-ai', '/docs/frontend/plugins'],
  ['/docs/plugins/plugin-designer', '/docs/frontend/plugins'],
  ['/docs/plugins/plugin-calendar-view', '/docs/frontend/plugins/plugin-calendar'],
  ['/docs/components/feedback/toaster', '/docs/frontend/renderers#feedback'],
  ['/docs/components/layout/semantic', '/docs/frontend/renderers#layout'],
  // Everything else the old site served — keep last.
  ['/:path*', '/docs/frontend'],
];

/** Next.js redirects() entries derived from the three tables above. */
export function toNextRedirects() {
  // The host-scoped rows come first: a request on objectui.org must never fall
  // through to a row written for this site's own paths.
  const objectui = objectuiRedirects.map(([source, destination]) => ({
    source,
    destination: `${DOCS_SITE_ORIGIN}${destination}`,
    permanent: true,
    has: [{ type: 'host', value: OBJECTUI_HOST_PATTERN }],
  }));
  return [
    ...objectui,
    ...[...docsRedirects, ...blogRedirects].map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    })),
  ];
}
