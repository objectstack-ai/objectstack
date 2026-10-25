/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4795 Direction 1 — the same contract as
 * `packages/react/src/__tests__/SchemaRenderer.bindableTextKeys.test.tsx`, but
 * driven through the REAL production renderers with no stand-in for the
 * read-back half.
 *
 * That companion file pins the memo against probes, because `@object-ui/react`
 * by design does not depend on `@object-ui/components`. It can therefore prove
 * the value was EVALUATED, and only assert the read-back against a mirror of
 * the real read points. This file closes that gap: `statistic`, `card` and
 * `button` here are the shipped renderers, so a passing assertion below means
 * the evaluated value actually reached the DOM — which is the whole of what
 * objectui#4795 measured as missing ("evaluated AND read back").
 *
 * ## Why this file contains no renderer-specific fix to guard
 *
 * It guards the OPPOSITE. The ruling's implementation caution was that these
 * read-back sites must be "converged on evaluated values, not patched per
 * component" — and none of `data-display/statistic.tsx`, `layout/card.tsx` or
 * `form/button.tsx` is touched by this card. They already read the right place;
 * the single memo leg upstream now writes an evaluated value there. So these
 * assertions passing while those three files are untouched IS the convergence
 * claim, stated as a measurement rather than as a promise.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';
// Module scope, not a hook — the cold transform would otherwise be billed to
// `hookTimeout` (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';
import type { DataSource } from '@object-ui/types';

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

const DATA = { total: 99, caption: 'Active users', note: '+20.1% from last month' };

const renderNode = (schema: any) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
      <SchemaRendererProvider dataSource={DATA as unknown as DataSource}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererProvider>
    </PredicateScopeProvider>,
  );

describe('objectui#4795 — declared text keys are evaluated AND read back, through real renderers', () => {
  it('`statistic` binds label / value / description', () => {
    renderNode({
      type: 'statistic',
      label: '${data.caption}',
      value: '${data.total}',
      description: '${data.note}',
    });
    expect(screen.getByText('Active users')).toBeTruthy();
    expect(screen.getByText('99')).toBeTruthy();
    expect(screen.getByText('+20.1% from last month')).toBeTruthy();
    // The defect, stated in the negative: the literal source must be gone.
    expect(screen.queryByText('${data.total}')).toBeNull();
  });

  it('`statistic` interpolates inside surrounding text', () => {
    renderNode({ type: 'statistic', value: 'Total: ${data.total}' });
    expect(screen.getByText('Total: 99')).toBeTruthy();
  });

  it('`card` binds title / description', () => {
    renderNode({ type: 'card', title: '${data.caption}', description: '${data.note}' });
    expect(screen.getByText('Active users')).toBeTruthy();
    expect(screen.getByText('+20.1% from last month')).toBeTruthy();
  });

  it('`button` binds label', () => {
    renderNode({ type: 'button', label: 'Refresh ${data.total}' });
    expect(screen.getByText('Refresh 99')).toBeTruthy();
  });
});

describe('objectui#4795 — the undeclared half stays inert, through real renderers', () => {
  /**
   * `text.value` is RETIRED (objectui#6951, ADR-0049 enforce-or-remove):
   * `basic/text.tsx` renders `{schema.content}` alone, so `value` is no longer
   * a read-back site at all — neither evaluated (the spec's carriage map never
   * had a `text` row for it, objectstack#13670 ruled `content` the sole
   * channel) nor rendered as a literal. Before the retirement this case pinned
   * the literal `${data.total}` on screen as a known gap; now the pin is that
   * NOTHING from the retired key reaches the DOM. The refusal at the authoring
   * boundary is pinned in `@object-ui/types` (`text-value-retired-6951.test.ts`).
   */
  it('`text.value` is retired — neither evaluated nor read back', () => {
    const { container } = renderNode({ type: 'text', value: '${data.total}' });
    expect(container.textContent).not.toContain('${data.total}');
    expect(container.textContent).not.toContain('99');
  });

  it('a key outside the component\'s declared row stays inert (`card.value`)', () => {
    const { container } = renderNode({ type: 'card', title: 'Fixed', value: '${data.total}' });
    // `card` declares title/description only; `value` is neither evaluated nor
    // read back, so nothing from it reaches the DOM text.
    expect(container.textContent).toContain('Fixed');
    expect(container.textContent).not.toContain('99');
  });
});
