#!/usr/bin/env node
// check-app-nav-i18n — translation coverage for the PLATFORM APPS' navigation
// (Setup and Account), judged on the RUNTIME-MERGED app metadata rather than on
// a static walk.
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
// What this gate NO LONGER judges: `pages.*` (#8764 -> #15743)
// ---------------------------------------------------------------------------
// It used to carry a second, unrelated assertion: that the default locale's
// `pages.*` section still said what the composed page metadata says. That
// verdict now lives in `packages/cli/test/platform-page-i18n-parity.test.ts`,
// which reads its population from the `@objectstack/platform-objects/pages`
// barrel and the contributing plugins' UI bundles and needs no boot.
//
// The move is #15743's ruling (option B, ruled at PR #15739), and the reason
// is this file's own defect class rather than tidiness: `CONTRIBUTORS` below
// is a NAV roster — every entry must land a nav id — and it was silently
// serving a SECOND population, the pages. Those two populations are not the
// same set. Measured on the composition this gate boots: it contains four
// pages (`cloud_connection_settings`, `connect_agent`, `marketplace_installed`,
// `sys_position_detail`), while the platform ships six — `sys_user_detail` and
// `sys_organization_detail` come from `@objectstack/plugin-auth`, which cannot
// join a NAV roster: `new AuthPlugin({})` refuses to boot without a secret, and
// its only nav contribution (`nav_sso_providers`) is conditional, so it can
// never satisfy the at-least-one-nav-id invariant three lines of this file
// depend on. A bundle entry for either page therefore drew this gate's ORPHAN
// verdict — "the booted composition contains no page by that name" — which was
// a true statement about THIS COMPOSITION and a false one about the platform.
//
// ⛔ Do not bring it back by widening `CONTRIBUTORS`. That is option A, refused
// on #15743: it makes one roster serve two populations explicitly, with a
// credential fixture and a hand-carved exemption from the nav-id invariant —
// the original defect with better documentation.
//
// ---------------------------------------------------------------------------
// It lives in `packages/cli` on purpose
// ---------------------------------------------------------------------------
// "Who serves this path" is a question about the composed runtime, not about
// which plugin declares what (AGENTS.md, Route & surface ownership). `cli` is
// the composition root — the package `os dev` / `os serve` assemble from — and
// the ONLY workspace package that depends on every entry in the roster below —
// both platform-app SHELLS and every nav contributor — at once. A gate in
// `platform-objects` could not import the plugins (they depend on it, not the
// other way round) and would be measuring the shell.
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
// The exit-code contract for a refusal, from the frame that owns it —
// imported rather than re-picked, the shape `packages/lint/scripts/*` already
// use to reach repo-root gate infrastructure from inside a package.
import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../../../scripts/import-prerequisite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, '..');

// ---------------------------------------------------------------------------
// THE POPULATION — which apps this gate judges, and the criterion that decides
// it (#17891)
// ---------------------------------------------------------------------------
//
// An app belongs here iff BOTH halves hold. The criterion is what a future
// reader needs; the list is only its output. ⛔ Neither half is optional —
// each one excludes something real, and dropping either turns this list into a
// pair someone will pattern-match instead of decide.
//
//   (a) THE COMPOSITION ROOT REGISTERS ITS SHELL BY DEFAULT — it is one of the
//       app packages the ADR-0048 platform-app loop loads in
//       `packages/cli/src/commands/serve.ts`. That loop is the authority on
//       what `os dev` / `os serve` actually boot, and a verdict here is only
//       ever about a composition that really exists ("who serves this path" is
//       a question about the provisioned runtime — Route & surface ownership).
//   (b) AT LEAST ONE PACKAGE CONTRIBUTES NAVIGATION INTO IT AT RUNTIME
//       (`manifest.navigationContributions[].app`), so a static walk cannot see
//       every label it renders. This half is what makes THIS gate the right
//       owner rather than `app-nav-translation-parity.test.ts`, which walks the
//       declared trees and needs no boot.
//
// Today that resolves to exactly `setup` and `account`. ⛔ "Every app" is NOT
// the criterion, and the two apps it would have swept in are why:
//
//   • `studio` fails BOTH halves. The ADR-0048 loop deliberately does not load
//     it ("@objectstack/studio is intentionally NOT default-loaded"), and
//     `STUDIO_APP` declares its whole navigation statically with no package
//     contributing into it — `app-nav-translation-parity.test.ts` already owns
//     that verdict by a static walk. Adding it here would be a second owner for
//     one route (§1) and would drag in a package the composition root does not
//     boot.
//   • `crm_app` fails (a) and has no locale source here at all: it is an
//     `examples/` app, and `SetupAppTranslations` carries no `apps.crm_app`
//     subtree for this gate to compare against.
//
// `account` satisfied both halves all along and was invisible anyway:
// `@objectstack/mcp` contributes `nav_connect_agent` into
// `grp_account_developer` (`connect-ui.ts`, #16746) and #17759 supplied its
// label in all four locales — while this gate printed a BYTE-IDENTICAL
// `OK (…)` line before and after that landing, because every site below
// narrowed to one app name. Widening the three obvious filters is NOT the fix:
// the locale-file lookup and the build prerequisite are keyed by the app too,
// so a half-widened gate collects `account` ids and then looks for their labels
// under `apps.setup.navigation`.
//
// Each entry names the package that registers the app SHELL, because two
// mechanisms below are keyed by it: the build prerequisite probes that
// package's `dist/`, and the roster must BOOT it or there is no merged app to
// judge at all.
const APPS = [
  { name: 'setup', shellPackage: '@objectstack/setup' },
  { name: 'account', shellPackage: '@objectstack/account' },
];

