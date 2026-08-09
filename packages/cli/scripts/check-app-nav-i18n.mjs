#!/usr/bin/env node
// check-app-nav-i18n — translation coverage for the Setup app's navigation,
// judged on the RUNTIME-MERGED app metadata rather than on a static walk.
//
// ---------------------------------------------------------------------------
// Why this gate exists (#5750): a handoff nobody stood on
// ---------------------------------------------------------------------------
// The Setup app (`setup.app.ts`) is a shell of empty group anchors (ADR-0029
// D7). Every menu entry arrives at RUNTIME, from `SETUP_NAV_CONTRIBUTIONS` and
// from the capability plugins that own the underlying objects. So neither of
// the two existing i18n gates could see those labels, and both said so while
// naming the OTHER one as the owner:
//
//   • `app-nav-translation-parity.test.ts` walks `STUDIO_APP` / `ACCOUNT_APP`
//     statically and excluded Setup, deferring to "the coverage ratchet".
//   • `scripts/check-i18n-coverage.mjs` runs `os lint` over STATIC stack
//     configs; `platform-objects`' extract config deferred the same labels to
//     that ratchet, "baselined at 0 for this package".
//
// The ratchet's 0 was never "checked, clean" — it was "not looked at here".
// Measured on `origin/main` at the time of writing, four ids contributed at
// runtime carried no `zh-CN` label at all (`nav_packages`,
// `nav_approval_delegations`, `nav_webhooks`, `nav_http_deliveries`) and the
// gate reported OK. Three more (`nav_capabilities`, `nav_settings_localization`,
// `nav_settings_company`) plus `nav_datasources` were translated in `zh-CN`
// ONLY, which the browser repro that found this could not see because it ran
// under one locale.
//
// So this gate boots the real composition, reads the app back through the same
// `applyNavContributions` merge the REST `/api/v1/meta/app` path uses, and
// asserts every merged nav id carries a label in every locale the platform
// bundle declares. It is the repro script from #5750, run in CI.
//
//   node packages/cli/scripts/check-app-nav-i18n.mjs
//   node packages/cli/scripts/check-app-nav-i18n.mjs --self-test   # no build
//
// From the repo root that is `pnpm check:app-nav-i18n` (which runs both).
//
// ---------------------------------------------------------------------------
// It lives in `packages/cli` on purpose
// ---------------------------------------------------------------------------
// "Who serves this path" is a question about the composed runtime, not about
// which plugin declares what (AGENTS.md, Route & surface ownership). `cli` is
// the composition root — the package `os dev` / `os serve` assemble from — and
// the ONLY workspace package that depends on all eleven Setup nav contributors
// at once. A gate in `platform-objects` could not import the plugins (they
// depend on it, not the other way round) and would be measuring the shell.
//
// ---------------------------------------------------------------------------
// What this gate deliberately does NOT claim
// ---------------------------------------------------------------------------
//  1. A composition is a SUBSET of what can be contributed. Some entries are
//     conditional — `plugin-auth` contributes `nav_sso_providers` only when an
//     external IdP is wired — so a label this run never merged is a label this
//     run never judged. `CONTRIBUTORS` below is therefore explicit, and each
//     entry must land at least one nav id or the run fails: a contributor that
//     silently stops contributing must not read as "everything is translated".
//  2. No reverse direction. `app-nav-translation-parity.test.ts` asserts Studio
//     carries no translation for a removed nav id; the same assertion here
//     would delete the labels of conditionally-contributed entries, because a
//     gated-off contribution is indistinguishable from a dead key when all you
//     have is one runtime composition. So Setup's reverse direction is decided
//     per id by a human instead, in the two hand-kept lists of
//     `setup-nav-dead-key-tombstone.test.ts`: the four keys that were dead were
//     removed there under #6660, and `nav_sso_providers` — labelled in #6659
//     although no composition this gate boots ever merges it — is pinned as the
//     converse case. Neither verdict is one this gate could honestly reach.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, '..');

/** The app whose navigation is assembled at runtime. Setup is the only one. */
const APP_NAME = 'setup';

