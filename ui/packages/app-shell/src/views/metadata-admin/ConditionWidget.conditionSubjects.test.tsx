// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generic condition mount offers the subjects ITS OWN metadata type's
 * evaluator binds — objectui#9953, the polymorphic mount the two curated ones
 * could not be copied onto.
 *
 * ## The defect these cases reproduce
 *
 * `CONDITION_SCOPE_BY_METADATA_TYPE` rules `action`, `hook` and `validation`
 * all `'record'`, and all three verdicts are right — every one of those
 * evaluators binds the row as the `record` ROOT. But that table answers how a
 * predicate is LINTED, and the hosts disagree about something it does not
 * carry: what they BIND. A hook's condition and a validation rule's guard are
 * evaluated on the SERVER against `record` and `previous` alone; an action's
 * `visible` is evaluated in the BROWSER, where `user` really is bound.
 *
 * So the one-line `subjects={{ context: RECORD_CONDITION_SUBJECTS }}` the two
 * curated inspectors took could not be copied here a third time: at this mount
 * it would be right for a hook and would take a working subject away from an
 * action. `RECORD_CONDITION_SUBJECTS` states the same refusal from the
 * component's side — it is declared by a mount, never derived from
 * `scope === 'record'`. `conditionSubjectsForMetadataType` is the missing half:
 * the per-type derivation that lets one mount answer for many hosts.
 *
 * ## Reachability is MEASURED here, not assumed
 *
 * The card left it open whether a server-evaluated condition reaches this
 * generic mount at all, since `HookDefaultInspector` hides `condition` from its
 * own fallback form. It does reach it, by the route the first case takes:
 * `hook` has no registered preview, so `ResourceEditPage` renders its plain
 * branch — the whole-draft `SchemaForm` carrying the derived `WidgetContext` —
 * and the curated inspector, which lives on the canvas branch, never runs. That
 * case mounts the real host so the route is re-measured on every run rather
 * than recorded in this paragraph.
 *
 * ## Derived, not retyped
 *
 * The narrowed list is never spelled out here. Each case reads what the default
 * vocabulary actually renders, then asserts about ROOTS against
 * `RECORD_CONDITION_ROOTS` — the binding set the server hosts were measured to
 * have. A subject added to the default list reddens these cases if the hook
 * mount starts offering it, and the client-tier case reddens if a narrowing
 * ever reaches the mounts that legitimately bind `user`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// lint behind `celAuthoring`'s dynamic `import('@objectstack/formula')` is
// mounted by the raw editor this page also renders, and a cold first load has
// been measured near a `waitFor`'s whole budget. The specifier must match
// `loadFormula`'s exactly — ESM caches by resolved specifier.
import '@objectstack/formula';

/** A hook whose condition PARSES into one builder row, so a subject dropdown exists. */
const HOOK = {
  name: 'stamp',
  label: 'Stamp',
  object: 'invoice',
  events: ['beforeInsert'],
  condition: "record.id == 'x'",
};

/**
 * The server's `/meta/types` row for `hook`, reduced to what these cases read.
 *
 * ⚠️ A fixture, and the honest part to name: these cases pin the DERIVATION and
 * the route, not which keys a hook's published schema carries.
 */
const HOOK_ENTRY = {
  type: 'hook',
  name: 'hook',
  label: 'Hook',
  // What makes the item writable, and therefore what makes an Edit button exist.
  allowEnvironmentOverlay: true,
  schema: {
    type: 'object',
    properties: {
      label: { type: 'string', title: 'Label' },
      // Routed to the condition widget BY NAME — `condition` is in
      // `SchemaForm`'s `CONDITION_FIELD_NAMES`.
      condition: { type: 'string', title: 'Run only when' },
    },
  },
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: HOOK, code: HOOK, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
};

// One mock serves both harnesses below: the page needs the type row, and
// `ConditionBuilder` calls `useObjectFields` unconditionally (objectui#4697), so
// an unmocked client would let a mount-time fetch escape to the real network.
vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [HOOK_ENTRY] }),
  };
});

import { SchemaForm } from './SchemaForm';
import type { WidgetContext } from './widgets';
import {
  CONDITION_SCOPE_BY_METADATA_TYPE,
  CONDITION_HOST_BY_METADATA_TYPE,
  conditionSubjectsForMetadataType,
} from './conditionScope';
import {
  RECORD_CONDITION_ROOTS,
  RECORD_CONDITION_SUBJECTS,
} from './inspectors/ConditionBuilder';
import { MetadataResourceEditPage } from './ResourceEditPage';
// The load-time registrations, exactly as the package entry runs them, so the
// branch the page takes below is the branch production takes.
import './register-builtins';
// The built-in designers, which the package entry registers from a chunk it
// loads with a dynamic `import()` (objectui#11939 step 2): called here, at
// module scope, so they are registered before the first render.
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

afterEach(cleanup);

/** A schema whose one field is routed to the condition widget BY NAME. */
const SCHEMA = {
  type: 'object',
  properties: { condition: { type: 'string', title: 'Run only when' } },
} as never;

function Harness({ context }: { context?: WidgetContext }) {
  const [value, setValue] = React.useState<Record<string, unknown>>({
    condition: HOOK.condition,
  });
  return (
    <SchemaForm
      schema={SCHEMA}
      value={value}
      onChange={(next) => setValue(next as Record<string, unknown>)}
      widgetContext={context}
    />
  );
}

/** The root of a subject spelling — `user` for `user.isAdmin`. */
const rootOf = (subject: string) => subject.split('.')[0];

/**
 * Open the subject dropdown inside the condition group and read what it offers.
 *
 * The subject `Select` is the first combobox in the row; Radix renders its items
 * into a portal, so the options are read off the document rather than the group.
 */
