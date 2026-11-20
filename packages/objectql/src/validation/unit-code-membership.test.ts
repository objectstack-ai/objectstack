// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U5; Open items 3, 8 and 9] The unit-of-measure write check, as
 * pure functions: which fields hold a unit code, which writes are judged
 * (the Open item 9 settlement, 7013996288 on #35467, pinned case by case),
 * and what each refusal answers (`code` and `status`, ADR-0112).
 *
 * The organization's units come from a stand-in reader here; the engine's
 * seams and the real `sys_unit` rows are pinned in
 * `engine-unit-code-membership.test.ts` and, on a real stack,
 * `plugin-security`'s `default-permission-sets.unit-of-measure.integration.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertUnitCodes,
  readOrganizationUnits,
  RecordUnitCodeError,
  refuseOrganizationUnitDelete,
  touchesUnitCodes,
  unitCodeSources,
  type OrganizationUnitRowsReader,
} from './unit-code-membership.js';

const ORG = 'org_a';
const OTHER = 'org_b';

/** A material: two quantities sharing one unit field restricted to mass, and a standalone base unit. */
const FIELDS = {
  uom: { type: 'text' },
  weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'uom', unitDimension: 'mass' } },
  tare: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'uom' } },
  base_uom: { type: 'text', unitConfig: { unitMode: 'code' } },
  net: { type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
  title: { type: 'text' },
};

/** The organizations' own units, as `sys_unit` would hold them. */
const UNITS: Record<string, Array<Record<string, unknown>>> = {
  [ORG]: [
    { code: 'JIN1', dimension: 'mass', retired: false },
    { code: 'BOX_12', dimension: 'package', retired: false },
    { code: 'SACK_50', dimension: 'mass', retired: true },
  ],
  [OTHER]: [{ code: 'TAEL_1', dimension: 'mass', retired: false }],
};

function reader(): { read: OrganizationUnitRowsReader; calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  const read: OrganizationUnitRowsReader = async (organizationId, codes) => {
    calls.push([organizationId, [...codes].sort()]);
    return (UNITS[organizationId] ?? []).filter((u) => codes.includes(u.code as string));
  };
  return { read, calls };
}

/** Judge one image the way the engine does: read the organization's units, then assert. */
async function judge(
  image: Record<string, unknown>,
  operation: 'insert' | 'update',
  touched?: Record<string, unknown>,
  organization: string | null = ORG,
): Promise<RecordUnitCodeError | null> {
  // `null` is a row with no organization (a default parameter would take `undefined` for ORG).
  const organizationId = organization ?? undefined;
  const lookup = await readOrganizationUnits(FIELDS, [{ image, touched, organizationId }], operation, reader().read);
  try {
    assertUnitCodes('material', FIELDS, image, operation, touched, operation === 'update' ? 'r1' : undefined, organizationId, lookup);
    return null;
  } catch (e) {
    if (e instanceof RecordUnitCodeError) return e;
    throw e;
  }
}

const envelope = (e: RecordUnitCodeError | null) => e && { code: e.code, status: e.status, httpStatus: e.httpStatus, field: e.field };

describe('which fields hold a unit code', () => {
  it('a record quantity\'s pointer and a standalone marker; a fixed quantity holds none', () => {
    expect(unitCodeSources(FIELDS)).toEqual([
      { codeField: 'uom', quantityFields: ['weight', 'tare'], dimension: 'mass' },
      { codeField: 'base_uom', quantityFields: [] },
    ]);
  });

  it('an object with no unit declaration has none, and its writes touch none', () => {
    expect(unitCodeSources({ title: { type: 'text' }, amount: { type: 'number' } })).toEqual([]);
    expect(touchesUnitCodes({ title: { type: 'text' } }, { title: 'x' })).toBe(false);
  });

  it('an update touches the pair when it carries the quantity or the code field, never otherwise', () => {
    expect(touchesUnitCodes(FIELDS, { weight: 1 })).toBe(true);
    expect(touchesUnitCodes(FIELDS, { uom: 'KGM' })).toBe(true);
    expect(touchesUnitCodes(FIELDS, { base_uom: 'H87' })).toBe(true);
    expect(touchesUnitCodes(FIELDS, { title: 'x', net: 3 })).toBe(false);
  });
});

