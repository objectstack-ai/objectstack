// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The optional i18n service load PRINTS the classification it used to swallow
 * (#14118) — and prints it as a diagnosis ahead of behaviour that does not
 * change.
 *
 * ── What this closes ─────────────────────────────────────────────────────
 *
 * #13463 measured that `serve`'s cluster-driver load discarded the
 * `objectstackHostImportFailureKind` classification in an empty catch, so a
 * broken install surfaced later as a registry problem naming the wrong remedy.
 * PR #14042 repaired that site. The same shape survived one block over, at the
 * i18n service load, where the catch was bare:
 *
 *     const { I18nServicePlugin } = await importFromHost(i18nPkg);
 *     …
 *     } catch {
 *
 * The catch was right to TOLERATE — a missing `@objectstack/service-i18n` is a
 * supported configuration — and wrong to be silent, because tolerating an
 * absence and discarding a classification are two different acts. An app that
 * DECLARES the package and whose install is pruned, unbuilt, or published with
 * no loadable entry reached that catch as the same silence as an app that never
 * installed it.
 *
 * ── Why the assertions are shaped this way ───────────────────────────────
 *
 * **Real errors, not hand-set properties.** Every classified error below comes
 * out of `createHostImporter` against a temp host app, so what these pins read
 * is the wording the importer actually composes per kind. A test that assigned
 * `objectstackHostImportFailureKind` itself would keep passing through a change
 * to how the classification is produced — the half most worth catching.
 *
 * **Three kinds, and the fourth.** #14271 (#14041) added a THIRD kind,
 * `declared-no-loadable-entry`, after this seam's two-kind consumers were
 * written — which is what #14270 is: three OTHER sites still pick a remedy with
 * a two-way branch and hand the new kind the "declare it in your package.json"
 * line, for a package that is already declared AND installed. The site pinned
 * here cannot join that population, because it interpolates only the kind TOKEN
 * and takes every word of remedy from `err.message`. `framing is identical
 * across kinds` is the pin that keeps it that way: it fails the moment someone
 * adds a per-kind sentence here, which is the first step toward the #14270
 * shape. The per-kind wording pins beside it prove the deferral WORKS — each
 * kind's own remedy reaches the operator, and the two wrong ones do not.
 *
 * **Both halves of the channel.** `serve-stdio-stdout-purity.e2e.test.ts`
 * requires that everything which is not an MCP protocol frame stays off stdout.
 * That e2e boots `serve` and never fails this load, so it cannot see this line.
 * Two pins cover it here instead: the site prints through `console.warn` (read
 * from the source window, because the branch has no unit-level boot seam —
 * #14054 records that gap for the sibling cluster site), and `console.warn`
 * really does land on stderr with nothing on stdout (measured by swapping both
 * stream writes, so it is a measurement rather than a restatement of Node's
 * documentation).
 *
 * **The no-re-throw pin is deliberate.** The tolerance IS the point of this
 * catch — `i18n` is a `core` service with a kernel in-memory fallback, it has
 * no `Serve.CAPABILITY_PROVIDERS` entry, and `requires: ['i18n']` opens the
 * tier without reaching the fail-fast branch that makes a missing provider a
 * hard boot error. A later edit that "improves" this diagnosis into a `throw`
 * would turn a supported configuration into a refused boot, so the source
 * window is asserted to contain no `throw`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createHostImporter,
  hostImportFailureKind,
  type HostImportFailureKind,
} from '@objectstack/types/node';
import { formatI18nLoadDiagnostic } from './serve.js';

/**
 * The package the site loads. Spelled here as the operator reads it; the pin
 * that this is also the spelling `serve` PASSES is `site passes the package it
 * actually loads` below, which reads the call site itself.
 */
const PKG = '@objectstack/service-i18n';

/**
 * The name the CLASSIFIED fixtures below import — deliberately NOT `PKG`.
 *
 * `declared-unresolvable` is unproducible for a real workspace package inside
 * this test run: `pnpm exec` puts the workspace store on `NODE_PATH`, so the
 * CJS `require.resolve` that decides that kind finds the package no matter what
 * a temp host app declares. That is #4719's hazard showing up in the test
 * harness itself, and a fixture name no store can supply is the honest way
 * around it — the same reason the `undeclared` leg injects its own rejecting
 * fallback. The formatter takes the package name as a PARAMETER, so what these
 * pins measure is unchanged; the spelling `serve` really passes is pinned at the
 * call site instead, where it is a fact about the code rather than about this
 * container's `node_modules`.
 */
const FIXTURE_PKG = '@objectstack-i18n-fixture/absent-service';

const KINDS: readonly HostImportFailureKind[] = [
  'undeclared',
  'declared-unresolvable',
  'declared-no-loadable-entry',
];

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway host app — the root `createHostImporter` reads declarations from. */
function hostRoot(tag: string, dependencies: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), `os-i18n-diag-${tag}-`));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'i18n-diagnostic-host-fixture', type: 'module', dependencies }),
    'utf8',
  );
  return root;
}

