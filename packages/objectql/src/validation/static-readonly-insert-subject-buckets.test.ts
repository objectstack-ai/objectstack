// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15719 — which `managedBy` buckets the CREATE-side static-`readonly` strip
 * steps around, and which it now judges.
 *
 * Maintainer ruling 2026-09-05 (option 2, "census first"): the create-side
 * exclusion narrows to the buckets ADR-0086's 403-guard argument actually
 * covers — the platform-internal buckets and the `sys_` namespace — while
 * user-writable buckets such as `system-data` get the same static-`readonly`
 * strip on create that they already get on update.
 *
 * The partition itself is pinned against `@objectstack/spec`'s enum rather than
 * restated, so a SEVENTH bucket fails here instead of silently landing on
 * whichever side the implementation's `has()` happens to answer.
 */

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { staticReadonlyInsertSubject } from './rule-validator.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD rather than inside a clocked `it()` body — see `rule-validator.test.ts`.
import '@objectstack/spec';

/**
 * The buckets whose columns carry their OWN fail-closed refusal on a
 * user-context generic write, per `object.zod.ts`'s enum docblock:
 * `better-auth` via plugin-auth's identity write guard (ADR-0092),
 * `engine-owned` / `append-only` via plugin-security's engine-owned write
 * guard (ADR-0103).
 */
const PLATFORM_INTERNAL = ['engine-owned', 'append-only', 'better-auth'] as const;
/**
 * The buckets `object.zod.ts` calls writable by default — "no such guard; its
 * writes are adjudicated by the delegated-admin gate / RLS / permission sets".
 */
const USER_WRITABLE = ['platform', 'config', 'system-data'] as const;

/** An APP-authored object: a user-writable bucket on a name outside `sys_`. */
const authored = (managedBy: string) => ({
  name: 'crm_deal',
  managedBy,
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    title: { name: 'title', type: 'text' },
    approval_status: { name: 'approval_status', type: 'select', readonly: true },
  },
});

describe('#15719 — the create-side bucket exclusion follows its reason, not the mere presence of `managedBy`', () => {
  it('classifies EVERY `managedBy` value the spec enum declares — a new bucket fails here', () => {
    const enumDef = (ObjectSchema.shape.managedBy as any)?.def?.innerType
      ?? (ObjectSchema.shape.managedBy as any)?._def?.innerType;
    const declared: string[] = [...(enumDef?.options ?? [])];
    expect(declared.length, 'the enum must be readable — an empty read would pass this vacuously')
      .toBeGreaterThan(0);
    const classified = [...PLATFORM_INTERNAL, ...USER_WRITABLE];
    expect([...declared].sort(), 'every bucket is on exactly one side of the exclusion')
      .toEqual([...classified].sort());
  });

  it.each(PLATFORM_INTERNAL)('`managedBy: %s` is left to its own guard — no subject at all', (bucket) => {
    expect(staticReadonlyInsertSubject(authored(bucket) as any)).toBeNull();
  });

  it.each(USER_WRITABLE)('`managedBy: %s` is judged — its static readonly columns ARE the subject', (bucket) => {
    const subject = staticReadonlyInsertSubject(authored(bucket) as any);
    expect(subject, `${bucket} holds the user's own data — the strip applies as it does on update`)
      .not.toBeNull();
    expect(Object.keys(subject!.fields)).toEqual(['approval_status']);
  });

  it('the reserved `sys_` namespace stays excluded on EVERY bucket, user-writable ones included', () => {
    for (const bucket of [...PLATFORM_INTERNAL, ...USER_WRITABLE]) {
      const schema = { ...authored(bucket), name: 'sys_permission_set' };
      expect(staticReadonlyInsertSubject(schema as any), `sys_ + ${bucket}`).toBeNull();
    }
  });

  it('an UNRECOGNISED bucket is NOT read as platform-internal — the strip applies', () => {
    // The one legacy value that can still arrive is `'system'`, retired in
    // protocol 17 (#3355) and converted to `'system-data'` — a USER-WRITABLE
    // bucket. Treating an unknown value as internal would exempt exactly the
    // rows that conversion targets, and over-stripping is the safe direction.
    for (const bucket of ['system', 'package', '']) {
      expect(staticReadonlyInsertSubject(authored(bucket) as any), `unknown bucket ${JSON.stringify(bucket)}`)
        .not.toBeNull();
    }
  });

  it('an object with NO `managedBy` is unchanged by this ruling', () => {
    const { managedBy: _dropped, ...plain } = authored('platform');
    expect(staticReadonlyInsertSubject(plain as any)).not.toBeNull();
  });

  it('`sys_metadata_history.recorded_by` stays outside the subject — the real object, not a replica', () => {
    // The metadata repository seeds this provenance column through a DIRECT,
    // NON-system `engine.insert` (`sys-metadata-repository.ts`). It is doubly
    // excluded — `engine-owned` bucket AND the `sys_` namespace — so this
    // ruling cannot reach it.
    expect(SysMetadataHistoryObject.managedBy, 'the bucket this pin rests on').toBe('engine-owned');
    expect((SysMetadataHistoryObject.fields as any).recorded_by?.readonly, 'the column this pin rests on').toBe(true);
    expect(staticReadonlyInsertSubject(SysMetadataHistoryObject as any)).toBeNull();
  });

  it('runtime-owned types stay out of the subject on a now-judged bucket too', () => {
    const schema = {
      name: 'crm_deal',
      managedBy: 'system-data',
      fields: {
        code: { name: 'code', type: 'autonumber', readonly: true },
        approval_status: { name: 'approval_status', type: 'select', readonly: true },
      },
    };
    const subject = staticReadonlyInsertSubject(schema as any);
    expect(Object.keys(subject!.fields), '`stripRuntimeOwnedFields` owns `code`, under a wider exemption')
      .toEqual(['approval_status']);
  });

  it('a now-judged bucket with no static readonly column still takes the cheap `null` exit', () => {
    const schema = {
      name: 'crm_deal',
      managedBy: 'system-data',
      fields: { title: { name: 'title', type: 'text' } },
    };
    expect(staticReadonlyInsertSubject(schema as any)).toBeNull();
  });
});
