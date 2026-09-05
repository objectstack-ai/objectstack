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
import { bootStack } from './harness.js';

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
/**
 * #4719 — the package is INSTALLED in the app's own `node_modules` and the app
 * never declares it. That is what a hoisted workspace store looks like to the
 * resolver, and `bootStack` used to mount multi-tenant off it.
 */
let appInstalledButUndeclared: string;
/**
 * #14041/#14270 — declared AND installed, and the package's own `exports` names
 * no runtime entry Node can load (a `types`-only publish). The third
 * `HostImportFailureKind`, and the one this file's remedy branch used to hand
 * the "declare it and install it" line to.
 */
let appDeclaredNoLoadableEntry: string;
/**
 * The `declared-unresolvable` CONTROL: declared and NOT installed. Its arm is
 * untouched by #14270, so this case must render byte-identically before and
 * after — that is what makes the third arm's flip a measurement rather than a
 * rewrite that moved everything.
 */
let appDeclaredNotInstalled: string;

function writeApp(
  prefix: string,
  opts: { withOrganizations: boolean; declare?: boolean; typesOnly?: boolean },
): string {
  const declare = opts.declare ?? opts.withOrganizations;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'hostres-fixture',
        private: true,
        type: 'module',
        ...(declare ? { dependencies: { '@objectstack/organizations': '*' } } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  if (opts.withOrganizations) {
    const pkgDir = join(dir, 'node_modules', '@objectstack', 'organizations');
    mkdirSync(pkgDir, { recursive: true });
    if (opts.typesOnly) {
      // A publish whose `exports` names a `types` target and nothing else: no
      // `require` condition (so the CJS resolver throws) and no `import`
      // condition (so the #14041 fallback finder has nothing to load either).
      // Ordinary outside this workspace, and unfixable by any install action.
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
          name: '@objectstack/organizations',
          version: '0.0.0-fixture',
          type: 'module',
          exports: { '.': { types: './index.d.ts' } },
        }),
        'utf8',
      );
      writeFileSync(join(pkgDir, 'index.d.ts'), 'export declare class OrganizationsPlugin {}\n', 'utf8');
    } else {
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
  }
  return dir;
}

beforeAll(() => {
  appWithPackage = writeApp('os-verify-org-host-ok-', { withOrganizations: true });
  appWithoutPackage = writeApp('os-verify-org-host-missing-', { withOrganizations: false });
  appInstalledButUndeclared = writeApp('os-verify-org-host-undeclared-', {
    withOrganizations: true,
    declare: false,
  });
  appDeclaredNoLoadableEntry = writeApp('os-verify-org-host-no-entry-', {
    withOrganizations: true,
    typesOnly: true,
  });
  appDeclaredNotInstalled = writeApp('os-verify-org-host-not-installed-', {
    withOrganizations: false,
    declare: true,
  });
});

afterAll(() => {
  for (const dir of [
    appWithPackage,
    appWithoutPackage,
    appInstalledButUndeclared,
    appDeclaredNoLoadableEntry,
    appDeclaredNotInstalled,
  ]) {
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

  it(
    'refuses an UNDECLARED package even though it sits in the app\'s node_modules (#4719)',
    async () => {
      // Same fixture package, same directory layout as the passing case above —
      // only the `package.json` differs. Before #4719 the host lookup was a CJS
      // `require`, which finds anything reachable (the app's own node_modules
      // here; the pnpm shim's NODE_PATH store in the field), so `bootStack`
      // mounted the enterprise plugin for an app that had never asked for it and
      // the fixture's RLS posture silently depended on the workspace layout.
      await expect(
        bootStack(app as never, { multiTenant: true, hostRoot: appInstalledButUndeclared }),
      ).rejects.toThrow(/requires the enterprise @objectstack\/organizations/);
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    'says DECLARE it, not just install it, when the app has it but never declared it (#4719)',
    async () => {
      // The remedy must be the one that works. Telling an operator to install a
      // package that is demonstrably installed is the same unfollowable advice
      // #4700 removed from this message, one layer along.
      await expect(
        bootStack(app as never, { multiTenant: true, hostRoot: appInstalledButUndeclared }),
      ).rejects.toThrow(/DECLARE it in that app's package\.json/);
    },
    BOOT_TIMEOUT,
  );

  it(
    'CONTROL — the `declared-unresolvable` remedy is unchanged: declared, not installed (#4719)',
    async () => {
      // Not a new behaviour, a CONTROL. #14270 rewrote this branch's SHAPE
      // (two-way → three-way); this arm's text has to come out byte-identical,
      // or the third kind's fix moved something that was already right.
      // ⚠️ try/catch rather than `.then(onFulfilled, onRejected)`: `./harness`
      // is imported without its `.js` extension, so under NodeNext the
      // specifier does not resolve and every symbol it names is `any` — which
      // makes a `.then` callback PARAMETER implicitly any and adds a TS7006 to
      // this package's frozen TEST_DEBT ledger entry, a shrink-only ratchet.
      // The one-line fix that graduates the entry belongs to whoever takes that
      // card; this file must at least not push the count up.
      let message: string | undefined;
      try {
        const stack = await bootStack(app as never, {
          multiTenant: true,
          hostRoot: appDeclaredNotInstalled,
        });
        await stack.stop();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, 'bootStack resolved; it must refuse').toBeDefined();
      expect(message).toContain(
        `It IS declared in ${appDeclaredNotInstalled}'s package.json, so the declaration is `
        + 'not the problem — repair the install there (`pnpm install`, un-prune, rebuild its dist).',
      );
    },
    BOOT_TIMEOUT,
  );

  it(
    'DEFERS to the importer for a declared, installed package that publishes no entry (#14270)',
    async () => {
      // #14041 added a THIRD failure kind and this remedy was a two-way branch
      // written when there were two, so `declared-no-loadable-entry` fell into
      // the else leg and rendered the UNDECLARED arm — "Install/link it in THIS
      // APP … and DECLARE it in that app's package.json" — to an operator whose
      // app has already done both. Same confidently-wrong-verdict class #4700
      // and #4719 removed from this very sentence, one kind along.
      // try/catch, not `.then(onFulfilled, onRejected)` — see the note on the
      // control above: a callback parameter here would be implicitly any.
      let message: string | undefined;
      try {
        const stack = await bootStack(app as never, {
          multiTenant: true,
          hostRoot: appDeclaredNoLoadableEntry,
        });
        await stack.stop();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, 'bootStack resolved; it must refuse').toBeDefined();
      // Which arm fired: the deferral, naming the two things that are NOT the
      // problem and handing the remedy to the importer's own message, which is
      // interpolated at the end of this same string.
      expect(message).toMatch(/AND installed there, so neither is the problem/);
      expect(message).toMatch(/publishes no entry Node can load/);
      // ⛔ Neither of the other two arms: both are unfollowable here.
      expect(message).not.toMatch(/Install\/link it in THIS APP/);
      expect(message).not.toMatch(/repair the install there/);
      // The importer's own wording is what the remedy defers TO, so it has to
      // still be there — the deferral is only honest if the message arrives.
      expect(message).toMatch(/publishes no entry that Node can load/);
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );
});