/** Put a package with a chosen manifest shape into that host app's `node_modules`. */
function installShapedPackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): void {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-fixture', type: 'module', ...manifest }),
    'utf8',
  );
  for (const rel of Object.keys(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, files[rel] as string, 'utf8');
  }
}

/**
 * A REAL failure of each kind, straight out of `createHostImporter`.
 *
 * The `undeclared` leg supplies a rejecting `fallbackImport` on purpose. That
 * fallback is a caller-supplied seam by contract (#10943), so injecting one
 * makes the case hermetic: without it the branch would depend on whether
 * `@objectstack/service-i18n` happens to be reachable from whatever package
 * this test file runs inside, and a workspace that hoisted it would turn this
 * pin green by never failing at all.
 */
async function classifiedFailure(kind: HostImportFailureKind): Promise<unknown> {
  let importer: ReturnType<typeof createHostImporter>;
  if (kind === 'undeclared') {
    importer = createHostImporter(hostRoot('undeclared'), {
      fallbackImport: () =>
        Promise.reject(
          Object.assign(new Error(`Cannot find package '${FIXTURE_PKG}'`), {
            code: 'ERR_MODULE_NOT_FOUND',
          }),
        ),
    });
  } else if (kind === 'declared-unresolvable') {
    // Declared, and nothing installed: the INSTALL is the problem.
    importer = createHostImporter(hostRoot('unresolvable', { [FIXTURE_PKG]: '^1.0.0' }));
  } else {
    // Declared AND installed, publishing only a `types` condition: no edit to
    // the app and no install action can ever fix this — the PACKAGE is.
    const root = hostRoot('no-entry', { [FIXTURE_PKG]: '^1.0.0' });
    installShapedPackage(
      root,
      FIXTURE_PKG,
      { exports: { '.': { types: './dist/index.d.ts' } } },
      { 'dist/index.d.ts': 'export declare const BUILD: string;\n' },
    );
    importer = createHostImporter(root);
  }
  const err = await importer(FIXTURE_PKG).then(
    () => undefined,
    (e: unknown) => e,
  );
  // The fixture's own control: if a case ever stops failing, every assertion
  // built on it would pass over an error that never happened.
  expect(err, `fixture for ${kind} did not fail at all`).toBeDefined();
  expect(hostImportFailureKind(err), `fixture produced the wrong kind for ${kind}`).toBe(kind);
  return err;
}

const firstLine = (s: string) => s.split('\n')[0];
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The output with everything CASE-SPECIFIC removed — the kind token and the
 * importer's own message. What is left is this site's own framing, which must
 * be the same text for every kind.
 */
const framingOf = (rendered: string, kind: HostImportFailureKind, err: unknown): string =>
  rendered.split(messageOf(err)).join('<IMPORTER MESSAGE>').split(kind).join('<KIND>');

