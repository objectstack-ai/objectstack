// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  annotateEffectiveApiOperations,
  foldWildcardSuperUser,
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
    // [#18931] `allowExport: true` is what keeps this case about the `apiMethods`
    // DERIVATION — the same reason the annotate block above grants it. Without
    // it the export axis also withholds `export`, which is its own reason to
    // seed `open_obj`, and this assertion would be reading that instead. The
    // withheld-export case is pinned separately below.
    const objects: Record<string, any> = {
      '*': { modifyAllRecords: true, viewAllRecords: true, allowExport: true },
    };
    seedSuperUserRestrictedObjects(objects, schemas);
    expect(objects.widget).toEqual({ allowCreate: false, allowRead: false, allowEdit: false, allowDelete: false });
    expect(objects.locked).toBeDefined();
    // an unrestricted object that keeps its FULL closure is NOT seeded — for it
    // the client's default-allow path is already the right answer
    expect(objects.open_obj).toBeUndefined();
  });

  // [#18990] INVERTED on purpose. This used to read "does not seed for a
  // viewAll-only wildcard (avoids flipping check() to explicit deny)". The
  // ruling on #18990 (batch #159 item 1, letter A) settles that the flip is the
  // truth for this class, not an overreach: the seed only touches objects with
  // no explicit entry, and there a viewAll-only principal really can only read.
  it('seeds for a viewAll-only wildcard too — the read bypass is what admits a principal', () => {
    const objects: Record<string, any> = { '*': { viewAllRecords: true } }; // no modifyAllRecords
    seedSuperUserRestrictedObjects(objects, schemas);
    expect(objects.widget).toEqual({ allowCreate: false, allowRead: false, allowEdit: false, allowDelete: false });
    expect(objects.locked).toBeDefined();
    // the export axis withholds `export` here (no `allowExport` on the
    // wildcard), which is its own reason to seed the unrestricted object
    expect(objects.open_obj).toBeDefined();
  });

  // The other half of that predicate, and the reason it is the READ BYPASS
  // rather than "any wildcard": a plain wildcard grant carries no bypass bit,
  // `foldWildcardSuperUser` pulls nothing true for it, and a seeded entry would
  // therefore be an all-false claim with no server behaviour behind it.
  it('does not seed for a wildcard carrying neither bypass bit', () => {
    const objects: Record<string, any> = { '*': { allowRead: true, allowEdit: true } };
    seedSuperUserRestrictedObjects(objects, schemas);
    expect(objects.widget).toBeUndefined();
    expect(objects.locked).toBeUndefined();
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

  // [#18931] The class this pass used to SUBTRACT: an object with NO `apiMethods`
  // declaration, for a principal whose only grant is a wildcard carrying no
  // `allowExport` — every built-in admin since #8681. It got no entry, so
  // `annotateEffectiveApiOperations` (which iterates existing entries only)
  // never saw it and `/me/permissions` said nothing about it at all; the client
  // read `apiOperations: undefined`, took its default-allow path, rendered
  // Export, and the click came back `403 EXPORT_NOT_PERMITTED`.
  describe('the unrestricted object a wildcard-only principal cannot be told about (#18931)', () => {
    // Exactly the card's shape: `{ apiEnabled: true }` and nothing else.
    const unrestricted: ApiExposureSchemaLike[] = [{ name: 'crm_lead', enable: { apiEnabled: true } }];
    // The card's principal: org owner holding no app-authored set. Its wildcard
    // carries the super-user bits and NO `allowExport` (#8681, by design).
    const wildcardOnlyAdmin = () => ({
      '*': {
        allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true,
        viewAllRecords: true, modifyAllRecords: true, allowTransfer: false,
      },
    });

    it('is seeded, and its annotation withholds export while keeping everything else', () => {
      const objects: Record<string, any> = wildcardOnlyAdmin();
      seedSuperUserRestrictedObjects(objects, unrestricted);
      annotateEffectiveApiOperations(objects, (name) => unrestricted.find((s) => s.name === name));

      // PEDIGREE, not a count — a bare "an entry exists" is satisfied by the
      // wrong entry, and a bare length is satisfied by the wrong set.
      expect(objects.crm_lead).toBeDefined();
      expect(objects.crm_lead.apiOperations).toBeDefined();
      // The one operation the server refuses for this principal is the one the
      // client must not offer.
      expect(objects.crm_lead.apiOperations).not.toContain('export');
      // …and withholding it costs the object nothing else: this is the full
      // unrestricted closure minus `export`, so the fix cannot be satisfied by
      // an over-narrow entry that hides unrelated affordances too.
      expect(objects.crm_lead.apiOperations).toEqual(
        ['get', 'list', 'create', 'update', 'delete', 'upsert', 'bulk', 'aggregate', 'search', 'import'],
      );
    });

    it('stays silent for the same object once the principal really may export', () => {
      // The control: same schema, same super-user bits, `allowExport` granted.
      // Nothing is withheld, so there is nothing to say and the client's
      // default-allow path is correct — no entry, exactly as before #18931.
      const objects: Record<string, any> = wildcardOnlyAdmin();
      objects['*'].allowExport = true;
      seedSuperUserRestrictedObjects(objects, unrestricted);
      annotateEffectiveApiOperations(objects, (name) => unrestricted.find((s) => s.name === name));
      expect(objects.crm_lead).toBeUndefined();
    });

    // [#18990] INVERTED on purpose, under the ruling on #18990 (batch #159
    // item 1, letter A). This case read "does not reach a viewAll-only
    // principal (the seed guard is unchanged)" and asserted `toBeUndefined`;
    // #18931 deliberately widened WHICH schemas are considered and left WHICH
    // principals alone, pinning that boundary while saying in the same breath
    // that the pin was not a ruling that the silence was correct. It is that
    // ruling that now says otherwise, so the pin moves with it.
    it('reaches a viewAll-only principal: read folded true, writes explicitly false', () => {
      const objects: Record<string, any> = { '*': { viewAllRecords: true } }; // no modifyAllRecords
      seedSuperUserRestrictedObjects(objects, unrestricted);
      foldWildcardSuperUser(objects);
      annotateEffectiveApiOperations(objects, (name) => unrestricted.find((s) => s.name === name));

      // The four affordances, each pinned — the entry's VALUE is the whole
      // point of materialising it, so "an entry exists" is not the assertion.
      expect(objects.crm_lead).toBeDefined();
      expect(objects.crm_lead.allowRead).toBe(true);   // the wildcard read bypass, folded
      expect(objects.crm_lead.allowEdit).toBe(false);  // …and the write bits the fold leaves alone
      expect(objects.crm_lead.allowCreate).toBe(false);
      expect(objects.crm_lead.allowDelete).toBe(false);
      // The export axis withholds `export` for this principal exactly as it
      // does for the modify-all class above — one predicate, both classes.
      expect(objects.crm_lead.apiOperations).not.toContain('export');
      expect(objects.crm_lead.apiOperations).toEqual(
        ['get', 'list', 'create', 'update', 'delete', 'upsert', 'bulk', 'aggregate', 'search', 'import'],
      );
    });

    it('stays silent for a viewAll-only principal once it really may export', () => {
      // The ruling's own carve-out — "skip only an unrestricted object whose
      // export stays allowed" — is the SAME skip the modify-all control above
      // pins, reached through the same predicate and not a second one.
      const objects: Record<string, any> = { '*': { viewAllRecords: true, allowExport: true } };
      seedSuperUserRestrictedObjects(objects, unrestricted);
      foldWildcardSuperUser(objects);
      annotateEffectiveApiOperations(objects, (name) => unrestricted.find((s) => s.name === name));
      expect(objects.crm_lead).toBeUndefined();
    });
  });
});
