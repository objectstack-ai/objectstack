/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10859 batch 8, phase 2d — the four `components-basic-sidebar`
 * documents teach the `sidebar` node itself, measured by a render AND by
 * `objectui validate` (the seat's fork ruling, "Fork 3").
 *
 * Before this phase each document was a `sidebar-provider` root composing the
 * ten `sidebar-*` primitives this phase retires. The node now supplies its own
 * provider when its host has none, so each document is one `sidebar` node with
 * `collapsible: false` and ordinary armed children.
 *
 * `collapsible: false` is what the documents author because it is the one form
 * that draws in EVERY host: shadcn's in-flow, fixed-width panel, which ignores
 * the provider's open state. The collapsible form (omitted or `true`) follows
 * the host's state instead, and the docs-site hosts mount their provider with
 * `defaultOpen={false}` — so a gallery document in that form starts collapsed,
 * off-canvas, and draws nothing a reader can see.
 *
 * Measured per document, in both host shapes the docs reach:
 *
 *   - BARE, the way a copy-pasted document lands in a page with no provider:
 *     one provider (the node's own), the in-flow form, every authored string;
 *   - the DOCS HOST, `SidebarProvider className="min-h-0 w-full"
 *     defaultOpen={false}` around `div.w-full.p-4` (`SchemaThumbnail`,
 *     `InteractiveDemo`, `LiveSplitDemo`): still one provider — the host's,
 *     never shadowed — and still the in-flow form;
 *   - both validator faces: `safeValidateSchema` (the tolerant face) and
 *     `StrictAnyComponentSchema` (the face `objectui validate` runs).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';
import { examplesByCategory } from '../src/index.js';

afterEach(cleanup);

type Json = Record<string, unknown>;

const CATEGORY = 'components-basic-sidebar';
const DOC_IDS = [
  'components-basic-sidebar/basic-sidebar',
  'components-basic-sidebar/collapsible-sidebar',
  'components-basic-sidebar/grouped-sidebar',
  'components-basic-sidebar/sidebar-with-badges',
];

/** The registry's panel and the renderer's error boundary (catalog-gallery-render.test.tsx). */
const DIAGNOSTICS = ['Unknown component type', 'failed to render'];

const docs = (examplesByCategory(CATEGORY) as Array<{ id: string; schema: unknown }>).slice().sort((a, b) =>
  a.id.localeCompare(b.id),
);

/** Every node type a document authors, at any depth. */
function typesIn(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => typesIn(child, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const record = node as Json;
  if (typeof record.type === 'string') into.push(record.type);
  for (const value of Object.values(record)) typesIn(value, into);
  return into;
}

/**
 * Every string a document authors in a text-bearing key, at any depth —
 * including under a `flex` node's `properties` bag, where that node's children
 * live (objectui#11276).
 */
function authoredStrings(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => authoredStrings(child, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const record = node as Json;
  for (const key of ['content', 'label'] as const) {
    if (typeof record[key] === 'string') into.push(record[key] as string);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') authoredStrings(value, into);
  }
  return into;
}

const providers = (c: HTMLElement) => c.querySelectorAll('[class*="group/sidebar-wrapper"]').length;

function drawBare(schema: unknown) {
  return render(
    <div className="w-full p-4">
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </div>,
  );
}

function drawInDocsHost(schema: unknown) {
  return render(
    <SidebarProvider className="min-h-0 w-full" defaultOpen={false}>
      <div className="w-full p-4">
        <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
      </div>
    </SidebarProvider>,
  );
}

describe(`${CATEGORY}: the documents teach the sidebar node (objectui#10859 batch 8)`, () => {
  it('names exactly the four documents — a vacuous category would pass every case below', () => {
    expect(docs.map((d) => d.id)).toEqual(DOC_IDS);
  });

  describe.each(docs.map((d) => [d.id, d] as const))('%s', (_id, doc) => {
    const schema = doc.schema as Json;

    it('is one `sidebar` node authoring `collapsible: false`, and composes no retired `sidebar-*` primitive', () => {
      expect(schema.type).toBe('sidebar');
      expect(schema.collapsible).toBe(false);
      expect(typesIn(schema).filter((t) => t.startsWith('sidebar-'))).toEqual([]);
    });

    it('validates on both faces', () => {
      expect(safeValidateSchema(schema).success).toBe(true);
      expect(
        (StrictAnyComponentSchema as { safeParse: (v: unknown) => { success: boolean } }).safeParse(schema).success,
      ).toBe(true);
    });

    it('draws in a bare host: its own single provider, the in-flow form, every authored string', () => {
      const { container } = drawBare(schema);
      const text = container.textContent ?? '';
      for (const diagnostic of DIAGNOSTICS) expect(text).not.toContain(diagnostic);
      const strings = authoredStrings(schema);
      expect(strings.length).toBeGreaterThan(0);
      for (const s of strings) expect(text).toContain(s);
      expect(providers(container)).toBe(1);
      expect(container.querySelector('[data-collapsible]')).toBeNull();
    });

    it("draws in the docs host: the host's provider only, and still the in-flow form", () => {
      const { container } = drawInDocsHost(schema);
      const text = container.textContent ?? '';
      for (const diagnostic of DIAGNOSTICS) expect(text).not.toContain(diagnostic);
      for (const s of authoredStrings(schema)) expect(text).toContain(s);
      expect(providers(container)).toBe(1);
      expect(container.querySelector('[data-collapsible]')).toBeNull();
    });
  });
});
