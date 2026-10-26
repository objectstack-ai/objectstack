/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Imports all renderers to register them. Module scope, NOT awaited inside a
// `beforeAll` — Monaco is a heavy library, and loading it inside the hook billed
// that cost against `hookTimeout`, which is why this needed a 30s budget. The
// import phase has no test/hook timeout, so the raised timeout goes away rather
// than getting raised again (objectui#3010).
// See AGENTS.md §9 (test discipline).
import './index';

describe('Plugin Editor', () => {
  describe('code-editor component', () => {
    it('should be registered in ComponentRegistry', () => {
      const editorRenderer = ComponentRegistry.get('code-editor');
      expect(editorRenderer).toBeDefined();
    });

    it('should have proper metadata', () => {
      const config = ComponentRegistry.getConfig('code-editor');
      expect(config).toBeDefined();
      expect(config?.label).toBe('Code Editor');
      expect(config?.category).toBe('plugin');
      expect(config?.inputs).toBeDefined();
      expect(config?.defaultProps).toBeDefined();
    });

    it('should have expected inputs', () => {
      const config = ComponentRegistry.getConfig('code-editor');
      const inputNames = config?.inputs?.map((input: any) => input.name) || [];
      
      expect(inputNames).toContain('value');
      expect(inputNames).toContain('language');
      expect(inputNames).toContain('theme');
      expect(inputNames).toContain('height');
      expect(inputNames).toContain('readOnly');
    });

    it('should have language as enum input', () => {
      const config = ComponentRegistry.getConfig('code-editor');
      const languageInput = config?.inputs?.find((input: any) => input.name === 'language');
      
      expect(languageInput).toBeDefined();
      expect(languageInput?.type).toBe('enum');
      expect(languageInput?.enum).toBeDefined();
      expect(Array.isArray(languageInput?.enum)).toBe(true);
      
      const enumValues = languageInput?.enum || [];
      expect(enumValues).toContain('javascript');
      expect(enumValues).toContain('typescript');
      expect(enumValues).toContain('python');
      expect(enumValues).toContain('json');
      expect(enumValues).toContain('html');
      expect(enumValues).toContain('css');
    });

    it('should have theme as enum input', () => {
      const config = ComponentRegistry.getConfig('code-editor');
      const themeInput = config?.inputs?.find((input: any) => input.name === 'theme');
      
      expect(themeInput).toBeDefined();
      expect(themeInput?.type).toBe('enum');
      expect(themeInput?.enum).toBeDefined();
      expect(Array.isArray(themeInput?.enum)).toBe(true);
      
      const enumValues = themeInput?.enum || [];
      expect(enumValues).toContain('vs-dark');
      expect(enumValues).toContain('light');
    });

    it('should have sensible default props', () => {
      const config = ComponentRegistry.getConfig('code-editor');
      const defaults = config?.defaultProps;
      
      expect(defaults).toBeDefined();
      expect(defaults?.value).toBeDefined();
      expect(typeof defaults?.value).toBe('string');
      expect(defaults?.language).toBe('javascript');
      expect(defaults?.theme).toBe('vs-dark');
      expect(defaults?.height).toBe('400px');
      expect(defaults?.readOnly).toBe(false);
    });

    it('should have readOnly as boolean input', () => {
      const config = ComponentRegistry.getConfig('code-editor');
      const readOnlyInput = config?.inputs?.find((input: any) => input.name === 'readOnly');
      
      expect(readOnlyInput).toBeDefined();
      expect(readOnlyInput?.type).toBe('boolean');
      // The renderer's ACTUAL default is `defaultProps.readOnly`, pinned in the
      // test above; the input's own `defaultValue` was a shadow copy nothing
      // read and is an ADR-0049 tombstone since objectui#7493.
    });
  });
});
