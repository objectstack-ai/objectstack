// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4818 — `os serve` must tell an operator WHICH of two different things went
 * wrong with the enterprise multi-org runtime, over the REAL CLI process.
 *
 * The defect: `importFromHost('@objectstack/organizations')` and
 * `kernel.use(new mod.OrganizationsPlugin())` shared a single `try`, so an
 * error the plugin threw while CONSTRUCTING or MOUNTING was reported as
 * "@objectstack/organizations could not be loaded" — i.e. as an ABSENT package
 * — offered `OS_ALLOW_DEGRADED_TENANCY=1` as the way out, and, when that was
 * already set, was downgraded to a warning and the boot continued. Two facts
 * with opposite remedies had one diagnosis:
 *
 *   | fact                | remedy                  | OS_ALLOW_DEGRADED_TENANCY |
 *   |---------------------|-------------------------|---------------------------|
 *   | package absent      | install it / go single  | applies (operator accepts |
 *   |                     |                         | the missing capability)   |
 *   | plugin refused      | whatever it reported    | does NOT apply            |
 *
 * The fix classifies by WHICH STAGE THREW — never by the error's shape, since
 * the package is loaded through `importFromHost` and the CLI may hold a
 * different module instance than the plugin does, and since the framework must
 * not encode any of the plugin's private refusal semantics.
 *
 * WHY THIS FILE SPAWNS THE CLI (same reason as its neighbour
 * `serve-organizations-host-resolution.e2e.test.ts`): every other test of the
 * walled postures hands the plugin in as `extraPlugins` or mocks the module,
 * which bypasses the CLI's own load/mount sequence — the only thing under test
 * here. The fixtures stand in for the closed-source enterprise package: one app
 * simply does not ship it, another ships a version whose plugin throws on
 * construction (the shape cloud#1020 gave its license gate). What is asserted
 * is the CLI's CLASSIFICATION and its message, not any enterprise semantics.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe, randomPort } from './helpers/serve-process.js';

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.orgmount',
    namespace: 'orgmount',
    version: '1.0.0',
    type: 'app',
    name: 'Organizations Mount-Failure Fixture',
  },
  objects: [{
    name: 'orgmount_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
  }],
};
`;

/** What the refusing fixture throws — asserted verbatim below. */
const REFUSAL_MESSAGE = 'organizations runtime declined to mount in this deployment (fixture)';
const REFUSAL_CODE = 'FIXTURE_MOUNT_REFUSED';

/**
 * A resolvable `@objectstack/organizations` whose plugin refuses at CONSTRUCTION
 * — the shape cloud#1020 gave its enterprise entitlement gate. Note the error
 * carries a structured `code`: the CLI prints it generically and must never
 * branch on its value.
 */
const REFUSING_ORGANIZATIONS = `
export class OrganizationsPlugin {
  constructor() {
    const err = new Error(${JSON.stringify(REFUSAL_MESSAGE)});
    err.code = ${JSON.stringify(REFUSAL_CODE)};
    throw err;
  }
}
`;

/** App that does NOT ship the package — the import stage fails. */
let appAbsent: string;
/** App that ships a package whose plugin refuses — the mount stage fails. */
let appRefusing: string;

function writeApp(prefix: string, organizationsSource: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'orgmount-fixture',
        private: true,
        type: 'module',
        ...(organizationsSource ? { dependencies: { '@objectstack/organizations': '*' } } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  if (organizationsSource) {
    const pkgDir = join(dir, 'node_modules', '@objectstack', 'organizations');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@objectstack/organizations',
        version: '0.0.0-fixture',
        type: 'module',
        main: 'index.js',
      }),
      'utf8',
    );
    writeFileSync(join(pkgDir, 'index.js'), organizationsSource, 'utf8');
  }
  return dir;
}

beforeAll(() => {
  appAbsent = writeApp('os-org-mount-absent-', null);
  appRefusing = writeApp('os-org-mount-refusing-', REFUSING_ORGANIZATIONS);
});

afterAll(() => {
  for (const dir of [appAbsent, appRefusing]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Auth must be wired for the organizations block to be reached at all. */
const SERVE_ENV = {
  OS_AUTH_SECRET: 'org-mount-failure-e2e-secret',
  OS_TENANCY_POSTURE: 'isolated',
};

const BANNER = 'Press Ctrl+C to stop';
const BANNER_RE = /Press Ctrl\+C to stop/;

function seenOf(stdout: string, stderr: string): string {
  return `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-4000)}`;
}

describe('os serve — organizations import stage vs mount stage (#4818)', () => {
  describe('import stage fails — the package is ABSENT (behaviour must be unchanged)', () => {
    it(
      'refuses to boot with the ADR-0093 D5 "could not be loaded" diagnosis',
      async () => {
        const port = randomPort();
        const { stdout, stderr } = await runServe(appAbsent, ['--port', port], {
          waitFor: BANNER_RE,
          env: { ...SERVE_ENV, OS_ALLOW_DEGRADED_TENANCY: undefined },
          timeoutMs: 240_000,
        });
        const seen = seenOf(stdout, stderr);

        expect(stderr, `the D5 fail-fast did not fire${seen}`).toMatch(
          /FATAL: tenancy posture 'isolated' was requested/,
        );
        // This wording is CORRECT here and must survive the stage split: the
        // package really is not on this machine.
        expect(stderr, `the absent-package diagnosis was lost${seen}`).toMatch(/could not be loaded/);
        // …and the escape hatch is still offered on the path it belongs to.
        expect(stderr).toMatch(/set OS_ALLOW_DEGRADED_TENANCY=1 to boot/);
        expect(stderr, `serve served traffic without the wall${seen}`).not.toContain(BANNER);
      },
      300_000,
    );

    it(
      'boots degraded when the operator explicitly sets OS_ALLOW_DEGRADED_TENANCY=1',
      async () => {
        // The escape hatch keeps its one legitimate meaning: "the capability is
        // absent and I accept running without it". Pinned so the stage split
        // cannot regress it.
        const port = randomPort();
        const { stdout, stderr } = await runServe(appAbsent, ['--port', port], {
          waitFor: BANNER_RE,
          env: { ...SERVE_ENV, OS_ALLOW_DEGRADED_TENANCY: '1' },
          timeoutMs: 240_000,
        });
        const seen = seenOf(stdout, stderr);

        expect(stderr, `serve never reached its banner${seen}`).toContain(BANNER);
        expect(stderr, `the degraded boot was not branded${seen}`).toMatch(/DEGRADED TENANCY/);
        expect(stderr, `the degraded opt-in still fired the fail-fast${seen}`).not.toMatch(/✖ FATAL/);
      },
      300_000,
    );
  });

  describe('mount stage fails — the package is PRESENT and its plugin refused', () => {
    it(
      "surfaces the plugin's own error verbatim and exits, without the absent-package wording",
      async () => {
        const port = randomPort();
        const { stdout, stderr } = await runServe(appRefusing, ['--port', port], {
          waitFor: BANNER_RE,
          env: { ...SERVE_ENV, OS_ALLOW_DEGRADED_TENANCY: undefined },
          timeoutMs: 240_000,
        });
        const seen = seenOf(stdout, stderr);

        // D5's posture is unchanged: isolation was requested and cannot be
        // delivered, so the boot still dies.
        expect(stderr, `serve served traffic without the wall${seen}`).not.toContain(BANNER);
        expect(stderr, `no fail-fast fired for a refusing plugin${seen}`).toMatch(/✖ FATAL/);

        // The crux: the operator is told the package IS there, and reads the
        // plugin's own words — not a fabricated cause, and not a module
        // resolution wild goose chase.
        expect(stderr, `the mount refusal was misreported as an absent package${seen}`).not.toMatch(
          /could not be loaded/,
        );
        expect(stderr, `the plugin's message was not surfaced verbatim${seen}`).toContain(REFUSAL_MESSAGE);
        expect(stderr, `the plugin's structured code was not surfaced${seen}`).toContain(REFUSAL_CODE);
        expect(stderr, `the message does not say the package was found${seen}`).toMatch(
          /WAS found and loaded/,
        );
        // Honest remaining alternative, and no dead-end suggestion.
        expect(stderr).toMatch(/OS_TENANCY_POSTURE=single/);
        expect(stderr, `the escape hatch was offered on a path it cannot fix${seen}`).toMatch(
          /OS_ALLOW_DEGRADED_TENANCY does NOT apply/,
        );
      },
      300_000,
    );

    it(
      'still exits 1 when OS_ALLOW_DEGRADED_TENANCY=1 is set — the hatch must not swallow a refusal',
      async () => {
        // THE issue. Before the fix this booted with a warning: an env var
        // silently overrode whatever gate the plugin was enforcing.
        const port = randomPort();
        const { stdout, stderr } = await runServe(appRefusing, ['--port', port], {
          waitFor: BANNER_RE,
          env: { ...SERVE_ENV, OS_ALLOW_DEGRADED_TENANCY: '1' },
          timeoutMs: 240_000,
        });
        const seen = seenOf(stdout, stderr);

        expect(
          stderr,
          `OS_ALLOW_DEGRADED_TENANCY swallowed a plugin refusal and served traffic${seen}`,
        ).not.toContain(BANNER);
        expect(stderr, `the refusal did not fail fast under the escape hatch${seen}`).toMatch(/✖ FATAL/);
        expect(stderr, `the refusal was downgraded to a degraded-boot warning${seen}`).not.toMatch(
          /DEGRADED TENANCY \(OS_ALLOW_DEGRADED_TENANCY=1\)/,
        );
        expect(stderr, `the plugin's message was not surfaced verbatim${seen}`).toContain(REFUSAL_MESSAGE);
      },
      300_000,
    );
  });
});
