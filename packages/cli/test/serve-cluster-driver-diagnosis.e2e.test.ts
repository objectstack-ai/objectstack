// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14054 — the cluster-driver diagnosis branches in `serve`'s boot method,
 * asserted AT BOOT, over the real `os serve` process.
 *
 * ## What this is, and what it is not
 *
 * This is not a defect report. PR #14042 (#13330's fix) replaced a silent
 * `catch` around the cluster-driver load with a five-way reading, the at-tier
 * contract review judged it correct on merits, and nothing about that reading
 * changes here. What the review also recorded was that the reading had no
 * boot-level test, and that the two branches which print NOTHING are the exact
 * shape that regresses invisibly: the day silence turns into a spurious
 * warning, a suite that pins only the talking branches goes green.
 *
 * So the deliverable is durability, not repair. Every branch below already
 * behaves this way on `main`; this file is what makes it stay that way.
 *
 * ## Why a real boot, and why nothing in `serve.ts` was extracted
 *
 * The card offered two routes — boot `serve`, or extract the reading into a
 * testable seam first — and preferred the boot, because a seam extraction is a
 * refactor of a 6,300-line file whose review surface is larger than the pins'.
 * The boot route was measured before it was chosen: a temp host app carrying a
 * fixture `@objectstack/service-cluster` reaches the block in ~7.5s per case,
 * and `runServe()` already resolves a boot that DIES, which is what every case
 * here does. `serve.ts` is untouched.
 *
 * ## The positive control, and why every case needs one
 *
 * Two of the five cases assert SILENCE, and a boot that died before the cluster
 * block is silent for reasons having nothing to do with the branch. So every
 * case — talking and silent alike — asserts {@link REACHED_DEFINE_CLUSTER},
 * which `defineCluster()` raises from `@objectstack/service-cluster`'s REAL
 * registry, one statement past the diagnosis. It can only be printed if the
 * block ran to its end and set `clusterConfig`, so it is proof the reading
 * happened, in the child's own words.
 *
 * That error is also why no fixture drives a driver that WORKS. The Runtime
 * consults the framework's own copy of the registry, which no app-local fixture
 * can register into — that split is precisely case 2's subject. Every boot here
 * therefore ends the same way, and the diagnosis printed on the way down is the
 * whole measurement.
 *
 * ## Why the three registry cases are one family
 *
 * `registered`, `loaded-but-invisible` and `no-accessor` are built from ONE
 * fixture template and differ in ONE slot: what the app's
 * `@objectstack/service-cluster` says when asked for its driver list — `['custom']`,
 * `['redis']`, or nothing at all because the accessor is absent. `driverSourcesMatch`
 * below pins that isolation, and it is what makes the two silences non-vacuous:
 * if the accessor were never read, the middle case would be silent too, and it
 * is not. A silence asserted against an identical boot that WARNS is a
 * measurement; a silence asserted on its own is an empty buffer.
 *
 * ## The driver name is a fixture name on purpose
 *
 * `custom` is a real value of the cluster driver enum — so `defineCluster()`
 * reaches its registry lookup and raises the documented error rather than a
 * schema refusal — while `@objectstack/service-cluster-custom` is a package
 * that exists nowhere. `redis` would be neither: the workspace store on
 * `NODE_PATH` supplies the real driver to a CJS resolve no matter what a temp
 * app declares (the hazard `serve-i18n-load-diagnostic.test.ts` names for the
 * sibling site), which would make the `undeclared` case unproducible.
 *
 * ## What is deliberately NOT re-asserted here
 *
 * `serve-cluster-host-resolution.test.ts` pins the SHAPE of this block by
 * source scan — that the loads are host-anchored, that `importFromHost` is
 * module-scope — and `packages/services/service-cluster/src/cluster-driver-registry.test.ts`
 * pins the accessor invariant this reading rests on
 * (`listClusterDrivers()` agrees with `defineCluster()`) in both directions.
 * Neither is repeated. What is only here is the boot-level fact that each
 * branch fires on its own condition.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe, randomPort } from './helpers/serve-process.js';

/** `OS_CLUSTER_DRIVER` for every boot below — see the header for why `custom`. */
const DRIVER = 'custom';
const CLUSTER_PKG = '@objectstack/service-cluster';
const DRIVER_PKG = `${CLUSTER_PKG}-${DRIVER}`;

