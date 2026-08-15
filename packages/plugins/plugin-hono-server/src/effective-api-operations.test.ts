// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  annotateEffectiveApiOperations,
  seedSuperUserRestrictedObjects,
  type ApiExposureSchemaLike,
} from './current-user-endpoints.js';

/**
 * #3391 — the `/me/permissions` per-object map carries the server-resolved
 * effective API operation set (`apiOperations`). These pin the two pure helpers
 * (parallel to fold/clamp): the super-user seed and the annotation pass.
 */
describe('annotateEffectiveApiOperations (#3391)', () => {
  const schemaOf = (map: Record<string, ApiExposureSchemaLike>) => (name: string) => map[name];

  // [#3544] These pin the `apiMethods` DERIVATION, so they grant `allowExport`
  // explicitly — since the export axis went opt-in, a perm entry without it
  // strips `export` from the effective set and would mask what is under test.
  // The axis itself is covered in its own describe block below.
  it('annotates a restricting object with its effective operation set', () => {
    const objects: Record<string, any> = { widget: { allowRead: true, allowExport: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      widget: { name: 'widget', enable: { apiMethods: ['get', 'list'] } },
    }));
    // list-class reads derive aggregate/search/export; enum-ordered.
    expect(objects.widget.apiOperations).toEqual(['get', 'list', 'aggregate', 'search', 'export']);
  });

  it('does NOT annotate an unrestricted object (client keeps default-allow)', () => {
    const objects: Record<string, any> = { widget: { allowRead: true, allowExport: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      widget: { name: 'widget', enable: {} }, // no apiMethods → unrestricted
    }));
    expect('apiOperations' in objects.widget).toBe(false);
  });

  it('annotates a deny-all object with an empty array', () => {
    const objects: Record<string, any> = { locked: { allowRead: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      locked: { name: 'locked', enable: { apiMethods: [] } },
    }));
    expect(objects.locked.apiOperations).toEqual([]);
  });

  it('skips the wildcard entry', () => {
    const objects: Record<string, any> = { '*': { modifyAllRecords: true }, widget: { allowRead: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      widget: { name: 'widget', enable: { apiMethods: ['create', 'bulk'] } },
    }));
    expect('apiOperations' in objects['*']).toBe(false);
    expect(objects.widget.apiOperations).toContain('create');
    expect(objects.widget.apiOperations).toContain('bulk');
  });

  it('skips when the schema is missing (client falls back)', () => {
    const objects: Record<string, any> = { widget: { allowRead: true } };
    annotateEffectiveApiOperations(objects, () => undefined);
    expect('apiOperations' in objects.widget).toBe(false);
  });

  it('reverse-derived import/export appear in the effective set for a CRUD whitelist', () => {
    const objects: Record<string, any> = { deal: { allowRead: true, allowExport: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      deal: { name: 'deal', enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete'] } },
    }));
    expect(objects.deal.apiOperations).toContain('import');
    expect(objects.deal.apiOperations).toContain('export');
    expect(objects.deal.apiOperations).toContain('upsert');
    expect(objects.deal.apiOperations).not.toContain('restore');
  });

  // [#3544] user-level export axis: allowExport on the per-object perm entry
  // drives userExportAllowed → export derives from list ∧ that GRANT (opt-in).
  describe('user-level export axis (#3544)', () => {
    it('no export grant strips export from a restricting object', () => {
      const objects: Record<string, any> = { deal: { allowRead: true } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).toContain('list');
      expect(objects.deal.apiOperations).not.toContain('export');
    });

    it('no export grant forces an annotation even on an otherwise-open object', () => {
      const objects: Record<string, any> = { deal: { allowRead: true } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: {} }, // no apiMethods → unrestricted
      }));
      // Unrestricted, but the axis still forces an annotation that excludes
      // export while keeping the rest — otherwise the client's default-allow
      // path would show an Export button the server refuses.
      expect(objects.deal.apiOperations).toBeDefined();
      expect(objects.deal.apiOperations).not.toContain('export');
      expect(objects.deal.apiOperations).toContain('create');
      expect(objects.deal.apiOperations).toContain('import');
    });

    it('allowExport:false is annotated the same as silence', () => {
      const objects: Record<string, any> = { deal: { allowRead: true, allowExport: false } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).not.toContain('export');
    });

    it('allowExport:true keeps export on a list-derived restricting object', () => {
      const objects: Record<string, any> = { deal: { allowRead: true, allowExport: true } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).toContain('export');
    });

    it('allowExport:true on an unrestricted object needs no annotation', () => {
      // Nothing is being taken away, so the client keeps its default-allow path.
      const objects: Record<string, any> = { deal: { allowRead: true, allowExport: true } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: {} },
      }));
      expect('apiOperations' in objects.deal).toBe(false);
    });

    // The merge keeps `'*'` and named objects as independent keys, but the
    // SERVER evaluator does not — `resolveObjectPermission` falls back to the
    // wildcard for any object a set has no explicit entry for. Reading it here
    // too is what keeps the shown button and the accepted request the same
    // decision; without it an admin's `'*': {allowExport:true}` would have its
    // Export button hidden on every object it never names explicitly.
    it("inherits the '*' export grant when the object entry declares none", () => {
      const objects: Record<string, any> = {
        '*': { allowRead: true, allowExport: true },
        deal: { allowRead: true }, // no allowExport of its own
      };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).toContain('export');
    });

    it("an explicit per-object allowExport:false overrides a '*' grant", () => {
      const objects: Record<string, any> = {
        '*': { allowRead: true, allowExport: true },
        deal: { allowRead: true, allowExport: false },
      };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).not.toContain('export');
    });

    it("a '*' carrying no export grant does not confer export", () => {
      // The super-user bits specifically do NOT imply export.
      const objects: Record<string, any> = {
        '*': { modifyAllRecords: true },
        deal: { allowRead: true },
      };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: {} },
      }));
      expect(objects.deal.apiOperations).toBeDefined();
      expect(objects.deal.apiOperations).not.toContain('export');
    });
  });
});

