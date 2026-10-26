// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6110 — the console form renderer binds the HOST PREDICATE SCOPE, so
 * `current_user` resolves on its authored predicates the way it already does on
 * the sibling renderer (`packages/components/src/renderers/form/form.tsx`,
 * fixed by #6010).
 *
 * ## The defect, and why it needed TWO hops repaired, not the card's one
 *
 * The card named two evaluator call sites in this file passing `undefined` for
 * `resolveFieldRuleState`/`evalFieldPredicate`'s `scope` parameter. Binding
 * them alone would have shipped INERT, because nothing in this app published a
 * scope for them to read:
 *
 *   hop 1 — `usePredicateScope()` returns `{}` unless an `ExpressionProvider`
 *           is mounted above. The console mounted one in exactly two places
 *           (`AppContent`, for the `/apps/:appName/*` subtree, and app-shell's
 *           `RecordFormPage`) and NEITHER is above `/forms/:name`, which is
 *           mounted from `App.tsx` through `InternalFormRoute` →
 *           `DefaultHomeLayout`. So the authed form route had no principal in
 *           scope at all. `InternalFormRoute` now mounts the provider, over the
 *           SAME `buildExpressionUser` normalisation `AppContent` uses.
 *   hop 2 — the evaluator call sites in `FormPage.tsx`, which is what the card
 *           enumerated. There are THREE, not the two it named: the field
 *           predicate, the section predicate, and `resolveRowState`'s
 *           `resolveFieldRuleState` call carrying the OBJECT-level rules.
 *
 * `hop1SessionPrincipal` below is the case that would have caught a hop-2-only
 * fix: it mounts the real `InternalFormRoute` and lets the route itself supply
 * the principal, instead of handing one to `FormPage` directly.
 *
 * ## ⚠️ Why every case here asserts HIDDEN (or REQUIRED), never merely SHOWN
 *
 * `visibleWhen` is evaluated with `fallback: true` — it fails OPEN. A field on
 * screen is therefore the outcome of THREE different worlds: the predicate
 * resolved true, the scope was never bound so the predicate faulted, and the
 * predicate is broken. An assertion that a field IS shown separates none of
 * them and is green on unfixed code. The deliverable is the DENIED block: a
 * `current_user` predicate that is FALSE for the bound principal, asserted
 * ABSENT.
 *
 * `requiredWhen` fails the other way (`fallback: false`), which is why the
 * `requiredWhen` case asserts the marker is PRESENT: unbound, that predicate
 * faults to "not required" and the asterisk is missing. The two directions
 * together are what make this file a measurement of the BINDING rather than of
 * either fallback.
 *
 * ## The anonymous `/f/:slug` route — the fork clause, answered by structure
 *
 * Both routes share one call site, and the card left open what an anonymous
 * form binds. It needed no new contract surface to answer: the two routes are
 * distinguished by WHICH COMPONENT MOUNTS THEM. `/forms/:name` renders inside
 * `InternalFormRoute`, which has an authenticated session and now publishes it;
 * `/f/:slug` is mounted bare from `App.tsx`, deliberately outside
 * `ProtectedRoute`, so `usePredicateScope()` there returns `{}` — there is no
 * principal to bind, and binding an empty scope is exactly that statement. The
 * `publicRouteHasNoPrincipal` case pins it: on the public route the same
 * authored text still faults open, unchanged by this card.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PredicateScopeProvider } from '@object-ui/react';
import { FormPage } from './FormPage';

