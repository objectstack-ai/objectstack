// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `positions.<name>.…` and `permissions.<name>.…` — the security catalog's two
// translation groups, and the translators that overlay them on the served
// `position` / `permission` documents.
//
// Before these groups existed, an app authored in one language shipped its
// positions and permission sets in that language to every workspace: the
// bundle had no key for them, so `os validate` refused one and `os i18n check`
// could not report the gap.

import { describe, it, expect } from 'vitest';
import {
  TranslationDataSchema,
  TranslationItemSchema,
  PlatformTranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import {
  translateMetadataDocument,
  translatePosition,
  translatePermissionSet,
  TRANSLATABLE_METADATA_TYPES,
} from './i18n-resolver';
// The fixtures are PARSED by the authoring schemas rather than hand-shaped, so
// a translator reading a member the schema does not carry cannot pass here.
import { PositionSchema } from '../identity/position.zod';
import { PermissionSetSchema } from '../security/permission.zod';

const position = () => PositionSchema.parse({
  name: 'srm_legal_counsel',
  label: '法务顾问',
  description: '审核供应商合同',
  permissionSets: ['srm_contract_reviewer'],
}) as any;

const permissionSet = () => PermissionSetSchema.parse({
  name: 'srm_contract_reviewer',
  label: '合同审核',
  description: '读取并审批供应商合同',
  objects: {},
}) as any;

const bundle: TranslationBundle = {
  en: {
    positions: { srm_legal_counsel: { label: 'Legal Counsel', description: 'Reviews supplier contracts' } },
    permissions: { srm_contract_reviewer: { label: 'Contract Review' } },
  },
};

describe('TranslationDataSchema — positions and permissions', () => {
  it('accepts the bundle the card measured as refused', () => {
    // The exact entry `objectstack validate` refused with
    // "Unrecognized key(s) on this locale of the translation bundle: positions".
    const result = TranslationDataSchema.safeParse({ positions: { srm_legal_counsel: { label: 'Legal Counsel' } } });
    expect(result.success).toBe(true);
    expect(TranslationDataSchema.safeParse(bundle.en).success).toBe(true);
  });

  it('opens at all three doors — bundle entry, platform bundle and registered item', () => {
    expect(PlatformTranslationDataSchema.safeParse(bundle.en).success).toBe(true);
    expect(TranslationItemSchema.safeParse({ locale: 'en', ...bundle.en }).success).toBe(true);
  });

  it('closes the face at `label` and `description`', () => {
    for (const group of ['positions', 'permissions']) {
      const result = TranslationDataSchema.safeParse({ [group]: { x: { permissionSets: 'nope' } } });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
    }
  });

  it('renames the singular and collection spellings onto the group', () => {
    expect(() => TranslationDataSchema.parse({ position: { p: { label: 'x' } } })).toThrow(/positions/);
    expect(() => TranslationDataSchema.parse({ permission: { s: { label: 'x' } } })).toThrow(/permissions/);
    expect(() => TranslationDataSchema.parse({ permissionSets: { s: { label: 'x' } } })).toThrow(/permissions/);
    expect(() => TranslationDataSchema.parse({ positions: { p: { title: 'x' } } })).toThrow(/label/);
  });
});

describe('translatePosition / translatePermissionSet', () => {
  it('are registered in the dispatch table, so the REST boundary follows', () => {
    // `TRANSLATABLE_METADATA_TYPES` is DERIVED from the dispatch table and
    // `@objectstack/rest` reads it: `GET /meta/position` and
    // `GET /meta/permission` are localized with nothing else to remember.
    expect(TRANSLATABLE_METADATA_TYPES.has('position')).toBe(true);
    expect(TRANSLATABLE_METADATA_TYPES.has('permission')).toBe(true);
  });

  it('overlays a position label and description', () => {
    const out = translateMetadataDocument('position', position(), bundle, { locale: 'en' }) as any;
    expect(out.label).toBe('Legal Counsel');
    expect(out.description).toBe('Reviews supplier contracts');
    // Identity and the capability binding ride through untouched.
    expect(out.name).toBe('srm_legal_counsel');
    expect(out.permissionSets).toEqual(['srm_contract_reviewer']);
  });

  it('overlays a permission-set label and keeps an unaddressed description as authored', () => {
    const out = translateMetadataDocument('permission', permissionSet(), bundle, { locale: 'en' }) as any;
    expect(out.label).toBe('Contract Review');
    expect(out.description).toBe('读取并审批供应商合同');
  });

  it('reads each document from its own group only', () => {
    // A position and a permission set may share a name; the group decides.
    const shared: TranslationBundle = { en: { positions: { auditor: { label: 'Auditor (position)' } } } };
    const set = PermissionSetSchema.parse({ name: 'auditor', label: '审计', objects: {} }) as any;
    expect(translatePermissionSet(set, shared, { locale: 'en' })).toBe(set);
    const pos = PositionSchema.parse({ name: 'auditor', label: '审计' }) as any;
    expect(translatePosition(pos, shared, { locale: 'en' }).label).toBe('Auditor (position)');
  });

  it('applies the BCP-47 ladder and the fallback chain', () => {
    expect((translatePosition(position(), bundle, { locale: 'en-GB' }) as any).label).toBe('Legal Counsel');
    expect((translatePosition(position(), bundle, { locale: 'fr-FR', fallbackChain: ['en'] }) as any).label)
      .toBe('Legal Counsel');
  });

  it('does not mutate the input, and returns the same reference when nothing matched', () => {
    const doc = position();
    const before = JSON.parse(JSON.stringify(doc));
    translatePosition(doc, bundle, { locale: 'en' });
    expect(doc).toEqual(before);
    expect(translatePosition(doc, bundle, { locale: 'ja-JP' })).toBe(doc);
    expect(translatePosition(doc, undefined, { locale: 'en' })).toBe(doc);
    const anonymous = { label: 'x' } as any;
    expect(translatePosition(anonymous, bundle, { locale: 'en' })).toBe(anonymous);
  });
});
