// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13216] `validateViewPageRefs` at the runtime publish gate, and the
 * `RuntimeStackContext.pages` widening it rides on — measured BOTH ways.
 *
 * ## Why the crossing is the point rather than a bonus
 *
 * The mount this rule guards is authored on exactly one door: an agent
 * publishes a page through the metadata API, then writes a `type: 'page'` view
 * that mounts it. Both writes are `PUT /api/v1/meta/view` / `.../meta/page` —
 * no CLI is involved anywhere on that path (#13100's measured trail), so a
 * build-time-only rule would never speak to the author who needs it.
 *
 * ## Why the widening is load-bearing, stated as a measurement
 *
 * `ReferenceIntegrityRule.runtimeTypes` exists to keep one channel closed: a
 * member that resolves against a collection the per-write snapshot does not
 * carry does not go quiet, it reports EVERY reference into that collection as
 * dead. `pages` was not a snapshot collection before this card. The two tests
 * under "the widening" are that channel, opened and closed: identical write,
 * identical rule, and the only difference is whether the host handed the gate
 * its live pages.
 *
 * ## What the gate does with the finding
 *
 * `warning` — so it lands in `advisories`, never in `errors`, and never 422s a
 * write. That is deliberate and matches the nav twin: without a curated
 * cross-package page registry, "unresolved here" cannot be told apart from
 * "provided by a package this tenant cannot see from here", and inventing a
 * refusal out of that ambiguity would break legitimate publishes. The
 * `errors` assertions below pin it.
 */

import { describe, expect, it } from 'vitest';

import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { VIEW_PAGE_UNRESOLVED } from './validate-view-page-refs.js';

/** The live object universe every `view` write is resolved against. */
const objects = [
  { name: 'crm_lead', label: 'Lead', fields: { name: { type: 'text', label: 'Name' } } },
];

/**
 * A flattened standalone list overlay mounting a page, exactly as
 * `saveMetaItem` stores it: a raw ListView config at the TOP level with
 * `object` + `viewKind` (#7741) and the identity the write path stamps.
 */
const pageMountOverlay = (pageName: string) => ({
  name: 'crm_lead.dashboard',
  object: 'crm_lead',
  viewKind: 'list',
  type: 'page',
  pageName,
  columns: [],
});

const gate = (item: unknown, context: Record<string, unknown>) =>
  runRuntimeAuthoringRules({ type: 'view', item, context });

const pageFindings = (r: { errors: { rule: string }[]; advisories: { rule: string }[] }) => ({
  errors: r.errors.filter((f) => f.rule === VIEW_PAGE_UNRESOLVED),
  advisories: r.advisories.filter((f) => f.rule === VIEW_PAGE_UNRESOLVED),
});

describe('the `pages` widening (RuntimeStackContext.pages) — measured both ways', () => {
  it('WITHOUT live pages, a legitimate mount reads as dangling — the channel this closes', () => {
    const { advisories } = pageFindings(gate(pageMountOverlay('sales_dashboard'), { objects }));
    // Not an assertion about desired behaviour: this is the false-positive
    // channel, reproduced. It is why the member could not simply declare
    // `runtimeTypes: ['view']` and stop.
    expect(advisories).toHaveLength(1);
  });

  it('WITH live pages carried, the same write is clean', () => {
    const { errors, advisories } = pageFindings(gate(
      pageMountOverlay('sales_dashboard'),
      { objects, pages: [{ name: 'sales_dashboard', label: 'Sales' }] },
    ));
    expect(advisories).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('a page mount at the runtime publish gate', () => {
  it('ADVISES on a mount that resolves to no page — and never blocks the write', () => {
    const { errors, advisories } = pageFindings(gate(
      pageMountOverlay('typo_dashboard'),
      { objects, pages: [{ name: 'sales_dashboard' }] },
    ));
    expect(advisories).toHaveLength(1);
    expect(advisories[0].rule).toBe(VIEW_PAGE_UNRESOLVED);
    // Advisory, not gating: the honest ceiling for a page reference (see the
    // module docblock). A refusal here would 422 a legitimate cross-package
    // mount.
    expect(errors).toEqual([]);
  });

  it('runs the suite for a `view` write at all', () => {
    const { rulesRun } = runRuntimeAuthoringRules({
      type: 'view',
      item: pageMountOverlay('sales_dashboard'),
      context: { objects, pages: [{ name: 'sales_dashboard' }] },
    });
    expect(rulesRun).toContain('validateReferenceIntegrity');
  });

  // The differential (#4463 D4): a stored page's own condition is not this
  // write's to answer for, and a stored VIEW's dangling mount must not block an
  // unrelated write either. Carrying `pages` in both passes is what cancels it.
  it('does not attribute a pre-existing stored page to this write', () => {
    const { errors, advisories } = pageFindings(gate(
      pageMountOverlay('sales_dashboard'),
      {
        objects,
        pages: [{ name: 'sales_dashboard' }, { name: 'unrelated_page' }],
      },
    ));
    expect(advisories).toEqual([]);
    expect(errors).toEqual([]);
  });
});
