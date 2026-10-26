/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { isValidAppName, wizardDraftToAppSchema } from '../index';
import type {
  AppWizardDraft,
  AppWizardStep,
  BrandingConfig,
  ObjectSelection,
  EditorMode,
} from '../index';

describe('App Creation Types', () => {
  describe('isValidAppName', () => {
    it('should accept simple snake_case names', () => {
      expect(isValidAppName('my_app')).toBe(true);
      expect(isValidAppName('crm')).toBe(true);
      expect(isValidAppName('sales_dashboard')).toBe(true);
      expect(isValidAppName('app123')).toBe(true);
    });

    it('should reject invalid names', () => {
      expect(isValidAppName('')).toBe(false);
      expect(isValidAppName('My App')).toBe(false);
      expect(isValidAppName('my-app')).toBe(false);
      expect(isValidAppName('MyApp')).toBe(false);
      expect(isValidAppName('123app')).toBe(false);
      expect(isValidAppName('_app')).toBe(false);
      expect(isValidAppName('app_')).toBe(false);
      expect(isValidAppName('app__name')).toBe(false);
    });

    it('should accept multi-segment snake_case', () => {
      expect(isValidAppName('my_cool_app')).toBe(true);
      expect(isValidAppName('a_b_c_d')).toBe(true);
    });
  });

  describe('wizardDraftToAppSchema', () => {
    it('should convert draft to the app document the Studio saves', () => {
      const draft: AppWizardDraft = {
        name: 'test_app',
        title: 'Test Application',
        description: 'A test app',
        icon: 'LayoutDashboard',
        objects: [],
        navigation: [
          { id: 'nav_1', type: 'object', label: 'Contacts', objectName: 'contacts' },
        ],
        branding: {
          logo: 'https://example.com/logo.svg',
          primaryColor: '#3b82f6',
          favicon: 'https://example.com/favicon.ico',
        },
      };

      const schema = wizardDraftToAppSchema(draft);
      // Only keys the spec's `AppSchema` declares (objectui#10842): no `type`,
      // `title`, top-level `favicon` or `layout`.
      for (const key of ['type', 'title', 'favicon', 'layout']) {
        expect(key in schema, key).toBe(false);
      }
      expect(schema.name).toBe('test_app');
      expect(schema.label).toBe('Test Application');
      expect(schema.description).toBe('A test app');
      expect(schema.icon).toBe('LayoutDashboard');
      // The logo travels in `branding` only — no top-level copy (objectui#10827).
      expect('logo' in schema).toBe(false);
      expect(schema.branding).toEqual({
        logo: 'https://example.com/logo.svg',
        primaryColor: '#3b82f6',
        favicon: 'https://example.com/favicon.ico',
      });
      expect(schema.navigation).toHaveLength(1);
      expect(schema.navigation![0].id).toBe('nav_1');
    });

    it('should handle draft with empty navigation', () => {
      const draft: AppWizardDraft = {
        name: 'empty_app',
        title: 'Empty',
        objects: [],
        navigation: [],
        branding: {},
      };

      const schema = wizardDraftToAppSchema(draft);
      expect(schema.navigation).toEqual([]);
      expect(schema.label).toBe('Empty');
    });

    it('should preserve icon and label for sidebar/app-switcher display', () => {
      const draft: AppWizardDraft = {
        name: 'sales_crm',
        title: 'Sales CRM',
        icon: 'TrendingUp',
        objects: [],
        navigation: [],
        branding: {
          logo: 'https://example.com/sales-logo.png',
          primaryColor: '#10b981',
        },
      };

      const schema = wizardDraftToAppSchema(draft);
      // These fields are critical for the app switcher and the shell's branding
      expect(schema.icon).toBe('TrendingUp');
      expect(schema.label).toBe('Sales CRM');
      expect(schema.branding).toEqual({
        logo: 'https://example.com/sales-logo.png',
        primaryColor: '#10b981',
      });
    });

    it('should handle draft without icon gracefully', () => {
      const draft: AppWizardDraft = {
        name: 'no_icon_app',
        title: 'No Icon',
        objects: [],
        navigation: [],
        branding: {},
      };

      const schema = wizardDraftToAppSchema(draft);
      expect(schema.icon).toBeUndefined();
      expect(schema.label).toBe('No Icon');
    });
  });

  describe('Type Shape Verification', () => {
    it('should accept valid AppWizardStep', () => {
      const step: AppWizardStep = {
        id: 'basic',
        label: 'Basic Info',
        description: 'Enter app details',
        icon: 'Settings',
      };
      expect(step.id).toBe('basic');
      expect(step.label).toBe('Basic Info');
    });

    it('should accept valid BrandingConfig', () => {
      const config: BrandingConfig = {
        logo: 'https://example.com/logo.png',
        primaryColor: '#ff5733',
        favicon: 'https://example.com/favicon.ico',
        fontFamily: 'Inter',
      };
      expect(config.primaryColor).toBe('#ff5733');
    });

    it('should accept valid ObjectSelection', () => {
      const obj: ObjectSelection = {
        name: 'contacts',
        label: 'Contacts',
        icon: 'Users',
        selected: true,
      };
      expect(obj.selected).toBe(true);
    });

    it('should accept valid EditorMode', () => {
      const modes: EditorMode[] = ['edit', 'preview', 'code'];
      expect(modes).toHaveLength(3);
    });
  });
});