/** Just the names, in declaration order — the order every verdict renders in. */
const APP_NAMES = APPS.map((app) => app.name);

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

/**
 * One app's slice of the per-contributor ledger: the contributors that DECLARE
 * that app, each carrying only the ids it landed THERE.
 *
 * This exists so {@link contributorsWithNoNavIds} above stays exactly what it
 * was and simply runs once per app. ⛔ The alternative — one flat union of each
 * contributor's ids across every app — reads as the natural generalisation and
 * is a SOFTENING of the invariant that was already here: `@objectstack/mcp`
 * contributes into both `setup` and `account`, so a union keeps it passing on
 * its `account` id alone after its `setup` contribution has silently stopped,
 * which is the exact "fewer ids means fewer checks" false green this invariant
 * exists to catch, restated one app wider (#17891). `--self-test` carries that
 * union as a negative control.
 *
 * A declared app with no bucket at all reads as ZERO ids, never as "not
 * applicable": absence must be loud (§3), and a contributor that landed nothing
 * anywhere is the case this whole invariant is about.
 */
export function contributionsForApp(contributions, appName) {
  return contributions
    .filter((c) => (c.apps ?? []).includes(appName))
    .map((c) => ({ source: c.source, ids: c.idsByApp?.[appName] ?? [] }));
}

/**
 * The pass line, as a VALUE so `--self-test` can pin it.
 *
 * Per-app counts are not cosmetics. #17891's whole measurement was a DIFF of
 * THIS LINE across #17759's landing, and the finding was that it came back
 * byte-identical because one app's counts were all it carried. A summary that
 * collapses the apps back into one total rebuilds precisely that: a number that
 * moves for reasons the reader cannot attribute, and — worse — one that fails
 * to move when a whole app drops out of the population.
 */
export function summaryText(contributorCount, localeCount, perApp) {
  const apps = perApp.map(({ app, ids }) => `${app}: ${ids} merged nav id(s)`).join(', ');
  return (
    `check-app-nav-i18n: OK (${contributorCount} contributor(s), ${localeCount} locale(s), ` +
    `${perApp.length} app(s) — ${apps} — every id labelled in every locale).`
  );
}

/**
 * Render ONE app's shortfall in ONE locale, with the source that declared each
 * id.
 *
 * ⛔ The app is a parameter, never this file's former single constant: the
 * bundles are keyed `apps.<app>.navigation.<id>`, one namespace per app, so
 * `apps.setup.navigation.nav_connect_agent` never answers for the same id under
 * `apps.account.navigation` (#17759). A widened gate whose verdict still said
 * `apps.setup.navigation` would send whoever it fails on to the wrong subtree
 * — a confident diagnosis pointing somewhere innocent (#17891).
 */
