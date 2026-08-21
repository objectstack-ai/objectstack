// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7934, from #7521 / cloud#1225] The managed-`apiMethods` affordance rule,
 * applied to the population `os lint` structurally cannot reach.
 *
 * #7521 produced `object/managed-api-method-unaffordable`: a managed object may
 * not advertise a generic write verb in `enable.apiMethods` that its own
 * resolved affordances refuse. It is wired into `authoring-rules.ts`, so
 * `os lint`, `os validate` and `os build` all report it — **for an AUTHORED
 * stack**. This repo's own objects do not live in an authored stack. They ship
 * as CODE (`packages/**\/*.object.ts`), are registered by plugins at boot, and
 * are never walked by the lint CLI at all. So the rule this repo wrote did not
 * cover this repo, which is the gap #7934 records.
 *
 * ## Why this is worth a gate rather than a one-off audit
 *
 * The originating defect is what a missing gate here looks like. cloud#1225:
 * `sys_environment` / `sys_package` declared
 * `apiMethods: ['get','list','create','update']` against `userActions` refusing
 * all three writes. `reconcileManagedApiMethods` (objectql `registry.ts`,
 * ADR-0092 / ADR-0103) stripped the write verbs correctly on **every
 * control-plane boot for the life of the divergence, and nobody noticed** — the
 * strip is fail-closed, so nothing was ever exposed; what was lost was the
 * SIGNAL. It was found by hand-driving the HTTP seam while writing something
 * else. Boot behaviour is deliberately still warn-and-strip (#7521's ruling: a
 * metadata typo must not kill a control-plane boot), so a code-shipped
 * divergence in THIS repo is still silent at boot today. This file is the
 * signal.
 *
 * At the time of writing the sweep is GREEN — 51 in-scope objects, zero
 * findings. That is the measurement #7934 asked for first, and it makes this
 * regression insurance rather than a fix: the divergence class does not
 * currently exist here, and this is what keeps it from arriving unannounced.
 *
 * ## Why the sweep is repo-wide and not scoped to this package
 *
 * #7934 names `packages/platform-objects` and `packages/metadata-core` as the
 * population. Measured, those two hold 30 of the 51 in-scope objects; the other
 * 21 live in `plugin-security`, `plugin-approvals`, `plugin-audit`,
 * `plugin-sharing`, `service-messaging`, `service-realtime` and
 * `service-automation`. They are the same class of object, registered by the
 * same registry, equally unwalked by `os lint`.
 *
 * A sweep scoped to the package it lives in would be the exact failure this
 * repo has already paid for twice, both recorded next door: the #3391 bulk
 * audit "was scoped to `platform-objects`, so eight objects in `plugin-security`,
 * `plugin-approvals` and `metadata-core` silently kept 405-ing" (#3745), and
 * #7802 — "the bug was not a wrong judgement — it was an audit whose SCOPE was
 * a package name while the gap lived in packages nobody thought to open"
 * (`api-methods-batch-conformance.test.ts`, in spec's data dir). So this walks
 * every `*.object.ts` under `packages/`, and a new managed object anywhere is
 * covered by construction rather than by someone remembering.
 *
 * The cross-package radius is declared in `scripts/check-cross-package-test-
 * inputs.mjs` and mirrored into `turbo.json` as `@objectstack/platform-objects#
 * test` inputs — without both, turbo's affected-set (graph-based) and its task
 * cache (package-local inputs) would each replay a stale green for a diff that
 * only touches another package's object file. That is #7802's own mechanism,
 * and the gate that enforces the declaration is `check:cross-package-test-inputs`.
 *
 * ## Why it IMPORTS the object files instead of reading their source
 *
 * The two existing repo-wide `*.object.ts` walkers (`api-methods-batch-
 * conformance.test.ts`, `managed-extension-fields.test.ts`) match source TEXT,
 * because what they need — a name, a literal whitelist — survives a regex.
 * This rule's verdict does not: `checkManagedApiMethodAffordances` resolves the
 * object's affordances through `resolveCrudAffordances`, which layers
 * `userActions` over the `managedBy` bucket default. A regex would have to
 * re-derive that layering, and a second copy of the affordance table IS the
 * declared≠enforced drift the rule exists to catch (the predicate's own header
 * says so). So the objects are imported and judged as real values.
 *
 * That is affordable here precisely because these files are leaves: every one
 * of them imports from `@objectstack/spec` and nothing else, so loading all of
 * them needs no other package's build output.
 *
 * ## What this file must never become
 *
 * It holds NO affordance table and NO verb list. Every verdict comes from
 * `validateManagedApiMethods` (`@objectstack/lint`), which is exported for
 * exactly this — a repo whose objects live in code running the same rule over
 * its own definitions instead of hand-rolling the table — and which delegates
 * in turn to `checkManagedApiMethodAffordances` (`@objectstack/spec/data`), the
 * one predicate objectql's registry also calls when it strips the verb. If a
 * verdict here seems wrong, fix the predicate, never this walk.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGED_API_METHOD_UNAFFORDABLE, validateManagedApiMethods } from '@objectstack/lint';