describe('Open item 9, case 1: a code written is admitted only as a member, in exact uppercase', () => {
  it.each(['KGM', 'GRM', 'LBR', 'JIN1'])('admits %s: a standard code, or one of the organization\'s units, of the declared dimension', async (uom) => {
    expect(await judge({ uom, weight: 2 }, 'insert')).toBeNull();
    expect(await judge({ uom, weight: 2 }, 'update', { uom })).toBeNull();
  });

  it('OI9 case 1: refuses a code that is no member, ERR_UNIT_CODE_UNKNOWN / 400 on the code field', async () => {
    const e = await judge({ uom: 'POUND', weight: 2 }, 'insert');
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_UNKNOWN', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.quantityField).toBe('weight');
  });

  it.each([['kgm', 'KGM'], [' KGM', 'KGM'], ['jin1', 'JIN1']])('OI9 case 1: refuses %j, never folded, naming the exact spelling', async (uom, exact) => {
    const e = await judge({ uom, weight: 2 }, 'insert');
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_UNKNOWN', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.message).toContain(`'${exact}'`);
  });

  it('refuses C62 and EA naming the piece, H87 (U2)', async () => {
    for (const code of ['C62', 'EA']) {
      const e = await judge({ base_uom: code }, 'insert');
      expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_UNKNOWN', status: 400, httpStatus: 400, field: 'base_uom' });
      expect(e!.message).toContain("'H87'");
    }
  });

  it('an inherited name is no member (N4): `toString`, `constructor`, `__proto__`', async () => {
    for (const code of ['toString', 'constructor', '__proto__']) {
      expect((await judge({ base_uom: code }, 'insert'))?.code).toBe('ERR_UNIT_CODE_UNKNOWN');
    }
  });

  it('another organization\'s unit is no member of this one', async () => {
    expect((await judge({ base_uom: 'TAEL_1' }, 'insert'))?.code).toBe('ERR_UNIT_CODE_UNKNOWN');
    expect(await judge({ base_uom: 'TAEL_1' }, 'insert', undefined, OTHER)).toBeNull();
  });

  it('a row with no organization has only the standard codes', async () => {
    expect((await judge({ base_uom: 'JIN1' }, 'insert', undefined, null))?.code).toBe('ERR_UNIT_CODE_UNKNOWN');
    expect(await judge({ base_uom: 'H87' }, 'insert', undefined, null)).toBeNull();
  });

  it('a code that is not a string is no member', async () => {
    expect((await judge({ base_uom: 12 }, 'insert'))?.code).toBe('ERR_UNIT_CODE_UNKNOWN');
  });

  it('a code beside a blank quantity is judged as written (point 4), and admitted as a member', async () => {
    expect((await judge({ uom: 'POUND' }, 'insert'))?.code).toBe('ERR_UNIT_CODE_UNKNOWN');
    expect(await judge({ uom: 'KGM' }, 'insert')).toBeNull();
  });
});

describe('Requirement 2 (7030061316): a retired unit is no member', () => {
  it('refuses a new save with a retired code, ERR_UNIT_CODE_RETIRED / 400', async () => {
    const e = await judge({ uom: 'SACK_50', weight: 1 }, 'insert');
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_RETIRED', status: 400, httpStatus: 400, field: 'uom' });
  });

  it('a lower-case retired code gets no "write the exact spelling" hint: the exact spelling is retired too', async () => {
    const e = await judge({ uom: 'sack_50', weight: 1 }, 'insert');
    expect(e?.code).toBe('ERR_UNIT_CODE_UNKNOWN');
    expect(e!.message).not.toContain("'SACK_50'");
  });
});

