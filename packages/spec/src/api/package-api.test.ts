import { describe, it, expect } from 'vitest';
import {
  PackagePathParamsSchema,
  ListInstalledPackagesRequestSchema,
  GetInstalledPackageRequestSchema,
  PackageInstallRequestSchema,
  PackageInstallBodySchema,
  PackageInstallResponseSchema,
  PackageUpgradeRequestSchema,
  PackageUpgradeResponseSchema,
  ResolveDependenciesRequestSchema,
  ResolveDependenciesResponseSchema,
  UploadArtifactRequestSchema,
  UploadArtifactResponseSchema,
  PackageRollbackRequestSchema,
  UninstallPackageApiRequestSchema,
  UninstallPackageApiResponseSchema,
  PackageApiErrorCode,
} from './package-api.zod';
// The declarations that embed the assembled package body live one file over
// and ship from `@objectstack/spec/api-assembled` (#18576 ruling, letter B).
import {
  ListInstalledPackagesResponseSchema,
  GetInstalledPackageResponseSchema,
  PackageApiContracts,
  AssembledInstalledPackageSchema,
  InstalledPackageAtEitherStageSchema,
} from './package-api-assembled.zod';
import { InstalledPackageSchema } from '../kernel/package-registry.zod';
import { ManifestSchema } from '../kernel/manifest.zod';
import { AssembledPackageBodySchema } from '../stack.zod';
import { z } from 'zod';

// ==========================================
// Path Parameters
// ==========================================

describe('PackagePathParamsSchema', () => {
  it('should accept a valid package ID', () => {
    const result = PackagePathParamsSchema.parse({ packageId: 'com.acme.crm' });
    expect(result.packageId).toBe('com.acme.crm');
  });
});

// ==========================================
// List Packages
// ==========================================

describe('ListInstalledPackagesRequestSchema', () => {
  // [#17667] These two cases used to pin `limit`'s `.default(50)` and a
  // round-tripped `cursor`. They are REPLACED rather than respelled: they
  // pinned exactly the branch route 2 deleted, so keeping them in any form
  // would have meant re-asserting a contract that no longer exists.
  it('accepts a minimal request and materializes no window', () => {
    const result = ListInstalledPackagesRequestSchema.parse({});
    expect(result.status).toBeUndefined();
    expect(result.enabled).toBeUndefined();
    expect(result.type).toBeUndefined();
    // ⭐ There is no default to apply any more: the door has never capped this
    // list, so an omitted request declares no window rather than a fictional
    // 50-row one.
    expect(result).not.toHaveProperty('limit');
  });

  it('accepts every filter the serving door actually executes', () => {
    const result = ListInstalledPackagesRequestSchema.parse({
      status: 'installed',
      enabled: true,
      type: 'app',
    });
    expect(result.status).toBe('installed');
    expect(result.enabled).toBe(true);
    expect(result.type).toBe('app');
  });

  it('should reject invalid status', () => {
    expect(() => ListInstalledPackagesRequestSchema.parse({ status: 'running' })).toThrow();
  });

  // ── #17667 retirement pins: the prescription, and the absence ────────────
  //
  // The NEGATIVE half. A bare `.toThrow()` would be satisfied by any refusal,
  // including the generic unrecognized-key issue a plain deletion produces —
  // which is exactly the silent-ish failure the tombstone exists to replace.
  // So the assertion is the prescription text itself. The `s` flag is house
  // style: the message is one long string and matchers span its clauses.
  it.each(['limit', 'cursor'])('refuses a retired `%s` with the prescription, not a bare unknown key', (key) => {
    const result = ListInstalledPackagesRequestSchema.safeParse({ [key]: key === 'limit' ? 20 : 'abc123' });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === key);
    expect(issue, `must fault on the \`${key}\` path`).toBeDefined();
    expect(issue!.message).toMatch(/`limit` \/ `cursor` were removed from GET \/api\/v1\/packages/s);
    expect(issue!.message).toMatch(/removed .*in @objectstack\/spec 17\.5\.0 \(ADR-0049 enforce-or-remove\)/s);
    // The `.default(50)` is named specifically — a reader who trusted the cap
    // is the consumer this retirement owes an explanation to.
    expect(issue!.message).toMatch(/`\.default\(50\)`/s);
    expect(issue!.message).toMatch(/Delete the key\./s);
  });

  // The POSITIVE half. Absence still parses — the retirement removed a
  // declaration, not the ability to call the route without one.
  it('parses clean when neither retired key is sent', () => {
    const result = ListInstalledPackagesRequestSchema.safeParse({ status: 'installed' });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('cursor');
  });

  // [#17667] `hasMore` is a constant `false` that is now true BY CONSTRUCTION:
  // with no request-side way to ask for a page, there can be no next one. This
  // pins the response half against a future author "fixing" the constant back
  // into a computed value without restoring a way to ask.
  it('declares a response that can honestly report one page', () => {
    const parsed = ListInstalledPackagesResponseSchema.parse({
      success: true,
      data: { packages: [], total: 0, hasMore: false },
    });
    expect(parsed.data.hasMore).toBe(false);
    expect(parsed.data).not.toHaveProperty('nextCursor');
  });
});

// ==========================================
// [#17667] Executed-but-undeclared query parameters, now declared
// ==========================================

describe('the /packages doors declare the query parameters they execute', () => {
  it('GET /packages/:id declares the `?version=` scope it honours', () => {
    const parsed = GetInstalledPackageRequestSchema.parse({ packageId: 'com.acme.crm', version: '1.2.3' });
    expect(parsed.packageId).toBe('com.acme.crm');
    expect(parsed.version).toBe('1.2.3');
    // `latest` is a literal the door treats as "the installed row" — it is a
    // plain string here, deliberately NOT a dist-tag or semver-range grammar.
    expect(GetInstalledPackageRequestSchema.parse({ packageId: 'p', version: 'latest' }).version).toBe('latest');
    // Omitted stays omitted: the by-id read is unscoped without it.
    expect(GetInstalledPackageRequestSchema.parse({ packageId: 'p' }).version).toBeUndefined();
  });

  it('DELETE /packages/:id declares the `?keepData=` option it honours', () => {
    const parsed = UninstallPackageApiRequestSchema.parse({ packageId: 'com.acme.crm', keepData: true });
    expect(parsed.packageId).toBe('com.acme.crm');
    expect(parsed.keepData).toBe(true);
    // Omitted is the destructive default — storage goes with the metadata.
    expect(UninstallPackageApiRequestSchema.parse({ packageId: 'p' }).keepData).toBeUndefined();
  });

  it('binds each declaration to the door that executes it', () => {
    // The contract map is what SDKs and codegen read; a declaration that is
    // right in the file and unbound in the map is invisible to both.
    expect(PackageApiContracts.listPackages.input).toBe(ListInstalledPackagesRequestSchema);
    expect(PackageApiContracts.getPackage.input).toBe(GetInstalledPackageRequestSchema);
    expect(PackageApiContracts.uninstallPackage.input).toBe(UninstallPackageApiRequestSchema);
  });
});

