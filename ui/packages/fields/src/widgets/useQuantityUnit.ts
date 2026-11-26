/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The unit a quantity displays in, for the faces that draw one (ADR-0158 R1
 * display): which code, its label, and its display decimal places.
 *
 * The rows come from the two places the platform keeps them: the
 * organization's own units (`sys_unit`, U3) and its decimal places for
 * standard codes (`sys_standard_unit_setting`, Open item 10). Both are read
 * through the data source the surfaces already use (`SchemaRendererContext`),
 * once per adapter for the session, the way `homeAmountPreview` reads rates.
 * A read the caller may not make (an external member holds no `sys_unit`
 * read) or one that fails leaves that table unread, and its codes show bare:
 * never an error.
 */

import { useContext, useEffect, useState } from 'react';
import { SchemaRendererContext } from '@object-ui/react';
import { en } from '@object-ui/i18n';
import {
  quantityUnitCode,
  resolveQuantityUnit,
  type OrganizationUnitRow,
  type ResolvedUnit,
  type StandardUnitSettingRow,
  type UnitBearingField,
  type UnitCatalog,
} from '@object-ui/core';
import { useFieldTranslation } from './useFieldTranslation.js';

/** The organization-unit table (ADR-0158 U3). */
export const ORGANIZATION_UNIT_OBJECT = 'sys_unit';
/** The standard-unit decimal-places table (ADR-0158 Open item 10). */
export const STANDARD_UNIT_SETTING_OBJECT = 'sys_standard_unit_setting';

/**
 * How many rows one read asks for. A setting row exists per standard code an
 * organization has set (at most the table's size per organization), and an
 * organization's own units are a short reference list; a member of several
 * organizations reads each one's rows.
 */
const UNIT_READ_TOP = 2000;

interface UnitSource {
  find(resource: string, params?: Record<string, unknown>): Promise<unknown>;
}

const rowsOf = (answer: unknown): readonly Record<string, unknown>[] => {
  const rows = Array.isArray(answer) ? answer : (answer as { data?: unknown } | null)?.data;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

/** One read per adapter, kept for the session; a read that fails resolves to "unread". */
const CATALOG_READS = new WeakMap<object, Promise<UnitCatalog>>();

/**
 * Read both unit tables through `source`, once per adapter. Each table is read
 * on its own, so a refusal of one (an external member and `sys_unit`) leaves
 * the other readable.
 */
export function readUnitCatalog(source: UnitSource): Promise<UnitCatalog> {
  const held = CATALOG_READS.get(source);
  if (held) return held;
  const read = <R>(object: string, select: string[]): Promise<readonly R[] | undefined> =>
    source
      .find(object, { $select: select, $top: UNIT_READ_TOP })
      .then((answer) => rowsOf(answer) as unknown as readonly R[], () => undefined);
  const catalog = Promise.all([
    read<OrganizationUnitRow>(ORGANIZATION_UNIT_OBJECT, ['code', 'label', 'decimal_places', 'retired', 'organization_id']),
    read<StandardUnitSettingRow>(STANDARD_UNIT_SETTING_OBJECT, ['code', 'decimal_places', 'organization_id']),
  ]).then(([organizationUnits, standardUnitSettings]): UnitCatalog => ({
    ...(organizationUnits ? { organizationUnits } : {}),
    ...(standardUnitSettings ? { standardUnitSettings } : {}),
  }));
  CATALOG_READS.set(source, catalog);
  return catalog;
}

/**
 * The platform's label for a standard code in the reader's locale (ADR-0158
 * L2, 2A), or `undefined` for a code with none. One function, so where the
 * per-locale names live can move without any caller changing.
 */
export function useStandardUnitLabel(): (code: string) => string | undefined {
  const { t } = useFieldTranslation();
  return (code: string) => {
    const base = (en.units.standard as Readonly<Record<string, string>>)[code];
    if (base === undefined) return undefined;
    const label = t(`units.standard.${code}`, { defaultValue: base });
    return typeof label === 'string' && label !== '' && label !== `units.standard.${code}` ? label : base;
  };
}

/**
 * The unit a value of `field` displays in, on `record`: `undefined` when the
 * field declares no unit or the record names none. Until the unit tables are
 * read the code resolves with its label but no decimal places of its own.
 */
export function useQuantityUnit(
  field: UnitBearingField | null | undefined,
  record?: Readonly<Record<string, unknown>> | null,
  value?: unknown,
  dataSource?: unknown,
): ResolvedUnit | undefined {
  const ctx = useContext(SchemaRendererContext);
  const source = (dataSource ?? ctx?.dataSource) as UnitSource | null | undefined;
  const code = quantityUnitCode(field, record, value);
  const standardLabel = useStandardUnitLabel();
  const canRead = code !== undefined && typeof source?.find === 'function';
  const [catalog, setCatalog] = useState<{ source: object; catalog: UnitCatalog } | undefined>(undefined);
  useEffect(() => {
    if (!canRead || !source) return;
    let current = true;
    readUnitCatalog(source).then((read) => {
      if (current) setCatalog({ source, catalog: read });
    });
    return () => {
      current = false;
    };
  }, [canRead, source]);
  if (code === undefined) return undefined;
  const rows = catalog && catalog.source === source ? catalog.catalog : {};
  return resolveQuantityUnit(code, rows, record, standardLabel(code));
}
