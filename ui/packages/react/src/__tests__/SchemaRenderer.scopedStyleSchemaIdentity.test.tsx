/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Identity stability of the `schema` object `SchemaRenderer` hands down
 * (objectui#6270).
 *
 * `SchemaRenderer` memoises `evaluatedSchema`, and downstream renderers key
 * their own `useMemo`s on `[schema]` (e.g. `ObjectMap`'s `dataConfig` /
 * `mapConfig`). A node carrying `responsiveStyles` (ADR-0065 scoped styles)
 * takes a spread branch that merges the scope class into `schema.className` —
 * and that spread used to run unmemoised, allocating a NEW object on every
 * `SchemaRenderer` render even when the `evaluatedSchema` memo above it held.
 * Every downstream `[schema]` memo therefore saw a fresh identity and re-ran.
 *
 * ## The reproduction trap this file exists to pin
 *
 * `hasResponsiveStyles` requires a `large` / `medium` / `small` / `xsmall`
 * key. A `{ base: … }` shape does NOT take the branch — a fixture built on
 * `base` measures "stable" no matter what the renderer does, and reads as
 * evidence that the report was wrong. So `takes the scope-class branch` below
 * runs FIRST and proves, from the delivered `schema.className`, which fixture
 * is on which side of the branch. Every stability assertion after it is only
 * meaningful because that one passed.
 *
 * ## Both directions are pinned
 *
 * Memoising an object that legitimately changes trades a re-render bug for a
 * stale-render bug, so the `delivers a NEW identity` block pins the opposite
 * direction: when `className`, an evaluated value, or the source schema really
 * changes, the identity handed down MUST change with it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { PageVariablesProvider, usePageVariables } from '../hooks/usePageVariables';
import type { BaseSchema } from '@object-ui/types';
import type { PageComponent } from '@objectstack/spec/ui';
import { undeclaredNode } from '@object-ui/test-support';

/**
 * This file's registered probes, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'identity-probe': ScopedStyleNode;
    'self-updating-probe': ScopedStyleNode;
  }
}

/**
 * A node authoring `responsiveStyles` inline (objectui#11349), typed by
 * reference to the spec row that declares it (`PageComponentSchema`).
 * `BaseSchema` declares the key on no arm this test uses. The literal is
 * checked against this node rather than against the `BaseSchema` the `schema`
 * prop accepts, so the key stays checked now that objectui#8347 has removed
 * `BaseSchema`'s index signature.
 */
type ScopedStyleNode = BaseSchema & Pick<PageComponent, 'responsiveStyles'> & { content?: string };
/** The registered `IdentityProbe`'s node: every fixture below is one (objectui#11466). */
type IdentityProbeNode = ScopedStyleNode & { type: 'identity-probe' };
/** The registered `SelfUpdatingProbe`'s node. */
type SelfUpdatingProbeNode = ScopedStyleNode & { type: 'self-updating-probe' };
const scopedStyleNode = (schema: SelfUpdatingProbeNode): SelfUpdatingProbeNode => schema;

/** One capture per probe render: the exact `schema` object it was handed. */
interface Capture {
  schema: any;
  classNameProp: unknown;
}

const captures = new Map<string, Capture[]>();

/**
 * The probe is registered in the real `ComponentRegistry` and reached through
 * the real `SchemaRenderer` path — not a unit call to an internal helper. What
 * it records is exactly what any downstream renderer would key a `[schema]`
 * memo on.
 */
const IdentityProbe: React.FC<any> = (props) => {
  const id = String(props.schema?.id ?? 'anon');
  const list = captures.get(id) ?? [];
  list.push({ schema: props.schema, classNameProp: props.className });
  captures.set(id, list);
  return <div data-testid={`probe-${id}`} />;
};

const capturesFor = (id: string): Capture[] => captures.get(id) ?? [];

/** Number of times the probe for `id` rendered. Guards every "stable" claim:
 *  an identity cannot be measured across a re-render that never happened. */
const renderCount = (id: string): number => capturesFor(id).length;

/** How many DISTINCT `schema` objects the probe for `id` was handed. */
const distinctIdentities = (id: string): number =>
  new Set(capturesFor(id).map((c) => c.schema)).size;

// Module-level fixtures: a stable `schema` prop identity is the precondition
// for the `evaluatedSchema` memo to hold, which is what makes this a test of
// the spread branch rather than of the memo above it.
const PLAIN: IdentityProbeNode = { type: 'identity-probe', id: 'plain', content: 'plain' };
const SCOPED: IdentityProbeNode = {
  type: 'identity-probe',
  id: 'scoped',
  content: 'scoped',
  responsiveStyles: { large: { padding: '8px' } },
};
// The trap fixture: `base` is NOT one of the four sized keys, so this node
// does not take the scope-class branch at all. The spec's `responsiveStyles`
// declares no `base` either, so the fixture is deliberately undeclared and
// crosses through the one test helper for that (objectui#11466).
const BASE_ONLY: IdentityProbeNode = undeclaredNode({
  type: 'identity-probe',
  id: 'baseonly',
  content: 'base-only',
  responsiveStyles: { base: { padding: '8px' } },
});

/**
 * A real parent re-render: parent state changes, every child re-renders, and
 * every `schema` prop below keeps its identity.
 *
 * The re-render is driven by a real click rather than by a module-level `let`
 * the component reassigns during render. That reassignment is itself a render
 * side effect (`react-hooks/globals`) — in a file that measures render counts,
 * it would be the measuring instrument breaking the rule under test.
 */
const Harness: React.FC = () => {
  const [, setTick] = useState(0);
  return (
    <>
      <button data-testid="bump-parent" onClick={() => setTick((n) => n + 1)} />
      <SchemaRenderer schema={PLAIN} />
      <SchemaRenderer schema={SCOPED} />
      <SchemaRenderer schema={BASE_ONLY} />
    </>
  );
};

/** One parent re-render. */
const bumpParent = (): void => {
  fireEvent.click(screen.getByTestId('bump-parent'));
};

describe('SchemaRenderer scoped-style schema identity (objectui#6270)', () => {
  // Registered ONCE, outside the per-test hooks: `register`/`unregister` call
  // the registry's `notify()`, which force-updates every mounted
  // `SchemaRenderer`. Doing that per-test fires it while the previous test's
  // tree is still mounted, producing un-acted updates — noise that would sit
  // on top of the very re-render counts this file measures.
  beforeAll(() => {
    ComponentRegistry.register('identity-probe', IdentityProbe);
  });

  afterAll(() => {
    ComponentRegistry.unregister?.('identity-probe');
  });

  beforeEach(() => {
    captures.clear();
  });

  afterEach(() => {
    captures.clear();
  });

  describe('the fixtures are on the sides of the branch this file claims', () => {
    it('only a sized-breakpoint node takes the scope-class branch', () => {
      render(<Harness />);

      // Positive control for the two zero/absent readings below, same query
      // shape: the sized-breakpoint node DOES get a scope class, on both the
      // `schema.className` channel and the `className` prop channel.
      expect(capturesFor('scoped')[0].schema.className).toContain('os-s-scoped');
      expect(String(capturesFor('scoped')[0].classNameProp)).toContain('os-s-scoped');

      // The trap: `{ base: … }` is not one of the four sized keys.
      expect(capturesFor('baseonly')[0].schema.className).toBeUndefined();
      expect(capturesFor('baseonly')[0].classNameProp).toBeUndefined();

      expect(capturesFor('plain')[0].schema.className).toBeUndefined();
      expect(capturesFor('plain')[0].classNameProp).toBeUndefined();
    });
  });

  describe('identity is stable across a parent re-render', () => {
    it('plain node (control)', () => {
      render(<Harness />);
      bumpParent();

      expect(renderCount('plain')).toBeGreaterThanOrEqual(2);
      expect(distinctIdentities('plain')).toBe(1);
    });

    it('node with a `base`-only responsiveStyles shape (control)', () => {
      render(<Harness />);
      bumpParent();

      expect(renderCount('baseonly')).toBeGreaterThanOrEqual(2);
      expect(distinctIdentities('baseonly')).toBe(1);
    });

    it('node with a sized responsiveStyles breakpoint (the fix case)', () => {
      render(<Harness />);
      bumpParent();

      expect(renderCount('scoped')).toBeGreaterThanOrEqual(2);
      expect(distinctIdentities('scoped')).toBe(1);
    });

    it('holds across several parent re-renders, not just one', () => {
      render(<Harness />);
      bumpParent();
      bumpParent();
      bumpParent();

      expect(renderCount('scoped')).toBeGreaterThanOrEqual(4);
      expect(distinctIdentities('scoped')).toBe(1);
      expect(distinctIdentities('plain')).toBe(1);
    });

    it('the scope class survives memoisation — a stable identity is still the RIGHT object', () => {
      render(<Harness />);
      bumpParent();

      const last = capturesFor('scoped')[renderCount('scoped') - 1];
      expect(last.schema.className).toContain('os-s-scoped');
      expect(last.schema.content).toBe('scoped');
      expect(last.schema.type).toBe('identity-probe');
      // `responsiveStyles` reaches the renderer on the schema object (it is
      // stripped from the DOM props, not from the schema).
      expect(last.schema.responsiveStyles).toEqual({ large: { padding: '8px' } });
    });
  });

  describe("the instability is bounded — a consumer's own setState does not re-key it", () => {
    /**
     * Pins the reason this finding is a redundant-recompute cost and NOT a
     * refetch loop. A consuming renderer (`ObjectMap`) keys a fetch effect on
     * a `[schema]`-derived memo and that effect calls `setData`. If the
     * renderer's OWN state update re-ran `SchemaRenderer`, a fresh schema
     * identity would re-key the effect, refetch, and set state again —
     * unbounded.
     *
     * It does not: React re-renders only the subtree below the component that
     * set state, so `SchemaRenderer` stays put and the consumer keeps the very
     * object React last handed it. This test fixes that as a property of the
     * renderer rather than a fact people re-derive from React semantics. It is
     * green on both sides of the fix — the fix changes what a PARENT render
     * hands down, and this measures renders no parent took part in — and turns
     * red only if something upstream starts re-rendering `SchemaRenderer` in
     * response to a consumer's own state.
     */
    it('a consumer re-rendering itself keeps the exact schema object it was handed', () => {
      const selfUpdates: any[] = [];

      const SelfUpdatingProbe: React.FC<any> = (props) => {
        const [, setOwn] = useState(0);
        selfUpdates.push(props.schema);
        return <button data-testid="bump-self" onClick={() => setOwn((n) => n + 1)} />;
      };

      ComponentRegistry.register('self-updating-probe', SelfUpdatingProbe);
      try {
        render(
          <SchemaRenderer
            schema={scopedStyleNode({
              type: 'self-updating-probe',
              id: 'selfscoped',
              responsiveStyles: { large: { padding: '8px' } },
            })}
          />
        );

        // Measured from the LAST render before the first click, not from mount.
        //
        // Mount is not a clean baseline: `SchemaRenderer` force-updates itself
        // once after mounting (it re-checks `ComponentRegistry` for a lazily
        // registered component), so mounting alone produces two SchemaRenderer
        // renders — and before the fix those two already handed down two
        // different schema objects. Counting from mount would fold that
        // parent-render instability into this test and make it a second, worse
        // copy of the fix-case test above instead of the independent property
        // it is meant to pin. (Measured: this assertion goes red on the pre-fix
        // tree when it starts at index 0, and stays green when it starts here.)
        const mountRenders = selfUpdates.length;
        const baseline = selfUpdates[mountRenders - 1];

        fireEvent.click(screen.getByTestId('bump-self'));
        fireEvent.click(screen.getByTestId('bump-self'));

        // Positive control: the consumer really did re-render on its own state.
        expect(selfUpdates.length).toBeGreaterThan(mountRenders);
        // The property: across the consumer's OWN re-renders, the schema object
        // it holds never changes — SchemaRenderer did not re-run, so there was
        // nothing to re-key. This is what makes the finding bounded.
        expect(new Set(selfUpdates.slice(mountRenders - 1)).size).toBe(1);
        // The branch is genuinely taken here too — otherwise this pins nothing.
        expect(baseline.className).toContain('os-s-selfscoped');
      } finally {
        ComponentRegistry.unregister?.('self-updating-probe');
      }
    });
  });

  describe('delivers a NEW identity when something really changed (anti-staleness)', () => {
    it('a changed `className` on a scoped node', () => {
      const before: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'scoped',
        className: 'text-sm',
        responsiveStyles: { large: { padding: '8px' } },
      };
      const after: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'scoped',
        className: 'text-lg',
        responsiveStyles: { large: { padding: '8px' } },
      };

      const { rerender } = render(<SchemaRenderer schema={before} />);
      expect(capturesFor('scoped')[0].schema.className).toBe('text-sm os-s-scoped');

      rerender(<SchemaRenderer schema={after} />);

      const last = capturesFor('scoped')[renderCount('scoped') - 1];
      expect(last.schema.className).toBe('text-lg os-s-scoped');
      expect(last.schema).not.toBe(capturesFor('scoped')[0].schema);
    });

    it('a changed value on a scoped node', () => {
      const before: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'scoped',
        content: 'first',
        responsiveStyles: { large: { padding: '8px' } },
      };
      const after: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'scoped',
        content: 'second',
        responsiveStyles: { large: { padding: '8px' } },
      };

      const { rerender } = render(<SchemaRenderer schema={before} />);
      rerender(<SchemaRenderer schema={after} />);

      const first = capturesFor('scoped')[0];
      const last = capturesFor('scoped')[renderCount('scoped') - 1];
      expect(first.schema.content).toBe('first');
      expect(last.schema.content).toBe('second');
      expect(last.schema).not.toBe(first.schema);
    });

    it('a changed responsiveStyles value re-compiles and re-identifies', () => {
      const before: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'scoped',
        responsiveStyles: { large: { padding: '8px' } },
      };
      const after: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'scoped',
        responsiveStyles: { large: { padding: '24px' } },
      };

      const { rerender } = render(<SchemaRenderer schema={before} />);
      rerender(<SchemaRenderer schema={after} />);

      const first = capturesFor('scoped')[0];
      const last = capturesFor('scoped')[renderCount('scoped') - 1];
      expect(last.schema).not.toBe(first.schema);
      expect(last.schema.responsiveStyles).toEqual({ large: { padding: '24px' } });
    });

    it('a live value the node interpolates — same schema object, changed page variable', () => {
      // The strongest anti-staleness pin: the `schema` PROP identity never
      // changes here, so only a genuinely reactive evaluation can move the
      // delivered identity. A memo that froze on the prop would go stale.
      const REACTIVE: IdentityProbeNode = {
        type: 'identity-probe',
        id: 'reactive',
        content: '${page.tick}',
        responsiveStyles: { large: { padding: '8px' } },
      };

      const TickWriter: React.FC = () => {
        const { setVariable } = usePageVariables();
        return (
          <button data-testid="set-tick" onClick={() => setVariable('tick', 'second')} />
        );
      };

      render(
        <PageVariablesProvider
          definitions={[{ name: 'tick', type: 'string', defaultValue: 'first' } as any]}
        >
          <TickWriter />
          <SchemaRenderer schema={REACTIVE} />
        </PageVariablesProvider>
      );

      expect(capturesFor('reactive')[0].schema.content).toBe('first');

      fireEvent.click(screen.getByTestId('set-tick'));

      const first = capturesFor('reactive')[0];
      const last = capturesFor('reactive')[renderCount('reactive') - 1];
      expect(last.schema.content).toBe('second');
      expect(last.schema).not.toBe(first.schema);
    });
  });
});