// ==========================================
// Install Package
// ==========================================

describe('PackageInstallRequestSchema', () => {
  it('should accept a minimal install request — and leave an absent `enableOnInstall` UNDEFINED', () => {
    const result = PackageInstallRequestSchema.parse({
      manifest: {
        id: 'com.acme.crm',
        name: 'acme_crm',
        version: '1.0.0',
        type: 'plugin',
      },
    });
    // ⭐ [#19273] This assertion read `toBe(true)` while the declaration spelled
    // `.default(true)`, and it was the lit control proving absence really was
    // erased at parse time. The declaration is `optional()` now — 「缺省 = 保持，
    // 有旗 = 设置」 — so the absence survives the parse and the door's three-way
    // read has a third state to see. The full matrix, with the flip-trigger it
    // was registered under, is in `package-install-one-authority.test.ts`.
    expect(result.enableOnInstall).toBeUndefined();
  });

  it('should accept full install request with platform version', () => {
    const result = PackageInstallRequestSchema.parse({
      manifest: {
        id: 'com.acme.crm',
        name: 'acme_crm',
        version: '1.0.0',
        type: 'plugin',
      },
      settings: { apiKey: 'abc123' },
      enableOnInstall: false,
      platformVersion: '3.2.0',
      artifactRef: {
        url: 'https://marketplace.objectstack.io/artifacts/com.acme.crm/1.0.0.tgz',
        sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        size: 1024000,
        uploadedAt: '2026-02-01T10:00:00Z',
      },
    });
    expect(result.enableOnInstall).toBe(false);
    expect(result.platformVersion).toBe('3.2.0');
    expect(result.artifactRef?.sha256).toBeDefined();
  });
});

describe('PackageInstallResponseSchema', () => {
  it('should accept a successful install response', () => {
    const result = PackageInstallResponseSchema.parse({
      success: true,
      data: {
        package: {
          manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'plugin' },
          status: 'installed',
          enabled: true,
        },
        dependencyResolution: {
          dependencies: [
            { packageId: 'com.acme.core', requiredRange: '^1.0.0', status: 'satisfied', resolvedVersion: '1.2.0' },
          ],
          canProceed: true,
          requiredActions: [],
          installOrder: ['com.acme.core', 'com.acme.crm'],
        },
        message: 'Package installed successfully',
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.package.status).toBe('installed');
    expect(result.data.dependencyResolution?.canProceed).toBe(true);
  });

  it('should accept install response with namespace conflicts', () => {
    const result = PackageInstallResponseSchema.parse({
      success: true,
      data: {
        package: {
          manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'plugin' },
          status: 'installed',
          enabled: true,
        },
        namespaceConflicts: [{
          type: 'namespace_conflict',
          requestedNamespace: 'acme',
          conflictingPackageId: 'com.other.plugin',
          conflictingPackageName: 'Other Plugin',
          suggestion: 'acme_crm',
        }],
      },
    });
    expect(result.data.namespaceConflicts).toHaveLength(1);
    expect(result.data.namespaceConflicts![0].suggestion).toBe('acme_crm');
  });
});

// ==========================================
// Upgrade Package
// ==========================================

describe('PackageUpgradeRequestSchema', () => {
  it('should accept minimal upgrade request', () => {
    const result = PackageUpgradeRequestSchema.parse({
      packageId: 'com.acme.crm',
    });
    expect(result.packageId).toBe('com.acme.crm');
    expect(result.createSnapshot).toBe(true);
    expect(result.mergeStrategy).toBe('three-way-merge');
    expect(result.dryRun).toBe(false);
  });

  it('should accept full upgrade request', () => {
    const result = PackageUpgradeRequestSchema.parse({
      packageId: 'com.acme.crm',
      targetVersion: '2.0.0',
      manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '2.0.0', type: 'plugin' },
      createSnapshot: true,
      mergeStrategy: 'keep-custom',
      dryRun: true,
      skipValidation: false,
    });
    expect(result.targetVersion).toBe('2.0.0');
    expect(result.mergeStrategy).toBe('keep-custom');
    expect(result.dryRun).toBe(true);
  });
});

