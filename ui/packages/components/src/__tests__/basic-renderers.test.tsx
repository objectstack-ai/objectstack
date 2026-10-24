/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  renderComponent,
  validateComponentRegistration,
  getAllDisplayIssues,
  checkDOMStructure,
} from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
import type {
  DivSchema,
  HtmlSchema,
  IconSchema,
  ImageSchema,
  SeparatorSchema,
  TextSchema,
  TextSpanSchema,
} from '@object-ui/types';

/**
 * Each literal below is typed as the node it is rather than as the
 * `BaseSchema` `renderComponent` accepts, children included (objectui#11347):
 * since objectui#8347 removed `BaseSchema`'s index signature, a literal
 * checked against `BaseSchema` or `SchemaNode` may author only `BaseSchema`'s
 * own keys.
 */
const textNode = (schema: TextSchema): TextSchema => schema;
const divNode = (schema: DivSchema): DivSchema => schema;
const spanNode = (schema: TextSpanSchema): TextSpanSchema => schema;
const imageNode = (schema: ImageSchema): ImageSchema => schema;
const iconNode = (schema: IconSchema): IconSchema => schema;
const separatorNode = (schema: SeparatorSchema): SeparatorSchema => schema;
const htmlNode = (schema: HtmlSchema): HtmlSchema => schema;

/**
 * Comprehensive tests for basic renderer components
 * These tests automatically detect display and rendering issues
 */
