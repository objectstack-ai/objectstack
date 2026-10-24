/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MetadataDraftHeader` declares the spec row's `member` — objectui#12413.
 *
 * `@objectstack/spec` declares `ListDraftsResponseSchema.drafts[].member` (an
 * optional string) and `GET /meta/_drafts` serves it, but the published row
 * type `listDrafts()` declares had no `member`, so its readers cast the row to
 * `any` to reach the key. The header is now derived from the spec row by
 * `Pick`, and the publish advisory event carries the member a publish named.
 *
 * ## Where these pins get their colour
 *
 * The `Assert` lines and the cast-free reads are COMPILE-time: `vitest`
 * transpiles with esbuild and erases types, so the colour comes from
 * `pnpm --filter @object-ui/data-objectstack type-check`, whose program is this
 * package's whole `src/**`, tests included (the property
 * `adapterFactoryReturn.types.test.ts` documents). The `it` bodies add the
 * runtime half: the served `member` reaches the caller and the advisory event.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ListDraftsResponse } from '@objectstack/spec/api';
import {
  MetadataClient,
  type MetadataDraftHeader,
  type MetadataSaveAdvisoryEvent,
} from './metadata-client';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type SpecDraftRow = ListDraftsResponse['drafts'][number];

// The added key, typed by the spec row, not by a hand copy.
export type _MemberFromSpec = Assert<Equal<MetadataDraftHeader['member'], SpecDraftRow['member']>>;
export type _MemberIsOptionalString = Assert<Equal<MetadataDraftHeader['member'], string | undefined>>;

// Additive only: the five keys the header declared before keep their exact types.
export type _Type = Assert<Equal<MetadataDraftHeader['type'], string>>;
export type _Name = Assert<Equal<MetadataDraftHeader['name'], string>>;
export type _PackageId = Assert<Equal<MetadataDraftHeader['packageId'], string | null>>;
export type _UpdatedAt = Assert<Equal<MetadataDraftHeader['updatedAt'], string | null>>;
export type _UpdatedBy = Assert<Equal<MetadataDraftHeader['updatedBy'], string | null>>;
export type _Keys = Assert<
  Equal<keyof MetadataDraftHeader, 'type' | 'name' | 'member' | 'packageId' | 'updatedAt' | 'updatedBy'>
>;

// The method's declared element is the header.
export type _ListDraftsReturn = Assert<
  Equal<Awaited<ReturnType<MetadataClient['listDrafts']>>, MetadataDraftHeader[]>
>;

// The advisory event's member is the row's member, optional.
export type _EventMember = Assert<Equal<MetadataSaveAdvisoryEvent['member'], MetadataDraftHeader['member']>>;

const ADVISORY = {
  severity: 'warning' as const,
  rule: 'email_template/unknown-merge-field',
  where: 'email_template "welcome"',
  path: 'body',
  message: 'merge field {{ first_nam }} names no field',
  hint: 'check the spelling',
};

function clientAnswering(body: unknown, onSaveAdvisory?: (e: MetadataSaveAdvisoryEvent) => void) {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch,
    ...(onSaveAdvisory ? { onSaveAdvisory } : {}),
  });
}

describe('MetadataDraftHeader declares the spec row member (objectui#12413)', () => {
  it('reads the served member off a listDrafts row without a cast', async () => {
    const client = clientAnswering({
      drafts: [
        { type: 'email_template', name: 'welcome', member: 'zh-CN', label: null, packageId: null, updatedAt: null, updatedBy: null },
        { type: 'flow', name: 'nightly', label: null, packageId: 'crm', updatedAt: null, updatedBy: null },
      ],
    });

    const rows = await client.listDrafts();
    // Typed reads: `string | undefined`, no `any` between the row and the key.
    const members: Array<string | undefined> = rows.map((row) => row.member);
    expect(members).toEqual(['zh-CN', undefined]);
  });
});

describe('publishDraft names its member on the advisory event (objectui#12413)', () => {
  it('carries the member the publish named', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientAnswering({ success: true, advisories: [ADVISORY] }, (e) => events.push(e));

    await client.publishDraft('email_template', 'welcome', { member: 'zh-CN' });

    expect(events).toEqual([
      {
        type: 'email_template',
        name: 'welcome',
        member: 'zh-CN',
        door: 'publish',
        mode: 'publish',
        advisories: [ADVISORY],
      },
    ]);
  });

  it('leaves the key absent when the publish named no member', async () => {
    for (const options of [undefined, {}, { member: '' }]) {
      const events: MetadataSaveAdvisoryEvent[] = [];
      const client = clientAnswering({ success: true, advisories: [ADVISORY] }, (e) => events.push(e));

      await client.publishDraft('email_template', 'welcome', options);

      expect(events).toHaveLength(1);
      expect(Object.prototype.hasOwnProperty.call(events[0], 'member')).toBe(false);
    }
  });
});