describe('PackageUpgradeResponseSchema', () => {
  it('should accept a successful upgrade response', () => {
    const result = PackageUpgradeResponseSchema.parse({
      success: true,
      data: {
        success: true,
        phase: 'completed',
        snapshotId: 'snap_001',
        plan: {
          packageId: 'com.acme.crm',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          impactLevel: 'medium',
          changes: [
            { type: 'object', name: 'account', changeType: 'modified', summary: 'Added fields' },
          ],
        },
        message: 'Upgrade completed successfully',
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.phase).toBe('completed');
    expect(result.data.snapshotId).toBe('snap_001');
    expect(result.data.plan?.changes).toHaveLength(1);
  });

  it('should accept upgrade response with merge conflicts', () => {
    const result = PackageUpgradeResponseSchema.parse({
      success: true,
      data: {
        success: false,
        phase: 'failed',
        conflicts: [{
          path: 'objects/account/fields/status',
          baseValue: 'active',
          incomingValue: 'enabled',
          customValue: 'custom_active',
        }],
        errorMessage: 'Merge conflicts detected',
      },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.conflicts).toHaveLength(1);
  });
});

// ==========================================
// Resolve Dependencies
// ==========================================

describe('ResolveDependenciesRequestSchema', () => {
  it('should accept a resolve request with manifest', () => {
    const result = ResolveDependenciesRequestSchema.parse({
      manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'plugin' },
      platformVersion: '3.2.0',
    });
    expect(result.platformVersion).toBe('3.2.0');
  });
});

describe('ResolveDependenciesResponseSchema', () => {
  it('should accept a resolution response', () => {
    const result = ResolveDependenciesResponseSchema.parse({
      success: true,
      data: {
        dependencies: [
          { packageId: 'com.acme.core', requiredRange: '^2.0.0', resolvedVersion: '2.1.0', status: 'satisfied' },
          { packageId: 'com.acme.ui', requiredRange: '^1.5.0', resolvedVersion: '1.5.2', status: 'needs_install' },
        ],
        canProceed: true,
        requiredActions: [
          { type: 'install', packageId: 'com.acme.ui', description: 'Install com.acme.ui@1.5.2' },
        ],
        installOrder: ['com.acme.core', 'com.acme.ui', 'com.acme.crm'],
      },
    });
    expect(result.data.canProceed).toBe(true);
    expect(result.data.dependencies).toHaveLength(2);
    expect(result.data.installOrder).toHaveLength(3);
  });

  it('should accept resolution with circular dependencies', () => {
    const result = ResolveDependenciesResponseSchema.parse({
      success: true,
      data: {
        dependencies: [
          { packageId: 'A', requiredRange: '^1.0.0', status: 'conflict', conflictReason: 'Circular dependency' },
        ],
        canProceed: false,
        requiredActions: [
          { type: 'confirm_conflict', packageId: 'A', description: 'Circular dependency detected' },
        ],
        installOrder: [],
        circularDependencies: [['A', 'B', 'A']],
      },
    });
    expect(result.data.canProceed).toBe(false);
    expect(result.data.circularDependencies).toHaveLength(1);
  });
});

// ==========================================
// Upload Artifact
// ==========================================

describe('UploadArtifactRequestSchema', () => {
  it('should accept a valid upload request', () => {
    const result = UploadArtifactRequestSchema.parse({
      artifact: {
        packageId: 'com.acme.crm',
        version: '1.0.0',
        builtAt: '2026-02-01T10:00:00Z',
      },
      sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      releaseNotes: 'Initial release',
    });
    expect(result.artifact.packageId).toBe('com.acme.crm');
  });

  it('should reject invalid SHA256', () => {
    expect(() => UploadArtifactRequestSchema.parse({
      artifact: { packageId: 'test', version: '1.0.0', builtAt: '2026-02-01T10:00:00Z' },
      sha256: 'invalid-hash',
    })).toThrow();
  });
});

describe('UploadArtifactResponseSchema', () => {
  it('should accept a successful upload response', () => {
    const result = UploadArtifactResponseSchema.parse({
      success: true,
      data: {
        success: true,
        artifactRef: {
          url: 'https://marketplace.objectstack.io/artifacts/com.acme.crm/1.0.0.tgz',
          sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          size: 1024000,
          uploadedAt: '2026-02-01T10:00:00Z',
        },
        submissionId: 'sub_001',
        message: 'Artifact uploaded successfully',
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.artifactRef?.sha256).toBeDefined();
    expect(result.data.submissionId).toBe('sub_001');
  });
});

// ==========================================
// Rollback Package
// ==========================================

describe('PackageRollbackRequestSchema', () => {
  it('should accept a rollback request', () => {
    const result = PackageRollbackRequestSchema.parse({
      packageId: 'com.acme.crm',
      snapshotId: 'snap_001',
      rollbackCustomizations: true,
    });
    expect(result.packageId).toBe('com.acme.crm');
    expect(result.snapshotId).toBe('snap_001');
  });

  it('should default rollbackCustomizations to true', () => {
    const result = PackageRollbackRequestSchema.parse({
      packageId: 'com.acme.crm',
      snapshotId: 'snap_001',
    });
    expect(result.rollbackCustomizations).toBe(true);
  });
});

// `PackageRollbackResponseSchema` is RETIRED (#12038 3A) — it declared a
// VERSION rollback against the live COMMIT-rollback route. Its retirement pin
// (runtime namespace probes, the registry-retirement.test.ts pattern) lives in
// the `package-rollback-response retirement` block at the end of this file;
// the live route's true contract is covered in package-lifecycle.test.ts.

// ==========================================
// Uninstall Package
// ==========================================

describe('UninstallPackageApiResponseSchema', () => {
  it('should accept a successful uninstall response', () => {
    const result = UninstallPackageApiResponseSchema.parse({
      success: true,
      data: {
        packageId: 'com.acme.crm',
        success: true,
        message: 'Package uninstalled',
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.packageId).toBe('com.acme.crm');
  });
});

// ==========================================
// Error Codes
// ==========================================

describe('PackageApiErrorCode', () => {
  it('should accept all valid error codes', () => {
    const validCodes = [
      'package_not_found', 'package_already_installed', 'version_not_found',
      'dependency_conflict', 'namespace_conflict', 'platform_incompatible',
      'artifact_invalid', 'checksum_mismatch', 'signature_invalid',
      'upgrade_failed', 'rollback_failed', 'snapshot_not_found', 'upload_failed',
    ];

    validCodes.forEach(code => {
      expect(PackageApiErrorCode.parse(code)).toBe(code);
    });
  });

  it('should reject invalid error code', () => {
    expect(() => PackageApiErrorCode.parse('unknown_error')).toThrow();
  });
});

// ==========================================
// API Contract Registry
// ==========================================

describe('PackageApiContracts', () => {
  it('should have all required endpoints', () => {
    expect(PackageApiContracts.listPackages).toBeDefined();
    expect(PackageApiContracts.getPackage).toBeDefined();
    expect(PackageApiContracts.installPackage).toBeDefined();
    expect(PackageApiContracts.uninstallPackage).toBeDefined();
  });

  it('should have correct HTTP methods', () => {
    expect(PackageApiContracts.listPackages.method).toBe('GET');
    expect(PackageApiContracts.getPackage.method).toBe('GET');
    expect(PackageApiContracts.installPackage.method).toBe('POST');
    expect(PackageApiContracts.uninstallPackage.method).toBe('DELETE');
  });

  it('should have correct paths', () => {
    expect(PackageApiContracts.listPackages.path).toBe('/api/v1/packages');
    expect(PackageApiContracts.getPackage.path).toBe('/api/v1/packages/:packageId');
    // [#18058] REBOUND, not relaxed: this used to pin
    // `/api/v1/packages/install`, a path the composed runtime mounts nowhere.
    // It now pins the door that serves — a bare `POST /api/v1/packages`,
    // distinguished from `listPackages` by method, not by path.
    expect(PackageApiContracts.installPackage.path).toBe('/api/v1/packages');
    expect(PackageApiContracts.installPackage.path).not.toContain('install');
    expect(PackageApiContracts.uninstallPackage.path).toBe('/api/v1/packages/:packageId');
  });

  it('should have input and output schemas on all contracts', () => {
    Object.values(PackageApiContracts).forEach(contract => {
      expect(contract.input).toBeDefined();
      expect(contract.output).toBeDefined();
      expect(contract.method).toBeDefined();
      expect(contract.path).toBeDefined();
    });
  });
});

// ==========================================
// Unmounted contract-map entries removed (#19116)
// ==========================================

describe('the three unmounted `PackageApiContracts` entries are removed', () => {
  // The paths the removed entries bound. Nothing in the composed runtime
  // mounts any of them, and no serving door existed to rebind them onto.
  const UNMOUNTED_PATHS = [
    '/api/v1/packages/upgrade',
    '/api/v1/packages/resolve-dependencies',
    '/api/v1/packages/upload',
  ];

  it('no longer carries the `upgradePackage`, `resolveDependencies` or `uploadArtifact` keys', () => {
    for (const key of ['upgradePackage', 'resolveDependencies', 'uploadArtifact']) {
      expect(Object.prototype.hasOwnProperty.call(PackageApiContracts, key)).toBe(false);
    }
  });

  it('binds no entry, under any key, to one of the three unmounted paths', () => {
    // The whole map, so a phantom cannot come back under a different key.
    const claimants = Object.entries(PackageApiContracts)
      .filter(([, c]) => UNMOUNTED_PATHS.includes(c.path))
      .map(([key]) => key);
    expect(claimants).toEqual([]);
  });

  it('keeps exactly the four entries whose doors serve', () => {
    // Anti-vacuity for the two absence pins above, and the declare-with-mount
    // rule made visible: a new entry lands here only with the mount it names.
    expect(Object.keys(PackageApiContracts).sort()).toEqual([
      'getPackage',
      'installPackage',
      'listPackages',
      'uninstallPackage',
    ]);
  });

  it('leaves the request/response schemas published, bound to no route', async () => {
    // The ruling removed the map entries only; the per-route schemas are a
    // separate question and still resolve from the namespace.
    const ns = (await import('./index')) as unknown as Record<string, unknown>;
    for (const name of [
      'PackageUpgradeRequestSchema',
      'PackageUpgradeResponseSchema',
      'ResolveDependenciesRequestSchema',
      'ResolveDependenciesResponseSchema',
      'UploadArtifactRequestSchema',
      'UploadArtifactResponseSchema',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(ns, name)).toBe(true);
    }
  });
});

// ==========================================
// package-rollback-response retirement (#12038 3A)
// ==========================================

describe('package-rollback-response retirement (ruled: it described the wrong operation on the live path)', () => {
  // Runtime namespace probes, the registry-retirement.test.ts pattern: a
  // removed export cannot be imported by name (would not compile), so the pin
  // asks the namespace object. Anti-vacuity guard: a neighbour that stayed.
  it('`PackageRollbackResponseSchema` is no longer exported from `@objectstack/spec/api`', async () => {
    const api = await import('./index');
    const ns = api as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(ns, 'PackageRollbackResponseSchema')).toBe(false);
    // Anti-vacuity: the sibling that deliberately stayed still resolves.
    expect(Object.prototype.hasOwnProperty.call(ns, 'PackageRollbackRequestSchema')).toBe(true);
  });

  it('`PackageApiContracts` no longer binds any schema to the live commit-rollback path', () => {
    const entries = Object.entries(PackageApiContracts) as Array<[string, { path: string }]>;
    expect('rollbackPackage' in PackageApiContracts).toBe(false);
    // The load-bearing half: no contract-map entry claims the LIVE path the
    // dispatcher serves with `rollbackToPackageCommit` (#12038 §5.2 — the
    // retired entry bound the version-rollback schema to exactly this path).
    const claimants = entries.filter(([, c]) => c.path === '/api/v1/packages/:packageId/rollback');
    expect(claimants).toEqual([]);
    // Anti-vacuity: the map still carries its surviving entries.
    expect(entries.length).toBeGreaterThan(0);
  });
});


// ==========================================
// Manifest STAGES on the installed-package row (#17431 / #14242 road B)
// ==========================================

/**
 * The two stages, as one row each, differing ONLY in `manifest.objects`.
 *
 * Everything else is held equal on purpose: what separates them has to be the
 * stage, so a failure below can only be about the stage.
 */
const LIFECYCLE = { status: 'installed', enabled: true } as const;
const MANIFEST_BASE = {
  id: 'com.acme.stage', namespace: 'stage', version: '1.0.0', type: 'app', scope: 'project',
  name: 'Stage Fixture',
} as const;
/** AUTHORING: `objects` are GLOB PATTERNS. */
const GLOB_ROW = { ...LIFECYCLE, manifest: { ...MANIFEST_BASE, objects: ['./src/objects/*.object.yml'] } };
/** ASSEMBLED: `objects` are object DEFINITIONS — what `registerApp` iterates. */
const ASSEMBLED_ROW = {
  ...LIFECYCLE,
  manifest: { ...MANIFEST_BASE, objects: [{ name: 'stage_lead', fields: { title: { type: 'text' } } }] },
};
/** NEITHER stage: one array carrying both spellings — road C's shape. */
const MIXED_ROW = {
  ...LIFECYCLE,
  manifest: {
    ...MANIFEST_BASE,
    objects: ['./src/objects/*.object.yml', { name: 'stage_lead', fields: { title: { type: 'text' } } }],
  },
};

describe('the two declared manifest stages are DISTINCT, not two names for one shape', () => {
  it('`InstalledPackageSchema` is the AUTHORING stage: globs parse, definitions are refused', () => {
    expect(InstalledPackageSchema.safeParse(GLOB_ROW).success).toBe(true);

    const dark = InstalledPackageSchema.safeParse(ASSEMBLED_ROW);
    expect(dark.success).toBe(false);
    expect(dark.error!.issues.map((i) => i.path.join('.'))).toEqual(['manifest.objects.0']);
  });

  it('`AssembledInstalledPackageSchema` is the ASSEMBLED stage: definitions parse, globs are refused', () => {
    expect(AssembledInstalledPackageSchema.safeParse(ASSEMBLED_ROW).success).toBe(true);

    const dark = AssembledInstalledPackageSchema.safeParse(GLOB_ROW);
    expect(dark.success).toBe(false);
    expect(dark.error!.issues.map((i) => i.path.join('.'))).toEqual(['manifest.objects.0']);
  });

  it('⛔ neither stage was WIDENED to reach the other — each still refuses the other exactly', () => {
    // The pair above already shows it; this states the proposition #14242 ruled
    // on so a future widening of either declaration reddens by name here.
    expect(InstalledPackageSchema.safeParse(ASSEMBLED_ROW).success).toBe(false);
    expect(AssembledInstalledPackageSchema.safeParse(GLOB_ROW).success).toBe(false);
  });
});

describe('`InstalledPackageAtEitherStageSchema` admits both stages and NOTHING else', () => {
  it('parses the authoring row', () => {
    expect(InstalledPackageAtEitherStageSchema.safeParse(GLOB_ROW).success).toBe(true);
  });

  it('parses the assembled row', () => {
    expect(InstalledPackageAtEitherStageSchema.safeParse(ASSEMBLED_ROW).success).toBe(true);
  });

  it('⛔ REFUSES a row belonging to neither stage — this is not road C', () => {
    // Road C would have widened `objects` to `(string | ObjectDef)[]`, which
    // accepts exactly this. A union over two whole CLOSED stages does not: the
    // mixed array parses through neither branch.
    const verdict = InstalledPackageAtEitherStageSchema.safeParse(MIXED_ROW);
    expect(verdict.success).toBe(false);
  });

  it('⛔ still refuses an unknown key INSIDE the manifest, on both branches', () => {
    // `ManifestSchema` is `strictObject` and the assembled body inherits that
    // close, so the union cannot become a hole either stage does not have.
    for (const row of [GLOB_ROW, ASSEMBLED_ROW]) {
      const typo = { ...row, manifest: { ...row.manifest, namesapce: 'stage' } };
      expect(InstalledPackageAtEitherStageSchema.safeParse(typo).success).toBe(false);
    }
  });
});

describe('the set the record stage must RE-DECLARE is MEASURED, never hand-picked', () => {
  /** Does this schema have a JSON Schema form at all? */
  const emits = (schema: unknown): boolean => {
    try {
      z.toJSONSchema(schema as never, { io: 'input' } as never);
      return true;
    } catch {
      return false;
    }
  };

  it('exactly `functions` and `hooks` have no JSON form on the assembled body', () => {
    // The two published response schemas below embed the row, whose manifest is
    // the RECORD stage. Any collection with no JSON form makes them BOTH vanish
    // from `json-schema/api/`, which the build's disappearance ratchet refuses
    // — so the record stage declares exactly this set in its lowered form, and
    // this pin is what keeps the two in step. A new non-serialisable collection
    // reddens HERE, naming itself, rather than unpublishing two responses.
    const shape = (AssembledPackageBodySchema as unknown as { shape: Record<string, unknown> }).shape;
    const noJsonForm = Object.keys(shape).filter((k) => !emits(shape[k]));
    expect(noJsonForm.sort()).toEqual(['functions', 'hooks']);
  });

  it('lit control: the body itself does not emit, the narrowed row does', () => {
    // Without both halves this pin could pass while measuring nothing.
    expect(emits(AssembledPackageBodySchema)).toBe(false);
    expect(emits(ListInstalledPackagesResponseSchema)).toBe(true);
    expect(emits(GetInstalledPackageResponseSchema)).toBe(true);
  });
});

describe('the row\'s manifest is the RECORD stage — a declaration, ⛔ not `z.unknown()`', () => {
  /**
   * What `toRecordManifest` really leaves on a `GET /packages` row: each
   * `functions` declaration MINUS its callable, and a hook whose inline handler
   * is gone. Until #17518 both keys were `z.unknown().optional()` here, i.e.
   * accepted without being checked.
   */
  const RECORD_ROW = {
    ...LIFECYCLE,
    manifest: {
      ...MANIFEST_BASE,
      objects: [{ name: 'stage_lead', fields: { title: { type: 'text' } } }],
      functions: {
        summarizeCompletedTask: { effect: 'pure' },
        sweepProjectHealth: { effect: 'writes' },
      },
      hooks: [{ name: 'on_insert', object: 'stage_lead', events: ['beforeInsert'] }],
    },
  };

  it('parses a row carrying the residual the projection really produces', () => {
    expect(AssembledInstalledPackageSchema.safeParse(RECORD_ROW).success).toBe(true);
    expect(InstalledPackageAtEitherStageSchema.safeParse(RECORD_ROW).success).toBe(true);
  });

  it('parses a row carrying what `objectstack build` lowered', () => {
    const lowered = {
      ...RECORD_ROW,
      manifest: {
        ...RECORD_ROW.manifest,
        functions: { bare: 'bare', declared: { handler: 'declared', effect: 'writes' } },
        hooks: [{ name: 'on_insert', object: 'stage_lead', events: ['beforeInsert'], handler: 'on_insert' }],
      },
    };
    expect(AssembledInstalledPackageSchema.safeParse(lowered).success).toBe(true);
  });

  it('⛔ REFUSES a live callable — a row the registry can never serve', () => {
    // The direction that matters: the two keys moved from "accepts anything" to
    // a declaration, so a value no JSON row can hold is refused by name instead
    // of waved through. ⛔ Never widen either key back to `unknown` to make a
    // payload fit: a row parsing through neither declared stage is a producer
    // defect.
    const live = {
      ...RECORD_ROW,
      manifest: { ...RECORD_ROW.manifest, functions: { sweepProjectHealth: () => 'ran' } },
    };
    const verdict = AssembledInstalledPackageSchema.safeParse(live);
    expect(verdict.success).toBe(false);
    expect(verdict.error!.issues.some((i) => i.path.join('.').startsWith('manifest.functions'))).toBe(true);
  });

  it('⛔ still refuses the AUTHORING spelling of `objects` — the stage boundary did not move', () => {
    expect(AssembledInstalledPackageSchema.safeParse(GLOB_ROW).success).toBe(false);
  });
});

describe('the read-API responses are declared at both stages', () => {
  const envelope = (data: unknown) => ({ success: true, data });

  it('`ListInstalledPackagesResponseSchema` parses a list of either stage', () => {
    for (const row of [GLOB_ROW, ASSEMBLED_ROW]) {
      const verdict = ListInstalledPackagesResponseSchema.safeParse(
        envelope({ packages: [row], total: 1, hasMore: false }),
      );
      expect(verdict.success).toBe(true);
    }
  });

  it('`GetInstalledPackageResponseSchema` parses either stage', () => {
    for (const row of [GLOB_ROW, ASSEMBLED_ROW]) {
      expect(GetInstalledPackageResponseSchema.safeParse(envelope(row)).success).toBe(true);
    }
  });

  it('both responses still refuse a row that is at NEITHER stage', () => {
    expect(ListInstalledPackagesResponseSchema.safeParse(
      envelope({ packages: [MIXED_ROW], total: 1, hasMore: false }),
    ).success).toBe(false);
    expect(GetInstalledPackageResponseSchema.safeParse(envelope(MIXED_ROW)).success).toBe(false);
  });
});

// ==========================================
// #18058 — the install contract names the door that serves, and the shapes it
//          is actually reached with
// ==========================================

/**
 * The card: `PackageInstallRequestSchema` was declared, published and bound to
 * `POST /api/v1/packages/install`, a path nothing mounts, while the door that
 * serves — `POST /api/v1/packages` — had no declared request contract at all.
 * Ruling A (batch #148 item 4) rebinds the contract to the live door and
 * reconciles it to what that door measurably accepts.
 *
 * Every case below is a body a first-party caller really sends, or the
 * published example a reader really copies. ⛔ None is constructed to fit the
 * schema; each names where it was taken from — and where a real caller's body
 * is REFUSED, that is what is pinned, under a name that says so. A fixture
 * edited until it parses is the failure mode this block exists to prevent:
 * it reports agreement between a declaration and traffic that never met.
 */
describe('install contract bound to the live door', () => {
  /** The client SDK's pinned manifest — `packages/client/src/client.test.ts`. */
  const SDK_MANIFEST = { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' };

  /**
   * The published README example — `packages/client/README.md`, the acceptance
   * fixture the ruling names. It is transcribed through the SDK's own wrapping
   * (`index.ts`: `{ manifest, settings, enableOnInstall, ...overwrite }`), so
   * this asserts the body that leaves the process, not a hand-built one.
   */
  const README_MANIFEST = {
    id: 'com.vendor.plugin',
    name: 'Vendor Plugin',
    namespace: 'vendor',
    version: '1.0.0',
    type: 'app',
  };

  it('the contract-map entry names the serving door, with the phantom path gone', () => {
    expect(PackageApiContracts.installPackage.method).toBe('POST');
    expect(PackageApiContracts.installPackage.path).toBe('/api/v1/packages');
    // The whole map, so the phantom cannot come back under another key.
    const paths = Object.values(PackageApiContracts).map((c) => c.path);
    expect(paths.filter((p) => p.includes('/install'))).toEqual([]);
  });

  it('the bound input is the BODY schema, so both declared forms reach it', () => {
    expect(PackageApiContracts.installPackage.input).toBe(PackageInstallBodySchema);
  });

  describe('`overwrite` is declared, so a parse carries it instead of stripping it', () => {
    it('survives the parse with its value intact', () => {
      const verdict = PackageInstallRequestSchema.safeParse({
        manifest: SDK_MANIFEST,
        overwrite: true,
      });
      expect(verdict.success).toBe(true);
      // ⭐ The line this half of the card exists for: before it was declared,
      // this key parsed green and came out GONE — a deliberate re-install
      // silently demoted to a 409.
      expect(verdict.data?.overwrite).toBe(true);
    });

    it('stays optional — the SDK omits it unless asked, and the 409 guard depends on that', () => {
      const verdict = PackageInstallRequestSchema.safeParse({ manifest: SDK_MANIFEST });
      expect(verdict.success).toBe(true);
      expect(verdict.data && 'overwrite' in verdict.data).toBe(false);
    });

    it('is still a boolean — a string `overwrite` is refused, not coerced', () => {
      const verdict = PackageInstallRequestSchema.safeParse({
        manifest: SDK_MANIFEST,
        overwrite: 'true',
      });
      expect(verdict.success).toBe(false);
    });
  });

  describe('the two declared body forms — disjoint, and BOTH closed', () => {
    it('parses the WRAPPED form the client SDK sends', () => {
      const body = { manifest: SDK_MANIFEST, settings: undefined, enableOnInstall: true };
      expect(PackageInstallBodySchema.safeParse(body).success).toBe(true);
    });

    it('parses a COMPLETE manifest posted BARE — the form the door reads as `body.manifest || body`', () => {
      // The bare form's green fixture is a manifest that is complete. The
      // callers that post bare bodies post complete ones too, since PR #20218
      // gave them the `type` they lacked: the block below transcribes them,
      // beside the incomplete bodies they used to post.
      const bare = { id: 'com.acme.crm', name: 'com.acme.crm', namespace: 'crm', version: '1.0.0', type: 'app' };
      expect(PackageInstallBodySchema.safeParse(bare).success).toBe(true);
    });

    it('the two branches are DISJOINT — a wrapped body never falls through to the bare one', () => {
      // `manifest` is not a manifest key and `ManifestSchema` is strict, so the
      // only branch a wrapped body can satisfy is the wrapped one.
      expect(ManifestSchema.safeParse({ manifest: SDK_MANIFEST }).success).toBe(false);
    });

    it('refuses a body that is NEITHER form', () => {
      // A wrapper around something that is not a manifest: fails branch 1 on
      // the manifest's own keys and branch 2 on `manifest` being unknown.
      expect(PackageInstallBodySchema.safeParse({ manifest: { label: 'nope' } }).success).toBe(false);
      expect(PackageInstallBodySchema.safeParse({ label: 'nope' }).success).toBe(false);
    });

    it('the BARE form carries no install options — they are refused, never dropped', () => {
      const verdict = PackageInstallBodySchema.safeParse({ ...SDK_MANIFEST, overwrite: true });
      expect(verdict.success).toBe(false);
    });

    /**
     * ⭐ The WRAPPED branch is CLOSED — an unknown top-level key is refused by
     * name, as the manifest's and the bare form's unknown keys are (decision
     * batch #227 item 3, letter A; ruling record `5856869656`).
     *
     * What this pinned before was the opposite: the wrapped branch was strip
     * mode, so `{ manifest, enabledOnInstall: false }` parsed green with the
     * misspelled key DROPPED, and the door installed the package ENABLED — the
     * caller's explicit `false` inverted. Each refusal is read at BOTH doors of
     * this declaration: the union the install route is bound to, and the
     * wrapped branch alone, whose issue is the one the install door locates
     * and surfaces.
     */
    describe('the WRAPPED branch refuses an unknown top-level key by name', () => {
      /** The wrapped branch's own verdict: one `unrecognized_keys` issue, at the top level, naming the key. */
      function expectRefusedByName(body: Record<string, unknown>, key: string) {
        expect(PackageInstallBodySchema.safeParse(body).success, 'the bound union refuses it').toBe(false);
        const verdict = PackageInstallRequestSchema.safeParse(body);
        expect(verdict.success).toBe(false);
        const issues = verdict.error?.issues ?? [];
        expect(issues).toHaveLength(1);
        expect(issues[0]?.code).toBe('unrecognized_keys');
        expect(issues[0]?.path).toEqual([]);
        expect((issues[0] as { keys?: string[] }).keys).toEqual([key]);
        expect(issues[0]?.message).toContain(`\`${key}\``);
        return issues[0]!.message;
      }

      it('a MISSPELLED option — `enabledOnInstall` — is refused, and the declared key is offered', () => {
        const message = expectRefusedByName({ manifest: SDK_MANIFEST, enabledOnInstall: false }, 'enabledOnInstall');
        // The remedy's named subject: the option the caller meant.
        expect(message).toContain('`enableOnInstall`');
      });

      it('a PRIVATE key — `_source` — is refused by name, not carried and not dropped', () => {
        expectRefusedByName({ manifest: SDK_MANIFEST, _source: 'studio' }, '_source');
      });

      it('an unknown key BESIDE declared options is refused too — the options do not buy it a pass', () => {
        expectRefusedByName(
          { manifest: SDK_MANIFEST, enableOnInstall: false, overwrite: true, bogus: 1 },
          'bogus',
        );
      });
    });

    describe('controls — every declared wrapped body still round-trips', () => {
      /** A value for EVERY declared install option, each one the schema accepts. */
      const DECLARED_OPTIONS = {
        settings: { apiKey: 'abc123' },
        enableOnInstall: false,
        overwrite: true,
        platformVersion: '3.2.0',
        artifactRef: {
          url: 'https://marketplace.objectstack.io/artifacts/com.acme.crm/1.0.0.tgz',
          sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          size: 1024000,
          // Spelled out: the artifact reference DEFAULTS it, and a round-trip
          // fixture must be one the parse hands back unchanged.
          format: 'tgz',
          uploadedAt: '2026-02-01T10:00:00Z',
        },
      };

      it('the fixture names every declared option — read off the shape, never listed by hand', () => {
        const declared = Object.keys(PackageInstallRequestSchema.shape).filter((k) => k !== 'manifest');
        expect(Object.keys(DECLARED_OPTIONS).sort()).toEqual(declared.sort());
      });

      it('`manifest` alone parses green at both doors', () => {
        expect(PackageInstallRequestSchema.safeParse({ manifest: SDK_MANIFEST }).success).toBe(true);
        expect(PackageInstallBodySchema.safeParse({ manifest: SDK_MANIFEST }).success).toBe(true);
      });

      it('`manifest` plus every declared option parses green, each option value carried through', () => {
        const body = { manifest: SDK_MANIFEST, ...DECLARED_OPTIONS };
        const request = PackageInstallRequestSchema.safeParse(body);
        expect(request.error?.issues ?? []).toEqual([]);
        const union = PackageInstallBodySchema.safeParse(body);
        expect(union.error?.issues ?? []).toEqual([]);
        for (const parsed of [request.data, union.data] as Array<Record<string, unknown> | undefined>) {
          for (const [key, value] of Object.entries(DECLARED_OPTIONS)) {
            expect(parsed?.[key], key).toEqual(value);
          }
        }
      });
    });

    it('the BARE branch is closed too — the same unknown key is refused there', () => {
      // `ManifestSchema` is a `strictObject`, so this is a refusal, not a drop.
      expect(PackageInstallBodySchema.safeParse({ ...SDK_MANIFEST, bogus: 1 }).success).toBe(false);
    });
  });

  /**
   * [#18058 F2] The bodies the runtime's own door drives really post — and the
   * bodies they USED to post, which is where the residual lived.
   *
   * These two drives were cited as the evidence for KEEPING the bare form, and
   * an earlier revision transcribed the first of them with `type: 'app'` ADDED
   * under a comment claiming it posted "exactly this" — the one key that
   * decides the parse. They posted no `type` then, so they were pinned here as
   * REFUSED: the measured bare-form senders of the residual. PR #20218 made
   * the door parse the whole body and gave both drives the `type` they lacked,
   * in their own files, so the transcription below now carries it because the
   * drives do. The bodies they used to post stay pinned as refused. ⛔ The
   * remedy was never to relax `ManifestSchema`.
   */
  describe('the measured bare-form senders parse green — the residual they sat in is closed', () => {
    /** The `manifest` helper in `packages/runtime/src/package-door-namespace-conflict-code.test.ts`. */
    const DOOR_DRIVE_CONFLICT = { id: 'com.acme.crm', name: 'com.acme.crm', namespace: 'crm', version: '1.0.0', type: 'app' };
    /**
     * The duplicate-id drive in `packages/runtime/src/domain-handler-registry.test.ts`.
     * Three of its keys were repaired, each by the PR that made the door parse that leg: PR #19326
     * gave it the `version` it lacked (the docblock's clause 1a), PR #19473 replaced its id `pkg-a`,
     * which `MANIFEST_ID_PATTERN` refuses, and PR #20218 gave it the `type` it lacked (clause 1b).
     * The `pkg-a` body is the REVERSED pin beside the drive, answered `400`. This is the body the
     * drive posts: `409` first, then `201` on `?overwrite=true`.
     */
    const DOOR_DRIVE_REGISTRY = { id: 'com.example.pkg-a', name: 'A', version: '1.0.0', type: 'app' };

    /** The body each drive posted before PR #20218: the same manifest, no `type`. */
    const untyped = ({ type: _type, ...rest }: Record<string, unknown>) => rest;

    it('the namespace-conflict drive parses green — it carries `type` since the door parses its whole body', () => {
      expect(PackageInstallBodySchema.safeParse(DOOR_DRIVE_CONFLICT).success).toBe(true);
    });

    it('the domain-handler-registry drive parses green — it carries `type` since the door parses its whole body', () => {
      expect(PackageInstallBodySchema.safeParse(DOOR_DRIVE_REGISTRY).success).toBe(true);
    });

    it('the missing `type` is what decided it, for BOTH drives — the registry drive\'s old id is refused on its own', () => {
      // The two green parses above are the controls: these bodies differ from
      // them by the one key, so each refusal is a measurement of the
      // MANIFEST's required keys rather than of the bare branch existing at all.
      expect(PackageInstallBodySchema.safeParse(untyped(DOOR_DRIVE_CONFLICT)).success).toBe(false);
      expect(PackageInstallBodySchema.safeParse(untyped(DOOR_DRIVE_REGISTRY)).success).toBe(false);
      // ⭐ Until PR #19473 the registry drive posted `pkg-a`, which
      // `MANIFEST_ID_PATTERN` has refused since #17534 (PR #18319), so
      // completing its keys was not sufficient and this case pinned the
      // refusal. PR #19473 made the door parse the id leg as well, so the door
      // answers that body `400` (the REVERSED pin beside the drive), and it
      // repaired the drive's id. ⛔ The old reading is kept, pointed at the old
      // body: refused on the id alone (the lit control is the green parse
      // above, the same body with the drive's current id).
      expect(PackageInstallBodySchema.safeParse({ ...DOOR_DRIVE_REGISTRY, id: 'pkg-a' }).success).toBe(false);
    });

    /**
     * Bodies the door answered `201` to while this declaration refused them — the residual, one
     * body per class: 1b (the two drives' old bodies), 2, 4 and 3. Every one is CLOSED: since
     * PR #20218 the door parses the whole body through this declaration and answers each `400`.
     */
    const CLOSED_RESIDUALS: ReadonlyArray<Record<string, unknown>> = [
      untyped(DOOR_DRIVE_CONFLICT),
      untyped(DOOR_DRIVE_REGISTRY),
      { ...SDK_MANIFEST, label: 'an unknown key on the bare form' },
      { ...SDK_MANIFEST, enableOnInstall: false },
      { manifest: SDK_MANIFEST, enableOnInstall: 'false' },
      { manifest: SDK_MANIFEST, overwrite: 'true' },
    ];

    it('the declaration refuses every one — and so does the door, which parses the whole body: no residual is left', () => {
      // Pinned as prose-with-a-parse rather than a live HTTP drive: the door
      // lives in `@objectstack/runtime`, which this package cannot import.
      // `packages/runtime/src/domains/packages-install-body-contract.test.ts`
      // is where the door's `400`s are measured: its §0 holds the door to this
      // declaration, and §1–§4 drive one class each.
      for (const residual of CLOSED_RESIDUALS) {
        expect(PackageInstallBodySchema.safeParse(residual).success).toBe(false);
      }
    });

    it('✅ clause 1a is CLOSED — every closed-class body carries a `version` the declaration accepts, so each is refused for its OWN class', () => {
      // PR #19326 made the door parse `ManifestSchema.shape.version` by
      // reference: a manifest missing `version` answers `400` /
      // `VALIDATION_ERROR` there now and installs nothing. The door-side pin is
      // §1 of `packages/runtime/src/domains/packages-install-manifest-version.test.ts`,
      // cited rather than repeated — this package cannot import the door. The
      // door answers that leg AHEAD of the whole-body parse, so a versionless
      // body in the list above would measure the `version` leg rather than
      // the class it is listed for. The registry drive's first transcription,
      // `{ id: 'pkg-a', name: 'A' }`, was such a body.
      // Clause 1b is closed too: the drives carry `type` now (pinned green
      // above), and the list holds the bodies they used to post.
      for (const residual of CLOSED_RESIDUALS) {
        const manifest = ('manifest' in residual ? residual.manifest : residual) as { version?: unknown };
        expect(ManifestSchema.shape.version.safeParse(manifest.version).success).toBe(true);
      }
      // Lit control — the check bites: a manifest with no `version` key reads
      // `undefined` above, and the declaration refuses that.
      expect(ManifestSchema.shape.version.safeParse(undefined).success).toBe(false);
    });

    it('⭐ the reverse-domain id rule closed the one spelling that ran the OTHER way — a whitespace-only `id` is refused HERE now, not only by the door', () => {
      // What this pinned before: `handlePackages` trims before keying and
      // refuses an empty id, while this declaration ADMITTED `'   '` — the one
      // measured class where the declaration was WIDER than the door.
      // `ManifestSchema.id` now carries `MANIFEST_ID_PATTERN`, which no
      // whitespace-only string matches, so the declaration refuses it first and
      // the two faces agree on this spelling.
      expect(PackageInstallBodySchema.safeParse({ manifest: { ...SDK_MANIFEST, id: '   ' } }).success).toBe(false);
      // Lit control — the id is what decided it: the same wrapped body with the
      // fixture's own conforming id parses green.
      expect(PackageInstallBodySchema.safeParse({ manifest: SDK_MANIFEST }).success).toBe(true);
      // This direction closed first. The classes pinned above, which ran the
      // other way (bodies the door answered `201` while this declaration
      // refused them), closed with PR #20218, so no measured class is answered
      // differently by the two faces any more. The door refuses this body on
      // its trimmed-empty id (`Package id is required`).
    });
  });

  describe('the two acceptance fixtures the ruling names', () => {
    it('the published README example parses green, wrapped exactly as the SDK wraps it', () => {
      const body = {
        manifest: README_MANIFEST,
        settings: undefined,
        enableOnInstall: undefined,
      };
      const verdict = PackageInstallBodySchema.safeParse(body);
      expect(verdict.error?.issues ?? []).toEqual([]);
      expect(verdict.success).toBe(true);
    });

    it('the README example ALSO parses as the bare form, which is how the door reads it', () => {
      expect(PackageInstallBodySchema.safeParse(README_MANIFEST).success).toBe(true);
    });

    it('the README example as it was WRITTEN is still refused — the fixture is not vacuous', () => {
      // The pre-#18058 text: no `id`, no `type`, and a `label` key the manifest
      // surface refuses by name. If this ever turns green the manifest contract
      // has been relaxed, not the example fixed.
      const asShipped = { name: 'vendor_plugin', label: 'Vendor Plugin', version: '1.0.0' };
      expect(PackageInstallBodySchema.safeParse({ manifest: asShipped }).success).toBe(false);
      expect(PackageInstallBodySchema.safeParse(asShipped).success).toBe(false);
    });

    it('both client-SDK pinned calls parse green', () => {
      // `client.test.ts`: `install(MANIFEST, { enableOnInstall: true })` …
      expect(PackageInstallBodySchema.safeParse({
        manifest: SDK_MANIFEST, settings: undefined, enableOnInstall: true,
      }).success).toBe(true);
      // … and `install(MANIFEST, { overwrite: true })`.
      expect(PackageInstallBodySchema.safeParse({
        manifest: SDK_MANIFEST, settings: undefined, enableOnInstall: undefined, overwrite: true,
      }).success).toBe(true);
    });
  });

  it('the manifest slot names ONE stage — the authoring one this wire carries', () => {
    // The assembled stage reaches the packages table through
    // `ObjectQL.registerApp`, never over this door, so the write contract names
    // one stage where the read contract names two. Assembled `objects` are
    // definitions, not globs, and this schema says so by refusing them.
    const assembled = { ...SDK_MANIFEST, objects: [{ name: 'crm_account', fields: {} }] };
    expect(PackageInstallBodySchema.safeParse({ manifest: assembled }).success).toBe(false);
    // The authoring spelling of the same key parses.
    expect(PackageInstallBodySchema.safeParse({
      manifest: { ...SDK_MANIFEST, objects: ['objects/**/*.object.ts'] },
    }).success).toBe(true);
  });
});
