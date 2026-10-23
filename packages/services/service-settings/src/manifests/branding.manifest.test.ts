// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Branding manifest under the maintainer's ruling B′ (#24766): three keys
 * the runtime config serves, two retired keys gone, version 2.
 */

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { brandingSettingsManifest } from './branding.manifest.js';

const specs = brandingSettingsManifest.specifiers as Array<{
  type: string;
  key?: string;
  id?: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}>;
const byKey = (k: string) => specs.find((s) => s.key === k);

describe('brandingSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(brandingSettingsManifest)).not.toThrow();
  });

  it('declares namespace=branding, scope=tenant, version=2', () => {
    const parsed = SettingsManifestSchema.parse(brandingSettingsManifest);
    expect(parsed.namespace).toBe('branding');
    expect(parsed.scope).toBe('tenant');
    // 2 since two keys left (#24766): the spec's `version` contract is
    // "increment when keys are renamed/removed".
    expect(parsed.version).toBe(2);
  });

  it('offers exactly the three keys the runtime config serves, in identity/appearance', () => {
    expect(specs.filter((s) => s.key).map((s) => s.key)).toEqual([
      'workspace_name', 'accent_color', 'logo_url',
    ]);
    expect(specs.filter((s) => s.type === 'group').map((s) => s.id)).toEqual(['identity', 'appearance']);
  });

  it('offers neither retired key: theme_mode and support_email had no reader (#24766)', () => {
    // Ruling B′: the runtime config has no counterpart for either, so they are
    // retired, not implemented. Offering them was a form that saved values with
    // no effect.
    for (const key of ['theme_mode', 'support_email']) {
      expect(byKey(key), `${key} must not be offered`).toBeUndefined();
    }
  });

  it('accent_color declares no default: an unset colour is the deployment\'s, never a manifest value', () => {
    // The runtime config serves only a value somebody SET; a manifest default
    // would show on the settings page as a colour the console never uses.
    expect(byKey('accent_color')).toBeDefined();
    expect(byKey('accent_color')!.default).toBeUndefined();
    expect(byKey('logo_url')!.default).toBeUndefined();
  });

  // [#25347] One organization showed three names: Branding's unsaved
  // 'ObjectStack' default, the organization record's "Default Organization",
  // and the console's 'ObjectOS'. The first was a value nobody serves, and the
  // key's label claimed the organization's name for the product's.
  describe('workspace_name is the product name, with no default of its own (#25347)', () => {
    const name = () => byKey('workspace_name')!;

    it('declares no default: an unsaved page shows no name the console never shows', () => {
      // Both readers (runtime config and plugin-auth) serve only a value somebody
      // SET; a manifest default was shown on the page and used nowhere.
      expect(name().default).toBeUndefined();
      expect(SettingsManifestSchema.parse(brandingSettingsManifest).specifiers
        .find((s) => s.key === 'workspace_name')!.default).toBeUndefined();
    });

    it('is not required: empty means the deployment\'s own name, so the page can save without one', () => {
      // A required key with no default blocks every save of the namespace in
      // the console's pre-save check until somebody types a name.
      expect(name().required).toBe(false);
    });

    it('is labelled the product name, and its help points at the organization record for the organization\'s name', () => {
      expect(name().label).toBe('Product name');
      expect(name().description).toMatch(/not the organization's own name/);
      expect(name().description).toMatch(/Organization record \(Rename Organization\)/);
      expect(name().description).toMatch(/Leave empty/);
    });
  });
});
