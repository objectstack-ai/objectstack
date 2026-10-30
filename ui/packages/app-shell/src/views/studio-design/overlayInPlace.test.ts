// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 — the three answers the Interfaces pillar asks before it edits
 * a read-only package's item in place, each read off the served type registry
 * and the item's layered envelope: may it be edited, is it customized here,
 * and which verb removes the overlay (the tri-state `resettable`).
 */

import { describe, expect, it } from 'vitest';
import { editsOverlayInPlace, isCustomizedHere, overlayRemovalVerb, type OverlayEnvelope } from './overlayInPlace';

const SERVED = [
  { type: 'view', allowEnvironmentOverlay: true },
  { type: 'dashboard', allowEnvironmentOverlay: true },
  { type: 'report', allowEnvironmentOverlay: true },
  { type: 'translation', allowEnvironmentOverlay: true },
  { type: 'page', allowEnvironmentOverlay: false },
];

const CODE = { name: 'pipeline' };
const env = (over: Partial<OverlayEnvelope> = {}): OverlayEnvelope => ({
  code: CODE,
  overlay: null,
  editable: true,
  deletable: true,
  resettable: false,
  ...over,
});

describe('editsOverlayInPlace', () => {
  it.each(['view', 'dashboard', 'report'])('a packaged %s the registry and its envelope admit is edited in place', (type) => {
    expect(editsOverlayInPlace(type, SERVED, env())).toBe(true);
  });

  it('a type the pillar does not design is not, though the registry gives it an overlay', () => {
    expect(editsOverlayInPlace('translation', SERVED, env())).toBe(false);
  });

  it('a type the served registry gives no overlay is not, nor any type of a registry not read', () => {
    expect(editsOverlayInPlace('page', SERVED, env())).toBe(false);
    expect(editsOverlayInPlace('view', [], env())).toBe(false);
  });

  it('the envelope decides the item: not read, no package baseline, or a refused write is not edited', () => {
    expect(editsOverlayInPlace('view', SERVED, null)).toBe(false);
    expect(editsOverlayInPlace('view', SERVED, env({ code: null }))).toBe(false);
    expect(editsOverlayInPlace('view', SERVED, env({ editable: false }))).toBe(false);
  });

  it('an envelope with no `editable` opinion does not refuse', () => {
    expect(editsOverlayInPlace('report', SERVED, env({ editable: undefined }))).toBe(true);
  });
});

describe('isCustomizedHere — overlay presence, as served', () => {
  it('is the overlay layer, and nothing else', () => {
    expect(isCustomizedHere(env({ overlay: { name: 'pipeline', label: 'Mine' } }))).toBe(true);
    expect(isCustomizedHere(env())).toBe(false);
    expect(isCustomizedHere(null)).toBe(false);
  });
});

describe('overlayRemovalVerb — the tri-state `resettable` (objectui#4886)', () => {
  const overlaid = { overlay: { name: 'pipeline' } };
  it('`true` is Reset, `false` is Delete', () => {
    expect(overlayRemovalVerb(env({ ...overlaid, resettable: true }))).toBe('reset');
    expect(overlayRemovalVerb(env({ ...overlaid, resettable: false }))).toBe('delete');
  });

  it('no opinion is no verb: the client does not guess the server’s answer', () => {
    expect(overlayRemovalVerb(env({ ...overlaid, resettable: undefined }))).toBeNull();
  });

  it('no overlay, or a removal the envelope refuses, offers nothing', () => {
    expect(overlayRemovalVerb(env({ resettable: true }))).toBeNull();
    expect(overlayRemovalVerb(env({ ...overlaid, resettable: true, deletable: false }))).toBeNull();
    expect(overlayRemovalVerb(null)).toBeNull();
  });
});
