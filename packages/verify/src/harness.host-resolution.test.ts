// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4700 — `bootStack({ multiTenant: true })` must load the enterprise multi-org
 * runtime from the HOST APP.
 *
 * The defect: the organizations load used a bare `import()`, which Node ESM
 * resolves against the importer's own realpath — `packages/verify`'s, inside the
 * framework workspace. `@objectstack/organizations` is host-supplied — ADR-0132's
 * entitlement boundary forbids any framework package declaring it — so it only
 * ever lives in the verified app's `node_modules` and the import could never
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
 * The fixture stands in for the enterprise package (`packages/verify` may not
 * declare it — ADR-0132's entitlement boundary — so it does not resolve here;
 * that is the whole point), registering the same `org-scoping` service and
 * posture entitlement the real one does. What is under test here is
 * RESOLUTION, not the enterprise semantics.
 *
 * ── #17911 — why ONE case below drives a `@fixture/*` subject ────────────────
 *
 * The CONTROL's whole content is "this host root DECLARED it and does not have
 * it". Until ADR-0132 / #16215 that came free: `@objectstack/organizations` was
 * cloud-private, so a temp host that declared it and did not install it was
 * unresolvable by construction. It is a tracked workspace package now, pnpm's
 * hoisted store carries it, and vitest's own `pnpm exec` bin shim exports a
 * `NODE_PATH` that reaches that store — so the package RESOLVED, the wall came
 * up, and boot was refused several steps later by the membership-policy gate
 * whose message even says "This is NOT … a missing package". The CONTROL never
 * reached the wording it exists to pin: red on any tree with a full local
 * build, green on CI, and proving nothing in either state.
 *
 * So that one case hands in a name this workspace can never contain and the
 * PREMISE block below PROVES the absence instead of assuming it — the repair
 * #16539 (dogfood) and #16552 (`packages/types/src/node.test.ts`) landed, for
 * the reason those cards state verbatim: no workspace name is safe from
 * becoming one.
 *
 * ⛔ The other four cases deliberately stay on the REAL subject, and that is
 * what keeps `ORGANIZATIONS_PKG` pinned as `bootStack`'s default: each of them
 * is decided by something the ambient workspace cannot supply — an app-local
 * `node_modules` copy, which wins over `NODE_PATH`, or the UNDECLARED arm,
 * whose fallback is this module's own ESM `import()` and Node's ESM resolver
 * does not consult `NODE_PATH` at all. Measured in both build states (#17911).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostRequire } from '@objectstack/types/node';
import { bootStack, ORGANIZATIONS_PKG } from './harness.js';

/**
 * The subject the `declared-unresolvable` CONTROL is built around: modelled on
 * the real enterprise package, fixture-only in NAME.
 *
 * ⚠️ #17911 — it must stay a `@fixture/*` name. A name this workspace owns
 * cannot state "this host root does not have it", because the hoisted store and
 * the launcher's `NODE_PATH` answer that question instead of the fixture; and no
 * workspace name is safe from becoming one (`@objectstack/organizations` was
 * cloud-private when this case was written). Only a name the workspace can never
 * contain is, and the PREMISE cases at the bottom prove this one still is not.
 */
const FIXTURE_ORGANIZATIONS = '@fixture/host-organizations';

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
 *
 * ⚠️ #17911 — "NOT installed" is a property of THIS directory, and only a
 * subject the workspace can never supply keeps it one. See
 * {@link FIXTURE_ORGANIZATIONS}.
 */
let appDeclaredNotInstalled: string;
/**
 * #17911 PREMISE leg 1 only — a host that really does install the fixture
 * subject. Without it, a subject that exists NOWHERE (a typo, a deleted scope)
 * would satisfy the absence leg and the CONTROL would be vacuous.
 */
let appFixtureInstalled: string;

function writeApp(
  prefix: string,
  opts: { withOrganizations: boolean; declare?: boolean; typesOnly?: boolean; pkg?: string },
): string {
  const declare = opts.declare ?? opts.withOrganizations;
  // #17911 — the subject this host declares and/or installs. Defaults to the
  // real package, which is what four of the five cases need; the CONTROL hands
  // in `FIXTURE_ORGANIZATIONS` because its verdict is an ABSENCE and only a name
  // the workspace can never supply keeps that absence a property of this
  // directory.
  const pkg = opts.pkg ?? ORGANIZATIONS_PKG;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'hostres-fixture',
        private: true,
        type: 'module',
        ...(declare ? { dependencies: { [pkg]: '*' } } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  if (opts.withOrganizations) {
    // The specifier is a scoped name, so it lands on disk as `<scope>/<name>`.
    const pkgDir = join(dir, 'node_modules', ...pkg.split('/'));
    mkdirSync(pkgDir, { recursive: true });
    if (opts.typesOnly) {
      // A publish whose `exports` names a `types` target and nothing else: no
      // `require` condition (so the CJS resolver throws) and no `import`
      // condition (so the #14041 fallback finder has nothing to load either).
      // Ordinary outside this workspace, and unfixable by any install action.
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
          name: pkg,
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
          name: pkg,
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
    pkg: FIXTURE_ORGANIZATIONS,
  });
  appFixtureInstalled = writeApp('os-verify-org-host-fixture-ok-', {
    withOrganizations: true,
    pkg: FIXTURE_ORGANIZATIONS,
  });
});

afterAll(() => {
  for (const dir of [
    appWithPackage,
    appWithoutPackage,
    appInstalledButUndeclared,
    appDeclaredNoLoadableEntry,
    appDeclaredNotInstalled,
    appFixtureInstalled,
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
      // ⚠️ #17911 — `organizationsPackage` is why this case can still SAY
      // "not installed". On the real subject the host's declaration was
      // honoured, the hoisted store answered the resolve, the wall came up and
      // boot died several steps later at the membership-policy gate — the
      // assertion below was never reached, in either direction. The subject is
      // a `@fixture/*` name the workspace can never contain; the PREMISE block
      // proves it is absent, and `bootStack`'s DEFAULT subject stays pinned by
      // the four cases above, which pass no option at all.
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
          organizationsPackage: FIXTURE_ORGANIZATIONS,
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

/**
 * #17911 — the premises the CONTROL rests on, asserted instead of assumed.
 *
 * Both resolution legs are load-bearing and they fail in opposite directions.
 * Without leg 1 a subject that exists nowhere at all satisfies leg 2 and the
 * CONTROL is vacuous; without leg 2 the fixture stops deciding what the host
 * root has, and the CONTROL silently starts measuring the ambient workspace —
 * which is exactly how this case broke.
 */
describe('PREMISE — the CONTROL subject is host-only (#17911)', () => {
  it('resolves from a host app that installs it', () => {
    // Leg 1. A host that really installs the fixture can see it, so
    // "unresolvable" elsewhere is a statement about the resolver's anchor and
    // not about a typo or a scope nobody publishes.
    const fromHost = createHostRequire(appFixtureInstalled).resolve(FIXTURE_ORGANIZATIONS);
    expect(fromHost).toContain(appFixtureInstalled);
  });

  it('is absent from every ambient store the runner exposes', () => {
    // Leg 2, and the guard that would have caught this card. Asserted on the
    // BARE SPECIFIER, ⛔ never on `/Cannot find module/` alone: a package the
    // runner CAN see whose entry file merely is not on disk throws
    // MODULE_NOT_FOUND too, naming `<store>/<pkg>/dist/index.js` instead of the
    // specifier. That second throw is precisely what kept this CONTROL green
    // while the property went unguarded — `@objectstack/organizations` was
    // reachable through the pnpm bin shim's NODE_PATH and simply unbuilt on
    // CI's task graph. Read as a bare-specifier failure, the premise can no
    // longer be satisfied by an unbuilt workspace package, in either build
    // state.
    expect(() => createHostRequire(appDeclaredNotInstalled).resolve(FIXTURE_ORGANIZATIONS)).toThrow(
      new RegExp(`Cannot find module '${FIXTURE_ORGANIZATIONS}'`),
    );
  });

  it('and the REAL package is reachable from that same anchor — the asymmetry is the point', () => {
    // The other half of leg 2, and the one that makes this file's history
    // legible: from the very same host root, the real subject DOES resolve,
    // through the hoisted store the launcher's NODE_PATH exposes. That is not a
    // defect to fix here (ADR-0132 put the package in this workspace on
    // purpose); it is the reason the CONTROL may not be built on that name.
    //
    // ⚠️ Build-state dependent BY CONSTRUCTION, so it asserts reachability of
    // the package DIRECTORY rather than a loadable entry: `require.resolve`
    // throws MODULE_NOT_FOUND for an unbuilt package too, and pinning "it
    // resolves" would make this case itself a verdict about whether a sibling
    // package had been built — the defect it documents.
    let resolveError: string | undefined;
    try {
      createHostRequire(appDeclaredNotInstalled).resolve(ORGANIZATIONS_PKG);
    } catch (e) {
      resolveError = (e as Error).message;
    }
    // Either it resolved (built tree), or it failed naming a path inside the
    // store rather than the bare specifier (unbuilt tree). What must NEVER
    // happen is the bare-specifier failure leg 2 asserts for the fixture.
    expect(resolveError).not.toMatch(new RegExp(`Cannot find module '${ORGANIZATIONS_PKG}'`));
  });

  it('and bootStack still binds the ENTERPRISE package as its default subject', () => {
    // What the fixture subject must NOT quietly become: the default. Production
    // callers pass no `organizationsPackage`, and the one they get is the real
    // package — behaviourally pinned by the four cases above, which pass no
    // option and are decided by the real name.
    expect(ORGANIZATIONS_PKG).toBe('@objectstack/organizations');
    expect(FIXTURE_ORGANIZATIONS).not.toBe(ORGANIZATIONS_PKG);
    expect(FIXTURE_ORGANIZATIONS.startsWith('@fixture/')).toBe(true);
  });
});