describe('Open item 9, case 2: a quantity written beside a resting code that is no longer a member', () => {
  it('OI9 case 2: refuses the quantity edit beside a retired code, naming the field and never the stored value', async () => {
    const e = await judge({ uom: 'SACK_50', weight: 5, title: 't' }, 'update', { weight: 5 });
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_RETIRED', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.message).toContain("'uom' holds a code stored before this write");
    expect(e!.message).not.toContain('SACK_50');
  });

  it.each([['kgm', "write 'KGM'"], [' KGM', "write 'KGM'"], ['ea', "write 'H87'"], ['c62', "write 'H87'"]])(
    'OI9 case 2: refuses the quantity edit beside a resting %j, ERR_UNIT_CODE_UNKNOWN / 400, printing neither the stored code nor its corrected spelling',
    async (uom, correction) => {
      const e = await judge({ uom, weight: 5 }, 'update', { weight: 5 });
      expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_UNKNOWN', status: 400, httpStatus: 400, field: 'uom' });
      expect(e!.message).toContain("'uom' holds a code stored before this write");
      expect(e!.message).not.toContain(`'${uom}'`);
      expect(e!.message).not.toContain(correction);
      expect(e!.message).not.toContain('The piece is');
      expect(e!.message).not.toContain('Codes are exact uppercase with no spaces');
      // The control: the same code WRITTEN is still answered with its exact spelling (case 1).
      expect((await judge({ uom, weight: 5 }, 'update', { uom, weight: 5 }))!.message).toContain(correction);
    },
  );

  it.each([['MTR', 'length'], ['BOX_12', 'package']])(
    'OI9 case 2: refuses the quantity edit beside a resting %s of another dimension, ERR_UNIT_DIMENSION_MISMATCH / 400, printing neither the code nor its dimension',
    async (uom, dimension) => {
      const e = await judge({ uom, weight: 5 }, 'update', { weight: 5 });
      expect(envelope(e)).toEqual({ code: 'ERR_UNIT_DIMENSION_MISMATCH', status: 400, httpStatus: 400, field: 'uom' });
      expect(e!.message).toContain("'uom' holds a code stored before this write, a unit of another dimension");
      expect(e!.message).toContain("unitDimension 'mass'");
      expect(e!.message).toContain("in the same write as 'weight'");
      expect(e!.message).not.toContain(uom);
      expect(e!.message).not.toContain(dimension);
      // The control: the same code WRITTEN is still named with its dimension (point 5).
      expect((await judge({ uom, weight: 5 }, 'update', { uom, weight: 5 }))!.message).toContain(`the ${dimension} dimension`);
    },
  );

  it('refuses the quantity edit beside free text stored before the declaration; the remedy moves the record or converts the field', async () => {
    const e = await judge({ uom: 'kg', weight: 5 }, 'update', { weight: 5 });
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_UNKNOWN', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.message).toContain("in the same write as 'weight'");
    // [Open item 9 point 7] …and names the run that converts every such row.
    expect(e!.message).toContain('`os migrate unit-codes --object material --field uom --map-file <mapping file>`');
    expect(e!.message).toContain('`POST /api/v1/meta/_migrate-unit-codes`');
    expect(e!.message).not.toContain("'kg'");
    // The control: a code the write carried is the writer's own, and names no conversion run.
    expect((await judge({ uom: 'kg', weight: 5 }, 'update', { uom: 'kg', weight: 5 }))!.message).not.toContain('os migrate unit-codes');
    // A retired unit is a unit, not stored free text: moved, never converted.
    expect((await judge({ uom: 'SACK_50', weight: 5 }, 'update', { weight: 5 }))!.message).not.toContain('os migrate unit-codes');
  });

  it('admits the same edit once the write moves the record to a member code', async () => {
    expect(await judge({ uom: 'KGM', weight: 5 }, 'update', { uom: 'KGM', weight: 5 })).toBeNull();
  });

  it('a write touching neither the code nor its quantities is not judged (ADR-0113 D1)', async () => {
    expect(await judge({ uom: 'SACK_50', weight: 5, title: 'renamed' }, 'update', { title: 'renamed' })).toBeNull();
  });

  it('a blank quantity written beside a resting code is not judged: no code was written', async () => {
    expect(await judge({ uom: 'SACK_50', weight: null }, 'update', { weight: null })).toBeNull();
  });
});

