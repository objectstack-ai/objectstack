// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4646] The related-list toolbar's "+ New" and the child object's
 * `userActions.create` predicates.
 *
 * `@objectstack/spec@17.0.0` widened `userActions.create` to
 * `z.union([z.boolean(), RowCrudActionOverrideSchema])`, so
 * `resolveCrudAffordances` emits `createPredicates` — and, until this change,
 * nothing in objectui read them: `createPredicates` had ZERO consumers against
 * roughly fifteen apiece for `editPredicates` / `deletePredicates`. A parent
 * record entering a frozen state greyed its children's row Edit/Delete
 * correctly while "+ New" stayed fully live.
 *
 * The binding under test is the spec docblock's: unlike the ROW predicates,
 * these evaluate ONCE per toolbar against the record of the scope the toolbar
 * sits in — on a record page's related list, the HOST PARENT record. So the
 * subject of every predicate below is the parent, never a child row.
 *
 * Pinned here: hidden vs disabled kept distinct (`visibleWhen` removes the
 * button, `disabledWhen` greys it), both fail directions, the boolean arm of
 * the union left untouched, and the ordering against the object-level gates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Controllable principal verdict, keyed by action — same double the sibling
// `RelatedRecordActionsBridge.effectiveOps.test.tsx` uses. `undefined` entries
// default to allowed, matching `can()`'s permissive fallback.
let principal: Record<string, boolean> = {};

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      getObjectApiOperations: () => undefined,
      can: (_name: string, action: string) => principal[action] ?? true,
      // Field-level read, open: the bridge reads it for "View all" (objectui#12741).
      checkField: () => true,
    }),
  };
});

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import { useRelatedRecordActions } from '@object-ui/react';

const CHILD = 'invoice';

/** The real `userActions.create.visibleWhen` shape, on the PARENT's fields. */
const NOT_FROZEN = 'record.frozen != true';
/** Its `disabledWhen` counterpart — HOLDS for the frozen parent, so it greys. */
const IS_FROZEN = 'record.frozen == true';

/** Host parent records. The predicates above are evaluated against THESE. */
const FROZEN_PARENT = { id: 'p1', name: 'Published Order', frozen: true };
const DRAFT_PARENT = { id: 'p2', name: 'Draft Order', frozen: false };

/** The parent object's field definitions, threaded through like the real host. */
const PARENT_FIELDS = {
  id: { type: 'text' },
  name: { type: 'text' },
  frozen: { type: 'boolean' },
};

/** A child object whose `userActions.create` carries the given override. */
function childObjects(create: unknown) {
  return [{ name: CHILD, managedBy: 'platform', userActions: { create } }];
}

interface Resolved {
  onCreate: boolean;
  createDisabled: boolean | undefined;
  onEdit: boolean;
  onDelete: boolean;
}

/** Probe: resolves the child's handlers and reports the create verdicts. */
function Probe({ onResolve }: { onResolve: (r: Resolved) => void }) {
  const api = useRelatedRecordActions();
  const handlers = api?.resolve({ objectName: CHILD, relationshipField: 'order', parentId: 'p1' }) ?? {};
  onResolve({
    onCreate: typeof handlers.onCreate === 'function',
    createDisabled: handlers.createDisabled,
    onEdit: typeof handlers.onEdit === 'function',
    onDelete: typeof handlers.onDelete === 'function',
  });
  return null;
}

function resolveWith(opts: {
  create: unknown;
  parentRecord?: Record<string, any> | null;
}): Resolved {
  let captured = {} as Resolved;
  render(
    <MemoryRouter>
      <RelatedRecordActionsBridge
        appName="crm"
        objects={childObjects(opts.create)}
        dataSource={{ delete: vi.fn() }}
        parentObjectName="order"
        parentRecordId="p1"
        parentRecord={'parentRecord' in opts ? opts.parentRecord : DRAFT_PARENT}
        parentObjectFields={PARENT_FIELDS}
      >
        <Probe onResolve={(r) => { captured = r; }} />
      </RelatedRecordActionsBridge>
    </MemoryRouter>,
  );
  return captured;
}

beforeEach(() => {
  principal = {};
});
afterEach(() => {
  cleanup();
});

describe('#4646 — related-list "+ New" consumes userActions.create.visibleWhen', () => {
  it('a FROZEN parent hides "+ New" on the child list', () => {
    const h = resolveWith({
      create: { enabled: true, visibleWhen: NOT_FROZEN },
      parentRecord: FROZEN_PARENT,
    });
    expect(h.onCreate).toBe(false);
    // Control group: the other affordances are untouched by a CREATE predicate,
    // so the absence above is the predicate's doing and not a dead bridge.
    expect(h.onEdit).toBe(true);
    expect(h.onDelete).toBe(true);
  });

  it('a DRAFT parent keeps "+ New", undisabled', () => {
    const h = resolveWith({
      create: { enabled: true, visibleWhen: NOT_FROZEN },
      parentRecord: DRAFT_PARENT,
    });
    expect(h.onCreate).toBe(true);
    expect(h.createDisabled).toBeFalsy();
  });

  it('`visibleWhen: false` hides it — a declared gate, not an "ungated" reading', () => {
    // The objectui#3492 invariant: declared-ness is `!= null`, never truthiness.
    const h = resolveWith({
      create: { enabled: true, visibleWhen: false },
      parentRecord: DRAFT_PARENT,
    });
    expect(h.onCreate).toBe(false);
  });

  it('an unevaluable visibleWhen fails CLOSED', () => {
    const h = resolveWith({
      create: { enabled: true, visibleWhen: 'record.frozen ==' },
      parentRecord: DRAFT_PARENT,
    });
    expect(h.onCreate).toBe(false);
  });

  it('no parent record in scope fails CLOSED for a declared visibleWhen', () => {
    // A `record.*` predicate with nothing to bind cannot answer; the safe
    // direction for a visibility gate is to withhold the affordance.
    const h = resolveWith({
      create: { enabled: true, visibleWhen: NOT_FROZEN },
      parentRecord: null,
    });
    expect(h.onCreate).toBe(false);
  });
});

