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
  ReassignOrphanedMetadataResponseSchema,
  DuplicatePackageResponseSchema,
  PackagePublishResultSchema,
} from './package-lifecycle.zod';
import { PackagePublishResultSchema as SystemPackagePublishResultSchema } from '../system/metadata-persistence.zod';

describe('the ruling-5A re-export of PackagePublishResultSchema (#12038)', () => {
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

describe('DiscardPackageDraftsResponseSchema declares the discard-drafts body (#12038)', () => {
  /** A verbatim-shaped capture of a real `discardPackageDrafts` return (one failure). */
  const realResponse = {
    success: false,
    discardedCount: 2,
    failedCount: 1,
    discarded: [
      { type: 'view', name: 'account_pipeline' },
      { type: 'object', name: 'lead_source' },
    ],
    failed: [{ type: 'flow', name: 'lead_convert', error: 'item is locked', code: 'item_locked' }],
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

describe('ListPackageCommitsResponseSchema declares the commit timeline body (#12038)', () => {
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
});

describe('RevertPackageCommitResponseSchema declares the revert body (#12038)', () => {
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

describe('RollbackToPackageCommitResponseSchema declares the COMMIT-rollback body (#12038 3A)', () => {
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

describe('PackageExportManifestSchema declares the four fixed keys and stays open (#12038 4A)', () => {
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

  it('requires exactly the four fixed keys — a manifest with no items still parses', () => {
    const bare = { id: 'com.example.empty', name: 'empty', version: '1.0.0' };
    expect(PackageExportManifestSchema.safeParse(bare).success).toBe(true);
  });

  it('refuses a manifest missing its identity — the fixed keys are genuinely pinned', () => {
    expect(PackageExportManifestSchema.safeParse({ objects: [] }).success).toBe(false);
  });
});

describe('ReassignOrphanedMetadataResponseSchema declares the adopt-orphans body (#12038)', () => {
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

describe('DuplicatePackageResponseSchema declares the duplicate body (#12038)', () => {
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

  it('declares the OPERATION verdict at `success` — the objectui#6593 confusion has a declared answer', () => {
    // On the wire this payload rides the dispatcher envelope; the envelope's
    // `success` is transport-level and true even here. The schema declares the
    // payload's own verdict so a consumer reading the declared shape reads the
    // right key.
    const result = DuplicatePackageResponseSchema.safeParse(realResponse);
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { success: boolean }).success).toBe(false);
  });
});
