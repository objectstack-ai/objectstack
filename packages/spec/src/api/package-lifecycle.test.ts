// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Conformance coverage for the #12038 package lifecycle response contracts —
 * the #3877 rule's other half: no ledger row names a schema without a suite
 * parsing a verbatim-shaped capture through it (the AuditMetaItemResponse
 * pattern in `protocol.test.ts`). Each capture below is handwritten from the
 * producer's declared return, NOT lifted from the client-test mocks the
 * #12038 survey found inventing shapes these routes never answered (§3b).
 */

import { describe, it, expect } from 'vitest';
import {
  DiscardPackageDraftsResponseSchema,
  ListPackageCommitsResponseSchema,
  RevertPackageCommitResponseSchema,
  RollbackToPackageCommitResponseSchema,
  PackageExportManifestSchema,
  PackageExportBundleSchema,
  ReassignOrphanedMetadataResponseSchema,
  DuplicatePackageResponseSchema,
  PackagePublishResultSchema,
  EnsureCustomizationPackageRequestSchema,
  EnsureCustomizationPackageResponseSchema,
  GetPackageCustomizationsResponseSchema,
} from './package-lifecycle.zod';
import { PackagePublishResultSchema as SystemPackagePublishResultSchema } from '../system/metadata-persistence.zod';
import { CONNECTOR_CREDENTIAL_MAP_PATHS, redactConnectorItem } from '../integration/connector-credential-redaction';
import { InstalledPackageSourceSchema } from '../kernel/package-registry.zod';

describe('the ruled re-export of PackagePublishResultSchema into the `/api` namespace', () => {
  it('is the SAME declaration as the `/system` original — a re-export, never a second copy', () => {
    expect(PackagePublishResultSchema).toBe(SystemPackagePublishResultSchema);
  });

  it('parses a verbatim-shaped capture of a real `publishPackage` return and PRESERVES it', () => {
    const realResponse = {
      success: true,
      packageId: 'com.example.crm',
      version: 4,
      publishedAt: '2026-08-27T10:03:12.000Z',
      itemsPublished: 23,
    };
    const result = PackagePublishResultSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });
});

