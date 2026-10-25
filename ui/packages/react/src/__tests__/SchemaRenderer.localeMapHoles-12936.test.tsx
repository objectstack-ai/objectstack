/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12936: each member of an inline locale map is evaluated like a plain
 * string on the same key.
 *
 * The per-value config-bag rule handed every object without an expression
 * envelope over as authored (objectui#10288's data-object rule), and the spec's
 * inline locale map (`{ en: '...', 'zh-CN': '...' }`, the second `I18nLabel`
 * form) is such an object. So a `${...}` inside the member a block picks with
 * `pickLocalized` was drawn as text, while the same hole in a plain string on
 * the same key was evaluated. The rule lives in `utils/localeMap.ts`; the
 * hero block's zh / en reading of it is pinned beside that block, in
 * `@object-ui/app-shell`.
 *
 * Each case below states the parity it pins: a member evaluates to what a
 * plain string with the same text on a sibling key evaluates to, against the
 * same scope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, evaluateConfigBagInScope } from '../SchemaRenderer';
import { SchemaRendererContext, type ApiFetch } from '../context/SchemaRendererContext';
import { RecordContextProvider } from '../context/RecordContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import { PageVariablesProvider } from '../hooks/usePageVariables';
import { isInlineLocaleMap } from '../utils/localeMap';
import {
  collectUnevaluatedExpressions,
  UNEVALUATED_EXPRESSION_PREFIX,
} from '../utils/unevaluatedExpression';

type Seen = Record<string, unknown> & {
  properties?: Record<string, unknown>;
  props?: Record<string, unknown>;
};

/** Every schema the probe was handed; the last one is what it rendered. */
const handed = vi.fn<(schema: Seen | undefined) => void>();

const Probe = (props: { schema?: Seen }) => {
  handed(props.schema);
  return <div data-testid="probe-12936" />;
};

const seen = (): Seen | undefined => handed.mock.lastCall?.[0];

const TYPE = 'probe-12936';

/** One root per case: how a node reaches it, and a template that reads it. */
interface RootCase {
  root: string;
  hole: string;
  expected: string;
  mount: (schema: Record<string, unknown>) => void;
}

const ROW = { id: 'rec_1', name: 'Acme' };

const API_HOME = { success: true, data: { environments: [{ lastPublishedAt: 'Oct 16' }] } };

let apiUrlSeq = 0;

