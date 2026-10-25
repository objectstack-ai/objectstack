// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5309 — the approver membership-tier select must offer the tiers the
 * SERVER accepts, never a list hand-spelled in this package.
 *
 * The picker used to carry a literal `owner` / `admin` / `member` array under a
 * comment attributing the set to better-auth. ADR-0105 D8 added
 * `delegated_admin` to `sys_member.role`, and the copy went stale in the two
 * ways a stale vocabulary always goes wrong:
 *
 *   1. the tier could not be PICKED — the control offered a quarter less than
 *      the column stores and the schema publishes;
 *   2. a stored `{ type: 'org_membership_level', value: 'delegated_admin' }`
 *      row rendered as `delegated_admin (invalid)` — a spec-valid,
 *      runtime-resolvable approver labelled invalid to the author's face.
 *
 * Load-bearing behaviours, in the order the fix establishes them:
 *
 *   1. a SERVER-published enum (`xRef.sources[...]`, carried through by
 *      `json-schema-to-fields`) wins over the local fallback — the same
 *      precedence rule this file already applies to record lookups, and the
 *      only one that cannot drift from what the engine accepts;
 *   2. the published vocabulary is used VERBATIM — order included — so the
 *      picker cannot quietly re-impose a local ordering;
 *   3. a tier the local pin has never heard of still renders as a real,
 *      humanized choice rather than a raw token;
 *   4. with NO published source (a server predating the annotation) the
 *      fallback is DERIVED from the spec's own published option list, so it is
 *      not a second source of truth and cannot go stale the way the literal
 *      did;
 *   5. an empty / non-enum source falls back rather than rendering an EMPTY
 *      strict select — a select with nothing in it traps the author, the one
 *      thing this control must never do;
 *   6. the reported symptom: a stored `delegated_admin` stops rendering
 *      "(invalid)" — while a genuinely out-of-vocabulary value still does.
 *
 * ## Pin state at the time of writing (deliberate, read before editing)
 *
 * This repo pins `@objectstack/spec@17.0.0`, which does NOT yet carry
 * objectstack#9942 (`ORG_MEMBERSHIP_LEVELS` derived from
 * `BUILTIN_MEMBERSHIP_ROLES`): its `APPROVER_VALUE_SOURCES.org_membership_level`
 * projection still publishes three values. Nothing here asserts that
 * projection — it would be red for reasons unrelated to this behaviour.
 *
 * What this pin DOES carry is `BUILTIN_MEMBERSHIP_ROLE_OPTIONS`, already the
 * whole four-value vocabulary with labels, which the spec documents as "the
 * picker's vocabulary". That is what the fallback derives from, so every
 * assertion below holds under the current pin AND after the bump.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BUILTIN_MEMBERSHIP_ROLE_OPTIONS } from '@objectstack/spec/identity';

