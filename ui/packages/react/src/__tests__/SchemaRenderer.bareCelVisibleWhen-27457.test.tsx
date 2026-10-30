/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27457 — a page component's `visibleWhen` written as a BARE
 * string is CEL, read on the same engine as its `{ dialect: 'cel', source }`
 * envelope.
 *
 * `@objectstack/spec` defines a bare string as shorthand for the CEL envelope
 * (the string arm of `EvaluatedExpressionInputSchema`), and the server reads it
 * that way. The console used to send the bare spelling to the legacy JS
 * evaluator, where CEL-only syntax (`size()`, `in`) faulted — and a node gate
 * that faults is withheld (objectui#13299), so the block vanished for everyone
 * while its envelope twin rendered.
 *
 * Every hidden verdict below sits beside a mount of the SAME schema that
 * renders, differing only in the value under test, so "hidden" is the gate's
 * answer and not "this node never renders".
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { __resetVisibilityPredicateWarnings, UNRESOLVABLE_VISIBILITY_PREFIX } from '../utils/visibilityDiagnostic';
import { PredicateScopeProvider } from '../hooks/useExpression';
import { PageVariablesProvider } from '../hooks/usePageVariables';

const NAME = 'probe-27457';
const TYPE = 'element:probe-27457';

const Probe = () => <div data-testid="probe" />;

const OWNER = { id: 'u1', positions: ['org_owner'] };
const MEMBER = { id: 'u2', positions: ['member'] };
const scopeFor = (user: Record<string, unknown>) => ({
  current_user: user,
  user,
  features: {},
});

function mount(visibleWhen: unknown, items: unknown[], user: Record<string, unknown> = OWNER) {
  return render(
    <PredicateScopeProvider scope={scopeFor(user)}>
      <PageVariablesProvider definitions={[{ name: 'items', type: 'array', defaultValue: items } as never]}>
        <SchemaRenderer schema={{ type: TYPE, visibleWhen } as never} />
      </PageVariablesProvider>
    </PredicateScopeProvider>,
  );
}

const shown = () => screen.queryByTestId('probe') !== null;

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
  __resetVisibilityPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  ComponentRegistry.unregister?.(NAME, 'element');
  vi.restoreAllMocks();
});

const visibilityLines = () =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith(UNRESOLVABLE_VISIBILITY_PREFIX));

describe('objectstack#27457 — a bare `visibleWhen` string is CEL', () => {
  it('`size(page.items) > 0` (a CEL-only builtin) reaches opposite verdicts on the two polarities', () => {
    // The card's reproduction B. Before the fix the non-empty mount was hidden
    // too: `"size" is not a function` on the legacy grammar, withheld.
    mount('size(page.items) > 0', ['a']);
    expect(shown()).toBe(true);
    cleanup();
    mount('size(page.items) > 0', []);
    expect(shown()).toBe(false);
    expect(visibilityLines()).toHaveLength(0);
  });

  it("`'org_owner' in current_user.positions` (CEL `in`) shows the holder and hides the member", () => {
    // The spec's own example spelling of a role predicate (`in` over a list).
    mount("'org_owner' in current_user.positions", ['a'], OWNER);
    expect(shown()).toBe(true);
    cleanup();
    mount("'org_owner' in current_user.positions", ['a'], MEMBER);
    expect(shown()).toBe(false);
    expect(visibilityLines()).toHaveLength(0);
  });

  it('CONTROL: the envelope spelling of the same predicate reaches the same verdicts', () => {
    const env = { dialect: 'cel', source: 'size(page.items) > 0' };
    mount(env, ['a']);
    expect(shown()).toBe(true);
    cleanup();
    mount(env, []);
    expect(shown()).toBe(false);
  });

  it('a legacy-only bare spelling is no longer read on the JS grammar: it faults, is withheld and is reported', () => {
    // `===` is not CEL. The bare string has one reading now, the server's, so
    // this predicate faults on BOTH polarities (withheld, objectui#13299) and
    // names itself in the report — where it used to evaluate on the legacy
    // engine. Its CEL spelling, `==`, is the paired control.
    mount("page.items[0] === 'a'", ['a']);
    expect(shown()).toBe(false);
    const lines = visibilityLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("page.items[0] === 'a'");
    cleanup();
    mount("page.items[0] == 'a'", ['a']);
    expect(shown()).toBe(true);
  });
});
