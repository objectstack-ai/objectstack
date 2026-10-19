// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#1013 — `os serve` must load the enterprise multi-org runtime from the
 * HOST APP, over the REAL CLI process.
 *
 * The defect: the organizations load used a bare `import()`, which Node ESM
 * resolves against the importer's own realpath — the CLI's, inside the
 * framework workspace. `@objectstack/organizations` is host-supplied — ADR-0132's
 * entitlement boundary forbids any framework package declaring it — so it only
 * ever lives in the served app's `node_modules` and the import could never
 * succeed: EVERY self-hosted deployment with `OS_TENANCY_POSTURE=group` or
 * `isolated` hit the ADR-0093 D5 fail-fast and exited 1, and the only way past
 * it was `OS_ALLOW_DEGRADED_TENANCY=1` — i.e. the unwalled state D5 exists to
 * prevent.
 *
 * WHY THIS FILE SPAWNS THE CLI. The defect survived because every test of the
 * walled postures hands the plugin in as `extraPlugins: [new
 * OrganizationsPlugin()]` (the cloud showcase dogfood suites) or mocks the
 * module (`packages/verify`'s posture test). Both bypass the CLI's own
 * resolution — the one thing that was broken. Only a test that runs `serve`
 * against a real app directory, with a real package in a real `node_modules`
 * and nothing mocked, exercises it.
 *
 * The fixture stands in for the enterprise package (`packages/cli` may not
 * declare it — ADR-0132's entitlement boundary — so it does not resolve here;
 * that is the whole point), registering the same `org-scoping` service and
 * posture entitlement the real one does. What is under test here is
 * RESOLUTION, not the enterprise semantics: proof that the real plugin walls
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
 * `serve-organizations-mount-failure.e2e.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe } from './helpers/serve-process.js';

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.orghost',
    namespace: 'orghost',
    version: '1.0.0',
    type: 'app',
    name: 'Organizations Host-Resolution Fixture',
  },
  objects: [{
    name: 'orghost_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
  }],
};
`;

/**
 * Stand-in for `@objectstack/organizations`. Mirrors the real plugin's
 * open-core-visible contract: the `org-scoping` service name plugin-security
 * probes to keep (vs strip) the wildcard `organization_id` RLS policies, and
 * the ADR-0105 D12 posture entitlement open core reads off that service.
 */
const FAKE_ORGANIZATIONS = `
export class OrganizationsPlugin {
  name = 'com.objectstack.organizations';
  type = 'standard';
  version = '0.0.0-fixture';
  supportedPostures = ['group', 'isolated'];
  async init(ctx) {
    ctx.registerService('org-scoping', this);
  }
}
`;

/** A host app with the enterprise package installed — the supported shape. */
let appWithPackage: string;
/** The same app WITHOUT it — the fail-fast must still fire. */
let appWithoutPackage: string;
/**
 * #4719 — an app that declares NOTHING, run with `NODE_PATH` pointing at a
 * store that carries the enterprise package. This is not a contrivance: it is
 * verbatim what a pnpm bin shim does before it execs the CLI —
 *
 *     export NODE_PATH="<workspace>/node_modules/.pnpm/node_modules"
 *
 * — and CJS resolution honours it, so `serve` used to boot a walled posture for
 * an app that had never asked for the multi-org runtime. Measured on cloud's
 * `apps/objectos-ee`: `pnpm start` (through the shim) booted silently, while
 * `node …/@objectstack/cli/bin/run.js serve` on the same app hit D5 and exited 1.
 */
let hoistedStore: string;

function writeOrganizationsPackage(root: string): void {
  const pkgDir = join(root, '@objectstack', 'organizations');
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
  writeFileSync(join(pkgDir, 'index.js'), FAKE_ORGANIZATIONS, 'utf8');
}

function writeApp(prefix: string, opts: { withOrganizations: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'orghost-fixture',
        private: true,
        type: 'module',
        ...(opts.withOrganizations
          ? { dependencies: { '@objectstack/organizations': '*' } }
          : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  if (opts.withOrganizations) writeOrganizationsPackage(join(dir, 'node_modules'));
  return dir;
}

beforeAll(() => {
  appWithPackage = writeApp('os-org-host-ok-', { withOrganizations: true });
  appWithoutPackage = writeApp('os-org-host-missing-', { withOrganizations: false });
  hoistedStore = mkdtempSync(join(tmpdir(), 'os-org-hoisted-store-'));
  writeOrganizationsPackage(hoistedStore);
});

afterAll(() => {
  for (const dir of [appWithPackage, appWithoutPackage, hoistedStore]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Auth must be wired for the organizations block to be reached at all. */
const SERVE_ENV = {
  OS_AUTH_SECRET: 'org-host-resolution-e2e-secret',
  OS_TENANCY_POSTURE: 'isolated',
  // [#11184] A walled posture refuses to boot unless the platform owner is
  // env-declared; these fixtures' subject is the organizations-package
  // resolution, so declare one (the refusal itself is pinned in
  // plugin-auth's auth-plugin-walled-owner-boot-refusal.test.ts).
  OS_PLATFORM_OWNER_EMAIL: 'operator@corp.example',
};

describe('os serve — 18.0 refuses the walled posture before the organizations runtime resolves', () => {
  const cases: ReadonlyArray<{ name: string; app: () => string; env: Record<string, string | undefined> }> = [
    { name: 'the package installed in the APP', app: () => appWithPackage, env: {} },
    { name: 'no package in the app', app: () => appWithoutPackage, env: {} },
    { name: 'the package reachable only through NODE_PATH', app: () => appWithoutPackage, env: { NODE_PATH: hoistedStore } },
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
