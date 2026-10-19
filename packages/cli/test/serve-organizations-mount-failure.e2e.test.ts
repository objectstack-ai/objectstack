// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4818 — `os serve` must tell an operator WHICH of two different things went
 * wrong with the multi-org runtime, over the REAL CLI process.
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
 * here. The fixtures stand in for a mounted multi-org runtime: one app simply
 * does not ship it, another ships a version whose plugin throws on construction
 * — which is specifically the COMMERCIAL package's shape, since ADR-0132 D2
 * leaves construction-time licence refusal to the private subclass and the open
 * `packages/plugins/organizations` carries no licence check of any kind (the
 * shape cloud#1020 gave its license gate). What is asserted is the CLI's
 * CLASSIFICATION and its message, not any runtime's semantics.
 *
 * ## 18.0: the walled postures are refused before this resolution runs
 *
 * 18.0 supports the `single` posture only (ruling record 6259698357 on the
 * v18 epic). `os serve` refuses `group` and `isolated` at its
 * tenancy-posture gate, before a config is read (`walledPostureRefusal`,
 * pinned in-process in `src/commands/serve-walled-posture-refusal.test.ts`).
 * So in 18.0 no walled boot reaches the stages this file was written for. The
 * cases below keep its fixtures and pin, over the real process, that the 18.0
 * refusal comes FIRST whatever the package state, and that
 * `OS_ALLOW_DEGRADED_TENANCY` does not lift it. The 18.x release that carries
 * the walled postures restores this file's resolution cases from git history
 * (the parent of the commit that added this section), together with
 * `serve-organizations-host-resolution.e2e.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe } from './helpers/serve-process.js';

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
  // [#11184] A walled posture refuses to boot unless the platform owner is
  // env-declared; these fixtures' subject is the organizations-package
  // resolution, so declare one (the refusal itself is pinned in
  // plugin-auth's auth-plugin-walled-owner-boot-refusal.test.ts).
  OS_PLATFORM_OWNER_EMAIL: 'operator@corp.example',
};

describe('os serve — 18.0 refuses the walled posture before the organizations runtime resolves', () => {
  const cases: ReadonlyArray<{ name: string; app: () => string; env: Record<string, string | undefined> }> = [
    { name: 'the package ABSENT', app: () => appAbsent, env: { OS_ALLOW_DEGRADED_TENANCY: undefined } },
    { name: 'the package ABSENT, OS_ALLOW_DEGRADED_TENANCY=1', app: () => appAbsent, env: { OS_ALLOW_DEGRADED_TENANCY: '1' } },
    { name: 'the package PRESENT and refusing', app: () => appRefusing, env: { OS_ALLOW_DEGRADED_TENANCY: undefined } },
    { name: 'the package PRESENT and refusing, OS_ALLOW_DEGRADED_TENANCY=1', app: () => appRefusing, env: { OS_ALLOW_DEGRADED_TENANCY: '1' } },
  ];
  for (const c of cases) {
    it(
      `${c.name}: refused in 18.0, and no organizations stage ran`,
      async () => {
        const { stdout, stderr } = await runServe(c.app(), [], {
          waitFor: /Press Ctrl\+C to stop/,
          env: { ...SERVE_ENV, ...c.env },
          timeoutMs: 240_000,
        });
        const seen = `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-4000)}`;
        expect(stderr, `the 18.0 walled-posture refusal did not fire${seen}`).toContain(
          "FATAL: tenancy posture 'isolated' is not supported in 18.0 (NOT_IMPLEMENTED).",
        );
        expect(stderr, `serve served traffic under a walled posture${seen}`).not.toContain('Press Ctrl+C to stop');
        // Neither organizations stage was reached: no absent-package fail-fast,
        // no mount refusal, no degraded boot.
        expect(stderr, `the organizations import ran before the refusal${seen}`).not.toMatch(/could not be loaded|was requested/);
        expect(stderr, `the organizations mount ran before the refusal${seen}`).not.toMatch(/WAS found and loaded/);
        expect(stderr, `a degraded boot ran before the refusal${seen}`).not.toMatch(/DEGRADED TENANCY/);
      },
      300_000,
    );
  }
});