describe('DiscardPackageDraftsResponseSchema declares the discard-drafts body', () => {
  /** A verbatim-shaped capture of a real `discardPackageDrafts` return (one failure). */
  const realResponse = {
    success: false,
    discardedCount: 2,
    failedCount: 1,
    discarded: [
      { type: 'view', name: 'account_pipeline' },
      { type: 'object', name: 'lead_source' },
    ],
    failed: [{ type: 'flow', name: 'lead_convert', error: 'item is locked', code: 'ITEM_LOCKED' }],
  };

  it('parses the real discard report and PRESERVES every member', () => {
    const result = DiscardPackageDraftsResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('the honest-empty report parses — nothing to discard is a declared, legal body', () => {
    const empty = { success: true, discardedCount: 0, failedCount: 0, discarded: [], failed: [] };
    expect(DiscardPackageDraftsResponseSchema.safeParse(empty).success).toBe(true);
  });
});

describe('ListPackageCommitsResponseSchema declares the commit timeline body', () => {
  /** A verbatim-shaped capture of the HANDLER's `{ commits }` payload (the wrapper is the handler's, not the protocol's). */
  const realResponse = {
    commits: [
      {
        id: 'cmt_02',
        operation: 'revert' as const,
        message: 'Revert broken publish',
        actor: 'admin@objectos.ai',
        parentCommitId: 'cmt_01',
        itemCount: 1,
        items: [{ type: 'view', name: 'account_pipeline', existedBefore: true, prevVersion: 3 }],
        createdAt: '2026-08-27T11:41:00.000Z',
      },
      {
        id: 'cmt_01',
        operation: 'apply' as const,
        aiModel: 'claude',
        itemCount: 2,
        items: [
          { type: 'view', name: 'account_pipeline', existedBefore: false, prevVersion: null },
          { type: 'object', name: 'lead_source', existedBefore: true, prevVersion: 1 },
        ],
      },
    ],
  };

  it('parses the real timeline and PRESERVES every member', () => {
    const result = ListPackageCommitsResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('keeps the operation vocabulary closed', () => {
    const bad = {
      commits: [{ ...realResponse.commits[1], operation: 'merge' }],
    };
    expect(ListPackageCommitsResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('the honest-empty timeline parses — {commits: []} is a declared, legal body', () => {
    expect(ListPackageCommitsResponseSchema.safeParse({ commits: [] }).success).toBe(true);
  });

  it('[#23073] two languages of one email_template are two items told apart by `member`, which the parse keeps', () => {
    const item = (member: string, existedBefore: boolean) => ({
      type: 'email_template', name: 'acme.welcome', member, existedBefore, prevVersion: existedBefore ? 2 : null,
    });
    const timeline = {
      commits: [{
        id: 'cmt_03',
        operation: 'apply' as const,
        itemCount: 3,
        items: [item('en-US', true), item('zh-CN', false), realResponse.commits[0]!.items[0]!],
      }],
    };
    const result = ListPackageCommitsResponseSchema.safeParse(timeline);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(timeline);
    expect(result.data.commits[0]!.items.map((i) => i.member)).toEqual(['en-US', 'zh-CN', undefined]);
    // A type whose identity is its name alone carries no `member` key at all.
    expect(result.data.commits[0]!.items[2]).not.toHaveProperty('member');
  });
});

describe('RevertPackageCommitResponseSchema declares the revert body', () => {
  /** A verbatim-shaped capture of a real `revertCommit` return. */
  const realResponse = {
    success: true,
    revertedCount: 2,
    failedCount: 0,
    reverted: [
      { type: 'view', name: 'account_pipeline', action: 'restored' as const },
      { type: 'object', name: 'lead_source', action: 'removed' as const },
    ],
    failed: [],
    revertCommitId: 'cmt_03',
  };

  it('parses the real revert report and PRESERVES every member', () => {
    const result = RevertPackageCommitResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('keeps the action vocabulary closed', () => {
    const bad = { ...realResponse, reverted: [{ type: 'view', name: 'v', action: 'skipped' }] };
    expect(RevertPackageCommitResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RollbackToPackageCommitResponseSchema declares the COMMIT-rollback body (ruled: authored once the wrong-operation schema was retired)', () => {
  /** A verbatim-shaped capture of a real `rollbackToPackageCommit` return (one commit stuck). */
  const realResponse = {
    success: false,
    revertedCommits: ['cmt_05', 'cmt_04'],
    failed: [{ commitId: 'cmt_03', error: 'commit not found' }],
  };

  it('parses the real rollback report and PRESERVES every member', () => {
    const result = RollbackToPackageCommitResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('the clean rollback parses — every commit reverted, nothing failed', () => {
    const clean = { success: true, revertedCommits: ['cmt_05'], failed: [] };
    expect(RollbackToPackageCommitResponseSchema.safeParse(clean).success).toBe(true);
  });

  it('does NOT declare the retired version-rollback vocabulary', () => {
    // The retired `PackageRollbackResponseSchema` declared `restoredVersion` —
    // a key this route has never answered. The declared key set is pinned so
    // the wrong-operation shape cannot quietly return under the new name.
    const parsed = RollbackToPackageCommitResponseSchema.safeParse({
      success: true,
      revertedCommits: [],
      failed: [],
      restoredVersion: '1.0.0',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('restoredVersion' in (parsed.data as object)).toBe(false);
  });
});

describe('PackageExportManifestSchema declares the seven fixed keys and stays open', () => {
  /** A verbatim-shaped capture of a real `assemblePackageManifest` return. */
  const realResponse = {
    id: 'com.example.crm',
    name: 'example-crm',
    version: '2.1.0',
    label: 'Example CRM',
    objects: [{ name: 'customer', label: 'Customer', fields: { name: { type: 'text' } } }],
    views: [{ name: 'customer_list', object: 'customer', type: 'grid' }],
  };

  it('parses the real manifest and PRESERVES every member — registry-derived keys included', () => {
    const result = PackageExportManifestSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('requires only the three identity keys — a manifest with no items still parses', () => {
    const bare = { id: 'com.example.empty', name: 'empty', version: '1.0.0' };
    expect(PackageExportManifestSchema.safeParse(bare).success).toBe(true);
  });

  it('refuses a manifest missing its identity — the fixed keys are genuinely pinned', () => {
    expect(PackageExportManifestSchema.safeParse({ objects: [] }).success).toBe(false);
  });
});

describe('PackageExportManifestSchema.withheldMaps names each map the export withheld whole (#28640 ruling ③A)', () => {
  const identity = { id: 'com.example.crm', name: 'example-crm', version: '2.1.0' };
  /** The connector item as the export writes it: served, so its header map is already absent. */
  const servedConnector = { name: 'stripe', label: 'Stripe', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://api.stripe.example' } };

  it('parses an export that lists a withheld map and PRESERVES it — the item body stays as served', () => {
    const manifest = {
      ...identity,
      connectors: [servedConnector],
      withheldMaps: [{ type: 'connector', name: 'stripe', path: 'providerConfig.headers' }],
    };
    const result = PackageExportManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(manifest);
  });

  it('is declared ahead of its producer: the describe opens with the planned marker and names the ADR, never a tracker id', () => {
    const description = PackageExportManifestSchema.shape.withheldMaps.description ?? '';
    expect(description).toMatch(/^\[PLANNED — not yet served\] /);
    expect(description).toContain('ADR-0049');
    expect(description).not.toMatch(/#\d{3,}/);
  });

  it('is optional — an export that withheld nothing, or one from before the key, still parses', () => {
    expect(PackageExportManifestSchema.safeParse(identity).success).toBe(true);
  });

  it('spells each position exactly as the connector redactor reports it — the same four maps, nothing else', () => {
    const declared = [...PackageExportManifestSchema.shape.withheldMaps.unwrap().element.shape.path.options];
    // The redactor's own list of the maps it withholds whole …
    expect(declared).toEqual(CONNECTOR_CREDENTIAL_MAP_PATHS.map((p) => p.join('.')));
    // … and the spelling its `redactedKeys` names them by, read off a real redaction.
    const map = { Authorization: 'x' };
    const { redactedKeys } = redactConnectorItem({
      ...servedConnector,
      providerConfig: { headers: map, defaultHeaders: map, transport: { headers: map, env: { TOKEN: 'x' } } },
    });
    expect([...redactedKeys].sort()).toEqual([...declared].sort());
  });

  it.each([
    ['a position outside the four', { type: 'connector', name: 'stripe', path: 'auth.token' }],
    ['a position spelled without its providerConfig root', { type: 'connector', name: 'stripe', path: 'defaultHeaders' }],
    ['a type no export withholds a map of yet', { type: 'webhook', name: 'hook', path: 'providerConfig.headers' }],
    ['a list of the withheld header names — maps are withheld whole', { type: 'connector', name: 'stripe', path: 'providerConfig.headers', keys: ['Authorization'] }],
    ['an entry with no item name', { type: 'connector', path: 'providerConfig.headers' }],
  ])('refuses %s', (_label, entry) => {
    expect(PackageExportManifestSchema.safeParse({ ...identity, withheldMaps: [entry] }).success).toBe(false);
  });
});

describe('PackageExportBundleSchema declares the whole-deployment export as composed per-package exports (#28914)', () => {
  /**
   * The bundle the card's done criteria name: a base, its `.custom` pair and a
   * third package that extends the base, dependencies first. Each entry is
   * shaped as `GET /packages/:id/export` answers it — the pair carries its
   * overriding item with the `overrides` block (ADR-0146 D8 item 3), and the
   * connector keeps its `credentialRef` as the reference it is.
   */
  const bundle = {
    packages: [
      {
        id: 'com.example.crm',
        name: 'example-crm',
        version: '2.1.0',
        label: 'Example CRM',
        objects: [{ name: 'crm_customer', label: 'Customer', fields: { name: { type: 'text' } } }],
        views: [{ name: 'crm_customer_list', object: 'crm_customer', type: 'grid' }],
        connectors: [{
          name: 'crm_vendor',
          label: 'Vendor',
          type: 'api',
          provider: 'openapi',
          providerConfig: { spec: 'https://vendor.example.com/openapi.json' },
          auth: {
            type: 'oauth2',
            grant: 'client_credentials',
            tokenUrl: 'https://vendor.example.com/oauth/token',
            clientId: 'client-123',
            credentialRef: 'VENDOR_CLIENT_SECRET',
          },
        }],
      },
      {
        id: 'com.example.crm.custom',
        name: 'com.example.crm.custom',
        version: '1.0.0',
        views: [{
          name: 'crm_customer_list',
          object: 'crm_customer',
          type: 'grid',
          overrides: { package: 'com.example.crm', basedOn: '2.1.0' },
        }],
      },
      {
        id: 'com.example.revenue',
        name: 'example-revenue',
        version: '1.0.0',
        objectExtensions: [{ extend: 'crm_customer', fields: { revenue_tier: { type: 'text' } } }],
      },
    ],
  };

  it('parses the bundle and PRESERVES every entry, in the order listed', () => {
    const result = PackageExportBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(bundle);
    expect(result.data.packages.map((entry) => entry.id)).toEqual([
      'com.example.crm',
      'com.example.crm.custom',
      'com.example.revenue',
    ]);
  });

  it('judges each entry by THE per-package export schema — composed, never a second copy', () => {
    expect(PackageExportBundleSchema.shape.packages.element).toBe(PackageExportManifestSchema);
    const nameless = { packages: [bundle.packages[0], { objects: [] }] };
    const result = PackageExportBundleSchema.safeParse(nameless);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['packages.1.id', 'packages.1.name', 'packages.1.version']),
    );
  });

  it('parses an empty bundle — a deployment that holds only platform packages', () => {
    expect(PackageExportBundleSchema.safeParse({ packages: [] }).success).toBe(true);
  });

  it('requires `packages` — an answer with no list is not a bundle', () => {
    const result = PackageExportBundleSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['packages']);
  });

  it('is strict at the top level — a member the door starts serving is a change here first', () => {
    const result = PackageExportBundleSchema.safeParse({ ...bundle, cycles: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
    expect((result.error.issues[0] as { keys?: string[] }).keys).toEqual(['cycles']);
  });

  // Declared before it is served (ADR-0049): no runtime mounts
  // `GET /packages/export` until the server slice of #28914 lands. That
  // change drops the marker, adds the route's ledger row and flips this test.
  it('is PLANNED until a runtime serves the route: the describe says so, naming no tracker id', () => {
    const description = PackageExportBundleSchema.description ?? '';
    expect(description).toMatch(/^\[PLANNED — not yet served\] /);
    expect(description).toContain('ADR-0049');
    expect(description).toContain('no runtime serves `GET /packages/export` yet');
    // Customer-facing prose carries no tracker id (check:doc-authoring); the slice is named in the comments.
    expect(description).not.toMatch(/#\d{3,}/);
  });

  // Which packages the door selects is read off the registry row's `source`
  // (InstalledPackageSourceSchema), never derived from `manifest.scope`: the
  // registry's own rule, and the runtime's #14375 correction of the same
  // derivation. Both describes state the selection and the missing enabled state.
  it('selects by the registry row\'s `source`, never by `manifest.scope`, and says it carries no enabled state', () => {
    const packagesDescription = PackageExportBundleSchema.shape.packages.description ?? '';
    const description = PackageExportBundleSchema.description ?? '';
    for (const text of [packagesDescription, description]) {
      expect(text).toContain('`source`');
      expect(text).toContain('`code`');
      expect(text).not.toMatch(/scope/);
      expect(text).toContain('enabled');
    }
    expect(InstalledPackageSourceSchema.options).toContain('code');
  });
});

describe('ReassignOrphanedMetadataResponseSchema declares the adopt-orphans body', () => {
  /** A verbatim-shaped capture of a real `reassignOrphanedMetadata` return. */
  const realResponse = {
    success: true,
    reassignedCount: 2,
    reassigned: [
      { type: 'view', name: 'orphan_view' },
      { type: 'flow', name: 'orphan_flow' },
    ],
    targetPackageId: 'com.example.crm',
  };

  it('parses the real adoption report and PRESERVES every member', () => {
    const result = ReassignOrphanedMetadataResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('the honest-empty report parses — no orphans to adopt is a declared, legal body', () => {
    const empty = { success: true, reassignedCount: 0, reassigned: [], targetPackageId: 'com.example.crm' };
    expect(ReassignOrphanedMetadataResponseSchema.safeParse(empty).success).toBe(true);
  });
});

describe('DuplicatePackageResponseSchema declares the duplicate body', () => {
  /** A verbatim-shaped capture of a real `duplicatePackage` return (one copy failure). */
  const realResponse = {
    success: false,
    copiedCount: 1,
    failedCount: 1,
    targetPackageId: 'com.example.crm_copy',
    copied: [{ type: 'object', name: 'customer' }],
    failed: [{ type: 'view', name: 'customer_list', error: 'name collision in target' }],
  };

  it('parses the real duplicate report and PRESERVES every member', () => {
    const result = DuplicatePackageResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('declares the OPERATION verdict at `success` — the envelope-vs-payload `success` confusion has a declared answer', () => {
    // On the wire this payload rides the dispatcher envelope; the envelope's
    // `success` is transport-level and true even here. The schema declares the
    // payload's own verdict so a consumer reading the declared shape reads the
    // right key.
    const result = DuplicatePackageResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { success: boolean }).success).toBe(false);
  });
});

describe('EnsureCustomizationPackageRequestSchema declares the ensure door\'s one input (ADR-0146 D3)', () => {
  it('admits the base package id', () => {
    const request = { basePackageId: 'com.acme.crm' };
    expect(EnsureCustomizationPackageRequestSchema.parse(request)).toEqual(request);
  });

  it('refuses a key it does not declare — the pair\'s namespace and range are derived, never requested', () => {
    expect(EnsureCustomizationPackageRequestSchema.safeParse({ basePackageId: 'com.acme.crm', namespace: 'mine' }).success).toBe(false);
    expect(EnsureCustomizationPackageRequestSchema.safeParse({ basePackageId: 'com.acme.crm', dependencyRange: '*' }).success).toBe(false);
  });

  it('requires the base package id', () => {
    expect(EnsureCustomizationPackageRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('EnsureCustomizationPackageResponseSchema declares the ensure door\'s answer', () => {
  /** A verbatim-shaped capture of a real `ensureCustomizationPackage` return (the call that created the pair). */
  const realResponse = {
    basePackageId: 'com.acme.crm',
    packageId: 'com.acme.crm.custom',
    namespace: 'crm_custom',
    dependencyRange: '^3',
    created: true,
    writable: true,
  };

  it('parses the real answer and PRESERVES every member', () => {
    const result = EnsureCustomizationPackageResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(realResponse);
  });

  it('requires every member — an answer without `created` cannot say whether this call made the pair', () => {
    for (const key of Object.keys(realResponse)) {
      const partial: Record<string, unknown> = { ...realResponse };
      delete partial[key];
      expect(EnsureCustomizationPackageResponseSchema.safeParse(partial).success, key).toBe(false);
    }
  });
});

describe('GetPackageCustomizationsResponseSchema.contributions: the entry shape is per kind (ADR-0029 D7, ADR-0146 D3)', () => {
  const CONTRIBUTOR = 'com.example.acme-sync';
  const FIELD = { kind: 'field', object: 'crm_account', name: 'acme_sync_id', packageId: CONTRIBUTOR };
  const FLOW = { kind: 'flow', object: 'crm_account', name: 'acme_account_sync', packageId: CONTRIBUTOR };
  const NAV_IN_GROUP = { kind: 'nav', app: 'crm', group: 'group_service', name: 'nav_acme_sync', packageId: CONTRIBUTOR };
  const NAV_TOP_LEVEL = { kind: 'nav', app: 'crm', name: 'nav_acme_console', packageId: CONTRIBUTOR };

  /** A whole answer around `contributions`, its count derived the way the producer derives it. */
  const answer = (contributions: unknown[]) => ({
    packageId: 'com.acme.crm',
    overrides: [],
    extensions: [],
    switchedOff: [],
    contributions,
    counts: { overrides: 0, extensions: 0, switchedOff: 0, contributions: contributions.length },
  });

  /** The single issue a refused answer carries, by code and path. */
  const refusalOf = (contributions: unknown[]) => {
    const result = GetPackageCustomizationsResponseSchema.safeParse(answer(contributions));
    expect(result.success).toBe(false);
    return result.success ? [] : result.error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      keys: (issue as { keys?: string[] }).keys,
    }));
  };

  it('CONTROL: a field and a flow entry parse and are PRESERVED, exactly as before the nav kind', () => {
    const served = answer([FIELD, FLOW]);
    const result = GetPackageCustomizationsResponseSchema.safeParse(served);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
    if (result.success) expect(result.data).toEqual(served);
  });

  it('CONTROL: a field entry still requires its `object`', () => {
    const { object: _dropped, ...noObject } = FIELD;
    expect(refusalOf([noObject])).toEqual([{ code: 'invalid_type', path: ['contributions', 0, 'object'], keys: undefined }]);
  });

  it('a nav entry naming the group its contribution targets parses and is PRESERVED', () => {
    const served = answer([FIELD, NAV_IN_GROUP]);
    const result = GetPackageCustomizationsResponseSchema.safeParse(served);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
    if (result.success) expect(result.data).toEqual(served);
  });

  it('a nav entry contributed to the app\'s top level has no group, and none is invented', () => {
    const result = GetPackageCustomizationsResponseSchema.safeParse(answer([NAV_TOP_LEVEL]));
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
    if (result.success) {
      expect(result.data.contributions).toEqual([NAV_TOP_LEVEL]);
      expect('group' in result.data.contributions[0]).toBe(false);
    }
  });

  it('a nav entry carrying `object` is refused: the nav shape is on an app, never an object', () => {
    expect(refusalOf([{ ...NAV_IN_GROUP, object: 'crm_account' }]))
      .toEqual([{ code: 'unrecognized_keys', path: ['contributions', 0], keys: ['object'] }]);
  });

  it('a field or flow entry carrying `app` or `group` is refused: those shapes are on an object', () => {
    expect(refusalOf([{ ...FIELD, app: 'crm' }]))
      .toEqual([{ code: 'unrecognized_keys', path: ['contributions', 0], keys: ['app'] }]);
    expect(refusalOf([{ ...FLOW, group: 'group_service' }]))
      .toEqual([{ code: 'unrecognized_keys', path: ['contributions', 0], keys: ['group'] }]);
  });

  it('a nav entry requires its app, its item id and its package', () => {
    for (const key of ['app', 'name', 'packageId'] as const) {
      const partial: Record<string, unknown> = { ...NAV_IN_GROUP };
      delete partial[key];
      expect(refusalOf([partial]), key).toEqual([{ code: 'invalid_type', path: ['contributions', 0, key], keys: undefined }]);
    }
  });

  it('a kind outside field, flow and nav is still refused', () => {
    const issues = refusalOf([{ ...FIELD, kind: 'action' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'invalid_union', path: ['contributions', 0, 'kind'] });
  });
});

describe('the `nav` kind of `contributions` is declared ahead of its producer (ADR-0049)', () => {
  type Described = { description?: string };
  const member = (GetPackageCustomizationsResponseSchema as unknown as {
    shape: { contributions: Described & { element: { options: Described[] } } };
  }).shape.contributions;
  const [objectArm, navArm] = member.element.options;

  it('the nav arm\'s describe opens with the planned marker and names the ADR, never a tracker id', () => {
    expect(navArm.description).toMatch(/^\[PLANNED — not yet served\] /);
    expect(navArm.description).toContain('ADR-0049');
    expect(navArm.description).not.toMatch(/#\d{3,}/);
  });

  it('the member and the field / flow arm say the nav kind is not yet served, and the field / flow arm carries no marker', () => {
    expect(member.description).toContain('not yet served');
    expect(objectArm.description).not.toMatch(/PLANNED/);
    expect(member.description).not.toMatch(/#\d{3,}/);
  });

  it('the schema-level describe says the navigation items are not yet served, so serving them drops that too', () => {
    expect(GetPackageCustomizationsResponseSchema.description).toContain('not yet served');
  });

  it('the nav arm says an item with no id (a separator may omit it) is not an entry: `name` is required', () => {
    expect(navArm.description).toContain('An item that declares no `id` (a separator may omit it) has no `name` to give and is not an entry.');
    const { name: _dropped, ...noName } = { kind: 'nav', app: 'crm', name: 'nav_sep', packageId: 'com.example.acme-sync' };
    expect(GetPackageCustomizationsResponseSchema.shape.contributions.element.safeParse(noName).success).toBe(false);
  });
});

describe('PackageExportManifestSchema declares the install-manifest keys an install of the export decides by', () => {
  const identity = { id: 'com.example.crm.custom', name: 'example-crm-custom', version: '0.1.0' };
  /** A `.custom` pair's export, as `assemblePackageManifest` writes it from the pair's registry row. */
  const pairExport = {
    ...identity,
    namespace: 'crm_custom',
    dependencies: { 'com.example.crm': '^1' },
    dashboards: [{ name: 'crm_board', label: 'Board', overrides: { package: 'com.example.crm', basedOn: '2.1.0' } }],
  };

  it('parses a pair\'s export and PRESERVES its namespace and its base edge', () => {
    const result = PackageExportManifestSchema.safeParse(pairExport);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(pairExport);
  });

  it('both are optional: an export of a package whose row declares neither still parses', () => {
    expect(PackageExportManifestSchema.safeParse(identity).success).toBe(true);
  });

  it('each is the install manifest\'s own declaration, refusing what an install would refuse', () => {
    expect(PackageExportManifestSchema.safeParse({ ...identity, namespace: '1crm' }).success).toBe(false);
    expect(PackageExportManifestSchema.safeParse({ ...identity, namespace: 'Crm' }).success).toBe(false);
    expect(PackageExportManifestSchema.safeParse({ ...identity, dependencies: { 'com.example.crm': 1 } }).success).toBe(false);
    expect(PackageExportManifestSchema.safeParse({ ...identity, dependencies: ['com.example.crm'] }).success).toBe(false);
  });

  it('each describe says where the value comes from and why an install needs it, citing no tracker id', () => {
    const { namespace, dependencies } = PackageExportManifestSchema.shape;
    expect(namespace.description).toContain('registry row');
    expect(dependencies.description).toContain('ADR-0141 D5');
    expect(dependencies.description).toContain('ADR-0146 D2');
    for (const d of [namespace.description, dependencies.description]) expect(d).not.toMatch(/#\d{3,}/);
  });
});
