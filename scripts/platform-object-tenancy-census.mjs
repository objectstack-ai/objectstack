#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-object-tenancy-census -- the re-derivable enumeration of which
 * platform-namespace objects the tenancy machinery can reach, and why each
 * excluded one is excluded (#14957).
 *
 *   node scripts/platform-object-tenancy-census.mjs            # human summary
 *   node scripts/platform-object-tenancy-census.mjs --json     # the whole census
 *   node scripts/platform-object-tenancy-census.mjs --write    # rewrite the artefact
 *
 * `scripts/platform-object-tenancy-census.json` is the artefact this builds.
 * `check-platform-object-tenancy-census.mjs` is the gate that holds it to the
 * tree. Together they are the `tenant-audit-census.mjs` triple's shape applied
 * to the per-object tenancy classification.
 *
 * ⚠️ This module deliberately exposes NO `--self-test` flag of its own, for the
 * reason `tenant-audit-census.mjs` records for itself: a flag would make CI
 * invoke this file directly, which makes it a GATE FILE, and
 * `scripts/pm/dispatch-gates.mjs` refuses to follow a gate file -- the path
 * literals this module spells would stop being inherited by the gate that
 * imports it. {@link selfTest} below is real and runs on every CI pass:
 * `check-platform-object-tenancy-census.mjs --self-test` calls it.
 *
 * ## ⭐ THE PREDICATE, which is the deliverable; the number is a by-product
 *
 * "In the machinery's reach" is ONE question with ONE answer:
 *
 *     resolveTenantFieldName(REGISTERED schema) !== null
 *
 * REGISTERED, not authored. `applySystemFields` (`objectql/src/registry.ts`)
 * provisions the tenant COLUMN before the engine ever sees the object, so the
 * schema the resolver reads is not the one the author typed. Reading the
 * authored `fields` alone answers a different question and answers it
 * confidently.
 *
 * ⛔ `managedBy` is NOT the predicate. It is one of several DECLARATIONS that
 * happen to make the predicate answer null, and counting it as if the resolver
 * read it is precisely the mistake this artefact exists to make impossible --
 * see the drift transcript below, where that reading produced a right total
 * from a wrong reason and then a stale total from the same prose.
 *
 * ## ⭐ The predicate is EXECUTED, never transcribed
 *
 * Both halves are loaded FROM SOURCE and called (see {@link loadPredicate}):
 *
 *   - `resolveInjectedSystemColumns` (`packages/spec/src/data/
 *     injected-system-columns.ts`) -- WHICH columns the registration injects.
 *     `registry.ts` documents it as "the single source consumed by
 *     `applySystemFields`", and it is deliberately runtime-free so author-time
 *     consumers can call it.
 *   - `resolveTenantFieldName` (`packages/objectql/src/tenancy/
 *     system-write-organization.ts`) -- the engine's own resolver, the exact
 *     function the header's prose names.
 *
 * A transcription of either rule here would be a SECOND copy of a rule the
 * engine already owns, free to drift from it while reading as authoritative --
 * which is the failure one layer up from the one this file fixes. Loading them
 * costs a TypeScript transpile of their import graph and needs no build, which
 * is why the gate can live in the `lint` job (that job installs; it does not
 * build).
 *
 * ⛔ The loader NEVER stubs a module it cannot resolve. A stub would let the
 * census answer confidently out of code that is not the engine's -- the same
 * class of confident-wrong-answer the whole artefact is aimed at. It throws.
 *
 * ## ⭐ Why this exists AS AN ARTEFACT: the drift, measured
 *
 * `packages/objectql/src/tenancy/platform-object-tenancy.ts` used to state the
 * census in PROSE: "84 ... 25 ... (24 `managedBy: 'better-auth'`, plus
 * `sys_sso_provider`'s `tenancy.enabled: false`) ... 59". Nothing held it to
 * the tree, and it failed in both available directions inside one month:
 *
 *   1. WRONG REASON, RIGHT TOTAL. All 25 excluded objects were `managedBy:
 *      'better-auth'`; `sys_sso_provider` was one OF them, not an addition on
 *      top, and `sys_api_key` carries `tenancy.enabled: false` too and went
 *      unnamed. `24 + 1 = 25` is right, which is why no reader caught it.
 *   2. RIGHT REASON, STALE TOTAL. On 2026-09-04 04:37:18Z, commit efb3513178
 *      (PR #15155, from #15024) declared `systemFields: { tenant: false }` on
 *      `sys_metadata_activation` and dropped its reserved `organization_id`.
 *      That object left the machinery's reach: 84 / 25 / 59 became 84 / 26 /
 *      58. The same commit updated the GATED page next door
 *      (`content/docs/permissions/system-context.mdx`) and did not touch the
 *      ungated header, and CI was green throughout. The digits were stale for
 *      the whole of the following day with nothing anywhere saying so.
 *
 * ⇒ Failure 2 also introduced a THIRD exclusion mechanism that the prose's
 *   taxonomy had no slot for. That is why {@link EXCLUSION_REASONS} is an
 *   announce-never-absorb list rather than a summary: see below.
 *
 * ## ⭐ Reasons are recorded VERBATIM, and an unknown one is an ERROR
 *
 * Each excluded object carries the declarations from ITS OWN schema that
 * produce the exclusion, spelled the way the schema spells them
 * (`managedBy: 'better-auth'`, `systemFields.tenant: false`, ...). They are
 * NOT mutually exclusive and are not meant to be: `sys_api_key` carries two,
 * and flattening that into one "the reason" is how `sys_sso_provider` came to
 * be described as an addition to a set it was already in.
 *
 * An object the predicate excludes for which NO declared reason is found is
 * `unexplained`. That is an ERROR, never a default: `--write` REFUSES to
 * commit such a row and the gate reds on it. A new exclusion mechanism is
 * announced and adjudicated, never silently absorbed into a total -- the same
 * shape `tenant-audit-census.mjs` uses for an unplaceable receiver.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { transpileChecked } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The committed artefact this builds and the gate compares against. */
export const ARTEFACT = 'scripts/platform-object-tenancy-census.json';

/**
 * The header whose hand-written digits this artefact replaced. The gate
 * requires it to keep POINTING here -- see the gate's `HEADER_MARKERS`.
 */
export const HEADER = 'packages/objectql/src/tenancy/platform-object-tenancy.ts';

/** The two files the predicate is loaded from. Both are executed, not read. */
export const PREDICATE_SOURCES = {
  injectedColumns: 'packages/spec/src/data/injected-system-columns.ts',
  tenantFieldResolver: 'packages/objectql/src/tenancy/system-write-organization.ts',
};

/**
 * The namespace test, spelled as `system-write-organization.ts` spells it.
 *
 * ⚠️ NAME SHAPE ONLY. It selects the POPULATION this census is about; it says
 * nothing about tenancy, and `isPlatformNamespaceObject`'s own docblock forbids
 * reaching for it to decide tenancy. The five `cloud_` runtime objects defined
 * in the separate `cloud` repository are out of this tree's reach and so out of
 * this census -- "registered in THIS repository" is the population's scope.
 */
const PLATFORM_NAMESPACE = /^(sys_|cloud_|ai_)/;

/**
 * The exclusion mechanisms this census knows, each a DECLARATION read straight
 * off the object's own schema, keyed by the spelling the schema uses.
 *
 * ⛔ Do NOT add a row to shorten an `unexplained` list. A row here is a claim
 * that the tree has a mechanism, and the adjudication that admits one is what
 * failure 2 above skipped.
 */
export const EXCLUSION_REASONS = [
  {
    id: "managedBy: 'better-auth'",
    // better-auth owns these tables' column layout, so the registration injects
    // nothing at all -- `resolveInjectedSystemColumns` returns its `nothing`
    // plan. The column never exists, so the resolver never finds one.
    detect: (def) => def.managedBy === 'better-auth',
  },
  {
    id: 'systemFields: false',
    // The hard object-level opt-out (seed / migration tables): nothing injected.
    detect: (def) => def.systemFields === false,
  },
  {
    id: 'systemFields.tenant: false',
    // The narrow opt-out: audit columns still land, the tenant column does not.
    // This is the mechanism #15155 introduced to this population.
    detect: (def) =>
      def.systemFields !== null
      && typeof def.systemFields === 'object'
      && def.systemFields.tenant === false,
  },
  {
    id: 'tenancy.enabled: false',
    // ADR-0066's declaration that the table is a shared/global catalog. It
    // suppresses the column AND is read FIRST by `resolveTenantFieldName`, so
    // it excludes even an object that carries the column anyway.
    detect: (def) => def.tenancy !== null && typeof def.tenancy === 'object' && def.tenancy.enabled === false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Loading the predicate from source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a TypeScript module by transpiling it and its import graph.
 *
 * Three resolution rules, in order, and a throw when none of them answers:
 *   - a relative specifier resolves inside the tree, with `.js` rewritten to
 *     `.ts` (the tree's ESM-style spelling of a TypeScript import);
 *   - `@objectstack/<pkg>[/sub]` resolves to that package's SOURCE, because the
 *     `exports` map points at a `dist/` this gate must not require a build for;
 *   - anything else is a real installed dependency and goes to `require`,
 *     resolved from the IMPORTING file so a package's own dependencies are on
 *     its own resolution path.
 *
 * ⛔ There is no fourth rule and no fallback value. A specifier that resolves
 * to nothing throws.
 */
export function createSourceLoader(root = ROOT) {
  const cache = new Map();
  const loadedFiles = [];

  const resolveTs = (spec, fromDir) => {
    const base = resolve(fromDir, spec.replace(/\.(js|jsx|mjs)$/, ''));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch { /* fall through to the next candidate */ }
    }
    return null;
  };

  const load = (file) => {
    const hit = cache.get(file);
    if (hit) return hit.exports;
    const source = readFileSync(file, 'utf8');
    // `transpileChecked`, never a raw `ts.transpileModule`: the raw call reports
    // NOTHING on a source it could not read and still returns an `outputText`,
    // so an unparseable module would be evaluated as whatever survived and the
    // census would score the tree against wreckage with a clean exit. That is
    // this artefact's own failure class one layer down (`check-parse-guard`).
    const js = transpileChecked(file, source, {
      compilerOptions: { module: 'commonjs', target: 'es2022' },
    }).outputText;
    const mod = { exports: {} };
    // Seeded BEFORE evaluation so an import cycle sees the partial module the
    // way CommonJS does, instead of recursing until the stack ends.
    cache.set(file, mod);
    loadedFiles.push(file.startsWith(root) ? file.slice(root.length) : file);
    const req = (spec) => {
      if (spec.startsWith('.')) {
        const target = resolveTs(spec, dirname(file));
        if (!target) {
          throw new Error(
            `platform-object-tenancy-census: unresolved relative import '${spec}' from ${file} -- `
            + 'refusing to continue with a module graph this loader cannot read in full.',
          );
        }
        return load(target);
      }
      const workspace = /^@objectstack\/([a-z0-9-]+)(?:\/(.+))?$/.exec(spec);
      if (workspace) {
        const target = resolveTs(join(root, 'packages', workspace[1], 'src', workspace[2] ?? ''), '/');
        if (target) return load(target);
      }
      return createRequire(file)(spec);
    };
    // eslint-disable-next-line no-new-func -- the whole point: evaluate the
    // tree's own transpiled source rather than re-spelling what it decides.
    new Function('require', 'module', 'exports', '__filename', '__dirname', js)(
      req, mod, mod.exports, file, dirname(file),
    );
    return mod.exports;
  };

  return { load, loadedFiles, moduleCount: () => cache.size };
}

/**
 * The predicate's two halves, loaded and PROVEN to behave before use.
 *
 * The proof is not decoration. A loader that silently returned an empty object,
 * or a future refactor that moved the export, would otherwise leave every
 * object scored the same way with a clean exit -- the silent-success direction
 * this tree treats as worse than no check. So four fixed inputs with answers
 * that cannot both change and stay sensible are asserted here, at load time,
 * on every run including production.
 */
export function loadPredicate(root = ROOT) {
  const loader = createSourceLoader(root);
  const spec = loader.load(join(root, PREDICATE_SOURCES.injectedColumns));
  const engine = loader.load(join(root, PREDICATE_SOURCES.tenantFieldResolver));

  const resolveInjectedSystemColumns = spec.resolveInjectedSystemColumns;
  const resolveTenantFieldName = engine.resolveTenantFieldName;
  for (const [name, fn, file] of [
    ['resolveInjectedSystemColumns', resolveInjectedSystemColumns, PREDICATE_SOURCES.injectedColumns],
    ['resolveTenantFieldName', resolveTenantFieldName, PREDICATE_SOURCES.tenantFieldResolver],
  ]) {
    if (typeof fn !== 'function') {
      throw new Error(
        `platform-object-tenancy-census: ${file} did not export a callable '${name}'. The predicate `
        + 'is EXECUTED, so a missing export is a hard stop -- there is no transcription to fall back on.',
      );
    }
  }

  const proofs = [
    ['a plain object gets the tenant column',
      resolveInjectedSystemColumns({ name: 'sys_x' }).tenant === true],
    ["a better-auth table gets nothing",
      resolveInjectedSystemColumns({ name: 'sys_x', managedBy: 'better-auth' }).tenant === false],
    ['the resolver finds the injected column',
      resolveTenantFieldName({ fields: { organization_id: {} } }) === 'organization_id'],
    ['the resolver honours the opt-out over a present column',
      resolveTenantFieldName({ fields: { organization_id: {} }, tenancy: { enabled: false } }) === null],
  ];
  const failed = proofs.filter(([, ok]) => !ok).map(([what]) => what);
  if (failed.length > 0) {
    throw new Error(
      'platform-object-tenancy-census: the functions loaded from source do not behave like the '
      + `predicate they are supposed to BE (${failed.join('; ')}). Refusing to census against them.`,
    );
  }

  return { resolveInjectedSystemColumns, resolveTenantFieldName, loader };
}

// ─────────────────────────────────────────────────────────────────────────────
// The population
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every object this repository REGISTERS, loaded from its own declaration file.
 *
 * The population is the tracked `*.object.ts` modules under `packages/`, which
 * is where an object's registration is declared. They are loaded rather than
 * parsed: an AST reading would have to re-derive what a spread, a shared field
 * bundle or a helper builder contributes to `fields`, and the predicate's whole
 * point is that it runs on the real schema.
 */
export function registeredObjects(root = ROOT, loader = createSourceLoader(root)) {
  const files = execFileSync('git', ['-C', root, 'ls-files', 'packages'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter((f) => /\.object\.tsx?$/.test(f) && !f.includes('/dist/'))
    .sort();
  if (files.length === 0) {
    throw new Error(
      'platform-object-tenancy-census: the object walk found ZERO declaration files -- a walk that '
      + 'found nothing and a tree with nothing in it are different, and this refuses to guess which.',
    );
  }
  const objects = [];
  for (const rel of files) {
    const mod = loader.load(join(root, rel));
    for (const value of Object.values(mod)) {
      if (value && typeof value === 'object' && typeof value.name === 'string' && value.fields) {
        objects.push({ name: value.name, file: rel, def: value });
      }
    }
  }
  if (objects.length === 0) {
    throw new Error(
      `platform-object-tenancy-census: loaded ${files.length} declaration files and found no object `
      + 'schema in any of them. Refusing to census against nothing.',
    );
  }
  return objects;
}

// ─────────────────────────────────────────────────────────────────────────────
// The census
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the predicate over the platform namespaces.
 *
 * The registered schema is reconstructed the way `applySystemFields` builds it:
 * the authored fields plus the columns the injection plan says exist. The plan
 * is the spec's own (`resolveInjectedSystemColumns`), so nothing here decides
 * WHICH columns are injected; this only unions them in.
 */
export function runCensus(root = ROOT) {
  const { resolveInjectedSystemColumns, resolveTenantFieldName, loader } = loadPredicate(root);
  const objects = registeredObjects(root, loader);

  const rows = [];
  for (const { name, file, def } of objects) {
    if (!PLATFORM_NAMESPACE.test(name)) continue;
    const plan = resolveInjectedSystemColumns(def);
    const registeredFields = { ...def.fields };
    for (const column of plan.names) {
      if (!Object.prototype.hasOwnProperty.call(registeredFields, column)) registeredFields[column] = {};
    }
    const tenantField = resolveTenantFieldName({ ...def, fields: registeredFields });
    const reasons = EXCLUSION_REASONS.filter((r) => r.detect(def)).map((r) => r.id);
    rows.push({
      name,
      file,
      reach: tenantField === null ? 'out' : 'in',
      tenantField,
      // Recorded on IN-reach rows too, and deliberately: an object that
      // declares an exclusion mechanism and is still in reach is a fact worth
      // seeing, not a contradiction to hide.
      reasons,
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (rows.length === 0) {
    throw new Error(
      `platform-object-tenancy-census: ${objects.length} objects registered and NONE in a platform `
      + 'namespace. That is a population failure, not a census result.',
    );
  }

  const outOfReach = rows.filter((r) => r.reach === 'out');
  const reasonTotals = {};
  for (const reason of EXCLUSION_REASONS) {
    const n = outOfReach.filter((r) => r.reasons.includes(reason.id)).length;
    if (n > 0) reasonTotals[reason.id] = n;
  }

  return {
    predicate: 'resolveTenantFieldName(registered schema) !== null, where the registered schema is the '
      + 'authored schema plus the columns resolveInjectedSystemColumns says the registration injects '
      + '(the applySystemFields pass). Both functions are loaded from source and executed; neither is '
      + 're-spelled here.',
    population: 'every object registered by a tracked packages/**/*.object.ts module whose name carries '
      + 'a platform prefix (sys_ / cloud_ / ai_). The cloud repository\'s own cloud_ objects are not in '
      + 'this tree and so not in this census.',
    totals: { registered: rows.length, inReach: rows.length - outOfReach.length, outOfReach: outOfReach.length },
    reasonTotals,
    unexplained: outOfReach.filter((r) => r.reasons.length === 0).map((r) => r.name),
    objects: rows,
  };
}

/** Objects the predicate excludes with no declared mechanism to explain it. */
export function unexplainedExclusions(census) {
  return census.objects.filter((r) => r.reach === 'out' && r.reasons.length === 0).map((r) => r.name);
}

const ARTEFACT_COMMENT = [
  'The platform-object tenancy census — DERIVED. Rebuild with `node scripts/platform-object-tenancy-census.mjs --write`;',
  '`node scripts/check-platform-object-tenancy-census.mjs` holds it to the tree (#14957).',
  '',
  '⛔ Do not hand-edit a number here. This file exists because the same census WAS hand-written prose, in',
  'packages/objectql/src/tenancy/platform-object-tenancy.ts, and failed twice: once with a wrong REASON behind a',
  'right total (all excluded objects were `managedBy: better-auth`; one of them was described as an addition to',
  'the set it was already in), and once with a stale TOTAL (PR #15155 declared `systemFields: { tenant: false }`',
  'on sys_metadata_activation, moving it out of reach, and the ungated prose stayed at the old digits with CI green).',
  '',
  'THE PREDICATE IS THE POINT, the number is a by-product. `reach` is the answer of the engine\'s own',
  '`resolveTenantFieldName` on the REGISTERED schema — the authored schema plus the columns',
  '`resolveInjectedSystemColumns` injects. Both are loaded from source and executed by the generator.',
  '⛔ `managedBy` is not the predicate; it is one declaration among several that make the predicate answer null.',
  '',
  '`reasons` are the declarations on the object\'s OWN schema, spelled as the schema spells them. They are NOT',
  'mutually exclusive — an object carrying two is why flattening them into one "the reason" produced failure 1 —',
  'and `reasonTotals` therefore counts objects per reason and does not sum to `totals.outOfReach`.',
  '',
  'AN UNKNOWN REASON IS AN ERROR. An out-of-reach object with no declared reason is `unexplained`: `--write`',
  'refuses to commit it and the gate reds. A new exclusion mechanism gets adjudicated, never absorbed into a total.',
];

export function renderArtefact(census) {
  return `${JSON.stringify({ $comment: ARTEFACT_COMMENT, ...census }, null, 2)}\n`;
}

export function readArtefact(root = ROOT) {
  return JSON.parse(readFileSync(join(root, ARTEFACT), 'utf8'));
}

export function writeArtefact(root = ROOT, census = runCensus(root)) {
  const unexplained = unexplainedExclusions(census);
  if (unexplained.length > 0) {
    throw new Error(
      `platform-object-tenancy-census: REFUSING to write — ${unexplained.length} object(s) are outside the `
      + `machinery's reach with no declared mechanism to explain it: ${unexplained.join(', ')}. A new exclusion `
      + 'mechanism is adjudicated and added to EXCLUSION_REASONS with its reasoning, never absorbed into a total.',
    );
  }
  writeFileSync(join(root, ARTEFACT), renderArtefact(census));
  return census;
}

// ─────────────────────────────────────────────────────────────────────────────
// selfTest -- run by the GATE's `--self-test`, never by a flag of this file's
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The generator's own battery.
 *
 * Its classifiers are PUBLISHED FIGURES rather than findings: the gate's verdict
 * is "the artefact equals the tree", and an equality holds just as well between
 * two identically-wrong sides. So the reason detectors and the registered-schema
 * reconstruction have no other instrument, and a clean tree cannot tell a
 * working classifier from a weakened one.
 */
export function selfTest(root = ROOT) {
  let failures = 0;
  const t = (what, got, want = true) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };

  console.log('platform-object-tenancy-census generator');

  // The predicate is loaded, not transcribed -- so the first thing to prove is
  // that the loading really happened against the tree's files.
  const { resolveInjectedSystemColumns, resolveTenantFieldName } = loadPredicate(root);
  t('the predicate loads from source and is callable', [typeof resolveInjectedSystemColumns, typeof resolveTenantFieldName], ['function', 'function']);
  t('a bare object resolves the injected tenant column',
    resolveTenantFieldName({ fields: { organization_id: {} } }), 'organization_id');
  t('a declared tenantField that the object really has wins',
    resolveTenantFieldName({ fields: { org: {} }, tenancy: { tenantField: 'org' } }), 'org');
  t('a declared tenantField the object does NOT have is not invented',
    resolveTenantFieldName({ fields: { organization_id: {} }, tenancy: { tenantField: 'missing' } }), 'organization_id');
  t('no tenant column, no answer', resolveTenantFieldName({ fields: { id: {} } }), null);

  // ⭐ The registered/authored distinction, which is the failure the prose made.
  // An ordinary platform object declares NO organization_id and is nonetheless
  // in reach, because the registration injects it. A census reading authored
  // fields alone scores this one 'out' and is confidently wrong.
  const authored = { name: 'sys_probe', fields: { id: {} } };
  t('the authored schema alone answers null (the wrong reading)',
    resolveTenantFieldName(authored), null);
  const plan = resolveInjectedSystemColumns(authored);
  const registered = { ...authored, fields: { ...authored.fields } };
  for (const c of plan.names) registered.fields[c] ??= {};
  t('…and the REGISTERED schema answers the tenant column (the predicate)',
    resolveTenantFieldName(registered), 'organization_id');

  // Each reason detector, on a schema carrying exactly that declaration.
  const detect = (def) => EXCLUSION_REASONS.filter((r) => r.detect(def)).map((r) => r.id);
  t("managedBy: 'better-auth' is detected", detect({ managedBy: 'better-auth' }), ["managedBy: 'better-auth'"]);
  t('systemFields: false is detected', detect({ systemFields: false }), ['systemFields: false']);
  t('systemFields.tenant: false is detected', detect({ systemFields: { tenant: false } }), ['systemFields.tenant: false']);
  t('tenancy.enabled: false is detected', detect({ tenancy: { enabled: false } }), ['tenancy.enabled: false']);
  t('a clean schema carries no reason', detect({ name: 'sys_x', fields: {} }), []);
  // ⭐ The failure-1 shape, pinned: two mechanisms on one object stay TWO.
  t('an object carrying two mechanisms records both, not one',
    detect({ managedBy: 'better-auth', tenancy: { enabled: false } }),
    ["managedBy: 'better-auth'", 'tenancy.enabled: false']);
  // A near-miss that must NOT be read as an opt-out: the audit half is off and
  // the tenant half is untouched.
  t('systemFields.audit: false is not a tenancy exclusion', detect({ systemFields: { audit: false } }), []);

  // The live census, and the invariants that hold whatever the digits are.
  const census = runCensus(root);
  t('the population is non-empty', census.totals.registered > 0);
  t('the totals partition the population',
    census.totals.inReach + census.totals.outOfReach === census.totals.registered);
  t('every row is one of the two verdicts',
    census.objects.every((r) => r.reach === 'in' || r.reach === 'out'));
  t('every row names a platform-namespace object',
    census.objects.every((r) => PLATFORM_NAMESPACE.test(r.name)));
  t('an in-reach row names the column it is reached by',
    census.objects.filter((r) => r.reach === 'in').every((r) => typeof r.tenantField === 'string' && r.tenantField.length > 0));
  t('an out-of-reach row names no column',
    census.objects.filter((r) => r.reach === 'out').every((r) => r.tenantField === null));
  t('the live tree has no unexplained exclusion', unexplainedExclusions(census), []);
  t('reasonTotals counts objects, never sums to the total by construction',
    Object.values(census.reasonTotals).every((n) => n > 0 && n <= census.totals.outOfReach));

  // ⭐ POSITIVE CONTROL for the announce-never-absorb rule. A clean tree cannot
  // exercise it -- it has no unexplained exclusion, by the assertion above -- so
  // the adversarial input is supplied here: a census whose out-of-reach row has
  // no reason must be REFUSED by the writer, not written with a shorter list.
  const planted = {
    ...census,
    objects: [...census.objects, { name: 'sys_planted_probe', file: 'x.object.ts', reach: 'out', tenantField: null, reasons: [] }],
  };
  t('an unexplained exclusion is seen', unexplainedExclusions(planted), ['sys_planted_probe']);
  let refused = null;
  try {
    writeArtefact(root, planted);
  } catch (e) {
    refused = String(e.message);
  }
  t('…and the writer REFUSES it rather than committing a shorter reason list',
    refused !== null && refused.includes('sys_planted_probe') && refused.includes('REFUSING to write'));

  // The artefact on disk is the one this generator would produce. (The gate
  // re-runs this comparison as its production verdict; here it guards the
  // RENDERER -- a formatting change that silently reddens every future run.)
  t('the committed artefact is byte-identical to a fresh render',
    readFileSync(join(root, ARTEFACT), 'utf8') === renderArtefact(census));

  console.log(failures === 0
    ? `✓ platform-object-tenancy-census generator self-test: all checks pass (${census.totals.registered} objects)`
    : `✗ platform-object-tenancy-census generator self-test: ${failures} check(s) failed`);
  return failures === 0 ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

export function main(argv = []) {
  if (argv.includes('--self-test')) {
    console.error(
      'platform-object-tenancy-census: this module exposes no --self-test flag ON PURPOSE (a flag would make '
      + 'it a gate file and its path literals would stop being inherited by the gate that imports it). Run '
      + '`node scripts/check-platform-object-tenancy-census.mjs --self-test`, which calls selfTest() here.',
    );
    return 2;
  }
  const census = runCensus(ROOT);
  if (argv.includes('--write')) {
    writeArtefact(ROOT, census);
    console.log(`platform-object-tenancy-census: wrote ${ARTEFACT}`);
    return 0;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(census, null, 2));
    return 0;
  }
  const { registered, inReach, outOfReach } = census.totals;
  console.log('platform-object tenancy census');
  console.log(`  predicate  resolveTenantFieldName(registered schema) !== null`);
  console.log(`  registered ${registered} platform-namespace objects`);
  console.log(`  in reach   ${inReach}`);
  console.log(`  out        ${outOfReach}`);
  for (const [reason, n] of Object.entries(census.reasonTotals)) console.log(`    ${n}  ${reason}`);
  const unexplained = unexplainedExclusions(census);
  if (unexplained.length > 0) console.log(`  ⚠ unexplained ${unexplained.join(', ')}`);
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