describe('seedSuperUserRestrictedObjects (#3391)', () => {
  const schemas: ApiExposureSchemaLike[] = [
    { name: 'widget', enable: { apiMethods: ['get', 'list'] } },  // restricting
    { name: 'open_obj', enable: {} },                              // unrestricted
    { name: 'locked', enable: { apiMethods: [] } },                // deny-all (restricting)
  ];

  it('for a modify-all super-user, seeds false-init entries for restricting objects only', () => {
    const objects: Record<string, any> = { '*': { modifyAllRecords: true, viewAllRecords: true } };
    seedSuperUserRestrictedObjects(objects, schemas);
    expect(objects.widget).toEqual({ allowCreate: false, allowRead: false, allowEdit: false, allowDelete: false });
    expect(objects.locked).toBeDefined();
    // unrestricted objects are NOT seeded (no annotation to attach)
    expect(objects.open_obj).toBeUndefined();
  });

  it('does not seed for a viewAll-only wildcard (avoids flipping check() to explicit deny)', () => {
    const objects: Record<string, any> = { '*': { viewAllRecords: true } }; // no modifyAllRecords
    seedSuperUserRestrictedObjects(objects, schemas);
    expect(objects.widget).toBeUndefined();
  });

  it('does not clobber an object already present in the map', () => {
    const objects: Record<string, any> = {
      '*': { modifyAllRecords: true },
      widget: { allowRead: true, allowEdit: true }, // pre-existing explicit entry
    };
    seedSuperUserRestrictedObjects(objects, schemas);
    expect(objects.widget).toEqual({ allowRead: true, allowEdit: true });
  });

  it('end-to-end: seed → annotate yields apiOperations for a super-user on a restricting object', () => {
    // A super-user whose only grant is the wildcard, with no explicit widget entry.
    const objects: Record<string, any> = { '*': { modifyAllRecords: true } };
    seedSuperUserRestrictedObjects(objects, schemas);
    annotateEffectiveApiOperations(objects, (name) => schemas.find((s) => s.name === name));
    // [#3544] NO `export`: modifyAllRecords is a record-visibility bypass, not
    // an export grant, and the axis is opt-in. A super-user who should also be
    // able to take bulk copies carries `allowExport: true` explicitly.
    // [#8681] The built-in admin sets deliberately do NOT — their wildcard
    // export grant was removed (it made the axis undeniable for an org admin),
    // so this case is now the built-in admin shape rather than the counterpoint
    // to it. An APP set is where an intended admin export is authored.
    expect(objects.widget.apiOperations).toEqual(['get', 'list', 'aggregate', 'search']);
    expect(objects.locked.apiOperations).toEqual([]);
  });

  it('end-to-end: a super-user wildcard CARRYING the export grant keeps export', () => {
    const objects: Record<string, any> = { '*': { modifyAllRecords: true, allowExport: true } };
    seedSuperUserRestrictedObjects(objects, schemas);
    annotateEffectiveApiOperations(objects, (name) => schemas.find((s) => s.name === name));
    expect(objects.widget.apiOperations).toEqual(['get', 'list', 'aggregate', 'search', 'export']);
  });
});
