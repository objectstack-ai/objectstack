#!/usr/bin/env node
/**
 * check-registry-bare-name-collisions -- who governs a BARE registry key.
 *
 *   node scripts/check-registry-bare-name-collisions.mjs            # the gate
 *   node scripts/check-registry-bare-name-collisions.mjs --table    # the measured population
 *   node scripts/check-registry-bare-name-collisions.mjs --json     # the same, machine-readable
 *
 * ## The hazard (objectui#9264)
 *
 * `Registry.register` writes a bare-name fallback ALONGSIDE the namespaced key
 * -- its own branch is `if (meta?.namespace && !meta?.skipFallback)` -- and the
 * bare write is last-one-wins. So when two registrations name the same bare
 * key with DIFFERENT full types, which declaration governs an authored
 * `{ "type": "<bare>" }` node depends on module import order. The symptom is
 * not an error: it is the wrong renderer, chosen by import order, for a node
 * that type-checks fine.
 *
 * Two things already exist and neither closes it:
 *
 *   - a RUNTIME warning in `Registry.register`, whose text begins "bare-name
 *     fallback is being overwritten by". It surfaces a collision in a browser
 *     console; it fails nothing, and `registerLazy` -- which takes the same
 *     `meta?.namespace && !meta?.skipFallback` branch -- has no guard at all.
 *   - `skipFallback: true`, the documented opt-out, applied case by case
 *     (`@object-ui/fields`' `FIELD_TYPES_SKIP_FALLBACK`, `record:line_items`,
 *     `ui:calendar`, the `plugin-grid` and `plugin-list` aliases). It is
 *     OPT-IN: a registration that forgets it takes the bare name silently.
 *
 * This gate is the missing half: a new contested bare key FAILS here.
 *
 * ## What counts as a collision, and what deliberately does not
 *
 * ⭐ The predicate is DISTINCT FULL TYPES, not "more than one registration".
 * This repository's normal shape is a console lazy stub and the plugin itself
 * claiming one bare key under the SAME full type -- the shape objectui#6416
 * converged `plugin-report` onto, and the reason
 * `report-bare-key-ownership.test.ts` replays registrations in both orders. A
 * bare key whose claimants all name one full type has ONE owner by
 * construction, whichever phase a host observes. Counting registrations rather
 * than declarations would report every one of those pairs as a defect.
 *
 * Three further dispositions are carried rather than filtered, because "did
 * not contest" and "was not seen" must never collapse into one answer:
 *
 *   - STOOD DOWN -- a namespaced registration with `skipFallback: true`. It
 *     would have claimed the bare name and declined. These are the cases the
 *     repository has ALREADY solved, and the gate's own controls require them
 *     to be visible: an instrument that cannot see a solved case cannot be
 *     trusted about an unsolved one.
 *   - GUARDED -- a registration inside `if (!ComponentRegistry.get(type))`,
 *     the placeholder registrar's shape. It writes the bare key only when
 *     nothing holds it, and a later real `register` overwrites it either way,
 *     so it never decides ownership.
 *   - OPEN -- a call whose key argument genuinely cannot be known statically
 *     (a registrar helper's parameter). Declared in `OPEN_REGISTRATION_SITES`
 *     with the reason, and each declared file must still contain such a call.
 *
 * ## Where the population comes from
 *
 * The AST half reuses `readRegistrationClaims` from
 * `scripts/unit-registry-collision.mjs` -- objectui#7134's walker, factored so
 * a caller that needs the CLAIMANT rather than the key does not need a second
 * walker over the same calls. The data-driven half (`registerAllFields()`
 * walks a map; the placeholder registrar walks an array) is not readable from
 * a call site at all, so it is taken from `INDIRECT_REGISTRATIONS` and
 * `deriveRegistryKeys` in `scripts/check-doc-component-types.mjs` -- the same
 * table `regenerate-known-schema-types.mjs` already follows, rather than a
 * third private list of collections that would drift.
 *
 * Tests are OUT of the population on purpose: a registration in a test body
 * happens when that test runs, in that worker's registry, and governs nothing
 * a host can author. objectui#7134's gate is the one that cares about those.
 *
 * ## The ledger
 *
 * `KNOWN_BARE_NAME_COLLISIONS` is SHRINK-ONLY, in the shape
 * `check-entry-guard`'s `KNOWN_HAND_TYPED_GUARDS` established: a contested key
 * that is not in it fails, a ledger entry whose claimants grew fails, and a
 * ledger entry that no longer collides fails as stale so a resolved collision
 * cannot leave a licence behind. Entries carry the CLAIMANTS, not just the
 * name, because objectui#9256's hold-outs have to be resolvable one at a time
 * and a bare key name resolves none of them.
 *
 * ⛔ Entries are keyed by file and full type, never by line number: a stored
 * line address is a key that rots on the next insertion above it (AGENTS.md
 * section 5, commandment #11). Line numbers are printed as diagnostics, which
 * are computed every run and cannot expire.
 *
 * ⛔ Adding `skipFallback: true` to a registration to empty this ledger is a
 * BEHAVIOUR change -- it decides which renderer a bare name resolves to. Each
 * one needs its own ruling; objectui#9256 holds eleven registrations for
 * exactly that reason. This gate makes those decidable. It does not decide
 * them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveRegistryKeys, INDIRECT_REGISTRATIONS } from './check-doc-component-types.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { collectFiles, readRegistrationClaims } from './unit-registry-collision.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every workspace source root that can register a component. */
