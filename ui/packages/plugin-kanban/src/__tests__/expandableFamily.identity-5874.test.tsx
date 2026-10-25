/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5874 — this package's private copy of the reference-bearing field
 * family converges onto `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`.
 *
 * The copy was the inline disjunction `isLookup` inside `resolveDisplay`, the
 * card-description helper in `ObjectKanban.tsx`. It neither derived from nor
 * pinned against the shared set, and it diverged from it in BOTH directions:
 * it lacked `user` and `tree`, and carried a fifth spelling `reference` that no
 * producer can emit.
 *
 * ## Why the load-bearing pin is IDENTITY, not membership
 *
 * Every membership assertion below is satisfied by a private
 * `new Set(['lookup', 'master_detail', 'tree', 'user'])` holding the same
 * strings — i.e. by a re-fork of exactly the kind this change removed. So the
 * pin that decides the convergence spies on the `has` of the object core
 * exports: a call is recorded only if the face under test consulted THAT
 * object, so a member-identical private copy leaves the spy empty and fails
 * here, where a value check would pass ON the defect. Same shape as
 * objectui#4770 / #4790 / #4815 / #5312 / #5692.
 *
 * ## Where the pin sits now — objectui#6063 moved it to the LIVE read
 *
 * As written for #5874 this pin was attributed to `resolveDisplay`, and its
 * docblock recorded a finding: that read could not be paired with a
 * behavioural counter-probe, because the guard holding it was unreachable —
 *
 *     if (isLookup && isOpaqueId(raw)) return undefined;
 *     if (isOpaqueId(raw)) return undefined;
 *
 * — the second line subsuming the first for every input, so `isLookup` could
 * not change any outcome, in EITHER direction, that `ObjectKanban`'s rendered
 * output could show. objectui#6063 settled that fork in favour of the
 * unconditional line (the suppression is a rule about the VALUE, not about the
 * declared type) and deleted the dead branch — which deleted `resolveDisplay`'s
 * read of the shared family along with it. The behaviour that survives there is
 * pinned in `resolveDisplay.opaqueId-6063.test.tsx`.
 *
 * So the convergence claim for this face is re-anchored onto the read that is
 * actually live: `buildExpandFields`, called from the same module on every
 * fetch. That read is the better subject in both halves — a re-fork leaves the
 * spy empty exactly as before, AND its membership delta is observable, so the
 * counter-probe the #5874 docblock had to record as ABSENT now exists (last
 * describe block: a `user`-typed field reaches the wire in `$expand`, a
 * `text`-typed one does not).
 *
 * Ablation direction, predicted before running: replace `buildExpandFields`'
 * consultation with a member-identical private table and every identity pin
 * below goes RED (the spy records no call) while the member-set assertion stays
 * GREEN — that contrast is the whole reason the pin is on identity rather than
 * on members.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import '../index';
// The cards asserted below render INSIDE `KanbanRenderer`'s `React.lazy`
// boundary. Importing the chunk at module scope bills the cold transform to the
// import phase (unbounded) instead of racing a `waitFor` budget under full
// parallelism — the objectui#3010 rule, same specifier as `index.tsx`'s factory
// so ESM's module cache makes that factory resolve immediately.
import '../KanbanImpl';

/**
 * The spec's own `FieldType` vocabulary.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924);
 * the THROW stays HERE, because the reader deliberately answers `[]` rather than
 * raising and this read is module-scope. What it replaces was a NON-OPTIONAL
 * cast of the enum node to an options-bearing shape, spread directly — which
 * failed LOUDLY the moment the cast stopped holding (spreading `undefined`
 * throws), so a bare `enumOptions` call here would have traded a loud failure
 * for a silently empty vocabulary: every assertion below would then pass over
 * nothing. That trade is the regression objectui#7025 exists to refuse. (The
 * retired spelling is deliberately NOT quoted here: the card's enumeration
 * instrument is a grep for it, and a comment carrying the literal text makes
 * every future re-derivation of this population read a false positive.)
 */
const readSpecFieldTypes = (): readonly string[] => {
  const options = enumOptions(FieldType);
  if (options.length === 0) {
    throw new Error('could not read FieldType.options from @objectstack/spec');
  }
  return options;
};

const SPEC_FIELD_TYPES: readonly string[] = readSpecFieldTypes();

/**
 * A board with NO `cardFields` and NO `highlightFields`, so cards fall to the
 * legacy semantic heuristic — the only branch that calls `resolveDisplay`, and
 * therefore the only branch that reaches the converged guard. `account` and
 * `owner` are two of the hard-coded keys that helper probes.
 */
function makeAdapter(fieldTypes: Record<string, string>) {
  return {
    find: vi.fn().mockResolvedValue({
      data: [
        {
          id: '1',
          name: 'Acme renewal',
          status: 'open',
          account: 'aXbY9zHWBfjYjZ4',
          owner: 'qWeRtY7uIoPa1Sd',
        },
      ],
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'deal',
      fields: {
        name: { type: 'text' },
        status: { type: 'text' },
        account: { type: fieldTypes.account ?? 'lookup' },
        owner: { type: fieldTypes.owner ?? 'user' },
      },
    }),
  };
}

