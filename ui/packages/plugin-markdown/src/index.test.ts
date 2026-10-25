/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import type { ComponentInput } from '@object-ui/types';
import type { MarkdownSchema } from './types';
// Imports all renderers to register them. Module scope, NOT awaited inside a
// `beforeAll` — there the cold transform of the renderer graph is billed to the
// hook, against `hookTimeout`. That is what made the sibling plugin-kanban test
// blow its raised 15s budget at 15021ms under full parallel load
// (objectui#3010); this file's timed portion was already at 5.83s of the same
// 15s. The import phase has no test/hook timeout, so no raised timeout is
// needed. See AGENTS.md §9 (test discipline).
import './index';

describe('Plugin Markdown', () => {
  describe('markdown component', () => {
    it('should be registered in ComponentRegistry', () => {
      const markdownRenderer = ComponentRegistry.get('markdown');
      expect(markdownRenderer).toBeDefined();
    });

    it('should have proper metadata', () => {
      const config = ComponentRegistry.getConfig('markdown');
      expect(config).toBeDefined();
      expect(config?.label).toBe('Markdown');
      expect(config?.category).toBe('plugin');
      expect(config?.inputs).toBeDefined();
      expect(config?.defaultProps).toBeDefined();
    });

    it('should have expected inputs', () => {
      const config = ComponentRegistry.getConfig('markdown');
      const inputNames = config?.inputs?.map((input: any) => input.name) || [];
      
      expect(inputNames).toContain('content');
      expect(inputNames).toContain('className');
    });

    it('should have content as required input', () => {
      const config = ComponentRegistry.getConfig('markdown');
      const contentInput = config?.inputs?.find((input: any) => input.name === 'content');
      
      expect(contentInput).toBeDefined();
      expect(contentInput?.required).toBe(true);
      expect(contentInput?.type).toBe('string');
    });

    it('no longer authors `inputType` — the write was a measured no-op (objectui#5905)', () => {
      // FLIPPED, not deleted. This assertion used to read
      // `expect(contentInput?.inputType).toBe('textarea')`, and it pinned the
      // ONLY `ComponentInput.inputType` write in the repository. The manifest
      // serializer forwards a fixed key list per input, `of` included since
      // objectui#8067 — `name`, `type`, `of`, `required`, `enum`, `binding`,
      // `description` — and this was never one of them, so the
      // write could not reach the published `sdui.manifest.json` even in
      // principle, and a structural census over every `inputs:` array found no
      // reader either. Maintainer ruling 2026-08-31 (objectui#5905) deleted
      // the write and tombstoned the key. Restated here rather than removed,
      // so the deletion stays asserted instead of becoming a silent absence.
      const config = ComponentRegistry.getConfig('markdown');
      const contentInput = config?.inputs?.find((input: any) => input.name === 'content');

      expect(contentInput).toBeDefined();
      expect(contentInput?.inputType).toBeUndefined();
    });

    it('and re-authoring `inputType` is a `tsc` error at this package\'s own site', () => {
      // REAL enforcement, not decoration: this package's `type-check` script
      // runs `tsc -p tsconfig.test.json`, so the directive below is evaluated
      // and an UNUSED one fails the build. Re-widening
      // `ComponentInput.inputType` therefore turns this line red instead of
      // quietly letting the no-op write back in.
      const reAuthored: ComponentInput = {
        name: 'content',
        type: 'string',
        // @ts-expect-error `inputType` is an ADR-0049 retirement tombstone (objectui#5905)
        inputType: 'textarea',
      };

      expect(reAuthored.name).toBe('content');
    });

    it('should have sensible default props', () => {
      const config = ComponentRegistry.getConfig('markdown');
      const defaults = config?.defaultProps;
      
      expect(defaults).toBeDefined();
      expect(defaults?.content).toBeDefined();
      expect(typeof defaults?.content).toBe('string');
      expect(defaults?.content.length).toBeGreaterThan(0);
      // Verify it contains markdown syntax
      expect(defaults?.content).toContain('#');
    });
  });

  describe('MarkdownSchema retirements reach this package\'s published face (objectui#6972)', () => {
    // `./types` re-exports `MarkdownSchema` from `@object-ui/types` — ONE
    // authority (objectui#6172), not a local copy — so an ADR-0049 tombstone
    // declared there must be a `tsc` error through THIS package's import
    // spelling too. That is the "two published faces" half of the retirement,
    // pinned where the second face lives. REAL enforcement: `type-check` runs
    // `tsc -p tsconfig.test.json`, so an unused directive fails the build —
    // if the plugin ever re-declared a local `MarkdownSchema` that carried the
    // key, this leg goes red before anything else does.
    it('`sanitize` is a `tsc` error through the re-exported authority — sanitization is unconditional', () => {
      const node: MarkdownSchema = {
        type: 'markdown',
        content: '# Hello',
        // @ts-expect-error `sanitize` is an ADR-0049 retirement tombstone (objectui#6972): the renderer sanitizes unconditionally, no value switches it
        sanitize: false,
      };
      expect(node.content).toBe('# Hello');
    });

    it('`components` is a `tsc` error through the re-exported authority — nothing reads an override map', () => {
      const node: MarkdownSchema = {
        type: 'markdown',
        content: '# Hello',
        // @ts-expect-error `components` is an ADR-0049 retirement tombstone (objectui#6972): the renderer forwards only content and className
        components: { h1: 'h2' },
      };
      expect(node.content).toBe('# Hello');
    });

    it('the two values the renderer DOES forward stay writable — the non-vacuity control', () => {
      // `content` and `className` are exactly what `MarkdownRenderer` hands to
      // `MarkdownImpl`; without this leg the directive above could be satisfied
      // by a face that lost the whole interface.
      const node: MarkdownSchema = { type: 'markdown', content: '# Hello', className: 'prose-lg' };
      expect(node.className).toBe('prose-lg');
    });
  });
});