function renderMissing(appName, locale, missing, declaredBy) {
  const lines = missing.map((id) => {
    const d = declaredBy.get(id);
    const literal = d?.label ? ` — author's literal ${JSON.stringify(d.label)}` : '';
    const from = d?.source ? ` contributed by ${d.source}` : ' contributed by (unknown)';
    return `      ${id}${from}${literal}`;
  });
  return (
    `apps.${appName}.navigation — locale \`${locale}\` has no label for ` +
    `${missing.length} runtime-merged nav id(s):\n${lines.join('\n')}`
  );
}

// ---------------------------------------------------------------------------
// The composition. EXPLICIT, never discovered: a contributor that drops out of
// this list must do so in a diff someone reads (Route & surface ownership §2).
//
// `apps` is each entry's DECLARED coverage, and the invariant is PER APP: every
// entry must land at least one nav id in EVERY app it declares. ⛔ Not one id
// across the union — see {@link contributionsForApp} for why that spelling is a
// softening rather than a generalisation.
//
// The two SHELL entries are what make the population reachable at all: an app
// whose shell nobody registers has no merged navigation for the contributions
// to merge into, so widening the filters without booting `@objectstack/account`
// would have reported "the `account` app is not registered at all" instead of
// judging a single label (#17891).
// ---------------------------------------------------------------------------