describe('Open item 9, case 3: a quantity beside a blank code', () => {
  it.each([undefined, null, '', '   '])('OI9 case 3: refuses a quantity beside the code %j, ERR_UNIT_CODE_REQUIRED / 400', async (uom) => {
    const e = await judge({ uom, weight: 2 }, 'insert');
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_REQUIRED', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.quantityField).toBe('weight');
  });

  it('a blank quantity needs no code', async () => {
    expect(await judge({ uom: null, weight: null }, 'insert')).toBeNull();
  });

  it('an update clearing the code beside a resting quantity touches the pair, and is refused', async () => {
    expect((await judge({ uom: null, weight: 2 }, 'update', { uom: null }))?.code).toBe('ERR_UNIT_CODE_REQUIRED');
  });

  it('[Open item 9 point 7] a quantity edit beside a resting blank names the conversion run and its "" entry; a write that blanks it does not', async () => {
    const e = await judge({ uom: null, weight: 2 }, 'update', { weight: 2 });
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_REQUIRED', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.message).toContain('`os migrate unit-codes --object material --field uom --map-file <mapping file>`');
    expect(e!.message).toContain('an entry "" gives a blank unit beside a quantity its code');
    expect((await judge({ uom: null, weight: 2 }, 'update', { uom: null }))!.message).not.toContain('os migrate unit-codes');
    expect((await judge({ uom: null, weight: 2 }, 'insert'))!.message).not.toContain('os migrate unit-codes');
  });

  it('an update of a quantity whose pair it does not touch leaves the other quantity unjudged', async () => {
    // `tare` rests beside the blank code; the write touches only `weight`, set blank.
    expect(await judge({ uom: null, weight: null, tare: 3 }, 'update', { weight: null })).toBeNull();
  });

  it('a standalone unit field has no quantity, so a blank one is never refused here (point 6)', async () => {
    expect(await judge({ base_uom: null }, 'insert')).toBeNull();
    expect(await judge({ base_uom: '' }, 'update', { base_uom: '' })).toBeNull();
  });
});

describe('Open item 9, point 5: the dimension restriction', () => {
  it('refuses a member of another dimension, ERR_UNIT_DIMENSION_MISMATCH / 400', async () => {
    const e = await judge({ uom: 'MTR', weight: 2 }, 'insert');
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_DIMENSION_MISMATCH', status: 400, httpStatus: 400, field: 'uom' });
    expect(e!.message).toContain("'KGM'");
  });

  it('refuses an organization unit of another dimension', async () => {
    expect((await judge({ uom: 'BOX_12', weight: 2 }, 'insert'))?.code).toBe('ERR_UNIT_DIMENSION_MISMATCH');
  });

  it('judges the shared unit field by the restriction a sibling quantity declares, whichever quantity is written', async () => {
    expect((await judge({ uom: 'MTR', tare: 2 }, 'update', { tare: 2 }))?.code).toBe('ERR_UNIT_DIMENSION_MISMATCH');
  });

  it('a standalone field\'s own restriction applies to it (point 6)', async () => {
    const fields = { base_uom: { type: 'text', unitConfig: { unitMode: 'code', unitDimension: 'count' } } };
    const lookup = await readOrganizationUnits(fields, [{ image: { base_uom: 'KGM' }, organizationId: ORG }], 'insert', reader().read);
    let thrown: unknown;
    try {
      assertUnitCodes('material', fields, { base_uom: 'KGM' }, 'insert', undefined, undefined, ORG, lookup);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: 'ERR_UNIT_DIMENSION_MISMATCH', status: 400, field: 'base_uom' });
    expect(() => assertUnitCodes('material', fields, { base_uom: 'DZN' }, 'insert', undefined, undefined, ORG, lookup)).not.toThrow();
  });
});

