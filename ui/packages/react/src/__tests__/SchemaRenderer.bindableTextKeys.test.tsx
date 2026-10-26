/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4795 Direction 1 — the top-level text keys the evaluation memo
 * evaluates, and the ones it deliberately leaves inert.
 *
 * ## What was broken
 *
 * A value reaches the screen only if it is BOTH evaluated by the memo AND read
 * back by the renderer off the node. Before this leg the memo evaluated
 * `content`, the two config bags and the predicate keys — so
 * `{ type: 'statistic', value: '${data.total}' }`, whose renderer reads
 * `schema.value`, put the literal `${data.total}` on screen.
 *
 * ## The contract this pins, and where it lives
 *
 * NOT here. `@objectstack/spec` declares it (objectstack#9599): the closed
 * vocabulary `EXPRESSION_BINDABLE_TEXT_KEYS` and the per-component carriage map
 * `EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT`, read through
 * `expressionBindableTextKeysFor(type)`. The memo CONSUMES that lookup; this
 * file pins that it consumes it, never a twin list of its own — so the
 * assertions below name the spec's exports rather than restating their contents
 * as literals, and a spec-side row change lands here as a passing test rather
 * than a red one somebody has to reconcile by hand.
 *
 * The one thing stated as a literal is the CLOSED-ness of the vocabulary
 * itself, which is the maintainer ruling (2026-08-25) rather than a detail:
 * four keys, and a fifth is a new decision.
 *
 * ## The negative half is the load-bearing half
 *
 * The spec's answer for a type with no row is the frozen EMPTY set — "closed
 * and mechanically answerable in both directions, never inferred from what a
 * renderer happens to read". So a closed-set key on an undeclared type stays
 * inert, and that is the contract, not a gap this file should paper over: the
 * `text` / `ui:statistic` cases below fail loudly if a later edit ever widens
 * the lookup by inference.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import {
  EXPRESSION_BINDABLE_TEXT_KEYS,
  EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT,
  expressionBindableTextKeysFor,
} from '@objectstack/spec/ui';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

const DATA = { total: 99, name: 'Widgets', note: 'since last week' };

/**
 * Probes that read the SAME top-level keys the real renderers read, which is
 * what makes "evaluated" and "read back" one observation instead of two.
 * `@object-ui/react` does not depend on `@object-ui/components` by design, so
 * the read points are mirrored here; the sites they mirror are
 * `data-display/statistic.tsx` (`schema.label` / `schema.value` /
 * `schema.description`), `layout/card.tsx` (`schema.title` /
 * `schema.description`) and `form/button.tsx` (`schema.label`).
 */
const TopLevelProbe = ({ schema }: any) => (
  <div
    data-testid="probe"
    data-title={String(schema.title)}
    data-label={String(schema.label)}
    data-value={String(schema.value)}
    data-description={String(schema.description)}
  />
);

beforeAll(() => {
  for (const type of ['statistic', 'card', 'button', 'text', 'ui:statistic', 'constructor']) {
    // Registered with a namespace, so the registry ALSO creates the bare-name
    // fallback entry — and the bare name is the spelling these nodes are
    // authored with, which is the one the memo asks the spec about.
    ComponentRegistry.register(type, TopLevelProbe, { namespace: 'test-4795' });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderNode = (schema: any) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as any}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );

const read = (key: string) => screen.getByTestId('probe').getAttribute(`data-${key}`);

describe('objectui#4795 — the memo consumes the spec-declared bindable text keys', () => {
  it('the vocabulary it consumes is the spec\'s closed four, not a local list', () => {
    expect([...EXPRESSION_BINDABLE_TEXT_KEYS]).toEqual(['title', 'label', 'value', 'description']);
  });

  describe.each(Object.keys(EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT))(
    'declared type `%s`',
    (type) => {
      const declared = expressionBindableTextKeysFor(type);

      it(`evaluates exactly its declared keys (${declared.join(', ')}) and reads them back`, () => {
        const node: any = { type };
        for (const key of EXPRESSION_BINDABLE_TEXT_KEYS) node[key] = '${data.total}';
        renderNode(node);

        for (const key of EXPRESSION_BINDABLE_TEXT_KEYS) {
          if (declared.includes(key as any)) {
            expect(read(key), `${type}.${key} is declared and must be evaluated`).toBe('99');
          } else {
            expect(read(key), `${type}.${key} is NOT declared and must stay inert`).toBe('${data.total}');
          }
        }
      });
    },
  );

  it('interpolates inside a surrounding string, like `content` does', () => {
    renderNode({ type: 'statistic', value: 'Total: ${data.total} (${data.note})' });
    expect(read('value')).toBe('Total: 99 (since last week)');
  });

  it('leaves a non-string value untouched', () => {
    renderNode({ type: 'statistic', value: 0, label: null });
    expect(read('value')).toBe('0');
    expect(read('label')).toBe('null');
  });

  it('leaves a plain string with no template untouched', () => {
    renderNode({ type: 'card', title: 'Revenue' });
    expect(read('title')).toBe('Revenue');
  });
});

describe('objectui#4795 — the closed set is closed in the OTHER direction too', () => {
  /**
   * `text` reads `schema.content || schema.value` (`basic/text.tsx`), so its
   * `value` IS a top-level read-back site — and it still has no spec row, so
   * the memo must leave it alone. Declaring it here instead would be exactly
   * the renderer-side inference the spec module forbids in its own docblock;
   * the route for it is a spec row, not this file.
   */
  it('a closed-set key on an undeclared type stays inert (`text.value`)', () => {
    expect(expressionBindableTextKeysFor('text')).toHaveLength(0);
    renderNode({ type: 'text', value: '${data.total}' });
    expect(read('value')).toBe('${data.total}');
  });

  /**
   * The lookup is fed the AUTHORED type string verbatim. The spec keys its map
   * on the bare registry name, and a namespaced spelling has no row — so it
   * gets the empty set. Pinned rather than left implicit because the tempting
   * "just strip the prefix" would silently grant rows to `element:button` and
   * `page:card`, whose renderers do not read these keys off the node at all.
   */
  it('a namespaced spelling is not silently normalized (`ui:statistic`)', () => {
    expect(expressionBindableTextKeysFor('ui:statistic')).toHaveLength(0);
    renderNode({ type: 'ui:statistic', value: '${data.total}' });
    expect(read('value')).toBe('${data.total}');
  });

  /** A prototype-chain name must not answer with a function off `Object.prototype`. */
  it('a prototype-chain type name gets the empty set', () => {
    expect(expressionBindableTextKeysFor('constructor')).toHaveLength(0);
    renderNode({ type: 'constructor', title: '${data.total}' });
    expect(read('title')).toBe('${data.total}');
  });
});

describe('objectui#4795 — it composes with the config-bag legs already in the memo', () => {
  /**
   * `properties.*` is evaluated by its own leg and then hoisted onto the node,
   * so by the time this leg runs the hoisted value carries no `${…}` left to
   * evaluate. Re-evaluating it is a no-op (`evaluate` returns a template-free
   * string as-is) — the same idempotence the `content` leg relies on.
   */
  it('a value arriving through the `properties` hoist is not double-evaluated', () => {
    renderNode({ type: 'statistic', properties: { value: '${data.total}' } });
    expect(read('value')).toBe('99');
  });

  it('a top-level key loses to `properties` on the same key, as objectui#5123 rules', () => {
    renderNode({ type: 'statistic', value: '${data.total}', properties: { value: '${data.name}' } });
    expect(read('value')).toBe('Widgets');
  });
});