async function renderBoard(fieldTypes: Record<string, string> = {}) {
  return (await renderBoardWith(makeAdapter(fieldTypes))).container;
}

async function renderBoardWith(adapter: ReturnType<typeof makeAdapter>) {
  const { container } = render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'deal',
            groupBy: 'status',
            columns: [{ id: 'open', title: 'Open' }],
          } as any
        }
      />
    </SchemaRendererProvider>,
  );
  // The cards render past a Suspense boundary and after the fetch resolves.
  await waitFor(() => expect(container.textContent).toContain('Acme renewal'));
  return { container, adapter };
}

/**
 * Record every `EXPANDABLE_FIELD_TYPES.has` call made while `exercise()` runs,
 * ATTRIBUTED to the function that made it, and return the arguments that came
 * from the named read site alone.
 *
 * ⚠️ The attribution is load-bearing, not decoration. `ObjectKanban.tsx` also
 * imported `buildExpandFields`, which consults the SAME shared object once per
 * schema field on every render. While `resolveDisplay` still held a read of its
 * own, a bare `vi.spyOn(...).mock.calls` pin therefore stayed GREEN with that
 * site re-forked — measured, not feared: the first draft of this file did
 * exactly that and survived its own ablation, so the pin was reporting on
 * `buildExpandFields`' calls and pinning nothing.
 *
 * objectui#6063 deleted that second site, so `buildExpandFields` is now the
 * only reader in this render (pinned executably below) and the filter is
 * currently equivalent to no filter. It is kept so that the day a second reader
 * appears it cannot silently satisfy this pin — the failure this file has
 * already been bitten by once.
 *
 * The frame name IS the read site's identifier. Renaming the read site must
 * update this helper — the pin naming the site it guards is the point.
 */
function hasCallsFrom(site: string, exercise: () => Promise<unknown>) {
  const seen: string[] = [];
  const real = EXPANDABLE_FIELD_TYPES.has.bind(EXPANDABLE_FIELD_TYPES);
  const spy = vi
    .spyOn(EXPANDABLE_FIELD_TYPES, 'has')
    .mockImplementation((key: string) => {
      if (new Error().stack?.includes(site)) seen.push(key);
      return real(key);
    });
  return exercise().then(
    () => {
      spy.mockRestore();
      return seen;
    },
    (err) => {
      spy.mockRestore();
      throw err;
    },
  );
}

afterEach(() => {
  // The pin installs a spy on the Set object EXPORTED by core — a shared,
  // module-level object. A leaked spy would follow every later file in the
  // worker, so restoring is not optional here.
  vi.restoreAllMocks();
});