/**
 * The proof a boot REACHED the diagnosis — `defineCluster()`'s documented error
 * (cluster.mdx §8.1), raised one statement after the block from the framework's
 * own registry. Asserted in every case, including the silent ones.
 */
const REACHED_DEFINE_CLUSTER = `Cluster driver "${DRIVER}" is not registered.`;

/** The three talking branches, by their opening words. */
const WARNS_INVISIBLE = `[cluster] driver "${DRIVER}" loaded but did not register:`;
const WARNS_UNLOADABLE = `[cluster] driver "${DRIVER}" was requested but could not be loaded (`;
const WARNS_CRASHED = `[cluster] driver "${DRIVER}" resolved but threw while loading —`;

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.clusterdiag',
    namespace: 'clusterdiag',
    version: '1.0.0',
    type: 'app',
    name: 'Cluster Driver Diagnosis Fixture',
  },
  objects: [{
    name: 'clusterdiag_task',
    label: 'Task',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

/**
 * The app's `@objectstack/service-cluster`, as ONE template with one slot.
 *
 * `checkMultiNodeAllowed` answers an unconditional, uncapped allow so the gate
 * branch and `formatMultiNodeCapAdvisory` both stay quiet and every boot takes
 * the driver-reading path. `mountMultiNodeGateFromHost` is deliberately absent:
 * `serve` optional-chains it, and a fixture that supplied it would be asserting
 * something this file is not about.
 *
 * @param accessor the body of `listClusterDrivers`, or `null` to OMIT the
 *                 accessor entirely — the app on a pre-#13330 `service-cluster`.
 */
function clusterPackageSource(accessor: string | null): string {
  return (
    'export function checkMultiNodeAllowed() {\n'
    + '  return { allowed: true, refused: 0, capped: false };\n'
    + '}\n'
    + (accessor === null
      ? ''
      : `export function listClusterDrivers() {\n  return ${accessor};\n}\n`)
  );
}

/** What the fixture driver package evaluates to. */
type DriverFixture =
  /** Evaluates cleanly, registering nothing the boot's registry can see. */
  | 'loads'
  /** Throws while evaluating — the driver package's own failure. */
  | 'throws'
  /** Not installed at all. */
  | 'absent';

const DRIVER_LOADS_SOURCE = 'export const fixture = true;\n';
const DRIVER_THROW_MESSAGE = 'custom cluster driver fixture: exploded while evaluating';
const DRIVER_THROWS_SOURCE = `throw new Error(${JSON.stringify(DRIVER_THROW_MESSAGE)});\n`;

function writePackage(nodeModules: string, name: string, source: string): void {
  const dir = join(nodeModules, ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-fixture', type: 'module', main: 'index.js' }),
    'utf8',
  );
  writeFileSync(join(dir, 'index.js'), source, 'utf8');
}

type Fixture = {
  /** What the app's `@objectstack/service-cluster` reports, or `null` for no accessor. */
  accessor: string | null;
  driver: DriverFixture;
  /** Whether the app's `package.json` NAMES the driver package (the declaration is the contract, #4719). */
  declareDriver: boolean;
};

const apps: string[] = [];
afterAll(() => {
  for (const dir of apps) rmSync(dir, { recursive: true, force: true });
});

function writeApp(prefix: string, fixture: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), `os-cluster-diag-${prefix}-`));
  apps.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'cluster-diag-fixture',
        private: true,
        type: 'module',
        dependencies: {
          [CLUSTER_PKG]: '*',
          ...(fixture.declareDriver ? { [DRIVER_PKG]: '*' } : {}),
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  const nodeModules = join(dir, 'node_modules');
  writePackage(nodeModules, CLUSTER_PKG, clusterPackageSource(fixture.accessor));
  if (fixture.driver === 'loads') writePackage(nodeModules, DRIVER_PKG, DRIVER_LOADS_SOURCE);
  if (fixture.driver === 'throws') writePackage(nodeModules, DRIVER_PKG, DRIVER_THROWS_SOURCE);
  return dir;
}