const state = vi.hoisted(() => {
  const metaList = vi.fn(async () => [] as unknown[]);
  return {
    metaList,
    // STABLE identity, like the real memoized client — a fresh `{ list }` per
    // render would setState → re-render → setState forever and hang the run.
    metadataClient: { list: metaList },
  };
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: () => <div data-testid="record-lookup" />,
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { ReferenceCombobox, membershipLevelOptions } from './FlowReferenceField';
import type { RefValueSource } from './flow-node-config';

afterEach(() => {
  cleanup();
  state.metaList.mockClear();
});

/** The four-value vocabulary as a server that carries objectstack#9942 publishes it. */
const SERVER_FOUR: RefValueSource = {
  source: 'enum',
  values: ['member', 'delegated_admin', 'admin', 'owner'],
};

function renderTier(value: string, source?: RefValueSource) {
  return render(
    <ReferenceCombobox
      resolved={{ kind: 'org-membership-level', source }}
      value={value}
      onCommit={vi.fn()}
    />,
  );
}

describe('membershipLevelOptions — the published enum wins (objectui#5309)', () => {
  it('uses the server vocabulary VERBATIM, order included', () => {
    // Deliberately NOT the spec's display order: if the picker re-imposed its
    // own list this would come back owner-first, and a server that reorders
    // (or narrows) its enum would be silently overridden.
    expect(membershipLevelOptions(SERVER_FOUR).map((o) => o.value)).toEqual([
      'member',
      'delegated_admin',
      'admin',
      'owner',
    ]);
  });

  it('offers exactly what the server published, even when that is NARROWER', () => {
    // A stack that restricts the tier vocabulary must not have the local list
    // silently merged back in — that is the drift this whole card is about.
    const narrowed = membershipLevelOptions({ source: 'enum', values: ['owner', 'member'] });
    expect(narrowed.map((o) => o.value)).toEqual(['owner', 'member']);
    expect(narrowed.map((o) => o.label)).toEqual(['Owner', 'Member']);
  });

  it('humanizes a tier this pin has never heard of instead of showing a raw token', () => {
    // The forward-compatibility half: the next vocabulary addition renders as
    // a real choice on an un-bumped objectui, rather than as `regional_lead`.
    const opts = membershipLevelOptions({ source: 'enum', values: ['owner', 'regional_lead'] });
    expect(opts).toEqual([
      { value: 'owner', label: 'Owner' },
      { value: 'regional_lead', label: 'Regional Lead' },
    ]);
  });
});

describe('membershipLevelOptions — the fallback is derived, not restated (objectui#5309)', () => {
  it('falls back to the spec-published option list when the server publishes none', () => {
    // The derivation pin: re-hardcoding a literal here goes red, whatever the
    // literal says, because it can only match by copying the spec.
    expect(membershipLevelOptions(undefined)).toEqual(
      BUILTIN_MEMBERSHIP_ROLE_OPTIONS.map(({ value, label }) => ({ value, label })),
    );
  });

  it('offers delegated_admin on the fallback path too', () => {
    // The reported defect, at the vocabulary level: this is what the literal
    // `owner` / `admin` / `member` array could not do. Assertable on the
    // CURRENT pin — `BUILTIN_MEMBERSHIP_ROLE_OPTIONS` is already four-valued.
    const values = membershipLevelOptions(undefined).map((o) => o.value);
    expect(values).toContain('delegated_admin');
    // Counter-probe for the assertion above: a term that is genuinely absent,
    // so `toContain` is shown to be capable of failing here.
    expect(values).not.toContain('sales_manager');
    expect(membershipLevelOptions(undefined).find((o) => o.value === 'delegated_admin')?.label)
      .toBe('Delegated Admin');
  });

  it('falls back rather than rendering an EMPTY strict select', () => {
    // A published-but-empty enum is the one input that could leave the author
    // with a select containing nothing at all.
    expect(membershipLevelOptions({ source: 'enum', values: [] })).toEqual(
      membershipLevelOptions(undefined),
    );
  });

  it('falls back for a source that is not an enum at all', () => {
    for (const source of [{ source: 'auto' }, { source: 'unsupported' }] as RefValueSource[]) {
      expect(membershipLevelOptions(source)).toEqual(membershipLevelOptions(undefined));
    }
  });
});

describe('ReferenceCombobox — a stored delegated_admin is not "(invalid)" (objectui#5309)', () => {
  it('renders the stored tier as a real choice with no published source', () => {
    // THE reported symptom, on the path an un-annotated server takes.
    renderTier('delegated_admin');
    expect(screen.getByText('Delegated Admin')).toBeInTheDocument();
    expect(screen.queryByText('delegated_admin (invalid)')).not.toBeInTheDocument();
  });

  it('renders the stored tier as a real choice when the server publishes the enum', () => {
    renderTier('delegated_admin', SERVER_FOUR);
    expect(screen.getByText('Delegated Admin')).toBeInTheDocument();
    expect(screen.queryByText('delegated_admin (invalid)')).not.toBeInTheDocument();
  });

  it('still flags a value the SERVER says is outside its vocabulary', () => {
    // The flag must keep meaning something: with a narrowed server enum,
    // `delegated_admin` really is not storable, and hiding that would be the
    // opposite error to the one being fixed.
    renderTier('delegated_admin', { source: 'enum', values: ['owner', 'member'] });
    expect(screen.getByText('delegated_admin (invalid)')).toBeInTheDocument();
  });

  it('still flags genuinely dirty legacy data', () => {
    // NOTE: green both before and after this change — it pins the "(invalid)"
    // affordance against a fix-by-deletion, not the fix itself.
    renderTier('sales_manager');
    expect(screen.getByText('sales_manager (invalid)')).toBeInTheDocument();
  });
});
