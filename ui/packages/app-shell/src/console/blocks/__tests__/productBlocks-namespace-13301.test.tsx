/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The five console home blocks register under the `app-shell` namespace
 * (objectui#13301, maintainer ruling 6312301934), so the registry logs no
 * "without a namespace is deprecated" line for them when the module loads,
 * and a page that writes the bare key still draws the block through the
 * registry's bare fallback.
 *
 * The capture of `console.warn` is installed in `vi.hoisted`, which runs
 * before this file's imports, so it sees what `../productBlocks` logs while it
 * evaluates. This file runs in an isolated project, so that evaluation is this
 * file's own.
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererContext } from '@object-ui/react';
import type { DeclaredNode } from '@object-ui/types';

const warnings = vi.hoisted(() => {
  const seen: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  };
  return { seen, original };
});

import '../productBlocks';

const HOME_BLOCKS = ['hero', 'stat', 'usage-bar', 'checklist', 'tile-grid'] as const;

const DEPRECATED = /Registering component "([^"]+)" without a namespace is deprecated/;

afterEach(() => cleanup());
afterAll(() => {
  console.warn = warnings.original;
});

describe('console home blocks register under `app-shell` (objectui#13301)', () => {
  it('logs no deprecation line for the five blocks when the module loads', () => {
    const named = warnings.seen
      .map((line) => DEPRECATED.exec(line)?.[1])
      .filter((type): type is string => Boolean(type));
    for (const block of HOME_BLOCKS) expect(named, block).not.toContain(block);
  });

  it('the capture is live: a bare registration made now is logged', () => {
    const probe = 'probe-bare-13301';
    ComponentRegistry.register(probe, () => null);
    try {
      expect(warnings.seen.some((line) => DEPRECATED.exec(line)?.[1] === probe)).toBe(true);
    } finally {
      ComponentRegistry.unregister(probe);
    }
  });

  it('resolves the bare key and the `app-shell:` key to the same renderer', () => {
    for (const block of HOME_BLOCKS) {
      const namespaced = ComponentRegistry.get(`app-shell:${block}`);
      expect(namespaced, `app-shell:${block}`).toBeTruthy();
      expect(ComponentRegistry.get(block), block).toBe(namespaced);
    }
  });
});

function renderNode(schema: DeclaredNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter>
        <SchemaRendererContext.Provider value={{ dataSource: null }}>
          <SchemaRenderer schema={schema} />
        </SchemaRendererContext.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('a page authoring the bare key still draws each block (objectui#13301)', () => {
  const pages: ReadonlyArray<readonly [string, DeclaredNode, string]> = [
    ['hero', { type: 'hero', properties: { title: 'Your workspace' } }, 'Your workspace'],
    ['stat', { type: 'stat', properties: { label: 'Members', value: 3 } }, 'Members'],
    ['usage-bar', { type: 'usage-bar', properties: { label: 'Storage', used: 256, limit: 1024 } }, 'Storage'],
    ['checklist', { type: 'checklist', properties: { items: [{ label: 'Create an environment', done: false }] } }, 'Create an environment'],
    ['tile-grid', { type: 'tile-grid', properties: { items: [{ label: 'CRM', href: '/apps/crm' }] } }, 'CRM'],
  ];

  it.each(pages)('`%s`', (_block, schema, text) => {
    renderNode(schema);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/Unknown component type/i)).toBeNull();
  });
});
