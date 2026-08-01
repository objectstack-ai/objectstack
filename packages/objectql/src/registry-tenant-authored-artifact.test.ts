// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0010 provenance vs. the overlay gate — a tenant-authored overlay must not
 * read back as a code artifact.
 *
 * `saveMetaItem` refuses to write an artifact-backed item of a type that has not
 * opted into overlay writes (`not_overridable`), and it asks
 * `registry.getArtifactItem` who is artifact-backed. That answer used to be
 * "anything whose `_packageId` is not the string `sys_metadata`" — a sentinel
 * that only ever holds on the save path. The boot-time rehydration of
 * `sys_metadata` registers each row under its REAL package id (`app.<slug>`),
 * which every runtime-authored item has carried since packages became
 * mandatory. So a Studio/AI-built app came back from the next kernel rebuild
 * looking code-shipped, and the following edit was refused 403 — permanently
 * (cloud#970: two identical `modify_field` calls on the same object, seconds
 * apart, the first LIVE and the second `not_overridable`).
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry.js';

const objectBody = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  fields: { title: { type: 'text' } },
  ...extra,
});

describe('getArtifactItem — provenance decides, not the package id', () => {
  it('does NOT report a tenant-authored object as artifact-backed, even under a real package id', () => {
    const registry = new SchemaRegistry();
    // Exactly what loadMetaFromDb does for a sys_metadata row of an AI-built app.
    registry.registerObject(objectBody('eymm_project', { _provenance: 'org' }) as never, 'app.eymm');
    expect(registry.getArtifactItem('object', 'eymm_project')).toBeUndefined();
  });

  it('still reports a code-shipped object as artifact-backed', () => {
    const registry = new SchemaRegistry();
    registry.registerObject(objectBody('billing_invoice', { _provenance: 'package' }) as never, 'com.acme.billing');
    expect(registry.getArtifactItem('object', 'billing_invoice')).toBeDefined();
  });

  it('treats an object with no provenance under a real package id as an artifact (unchanged)', () => {
    // The loader does not always stamp provenance; absence must keep the old
    // answer so nothing that WAS protected silently becomes writable.
    const registry = new SchemaRegistry();
    registry.registerObject(objectBody('legacy_thing') as never, 'com.acme.legacy');
    expect(registry.getArtifactItem('object', 'legacy_thing')).toBeDefined();
  });

  it('keeps the sys_metadata sentinel working', () => {
    const registry = new SchemaRegistry();
    registry.registerObject(objectBody('runtime_thing') as never, 'sys_metadata');
    expect(registry.getArtifactItem('object', 'runtime_thing')).toBeUndefined();
  });

  it('applies the same rule to non-object metadata types', () => {
    const registry = new SchemaRegistry();
    registry.registerItem('view', { name: 'v_org', _packageId: 'app.eymm', _provenance: 'org' } as never, 'name' as never);
    registry.registerItem('view', { name: 'v_pkg', _packageId: 'com.acme.billing', _provenance: 'package' } as never, 'name' as never);
    expect(registry.getArtifactItem('view', 'v_org')).toBeUndefined();
    expect(registry.getArtifactItem('view', 'v_pkg')).toBeDefined();
  });
});