const ROOTS: RootCase[] = [
  {
    root: 'record',
    hole: '${record.name}',
    expected: 'Acme',
    mount: (schema) => {
      render(
        <RecordContextProvider objectName="account" recordId={ROW.id} data={ROW}>
          <SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
        </RecordContextProvider>,
      );
    },
  },
  {
    root: 'page',
    hole: '${page.stage}',
    expected: 'beta',
    mount: (schema) => {
      render(
        <PageVariablesProvider definitions={[{ name: 'stage', type: 'string', defaultValue: 'beta' } as never]}>
          <SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
        </PageVariablesProvider>,
      );
    },
  },
  {
    root: 'current_user',
    hole: '${current_user.name}',
    expected: 'Ada',
    mount: (schema) => {
      render(
        <PredicateScopeProvider scope={{ user: { name: 'Ada' } }}>
          <SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
        </PredicateScopeProvider>,
      );
    },
  },
  {
    root: 'data (API binding)',
    hole: '${data.environments[0].lastPublishedAt}',
    expected: 'Oct 16',
    mount: (schema) => {
      apiUrlSeq += 1;
      const apiFetch = vi.fn<ApiFetch>(
        async () => new Response(JSON.stringify(API_HOME), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
      render(
        <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
          <SchemaRenderer
            schema={{
              type: TYPE,
              dataSource: { provider: 'api', read: { url: '/api/v1/home-12936-' + apiUrlSeq }, path: 'data' },
              ...schema,
            } as never}
          />
        </SchemaRendererContext.Provider>,
      );
    },
  },
];

/** Settles once the probe has drawn (the API binding answers asynchronously). */
const drawn = () => waitFor(() => expect(seen()).toBeDefined());

beforeEach(() => {
  handed.mockClear();
  ComponentRegistry.register(TYPE, Probe as never);
});

afterEach(() => {
  cleanup();
  ComponentRegistry.unregister?.(TYPE);
});

describe('objectui#12936: an inline locale map member is evaluated like a plain string on the same key', () => {
  it.each(ROOTS)('`properties`: every member, against the $root root, as a plain string is', async ({ hole, expected, mount }) => {
    mount({
      properties: {
        title: { en: 'Published ' + hole, fr: 'Publie ' + hole },
        subtitle: 'Published ' + hole,
      },
    });
    await drawn();
    const evaluated = { en: 'Published ' + expected, fr: 'Publie ' + expected };
    expect(seen()?.properties?.subtitle).toBe('Published ' + expected);
    expect(seen()?.properties?.title).toEqual(evaluated);
    // The hoist copies the evaluated map onto the node, where renderers read it.
    expect(seen()?.title).toEqual(evaluated);
  });

  it('the legacy `props` alias evaluates the members too: the two bag loops agree', async () => {
    ROOTS[0].mount({ props: { title: { en: 'Hi ${record.name}' } } });
    await drawn();
    expect(seen()?.props?.title).toEqual({ en: 'Hi Acme' });
  });

  it('`evaluateConfigBagInScope` (`useConfigBagEvaluator`, a block member) applies the same rule', () => {
    const bag = evaluateConfigBagInScope(
      { label: { en: 'Open ${record.name}', 'zh-CN': '${record.name}' }, caption: 'Open ${record.name}' },
      {},
      ROW,
      {},
    ) as Record<string, unknown>;
    expect(bag.caption).toBe('Open Acme');
    expect(bag.label).toEqual({ en: 'Open Acme', 'zh-CN': 'Acme' });
  });

  it('a member that is one whole hole stays a string, so the map stays a map', () => {
    const bag = evaluateConfigBagInScope(
      { value: { en: '${record.count}', default: '${record.missing}' } },
      {},
      { count: 3 },
      {},
    ) as Record<string, unknown>;
    // A plain string would resolve to the number 3; a member is display text.
    expect(bag.value).toEqual({ en: '3', default: '' });
    expect(isInlineLocaleMap(bag.value)).toBe(true);
  });
});

describe('objectui#12936 CONTROLS: what keeps the data-object rule', () => {
  it('a locale map without a hole arrives as the very object that was authored', async () => {
    const authored = { en: 'Your workspace', 'zh-CN': 'Workspace (zh)' };
    ROOTS[0].mount({ properties: { title: authored } });
    await drawn();
    expect(seen()?.properties?.title).toBe(authored);
  });

  it.each([
    ['a non-string member', { en: 'Published ${record.name}', count: 3 }],
    ['a nested object member', { en: { text: 'Published ${record.name}' } }],
    ['a key that is not a locale tag', { caption: 'Published ${record.name}' }],
    ['the retired `key` / `defaultValue` form', { key: 'x', defaultValue: 'Published ${record.name}' }],
  ])('a data object with %s is handed over as authored, nothing inside it evaluated', async (_label, authored) => {
    ROOTS[0].mount({ properties: { title: authored } });
    await drawn();
    expect(seen()?.properties?.title).toBe(authored);
    expect(isInlineLocaleMap(authored)).toBe(false);
  });
});

describe('objectui#12936: the unevaluated-expression diagnostic reads the members too', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const shouts = (): string[] =>
    consoleError.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.includes(UNEVALUATED_EXPRESSION_PREFIX));

  it('a member whose expression throws is reported by its locale, as a plain string on the same key is', async () => {
    ROOTS[0].mount({
      properties: {
        title: { en: 'Published ${nope.id}' },
        subtitle: 'Published ${nope.id}',
      },
    });
    await drawn();
    // An unbound root throws, and the evaluator keeps that hole's source text,
    // in both shapes.
    expect(seen()?.properties?.title).toEqual({ en: 'Published ${nope.id}' });
    const lines = shouts();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('properties.title.en');
    expect(lines[0]).toContain('properties.subtitle');
  });

  it('a member that evaluates is not reported (control)', async () => {
    ROOTS[0].mount({ properties: { title: { en: 'Published ${record.name}' } } });
    await drawn();
    expect(shouts()).toEqual([]);
  });

  it('the scan walks a locale map and nothing else', () => {
    const findings = collectUnevaluatedExpressions(undefined, {
      title: { en: 'A ${x}', 'zh-CN': 'B ${y}' },
      body: { source: 'web', note: 'C ${z}' },
    });
    expect(findings.map((f) => [f.key, f.channel, f.expressions])).toEqual([
      ['title.en', 'properties', ['${x}']],
      ['title.zh-CN', 'properties', ['${y}']],
    ]);
  });
});
