/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5123 — one key, one answer, whichever channel reads it.
 *
 * A node may spell its config bag `properties` (the spec spelling) or `props`
 * (the annotated legacy alias). When a node writes BOTH, the renderer used to
 * return a DIFFERENT value depending on which channel the reading renderer
 * happened to use, and the two channels' precedence was exactly OPPOSITE:
 *
 *   | channel                            | pre-fix winner | site                                          |
 *   |------------------------------------|----------------|-----------------------------------------------|
 *   | config bag (`schema.properties.x`) | `properties`   | `readProps()` = `{ ...props, ...properties }` |
 *   | React prop (`x` arriving as prop)  | `props`        | `createElement`: `...componentProps` then     |
 *   |                                    |                | `...(evaluatedSchema.props \|\| {})` last     |
 *
 * Measured on a single render before the fix, with one node carrying both:
 *
 *   bagRead(properties.content)="FROM_PROPERTIES"  reactPropRead(content)="FROM_PROPS"
 *
 * Ruled by the maintainer 2026-08-18: **`properties` wins on BOTH channels.**
 * The config-bag order was already right and is untouched; the React-prop
 * channel is the one that moved. That restores the declared posture (`props` is
 * an annotated legacy alias) rather than changing it.
 *
 * WHY THIS FILE READS BOTH CHANNELS IN ONE RENDER (the point of the pin):
 * a test that only exercised the channel the fix edited would let the two drift
 * apart again — which is the actual defect class here, not the individual
 * spread order. So every case below asserts the SAME key through BOTH read
 * paths of the SAME node in the SAME render, and asserts they agree.
 *
 * Adjacent but NOT answered here: objectui#4795's pending question ② — whether
 * the `properties` envelope is an official `ui:*` authoring channel at all.
 * This ruling fixes precedence between two co-present spellings; it takes no
 * position on whether either spelling should exist. Do not read these pins as
 * blessing the envelope.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

const DATA = { total: 99, label: 'Widgets' };

/**
 * Mirrors `readProps()` in `@object-ui/components` verbatim
 * (`{ ...schema.props, ...schema.properties }`). Duplicated rather than
 * imported because `@object-ui/react` by design does not depend on
 * `@object-ui/components`; the real production renderers are pinned against the
 * same node shape in
 * `packages/components/src/__tests__/alias-precedence-cross-channel.test.tsx`,
 * so this stand-in is never the only reading.
 */
function readProps(schema: any): Record<string, any> {
  return { ...(schema?.props ?? {}), ...(schema?.properties ?? {}) };
}

/**
 * The issue's probe: reads BOTH channels of the same node in one render.
 * Recorded from an effect, not during render — a render-phase write to a
 * module-scope binding is an impurity (`react-hooks/globals`), and RTL's
 * `render()` flushes effects inside `act()`, so this is settled by the time any
 * assertion reads it.
 */
const seen: { bag: any; reactProps: any; schema: any } = {
  bag: undefined,
  reactProps: undefined,
  schema: undefined,
};

const CrossChannelProbe = ({ schema, ...reactProps }: any) => {
  const bag = readProps(schema);
  React.useEffect(() => {
    seen.bag = bag;
    seen.reactProps = reactProps;
    seen.schema = schema;
  });
  return (
    <p
      data-testid="probe"
      data-bag-read={String(bag.content)}
      data-react-prop-read={String(reactProps.content)}
    />
  );
};

const renderWithData = (schema: any) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as any}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
  );

/** Both channels of one node, as the issue's probe printed them. */
const readBothChannels = (schema: any) => {
  const { container } = renderWithData(schema);
  const el = container.querySelector('[data-testid="probe"]')!;
  return {
    bagRead: el.getAttribute('data-bag-read'),
    reactPropRead: el.getAttribute('data-react-prop-read'),
  };
};