/**
 * Seeded from `__dirname`, not from `fileURLToPath(import.meta.url)` as the
 * other repo-wide walkers are, and both halves of that choice are load-bearing:
 *
 *  - `import.meta` is a TS1470 here. Those walkers live in packages with an ESM
 *    `tsconfig.test.json` (spec graduated that way in #5286); this one does not,
 *    so the moment `check:type-check-coverage --re-measure` puts the test layer
 *    in front of tsc, `import.meta` becomes an error in a ledger that may only
 *    shrink. `__dirname` type-checks under the package's own config and is
 *    defined at runtime by vitest's transform (verified, not assumed).
 *  - `check:cross-package-test-inputs` detects an escaping read STATICALLY, by
 *    resolving the seed expression, and `__dirname` is one of the spellings it
 *    resolves. Which spellings those are is published rather than restated
 *    here: `RECOGNISED_PATH_SPELLINGS` in the detector, printed verbatim in its
 *    failure text and mirrored in AGENTS.md. Read it there — the set has been
 *    widened twice (#8995, #9763) since this note was first written, and a
 *    count copied into a comment goes stale silently while the published list
 *    cannot. Deriving the root a way the detector does NOT resolve (walking up
 *    to `pnpm-workspace.yaml`, resolving from `process.cwd()`) makes this
 *    file's real radius INVISIBLE to that gate, which then reports the
 *    declaration below as stale and asks for its removal — this file is
 *    platform-objects' only escaping test, so hiding it empties the package.
 *    Measured on ceb33a9f12 by reseeding from `process.cwd()`: the gate exits 1
 *    with "@objectstack/platform-objects declares a cross-package input radius,
 *    but no test in it reads outside the package any more". Acting on that and
 *    deleting the entry would put the sweep back in #7802's blind spot: turbo
 *    would cache a green for a diff that changed another package's object file.
 */