export const INCLUDE_GLOBS = [
  'packages/**/*.ts',
  'packages/**/*.tsx',
  'apps/**/*.ts',
  'apps/**/*.tsx',
  'examples/**/*.ts',
  'examples/**/*.tsx',
];

/**
 * Build OUTPUT, excluded from the population — and this is not housekeeping.
 *
 * Measured while landing this gate: the same sweep read 1633 source files
 * before `turbo run build` and 1639 after it. The six were the framework
 * caches `apps/site/.next` and `apps/site/.source` plus a generated
 * `plugin.d.ts`. A population that moves with whether someone has built is a
 * population no two runs agree on, and objectui#9256's table records the
 * neighbouring version of this hazard: an unbuilt tree answered `any` and
 * `any` read as "reads neither".
 *
 * A dot-segment is how every generator here hides its output; `.d.ts` is
 * emitted type, and no declaration file carries a registration CALL. The
 * sibling `walkFiles` in `check-doc-component-types.mjs` skips dot-directories
 * for the same reason, which is why its file count did not move.
 */
export function isGeneratedPath(rel) {
  return rel.split('/').some((segment) => segment.startsWith('.')) || /\.d\.tsx?$/.test(rel);
}

/**
 * Test sources, excluded from the population. The spelling mirrors the
 * `isTestFile` predicate in `check-doc-component-types.mjs`, widened by the
 * `test/` and `e2e/` directories this repo also uses, so the two gates read
 * the same tree.
 */
export function isTestPath(rel) {
  return (
    rel.includes('/__tests__/') ||
    rel.includes('/test/') ||
    rel.includes('/e2e/') ||
    /\.(test|spec)\.[tj]sx?$/.test(rel)
  );
}

/**
 * Registration calls whose key argument cannot be known from the call site,
 * declared by FILE with the reason. Each declared file must still contain such
 * a call, and a file that produces one without being declared here is a
 * finding -- the population must never shrink quietly.
 */
export const OPEN_REGISTRATION_SITES = {
  'packages/components/src/renderers/placeholders.tsx':
    '`registerPlaceholder(type)` takes the key as a parameter. Its keys are read from ' +
    'PROTOCOL_COMPONENTS through INDIRECT_REGISTRATIONS, and every one of them is GUARDED by the ' +
    "registrar's own `if (!ComponentRegistry.get(type))`.",
  'packages/fields/src/index.tsx':
    '`registerField(fieldType)` and the retired-field tombstone registrar both take the key as a ' +
    'parameter. The live keys are read from fieldWidgetMap through INDIRECT_REGISTRATIONS; the ' +
    'tombstone registrar declares `skipFallback: true` at its call site, so it claims no bare key.',
  'packages/plugin-dashboard/src/index.tsx':
    'The retired-node-type tombstone registrar loops over RETIRED_DASHBOARD_NODE_TYPES, so its key ' +
    'argument is a loop binding rather than a literal (objectui#9533). It declares ' +
    '`skipFallback: true` at its call site, so it claims no bare key and decides no bare-name ' +
    "ownership; the package's eight literal registrations, `plugin-dashboard:dashboard` included, " +
    'are read normally.',
};

/**
 * Indirect sites whose registrations are GUARDED by an existence check. The
 * quoted guard is re-read every run: if it goes, the entry is a finding rather
 * than a silent downgrade of those claims to "cannot contest".
 */
