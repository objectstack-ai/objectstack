// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, ADR-0066 D1] The curated platform capabilities, declared from
 * the spec list. The expected values come from `PLATFORM_CAPABILITIES`, never
 * from the module under test.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityDeclarationSchema, PLATFORM_CAPABILITIES, describeHighPrivilegeBits } from '@objectstack/spec/security';
import { registerBuiltinCapabilities, securityBuiltinCapabilities } from './builtin-capabilities.js';
import { SECURITY_PLUGIN_ID } from './manifest.js';
import { readDeclaredCapabilityContext } from './declared-capability-context.js';

describe('securityBuiltinCapabilities', () => {
  it('is the spec’s curated list itself, not a copy', () => {
    expect(securityBuiltinCapabilities).toBe(PLATFORM_CAPABILITIES);
  });

  it('is a valid capability declaration, every curated entry', () => {
    for (const declaration of securityBuiltinCapabilities) {
      expect(CapabilityDeclarationSchema.safeParse(declaration).success, declaration.name).toBe(true);
    }
  });
});

describe('registerBuiltinCapabilities', () => {
  it('registers each curated entry as a `capability`, keyed by name, under the owning package, with its four fields', () => {
    const calls: Array<[string, Record<string, unknown>, string, string | undefined]> = [];
    const registry = {
      registerItem(type: string, item: Record<string, unknown>, keyField: string, packageId?: string) {
        // The real registry stamps provenance onto the object it is handed.
        item._packageId = packageId;
        calls.push([type, item, keyField, packageId]);
      },
    };
    expect(registerBuiltinCapabilities(registry, 'com.example.owner')).toBe(PLATFORM_CAPABILITIES.length);
    expect(calls.map(([type, , keyField, packageId]) => [type, keyField, packageId])).toEqual(
      PLATFORM_CAPABILITIES.map(() => ['capability', 'name', 'com.example.owner']),
    );
    expect(calls.map(([, item]) => item)).toEqual(
      PLATFORM_CAPABILITIES.map((c) => ({ ...c, _packageId: 'com.example.owner' })),
    );
    // Each registration got its own copy: the spec list carries no stamp.
    for (const declaration of PLATFORM_CAPABILITIES) expect(declaration).not.toHaveProperty('_packageId');
  });

  it('registers nothing, and says so with 0, when there is no registration seam', () => {
    expect(registerBuiltinCapabilities(undefined, 'com.example.owner')).toBe(0);
    expect(registerBuiltinCapabilities({}, 'com.example.owner')).toBe(0);
  });
});

const curated = PLATFORM_CAPABILITIES[0]!.name;
const OWN = { name: curated, _packageId: SECURITY_PLUGIN_ID };

describe('readDeclaredCapabilityContext, beside the curated declarations', () => {
  const APP = { name: 'field.export', _packageId: 'com.example.field' };
  const engineWith = (capabilities: unknown[]) => ({ registry: { listItems: (type: string) => (type === 'capability' ? capabilities : []) } });
  const setGranting = (...systemPermissions: string[]) => ({ name: 'baseline', systemPermissions });

  it('hands over the registry’s capabilities as they are, the curated ones included', async () => {
    expect(await readDeclaredCapabilityContext(engineWith([OWN, APP]), undefined)).toEqual({ declaredCapabilities: [OWN, APP] });
  });

  it('excuses a package-declared token and never a curated one: the platform floor discards the curated declarations', async () => {
    const context = await readDeclaredCapabilityContext(engineWith([OWN, APP]), undefined);
    expect(describeHighPrivilegeBits(setGranting(APP.name), context)).toBeNull();
    expect(describeHighPrivilegeBits(setGranting(curated), context)).not.toBeNull();
    // A registry holding only the curated declarations excuses nothing, as no declaration did.
    const curatedOnly = await readDeclaredCapabilityContext(engineWith([OWN]), undefined);
    expect(describeHighPrivilegeBits(setGranting(APP.name), curatedOnly))
      .toEqual(describeHighPrivilegeBits(setGranting(APP.name), undefined));
    expect(describeHighPrivilegeBits(setGranting(APP.name), undefined)).not.toBeNull();
  });

  // [ADR-0090 D5, #35157] A capability saved in the environment registers in the
  // same collection with no `_packageId` (measured: `{ name, label, _provenance }`).
  // It is not an app's own token, so it excuses nothing; an unmanaged copy's
  // capability carries the copy package's id and still does.
  const ENV_SAVED = { name: 'envcap.export', label: 'Saved in the environment', _provenance: 'org' };
  const COPIED = { name: 'trial1.export', label: 'Copied', _packageId: 'com.example.field-copy', _provenance: 'org' };

  it('an environment-saved declaration is not the app\'s own token: it excuses nothing', async () => {
    const context = await readDeclaredCapabilityContext(engineWith([OWN, APP, ENV_SAVED]), undefined);
    expect(context).toEqual({ declaredCapabilities: [OWN, APP] });
    expect(describeHighPrivilegeBits(setGranting(ENV_SAVED.name), context)).not.toBeNull();
    expect(describeHighPrivilegeBits(setGranting(ENV_SAVED.name), context))
      .toEqual(describeHighPrivilegeBits(setGranting(ENV_SAVED.name), undefined));
  });

  it('an unmanaged copy\'s capability carries its package and is excused like the source\'s', async () => {
    const context = await readDeclaredCapabilityContext(engineWith([COPIED]), undefined);
    expect(describeHighPrivilegeBits(setGranting(COPIED.name), context)).toBeNull();
  });

  it('a registry holding only environment-saved declarations does not fall back to the metadata service', async () => {
    let listed = false;
    const metadata = { list: () => { listed = true; return [APP]; } };
    expect(await readDeclaredCapabilityContext(engineWith([ENV_SAVED]), metadata)).toBeUndefined();
    expect(listed).toBe(false);
  });

  it('the metadata-service fallback is judged by the same provenance test', async () => {
    const metadata = { list: async () => [ENV_SAVED, APP] };
    expect(await readDeclaredCapabilityContext(engineWith([]), metadata)).toEqual({ declaredCapabilities: [APP] });
    const onlySaved = { list: async () => [ENV_SAVED] };
    expect(await readDeclaredCapabilityContext(engineWith([]), onlySaved)).toBeUndefined();
  });
});