const HERE = __dirname;
/** …/packages/platform-objects/src → repo root */
const REPO_ROOT = resolve(HERE, '../../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/**
 * Scaffolding TEMPLATES: object files that are the source of a generated user
 * project rather than definitions this repo boots. They are deliberately out of
 * scope — once scaffolded they become an AUTHORED stack, which is precisely the
 * population `os lint` already walks and reports this rule on. They also cannot
 * be imported here: a template's `@objectstack/spec` import resolves only inside
 * the generated project, which has its own install.
 *
 * Declared as an exact path list, not a `templates/` pattern, and pinned as
 * still-existing below. Every OTHER file is imported without a try/catch, so a
 * file this sweep cannot load fails the run instead of being silently dropped —
 * a silent skip is how a sweep keeps passing over the objects it stopped seeing.
 */
const SCAFFOLDING_TEMPLATES: readonly string[] = [
  'packages/create-objectstack/src/templates/blank/src/objects/note.object.ts',
];

/** Every `*.object.ts` under `packages/`, skipping build output, deps and tests. */
function walkObjectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkObjectFiles(full, out);
    else if (entry.endsWith('.object.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** The files this sweep judges: every walked object file bar the templates. */
function sweptFiles(): string[] {
  return walkObjectFiles(PACKAGES_DIR).filter(
    (f) => !SCAFFOLDING_TEMPLATES.includes(relative(REPO_ROOT, f)),
  );
}

/** An imported export that carries an object name — the shape the rule judges. */
interface LoadedObject {
  /** Repo-relative path of the file that exports it, so a failure is actionable. */
  file: string;
  /** Export identifier, so a failure names the binding as well as the object. */
  exportName: string;
  name: string;
  def: Record<string, unknown>;
}

async function loadObjects(): Promise<LoadedObject[]> {
  const loaded: LoadedObject[] = [];
  for (const file of sweptFiles()) {
    const mod: Record<string, unknown> = await import(file);
    for (const [exportName, value] of Object.entries(mod)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const def = value as Record<string, unknown>;
      if (typeof def.name !== 'string') continue;
      loaded.push({ file: relative(REPO_ROOT, file), exportName, name: def.name, def });
    }
  }
  return loaded;
}

/**
 * The verdict, for one object at a time.
 *
 * Per-object rather than one `validateManagedApiMethods({ objects: [...] })`
 * call over the whole set purely for ATTRIBUTION: the rule reports a positional
 * `objects[i]` path, and an index into a synthetic array assembled here would
 * send the reader nowhere. The rule judges each object independently — it is a
 * pure loop over `stack.objects` with no cross-object state — so the verdict is
 * identical either way, and this way a failure names the file to open.
 */
function judge(objects: readonly LoadedObject[]): Array<{ file: string; export: string; object: string; rule: string; message: string; hint: string }> {
  return objects.flatMap((o) =>
    validateManagedApiMethods({ objects: [o.def] }).map((f) => ({
      file: o.file,
      export: o.exportName,
      object: o.name,
      rule: f.rule,
      message: f.message,
      hint: f.hint,
    })),
  );
}

/**
 * The rule's own scope, restated only to COUNT it: an object is in scope when it
 * is managed and declares a non-empty `apiMethods` whitelist. Everything else
 * the predicate returns `[]` for by construction (unmanaged ⇒ no bucket default
 * to contradict; absent ⇒ unrestricted; `[]` ⇒ deny-all).
 *
 * This is a census helper for the anti-vacuity floors below and never a verdict
 * — no assertion in this file branches on it.
 */
function isInScope(def: Record<string, unknown>): boolean {
  const enable = def.enable as { apiMethods?: unknown } | undefined;
  return def.managedBy != null && Array.isArray(enable?.apiMethods) && enable.apiMethods.length > 0;
}

/**
 * cloud#1225's shape, as a fixture: a managed object whose bucket and
 * `userActions` refuse every write, advertising two generic write verbs anyway.
 * Used only to prove this sweep can go RED — see the last case.
 */
const DIVERGENT_FIXTURE: LoadedObject = {
  file: 'test/fixture/divergent.object.ts',
  exportName: 'DivergentFixture',
  name: 'fixture_divergent_managed_object',
  def: {
    name: 'fixture_divergent_managed_object',
    managedBy: 'platform',
    userActions: { create: false, edit: false, delete: false },
    enable: { apiMethods: ['get', 'list', 'create', 'update'] },
  },
};

/** The same fixture with the contradiction removed — the green control. */
const COHERENT_FIXTURE: LoadedObject = {
  ...DIVERGENT_FIXTURE,
  exportName: 'CoherentFixture',
  name: 'fixture_coherent_managed_object',
  def: {
    ...DIVERGENT_FIXTURE.def,
    name: 'fixture_coherent_managed_object',
    enable: { apiMethods: ['get', 'list'] },
  },
};

describe('#7934 — code-shipped managed objects declare only apiMethods their own affordances permit', () => {
  let loaded: LoadedObject[];

  beforeAll(async () => {
    loaded = await loadObjects();
  }, 120_000);

  // ── anti-vacuity ──────────────────────────────────────────────────────────
  //
  // A sweep over an empty or wrongly-filtered set passes triumphantly and
  // proves nothing, so the population is asserted before the verdict is. The
  // three counts fail differently on purpose: zero FILES means the walk broke;
  // files but no IN-SCOPE objects means the walk works and the import or the
  // filter is wrong; a collapse in PACKAGE SPREAD means the walk quietly became
  // package-local again, which is the #7802 failure this file is shaped around
  // and the one a single total would hide.
  //
  // Floors, not pins: measured at 76 files / 51 in-scope / 9 packages, set well
  // below so that legitimately retiring an object does not fail the build, and
  // far enough above zero that a broken walk cannot pass. Same posture as the
  // cloud#1225 sweep's `toBeGreaterThanOrEqual(15)` against 19 real objects.
  it('sees a real, repo-wide population', () => {
    expect(sweptFiles().length, 'the object-file walk found (almost) nothing — it is not looking')
      .toBeGreaterThanOrEqual(70);

    const inScope = loaded.filter((o) => isInScope(o.def));
    expect(
      inScope.length,
      'no managed object with a declared apiMethods whitelist was loaded — the import or the ' +
      'in-scope filter is wrong, and the verdict below is vacuous',
    ).toBeGreaterThanOrEqual(45);

    const packages = new Set(inScope.map((o) => o.file.split('/').slice(0, 3).join('/')));
    expect(
      packages.size,
      `the in-scope population collapsed onto too few packages (${[...packages].sort().join(', ')}) ` +
      '— this sweep is repo-wide by design (#3745 / #7802: an audit scoped to a package name ' +
      'misses the packages nobody thought to open)',
    ).toBeGreaterThanOrEqual(6);
  });

  it('skips only scaffolding templates, and those still exist', () => {
    // A stale exemption is documentation of nothing; an exemption that quietly
    // grew is a hole. Both directions, on the SINGLE_RECORD_WRITE_ONLY pattern.
    const walked = walkObjectFiles(PACKAGES_DIR).map((f) => relative(REPO_ROOT, f));
    for (const template of SCAFFOLDING_TEMPLATES) {
      expect(walked, `${template} is no longer a real object file — drop the exemption`).toContain(template);
    }
    expect(walked.length - sweptFiles().length).toBe(SCAFFOLDING_TEMPLATES.length);
  });

  // ── the verdict ───────────────────────────────────────────────────────────
  it('no code-shipped managed object advertises a write verb its affordances refuse', () => {
    expect(
      judge(loaded),
      'a code-shipped managed object advertises an enable.apiMethods write verb its own ' +
      'userActions affordances refuse. The registry STRIPS it at registration and only warns, ' +
      'so this ships as a silent declared≠enforced split (ADR-0049; cloud#1225 lived for months ' +
      'this way). Fix it where the author is: either drop the verb from enable.apiMethods, or — ' +
      'only if the write is genuinely one a user context may perform, and only once the guard ' +
      'enforcing it exists (ADR-0092 D4) — open the matching userActions affordance.',
    ).toEqual([]);
  });

  // ── the red direction ─────────────────────────────────────────────────────
  //
  // The case above is green today, and a green assertion is evidence only if the
  // machinery producing it can go red. Predicted before running: injecting
  // cloud#1225's exact shape into the REAL loaded set takes the aggregate from
  // zero findings to exactly one, naming the fixture and nothing else — the
  // adjacent coherent object must stay silent, or the rule would be flagging
  // managed objects generally rather than the contradiction.
  //
  // This drives `judge()` — the same function, over the same real population —
  // rather than calling the predicate directly, so it pins the path the verdict
  // above actually takes, not a parallel one.
  it('goes red when a divergent object is present, and stays silent on a coherent one', () => {
    const findings = judge([...loaded, DIVERGENT_FIXTURE, COHERENT_FIXTURE]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: DIVERGENT_FIXTURE.file,
      object: DIVERGENT_FIXTURE.name,
      rule: MANAGED_API_METHOD_UNAFFORDABLE,
    });
    // The message must name both offending verbs: an implementation that caught
    // `create` and dropped `update` would satisfy every assertion above.
    expect(findings[0].message).toContain('create');
    expect(findings[0].message).toContain('update');
  });
});