export const GUARDED_INDIRECT_SITES = {
  'packages/components/src/renderers/placeholders.tsx': 'if (!ComponentRegistry.get(type))',
};

/**
 * Controls. A sweep that reports nothing is indistinguishable from a sweep
 * that sees nothing, so the cases this repository has ALREADY solved must come
 * back visible, in both directions:
 *
 *   - `standDown` -- names whose bare key was deliberately declined with
 *     `skipFallback: true`. If the instrument cannot see these, its silence
 *     about everything else means nothing.
 *   - `agreed` -- bare keys claimed by two or more registrations that name ONE
 *     full type. These are the live, multi-claimant keys the gate must NOT
 *     report; if they vanish, the sweep has stopped seeing claimants at all
 *     and every "no collision" answer below it is empty.
 */
export const CONTROLS = {
  standDown: ['text', 'image', 'avatar', 'html', 'grid', 'line_items'],
  agreed: ['object-map', 'object-kanban'],
};

/**
 * Floors. Every population here is one a silent zero would make GREEN, which
 * is the failure mode this gate exists to refuse one level down, so it is
 * refused here too. Move one deliberately, never to make a red run green.
 */
export const FLOORS = {
  populationFiles: 1000,
  filesWithRegistrations: 100,
  claims: 250,
  bareKeysClaimed: 150,
  standDownNames: 20,
};

/** Floors that were not met, as human-readable lines. Empty means non-vacuous. */
export function checkFloors(counts, floors = FLOORS) {
  const out = [];
  for (const [name, floor] of Object.entries(floors)) {
    const got = counts[name];
    if (typeof got !== 'number') out.push(`${name}: NOT MEASURED (floor ${floor})`);
    else if (got < floor) out.push(`${name}: found ${got}, floor is ${floor}`);
  }
  return out;
}