describe('alias precedence is the same on both read channels (objectui#5123)', () => {
  beforeEach(() => {
    seen.bag = undefined;
    seen.reactProps = undefined;
    seen.schema = undefined;
    ComponentRegistry.register('xchan', CrossChannelProbe, {
      namespace: 'element',
      skipFallback: true,
    });
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('xchan', 'element');
  });

  // -------------------------------------------------------------------------
  // (a) the invariant itself — the whole point of the card
  // -------------------------------------------------------------------------
  describe('a node carrying BOTH spellings', () => {
    it('gives ONE answer for the key, and it is the canonical `properties` one', () => {
      const { bagRead, reactPropRead } = readBothChannels({
        type: 'element:xchan',
        props: { content: 'FROM_PROPS' },
        properties: { content: 'FROM_PROPERTIES' },
      });

      // The invariant, stated as the equality that must never break again.
      // Before the fix this line read FROM_PROPERTIES !== FROM_PROPS.
      expect(bagRead).toBe(reactPropRead);
      // ...and the ruling says WHICH answer the single answer is.
      expect(bagRead).toBe('FROM_PROPERTIES');
      expect(reactPropRead).toBe('FROM_PROPERTIES');
    });

    it('keeps the losing `props` bag intact on the schema (it is shadowed, not deleted)', () => {
      readBothChannels({
        type: 'element:xchan',
        props: { content: 'FROM_PROPS' },
        properties: { content: 'FROM_PROPERTIES' },
      });

      // The fix shadows the legacy value on the way out to React; it must not
      // mutate the node. A renderer that deliberately inspects `schema.props`
      // (or a future migration that wants to report the alias) still sees it,
      // and `readProps()`'s own merge stays meaningful rather than becoming a
      // merge of a bag with itself.
      expect(seen.schema.props).toEqual({ content: 'FROM_PROPS' });
      expect(seen.schema.properties).toEqual({ content: 'FROM_PROPERTIES' });
    });

    it('resolves per key: a key only `props` declares still arrives', () => {
      const { container } = renderWithData({
        type: 'element:xchan',
        props: { content: 'FROM_PROPS', onlyInProps: 'KEPT' },
        properties: { content: 'FROM_PROPERTIES' },
      });
      expect(container.querySelector('[data-testid="probe"]')).toBeTruthy();

      // Overlapping key -> canonical wins on both channels.
      expect(seen.bag.content).toBe('FROM_PROPERTIES');
      expect(seen.reactProps.content).toBe('FROM_PROPERTIES');
      // Non-overlapping key -> the alias is untouched on both channels. The fix
      // narrows the alias per KEY, it does not switch the alias off.
      expect(seen.bag.onlyInProps).toBe('KEPT');
      expect(seen.reactProps.onlyInProps).toBe('KEPT');
    });

    it('holds for expression values too — both bags evaluate, then canonical wins', () => {
      const { bagRead, reactPropRead } = readBothChannels({
        type: 'element:xchan',
        props: { content: '${data.label}' },
        properties: { content: '${data.total}' },
      });

      // Not the raw source on either side (objectui#4799 evaluates both bags),
      // and the same evaluated value through both channels.
      expect(bagRead).toBe(reactPropRead);
      expect(bagRead).toBe('99');
      // Both bags are still evaluated in place — the loser is shadowed, not
      // skipped, so nothing that reads `schema.props` gets raw `${…}` back.
      expect(seen.schema.props.content).toBe('Widgets');
      expect(seen.schema.properties.content).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // (b) single-spelling nodes are untouched — the blast radius is co-occurrence
  //     only. These are the readings that must NOT move.
  // -------------------------------------------------------------------------
  describe('a node carrying only one spelling is unaffected', () => {
    it('`properties` only: both channels read it (unchanged)', () => {
      const { bagRead, reactPropRead } = readBothChannels({
        type: 'element:xchan',
        properties: { content: 'ONLY_PROPERTIES' },
      });
      expect(bagRead).toBe('ONLY_PROPERTIES');
      expect(reactPropRead).toBe('ONLY_PROPERTIES');
    });

    it('`props` only: both channels read it (unchanged — the alias keeps working)', () => {
      const { bagRead, reactPropRead } = readBothChannels({
        type: 'element:xchan',
        props: { content: 'ONLY_PROPS' },
      });
      expect(bagRead).toBe('ONLY_PROPS');
      expect(reactPropRead).toBe('ONLY_PROPS');
    });

    it('a degenerate (non-object) `properties` leaves the alias spread alone', () => {
      // The hoist and `readProps()` both treat a non-object `properties` by
      // object-spreading it; there is no canonical bag to prefer, so the fix
      // declines to reinterpret it and today's reading stands. Pinned so the
      // narrowing is a decision on the record rather than an accident.
      const { reactPropRead } = readBothChannels({
        type: 'element:xchan',
        props: { content: 'FROM_PROPS' },
        properties: 'not-a-bag',
      });
      expect(reactPropRead).toBe('FROM_PROPS');
    });
  });

  // -------------------------------------------------------------------------
  // (c) the carve-out the hoist already owns
  // -------------------------------------------------------------------------
  describe('the outer component descriptor still wins over an inner `type`/`id`', () => {
    it('does not let `properties.id` shadow the alias, because the hoist never copies it', () => {
      // `type`/`id` are the two keys the hoist deliberately refuses to copy up
      // (they identify WHICH renderer to dispatch to; an inner `type` is a
      // renderer-specific prop such as a tab's visual style). Since the hoist
      // never puts `properties.id` on the node, there is no canonical value on
      // this channel to win with — dropping the alias here would delete the
      // prop rather than replace it. So these two keys keep today's reading,
      // and the narrowing skips them.
      readBothChannels({
        type: 'element:xchan',
        id: 'OUTER',
        props: { id: 'FROM_PROPS' },
        properties: { id: 'INNER', content: 'c' },
      });
      expect(seen.reactProps.id).toBe('FROM_PROPS');
      // The outer descriptor is intact — that is what the hoist protects.
      expect(seen.schema.type).toBe('element:xchan');
      expect(seen.schema.id).toBe('OUTER');
    });
  });
});