/**
 * `InternalFormRoute` is imported HERE, at module scope, and deliberately NOT
 * with a dynamic `await import()` inside `hop1SessionPrincipal` below —
 * AGENTS.md §测试纪律, "an unbounded module load counted inside a bounded
 * window".
 *
 * This module's graph is the first VALUE request for `@object-ui/app-shell` in
 * the file (`FormPage` only `import type`s it), so it is what runs the
 * `vi.mock('@object-ui/app-shell')` factory below — and that specifier is
 * aliased to `packages/app-shell/src` (`apps/console/vite.config.ts`), a barrel
 * carrying thirteen side-effect imports, transformed on demand. While that
 * factory still called `importOriginal()` the load cost **10204ms** of
 * `hop1SessionPrincipal`'s 15000ms budget on an IDLE machine, against ~12ms for
 * the render and the assertions. Nothing was wrong with the test — it was
 * racing the module loader, and lost whenever the transform pipeline was
 * saturated by a full-project run. objectui#6580 took the barrel out of the
 * factory; the module-scope import below is what keeps the remaining load out
 * of a bounded window.
 *
 * Module scope moves that cost into the IMPORT phase, which no test or hook
 * timeout bounds. `beforeAll` would not do: it is bounded by `hookTimeout`
 * (10s), narrower than the 15s it replaces. The specifier is unchanged, so this
 * is the same module and the same binding as the `await import()` was — only
 * loaded before the timed window instead of inside it.
 *
 * objectui#6892 slice 14 puts the barrel BACK into the factory — as an
 * `importOriginal()` spread, so the mock inherits the real export surface
 * instead of freezing it at the four names below. That is safe here for the
 * reason this comment already gives: the module-scope import above is the
 * first VALUE request for the specifier, so the factory — and the barrel load
 * inside it — runs during the IMPORT phase, which no timeout bounds. Measured
 * under objectui#8173: `hop1SessionPrincipal` 9ms -> 8ms.
 */
import { InternalFormRoute } from './InternalFormRoute';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The host scope an `ExpressionProvider` publishes, transcribed from
 * `packages/app-shell/src/providers/ExpressionProvider.tsx` — the canonical
 * `current_user` plus the ADR-0068 `user` / `ctx.user` / `os.user` aliases.
 * Same spelling as #6010's parity pin, on purpose: one authored text, one
 * verdict, every surface.
 */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', role: 'user', isPlatformAdmin: false, positions };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
}

/** The SAME principal shape, one admitted by `GATE` and one refused by it. */
const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

/** THE authored predicate. One text, asked of every surface below. */
const GATE = "'sales_manager' in current_user.positions";

/**
 * A root that genuinely does not exist in any scope — the FAULT control. Its
 * only difference from `GATE` is the root it names, so a fail-CLOSED
 * regression cannot hide behind the membership test.
 */
const UNBOUND_ROOT = "'sales_manager' in no_such_root.positions";

const BASE_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    priority: { type: 'text', label: 'Priority', defaultValue: 'low' },
    notes: { type: 'text', label: 'Notes' },
  } as Record<string, Record<string, unknown>>,
};

/** `BASE_SCHEMA` with OBJECT-level rule keys merged onto named fields. */
function withRules(rules: Record<string, Record<string, unknown>>) {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(BASE_SCHEMA.fields)) {
    fields[name] = { ...def, ...(rules[name] ?? {}) };
  }
  return { ...BASE_SCHEMA, fields };
}

function viewEnvelope(sections: unknown[]) {
  return {
    name: 'showcase_task.edit',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Task',
    config: { type: 'simple', sections },
  };
}

