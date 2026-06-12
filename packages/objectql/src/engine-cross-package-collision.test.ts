// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0048 — end-to-end: the cross-package collision guard fires through the
 * real `ObjectQL.registerApp` entry point (not just the registry unit), since
 * that is the choke point every installed package's metadata arrays flow
 * through. Uses a real engine + real registry (no mock) on purpose.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';
import { MetadataCollisionError } from './registry';

describe('ObjectQL.registerApp — cross-package collision (ADR-0048)', () => {
  it('throws when a second package registers a bare-named page already owned by another', () => {
    const engine = new ObjectQL();
    engine.registerApp({
      id: 'com.acme.crm',
      pages: [{ name: 'home', title: 'CRM Home' }],
    });

    expect(() =>
      engine.registerApp({
        id: 'com.acme.hr',
        pages: [{ name: 'home', title: 'HR Home' }],
      }),
    ).toThrowError(MetadataCollisionError);
  });

  it('allows two packages to define same-named pages once namespaced apart', () => {
    const engine = new ObjectQL();
    expect(() => {
      engine.registerApp({
        id: 'com.acme.crm',
        pages: [{ name: 'crm_home', title: 'CRM Home' }],
      });
      engine.registerApp({
        id: 'com.acme.hr',
        pages: [{ name: 'hr_home', title: 'HR Home' }],
      });
    }).not.toThrow();
  });

  it('allows the same package to be re-registered (idempotent reload)', () => {
    const engine = new ObjectQL();
    engine.registerApp({
      id: 'com.acme.crm',
      pages: [{ name: 'home', title: 'v1' }],
    });
    expect(() =>
      engine.registerApp({
        id: 'com.acme.crm',
        pages: [{ name: 'home', title: 'v2' }],
      }),
    ).not.toThrow();
  });
});
