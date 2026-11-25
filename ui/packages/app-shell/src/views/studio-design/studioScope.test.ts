// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11553 — the package-less Studio scope's pure half: the reserved
 * segment, the path it builds, and the predicates that decide which served
 * items and draft headers belong to no package.
 *
 * The segment pins are against the package-id rules this app and the spec
 * actually enforce, read from their owners, so a widened alphabet that could
 * let a package id equal the segment fails here rather than in a router.
 */

import { describe, expect, it } from 'vitest';
import { MANIFEST_ID_PATTERN } from '@objectstack/spec/kernel';
import {
  STUDIO_ORG_SCOPE_PILLAR,
  STUDIO_ORG_SCOPE_SEGMENT,
  isOrgScopeDraft,
  isPackageLessDraft,
  isPackageLessItem,
  isStudioOrgScope,
  studioOrgScopePath,
} from './studioScope';
import { isSpecPackageId, sanitizePackageId } from './packages-io';
import { parseSurfaceParam } from '../metadata-admin/nav-selection';

describe('the reserved segment cannot name a package (objectui#11553)', () => {
  it('is refused by the spec manifest-id rule and by the predicate this app judges ids by', () => {
    expect(MANIFEST_ID_PATTERN.test(STUDIO_ORG_SCOPE_SEGMENT)).toBe(false);
    expect(isSpecPackageId(STUDIO_ORG_SCOPE_SEGMENT)).toBe(false);
    // Control: both accept a real reverse-domain id.
    expect(MANIFEST_ID_PATTERN.test('com.example.showcase')).toBe(true);
    expect(isSpecPackageId('com.example.showcase')).toBe(true);
  });

  it('cannot be typed into a package id: the sanitizer drops its first character', () => {
    expect(sanitizePackageId(STUDIO_ORG_SCOPE_SEGMENT)).toEqual({ value: 'org', stripped: true });
  });

  it('is told apart from a package segment', () => {
    expect(isStudioOrgScope(STUDIO_ORG_SCOPE_SEGMENT)).toBe(true);
    expect(isStudioOrgScope('com.example.showcase')).toBe(false);
    expect(isStudioOrgScope('org')).toBe(false);
    expect(isStudioOrgScope(undefined)).toBe(false);
  });
});

describe('studioOrgScopePath (objectstack#36903: the scope\'s leg of the area)', () => {
  it('lands on the scope’s flow list, filtered to the items of no package', () => {
    expect(studioOrgScopePath()).toBe(`/studio/${STUDIO_ORG_SCOPE_SEGMENT}/metadata/flow?source=runtime`);
    // The retired pillar segment only redirects now.
    expect(STUDIO_ORG_SCOPE_PILLAR).toBe('automations');
  });

  it('opens a flow full-screen on its address, round-tripping its name', () => {
    const path = studioOrgScopePath({ type: 'flow', name: 'qa_urgent_alert_clone' });
    expect(path).toBe('/studio/~org/metadata/flow/qa_urgent_alert_clone?source=runtime');
    const url = new URL(path, 'http://x');
    expect(decodeURIComponent(url.pathname.split('/').pop()!)).toBe('qa_urgent_alert_clone');
    expect(url.searchParams.get('source')).toBe('runtime');
  });
});

describe('package-less predicates', () => {
  /** A served list row, typed as the loaders hold one. */
  const row = (r: Record<string, unknown>): Record<string, unknown> => r;

  it('a served item with no owning package is package-less; a packaged one is not', () => {
    expect(isPackageLessItem(row({ name: 'clone' }))).toBe(true);
    expect(isPackageLessItem(row({ name: 'clone', _packageId: '' }))).toBe(true);
    expect(isPackageLessItem(row({ name: 'base', _packageId: 'com.example.showcase' }))).toBe(false);
  });

  it('the DB-authored pseudo-package names no package Studio can open', () => {
    expect(isPackageLessItem(row({ name: 'x', _packageId: 'sys_metadata' }))).toBe(true);
  });

  it('a draft header bound to no package is package-less', () => {
    expect(isPackageLessDraft({ packageId: null })).toBe(true);
    expect(isPackageLessDraft({})).toBe(true);
    expect(isPackageLessDraft({ packageId: 'com.acme.app' })).toBe(false);
  });

  it('the scope reviews package-less FLOW drafts only, stored spelling folded', () => {
    expect(isOrgScopeDraft({ type: 'flow', packageId: null })).toBe(true);
    expect(isOrgScopeDraft({ type: 'flows', packageId: null })).toBe(true);
    expect(isOrgScopeDraft({ type: 'object', packageId: null })).toBe(false);
    expect(isOrgScopeDraft({ type: 'flow', packageId: 'com.acme.app' })).toBe(false);
  });
});