describe('serve — the i18n load prints the host-import classification (#14118)', () => {
  it.each(KINDS)('a %s failure names the package, the kind and the consequence', async (kind) => {
    const err = await classifiedFailure(kind);
    const rendered = formatI18nLoadDiagnostic(FIXTURE_PKG, err);

    expect(firstLine(rendered)).toBe(
      `[i18n] ${FIXTURE_PKG} was requested but could not be loaded (${kind}).`,
    );
    // The remedy is the importer's, verbatim — not a copy that can drift.
    expect(rendered).toContain(messageOf(err));
    // The consequence, stated BEFORE the diagnosis: this is not a boot failure.
    expect(rendered).toContain(
      'Unchanged: this boot serves i18n from the kernel in-memory fallback',
    );
    // ⛔ The crash framing must not appear on a classified failure — that is the
    // one distinction #14042 named, and it is the whole reason the kinds are read.
    expect(rendered).not.toContain('resolved but threw while loading');
  });

  it('the framing is IDENTICAL across all three kinds — only the token and the importer message differ', async () => {
    const framings: string[] = [];
    for (const kind of KINDS) {
      const err = await classifiedFailure(kind);
      framings.push(framingOf(formatI18nLoadDiagnostic(FIXTURE_PKG, err), kind, err));
    }
    // One distinct framing ⇒ no per-kind sentence is written HERE. This is the
    // structural half of not joining the #14270 population: a branch table that
    // does not exist cannot go stale when a fourth kind lands.
    expect(new Set(framings).size).toBe(1);
  });

  it("each kind's OWN remedy reaches the operator, and the other two do not (#14271 third kind)", async () => {
    const rendered: Record<HostImportFailureKind, string> = {
      undeclared: formatI18nLoadDiagnostic(FIXTURE_PKG, await classifiedFailure('undeclared')),
      'declared-unresolvable': formatI18nLoadDiagnostic(
        FIXTURE_PKG,
        await classifiedFailure('declared-unresolvable'),
      ),
      'declared-no-loadable-entry': formatI18nLoadDiagnostic(
        FIXTURE_PKG,
        await classifiedFailure('declared-no-loadable-entry'),
      ),
    };

    // The app never declared it → declare it and install.
    expect(rendered.undeclared).toContain('does not declare it');
    expect(rendered.undeclared).toContain("Declare it in that app's package.json");

    // Declared, install broken → repair the INSTALL, and say the declaration is fine.
    expect(rendered['declared-unresolvable']).toContain(
      'This is an INSTALL problem, not a declaration problem',
    );
    expect(rendered['declared-unresolvable']).not.toContain('does not declare it');

    // Declared AND installed, package publishes nothing loadable → the remedy is
    // in the PACKAGE. Handing this case either of the two lines above is exactly
    // the defect #14270 records at three other consumers of this classification.
    const noEntry = rendered['declared-no-loadable-entry'];
    expect(noEntry).toContain('publishes no entry that Node can load');
    expect(noEntry).toContain('The remedy lives in the package');
    expect(noEntry).not.toContain('This is an INSTALL problem');
    expect(noEntry).not.toContain('does not declare it');
  });

  it('an error carrying NO kind resolved and then CRASHED — a different sentence, and the stack', () => {
    const crash = new Error('i18n plugin blew up while evaluating');
    const rendered = formatI18nLoadDiagnostic(PKG, crash);

    expect(firstLine(rendered)).toBe(
      `[i18n] ${PKG} resolved but threw while loading — this is the package's own failure, not a missing package.`,
    );
    expect(rendered).not.toContain('could not be loaded (');
    expect(rendered).toContain(
      'Unchanged: this boot serves i18n from the kernel in-memory fallback',
    );
    // The throwing frame IS the diagnosis for a crash, so the stack is carried.
    expect(rendered).toContain(crash.stack ?? crash.message);
  });

  it('a non-Error throw is still reported rather than swallowed', () => {
    const rendered = formatI18nLoadDiagnostic(PKG, 'a bare string was thrown');
    expect(firstLine(rendered)).toContain('resolved but threw while loading');
    expect(rendered).toContain('a bare string was thrown');
  });
});