/** Boot the fixture app and return everything the child printed, both streams. */
async function boot(prefix: string, fixture: Fixture): Promise<string> {
  const dir = writeApp(prefix, fixture);
  const { stdout, stderr } = await runServe(dir, ['--port', randomPort()], {
    // The boot dies at `defineCluster()`; `runServe` resolves on exit either
    // way, so this only shortens the happy path rather than deciding it.
    waitFor: /is not registered/,
    timeoutMs: 120_000,
    env: { OS_CLUSTER_DRIVER: DRIVER },
  });
  return `${stderr}\n${stdout}`;
}

/** 180s: one real `serve` boot per case, measured at ~7.5s on this container. */
const BOOT_TIMEOUT = 180_000;

describe('os serve → cluster-driver diagnosis, at boot (#14054)', () => {
  it('stays SILENT when the driver is registered and visible to this boot', async () => {
    const out = await boot('registered', {
      accessor: `['${DRIVER}']`,
      driver: 'loads',
      declareDriver: true,
    });

    // The block ran: `clusterConfig` was set and the Runtime consumed it.
    expect(out).toContain(REACHED_DEFINE_CLUSTER);
    // ⭐ And it printed NOTHING — not just none of the three driver branches,
    // but no cluster diagnosis of any kind (the gate denial and the licensed-cap
    // advisory are in the same block and would land in the same buffer).
    expect(out).not.toContain('[cluster]');
  }, BOOT_TIMEOUT);

  it('warns about the physical-copy split when the driver loads but is invisible', async () => {
    const out = await boot('invisible', {
      // Identical to the case above but for this slot: the registry this boot
      // reads holds a DIFFERENT driver.
      accessor: "['redis']",
      driver: 'loads',
      declareDriver: true,
    });

    expect(out).toContain(REACHED_DEFINE_CLUSTER);
    // The whole message, verbatim — it is one line, and every clause of it is
    // the deliverable: what happened, what the registry actually held, why
    // (two live instances), and the one-line remedy.
    expect(out).toContain(
      `[cluster] driver "${DRIVER}" loaded but did not register: `
      + `${DRIVER_PKG} evaluated without error, yet the `
      + 'registry this boot reads holds [redis]. '
      + `Two instances of ${CLUSTER_PKG} are live in this process and the `
      + 'driver registered into the other one — look for two physical copies (a version '
      + 'skew between the app and the framework, or a bundled one). Importing '
      + `"${DRIVER_PKG}" from objectstack.config.ts `
      + 'registers into the instance the Runtime reads.',
    );
    // Not one of the OTHER two readings: a split is neither a resolution
    // failure nor the driver package throwing.
    expect(out).not.toContain(WARNS_UNLOADABLE);
    expect(out).not.toContain(WARNS_CRASHED);
  }, BOOT_TIMEOUT);

  it('prints the `undeclared` classification the old silent catch swallowed', async () => {
    const out = await boot('undeclared', {
      accessor: "['redis']",
      driver: 'absent',
      declareDriver: false,
    });

    expect(out).toContain(REACHED_DEFINE_CLUSTER);
    // The kind TOKEN is the site's whole contribution, and every word of remedy
    // below it is `createHostImporter`'s — asserted by requiring the importer's
    // own first line to follow the framing immediately, with nothing of this
    // site's between them.
    expect(out).toContain(
      `[cluster] driver "${DRIVER}" was requested but could not be loaded (undeclared):\n`
      + `Cannot find package '${DRIVER_PKG}': the host app does not declare it.`,
    );
    // ⛔ And NOT the other kind's remedy: an app that never declared the package
    // must not be told its install is broken.
    expect(out).not.toContain('This is an INSTALL problem, not a declaration problem');
    expect(out).not.toContain(WARNS_INVISIBLE);
    expect(out).not.toContain(WARNS_CRASHED);
  }, BOOT_TIMEOUT);

  it('prints the `declared-unresolvable` classification, with that kind\'s own remedy', async () => {
    const out = await boot('unresolvable', {
      accessor: "['redis']",
      // Declared and NOT installed — the pruned / never-installed deployment.
      driver: 'absent',
      declareDriver: true,
    });

    expect(out).toContain(REACHED_DEFINE_CLUSTER);
    expect(out).toContain(
      `[cluster] driver "${DRIVER}" was requested but could not be loaded (declared-unresolvable):\n`
      + `Cannot find module '${DRIVER_PKG}': the host app DECLARES it`,
    );
    // The install-side remedy reached the operator …
    expect(out).toContain('This is an INSTALL problem, not a declaration problem');
    // … and the declaration-side one did not. Two kinds, one framing, two
    // remedies: this pair is what keeps the site from growing a per-kind branch
    // that would hand a third kind the wrong sentence.
    expect(out).not.toContain('the host app does not declare it');
    expect(out).not.toContain(WARNS_INVISIBLE);
    expect(out).not.toContain(WARNS_CRASHED);
  }, BOOT_TIMEOUT);

  it('reports a driver that RESOLVED and then crashed as the driver package\'s own failure', async () => {
    const out = await boot('crashed', {
      accessor: "['redis']",
      driver: 'throws',
      declareDriver: true,
    });

    expect(out).toContain(REACHED_DEFINE_CLUSTER);
    expect(out).toContain(
      `[cluster] driver "${DRIVER}" resolved but threw while loading — `
      + "this is the driver package's own failure, not a missing package:",
    );
    // The driver's own error, and the frame that names its own file — this is
    // the half the silent catch discarded, sending operators to look for a
    // package that was already installed.
    expect(out).toContain(DRIVER_THROW_MESSAGE);
    expect(out).toContain(`/${DRIVER_PKG}/index.js`);
    // ⛔ Never reported as a registration problem. That misattribution is the
    // whole reason this branch exists, and it is a DIFFERENT sentence from
    // `defineCluster()`'s own error above, which every case here also prints.
    expect(out).not.toContain(WARNS_INVISIBLE);
    expect(out).not.toContain(WARNS_UNLOADABLE);
  }, BOOT_TIMEOUT);

  it('stays SILENT on an older service-cluster with no listClusterDrivers accessor', async () => {
    const out = await boot('no-accessor', {
      // Identical to the two cases above but for this slot: the accessor is
      // absent, so the registry cannot be read from here at all.
      accessor: null,
      driver: 'loads',
      declareDriver: true,
    });

    expect(out).toContain(REACHED_DEFINE_CLUSTER);
    // ⭐ NOT MEASURED is neither "registered" nor "missing", and the block
    // claims neither. The same app one slot over — accessor present, reporting
    // a different driver — warns; this one does not.
    expect(out).not.toContain('[cluster]');
  }, BOOT_TIMEOUT);
});

