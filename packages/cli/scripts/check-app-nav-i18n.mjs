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
// The exit-code contract for a refusal, from the frame that owns it —
// imported rather than re-picked, the shape `packages/lint/scripts/*` already
// use to reach repo-root gate infrastructure from inside a package.
import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../../../scripts/import-prerequisite.mjs';

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
      'all go red on the shapes they exist to catch; ' +
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
  const probe = join(CLI_ROOT, 'node_modules', '@objectstack', 'setup', 'dist', 'index.mjs');
  if (existsSync(probe)) return;
  console.error(buildPrerequisiteText(probe));
  process.exit(EXIT_PREREQUISITE_NOT_MET);
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
      `  This gate boots the real Setup composition, so it imports the BUILT output of\n` +
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
        `  Fix by adding the label to \`apps.${APP_NAME}.navigation\` in EVERY locale file under\n` +
        `  packages/platform-objects/src/apps/translations/ (en, zh-CN, ja-JP, es-ES).`,
    );
  }
  process.exit(1);
}

console.log(
  `check-app-nav-i18n: OK (${CONTRIBUTORS.length} contributor(s), ${mergedIds.length} merged \`${APP_NAME}\` nav id(s), ` +
    `${Object.keys(SetupAppTranslations).length} locale(s), every id labelled in every locale).`,
);
