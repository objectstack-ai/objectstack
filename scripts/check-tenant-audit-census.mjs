#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-tenant-audit-census -- holds `content/docs/permissions/tenant-audit-census.mdx`
 * to the code it claims to enumerate.
 *
 *   node scripts/check-tenant-audit-census.mjs
 *   node scripts/check-tenant-audit-census.mjs --self-test
 *
 * The repair arm is the GENERATOR, not this gate:
 *
 *   node scripts/tenant-audit-census.mjs --write
 *
 * That page carries the population the `auditMissingTenant` control acts on. Its
 * predecessor was a comment on an issue that later 404'd, taking the list with
 * it while three open cards still named it as their input -- so the page exists
 * to be re-derivable, and this gate exists so "re-derivable" is a property the
 * build checks rather than a promise the page makes.
 *
 * ## ⭐ Why this is a DRIFT gate and not an anchor gate
 *
 * The sibling `isSystem` census page carries `file:line` anchors and a gate that
 * resolves them. That shape earns something real -- prose rows that point at
 * code -- and it pays for it twice:
 *
 *   - the anchors rot on pure DISPLACEMENT. An inserted import above a site
 *     moves every anchor below it, so the page reds on an edit that changed
 *     nothing it measures.
 *   - its repair arm then has to tell displacement apart from a population
 *     change, and gets it wrong: a file whose ledger-excused citations also
 *     shifted is reported as "the POPULATION changed" when nothing about the
 *     population moved. That refusal asserts something FALSE on a
 *     security-relevant surface, in the one direction an author is instructed to
 *     trust.
 *
 * This page is a CENSUS rather than a behaviour reference, so it does not need
 * anchors to be useful, and the whole failure class is avoidable by not having
 * them. The generated region aggregates by (file, verb, object, tenancy, context
 * posture) and carries no line numbers, which is invariant under displacement;
 * the only thing that can move it is the population. `--json` on the generator
 * still carries every site's `file:line` for anyone navigating to one.
 *
 * ⇒ There is exactly ONE repair path (`--write`), it is mechanical, and it has
 *   no case where it must guess. That is the property the anchor scheme cannot
 *   have, and it is why this gate is not a port of its sibling.
 *
 * ## The two checks
 *
 *   A  DRIFT       both generated artefacts equal what the generator produces
 *                  from the tree right now, byte-for-byte: the page's generated
 *                  region, and the whole of the audit ledger
 *                  `docs/audits/2026-08-tenant-audit-write-call-sites.counts.md`.
 *                  This is the load-bearing one: it holds them to the CODE, in
 *                  the census -> page direction, so a site that arrives with no
 *                  row fails rather than going unnoticed.
 *   B  PROSE       every census-derived number the page states OUTSIDE that
 *                  region equals the census. A pattern that matches NOTHING is
 *                  an error, so a reworded page cannot silently stop being
 *                  checked -- the page's headline and its own deviation table
 *                  are hand-written, and a hand-written number is exactly the
 *                  thing that goes stale first.
 *
 * Check B is not redundant with A. The generated region cannot lie, because it
 * is rewritten; the prose around it is where a human writes a claim, and #13178's
 * whole lesson is that a quoted number outlives the measurement it quoted.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A page that cannot be read, a missing marker pair, a census with zero sites, a
 * prose pattern that matches nothing, and any refusal the generator itself
 * raises (an unplaceable receiver, a stale ledger row, an unparseable source)
 * are all exit 1 naming what could not be read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import {
  BEGIN_MARKER,
  COUNTS,
  END_MARKER,
  PAGE,
  renderCountsFile,
  renderGeneratedRegion,
  runCensus,
  selfTest as censusSelfTest,
} from './tenant-audit-census.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The paths this gate operates on, written where `scripts/pm/dispatch-gates.mjs`
 * can see them. Provenance ONLY: nothing in this gate reads this list, and every
 * check below behaves exactly as it did without it.
 *
 * ## The gap this closes, measured rather than argued
 *
 * That tool builds a card's gate list by scanning each gate's own source for the
 * path literals it operates on, and it refuses to FOLLOW a module that is itself
 * a gate file. This gate spelled **zero** literals of its own and inherited all
 * 22 from `tenant-audit-census.mjs` — until that module became a gate file in its
 * own right, the moment CI began invoking its `--self-test` directly.
 *
 * ⇒ The inheritance was cut, and the loss is silent in exactly the way this repo
 *   treats as worse than a red: a lead that stops appearing is indistinguishable
 *   from a lead that was never earned. A PR touching `packages/services/**` — the
 *   population this census exists to count — would simply stop being told that
 *   this gate reads its diff. `dispatch-gates --self-test` catches it, by name:
 *   "promoting N module(s) to gate files subtracts no inherited hint from any
 *   other family — LOST: scripts/check-tenant-audit-census.mjs <- …".
 *
 * The two subtrees are the census corpus, and they cover every `UNTYPED_RECEIVERS`
 * path the generator spells — `hintCovers('packages/services', …)` is true for all
 * of them — so restoring the roots restores the whole inherited population rather
 * than a sample of it. The two artefacts are here because a HAND-EDIT to either is
 * precisely what this gate exists to reject, and that edit must derive it.
 *
 * ⚠️ Kept in sync by nothing but review, which is why it is provenance and never
 * a lookup key: `PAGE` and `COUNTS` are imported for every real use below, and the
 * corpus roots live in `SURFACE_ROOTS`. This list may only ever be a WIDER-or-equal
 * restatement of those; a narrower one silently shrinks the gate's discoverability
 * again, which is the defect above wearing a different hat.
 */