/** The workspace a source file belongs to, for reading the table by package. */
export function packageOf(rel) {
  const parts = rel.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * A claimant's stable identity in the ledger: WHERE it is declared and WHAT it
 * declares. No line number -- see the header.
 */
export function claimantId(claim) {
  return `${claim.file} · ${claim.fullType} · ${claim.method}`;
}

/**
 * Every registration claim this repository's shipped source makes.
 * `unresolved` and `findings` are returned rather than dropped.
 */
export function collectClaims(root = repoRoot, options = {}) {
  const indirect = options.indirectRegistrations ?? INDIRECT_REGISTRATIONS;
  const openSites = options.openRegistrationSites ?? OPEN_REGISTRATION_SITES;
  const guardedSites = options.guardedIndirectSites ?? GUARDED_INDIRECT_SITES;
  const claims = [];
  const findings = [];
  const unresolved = [];
  const counters = { populationFiles: 0, filesWithRegistrations: 0, claims: 0, indirectClaims: 0 };

  const files = collectFiles(root, options.includeGlobs ?? INCLUDE_GLOBS).filter(
    (f) => !isTestPath(f) && !isGeneratedPath(f),
  );
  counters.populationFiles = files.length;

  for (const rel of files) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    if (!/\.register(Lazy)?\s*\(/.test(source)) continue;
    counters.filesWithRegistrations++;
    const read = readRegistrationClaims(source, rel, { resolveLoops: true });
    for (const claim of read.claims) claims.push({ ...claim, file: rel, package: packageOf(rel) });
    for (const site of read.unresolved) unresolved.push({ ...site, file: rel });
  }

  // Declared-open sites: each must still produce an unresolvable call, and an
  // undeclared one is reported rather than forgiven.
  const openSeen = new Set(unresolved.map((u) => u.file));
  for (const file of openSeen) {
    if (!openSites[file]) {
      findings.push({
        reason: 'undeclared-open-registration',
        site: file,
        detail:
          'this file registers with a key that is not statically knowable and is not declared in ' +
          'OPEN_REGISTRATION_SITES. Its keys are invisible to this gate, so declare the site with ' +
          'the reason, or teach the walker the form.',
      });
    }
  }
  for (const file of Object.keys(openSites)) {
    if (!openSeen.has(file)) {
      findings.push({
        reason: 'stale-open-registration',
        site: file,
        detail:
          'OPEN_REGISTRATION_SITES names this file, but no unresolvable registration call was found ' +
          'in it. Re-confirm the site or delete the entry.',
      });
    }
  }

  // The data-driven half, taken from the table the doc gate already follows.
  const derived = deriveRegistryKeys(root, { indirectRegistrations: indirect });
  for (const finding of derived.findings) {
    findings.push({ reason: `doc-gate:${finding.reason}`, site: finding.site, detail: finding.detail });
  }
  // ⚠️ ONE PASS PER (site, namespace), not per entry. `derived.keys` attributes
  // an indirect key to the entry's FILE, so everything below — `at`, `names`,
  // `bare`, the guard — is a function of the file and the namespace and of
  // nothing else in the entry. Since objectui#9717 made INDIRECT_REGISTRATIONS'
  // coverage collection-keyed, one file legitimately carries several entries,
  // and iterating entries then pushed the SAME claim once per entry: measured
  // on this tree, the second placeholder entry alone took the claim count from
  // 425 to 509, and a second `packages/fields/src/index.tsx` entry moved 29 bare
  // keys from `sole` to `agreed` — two claimants where the tree has one, which
  // is a verdict this gate exists to report honestly. ⛔ The duplicates are not
  // extra claims to be deduplicated downstream; they are one claim counted
  // twice, so the pass itself is keyed the way the attribution is.
  const claimedByNamespace = new Set();
  for (const entry of indirect) {
    const pass = JSON.stringify([entry.site, entry.namespace]);
    if (claimedByNamespace.has(pass)) continue;
    claimedByNamespace.add(pass);
    const prefix = `${entry.namespace}:`;
    const at = [...derived.keys.entries()].filter(([, sites]) => sites.includes(entry.site)).map(([key]) => key);
    const names = at.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    const bare = new Set(at.filter((key) => !key.startsWith(prefix)));
    const guard = guardedSites[entry.site] ?? null;
    if (guard) {
      const source = fs.readFileSync(path.join(root, entry.site), 'utf8');
      if (!source.includes(guard)) {
        findings.push({
          reason: 'stale-guard-declaration',
          site: entry.site,
          detail:
            `GUARDED_INDIRECT_SITES says this file guards its registrations with ${JSON.stringify(guard)}, ` +
            'and that text is gone. Its claims would silently become uncontested; re-confirm the guard ' +
            'or delete the entry.',
        });
      }
    }
    for (const type of names) {
      counters.indirectClaims++;
      claims.push({
        type,
        namespace: entry.namespace,
        fullType: `${entry.namespace}:${type}`,
        skipFallback: !bare.has(type),
        claimsBare: bare.has(type),
        guarded: Boolean(guard),
        method: 'register',
        receiver: 'ComponentRegistry',
        line: null,
        origin: 'indirect',
        file: entry.site,
        package: packageOf(entry.site),
      });
    }
  }

  counters.claims = claims.length;
  return { claims, unresolved, findings, counters, files };
}

/**
 * Group claims by the BARE key each one writes or declines, and say what
 * governs it.
 */
export function groupBareKeys(claims) {
  const groups = new Map();
  const at = (key) => {
    if (!groups.has(key)) groups.set(key, { key, claimants: [], guarded: [], standDowns: [] });
    return groups.get(key);
  };
  for (const claim of claims) {
    if (claim.claimsBare) {
      if (claim.guarded) at(claim.type).guarded.push(claim);
      else at(claim.type).claimants.push(claim);
    } else if (claim.namespace && claim.skipFallback) {
      at(claim.type).standDowns.push(claim);
    }
  }
  for (const group of groups.values()) {
    const owners = [...new Set(group.claimants.map((c) => c.fullType))].sort();
    group.owners = owners;
    group.verdict =
      owners.length > 1 ? 'contested' : group.claimants.length > 1 ? 'agreed' : owners.length === 1 ? 'sole' : 'declined';
    group.handled = group.standDowns.length > 0;
  }
  return groups;
}

/**
 * The ledger. SHRINK-ONLY: every entry is a bare key whose claimants name two
 * or more different full types today, with the claimants that make it so.
 *
 * ⛔ Nothing may be ADDED here to make a red run green. A new contested key is
 * a decision about which renderer answers an authored node, and it belongs in
 * a card, not in this constant.
 */
export const KNOWN_BARE_NAME_COLLISIONS = [
  // EMPTY, and that is a reading rather than a default. The one entry this
  // ledger was born with — bare `dashboard`, claimed as `plugin-dashboard:dashboard`
  // by the two console `registerLazy` loops and as `view:dashboard` by the plugin
  // itself — was RESOLVED by objectui#9533 (director summon #24 / batch #152
  // item 5, letter 1, maintainer-approved): the package now registers
  // `plugin-dashboard:dashboard`, so all three claimants name ONE full type and
  // the key has one owner by construction. The row is gone rather than reworded,
  // which is what "shrink-only" means here; a stale entry would fail anyway.
  // ⛔ Nothing goes back in to make a red run green — see the header.
];

/** Every finding the gate has, as human-readable records. */
export function evaluate(root = repoRoot, options = {}) {
  const ledger = options.ledger ?? KNOWN_BARE_NAME_COLLISIONS;
  const controls = options.controls ?? CONTROLS;
  const floors = options.floors ?? FLOORS;
  const collected = collectClaims(root, options);
  const groups = groupBareKeys(collected.claims);
  const findings = [...collected.findings];

  const counts = {
    ...collected.counters,
    bareKeysClaimed: [...groups.values()].filter((g) => g.claimants.length > 0).length,
    standDownNames: [...groups.values()].filter((g) => g.standDowns.length > 0).length,
  };

  for (const line of checkFloors(counts, floors)) {
    findings.push({
      reason: 'vacuous-sweep',
      site: 'population',
      detail: `${line} — the sweep found too little to be a measurement, so its silence is not a pass.`,
    });
  }

  // Controls, both directions.
  for (const key of controls.standDown) {
    const group = groups.get(key);
    if (!group || group.standDowns.length === 0) {
      findings.push({
        reason: 'control-missing',
        site: `control:standDown:${key}`,
        detail:
          `the bare key ${JSON.stringify(key)} is declined by a \`skipFallback: true\` registration in ` +
          'this repository, and this sweep did not see that. An instrument blind to a solved case ' +
          'cannot be trusted about an unsolved one.',
      });
    }
  }
  for (const key of controls.agreed) {
    const group = groups.get(key);
    if (!group || group.claimants.length < 2 || group.owners.length !== 1) {
      findings.push({
        reason: 'control-missing',
        site: `control:agreed:${key}`,
        detail:
          `the bare key ${JSON.stringify(key)} is claimed by two or more registrations naming ONE full ` +
          'type. The sweep no longer sees that, so it is not seeing claimants — every "no collision" ' +
          'answer below it would be empty.',
      });
    }
  }

  const contested = [...groups.values()].filter((g) => g.verdict === 'contested');
  findings.push(...judgeAgainstLedger(groups, ledger));

  return {
    findings,
    groups,
    counts,
    claims: collected.claims,
    files: collected.files,
    unresolved: collected.unresolved,
    contested,
  };
}

/**
 * The judgement, kept pure so it can be exercised on PLANTED populations: a
 * gate whose failure path is only ever reached by breaking the real tree is a
 * gate nobody has seen fail.
 */
export function judgeAgainstLedger(groups, ledger = KNOWN_BARE_NAME_COLLISIONS) {
  const findings = [];
  const contested = [...groups.values()].filter((g) => g.verdict === 'contested');
  const byKey = new Map(ledger.map((entry) => [entry.key, entry]));
  for (const group of contested) {
    const entry = byKey.get(group.key);
    const claimants = group.claimants.map(claimantId).sort();
    if (!entry) {
      findings.push({
        reason: 'new-bare-name-collision',
        site: `bare key ${JSON.stringify(group.key)}`,
        detail:
          `claimed by ${group.owners.length} different full types, so import order decides which ` +
          `declaration governs an authored \`{ "type": ${JSON.stringify(group.key)} }\` node:\n` +
          group.claimants
            .map((c) => `        ${c.fullType.padEnd(32)} ${c.method.padEnd(13)} ${c.file}${c.line ? `:${c.line}` : ''}`)
            .join('\n') +
          '\n      Give the registration that should NOT own the bare name `skipFallback: true` — that ' +
          'is a behaviour decision and needs a ruling — or, if both should agree, converge them on one ' +
          'full type the way objectui#6416 did for `plugin-report`.',
      });
      continue;
    }
    const known = new Set(entry.claimants);
    const added = claimants.filter((c) => !known.has(c));
    if (added.length) {
      findings.push({
        reason: 'ledger-entry-grew',
        site: `bare key ${JSON.stringify(group.key)}`,
        detail: `a new claimant joined a known collision:\n${added.map((c) => `        ${c}`).join('\n')}`,
      });
    }
  }
  const contestedKeys = new Set(contested.map((g) => g.key));
  for (const entry of ledger) {
    if (!contestedKeys.has(entry.key)) {
      findings.push({
        reason: 'stale-ledger-entry',
        site: `bare key ${JSON.stringify(entry.key)}`,
        detail:
          'this key is in KNOWN_BARE_NAME_COLLISIONS and no longer has two claimants naming different ' +
          'full types. The ledger is shrink-only: delete the entry in the same change that resolved it.',
      });
    }
  }
  return findings;
}

/** The measured population, as the table objectui#9264 asks to be published. */
export function formatTable(result) {
  const lines = [];
  const order = { contested: 0, agreed: 1, sole: 2, declined: 3 };
  const groups = [...result.groups.values()].sort(
    (a, b) => order[a.verdict] - order[b.verdict] || a.key.localeCompare(b.key),
  );
  for (const verdict of ['contested', 'agreed', 'sole', 'declined']) {
    const rows = groups.filter((g) => g.verdict === verdict);
    lines.push(`\n## ${verdict} — ${rows.length} bare key(s)`);
    for (const group of rows) {
      if (verdict === 'sole' && !group.handled && group.guarded.length === 0) continue;
      lines.push(`  ${group.key}${group.handled ? '  [handled: a skipFallback stand-down exists]' : ''}`);
      for (const claim of group.claimants) {
        lines.push(
          `      CLAIMS  ${claim.fullType.padEnd(32)} ${claim.method.padEnd(13)} ` +
            `${claim.file}${claim.line ? `:${claim.line}` : ''}`,
        );
      }
      for (const claim of group.guarded) {
        lines.push(
          `      GUARDED ${claim.fullType.padEnd(32)} ${claim.method.padEnd(13)} ` +
            `${claim.file}${claim.line ? `:${claim.line}` : ''}`,
        );
      }
      for (const claim of group.standDowns) {
        lines.push(
          `      STOOD DOWN ${claim.fullType.padEnd(29)} ${claim.method.padEnd(13)} ` +
            `${claim.file}${claim.line ? `:${claim.line}` : ''}`,
        );
      }
    }
  }
  return lines.join('\n');
}

export function formatFindings(findings) {
  return findings.map((f) => `  [${f.reason}] ${f.site}\n      ${f.detail}`).join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const result = evaluate();
  const wantsTable = argv.includes('--table');
  const wantsJson = argv.includes('--json');

  if (wantsJson) {
    const groups = [...result.groups.values()].map((g) => ({
      key: g.key,
      verdict: g.verdict,
      handled: g.handled,
      owners: g.owners,
      claimants: g.claimants.map((c) => ({ ...c })),
      guarded: g.guarded.map((c) => ({ ...c })),
      standDowns: g.standDowns.map((c) => ({ ...c })),
    }));
    process.stdout.write(
      `${JSON.stringify({ counts: result.counts, unresolved: result.unresolved, findings: result.findings, groups }, null, 2)}\n`,
    );
  } else if (wantsTable) {
    process.stdout.write(`${formatTable(result)}\n`);
  }

  // With `--json` the summary goes to stderr: stdout must stay parseable, or a
  // caller piping it reads a truncation as a malformed measurement.
  const counts = result.counts;
  const say = wantsJson ? (t) => process.stderr.write(t) : (t) => process.stdout.write(t);
  say(
    `Scanned ${counts.populationFiles} source file(s); ${counts.filesWithRegistrations} register; ` +
      `${counts.claims} registration claim(s) (${counts.indirectClaims} from declared collections); ` +
      `${counts.bareKeysClaimed} bare key(s) claimed, ${counts.standDownNames} declined with skipFallback; ` +
      `${result.contested.length} contested; ledger holds ${KNOWN_BARE_NAME_COLLISIONS.length}.\n`,
  );
  if (result.unresolved.length) {
    say(
      `${result.unresolved.length} registration call(s) have a key this gate cannot resolve; every one ` +
        'is in a file declared in OPEN_REGISTRATION_SITES.\n',
    );
  }

  if (result.findings.length) {
    process.stderr.write(
      `\n✗ registry bare-name collisions: ${result.findings.length} finding(s)\n${formatFindings(result.findings)}\n`,
    );
    return 1;
  }
  say('✓ no new bare-name collision; every contested key is a declared, unresolved decision.\n');
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
