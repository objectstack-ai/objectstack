/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055 (ADR-0085) — the dead surface hints are gone from
 * `BuildPageOptions`.
 *
 * `hideHighlights`, `hidePath`, `showReferenceRail`, `hideReferenceRail`,
 * `hideRelatedTab`, `relatedLayout`, `recordChrome` and the `slots.rightRail`
 * slot had no console caller; ADR-0085 admits no surface hints, and
 * `rightRail` is not a slot the spec names. The compile-time half below is
 * the acceptance pin: each removed key is refused by the type, so a caller
 * that still passes one fails `tsc` (this file is compiled by
 * `tsconfig.test.json`). A `@ts-expect-error` that stops erroring fails that
 * compile too, which is what makes the pin two-sided.
 *
 * The runtime half pins what the page looks like without them: one region,
 * the header drawn with the record chrome, and a key still passed through an
 * untyped caller (a JS host, a stale cast) changing nothing.
 */

import { describe, expect, it } from 'vitest';
import { buildDefaultPageSchema, type BuildPageOptions } from '../buildDefaultPageSchema';

const leadDef = {
  name: 'lead',
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'email', label: 'Email' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'new', label: 'New' },
        { value: 'won', label: 'Won' },
      ],
    },
  },
};

const RELATED = [
  { objectName: 'task', relationshipField: 'lead_id' },
  { objectName: 'note', relationshipField: 'parent_id' },
];

describe('objectstack#27055 — BuildPageOptions no longer accepts the removed hints (tsc)', () => {
  it('each removed key is a type error', () => {
    // @ts-expect-error — removed: `hideHighlights`
    const a: BuildPageOptions = { hideHighlights: true };
    // @ts-expect-error — removed: `hidePath`
    const b: BuildPageOptions = { hidePath: true };
    // @ts-expect-error — removed: `showReferenceRail`
    const c: BuildPageOptions = { showReferenceRail: true };
    // @ts-expect-error — removed: `hideReferenceRail`
    const d: BuildPageOptions = { hideReferenceRail: true };
    // @ts-expect-error — removed: `hideRelatedTab`
    const e: BuildPageOptions = { hideRelatedTab: true };
    // @ts-expect-error — removed: `relatedLayout`
    const f: BuildPageOptions = { relatedLayout: 'tabs' };
    // @ts-expect-error — removed: `recordChrome`
    const g: BuildPageOptions = { recordChrome: false };
    // @ts-expect-error — removed: the `rightRail` slot
    const h: BuildPageOptions = { slots: { rightRail: { type: 'card' } } };
    expect([a, b, c, d, e, f, g, h]).toHaveLength(8);
  });

  it('CONTROL — the options that stay are still accepted', () => {
    const kept: BuildPageOptions = {
      hideDiscussion: true,
      hideAttachments: true,
      related: RELATED,
      slots: { details: { type: 'record:details' } },
    };
    expect(kept.hideDiscussion).toBe(true);
  });
});

describe('objectstack#27055 — the page without the hints', () => {
  it('has one region, and an untyped caller passing a removed hint changes nothing', () => {
    const plain = buildDefaultPageSchema(leadDef, { related: RELATED });
    const withHints = buildDefaultPageSchema(leadDef, {
      related: RELATED,
      showReferenceRail: true,
      hideRelatedTab: true,
      relatedLayout: 'tabs',
      hideHighlights: true,
      hidePath: true,
      recordChrome: false,
      slots: { rightRail: { type: 'card' } },
    } as unknown as BuildPageOptions);
    expect(plain.regions.map((r: { name: string }) => r.name)).toEqual(['main']);
    expect(withHints).toEqual(plain);
  });

  it('draws the header with the record chrome', () => {
    const header = buildDefaultPageSchema(leadDef).regions[0].components[0];
    expect(header).toEqual({ type: 'page:header', properties: { recordChrome: true } });
  });
});