describe("the kanban card's relation rule is core's object, not a copy (objectui#5874)", () => {
  it('the board asks `@object-ui/core` EXPANDABLE_FIELD_TYPES on the lookup path', async () => {
    // The spy is installed on the Set exported by core and records a call only
    // if THAT object was consulted, from THIS read site. A member-identical
    // private copy leaves it empty, so this fails where a value check passes.
    // `owner` is typed OUT of the family here so the recorded `lookup` can only
    // have come from the field this case is about.
    const calls = await hasCallsFrom('buildExpandFields', () =>
      renderBoard({ account: 'lookup', owner: 'text' }),
    );
    expect(calls).toContain('lookup');
    expect(calls).not.toContain('user');
  });

  it('reaches that object on the person path too, not just the lookup path', async () => {
    // `user` and `lookup` are different members of the same set; a convergence
    // that reconnected one spelling only would leave the other forked. Typed
    // symmetrically to the case above, so neither spelling can be supplied by
    // the other field.
    const calls = await hasCallsFrom('buildExpandFields', () =>
      renderBoard({ account: 'text', owner: 'user' }),
    );
    expect(calls).toContain('user');
    expect(calls).not.toContain('lookup');
  });

  it('that builder is the only reader in this render — what the frame filter rests on', async () => {
    // The frame filter is only equivalent to an unattributed spy while this
    // holds, and it did NOT hold for these pins' ancestors: until objectui#6063
    // deleted `resolveDisplay`'s dead read, an unattributed spy was satisfied
    // by THIS call site while the site under test was forked. Red here means a
    // second reader has appeared and the filter has become load-bearing again —
    // keep the filter and update the docblock, don't relax this.
    // `real` is bound BEFORE the spy is installed. Bound after, it would be
    // the spy itself and the implementation below would recurse into it —
    // which is not a red assertion but a broken render, measured the hard way.
    const real = EXPANDABLE_FIELD_TYPES.has.bind(EXPANDABLE_FIELD_TYPES);
    const stacks: string[] = [];
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    spy.mockImplementation((key: string) => {
      stacks.push(new Error().stack ?? '');
      return real(key);
    });
    try {
      await renderBoard({ account: 'lookup' });
      expect(stacks.length).toBeGreaterThan(0);
      expect(stacks.filter((st) => st.includes('buildExpandFields'))).toHaveLength(
        stacks.length,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('a member-identical private copy would NOT satisfy the pin — the contrast', () => {
    // Documents, executably, why the two pins above are not membership checks:
    // this assertion is true of the shared object AND of any private set
    // holding the same strings, so it cannot tell a converged face from a
    // re-forked one. The spies above can.
    const memberIdenticalCopy = new Set(['lookup', 'master_detail', 'tree', 'user']);
    expect([...EXPANDABLE_FIELD_TYPES].sort()).toEqual([...memberIdenticalCopy].sort());
    expect(EXPANDABLE_FIELD_TYPES).not.toBe(memberIdenticalCopy);
  });
});

describe('the card still renders — regression control', () => {
  // Must stay green through BOTH ablation legs. If it moves, the convergence
  // took the card renderer with it and the pin above is reporting on rubble
  // rather than on a re-homed rule.
  it('a board with no card config still renders its records', async () => {
    const container = await renderBoard();
    expect(container.textContent).toContain('Acme renewal');
    expect(container.textContent).toContain('Open');
  });
});

describe('the `reference` drop is a no-op on real data — the measured direction', () => {
  /**
   * The measurement, kept as an executable pin rather than as prose in a PR.
   * Controls run on the same read as the subject, so a probe that had lost hold
   * of the vocabulary (an empty list, the wrong export) fails as a broken probe
   * instead of reporting the subject absent.
   */
  it('every LIVE control IS a spec `FieldType`, and every DEAD one is not', () => {
    for (const type of EXPANDABLE_FIELD_TYPES) {
      expect(SPEC_FIELD_TYPES, `'${type}' is not a spec FieldType`).toContain(type);
    }
    expect(SPEC_FIELD_TYPES).not.toContain('owner');
    expect(SPEC_FIELD_TYPES).not.toContain('zzz_not_a_field_type');
  });

  it('SUBJECT — `reference` is not a declarable field type', () => {
    // The whole licence for dropping it. If the spec ever adds the spelling,
    // this goes red and the "should the shared family gain `reference`?"
    // question reopens — deliberately, rather than the drop remaining correct
    // only by accident.
    expect(SPEC_FIELD_TYPES).not.toContain('reference');
  });
});

describe('the membership delta is OBSERVABLE on this read — the counter-probe #5874 could not write', () => {
  /**
   * What #5874 had to record as missing. Attributed identity says the face
   * consulted core's object; this says what consulting it CHANGES, on the one
   * surface where the difference is visible — the query the board sends.
   *
   * `owner` is `user`-typed, and `user` is a member the literal that used to
   * stand in `resolveDisplay` lacked. So this pair is exactly the delta the
   * convergence introduced, read off the wire instead of off the DOM.
   *
   * ⚠️ This wait exists to keep the negative case from going green against a
   * query that had not been built yet — the vacuous form of this assertion. It
   * used to spell that as "wait for a SECOND call", because the board fetched
   * twice: once before the object definition resolved (no field types known,
   * so no `$expand` computable) and again once it arrived, and only the second
   * could carry the delta.
   *
   * objectui#6271 gated the query on the definition instead, so there is now
   * exactly ONE call and it is the schema-informed one. The wait moved with it
   * — same condition ("a query built from resolved field types has been
   * issued"), spelled against the ordering that actually holds. ⛔ Do not read
   * this as a weakened wait: what makes one call sufficient is the gate. If
   * that gate is ever removed, the pre-resolution query comes back, this wait
   * starts admitting it, and the negative case below goes vacuous again —
   * `fetchGate.objectDef-6271.test.tsx` is what fails first if anyone tries.
   */
  const awaitSchemaFetch = (adapter: ReturnType<typeof makeAdapter>) =>
    waitFor(() => expect(adapter.find.mock.calls.length).toBeGreaterThanOrEqual(1));

  const everyExpand = (adapter: ReturnType<typeof makeAdapter>): string[] =>
    adapter.find.mock.calls.flatMap(
      ([, query]) => ((query as Record<string, unknown>).$expand as string[] | undefined) ?? [],
    );

  it('a `user`-typed field is expanded', async () => {
    const { adapter } = await renderBoardWith(makeAdapter({ account: 'text', owner: 'user' }));
    await awaitSchemaFetch(adapter);
    expect(everyExpand(adapter)).toContain('owner');
    // The control travels with the subject: a field typed OUT of the family in
    // the same query, so "everything is expanded" cannot pass as the delta.
    expect(everyExpand(adapter)).not.toContain('account');
  });

  it('the same field typed `text` is NOT expanded — the other direction', async () => {
    const { adapter } = await renderBoardWith(makeAdapter({ account: 'text', owner: 'text' }));
    await awaitSchemaFetch(adapter);
    expect(everyExpand(adapter)).not.toContain('owner');
  });
});
