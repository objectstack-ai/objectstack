// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#1013 — `os serve` must load the enterprise multi-org runtime from the
 * HOST APP, over the REAL CLI process.
 *
 * The defect: the organizations load used a bare `import()`, which Node ESM
 * resolves against the importer's own realpath — the CLI's, inside the
 * framework workspace. `@objectstack/organizations` is cloud-private and only
 * ever lives in the served app's `node_modules`, so the import could never
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
 * The fixture stands in for the enterprise package (it is not installable in
 * this workspace — that is the whole point), registering the same `org-scoping`
 * service and posture entitlement the real one does. What is under test here is
 * RESOLUTION, not the enterprise semantics: proof that the real plugin walls
 * tenants lives in cloud's security-enterprise multi-org integration test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe, randomPort } from './helpers/serve-process.js';

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
};

describe('os serve — enterprise organizations resolution (cloud#1013)', () => {
  it(
    'boots a walled posture with the package installed in the APP, not the framework',
    async () => {
      const port = randomPort();
      const { stdout, stderr } = await runServe(appWithPackage, ['--port', port], {
        waitFor: /Press Ctrl\+C to stop/,
        env: { ...SERVE_ENV },
        timeoutMs: 240_000,
      });

      const seen = `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-4000)}`;

      // The load-bearing assertion. Before the fix, the bare import resolved
      // from the CLI's realpath in the framework workspace, threw
      // MODULE_NOT_FOUND, and this boot died on the D5 fail-fast instead of
      // reaching the banner at all.
      expect(stderr, `the D5 fail-fast fired — the app-installed package was not found${seen}`)
        .not.toMatch(/could not be loaded/);
      expect(stderr, `serve never reached its banner${seen}`).toContain('Press Ctrl+C to stop');
      // …and it is the APP's package that got mounted: `Organizations` is
      // tracked only on the path that actually registered the plugin.
      expect(stderr, `OrganizationsPlugin was not registered${seen}`).toContain('Organizations');
    },
    300_000,
  );

  it(
    'still refuses to boot a walled posture when the app does not ship the package',
    async () => {
      // The other half of the contract: the fix must not turn the ADR-0093 D5
      // fail-fast into a lenient skip. An app that requests isolation without
      // the enterprise runtime must still die rather than serve traffic with
      // the organization wall inactive.
      const port = randomPort();
      const { stdout, stderr } = await runServe(appWithoutPackage, ['--port', port], {
        waitFor: /Press Ctrl\+C to stop/,
        env: { ...SERVE_ENV },
        timeoutMs: 240_000,
      });

      const seen = `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-4000)}`;
      expect(stderr, `the D5 fail-fast did not fire${seen}`).toMatch(
        /FATAL: tenancy posture 'isolated' was requested/,
      );
      // The remedy names the app, because that is where the package has to go.
      expect(stderr).toMatch(/to THIS APP/);
      expect(stderr, `serve served traffic without the wall${seen}`).not.toContain(
        'Press Ctrl+C to stop',
      );
    },
    300_000,
  );

  it(
    'refuses when the package is reachable only through NODE_PATH — the pnpm shim shape (#4719)',
    async () => {
      // The #4719 defect, over a real process, with the launcher reproduced
      // exactly. Same app as the case above (declares nothing), same posture —
      // the only difference is the NODE_PATH every pnpm bin shim exports. Before
      // this change that single environment variable was enough to boot the
      // organization wall off a package the app had never declared, so whether
      // ADR-0093 D5 fired came down to HOW the process was started.
      const port = randomPort();
      const { stdout, stderr } = await runServe(appWithoutPackage, ['--port', port], {
        waitFor: /Press Ctrl\+C to stop/,
        env: { ...SERVE_ENV, NODE_PATH: hoistedStore },
        timeoutMs: 240_000,
      });

      const seen = `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-4000)}`;
      expect(
        stderr,
        `NODE_PATH got an undeclared app past the D5 wall — the #4719 defect${seen}`,
      ).toMatch(/FATAL: tenancy posture 'isolated' was requested/);
      // …and the remedy is the declaration one, naming why reachability lost.
      expect(stderr).toMatch(/to THIS APP/);
      expect(stderr).toMatch(/NODE_PATH/);
      expect(stderr, `serve served traffic without the wall${seen}`).not.toContain(
        'Press Ctrl+C to stop',
      );
      expect(stderr, `the hoisted package was mounted anyway${seen}`).not.toContain(
        'Organizations',
      );
    },
    300_000,
  );
});
