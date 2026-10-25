/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9100 — the CEL envelope must survive the CONFIG-BAG channel too.
 *
 * ## The blind spot this closes
 *
 * `SchemaRenderer.predicateEnvelopeDeclared.test.tsx` (objectui#7530) pins the
 * envelope on `visible` / `hidden` / `disabled` and has been green since it
 * landed — but every one of its mounts writes the key at NODE level
 * (`{ type, visible: envelope }`). Nothing runs over a node-level key.
 *
 * The SPEC spelling is `properties` (and its legacy alias `props`), which is
 * what a published artifact and both `/api/v1/meta/*` endpoints actually emit,
 * and that channel goes through the per-value evaluation loops in the
 * evaluation memo. Those loops handed every value to
 * `ExpressionEvaluator.evaluate`, whose FIRST action is to unwrap any
 * `{ source: string }` object down to its bare `source` — the unwrap that
 * makes a `template` envelope interpolate. Applied to a `cel` PREDICATE it is
 * destructive: the envelope is the only thing that routes `evaluateCondition`
 * to the canonical `@objectstack/formula` engine, and the loop runs BEFORE the
 * hoist, so the node gate below it and the renderer one layer under it both
 * received a bare string and both took the legacy JS path.
 *
 * So the two channels disagreed about one key, which is precisely the class
 * objectui#5123 ruled on ("one answer per key, whichever channel reads it") —
 * and the half that was broken was the canonical one.
 *
 * ## Why the predicate carries a CEL stdlib call
 *
 * A predicate that both engines can evaluate cannot detect the routing: the
 * legacy JS engine binds `record` / `data` perfectly well, and the card's own
 * browser ablation is what established that. What it cannot do is the CEL
 * stdlib. `has(…)` is therefore not decoration — it is the discriminator, and
 * a predicate without one would leave this file green on the broken tree.
 *
 * ## Both polarities, because they fail in OPPOSITE directions
 *
 * `evaluateCondition`'s fail-soft answer is `true` on every internal path. The
 * four SHOW legs negate it, so a broken gate RENDERS (fail-open — measured in
 * a real browser on `record:alert`); the two HIDE legs return it un-negated,
 * so a broken gate makes the node VANISH (fail-closed). Both were live here
 * and both are pinned below, because a one-polarity suite would have passed
 * on half of the defect.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry, ExpressionEvaluator } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import type { DataSource } from '@object-ui/types';
import { PredicateScopeProvider } from '../hooks/useExpression';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

const Probe = (props: { schema?: { props?: Record<string, unknown> } }) => (
  <div
    data-testid="probe"
    // What the `props`-bag value still IS by the time a renderer reads it.
    // `@object-ui/components`' `readProps` merges `{ ...schema.props,
    // ...schema.properties }`, so this bag is a real consumer surface even
    // though the node gate never consults it (see the `props` group below).
    data-props-visible-kind={
      props.schema?.props?.visible && typeof props.schema.props.visible === 'object'
        ? `envelope:${String((props.schema.props.visible as { dialect?: unknown }).dialect)}`
        : typeof props.schema?.props?.visible
    }
  />
);

const DATA = { status: 'draft' };

/** CEL stdlib call + a comparison. `has` does not exist on the legacy engine. */
const HOLDS = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
const FAILS = { dialect: 'cel', source: 'has(data.status) && data.status == "published"' };

function mount(schema: unknown) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );
}

function rendered(): boolean {
  return screen.queryByTestId('probe') !== null;
}

/** Mount one `properties` bag twice — holding and failing — and report the pair. */
function pair(predicateKey: string) {
  const holds = (() => {
    mount({ type: 'probe-9100', properties: { [predicateKey]: HOLDS } });
    const r = rendered();
    cleanup();
    return r;
  })();
  const fails = (() => {
    mount({ type: 'probe-9100', properties: { [predicateKey]: FAILS } });
    const r = rendered();
    cleanup();
    return r;
  })();
  return { holds, fails };
}

describe('#9100 — a CEL envelope in the config bag reaches the CEL engine', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-9100', Probe as never);
  });
  afterEach(() => {
    cleanup();
    ComponentRegistry.unregister?.('probe-9100');
  });

  // A pair of EQUAL verdicts is the signature of a gate that was never
  // consulted, whichever way it landed — which is exactly what the broken
  // tree produced on every row below.
  it.each(['visibleWhen', 'visible', 'visibleOn'])(
    'properties.%s (SHOW polarity): holds renders, fails hides',
    (key) => {
      expect(pair(key)).toEqual({ holds: true, fails: false });
    },
  );

  it.each(['hidden', 'hiddenOn'])(
    'properties.%s (HIDE polarity): holds hides, fails renders',
    (key) => {
      expect(pair(key)).toEqual({ holds: false, fails: true });
    },
  );

  /**
   * The `props` alias gets the SAME guard in the evaluation memo, and it has
   * to: objectui#5123 ruled "one answer per key, whichever channel reads it",
   * and `@object-ui/components`' `readProps` merges `{ ...schema.props,
   * ...schema.properties }`, so a renderer really can read a predicate from
   * this bag. What it CANNOT do is drive the node gate — the hoist copies
   * `properties` onto the node and nothing copies `props` — so the assertion
   * here is on the value a renderer receives, not on a verdict.
   *
   * ⚠️ That gap is PRE-EXISTING and independent of this card: measured on the
   * same tree, a plain `props: { visible: false }` renders and a plain
   * `props: { hidden: true }` renders too, while the `properties` spelling of
   * either decides correctly. Filed separately; ⛔ not repaired here.
   */
  it('props.visible keeps its envelope for the renderer that reads that bag', () => {
    mount({ type: 'probe-9100', props: { visible: HOLDS } });
    expect(screen.getByTestId('probe').getAttribute('data-props-visible-kind')).toBe('envelope:cel');
  });
});

describe('#9100 — what the guard deliberately does NOT change', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-9100', Probe as never);
  });
  afterEach(() => {
    cleanup();
    ComponentRegistry.unregister?.('probe-9100');
  });

  it('a TEMPLATE envelope on the same key still interpolates on the legacy path', () => {
    // Only the `cel` dialect is held back. Narrowing this to "any envelope"
    // would silently retire the template spelling.
    mount({ type: 'probe-9100', properties: { visible: { dialect: 'template', source: '${data.status === "draft"}' } } });
    expect(rendered()).toBe(true);
    cleanup();
    mount({ type: 'probe-9100', properties: { visible: { dialect: 'template', source: '${data.status === "published"}' } } });
    expect(rendered()).toBe(false);
  });

  it('a NON-predicate bag key still has its envelope flattened as before', () => {
    // The guard is keyed on the visibility chain, not on the envelope alone,
    // so `content` / `title` / … keep the behaviour they have always had.
    const ev = new ExpressionEvaluator({ data: DATA });
    expect(ev.evaluate({ dialect: 'cel', source: 'data.status' } as never)).toBe('data.status');
  });
});

describe('#9100 — the discriminator that made the action path look healthy', () => {
  it('the loops are SHALLOW, so an envelope nested in an array is passed through', () => {
    // `page:header`'s actions carry their predicates inside `actions[]`, one
    // level down. `evaluate` returns a non-string untouched and nothing walks
    // into it, so those envelopes never reached the flattening — which is why
    // the action path worked while `record:alert` did not, with both calling
    // the very same normalizer.
    const ev = new ExpressionEvaluator({ data: DATA });
    const nested = [{ name: 'a', visible: HOLDS }];
    expect(ev.evaluate(nested as never)).toEqual(nested);
  });
});