// ---------------------------------------------------------------------------
// Pure verdict helpers — driven by `--self-test` with recorded samples, so each
// is proven able to go RED without a build and without booting anything.
// ---------------------------------------------------------------------------

/** Every nav id in a navigation tree, depth-first (groups included). */
export function collectNavIds(navigation) {
  const out = [];
  const walk = (items) => {
    for (const raw of items ?? []) {
      const item = raw ?? {};
      if (typeof item.id === 'string' && item.id) out.push(item.id);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(Array.isArray(navigation) ? navigation : []);
  return out;
}

/**
 * The ids a locale has no usable label for. A key present with an empty or
 * non-string label is missing, not present: the console falls back to the
 * author's English literal either way, which is the exact symptom #5750
 * reported.
 */
export function missingLabels(ids, navTranslations) {
  const nav = navTranslations ?? {};
  return ids.filter((id) => {
    const label = nav[id]?.label;
    return typeof label !== 'string' || label.trim() === '';
  });
}

/**
 * Contributors that landed no nav id at all. This is the anti-false-green half:
 * fewer merged ids means fewer ids checked, so a plugin whose registration
 * silently no-ops would make this gate GREENER, not redder (#4690's shape).
 */
export function contributorsWithNoNavIds(contributions) {
  return contributions.filter((c) => c.ids.length === 0).map((c) => c.source);
}

/** Render one locale's shortfall with the source that declared each id. */
function renderMissing(locale, missing, declaredBy) {
  const lines = missing.map((id) => {
    const d = declaredBy.get(id);
    const literal = d?.label ? ` — author's literal ${JSON.stringify(d.label)}` : '';
    const from = d?.source ? ` contributed by ${d.source}` : ' contributed by (unknown)';
    return `      ${id}${from}${literal}`;
  });
  return (
    `apps.${APP_NAME}.navigation — locale \`${locale}\` has no label for ` +
    `${missing.length} runtime-merged nav id(s):\n${lines.join('\n')}`
  );
}

// ---------------------------------------------------------------------------
// The composition. EXPLICIT, never discovered: a contributor that drops out of
// this list must do so in a diff someone reads (Route & surface ownership §2).
// Every entry must land at least one `setup` nav id.
// ---------------------------------------------------------------------------

const CONTRIBUTORS = [
  {
    source: '@objectstack/setup (SETUP_APP + SETUP_NAV_CONTRIBUTIONS)',
    async load() {
      const { createSetupAppPlugin } = await import('@objectstack/setup');
      return { plugin: createSetupAppPlugin() };
    },
  },
  {
    source: '@objectstack/plugin-security',
    async load() {
      const { SecurityPlugin } = await import('@objectstack/plugin-security');
      return { plugin: new SecurityPlugin({}) };
    },
  },
  {
    source: '@objectstack/plugin-sharing',
    async load() {
      const { SharingServicePlugin } = await import('@objectstack/plugin-sharing');
      return { plugin: new SharingServicePlugin({}) };
    },
  },
  {
    source: '@objectstack/plugin-approvals',
    async load() {
      const { ApprovalsServicePlugin } = await import('@objectstack/plugin-approvals');
      return { plugin: new ApprovalsServicePlugin({ disableService: true }) };
    },
  },
  {
    source: '@objectstack/plugin-audit',
    async load() {
      const { AuditPlugin } = await import('@objectstack/plugin-audit');
      return { plugin: new AuditPlugin() };
    },
  },
  {
    source: '@objectstack/plugin-webhooks',
    async load() {
      const { WebhookOutboxPlugin } = await import('@objectstack/plugin-webhooks');
      return { plugin: new WebhookOutboxPlugin({ autoEnqueue: false }) };
    },
  },
  {
    source: '@objectstack/service-messaging',
    async load() {
      const { MessagingServicePlugin } = await import('@objectstack/service-messaging');
      return { plugin: new MessagingServicePlugin({}) };
    },
  },
  {
    source: '@objectstack/service-datasource',
    async load() {
      const { DatasourceAdminServicePlugin } = await import('@objectstack/service-datasource');
      return { plugin: new DatasourceAdminServicePlugin({}) };
    },
  },
  {
    source: '@objectstack/mcp (CONNECT_AGENT_UI_BUNDLE)',
    async load() {
      const { CONNECT_AGENT_UI_BUNDLE } = await import('@objectstack/mcp');
      return { manifests: [CONNECT_AGENT_UI_BUNDLE] };
    },
  },
  {
    source: '@objectstack/cloud-connection (cloud + marketplace UI bundles)',
    async load() {
      const mod = await import('@objectstack/cloud-connection');
      return {
        manifests: [
          mod.CLOUD_CONNECTION_UI_BUNDLE,
          mod.MARKETPLACE_BROWSE_UI_BUNDLE,
          mod.MARKETPLACE_INSTALLED_UI_BUNDLE,
        ],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (name, cond, detail) => {
    if (!cond) failures.push(`${name} — ${detail}`);
  };

  // The merged shape, recorded from a real `registry.getApp('setup')`: groups
  // carry their entries as `children`, so a walk that only reads the top level
  // would find the nine group anchors and NONE of the entries — a gate that
  // checks nothing and reports OK.
  const MERGED_NAV_SAMPLE = [
    { id: 'group_overview', type: 'group', children: [{ id: 'nav_system_overview', type: 'dashboard', label: 'System Overview' }] },
    {
      id: 'group_integrations',
      type: 'group',
      children: [
        { id: 'nav_webhooks', type: 'object', label: 'Webhooks' },
        { id: 'nav_http_deliveries', type: 'object', label: 'HTTP Deliveries' },
      ],
    },
  ];
  expect(
    '#5750 walks into group children',
    collectNavIds(MERGED_NAV_SAMPLE).join(',') ===
      'group_overview,nav_system_overview,group_integrations,nav_webhooks,nav_http_deliveries',
    `got ${JSON.stringify(collectNavIds(MERGED_NAV_SAMPLE))}`,
  );
  expect('#5750 an empty tree is no ids, never a crash', collectNavIds(undefined).length === 0, 'a missing navigation must not throw');

  // The defect itself, in both spellings it arrived in. `nav_packages` HAD a
  // translation — under `apps.studio.navigation`, an entirely different app —
  // so the coverage question is per-app and cannot be answered by "does this
  // string exist somewhere in the bundle".
  const ids = collectNavIds(MERGED_NAV_SAMPLE);
  const ZH_SETUP_NAV = {
    group_overview: { label: '总览' },
    nav_system_overview: { label: '系统概览' },
    group_integrations: { label: '集成' },
  };
  expect(
    '#5750 reports the untranslated ids',
    missingLabels(ids, ZH_SETUP_NAV).join(',') === 'nav_webhooks,nav_http_deliveries',
    `got ${JSON.stringify(missingLabels(ids, ZH_SETUP_NAV))}`,
  );
  expect(
    '#5750 a complete locale is empty',
    missingLabels(ids, { ...ZH_SETUP_NAV, nav_webhooks: { label: 'Webhooks' }, nav_http_deliveries: { label: 'HTTP 投递' } }).length === 0,
    'a fully translated locale must not report a miss',
  );
  // A key that exists with nothing usable in it is the same user-visible bug as
  // a key that does not exist: the console renders the author's English literal.
  expect(
    '#5750 an empty label is missing',
    missingLabels(['nav_webhooks'], { nav_webhooks: { label: '   ' } }).length === 1,
    'a blank label must not count as coverage',
  );
  expect(
    '#5750 a non-string label is missing',
    missingLabels(['nav_webhooks'], { nav_webhooks: { label: 42 } }).length === 1,
    'a non-string label must not count as coverage',
  );
  expect(
    '#5750 a missing locale subtree is total, not zero',
    missingLabels(ids, undefined).length === ids.length,
    'an absent apps.setup.navigation must report every id, never none',
  );

  // The direction this gate can fail SILENTLY. Fewer contributors means fewer
  // ids means fewer checks, so a contributor that stops landing anything makes
  // the run greener. It must be a failure with the contributor's name on it.
  expect(
    '#5750 names a contributor that landed nothing',
    contributorsWithNoNavIds([
      { source: '@objectstack/plugin-webhooks', ids: [] },
      { source: '@objectstack/plugin-audit', ids: ['nav_audit_logs'] },
    ]).join(',') === '@objectstack/plugin-webhooks',
    'a silent contributor must be named, not tolerated',
  );
  expect(
    '#5750 a full composition raises nothing',
    contributorsWithNoNavIds([{ source: 'x', ids: ['nav_a'] }]).length === 0,
    'every contributor landing ids is the green path',
  );

  // The rendered verdict must name the id, the package that declared it and the
  // literal the console falls back to — a verdict a reader cannot act on is the
  // same cost as no verdict.
  const rendered = renderMissing(
    'zh-CN',
    ['nav_http_deliveries'],
    new Map([['nav_http_deliveries', { source: '@objectstack/plugin-webhooks', label: 'HTTP Deliveries' }]]),
  );
  expect('#5750 verdict names the id', rendered.includes('nav_http_deliveries'), rendered);
  expect('#5750 verdict names the contributor', rendered.includes('@objectstack/plugin-webhooks'), rendered);
  expect('#5750 verdict names the fallback literal', rendered.includes('HTTP Deliveries'), rendered);
  expect('#5750 verdict names the locale', rendered.includes('zh-CN'), rendered);

  if (failures.length) {
    console.error(`\ncheck-app-nav-i18n --self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    '✓ check:app-nav-i18n --self-test — the nav walk, the per-locale label verdict and the silent-contributor guard all go red on the shapes they exist to catch.',
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The prerequisite: this gate imports BUILT workspace packages.
// ---------------------------------------------------------------------------

/**
 * Answered once, before anything is imported — a missing build must cost one
 * stated verdict, never a node stack pointing at whichever package happened to
 * be imported first (the #5862 lesson on the neighbouring i18n gates).
 */
function checkBuildPrerequisite() {
  const probe = join(CLI_ROOT, 'node_modules', '@objectstack', 'setup', 'dist', 'index.mjs');
  if (existsSync(probe)) return;
  console.error(
    `\ncheck-app-nav-i18n: PREREQUISITE NOT MET — the workspace packages are not built\n\n` +
      `  This gate boots the real Setup composition, so it imports the BUILT output of\n` +
      `  every contributing package. This one is not there:\n\n` +
      `    ${probe}\n\n` +
      `  Fix:  pnpm build   (or: pnpm --filter '@objectstack/cli^...' build)\n\n` +
      `  Nothing was measured: no app was merged and no locale was compared, so this\n` +
      `  result says NOTHING about whether any nav label went untranslated.\n` +
      `  (Exit code 1 — but piping this gate reports the PIPE's status. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(1);
}

checkBuildPrerequisite();

// ---------------------------------------------------------------------------
// Boot the composition and read the merged app back.
// ---------------------------------------------------------------------------

const { ObjectQL } = await import('@objectstack/objectql');
const { SetupAppTranslations } = await import('@objectstack/platform-objects/apps');

const engine = new ObjectQL();
engine.registry.logLevel = 'silent';

/** Manifests registered by the contributor currently being booted. */
let currentSink = [];

/**
 * A `PluginContext` that provides exactly one real service — `manifest`, whose
 * `register` is what every nav contribution flows through — and inert, COMPLETE
 * implementations of the rest of the interface (`packages/core/src/types.ts`).
 *
 * Complete on purpose: a stub missing a documented member makes a plugin die
 * with `ctx.<x> is not a function`, which this gate would then report as "could
 * not boot" — a true statement about the harness dressed up as a finding about
 * the plugin. Measured: `ctx.trigger` was the first one, from
 * `service-datasource`.
 */
const ctx = {
  getService: (name) => (name === 'manifest' ? { register: (m) => currentSink.push(m) } : undefined),
  registerService: () => {},
  registerServiceFactory: () => {},
  replaceService: () => {},
  getServiceScoped: async () => undefined,
  getServices: () => new Map(),
  hook: () => {},
  trigger: async () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getKernel: () => undefined,
};

/** `{ source, ids }` per contributor, plus id → { source, label } for the verdict. */
const contributions = [];
const declaredBy = new Map();

for (const contributor of CONTRIBUTORS) {
  currentSink = [];
  let loaded;
  try {
    loaded = await contributor.load();
    if (loaded.plugin) {
      await loaded.plugin.init?.(ctx);
      await loaded.plugin.start?.(ctx);
    }
    for (const manifest of loaded.manifests ?? []) currentSink.push(manifest);
  } catch (err) {
    // Never swallowed: a contributor that cannot boot contributes nothing, and
    // a gate that continues past it silently measures a smaller app.
    console.error(
      `\ncheck-app-nav-i18n: COULD NOT BOOT — ${contributor.source}\n\n` +
        `  ${String(err?.message ?? err)}\n\n` +
        `  Nothing was compared. This gate's verdict depends on the composition being\n` +
        `  complete, so a contributor that fails to boot ends the run rather than\n` +
        `  shrinking the app it judges.`,
    );
    process.exit(1);
  }

  const ids = [];
  for (const manifest of currentSink) {
    for (const contribution of manifest?.navigationContributions ?? []) {
      if (contribution?.app !== APP_NAME) continue;
      for (const item of contribution.items ?? []) {
        if (!item?.id) continue;
        ids.push(item.id);
        declaredBy.set(item.id, { source: contributor.source, label: item.label });
      }
    }
    // The app shell itself (group anchors) counts as this contributor's ids too.
    for (const app of manifest?.apps ?? []) {
      if (app?.name !== APP_NAME) continue;
      for (const id of collectNavIds(app.navigation)) {
        ids.push(id);
        if (!declaredBy.has(id)) declaredBy.set(id, { source: contributor.source, label: undefined });
      }
    }
    engine.registerApp(manifest);
  }
  contributions.push({ source: contributor.source, ids });
}

const mergedApp = engine.registry.getApp(APP_NAME);
const mergedIds = collectNavIds(mergedApp?.navigation);

// The two verdicts are kept apart because their REMEDIES are opposites, and a
// footer that prescribes one for the other is the #5862 defect (a confident
// diagnosis pointing somewhere innocent) rebuilt in this gate.
const compositionErrors = [];
const coverageErrors = [];

// 1. The composition is complete — checked BEFORE the coverage verdict, because
//    an incomplete composition cannot give one.
for (const source of contributorsWithNoNavIds(contributions)) {
  compositionErrors.push(
    `${source} landed NO \`${APP_NAME}\` navigation id. Either it stopped contributing (then remove it ` +
      `from CONTRIBUTORS in this script, in the same PR) or its registration silently no-ops — which would ` +
      `make this gate greener, not redder, by giving it fewer ids to check.`,
  );
}
if (!mergedApp) {
  compositionErrors.push(
    `the \`${APP_NAME}\` app is not registered at all — the composition produced no app to judge.`,
  );
}

// 2. Every merged id carries a label in every locale the bundle declares.
if (compositionErrors.length === 0) {
  for (const [locale, data] of Object.entries(SetupAppTranslations)) {
    const missing = missingLabels(mergedIds, data?.apps?.[APP_NAME]?.navigation);
    if (missing.length) coverageErrors.push(renderMissing(locale, missing, declaredBy));
  }
}

const errors = [...compositionErrors, ...coverageErrors];
if (errors.length) {
  console.error(`\ncheck-app-nav-i18n: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e + '\n');
  console.error(
    compositionErrors.length
      ? `  Nothing was compared: the coverage verdict is only meaningful over a COMPLETE\n` +
          `  composition, so it was not attempted. This result says nothing about whether any\n` +
          `  nav label went untranslated.`
      : `  These ids exist only AFTER the runtime merge, so neither \`pnpm check:i18n\` nor\n` +
          `  \`pnpm check:i18n-coverage\` can see them — that gap is what this gate closes (#5750).\n` +
          `  Fix by adding the label to \`apps.${APP_NAME}.navigation\` in EVERY locale file under\n` +
          `  packages/platform-objects/src/apps/translations/ (en, zh-CN, ja-JP, es-ES).`,
  );
  process.exit(1);
}

console.log(
  `check-app-nav-i18n: OK (${CONTRIBUTORS.length} contributor(s), ${mergedIds.length} merged \`${APP_NAME}\` nav id(s), ` +
    `${Object.keys(SetupAppTranslations).length} locale(s), every id labelled in every locale).`,
);