const ROOT_DIR_WATCH_HINTS = [
  'packages/services/**',
  'packages/plugins/**',
  'content/docs/permissions/tenant-audit-census.mdx',
  'docs/audits/2026-08-tenant-audit-write-call-sites.counts.md',
];

/**
 * The census-derived numbers the page states in its own prose.
 *
 * Each row's `pattern` must match EXACTLY ONCE outside the generated region, and
 * its capture must equal `expected(census)`. Zero matches is a failure, not a
 * pass: that is what stops a reworded page from quietly falling out of scope.
 *
 * ⚠️ Matched against the prose with WHITESPACE COLLAPSED, so every pattern is
 * written with single spaces and none of them can break on a re-wrap. The page is
 * hard-wrapped at 80 columns; a pattern spanning two words is one reflow away
 * from matching nothing, and "matches nothing" is a FAILURE here -- so a
 * line-sensitive pattern would turn every cosmetic re-wrap into a red gate and
 * teach the next author to loosen the rule. Reflow is not a semantic change and
 * this gate must not treat it as one.
 */
export const PROSE_COUNTS = [
  {
    name: 'sites reached through an erased receiver',
    pattern: /there are (\d+) of them/,
    expected: (c) => c.totals.placedByObjectName + c.totals.placedByObjectNameParameter + c.totals.placedByLedger,
  },
  {
    name: 'sites reached through an erased receiver (deviation section)',
    pattern: /the (\d+) sites reached through an erased \(`any`\) receiver/,
    expected: (c) => c.totals.placedByObjectName + c.totals.placedByObjectNameParameter + c.totals.placedByLedger,
  },
  {
    name: 'sites naming their object through a const',
    pattern: /and the (\d+) that name their object through a `const`/,
    expected: (c) => c.totals.objectNameConst,
  },
  {
    name: 'declared objects in the registry',
    pattern: /Across (\d+) declared objects/,
    expected: (c) => c.declaredObjects,
  },
  {
    name: 'sites whose options argument is unreadable (limits section)',
    pattern: /\*\*(\d+) of the \d+ sites are spelled that way\*\*/,
    expected: (c) => c.totals.tenantContextUnreadable,
  },
  {
    name: 'the population that unreadable share is of',
    pattern: /\*\*\d+ of the (\d+) sites are spelled that way\*\*/,
    expected: (c) => c.totals.writeCallSites,
  },
  {
    name: 'decidably-not-elevated is now zero',
    pattern: /decidably-not-elevated sites is now \*\*(\d+)\*\*/,
    expected: (c) => c.totals.nonElevatedContext,
  },
  {
    name: 'sites the over-claim published as carrying no context',
    pattern: /published \*\*(\d+) sites "carrying no tenant context at all"\*\*/,
    expected: (c) => c.totals.provablyNoTenantContext + c.totals.tenantContextUnreadable,
  },
  {
    name: 'of those, the ones that actually said so',
    pattern: /when (\d+) said so and \d+ were simply unread/,
    expected: (c) => c.totals.provablyNoTenantContext,
  },
  {
    name: 'of those, the ones that were merely unread',
    pattern: /when \d+ said so and (\d+) were simply unread/,
    expected: (c) => c.totals.tenantContextUnreadable,
  },
  {
    name: 'deviation row: write call sites',
    pattern: /\| 175 write call sites \|[^|]*\| \*\*(\d+)\*\* \|/,
    expected: (c) => c.totals.writeCallSites,
  },
  {
    name: 'deviation row: provable and tenancy-enabled',
    pattern: /\| 24 carrying no tenant context \|[^|]*\| \*\*(\d+)\*\* provable and tenancy-enabled/,
    expected: (c) => c.totals.tenancyEnabledProvablyNoContext,
  },
  {
    name: 'deviation row: unreadable and tenancy-enabled',
    pattern: /provable and tenancy-enabled; \*\*(\d+)\*\* more whose options argument is unreadable/,
    expected: (c) => c.totals.tenancyEnabledContextUnreadable,
  },
  {
    name: 'deviation row: statically decidable',
    pattern: /\| \*\*(\d+) of \d+\*\* decidable, \*\*\d+\*\* undecidable \|/,
    expected: (c) => c.totals.staticallyDecidableObjectName,
  },
  {
    name: 'deviation row: population the decidable share is of',
    pattern: /\| \*\*\d+ of (\d+)\*\* decidable, \*\*\d+\*\* undecidable \|/,
    expected: (c) => c.totals.writeCallSites,
  },
  {
    name: 'deviation row: undecidable',
    pattern: /\| \*\*\d+ of \d+\*\* decidable, \*\*(\d+)\*\* undecidable \|/,
    expected: (c) => c.totals.undecidableObjectName,
  },
  {
    name: 'deviation row: decidably elevated',
    pattern: /\*\*not reproduced\*\*: (\d+) decidably elevated/,
    expected: (c) => c.totals.elevatedContext,
  },
  {
    name: 'deviation row: decidably not elevated',
    pattern: /decidably elevated, (\d+) decidably not/,
    expected: (c) => c.totals.nonElevatedContext,
  },
  {
    name: 'deviation row: elevation undecidable',
    pattern: /decidably not, (\d+) undecidable \|/,
    expected: (c) => c.totals.elevationUndecidable,
  },
  {
    name: 'the elevated share restated in prose',
    pattern: /This census reads (\d+) of \d+ \(\d+%\) as decidably elevated/,
    expected: (c) => c.totals.elevatedContext,
  },
  {
    name: 'the population that elevated share is of',
    pattern: /This census reads \d+ of (\d+) \(\d+%\) as decidably elevated/,
    expected: (c) => c.totals.writeCallSites,
  },
  {
    name: 'the figure downstream cards should cite',
    pattern: /Cite `(\d+) \/ \d+`/,
    expected: (c) => c.totals.tenancyEnabledProvablyNoContext,
  },
  {
    name: 'the population that figure is of',
    pattern: /Cite `\d+ \/ (\d+)`/,
    expected: (c) => c.totals.writeCallSites,
  },
  {
    name: 'the further sites that are neither in nor out',
    pattern: /\*\*(\d+) further sites\*\* have an options argument this cannot read/,
    expected: (c) => c.totals.tenancyEnabledContextUnreadable,
  },
];