/**
 * The call site itself. Read from source because this branch has no unit-level
 * boot seam — #14054 records that no test boots `serve` for the sibling
 * cluster-driver diagnosis branches either, and inventing one for a two-line
 * catch is not what that card is for. The window is anchored on two literals
 * that move only when the block itself is rewritten, which is when these pins
 * SHOULD be re-read rather than silently satisfied.
 */
const SERVE_SOURCE = readFileSync(new URL('./serve.ts', import.meta.url), 'utf8');

const i18nCatchWindow = (): string => {
  const start = SERVE_SOURCE.indexOf(`const i18nPkg = '${PKG}';`);
  const end = SERVE_SOURCE.indexOf('} else if (!hasI18nPlugin && !configHasTranslations) {', start);
  expect(start, 'the i18n load block moved — re-read these pins').toBeGreaterThan(-1);
  expect(end, 'the i18n load block moved — re-read these pins').toBeGreaterThan(start);
  return SERVE_SOURCE.slice(start, end);
};

describe('serve — the i18n catch prints on the right channel and still tolerates (#14118)', () => {
  it('site passes the package it actually loads, through the formatter', () => {
    expect(i18nCatchWindow()).toContain('console.warn(formatI18nLoadDiagnostic(i18nPkg, i18nErr));');
  });

  it('nothing in that catch reaches stdout', () => {
    const window = i18nCatchWindow();
    expect(window).not.toContain('console.log');
    expect(window).not.toContain('process.stdout');
  });

  it('⛔ the catch does not re-throw — the tolerance IS the point of it', () => {
    // Comment prose in the window legitimately contains the word, so this reads
    // statements: a `throw` keyword at the head of one.
    const statements = i18nCatchWindow()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*'));
    expect(statements.some((l) => l.startsWith('throw '))).toBe(false);
  });

  it('`console.warn` lands on stderr, and puts nothing on stdout', () => {
    const out: string[] = [];
    const err: string[] = [];
    const realOut = process.stdout.write;
    const realErr = process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      console.warn(formatI18nLoadDiagnostic(PKG, new Error('channel probe')));
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
    expect(err.join('')).toContain('[i18n]');
    expect(out.join('')).toBe('');
  });
});

describe('#14118 CONTROL — these pins can say no', () => {
  it('a rendering that dropped the kind token fails the first-line comparison', async () => {
    const err = await classifiedFailure('declared-unresolvable');
    const doctored = formatI18nLoadDiagnostic(FIXTURE_PKG, err).replace(' (declared-unresolvable)', '');
    expect(firstLine(doctored)).not.toBe(
      `[i18n] ${FIXTURE_PKG} was requested but could not be loaded (declared-unresolvable).`,
    );
  });

  it('the identical-framing pin rejects a per-kind sentence added to one branch', async () => {
    const framings: string[] = [];
    for (const kind of KINDS) {
      const err = await classifiedFailure(kind);
      const rendered = formatI18nLoadDiagnostic(FIXTURE_PKG, err);
      // Exactly the edit the pin exists to catch: one branch grows its own
      // remedy line. If the pin could not see it, #14270's shape could land here.
      const withLocalRemedy =
        kind === 'declared-no-loadable-entry' ? `${rendered}\n  ask the package to publish an entry` : rendered;
      framings.push(framingOf(withLocalRemedy, kind, err));
    }
    expect(new Set(framings).size).toBe(2);
  });

  it('the source window can say no — a literal absent from the block is reported absent', () => {
    expect(i18nCatchWindow()).not.toContain('console.warn(formatClusterLoadDiagnostic(');
  });
});