describe('the organization read: once per organization per write, never for a standard code', () => {
  it('reads each organization once for a whole batch, and never for standard codes', async () => {
    const { read, calls } = reader();
    await readOrganizationUnits(FIELDS, [
      { image: { uom: 'JIN1', weight: 1 }, organizationId: ORG },
      { image: { uom: 'KGM', weight: 1 }, organizationId: ORG },
      { image: { base_uom: 'BOX_12' }, organizationId: ORG },
      { image: { base_uom: 'TAEL_1' }, organizationId: OTHER },
    ], 'insert', read);
    expect(calls).toEqual([[ORG, ['BOX_12', 'JIN1']], [OTHER, ['TAEL_1']]]);
  });

  it('reads nothing when every judged code is standard, or the write judges none', async () => {
    const { read, calls } = reader();
    await readOrganizationUnits(FIELDS, [{ image: { uom: 'KGM', weight: 1 }, organizationId: ORG }], 'insert', read);
    await readOrganizationUnits(FIELDS, [{ image: { uom: 'JIN1', title: 'x' }, touched: { title: 'x' }, organizationId: ORG }], 'update', read);
    await readOrganizationUnits(FIELDS, [{ image: { base_uom: 'JIN1' }, organizationId: undefined }], 'insert', read);
    expect(calls).toEqual([]);
  });

  it('asks for the exact uppercase spelling beside a mis-cased code, for the hint', async () => {
    const { read, calls } = reader();
    await readOrganizationUnits(FIELDS, [{ image: { base_uom: 'jin1' }, organizationId: ORG }], 'insert', read);
    expect(calls).toEqual([[ORG, ['JIN1', 'jin1']]]);
  });
});

describe('Requirement 1 (7030061316): a `sys_unit` row is never deleted on its own', () => {
  it('refuses a delete of `sys_unit`, ERR_UNIT_DELETE_REFUSED / 405, and no other object', () => {
    let thrown: unknown;
    try {
      refuseOrganizationUnitDelete('sys_unit', false);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: 'ERR_UNIT_DELETE_REFUSED', status: 405, httpStatus: 405 });
    expect(() => refuseOrganizationUnitDelete('sys_exchange_rate', false)).not.toThrow();
    expect(() => refuseOrganizationUnitDelete('material', false)).not.toThrow();
  });

  it('[ruling 7035627429, option B] admits only the delete the engine recognised as its organization\'s removal', () => {
    expect(() => refuseOrganizationUnitDelete('sys_unit', true)).not.toThrow();
  });
});

describe('the reader the engine passes', () => {
  it('names the organization twice and keeps nothing of the caller but its transaction', async () => {
    const { organizationUnitRowsOf } = await import('./unit-code-membership.js');
    const find = vi.fn(async () => [{ code: 'JIN1', dimension: 'mass', retired: false }]);
    const read = organizationUnitRowsOf(
      { _registry: { getObject: () => ({ name: 'sys_unit' }) }, find },
      { userId: 'u1', tenantId: OTHER, accessible_org_ids: [ORG, OTHER], transaction: 'tx1' },
    );
    await read(ORG, ['JIN1']);
    expect(find).toHaveBeenCalledWith('sys_unit', {
      where: { organization_id: ORG, code: { $in: ['JIN1'] } },
      fields: ['code', 'dimension', 'retired'],
      context: { isSystem: true, tenantId: ORG, transaction: 'tx1' },
    });
  });

  it('an install without `sys_unit` registered has no organization units, and reads nothing', async () => {
    const { organizationUnitRowsOf } = await import('./unit-code-membership.js');
    const find = vi.fn(async () => []);
    const read = organizationUnitRowsOf({ _registry: { getObject: () => undefined }, find }, undefined);
    expect(await read(ORG, ['JIN1'])).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});
