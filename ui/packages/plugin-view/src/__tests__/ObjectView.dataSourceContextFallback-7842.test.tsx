/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectViewProps.dataSource` — the type is right, the prose was wrong
 * (objectui#7842).
 *
 * The card: the JSDoc on this prop promised "If not provided, falls back to
 * SchemaRendererProvider context" one line above `dataSource: DataSource`,
 * declared REQUIRED. One of the two had been wrong for the prop's whole life,
 * and which one is a MEASUREMENT, not a preference — because the two answers
 * lead opposite ways. "The type is right" is a comment deletion. "The JSDoc is
 * right" would make a required published prop optional, which WIDENS a
 * published accept set and is a maintainer's ruling.
 *
 * The measurement is the type's: `ObjectView` holds no context read at all.
 * This file pins it from both sides, because the interesting half is a
 * NEGATIVE — "the adapter in context is never touched" — and a negative
 * asserted by itself is indistinguishable from a harness that could not have
 * observed the call in the first place. So the live control comes first: the
 * same probe, the same wait, an adapter passed as the prop, and the read DOES
 * happen. Only then does the absence of that read mean anything.
 *
 * ## Why this file does NOT stub `SchemaRendererContext`
 *
 * Every sibling `ObjectView.*.test.tsx` mocks `@object-ui/react` and replaces
 * `SchemaRendererContext` with a fresh `React.createContext(null)`. That is
 * fine for them and would be a FALSE GREEN here: a future fallback would be
 * written with the real context (directly, or through `useElementDataSource`,
 * which is how `@object-ui/react` spells this fallback for the components that
 * do have one), and a provider built on a look-alike context object cannot be
 * seen by it. This file therefore keeps the REAL `SchemaRendererProvider` and
 * the REAL context, and stubs only `SchemaRenderer` — the heavy renderer the
 * non-grid branch delegates to, which is not what is under test.
 *
 * ## Direction
 *
 * Section 1 was GREEN before the JSDoc deletion and is GREEN after: it pins
 * the behaviour the deletion described, not the deletion. Section 2 pins where
 * the deleted sentence was actually TRUE — `ObjectViewRenderer`, the renderer
 * registered for the `object-view` and `view` schema tags, really does resolve
 * `dataSource` from this context. The sentence was misfiled, not invented, and
 * a reader who finds only section 1 would be entitled to re-add it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import type { ObjectViewProps } from '../ObjectView';
// Side-effect import: registers `object-view` / `view` into ComponentRegistry.
import '../index';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Stubbed because the non-grid branch renders through it; NOT the context.
  // Replacing `SchemaRendererContext` here would defeat this file — see header.
  SchemaRenderer: ({ schema }: { schema?: { type?: string } }) => (
    <div data-testid="schema-renderer" data-schema-type={schema?.type}>
      {schema?.type}
    </div>
  ),
}));

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema }: { schema?: { objectName?: string } }) => (
    <div data-testid="object-grid" data-object={schema?.objectName} />
  ),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const SCHEMA: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'contacts',
};

/**
 * An adapter that records every read `ObjectView` could make of it. Only
 * `getObjectSchema` is reached on mount (through `useSettledSchema`), which is
 * what makes it the probe: it fires for a grid view too, so the reading does
 * not depend on which view type the schema happens to select.
 */
const spyAdapter = () =>
  ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'contacts', fields: {} }),
  }) as unknown as DataSource;

describe('ObjectViewProps.dataSource is required because there is no fallback (objectui#7842)', () => {
  let adapter: DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = spyAdapter();
  });

  it('LIVE CONTROL: an adapter passed AS THE PROP is read on mount', async () => {
    render(<ObjectView schema={SCHEMA} dataSource={adapter} />);

    await waitFor(() => expect(screen.getByTestId('object-grid')).toBeInTheDocument());
    expect(
      adapter.getObjectSchema,
      'The probe this file relies on stopped firing. Until this passes, the assertions below\n'
        + 'measure nothing: "the context adapter was never read" would be true of a harness that\n'
        + 'cannot observe a read at all.',
    ).toHaveBeenCalledWith('contacts');
  });

  it('does NOT fall back to SchemaRendererProvider context when the prop is absent', async () => {
    render(
      <SchemaRendererProvider dataSource={adapter}>
        <ObjectView
          schema={SCHEMA}
          // The whole point of the card: tsc refuses this omission at the call
          // site, so reaching the runtime behaviour at all needs the cast an
          // untyped JS host gets for free.
          dataSource={undefined as unknown as DataSource}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('object-grid')).toBeInTheDocument());
    expect(
      adapter.getObjectSchema,
      'ObjectView now resolves `dataSource` from SchemaRendererProvider context. That is the\n'
        + 'BRANCH B of objectui#7842 the card refused to let a dev implement: it makes a required\n'
        + 'published prop effectively optional, which widens a published accept set. It needs a\n'
        + "maintainer's ruling, and the prop declaration plus its JSDoc must move with it.",
    ).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('renders its chrome instead of throwing when the prop is absent', async () => {
    render(<ObjectView schema={SCHEMA} dataSource={undefined as unknown as DataSource} />);

    // Guarded, not resolved: every read site returns early, the value is
    // forwarded verbatim to a child whose own `dataSource` is optional, and the
    // view comes up empty rather than failing.
    await waitFor(() => expect(screen.getByTestId('object-grid')).toBeInTheDocument());
  });

  it('the prop stays REQUIRED on the published props type', () => {
    // A TYPE pin, enforced by `tsc -p tsconfig.test.json` (the package's
    // `type-check` script), not by this assertion. If `dataSource` ever becomes
    // optional the object literal below type-checks, the directive suppresses
    // nothing, and tsc fails with TS2578 "Unused '@ts-expect-error' directive"
    // — naming this line rather than letting the widening land unremarked.
    // @ts-expect-error — `dataSource` is REQUIRED (objectui#7842).
    const omitted: ObjectViewProps = { schema: SCHEMA };
    expect(omitted.schema).toBe(SCHEMA);
  });
});

describe('where the deleted sentence WAS true: the registered renderer (objectui#7842)', () => {
  it('`object-view` resolves dataSource from SchemaRendererProvider context', () => {
    const registered = ComponentRegistry.get('object-view') as React.FC<{ schema: unknown }>;
    const adapter = spyAdapter();
    let passed: Record<string, unknown> | null = null;
    let renderedType: unknown = null;

    // Called as a plain function inside a probe component — it holds exactly
    // one hook (`useContext`), so the returned element can be inspected without
    // paying for an ObjectView mount or a data fetch. Same technique as
    // `objectViewHostSurface.test.tsx`.
    const Probe: React.FC = () => {
      const element = registered({ schema: SCHEMA }) as React.ReactElement;
      renderedType = element.type;
      passed = element.props as Record<string, unknown>;
      return null;
    };

    render(
      <SchemaRendererProvider dataSource={adapter}>
        <Probe />
      </SchemaRendererProvider>,
    );

    expect(renderedType).toBe(ObjectView);
    expect(
      (passed as unknown as { dataSource?: unknown } | null)?.dataSource,
      'The schema-driven `object-view` path stopped resolving `dataSource` from context. That\n'
        + 'resolution is the only place the sentence deleted from ObjectViewProps.dataSource was\n'
        + 'ever true; losing it silently would make re-adding that sentence to the PROP look right.',
    ).toBe(adapter);
  });

  it('and hands down `null`, not the context object, when no provider is mounted', () => {
    const registered = ComponentRegistry.get('object-view') as React.FC<{ schema: unknown }>;
    let passed: Record<string, unknown> | null = null;

    const Probe: React.FC = () => {
      passed = (registered({ schema: SCHEMA }) as React.ReactElement).props as Record<string, unknown>;
      return null;
    };
    render(<Probe />);

    // `ctx?.dataSource ?? null` — a `null` reaching a prop declared
    // `dataSource: DataSource`, kept quiet by the `any`-typed context. Pinned
    // as an observation, not endorsed: ObjectView guards on it, so the view
    // renders empty rather than throwing.
    expect((passed as unknown as { dataSource?: unknown } | null)?.dataSource).toBeNull();
  });
});