/** Split the page into its hand-written prose and its generated region. */
export function splitPage(pageText) {
  const begin = pageText.indexOf(BEGIN_MARKER);
  const end = pageText.indexOf(END_MARKER);
  if (begin === -1 || end === -1) {
    return {
      error:
        `${PAGE} has no generated region -- expected the marker pair `
        + '`BEGIN GENERATED: tenant-audit-census` / `END GENERATED: tenant-audit-census`. '
        + 'Run `node scripts/tenant-audit-census.mjs --write` after restoring them.',
    };
  }
  return {
    prose: pageText.slice(0, begin) + pageText.slice(end + END_MARKER.length),
    region: pageText.slice(begin, end + END_MARKER.length),
  };
}

/** The first line at which two texts differ, for a refusal that names the drift. */
function firstDifference(committed, expected) {
  const a = committed.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return { line: i + 1, committed: a[i] ?? '(page ends here)', expected: b[i] ?? '(census ends here)' };
    }
  }
  return null;
}

/**
 * Run both checks against a census and a page text.
 *
 * Takes the page as TEXT rather than reading it, so the self-test can feed
 * adversarial pages through the same code path the production run uses.
 *
 * @returns {string[]} problems, empty when clean.
 */
export function checkPage(census, pageText, countsText) {
  const problems = [];

  if (census.sites.length === 0) {
    problems.push(
      '[empty-census] the census found ZERO write call sites -- refusing to certify a page '
      + 'against nothing (a walk that found nothing and a tree with nothing to find are different).',
    );
    return problems;
  }

  const split = splitPage(pageText);
  if (split.error) {
    problems.push(`[no-region] ${split.error}`);
    return problems;
  }
  const prose = split.prose.replace(/\s+/g, ' ');

  // ── A DRIFT ────────────────────────────────────────────────────────────────
  for (const [label, committed, expected] of [
    [PAGE, split.region, renderGeneratedRegion(census)],
    [COUNTS, countsText, renderCountsFile(census)],
  ]) {
    if (committed === expected) continue;
    const diff = firstDifference(committed ?? '', expected);
    problems.push(
      `[census-drift] the committed census in ${label} is not what the tree produces. `
      + (diff
        ? `First difference at line ${diff.line}:\n`
          + `    committed : ${diff.committed}\n`
          + `    census    : ${diff.expected}\n`
        : '')
      + '    Fix: node scripts/tenant-audit-census.mjs --write',
    );
  }

  // ── B PROSE ────────────────────────────────────────────────────────────────
  for (const row of PROSE_COUNTS) {
    const matches = [...prose.matchAll(new RegExp(row.pattern, 'g'))];
    if (matches.length === 0) {
      problems.push(
        `[prose-pattern-dead] the page no longer states "${row.name}" in the shape this gate `
        + `checks (${row.pattern}). A reworded page must not silently stop being checked -- `
        + 'either restore the wording or update PROSE_COUNTS in this gate.',
      );
      continue;
    }
    if (matches.length > 1) {
      problems.push(
        `[prose-pattern-ambiguous] "${row.name}" matches ${matches.length} places in the page. `
        + 'This gate checks one number per row; narrow the pattern.',
      );
      continue;
    }
    const stated = Number(matches[0][1]);
    const actual = row.expected(census);
    if (stated !== actual) {
      problems.push(
        `[prose-count] the page states ${stated} for "${row.name}"; the census says ${actual}. `
        + 'The page is hand-written here -- a quoted number outliving its measurement is the '
        + 'exact failure this artefact replaced.',
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Self-test -- the only instrument on this gate's matching rules
// ---------------------------------------------------------------------------

/**
 * A clean tree cannot tell a working rule from a weakened one: green means the
 * problem set is empty, and weakening a rule can only shrink that set. So both
 * rules are driven here against pages a clean tree does not contain -- and the
 * REAL census, so a rule that stops reading the tree fails here too.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const census = runCensus();
  const page = readFileSync(join(ROOT, PAGE), 'utf8');
  const counts = readFileSync(join(ROOT, COUNTS), 'utf8');
  const check = (p = page, c = counts) => checkPage(census, p, c);

  t('the committed artefacts are clean', check().length === 0, check().join(' | '));

  // ── A DRIFT ────────────────────────────────────────────────────────────────
  // ⭐ A row deleted from the LEDGER -- "a site exists in code and no row names
  // it", which is the direction that matters and the one a clean tree cannot show.
  const countLines = counts.split('\n');
  const firstRow = countLines.findIndex((l) => l.startsWith('| `packages/'));
  t('a site that exists in code but has no row in the ledger is a finding',
    firstRow !== -1
    && check(page, [...countLines.slice(0, firstRow), ...countLines.slice(firstRow + 1)].join('\n'))
      .some((p) => p.startsWith('[census-drift]')));

  // A count changed in the generated region -- the shape a hand-edit takes.
  t('an edited count inside the page region is a finding',
    check(page.replace(
      `| write call sites on the application surface | **${census.totals.writeCallSites}** |`,
      `| write call sites on the application surface | **${census.totals.writeCallSites + 1}** |`,
    )).some((p) => p.startsWith('[census-drift]')));

  t('an edited total inside the ledger is a finding',
    check(page, counts.replace(
      `| Write call sites | ${census.totals.writeCallSites} |`,
      `| Write call sites | ${census.totals.writeCallSites - 1} |`,
    )).some((p) => p.startsWith('[census-drift]')));

  // The markers themselves -- a page that lost its region must refuse, never pass.
  t('a page with no generated region refuses',
    check(page.replace(BEGIN_MARKER, '')).some((p) => p.startsWith('[no-region]')));

  // ── B PROSE ────────────────────────────────────────────────────────────────
  t('a stale hand-written number in the prose is a finding',
    check(page.replace(`Across ${census.declaredObjects} declared objects`, `Across ${census.declaredObjects - 1} declared objects`))
      .some((p) => p.startsWith('[prose-count]')));

  t('a stale number in the DEVIATION table is a finding',
    check(page.replace(
      `| **${census.totals.writeCallSites}** |`,
      `| **${census.totals.writeCallSites - 7}** |`,
    )).some((p) => p.startsWith('[prose-count]') || p.startsWith('[census-drift]')));

  // ⭐ The direction a clean tree cannot show: a page that stops SAYING the thing
  // is not a page that passes. Rewording out of scope must red, or every prose
  // rule can be retired by deleting a sentence.
  t('a prose claim reworded out of the gate\'s reach is a finding, not a pass',
    check(page.replace(`Across ${census.declaredObjects} declared objects`, 'Across many declared objects'))
      .some((p) => p.startsWith('[prose-pattern-dead]')));

  t('the "cite this figure" line is held to the census',
    check(page.replace(
      `Cite \`${census.totals.tenancyEnabledProvablyNoContext} / ${census.totals.writeCallSites}\``,
      `Cite \`24 / ${census.totals.writeCallSites}\``,
    )).some((p) => p.startsWith('[prose-count]')));

  // ── refusals ───────────────────────────────────────────────────────────────
  t('an empty census refuses rather than certifying the artefacts',
    checkPage({ ...census, sites: [] }, page, counts).some((p) => p.startsWith('[empty-census]')));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length > 0) {
    console.error(`✗ check-tenant-audit-census self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }

  // ⭐ The GENERATOR's classifier cases run here, and this is the only place
  // they run. They cannot be a flag on that module: CI invoking it directly
  // makes it a gate file, and `dispatch-gates` then refuses to follow it, which
  // silently cuts the 22 path literals this gate inherits from it. Running them
  // from here keeps the instrument AND the inheritance. ⛔ Never let this
  // swallow the exit code -- a green gate self-test over a red census self-test
  // is exactly the shape both of them exist to refuse.
  const censusExit = censusSelfTest();
  if (censusExit !== 0) {
    console.error('✗ check-tenant-audit-census self-test: the census self-test it drives FAILED (above).');
    return censusExit;
  }
  console.log(
    `✓ check-tenant-audit-census self-test: ${cases.length} cases pass `
    + '(drift on a dropped ledger row, on an edited page count, on an edited ledger '
    + 'total and on a lost region; prose drift, prose reworded out of reach, and an '
    + 'empty census).',
  );
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  let page;
  let counts;
  try {
    page = readFileSync(join(ROOT, PAGE), 'utf8');
  } catch (error) {
    console.error(`::error::[unreadable-page] cannot read ${PAGE} -- ${error.message}`);
    return 1;
  }
  try {
    counts = readFileSync(join(ROOT, COUNTS), 'utf8');
  } catch (error) {
    console.error(`::error::[unreadable-ledger] cannot read ${COUNTS} -- ${error.message}`);
    return 1;
  }

  const census = runCensus();
  const problems = checkPage(census, page, counts);
  for (const p of problems) console.error(`::error::${p}`);

  if (problems.length > 0) {
    console.error(`✗ check-tenant-audit-census: ${problems.length} problem(s).`);
    return 1;
  }
  const t = census.totals;
  console.log(
    `✓ check-tenant-audit-census: OK -- ${t.writeCallSites} write call sites certified `
    + `(${t.staticallyDecidableObjectName} decidable; ${t.tenancyEnabledProvablyNoContext} tenancy-enabled `
    + `sites PROVABLY carry no tenant context, ${t.tenancyEnabledContextUnreadable} more unreadable), `
    + `${PROSE_COUNTS.length} prose figures held to the census.`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
