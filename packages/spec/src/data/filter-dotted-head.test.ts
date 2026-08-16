// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  classifyDottedFilterHead,
  SCALAR_FILTER_HEAD_TYPES,
} from './filter-dotted-head';
import {
  REFERENCE_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
} from './field-value.zod';
import { SEARCH_VIRTUAL_TYPES } from './search-fields';

// ---------------------------------------------------------------------------
// [#8371] The dotted-filter head classification, pinned VERDICT BY VERDICT.
//
// This module is the ONE judgment behind two doors (metadata-protocol ingress,
// objectql engine seam). The pins below are therefore about the RULING, not
// about set plumbing: which head classes are refused (relation / virtual /
// scalar — measured zero rows on all three drivers), and which head is
// DELIBERATELY unjudged (structured/JSON — live on two of three backends, the
// carve-out the maintainer ruling names with a ⛔).
// ---------------------------------------------------------------------------
describe('[#8371] classifyDottedFilterHead — the FILTER axis dotted verdict', () => {
  it('a relation head is refused: the stored value is a scalar id, not an embedded document', () => {
    expect(classifyDottedFilterHead({ type: 'lookup' })).toBe('relation');
    expect(classifyDottedFilterHead({ type: 'master_detail' })).toBe('relation');
    // The system-column shape: `created_by` / `updated_by` are `lookup` to
    // `sys_user`, `user` is the fixed-target specialisation.
    expect(classifyDottedFilterHead({ type: 'user' })).toBe('relation');
    expect(classifyDottedFilterHead({ type: 'tree' })).toBe('relation');
    // Every member of the reference class answers 'relation' — the classifier
    // reads the shared set, so a type added there is refused here by
    // construction, never by someone updating a second list.
    for (const type of REFERENCE_VALUE_TYPES) {
      expect(classifyDottedFilterHead({ type }), `'${type}' must classify as relation`).toBe('relation');
    }
  });

  it('a virtual head is refused: the #8296 verdict finally reaching the dotted spelling', () => {
    for (const type of SEARCH_VIRTUAL_TYPES) {
      expect(classifyDottedFilterHead({ type }), `'${type}' must classify as virtual`).toBe('virtual');
    }
  });

  it('a plain scalar head is refused: nothing beneath it for a path to reach', () => {
    expect(classifyDottedFilterHead({ type: 'text' })).toBe('scalar');
    expect(classifyDottedFilterHead({ type: 'boolean' })).toBe('scalar');
    expect(classifyDottedFilterHead({ type: 'number' })).toBe('scalar');
    expect(classifyDottedFilterHead({ type: 'datetime' })).toBe('scalar');
    expect(classifyDottedFilterHead({ type: 'select' })).toBe('scalar');
    // The computed-but-STORED pair the #8296 undotted verdict deliberately
    // does not refuse — both get real scalar columns, which is exactly why a
    // dotted path UNDER them reaches nothing.
    expect(classifyDottedFilterHead({ type: 'summary' })).toBe('scalar');
    expect(classifyDottedFilterHead({ type: 'autonumber' })).toBe('scalar');
  });

  it('⛔ the structured/JSON head stays deliberately UNJUDGED — the ruled carve-out', () => {
    // Measured (#8371): `{'address.city': 'Beijing'}` returns 2 rows on
    // driver-memory AND driver-mongodb. Refusing it for symmetry would delete
    // a live capability; the ruling forbids exactly that sweep.
    for (const type of STRUCTURED_JSON_TYPES) {
      expect(classifyDottedFilterHead({ type }), `'${type}' must stay unjudged`).toBe(null);
    }
  });

  it('array-valued heads stay unjudged: numeric-index dotted paths genuinely reach arrays', () => {
    // `multiple: true` turns a scalar store into an array store, and
    // `{'colors.0': 'red'}` is a working Mongo/mingo spelling — the same
    // measured reason the structured carve-out exists.
    expect(classifyDottedFilterHead({ type: 'select', multiple: true })).toBe(null);
    expect(classifyDottedFilterHead({ type: 'tags' })).toBe(null);
    expect(classifyDottedFilterHead({ type: 'multiselect' })).toBe(null);
    // A MULTI-RELATION head keeps the relation refusal: the ruling names the
    // relation class flat, and `tag_ids.name` is the same traversal error
    // whether the head stores one id or many.
    expect(classifyDottedFilterHead({ type: 'lookup', multiple: true })).toBe('relation');
  });

  it('file/media heads stay unjudged: the legacy stored form is an inline object a path can reach', () => {
    expect(classifyDottedFilterHead({ type: 'image' })).toBe(null);
    expect(classifyDottedFilterHead({ type: 'file' })).toBe(null);
  });

  it('an unreadable or unknown head is NOT judged — unresolvable is not wrong (ADR-0072 D1)', () => {
    expect(classifyDottedFilterHead(undefined)).toBe(null);
    expect(classifyDottedFilterHead(null)).toBe(null);
    expect(classifyDottedFilterHead({})).toBe(null);
    expect(classifyDottedFilterHead({ type: 'some_future_type' })).toBe(null);
  });

  it('the scalar set is derived from the value-shape classes, never re-listing the carve-outs', () => {
    // The invariant that keeps the ruling stable under future type additions:
    // no refused-scalar type may simultaneously be structured, a reference, or
    // virtual. An overlap would make the classification order-dependent.
    for (const type of SCALAR_FILTER_HEAD_TYPES) {
      expect(STRUCTURED_JSON_TYPES.has(type), `'${type}' overlaps STRUCTURED_JSON_TYPES`).toBe(false);
      expect(REFERENCE_VALUE_TYPES.has(type), `'${type}' overlaps REFERENCE_VALUE_TYPES`).toBe(false);
      expect(SEARCH_VIRTUAL_TYPES.has(type), `'${type}' overlaps SEARCH_VIRTUAL_TYPES`).toBe(false);
    }
  });
});