async function offeredSubjects(): Promise<string[]> {
  const group = await screen.findByRole('group', { name: /Run only when/ });
  await userEvent.click(within(group).getAllByRole('combobox')[0]);
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
}

/** Open the hook editor at the real host and enter edit mode. */
async function openHookEditor(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/metadata/hook/stamp']}>
      <MetadataResourceEditPage type="hook" name="stamp" />
    </MemoryRouter>,
  );
  // The host renders an Edit affordance twice (page header and toolbar); either
  // enters edit mode, and WHICH one is not these cases' subject.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]);
}

/* ── The measurement: the route, and what it offers at the far end ───────── */

describe('the generic condition mount, editing a SERVER-evaluated type (objectui#9953)', () => {
  it('reaches the generic widget for a hook at all — the route the card left unmeasured', async () => {
    // Reachability, taken rather than reasoned about. `hook` has a registered
    // default inspector but NO registered preview, and the inspector panel that
    // would host it only exists on the canvas branch — so the plain branch runs
    // and routes `condition` to the generic widget by name. If that ever stops
    // being true, this case is what says so, and the narrowing below becomes
    // dead weight rather than silently guarding nothing.
    await openHookEditor();
    const group = await screen.findByRole('group', { name: /Run only when/ });
    // The builder's raw/visual toggle is its signature — the plain `none`
    // editor has none, and neither does a curated inspector's hidden field.
    expect(within(group).getByText('Expression')).toBeInTheDocument();
  });

  it('offers no subject whose root the server host leaves unbound', async () => {
    // THE GATE. Derived from the binding set the hook wrapper was measured to
    // have, not from a copy of the narrowed list: `wrapDeclarativeHook`
    // evaluates the condition against `record` and `previous` and throws when
    // it cannot, so a subject under any other root compiles a row that can only
    // abort the write.
    await openHookEditor();
    const offered = await offeredSubjects();
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((s) => !RECORD_CONDITION_ROOTS.includes(rootOf(s)))).toEqual([]);
  });

  it('still offers the subject the server host DOES bind', async () => {
    // The must-not-break half of every narrowing. A mount that offered nothing
    // would pass the case above for free.
    await openHookEditor();
    const offered = await offeredSubjects();
    for (const s of RECORD_CONDITION_SUBJECTS) expect(offered).toContain(s.value);
  });
});

/* ── The control: the client tier keeps the subject it really binds ──────── */

describe('the generic condition mount, editing a CLIENT-evaluated type (objectui#9953)', () => {
  it('keeps every default subject, including the roots only a browser host binds', async () => {
    // This is the case that makes the derivation a derivation rather than a
    // third copy of the curated declaration. An action's `visible` is evaluated
    // where `buildExpressionScope` binds `user`, so narrowing here would take a
    // subject an author can legitimately pick — and a row that really matches —
    // away from a working tier. It is fed the derivation's OWN answer for that
    // tier, so it reddens if the narrowing ever reaches it.
    render(
      <Harness
        context={{
          conditionScope: 'record',
          conditionSubjects: conditionSubjectsForMetadataType('action'),
        }}
      />,
    );
    const offered = await offeredSubjects();
    const unbound = offered.filter((s) => !RECORD_CONDITION_ROOTS.includes(rootOf(s)));
    // Non-vacuity: the default vocabulary really does carry subjects the server
    // hosts do not bind, which is what the case above has to remove and this
    // one has to keep. Without this the two cases could both pass against an
    // empty dropdown.
    expect(unbound.length).toBeGreaterThan(0);
  });
});

/* ── The table, and the seam nothing else watches ────────────────────────── */

describe('conditionSubjectsForMetadataType — the per-type derivation (objectui#9953)', () => {
  it('hands back the ruled list itself for every server-evaluated type', () => {
    // Identity, not equality: a second list that merely looks the same is the
    // drift this codebase has already paid for three times — autocomplete,
    // subject dropdown and placeholder, each with its own literal.
    for (const [type, host] of Object.entries(CONDITION_HOST_BY_METADATA_TYPE)) {
      if (host !== 'server') continue;
      expect(conditionSubjectsForMetadataType(type)).toBe(RECORD_CONDITION_SUBJECTS);
    }
  });

  it('declares nothing for a client-evaluated type, and nothing for an unmeasured one', () => {
    // `undefined` is the unchanged arm on purpose: the builder keeps its own
    // default, so a tier with no reading behind it is left exactly as it was
    // rather than narrowed on a guess.
    for (const [type, host] of Object.entries(CONDITION_HOST_BY_METADATA_TYPE)) {
      if (host === 'server') continue;
      expect(conditionSubjectsForMetadataType(type)).toBeUndefined();
    }
    expect(conditionSubjectsForMetadataType('page')).toBeUndefined();
    expect(conditionSubjectsForMetadataType('a-type-this-build-never-heard-of')).toBeUndefined();
  });

  it('has a measured host for every type the scope table rules a row surface', () => {
    // What makes a new row-surface type LOUD instead of a silent inheritance of
    // `user.*`. `'record'` is exactly the set of tiers where this mount renders
    // a subject dropdown at all, so it is the set that needs a reading; the
    // `flattened` and `none` tiers deliberately have none.
    const rowSurfaces = Object.entries(CONDITION_SCOPE_BY_METADATA_TYPE)
      .filter(([, scope]) => scope === 'record')
      .map(([type]) => type);
    expect(rowSurfaces.length).toBeGreaterThan(0);
    for (const type of rowSurfaces) {
      expect(CONDITION_HOST_BY_METADATA_TYPE).toHaveProperty(type);
    }
  });
});