const CONTRIBUTORS = [
  {
    source: '@objectstack/setup (SETUP_APP + SETUP_NAV_CONTRIBUTIONS)',
    apps: ['setup'],
    async load() {
      const { createSetupAppPlugin } = await import('@objectstack/setup');
      return { plugin: createSetupAppPlugin() };
    },
  },
  {
    // The Account SHELL (#17891). `AccountAppPlugin.start` registers
    // `ACCOUNT_APP` through the `manifest` service — the same seam every other
    // entry here uses — so the fake `ctx` below already serves it and no
    // credential fixture is needed. Its kernel `dependencies` name
    // `com.objectstack.auth`; this gate calls `init`/`start` directly rather
    // than running a kernel, so nothing resolves them and nothing needs to.
    source: '@objectstack/account (ACCOUNT_APP)',
    apps: ['account'],
    async load() {
      const { createAccountAppPlugin } = await import('@objectstack/account');
      return { plugin: createAccountAppPlugin() };
    },
  },
  {
    source: '@objectstack/plugin-security',
    apps: ['setup'],
    async load() {
      const { SecurityPlugin } = await import('@objectstack/plugin-security');
      return { plugin: new SecurityPlugin({}) };
    },
  },
  {
    source: '@objectstack/plugin-sharing',
    apps: ['setup'],
    async load() {
      const { SharingServicePlugin } = await import('@objectstack/plugin-sharing');
      return { plugin: new SharingServicePlugin({}) };
    },
  },
  {
    source: '@objectstack/plugin-approvals',
    apps: ['setup'],
    async load() {
      const { ApprovalsServicePlugin } = await import('@objectstack/plugin-approvals');
      return { plugin: new ApprovalsServicePlugin({ disableService: true }) };
    },
  },
  {
    source: '@objectstack/plugin-audit',
    apps: ['setup'],
    async load() {
      const { AuditPlugin } = await import('@objectstack/plugin-audit');
      return { plugin: new AuditPlugin() };
    },
  },
  {
    source: '@objectstack/plugin-webhooks',
    apps: ['setup'],
    async load() {
      const { WebhookOutboxPlugin } = await import('@objectstack/plugin-webhooks');
      return { plugin: new WebhookOutboxPlugin({ autoEnqueue: false }) };
    },
  },
  {
    source: '@objectstack/service-messaging',
    apps: ['setup'],
    async load() {
      const { MessagingServicePlugin } = await import('@objectstack/service-messaging');
      return { plugin: new MessagingServicePlugin({}) };
    },
  },
  {
    source: '@objectstack/service-datasource',
    apps: ['setup'],
    async load() {
      const { DatasourceAdminServicePlugin } = await import('@objectstack/service-datasource');
      return { plugin: new DatasourceAdminServicePlugin({}) };
    },
  },
  {
    source: '@objectstack/mcp (CONNECT_AGENT_UI_BUNDLE)',
    // The one contributor that lands in BOTH apps: `CONNECT_AGENT_UI_BUNDLE`
    // carries two `navigationContributions` entries pointing at one page —
    // `setup`/`group_integrations` for admins and `account`/
    // `grp_account_developer` for the per-user half (#16746). The Account half
    // is the contribution this gate was blind to.
    apps: ['setup', 'account'],
    async load() {
      const { CONNECT_AGENT_UI_BUNDLE } = await import('@objectstack/mcp');
      return { manifests: [CONNECT_AGENT_UI_BUNDLE] };
    },
  },
  {
    source: '@objectstack/cloud-connection (cloud + marketplace UI bundles)',
    apps: ['setup'],
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
    'setup',
    'zh-CN',
    ['nav_http_deliveries'],
    new Map([['nav_http_deliveries', { source: '@objectstack/plugin-webhooks', label: 'HTTP Deliveries' }]]),
  );
  expect('#5750 verdict names the id', rendered.includes('nav_http_deliveries'), rendered);
  expect('#5750 verdict names the contributor', rendered.includes('@objectstack/plugin-webhooks'), rendered);
  expect('#5750 verdict names the fallback literal', rendered.includes('HTTP Deliveries'), rendered);
  expect('#5750 verdict names the locale', rendered.includes('zh-CN'), rendered);

  // ── The POPULATION, and the one way widening it goes wrong (#17891) ──
  //
  // The gate judges more than one app now. The half that can be widened WRONG
  // is the per-contributor invariant: flattening each contributor's ids into a
  // union across apps reads as the obvious generalisation and quietly deletes
  // the `setup` judgement that was already here. These cases are that
  // spelling's negative control — the union is CONSTRUCTED below and required
  // to be the thing that goes green, so the pin cannot pass by tautology.
  const MIXED_LEDGER = [
    { source: '@objectstack/mcp', apps: ['setup', 'account'], idsByApp: { setup: [], account: ['nav_connect_agent'] } },
    { source: '@objectstack/setup (SETUP_APP + SETUP_NAV_CONTRIBUTIONS)', apps: ['setup'], idsByApp: { setup: ['group_overview'], account: [] } },
  ];
  expect(
    '#17891 a contributor that stopped landing `setup` ids is named for setup, whatever it landed elsewhere',
    contributorsWithNoNavIds(contributionsForApp(MIXED_LEDGER, 'setup')).join(',') === '@objectstack/mcp',
    JSON.stringify(contributionsForApp(MIXED_LEDGER, 'setup')),
  );
  expect(
    '#17891 NEGATIVE CONTROL: the flat-union spelling this replaces goes GREEN on that same ledger',
    contributorsWithNoNavIds(MIXED_LEDGER.map((c) => ({ source: c.source, ids: Object.values(c.idsByApp).flat() }))).length === 0,
    'if the union is not the green one, the case above proves nothing about the softening',
  );
  expect(
    '#17891 an app is judged only over the contributors that DECLARE it',
    contributionsForApp(MIXED_LEDGER, 'account').map((c) => c.source).join(',') === '@objectstack/mcp',
    JSON.stringify(contributionsForApp(MIXED_LEDGER, 'account')),
  );
  expect(
    '#17891 a declared app with no bucket at all reads as ZERO ids, never as not-applicable',
    contributorsWithNoNavIds(contributionsForApp([{ source: 'x', apps: ['account'], idsByApp: {} }], 'account')).join(',') === 'x',
    'a missing per-app bucket must be a finding, not a skip',
  );

  // The verdict must name the APP as well as the id: one namespace per app, so
  // `apps.setup.navigation.nav_connect_agent` does not answer for the same id
  // under `apps.account.navigation` (#17759). A verdict naming only the id
  // sends the reader to whichever subtree they guessed.
  const renderedAccount = renderMissing(
    'account',
    'zh-CN',
    ['nav_connect_agent'],
    new Map([['nav_connect_agent', { source: '@objectstack/mcp', label: 'Connect an Agent' }]]),
  );
  expect('#17891 the verdict names the app subtree it actually read', renderedAccount.includes('apps.account.navigation'), renderedAccount);
  expect(
    '#17891 NEGATIVE CONTROL: it does NOT name the other app — a widened gate still saying `setup` misreports',
    !renderedAccount.includes('apps.setup.navigation'),
    renderedAccount,
  );

  // The pass line. #17891's whole measurement was a DIFF of this line across a
  // landing, and it came back byte-identical because one app's counts were all
  // it carried.
  const summary = summaryText(11, 4, [{ app: 'setup', ids: 54 }, { app: 'account', ids: 12 }]);
  expect('#17891 the pass line names every app it judged, with that app\'s own count', summary.includes('setup: 54') && summary.includes('account: 12'), summary);
  expect('#17891 the pass line still states the contributor and locale counts', summary.includes('11 contributor(s)') && summary.includes('4 locale(s)'), summary);
  expect(
    '#17891 NEGATIVE CONTROL: the pin can see an app LEAVING the line',
    !summaryText(10, 4, [{ app: 'setup', ids: 54 }]).includes('account'),
    'a summary pin that cannot notice a vanished app is the blindness this card fixed, rebuilt',
  );

  // The population itself must stay reachable: every declared app needs a shell
  // package, because the prerequisite probe and the CONTRIBUTORS roster are
  // both keyed by it. An entry missing one refuses at a `join(undefined)` deep
  // inside a probe rather than here.
  expect(
    '#17891 every app in the population declares the package its shell ships in',
    APPS.every((app) => typeof app.name === 'string' && app.name && typeof app.shellPackage === 'string' && app.shellPackage.startsWith('@objectstack/')),
    JSON.stringify(APPS),
  );
  expect(
    '#17891 every declared app is served by at least one CONTRIBUTORS entry',
    APP_NAMES.every((name) => CONTRIBUTORS.some((c) => (c.apps ?? []).includes(name))),
    JSON.stringify(CONTRIBUTORS.map((c) => ({ source: c.source, apps: c.apps }))),
  );
  expect(
    '#17891 every CONTRIBUTORS entry declares at least one app IN the population',
    CONTRIBUTORS.every((c) => (c.apps ?? []).length > 0 && (c.apps ?? []).every((a) => APP_NAMES.includes(a))),
    JSON.stringify(CONTRIBUTORS.map((c) => ({ source: c.source, apps: c.apps }))),
  );

  // ── The refusal CLASS, and the advisory that must move with it (#14857) ──
  //
  // `checkBuildPrerequisite` is this gate's only refusal, and until its printer
  // was split into `buildPrerequisiteText` there was no VALUE to assert on: the
  // string was built inline inside `console.error(...)` and the code was typed
  // into the `process.exit` on the next line. So the number PR #14856 moved
  // from 1 to 3 was pinned here by nothing, while four sibling gates pin both
  // the code and the advisory that names it.
  //
  // ⛔ The verdict cases above are NOT this coverage: they decide WHICH finding
  // fires and stay green whatever number the refusal beside them returns.
  const refusalAdvisory = buildPrerequisiteText('/repo/packages/cli/node_modules/@objectstack/setup/dist/index.mjs');
  expect(
    '#14857 the refusal class is 3 — the code the four sibling gates answer these words with',
    EXIT_PREREQUISITE_NOT_MET === 3,
    String(EXIT_PREREQUISITE_NOT_MET),
  );
  expect(
    '#14857 the refusal class is distinct from a finding and from a pass',
    EXIT_PREREQUISITE_NOT_MET !== EXIT_FINDINGS && EXIT_PREREQUISITE_NOT_MET !== 0,
    `prerequisite ${EXIT_PREREQUISITE_NOT_MET}, finding ${EXIT_FINDINGS}`,
  );

  // Pinned over the FUNCTION BODIES, not over the constant alone. The
  // regression that costs something is not a mistyped constant: it is a
  // `process.exit(1)` written back into the refusal by an author who never
  // thought about exit codes, or a number typed into the advisory instead of
  // interpolated. Either leaves the constant reading 3, every consumer green
  // (they all treat any non-zero as failure), and a message that still reads
  // perfectly right.
  const hardcodesExitCall = (fn) => /process\.exit\(\s*\d/.test(fn.toString());
  const spellsALiteralCode = (fn) => /Exit code \d/.test(fn.toString());
  expect(
    '#14857 the refusal exits through the named constant, never a literal',
    !hardcodesExitCall(checkBuildPrerequisite),
    checkBuildPrerequisite.toString(),
  );
  // The seam the advisory cases depend on: a text pinned here is worthless if
  // the refusal stops printing THIS text.
  expect(
    '#14857 the refusal prints the pinned text function',
    /console\.error\(\s*buildPrerequisiteText\(/.test(checkBuildPrerequisite.toString()),
    checkBuildPrerequisite.toString(),
  );
  expect(
    '#14857 the advisory INTERPOLATES the code rather than spelling one',
    !spellsALiteralCode(buildPrerequisiteText),
    buildPrerequisiteText.toString(),
  );
  expect(
    '#14857 the advisory names its own code AND the finding code it is distinct from',
    refusalAdvisory.includes(`Exit code ${EXIT_PREREQUISITE_NOT_MET}`)
      && refusalAdvisory.includes(`a finding's ${EXIT_FINDINGS}`),
    refusalAdvisory,
  );
  expect('#14857 the advisory carries NO stale spelling of the old code', !/Exit code 1\b/.test(refusalAdvisory), refusalAdvisory);
  expect('#14857 the advisory still states that nothing was measured', refusalAdvisory.includes('Nothing was measured'), refusalAdvisory);
  expect(
    '#14857 the advisory names the probe file it was handed, not a re-derived one',
    refusalAdvisory.includes('/repo/packages/cli/node_modules/@objectstack/setup/dist/index.mjs'),
    refusalAdvisory,
  );

  // The NEGATIVE CONTROLS, and the reason the predicates above are
  // measurements rather than tautologies: each is run against a function that
  // does the forbidden thing and must SEE it. Without these, one typo in either
  // regex passes forever — a pin that cannot fail is not a pin. ⛔ Neither
  // control is ever CALLED; they exist to be read by `toString()`.
  const controlHardcodedExit = () => { process.exit(1); };
  const controlLiteralAdvisory = () => `  (Exit code 1, distinct from a finding's 1 — capture it BEFORE any pipe:`;
  expect('#14857 NEGATIVE CONTROL: the literal-exit pin can still fail', hardcodesExitCall(controlHardcodedExit), 'the predicate no longer sees a hard-coded exit');
  expect('#14857 NEGATIVE CONTROL: the literal-advisory pin can still fail', spellsALiteralCode(controlLiteralAdvisory), 'the predicate no longer sees a spelled-out code');
  expect('#14857 NEGATIVE CONTROL: the stale-code pin can still fail', /Exit code 1\b/.test(controlLiteralAdvisory()), 'the stale-spelling predicate no longer sees `Exit code 1`');

  if (failures.length) {
    console.error(`\ncheck-app-nav-i18n --self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    '✓ check:app-nav-i18n --self-test — the nav walk, the per-locale label verdict and the silent-contributor guard ' +
      `all go red on the shapes they exist to catch, over all ${APPS.length} app(s) in the population ` +
      `(${APP_NAMES.join(', ')}) with the per-app invariant proven not to be a union (#17891); ` +
      `and the build-prerequisite refusal exits ${EXIT_PREREQUISITE_NOT_MET} — distinct from a finding's ${EXIT_FINDINGS} — ` +
      'with an advisory that names the number it claims (#14857).',
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
 *
 * Exits `EXIT_PREREQUISITE_NOT_MET`, and the printed advisory says the same
 * number: nothing was measured, so this is NOT a finding.
 *
 * ⛔ The closing paragraph is the frame's, verbatim apart from this gate's own
 * command, and it is NOT a place to improvise. The wording it replaced was true
 * but prescribed `echo "EXIT=$?"` without saying WHERE, so a reader who did the
 * natural thing — `... | tail -4; echo "EXIT=$?"` — read `tail`'s status rather
 * than this gate's, which is the exact false green the prescription exists to
 * prevent. The one true half ("capture it BEFORE any pipe") had existed in
 * `scripts/check-test-completeness.mjs` all along and simply never reached here.
 *
 * ⛔ That older phrasing is also the CENSUS-NEGATIVE string: the instrument for
 * this advisory family is `git grep -n "no pipe shape repairs it"`, and the
 * acceptance criterion is that no copy of the pre-convergence sentence survives
 * anywhere under `scripts/**` or `packages/**`. So do not reintroduce it here —
 * not even inside a comment, quoting it to explain what was wrong. (Measured:
 * the first draft of THIS comment did exactly that, and put the criterion back
 * into the red while the code beside it was already correct.)
 */
function checkBuildPrerequisite() {
  // ONE PROBE PER APP SHELL (#17891). A probe hard-coded to `@objectstack/setup`
  // answers for one app in a population of two: with Account unbuilt it returns
  // happily, and the missing build arrives eleven lines further down as
  // `COULD NOT BOOT — @objectstack/account`, which is a finding about a plugin
  // worn over a finding about the tree. It refuses on the FIRST missing one and
  // names it, so the advisory keeps naming a file that is really absent.
  for (const app of APPS) {
    const probe = join(CLI_ROOT, 'node_modules', ...app.shellPackage.split('/'), 'dist', 'index.mjs');
    if (existsSync(probe)) continue;
    console.error(buildPrerequisiteText(probe));
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
}

/**
 * The text `checkBuildPrerequisite` prints, as a value — so `--self-test` can
 * assert on the advisory (and on the code it names) without spawning a process,
 * stubbing `process.exit`, or unbuilding the tree. The extraction is the whole
 * point: while the string was built inline inside `console.error(...)`, there
 * was no value for a test to read, so the number this gate answers
 * `PREREQUISITE NOT MET` with was pinned by nothing (#14857). Same shape as
 * `scripts/import-prerequisite.mjs`'s `prerequisiteNotMetText`.
 *
 * Takes the probe path rather than recomputing it: the message names the file
 * that was actually missing, and a text function that re-derived it could name
 * a different one than the check refused on.
 */
function buildPrerequisiteText(probe) {
  return (
    `\ncheck-app-nav-i18n: PREREQUISITE NOT MET — the workspace packages are not built\n\n` +
      `  This gate boots the real platform-app composition (Setup and Account), so it\n` +
      `  imports the BUILT output of\n` +
      `  every contributing package. This one is not there:\n\n` +
      `    ${probe}\n\n` +
      `  Fix:  pnpm build   (or: pnpm --filter '@objectstack/cli^...' build)\n\n` +
      `  Nothing was measured: no app was merged and no locale was compared, so this\n` +
      `  result says NOTHING about whether any nav label went untranslated.\n` +
      `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from a finding's ${EXIT_FINDINGS} — capture it BEFORE any pipe:\n` +
      `  \`node packages/cli/scripts/check-app-nav-i18n.mjs > /tmp/check-app-nav-i18n.log 2>&1; echo "EXIT=$?"\`.\n` +
      `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
      `  is the false green, and no pipe shape repairs it. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover\n` +
      `  this gate's own code: \`| tail\` reads to EOF and forwards it, while \`| head -N\` closes the\n` +
      `  read end early — the gate takes EPIPE, its verdict text is TRUNCATED, and a producer that\n` +
      `  dies on SIGPIPE reports 141 rather than what it meant to say.)`
  );
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

/**
 * `{ source, apps, idsByApp }` per contributor, plus app → id → { source, label }
 * for the verdict.
 *
 * `declaredBy` is keyed by APP first because a nav id is unique within one app's
 * tree and nothing indexes it across apps: `nav_connect_agent` is a real id in
 * BOTH `setup` and `account` (one page, two doors — #16746), so a flat id-keyed
 * map would have one entry silently overwrite the other.
 */
const contributions = [];
const declaredBy = new Map(APP_NAMES.map((name) => [name, new Map()]));

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

  const idsByApp = Object.fromEntries(APP_NAMES.map((name) => [name, []]));
  for (const manifest of currentSink) {
    for (const contribution of manifest?.navigationContributions ?? []) {
      const target = contribution?.app;
      if (!APP_NAMES.includes(target)) continue;
      for (const item of contribution.items ?? []) {
        if (!item?.id) continue;
        idsByApp[target].push(item.id);
        declaredBy.get(target).set(item.id, { source: contributor.source, label: item.label });
      }
    }
    // The app shell itself (group anchors) counts as this contributor's ids too.
    for (const app of manifest?.apps ?? []) {
      const name = app?.name;
      if (!APP_NAMES.includes(name)) continue;
      for (const id of collectNavIds(app.navigation)) {
        idsByApp[name].push(id);
        if (!declaredBy.get(name).has(id)) {
          declaredBy.get(name).set(id, { source: contributor.source, label: undefined });
        }
      }
    }
    engine.registerApp(manifest);
  }
  contributions.push({ source: contributor.source, apps: contributor.apps, idsByApp });
}

/**
 * app → merged nav ids, or `undefined` when the app was never registered. The
 * two states must stay distinguishable: "registered, empty" and "not registered
 * at all" have different remedies, and `collectNavIds(undefined)` answers `[]`
 * for both.
 */
const mergedIdsByApp = new Map(
  APPS.map((app) => {
    const mergedApp = engine.registry.getApp(app.name);
    return [app.name, mergedApp ? collectNavIds(mergedApp.navigation) : undefined];
  }),
);

// The two verdicts are kept apart because their REMEDIES are opposites, and a
// footer that prescribes one for the other is the #5862 defect (a confident
// diagnosis pointing somewhere innocent) rebuilt in this gate.
const compositionErrors = [];
const coverageErrors = [];

// 1. The composition is complete — checked BEFORE the coverage verdict, because
//    an incomplete composition cannot give one.
for (const app of APPS) {
  for (const source of contributorsWithNoNavIds(contributionsForApp(contributions, app.name))) {
    compositionErrors.push(
      `${source} landed NO \`${app.name}\` navigation id. Either it stopped contributing to that app ` +
        `(then drop \`${app.name}\` from its \`apps\` in CONTRIBUTORS in this script, in the same PR) or its ` +
        `registration silently no-ops — which would make this gate greener, not redder, by giving it fewer ` +
        `ids to check.`,
    );
  }
  if (mergedIdsByApp.get(app.name) === undefined) {
    compositionErrors.push(
      `the \`${app.name}\` app is not registered at all — the composition produced no app to judge. ` +
        `Its shell ships in \`${app.shellPackage}\`, which must be a CONTRIBUTORS entry above.`,
    );
  }
}

// 2. Every merged id carries a label in every locale the bundle declares.
if (compositionErrors.length === 0) {
  // App-outer, locale-inner: one app's four verdicts stay contiguous, and a
  // regression confined to one app renders exactly the lines it rendered before
  // the population widened, in the same order.
  for (const app of APPS) {
    for (const [locale, data] of Object.entries(SetupAppTranslations)) {
      const missing = missingLabels(mergedIdsByApp.get(app.name), data?.apps?.[app.name]?.navigation);
      if (missing.length) {
        coverageErrors.push(renderMissing(app.name, locale, missing, declaredBy.get(app.name)));
      }
    }
  }
}

const errors = [...compositionErrors, ...coverageErrors];
if (errors.length) {
  console.error(`\ncheck-app-nav-i18n: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e + '\n');
  // One footer PER bucket that actually fired. The two remedies are
  // different, and a footer prescribing one for another is a confident
  // diagnosis pointing somewhere innocent — the #5862 defect this gate was
  // careful not to rebuild.
  if (compositionErrors.length) {
    console.error(
      `  Nothing was compared: the coverage verdict is only meaningful over a COMPLETE\n` +
        `  composition, so it was not attempted. This result says nothing about whether any\n` +
        `  nav label went untranslated.`,
    );
  }
  if (coverageErrors.length) {
    console.error(
      `  These ids exist only AFTER the runtime merge, so neither \`pnpm check:i18n\` nor\n` +
        `  \`pnpm check:i18n-coverage\` can see them — that gap is what this gate closes (#5750).\n` +
        `  Fix by adding the label to the \`apps.<app>.navigation\` subtree NAMED IN EACH VERDICT\n` +
        `  above, in EVERY locale file under\n` +
        `  packages/platform-objects/src/apps/translations/ (en, zh-CN, ja-JP, es-ES).\n` +
        `  ⛔ One namespace PER APP: \`apps.setup.navigation.<id>\` never answers for the same id\n` +
        `  under \`apps.account.navigation\`, so a twin entry needs its own key (#17759).`,
    );
  }
  process.exit(1);
}

console.log(
  summaryText(
    CONTRIBUTORS.length,
    Object.keys(SetupAppTranslations).length,
    APPS.map((app) => ({ app: app.name, ids: mergedIdsByApp.get(app.name).length })),
  ),
);
