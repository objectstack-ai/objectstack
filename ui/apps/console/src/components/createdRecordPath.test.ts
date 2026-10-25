// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an internal form submit lands (objectui#4109) — the host-app policy at
 * THIS call site, unit-tested without a router or a metadata catalog.
 *
 * objectui#4280 deleted the console's local copy of the resolution order, so
 * these cases pin `@object-ui/app-shell`'s `resolveHostAppSegment` as composed
 * by `buildCreatedRecordPath` — including the two last resorts the deleted
 * subset used to answer `null` for.
 */

import { describe, expect, it } from 'vitest';
import { resolveHostAppSegment } from '@object-ui/app-shell';
import { buildCreatedRecordPath, type HostAppLike } from './createdRecordPath';

const SHOWCASE: HostAppLike = { name: 'showcase_app', _packageId: 'ai.objectstack.showcase' };
const CRM: HostAppLike = { name: 'crm_app', _packageId: 'ai.objectstack.crm' };

/**
 * The package-root export itself (objectui#4280). That barrel line in
 * `packages/app-shell/src/index.ts` is the entire reason this module can hold
 * no resolver of its own, and it is reachable from `apps/console` nowhere else
 * — so without a pin it can be dropped in a tidy-up, and the only symptom would
 * be the console growing a second copy of the resolution order back.
 *
 * Imported from the PACKAGE ROOT and never from `.../utils/appRoute`: the deep
 * path resolves either way and would hold this test green through exactly the
 * regression it exists to catch.
 */
describe('@object-ui/app-shell package root', () => {
  it('publishes resolveHostAppSegment', () => {
    expect(typeof resolveHostAppSegment).toBe('function');
  });

  it('publishes the FULL resolver, `setup` last resort included', () => {
    // The behaviour that separates the shared resolver from the subset this
    // module used to carry — that one answered `null` here.
    expect(resolveHostAppSegment([], undefined)).toBe('setup');
  });
});

describe('buildCreatedRecordPath — host app', () => {
  it('prefers the app the user is in, matched by package id', () => {
    expect(buildCreatedRecordPath([CRM, SHOWCASE], 'ai.objectstack.showcase', 'obj', '1')).toBe(
      '/apps/ai.objectstack.showcase/obj/record/1',
    );
  });

  it('matches the preferred app by name too (runtime/DB apps, legacy URLs)', () => {
    expect(buildCreatedRecordPath([CRM, SHOWCASE], 'showcase_app', 'obj', '1')).toBe(
      '/apps/ai.objectstack.showcase/obj/record/1',
    );
  });

  it('uses the package id as the segment, never the name, when both exist (ADR-0048)', () => {
    expect(buildCreatedRecordPath([SHOWCASE], 'showcase_app', 'obj', '1')).toBe(
      '/apps/ai.objectstack.showcase/obj/record/1',
    );
  });

  it('falls back to the name for a runtime app carrying no package id', () => {
    expect(buildCreatedRecordPath([{ name: 'db_app' }], 'db_app', 'obj', '1')).toBe(
      '/apps/db_app/obj/record/1',
    );
  });

  it('falls back to the first openable app when nothing is preferred', () => {
    expect(buildCreatedRecordPath([CRM, SHOWCASE], undefined, 'obj', '1')).toBe(
      '/apps/ai.objectstack.crm/obj/record/1',
    );
  });

  /**
   * The re-check that keeps a deactivated/hidden app from being resurrected as
   * a link just because the shell still remembers the user was in it.
   */
  it('does not honour a preferred app that is no longer openable', () => {
    const apps = [{ ...SHOWCASE, active: false }, CRM];
    expect(buildCreatedRecordPath(apps, 'ai.objectstack.showcase', 'obj', '1')).toBe(
      '/apps/ai.objectstack.crm/obj/record/1',
    );
  });

  it('skips hidden apps when falling back', () => {
    const apps = [{ ...SHOWCASE, hidden: true }, CRM];
    expect(buildCreatedRecordPath(apps, undefined, 'obj', '1')).toBe(
      '/apps/ai.objectstack.crm/obj/record/1',
    );
  });
});

/**
 * The semantic alignment objectui#4280 exists to make. Every case here answered
 * `null` under the deleted local subset — which `FormPage` reads as "no record
 * page to land on" and answers by confirming the submit in place instead of
 * navigating. They now resolve to a host app, so the submit lands on the
 * record like every other record link in the console.
 */
describe('buildCreatedRecordPath — last resorts that used to be null (#4280)', () => {
  it('an EMPTY app list keeps the preferred app, unchecked', () => {
    // Upstream step 3: an empty list means "not loaded yet" at least as often
    // as "this user has no apps", and demoting someone demonstrably rendering
    // inside /apps/{preferred}/… would reintroduce the defect #4074 removed.
    expect(buildCreatedRecordPath([], 'showcase_app', 'obj', '1')).toBe(
      '/apps/showcase_app/obj/record/1',
    );
  });

  it('no apps and nothing preferred lands on `setup`', () => {
    expect(buildCreatedRecordPath(undefined, undefined, 'obj', '1')).toBe(
      '/apps/setup/obj/record/1',
    );
  });

  it('an app list that filters down to nothing lands on `setup`', () => {
    expect(buildCreatedRecordPath([{ name: 'x', active: false }], undefined, 'obj', '1')).toBe(
      '/apps/setup/obj/record/1',
    );
  });

  it('an app with no addressable identity at all lands on `setup`', () => {
    // Openable (neither deactivated nor hidden) but carrying neither
    // `_packageId` nor `name`, so there is nothing to build a segment from —
    // upstream step 4, not step 3.
    expect(buildCreatedRecordPath([{}], undefined, 'obj', '1')).toBe('/apps/setup/obj/record/1');
  });
});

describe('buildCreatedRecordPath — URL shape', () => {
  it('builds the app-scoped record path (ADR-0048 segment + object + id)', () => {
    expect(buildCreatedRecordPath([SHOWCASE], 'showcase_app', 'showcase_task', 'task-1')).toBe(
      '/apps/ai.objectstack.showcase/showcase_task/record/task-1',
    );
  });

  it('percent-encodes an id that carries URL-significant characters', () => {
    expect(buildCreatedRecordPath([{ name: 'a' }], 'a', 'obj', 'a/b#c')).toBe(
      '/apps/a/obj/record/a%2Fb%23c',
    );
  });

  /**
   * The only `null` this module still answers, and the only one it ever
   * should: there is no record to point at. The host app is never a reason.
   */
  it('returns null when there is no object or no id to land on', () => {
    expect(buildCreatedRecordPath([SHOWCASE], 'showcase_app', 'showcase_task', null)).toBeNull();
    expect(buildCreatedRecordPath([SHOWCASE], 'showcase_app', '', 'task-1')).toBeNull();
  });
});
