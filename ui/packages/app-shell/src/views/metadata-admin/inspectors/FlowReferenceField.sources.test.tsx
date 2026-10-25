// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework #3508 follow-up — the approver Value picker now reads WHERE its
 * candidates live off the published schema (`xRef.sources`) instead of a local
 * mirror of the spec's `APPROVER_VALUE_BINDINGS`.
 *
 * The mirror is what made #3508 possible in the first place: `xRef.map` named
 * a picker KIND and nothing more, so this package had to decide the data
 * source itself — and decided wrong, wiring every directory kind to the
 * metadata registry, which holds no `sys_user` / `sys_team` rows.
 *
 * Load-bearing behaviours:
 *   1. a published `data` source WINS over the local table (that is what stops
 *      the mirror from drifting from the engine again);
 *   2. no published source → the local table still drives the picker, so an
 *      older server keeps working;
 *   3. a published NON-data source (enum / auto / unsupported) keeps the kind
 *      off the record-lookup path entirely;
 *   4. presentation (display field, people-picker, subtitle) stays local — the
 *      spec ships the data contract, not the look;
 *   5. the source is keyed by the DISCRIMINATOR, not the picker kind, so
 *      `role` and `org_membership_level` stay distinguishable though they
 *      share one kind.
 */

import { describe, it, expect } from 'vitest';
import { recordLookupFor, resolveRefKind, KIND_TO_RECORD_LOOKUP } from './FlowReferenceField';
import type { FlowReferenceSpec } from './flow-node-config';

describe('recordLookupFor — published source vs local mirror (#3508 follow-up)', () => {
  it('prefers the schema’s object and committed column over the local table', () => {
    // A server that renamed the directory object: the picker must follow the
    // SCHEMA, or it queries a table the engine does not resolve against.
    const lookup = recordLookupFor({
      kind: 'user',
      source: { source: 'data', object: 'sys_person', valueField: 'external_id' },
    });
    expect(lookup).toMatchObject({ object: 'sys_person', valueField: 'external_id' });
    // …while presentation still comes from here.
    expect(lookup?.picker).toBe('search');
    expect(lookup?.subtitle).toEqual(['email']);
  });

  it('falls back to the local table when the server publishes no source', () => {
    expect(recordLookupFor({ kind: 'department' })).toEqual(KIND_TO_RECORD_LOOKUP.department);
    expect(recordLookupFor({ kind: 'position' })).toEqual(KIND_TO_RECORD_LOOKUP.position);
  });

  it('keeps a published non-data source off the record path', () => {
    // These are not pickers over rows: a closed enum, a runtime-resolved
    // value, and a type the runtime never resolves at all.
    expect(recordLookupFor({ kind: 'org-membership-level', source: { source: 'enum', values: ['owner'] } })).toBeUndefined();
    expect(recordLookupFor({ kind: 'manager', source: { source: 'auto' } })).toBeUndefined();
    expect(recordLookupFor({ kind: 'queue', source: { source: 'unsupported' } })).toBeUndefined();
  });

  it('renders a lookup for a data source this package has no presentation entry for', () => {
    // Better a working picker labelled by its committed column than degrading
    // a perfectly resolvable reference to free text.
    const lookup = recordLookupFor({
      kind: 'queue',
      source: { source: 'data', object: 'sys_queue', valueField: 'id' },
    });
    expect(lookup).toEqual({ object: 'sys_queue', valueField: 'id', displayField: 'id' });
  });

  it('resolves nothing for an unresolved reference', () => {
    expect(recordLookupFor(undefined)).toBeUndefined();
  });
});

describe('resolveRefKind — sources are keyed by the discriminator (#3508 follow-up)', () => {
  // Annotated with the spec type the resolver takes, so `map`'s values are
  // checked against `ReferenceKind` instead of widening to `string` — which is
  // what made this fixture unassignable the moment anything compiled it
  // (objectui#4040).
  const ref: FlowReferenceSpec = {
    kindFrom: 'type',
    map: { user: 'user', role: 'org-membership-level', org_membership_level: 'org-membership-level' },
    sources: {
      user: { source: 'data' as const, object: 'sys_user', valueField: 'id' },
      role: { source: 'enum' as const, values: ['owner', 'admin', 'member'] },
      org_membership_level: { source: 'enum' as const, values: ['owner', 'admin', 'member'] },
    },
  };

  it('carries the source for the row’s own type', () => {
    const resolved = resolveRefKind(ref, () => 'user');
    expect(resolved).toMatchObject({ kind: 'user', source: { source: 'data', object: 'sys_user' } });
  });

  it('distinguishes two discriminators that share one picker kind', () => {
    // `role` is the deprecated spelling of `org_membership_level`; both render
    // the same control, and a per-KIND lookup could not tell them apart.
    expect(resolveRefKind(ref, () => 'role')?.source).toEqual({ source: 'enum', values: ['owner', 'admin', 'member'] });
    expect(resolveRefKind(ref, () => 'org_membership_level')?.kind).toBe('org-membership-level');
  });

  it('leaves the source undefined when the server published none', () => {
    const bare = { kindFrom: 'type', map: { user: 'user' as const } };
    expect(resolveRefKind(bare, () => 'user')).toEqual({
      kind: 'user', objectSource: undefined, connectorSource: undefined, source: undefined,
    });
  });

  it('still returns undefined for a discriminator with no mapped kind', () => {
    expect(resolveRefKind(ref, () => 'nope')).toBeUndefined();
  });
});