describe('the fixture family isolates the accessor (vacuity guard)', () => {
  /**
   * The two silence pins above are only worth anything if the boots they are
   * measured on are the SAME boot as the one that warns, save for the accessor.
   * Nothing about a temp directory makes that true, so it is asserted here
   * rather than promised in a comment — and asserted on the generated sources,
   * which is where the difference would creep in.
   */
  it('varies exactly one slot across registered / invisible / no-accessor', () => {
    const registered = clusterPackageSource(`['${DRIVER}']`);
    const invisible = clusterPackageSource("['redis']");
    const noAccessor = clusterPackageSource(null);

    const gate = 'export function checkMultiNodeAllowed() {\n'
      + '  return { allowed: true, refused: 0, capped: false };\n'
      + '}\n';
    // Every variant carries the same gate, so no boot can take the denial or
    // licensed-overflow path instead of the driver reading.
    for (const source of [registered, invisible, noAccessor]) {
      expect(source.startsWith(gate)).toBe(true);
    }
    // …and differs from its siblings ONLY after it.
    expect(registered.slice(gate.length)).toBe(
      "export function listClusterDrivers() {\n  return ['custom'];\n}\n",
    );
    expect(invisible.slice(gate.length)).toBe(
      "export function listClusterDrivers() {\n  return ['redis'];\n}\n",
    );
    expect(noAccessor.slice(gate.length)).toBe('');
    // The `no-accessor` variant must not merely return nothing — the accessor
    // has to be ABSENT, or `typeof … === 'function'` in `serve` is still true
    // and the case being pinned is not the case being booted.
    expect(noAccessor).not.toContain('listClusterDrivers');
  });

  /** All three registry cases load the SAME driver package. */
  it('holds the driver package fixture constant across the three registry cases', () => {
    expect(DRIVER_LOADS_SOURCE).toBe('export const fixture = true;\n');
    // It registers nothing, deliberately: an app-local fixture cannot reach the
    // registry the Runtime reads, which is the split case 2 is about.
    expect(DRIVER_LOADS_SOURCE).not.toContain('registerClusterDriver');
  });
});