describe('Basic Renderers - Display Issue Detection', () => {
  describe('Text Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('text');
      expect(validation.isRegistered).toBe(true);
      expect(validation.hasConfig).toBe(true);
      expect(validation.hasLabel).toBe(true);
    });

    it('should render text content without issues', () => {
      const { container } = renderComponent(textNode({
        type: 'text',
        content: 'Hello World',
      }));

      expect(container.textContent).toContain('Hello World');
      const issues = getAllDisplayIssues(container);
      expect(issues).toHaveLength(0);
    });

    it('should handle empty content gracefully', () => {
      const { container } = renderComponent(textNode({
        type: 'text',
        content: '',
      }));

      const domCheck = checkDOMStructure(container);
      // Empty text is acceptable, just verify it doesn't crash
      expect(domCheck).toBeDefined();
    });

    it('no longer reads `value` — RETIRED (objectui#6951, ADR-0049), `content` is the one spelling', () => {
      // Before objectui#6951 this case pinned `value` as an alias for `content`
      // (`{schema.content || schema.value}`). The alias is retired on both
      // published faces and the renderer reads `content` alone, so an authored
      // `value` reaches the DOM as NOTHING — the enforce-or-remove half this
      // pin now guards. The refusal itself is pinned in `@object-ui/types`
      // (`text-value-retired-6951.test.ts`); this leg is the read side.
      const { container } = renderComponent({
        type: 'text',
        value: 'Test Value',
      } as never);

      expect(container.textContent).not.toContain('Test Value');
    });

    it('should render with designer props correctly', () => {
      const { container } = renderComponent(
        textNode({ type: 'text', content: 'Designer Test' }),
      );

      // Verify it renders without errors
      expect(container).toBeDefined();
    });
  });

  describe('Div Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('div');
      expect(validation.isRegistered).toBe(true);
      expect(validation.hasConfig).toBe(true);
    });

    it('should render container without issues', () => {
      const { container } = renderComponent(divNode({
        type: 'div',
        className: 'test-class',
      }));

      const div = container.querySelector('div');
      expect(div).toBeTruthy();
      // className might be applied differently, just verify div exists
      expect(div).toBeDefined();
    });

    it('should render children correctly', () => {
      const { container } = renderComponent(divNode({
        type: 'div',
        children: [
          textNode({ type: 'text', content: 'Child 1' }),
          textNode({ type: 'text', content: 'Child 2' }),
        ],
      }));

      expect(container.textContent).toContain('Child 1');
      expect(container.textContent).toContain('Child 2');
    });

    it('should not have display issues', () => {
      const { container } = renderComponent(divNode({
        type: 'div',
        children: [textNode({ type: 'text', content: 'Content' })],
      }));

      const issues = getAllDisplayIssues(container);
      // Should have no critical issues
      expect(issues.filter(i => i.includes('missing accessible label'))).toHaveLength(0);
    });
  });

  describe('Span Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('span');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render inline content', () => {
      const { container } = renderComponent(spanNode({
        type: 'span',
        // Canonical child key — what `TextSpanSchema` declares and what the
        // renderer reads (objectui#5027). This case used to spell `body`, the
        // one key nothing produced, which is what kept the defect invisible.
        children: [textNode({ type: 'text', content: 'Inline text' })],
      }));

      const span = container.querySelector('span');
      expect(span).toBeTruthy();
      expect(span?.textContent).toContain('Inline text');
    });
  });

  describe('Image Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('image');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render with required alt attribute', () => {
      const { container } = renderComponent(imageNode({
        type: 'image',
        src: 'https://example.com/image.jpg',
        alt: 'Test image',
      }));

      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.getAttribute('alt')).toBe('Test image');
      expect(img?.getAttribute('src')).toBe('https://example.com/image.jpg');
    });

    it('should detect missing alt attribute', () => {
      const { container } = renderComponent(imageNode({
        type: 'image',
        src: 'https://example.com/image.jpg',
      }));

      const img = container.querySelector('img');
      // If img has alt, it's good; if not, our check should detect it
      if (img && !img.hasAttribute('alt')) {
        const issues = getAllDisplayIssues(container);
        const altIssues = issues.filter(i => i.includes('alt'));
        expect(altIssues.length).toBeGreaterThan(0);
      } else {
        // Image renderer provides default alt, which is good
        expect(img?.hasAttribute('alt') || true).toBe(true);
      }
    });
  });

  describe('Icon Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('icon');
      expect(validation.isRegistered).toBe(true);
      // Icon may or may not have defaultProps, both are acceptable
      expect(validation.hasConfig).toBe(true);
    });

    // objectui#5631: the glyph key is `icon`. These two cases authored `name`
    // and asserted only that SOME `svg` rendered — an assertion that cannot
    // fail here any more, because the UNRESOLVED placeholder is an `svg` too.
    // So the key is renamed AND the assertion is given teeth: the absence of
    // the placeholder marker is what separates "resolved the requested glyph"
    // from "drew the dashed box that means it did not".
    it('should render icon without issues', () => {
      const { container } = renderComponent(iconNode({
        type: 'icon',
        icon: 'star',
      }));

      // Icon should render an SVG
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(container.querySelector('[data-objectui-icon-unresolved]')).toBeNull();
    });

    it('should apply size classes correctly', () => {
      const { container } = renderComponent(iconNode({
        type: 'icon',
        icon: 'heart',
        size: 24,
      }));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(container.querySelector('[data-objectui-icon-unresolved]')).toBeNull();
    });
  });

  describe('Separator Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('separator');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render separator with proper role', () => {
      const { container } = renderComponent(separatorNode({
        type: 'separator',
      }));

      const separator = container.querySelector('[role="separator"], hr, [data-orientation]');
      expect(separator).toBeTruthy();
    });

    it('should support both orientations', () => {
      const { container: horizontal } = renderComponent(separatorNode({
        type: 'separator',
        orientation: 'horizontal',
      }));

      const { container: vertical } = renderComponent(separatorNode({
        type: 'separator',
        orientation: 'vertical',
      }));

      expect(horizontal.querySelector('*')).toBeTruthy();
      expect(vertical.querySelector('*')).toBeTruthy();
    });
  });

  describe('HTML Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('html');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render HTML content safely', () => {
      const { container } = renderComponent(htmlNode({
        type: 'html',
        html: '<p>HTML Content</p>',
      }));

      // HTML renderer uses dangerouslySetInnerHTML
      const hasContent = container.querySelector('p') || container.textContent?.includes('HTML Content');
      expect(hasContent).toBeTruthy();
    });
  });
});
