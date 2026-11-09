// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30786 — pins the one reading of which document an editor edits
 * (`authored-layers.ts`), now that it lives here for every editor that saves a
 * metadata item. The editors' own suites pin what reaches the wire; this file
 * pins the reading itself, case by case.
 */

import { describe, expect, it } from 'vitest';
import { TRANSLATABLE_METADATA_TYPES } from '@objectstack/spec/system';
import { authoredBuffer, authoredPublished, editsAuthoredLayers } from './index';

const CODE = { name: 'n', label: 'Code' };
const OVERLAY = { name: 'n', label: 'Overlay' };
const EFFECTIVE = { name: 'n', label: 'Effective' };
const DRAFT = { name: 'n', label: 'Draft' };
const SERVED_DRAFT = { name: 'n', label: '草稿' };

describe('editsAuthoredLayers', () => {
  it('answers by the spec set the server translates by, and by nothing else', () => {
    for (const type of TRANSLATABLE_METADATA_TYPES) expect(editsAuthoredLayers(type)).toBe(true);
    expect(editsAuthoredLayers('flow')).toBe(false);
    expect(editsAuthoredLayers('datasource')).toBe(false);
  });
});

describe('authoredPublished', () => {
  it('an object is `overlay ?? code`, never its governed `effective`', () => {
    expect(authoredPublished('object', { code: CODE, overlay: OVERLAY, effective: EFFECTIVE })).toBe(OVERLAY);
    expect(authoredPublished('object', { code: CODE, overlay: null, effective: EFFECTIVE })).toBe(CODE);
    expect(authoredPublished('object', { code: null, overlay: OVERLAY, effective: EFFECTIVE })).toBe(OVERLAY);
  });

  it('any other type is the layered read\'s own `effective ?? code`', () => {
    expect(authoredPublished('view', { code: CODE, overlay: OVERLAY, effective: EFFECTIVE })).toBe(EFFECTIVE);
    expect(authoredPublished('view', { code: CODE, overlay: null, effective: null })).toBe(CODE);
  });

  it('no layer at all, or a layer that is not a document, is `{}`', () => {
    expect(authoredPublished('object', null)).toEqual({});
    expect(authoredPublished('object', { code: 'text', overlay: ['x'] })).toEqual({});
  });
});

describe('authoredBuffer', () => {
  it('a pending draft is the stored `draft` layer, as stored', () => {
    expect(authoredBuffer('view', { code: CODE, draft: DRAFT }, SERVED_DRAFT)).toEqual({
      kind: 'buffer',
      body: DRAFT,
      fromDraft: true,
    });
  });

  it('a served draft with no `draft` layer is `unserved`, never the served body', () => {
    expect(authoredBuffer('view', { code: CODE }, SERVED_DRAFT)).toEqual({ kind: 'unserved' });
    expect(authoredBuffer('object', { code: CODE, draft: null }, SERVED_DRAFT)).toEqual({ kind: 'unserved' });
  });

  it('no draft pending is the published item as authored', () => {
    expect(authoredBuffer('object', { code: CODE, overlay: OVERLAY, effective: EFFECTIVE, draft: null }, null)).toEqual({
      kind: 'buffer',
      body: OVERLAY,
      fromDraft: false,
    });
    expect(authoredBuffer('dashboard', { code: CODE, effective: EFFECTIVE }, null)).toEqual({
      kind: 'buffer',
      body: EFFECTIVE,
      fromDraft: false,
    });
  });
});
