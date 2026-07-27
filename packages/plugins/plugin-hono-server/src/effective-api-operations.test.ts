// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  annotateEffectiveApiOperations,
  seedSuperUserRestrictedObjects,
  type ApiExposureSchemaLike,
} from './hono-plugin.js';

/**
 * #3391 — the `/me/permissions` per-object map carries the server-resolved
 * effective API operation set (`apiOperations`). These pin the two pure helpers
 * (parallel to fold/clamp): the super-user seed and the annotation pass.
 */
describe('annotateEffectiveApiOperations (#3391)', () => {
  const schemaOf = (map: Record<string, ApiExposureSchemaLike>) => (name: string) => map[name];

  it('annotates a restricting object with its effective operation set', () => {
    const objects: Record<string, any> = { widget: { allowRead: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      widget: { name: 'widget', enable: { apiMethods: ['get', 'list'] } },
    }));
    // list-class reads derive aggregate/search/export; enum-ordered.
    expect(objects.widget.apiOperations).toEqual(['get', 'list', 'aggregate', 'search', 'export']);
  });

  it('does NOT annotate an unrestricted object (client keeps default-allow)', () => {
    const objects: Record<string, any> = { widget: { allowRead: true } };
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
    const objects: Record<string, any> = { deal: { allowRead: true } };
    annotateEffectiveApiOperations(objects, schemaOf({
      deal: { name: 'deal', enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete'] } },
    }));
    expect(objects.deal.apiOperations).toContain('import');
    expect(objects.deal.apiOperations).toContain('export');
    expect(objects.deal.apiOperations).toContain('upsert');
    expect(objects.deal.apiOperations).not.toContain('restore');
  });

  // [#3544] user-level export axis: allowExport on the per-object perm entry
  // drives userExportAllowed → export derives from list ∧ that bit.
  describe('user-level export axis (#3544)', () => {
    it('allowExport:false removes export from a restricting object', () => {
      const objects: Record<string, any> = { deal: { allowRead: true, allowExport: false } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).toContain('list');
      expect(objects.deal.apiOperations).not.toContain('export');
    });

    it('allowExport:false removes export even from an otherwise-open object (annotation forced)', () => {
      const objects: Record<string, any> = { deal: { allowRead: true, allowExport: false } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: {} }, // no apiMethods → unrestricted
      }));
      // Even though unrestricted, the export axis forces an annotation that
      // excludes export while keeping the rest.
      expect(objects.deal.apiOperations).toBeDefined();
      expect(objects.deal.apiOperations).not.toContain('export');
      expect(objects.deal.apiOperations).toContain('create');
      expect(objects.deal.apiOperations).toContain('import');
    });

    it('unset allowExport inherits read — export kept; unrestricted object still unannotated', () => {
      const objects: Record<string, any> = { deal: { allowRead: true } }; // allowExport unset
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: {} },
      }));
      // Unrestricted + export allowed → no annotation (client default-allow).
      expect('apiOperations' in objects.deal).toBe(false);
    });

    it('allowExport:true keeps export on a list-derived restricting object', () => {
      const objects: Record<string, any> = { deal: { allowRead: true, allowExport: true } };
      annotateEffectiveApiOperations(objects, schemaOf({
        deal: { name: 'deal', enable: { apiMethods: ['get', 'list'] } },
      }));
      expect(objects.deal.apiOperations).toContain('export');
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
    expect(objects.widget.apiOperations).toEqual(['get', 'list', 'aggregate', 'search', 'export']);
    expect(objects.locked.apiOperations).toEqual([]);
  });
});