describe('#4646 — disabledWhen greys "+ New" instead of removing it', () => {
  it('a FROZEN parent leaves the button present but disabled', () => {
    const h = resolveWith({
      create: { enabled: true, disabledWhen: IS_FROZEN },
      parentRecord: FROZEN_PARENT,
    });
    // The whole point of the second channel: still offered, just not pressable.
    expect(h.onCreate).toBe(true);
    expect(h.createDisabled).toBe(true);
  });

  it('a DRAFT parent leaves it enabled', () => {
    const h = resolveWith({
      create: { enabled: true, disabledWhen: IS_FROZEN },
      parentRecord: DRAFT_PARENT,
    });
    expect(h.onCreate).toBe(true);
    expect(h.createDisabled).toBeFalsy();
  });

  it("`disabledWhen: ''` reads as no condition, not as disable", () => {
    // The `!= null` gate lives OUTSIDE the evaluation, so an empty predicate is
    // "nothing declared" rather than an unevaluable one that greys forever.
    const h = resolveWith({
      create: { enabled: true, disabledWhen: '' },
      parentRecord: FROZEN_PARENT,
    });
    expect(h.onCreate).toBe(true);
    expect(h.createDisabled).toBeFalsy();
  });

  it('an unevaluable disabledWhen fails SOFT — the button stays pressable', () => {
    // Opposite fail direction from visibleWhen, deliberately: a broken predicate
    // must not grey an affordance forever.
    const h = resolveWith({
      create: { enabled: true, disabledWhen: 'record.frozen ==' },
      parentRecord: FROZEN_PARENT,
    });
    expect(h.onCreate).toBe(true);
    expect(h.createDisabled).toBeFalsy();
  });

  it('visibleWhen wins over disabledWhen — hidden beats greyed', () => {
    const h = resolveWith({
      create: { enabled: true, visibleWhen: NOT_FROZEN, disabledWhen: IS_FROZEN },
      parentRecord: FROZEN_PARENT,
    });
    expect(h.onCreate).toBe(false);
  });
});

describe('#4646 — the boolean arm of the union is untouched', () => {
  it('`create: true` (bare boolean) offers "+ New" with no predicate evaluation', () => {
    const h = resolveWith({ create: true, parentRecord: FROZEN_PARENT });
    expect(h.onCreate).toBe(true);
    expect(h.createDisabled).toBeFalsy();
  });

  it('`create: false` (bare boolean) still hides it', () => {
    const h = resolveWith({ create: false, parentRecord: DRAFT_PARENT });
    expect(h.onCreate).toBe(false);
  });

  it('no `userActions` at all keeps the platform-bucket default', () => {
    let captured = {} as Resolved;
    render(
      <MemoryRouter>
        <RelatedRecordActionsBridge
          appName="crm"
          objects={[{ name: CHILD, managedBy: 'platform' }]}
          dataSource={{ delete: vi.fn() }}
          parentRecord={FROZEN_PARENT}
        >
          <Probe onResolve={(r) => { captured = r; }} />
        </RelatedRecordActionsBridge>
      </MemoryRouter>,
    );
    expect(captured.onCreate).toBe(true);
    expect(captured.createDisabled).toBeFalsy();
  });

  it('a host that threads NO parent record keeps predicate-less children working', () => {
    // The overwhelmingly common case, and the one that must not regress: with
    // nothing declared there is nothing to evaluate, so the missing record is
    // never consulted.
    const h = resolveWith({ create: true, parentRecord: null });
    expect(h.onCreate).toBe(true);
  });
});

describe('#4646 — predicates sit UNDER the object-level gates, never over them', () => {
  it('a principal without `create` loses "+ New" even when the predicate passes', () => {
    principal = { create: false };
    const h = resolveWith({
      create: { enabled: true, visibleWhen: NOT_FROZEN },
      parentRecord: DRAFT_PARENT,
    });
    expect(h.onCreate).toBe(false);
    // …and the disabled channel must not light up for a hidden affordance.
    expect(h.createDisabled).toBeFalsy();
  });

  it('`enabled: false` closes it regardless of a passing visibleWhen', () => {
    const h = resolveWith({
      create: { enabled: false, visibleWhen: NOT_FROZEN },
      parentRecord: DRAFT_PARENT,
    });
    expect(h.onCreate).toBe(false);
  });
});
