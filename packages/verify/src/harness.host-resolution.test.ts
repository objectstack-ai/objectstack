// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4700 — `bootStack({ multiTenant: true })` must load the enterprise multi-org
 * runtime from the HOST APP.
 *
 * The defect: the organizations load used a bare `import()`, which Node ESM
 * resolves against the importer's own realpath — `packages/verify`'s, inside the
 * framework workspace. `@objectstack/organizations` is cloud-private and only
 * ever lives in the verified app's `node_modules`, so the import could never
 * succeed: `objectstack verify --multi-tenant` (and every programmatic
 * `bootStack(app, { multiTenant: true })`) fell into the catch and told the
 * operator to "Install/link it in this workspace" — about a package the app had
 * already installed. Same defect class as cloud#1013, one package over.
 *
 * WHY THIS FILE EXISTS ALONGSIDE `harness.posture.test.ts`. That file proves the
 * POSTURE semantics and reaches the plugin through `vi.mock`, which substitutes
 * the module registry and therefore bypasses resolution entirely — the one thing
 * that was broken. A mocked import cannot fail the way the real one did, so the
 * defect was invisible to it (exactly how it survived #4699's sweep of `serve`).
 * These cases use a real temp app directory with a real `node_modules` and a
 * real stand-in package on disk, and mock nothing.
 *
 * The fixture stands in for the enterprise package (it is not installable in
 * this workspace — that is the whole point), registering the same `org-scoping`
 * service and posture entitlement the real one does. What is under test here is
 * RESOLUTION, not the enterprise semantics.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack } from './harness';

/**
 * Stand-in for `@objectstack/organizations`. Mirrors the real plugin's
 * open-core-visible contract: the `org-scoping` service name plugin-security
 * probes to keep (vs strip) the wildcard `organization_id` RLS policies, and the
 * ADR-0105 D12 posture entitlement open core reads off that service.
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

const app = {
  manifest: {
    id: 'com.example.hostres',
    namespace: 'hostres',
    version: '0.0.1',
    type: 'app',
    name: 'Host Resolution Fixture',
  },
  objects: [],
};

interface TenancyShape {
  posture: string;
  requestedPosture: string;
  isolationActive: boolean;
}

/** A host app with the enterprise package installed — the supported shape. */
let appWithPackage: string;
/** The same app WITHOUT it — the hard error must still fire. */
let appWithoutPackage: string;

function writeApp(prefix: string, opts: { withOrganizations: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'hostres-fixture',
        private: true,
        type: 'module',
        ...(opts.withOrganizations ? { dependencies: { '@objectstack/organizations': '*' } } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  if (opts.withOrganizations) {
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
    writeFileSync(join(pkgDir, 'index.js'), FAKE_ORGANIZATIONS, 'utf8');
  }
  return dir;
}

beforeAll(() => {
  appWithPackage = writeApp('os-verify-org-host-ok-', { withOrganizations: true });
  appWithoutPackage = writeApp('os-verify-org-host-missing-', { withOrganizations: false });
});

afterAll(() => {
  for (const dir of [appWithPackage, appWithoutPackage]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
});

// Each case boots the full in-process stack — well beyond the 5s default.
const BOOT_TIMEOUT = 120_000;

describe('bootStack multiTenant — host-app package resolution (#4700)', () => {
  it(
    'mounts the enterprise plugin installed in the APP, not in the framework workspace',
    async () => {
      // Before the fix this rejected with "requires the enterprise
      // @objectstack/organizations package … Install/link it in this
      // workspace" — for an app that plainly has it installed.
      const stack = await bootStack(app as never, {
        multiTenant: true,
        hostRoot: appWithPackage,
      });
      try {
        // The plugin really mounted: `org-scoping` is registered ONLY by the
        // app-supplied package, and the walled posture it entitles is active.
        await expect(stack.kernel.getServiceAsync('org-scoping')).resolves.toBeDefined();
        const tenancy = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
        expect(tenancy.requestedPosture).toBe('isolated');
        expect(tenancy.isolationActive).toBe(true);
      } finally {
        await stack.stop();
      }
    },
    BOOT_TIMEOUT,
  );

  it(
    'still fails hard when the app does not ship the package',
    async () => {
      // The other half of the contract: the fix must not turn the explicit
      // opt-in into a lenient single-tenant downgrade. An app that asks for
      // multi-tenant without the enterprise runtime must still throw rather
      // than boot with every tenant policy stripped — which is what a fixture
      // would then assert its authorization model against.
      await expect(
        bootStack(app as never, { multiTenant: true, hostRoot: appWithoutPackage }),
      ).rejects.toThrow(/requires the enterprise @objectstack\/organizations/);
      // The posture env is restored even on the failure path.
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    'names the app directory in the remedy, because that is where the package has to go',
    async () => {
      // The old message said "Install/link it in this workspace", which pointed
      // at the framework checkout — the one place installing it would NOT have
      // helped. An operator who followed it verbatim could not succeed.
      await expect(
        bootStack(app as never, { multiTenant: true, hostRoot: appWithoutPackage }),
      ).rejects.toThrow(new RegExp(`Install/link it in THIS APP \\(${appWithoutPackage}\\)`));
    },
    BOOT_TIMEOUT,
  );
});