function stubFetch(routes: Array<{ method?: string; match: string; body?: unknown }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find(
      (r) => (r.method ?? 'GET').toUpperCase() === method && String(url).includes(r.match),
    );
    if (!route) throw new Error(`unstubbed fetch: ${method} ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => route.body,
      text: async () => (route.body === undefined ? '' : JSON.stringify(route.body)),
    } as unknown as Response;
  });
}

/**
 * The INTERNAL route, with a scope handed straight to `FormPage` — this is the
 * hop-2 harness. It deliberately does NOT go through `InternalFormRoute`, so a
 * fix that binds the call sites but never publishes a scope still passes here
 * and is caught by `hop1SessionPrincipal` instead.
 */
function renderInternalWithScope(
  scope: Record<string, unknown>,
  sections: unknown[],
  objectSchema: unknown = BASE_SCHEMA,
) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      { match: '/meta/view/', body: viewEnvelope(sections) },
      { match: '/meta/object/', body: objectSchema },
    ]),
  );
  return render(
    <PredicateScopeProvider scope={scope as any}>
      <MemoryRouter initialEntries={['/forms/showcase_task.edit']}>
        <Routes>
          <Route path="/forms/:name" element={<FormPage mode="internal" />} />
        </Routes>
      </MemoryRouter>
    </PredicateScopeProvider>,
  );
}

/** The PUBLIC route (`/f/:slug`) — mounted bare, exactly as `App.tsx` does. */
function renderPublic(sections: unknown[], objectSchema: unknown = BASE_SCHEMA) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      {
        match: '/forms/task-intake',
        body: {
          slug: 'task-intake',
          object: 'showcase_task',
          label: 'Task intake',
          form: { type: 'simple', sections },
          objectSchema,
        },
      },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/f/task-intake']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The un-gated sibling control. Every case waits on it: a missing `Priority`
 * would mean the form never rendered, and then an absent gated field is an
 * INABILITY rather than a verdict.
 */
async function awaitForm() {
  await waitFor(() => expect(screen.getByLabelText('Priority')).toBeInTheDocument());
}

/** The `label` element, so the REQUIRED MARKER can be read off the output. */
function labelFor(container: HTMLElement, name: string): HTMLElement {
  const el = container.querySelector(`label[for="f_${name}"]`);
  if (!el) throw new Error(`no label rendered for field '${name}'`);
  return el as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── DENIED — the deliverable ────────────────────────────────────────────

describe('#6110 DENIED — a `current_user` predicate false for the bound principal HIDES', () => {
  it('the VIEW-level field `visibleWhen` (FormPage.tsx isFieldVisible)', async () => {
    renderInternalWithScope(DENIED, [
      { label: 'Basics', fields: ['priority'] },
      { label: 'Pay', fields: [{ field: 'notes', label: 'Notes', visibleWhen: GATE }] },
    ]);
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('the SECTION `visibleWhen` (FormPage.tsx isSectionVisible)', async () => {
    renderInternalWithScope(DENIED, [
      { label: 'Basics', fields: ['priority'] },
      { label: 'Compensation', visibleWhen: GATE, fields: ['notes'] },
    ]);
    await awaitForm();
    // Heading AND fields — a section rule takes the whole `<section>`.
    expect(screen.queryByText('Compensation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('the OBJECT-level `rules.visibleWhen` — the THIRD site, not named on the card', async () => {
    // `resolveRowState` → `resolveFieldRuleState`. The card enumerated two
    // evaluators in this file; this is the one it missed.
    renderInternalWithScope(
      DENIED,
      [{ label: 'Basics', fields: ['priority', 'notes'] }],
      withRules({ notes: { visibleWhen: GATE } }),
    );
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });
});

describe('#6110 DENIED (other direction) — `requiredWhen` faults CLOSED when unbound', () => {
  it('marks the field REQUIRED when a `current_user` requiredWhen is TRUE for the principal', async () => {
    // The direction that cannot be reached by a fail-open accident: with no
    // scope this predicate faults to `false` and the asterisk is absent.
    const { container } = renderInternalWithScope(
      ALLOWED,
      [{ label: 'Basics', fields: ['priority', 'notes'] }],
      withRules({ notes: { requiredWhen: GATE } }),
    );
    await awaitForm();
    expect(labelFor(container, 'notes').textContent).toContain('*');
  });
});

// ─── Controls — green on a revert, and stated as such ────────────────────

describe('#6110 controls — green before AND after the fix, by construction', () => {
  it('ALLOWED: the SAME predicate text, a principal it admits ⇒ still shown', async () => {
    renderInternalWithScope(ALLOWED, [
      { label: 'Basics', fields: ['priority'] },
      { label: 'Compensation', visibleWhen: GATE, fields: ['notes'] },
    ]);
    await awaitForm();
    expect(screen.getByText('Compensation')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('FAULTED: a genuinely unbound ROOT still fails OPEN (unchanged by this card)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderInternalWithScope(DENIED, [
      { label: 'Basics', fields: ['priority'] },
      { label: 'Compensation', visibleWhen: UNBOUND_ROOT, fields: ['notes'] },
    ]);
    await awaitForm();
    // Pinned so the DENIED block above means "evaluated and false" rather than
    // "could not be evaluated at all".
    expect(screen.getByText('Compensation')).toBeInTheDocument();
  });

  it('publicRouteHasNoPrincipal: `/f/:slug` binds an EMPTY scope, so `current_user` still faults open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPublic([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Compensation', visibleWhen: GATE, fields: ['notes'] },
    ]);
    await awaitForm();
    // The fork clause's answer, pinned as behaviour rather than as prose: the
    // anonymous route is mounted outside `ProtectedRoute` with no provider
    // above it, so there is no principal to bind and nothing changes here.
    expect(screen.getByText('Compensation')).toBeInTheDocument();
  });
});

// ─── HOP 1 — the route itself must PUBLISH the principal ─────────────────

/**
 * `InternalFormRoute`'s own dependencies, stubbed to the minimum the route
 * needs — and `ExpressionProvider` / `buildExpressionUser` deliberately left
 * REAL, because they are the thing under test. `DefaultHomeLayout` is a
 * pass-through: the chrome is #4109's subject, not this card's, and stubbing it
 * cannot hide the provider, which the route mounts itself.
 *
 * These still apply to the module-scope `InternalFormRoute` import above:
 * `vi.mock` calls are hoisted above every import in the file, so the factories
 * are registered before that import executes.
 */
// The barrel is aliased to `packages/app-shell/src`, so an `importOriginal()`
// on it transforms that whole graph on demand — 10204ms when objectui#6567
// instrumented it, 10019ms re-measured for objectui#6580. The three submodules
// below carry every name this file's graph reads from the barrel and cost a few
// ms together: `ExpressionProvider`, `buildExpressionUser` (`expressionUser`)
// and `resolveHostAppSegment` (`utils/`).
vi.mock('@object-ui/app-shell', async (importOriginal) => {
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ...(await vi.importActual<Record<string, unknown>>(
      '../../../../packages/app-shell/src/providers/ExpressionProvider'
    )),
    ...(await vi.importActual<Record<string, unknown>>(
      '../../../../packages/app-shell/src/providers/expressionUser'
    )),
    ...(await vi.importActual<Record<string, unknown>>(
      '../../../../packages/app-shell/src/utils/index'
    )),
    useMetadata: () => ({ apps: [] }),
    useNavigationContext: () => ({ currentAppName: undefined }),
    DefaultHomeLayout: ({ children }: { children?: unknown }) => children as never,
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    // The shape `AuthProvider` yields; `buildExpressionUser` normalises it into
    // the scope, which is why `positions` reaches `current_user` at all.
    user: { id: 'u1', name: 'Kim', email: 'kim@example.com', positions: ['sales'] },
  }),
}));

describe('#6110 hop 1 — `/forms/:name` publishes the SESSION principal', () => {
  it('hop1SessionPrincipal: the route alone binds `current_user`, with no scope handed in', async () => {
    // ⚠️ THE anti-inert case. Every other DENIED case above hands `FormPage` a
    // scope directly and stays green even if nothing in the app ever publishes
    // one — which was the real state of this route before this card: the
    // console mounts `ExpressionProvider` only in `AppContent` (the
    // `/apps/:appName/*` subtree) and in app-shell's `RecordFormPage`, and
    // NEITHER is above `/forms/:name`. Binding the evaluator call sites without
    // this hop would have shipped a fix that reads `{}` forever.
    vi.stubGlobal(
      'fetch',
      stubFetch([
        {
          match: '/meta/view/',
          body: viewEnvelope([
            { label: 'Basics', fields: ['priority'] },
            { label: 'Compensation', visibleWhen: GATE, fields: ['notes'] },
          ]),
        },
        { match: '/meta/object/', body: BASE_SCHEMA },
      ]),
    );
    render(
      <MemoryRouter initialEntries={['/forms/showcase_task.edit']}>
        <Routes>
          <Route path="/forms/:name" element={<InternalFormRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await awaitForm();
    expect(screen.queryByText('Compensation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });
});
