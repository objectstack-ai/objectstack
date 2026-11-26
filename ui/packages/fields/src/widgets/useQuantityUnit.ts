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
import { standardUnitName } from '@objectstack/spec/data';
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

/**
 * One read per adapter, kept for the session; a read that fails resolves to
 * "unread" and stays so until a reload. Kept on purpose: an external member's
 * `sys_unit` refusal is permanent, and re-reading it per mount would cost one
 * request per cell of a grid.
 */
const CATALOG_READS = new WeakMap<object, Promise<UnitCatalog>>();

/**
 * Read both unit tables through `source`, once per adapter. Each table is read
 * on its own, so a refusal of one (an external member and `sys_unit`) leaves
 * the other readable.
 */
export function readUnitCatalog(source: UnitSource): Promise<UnitCatalog> {
  const held = CATALOG_READS.get(source);
  if (held) return held;
  // `$count: false`: no face draws a count of units, so the server need not
  // count the table (the adapter's opt-out, `countOptOut.test.ts`).
  const read = <R>(object: string, select: string[]): Promise<readonly R[] | undefined> =>
    source
      .find(object, { $select: select, $top: UNIT_READ_TOP, $count: false })
      .then((answer) => rowsOf(answer) as unknown as readonly R[], () => undefined);
  const catalog = Promise.all([
    read<OrganizationUnitRow>(ORGANIZATION_UNIT_OBJECT, ['code', 'label', 'decimal_places', 'retired', 'dimension', 'organization_id']),
    read<StandardUnitSettingRow>(STANDARD_UNIT_SETTING_OBJECT, ['code', 'decimal_places', 'organization_id']),
  ]).then(([organizationUnits, standardUnitSettings]): UnitCatalog => ({
    ...(organizationUnits ? { organizationUnits } : {}),
    ...(standardUnitSettings ? { standardUnitSettings } : {}),
  }));
  CATALOG_READS.set(source, catalog);
  return catalog;
}

/**
 * The platform's name for a standard code in the reader's locale (ADR-0158
 * L2, 2A), or `undefined` for a code that is not one.
 *
 * The per-locale names are served by the platform's i18n service: each
 * platform bundle's `messages.standardUnit<CODE>`, which the console's served
 * translation document lays under the `app` namespace. Absent a served name
 * (no provider, or a locale the server does not translate), the English base
 * name `STANDARD_UNIT_NAMES` in `@objectstack/spec` answers. One function, so
 * where the names live can move without any caller changing.
 */
export function useStandardUnitLabel(): (code: string) => string | undefined {
  const { t } = useFieldTranslation();
  return (code: string) => {
    const base = standardUnitName(code);
    if (base === undefined) return undefined;
    const key = `app.messages.standardUnit${code}`;
    const served = t(key, { defaultValue: base });
    return typeof served === 'string' && served !== '' && served !== key ? served : base;
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
  const code = quantityUnitCode(field, record, value);
  const standardLabel = useStandardUnitLabel();
  const rows = useUnitCatalog(code !== undefined, dataSource);
  if (code === undefined) return undefined;
  return resolveQuantityUnit(code, rows, record, standardLabel(code));
}

/**
 * The unit rows (`readUnitCatalog`) through the data source the surfaces use,
 * or `dataSource` when given; empty until they are read, or when `enabled` is
 * false or there is no source to read through.
 */
export function useUnitCatalog(enabled: boolean, dataSource?: unknown): UnitCatalog {
  const ctx = useContext(SchemaRendererContext);
  const source = (dataSource ?? ctx?.dataSource) as UnitSource | null | undefined;
  const canRead = enabled && typeof source?.find === 'function';
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
  return catalog && catalog.source === source ? catalog.catalog : EMPTY_CATALOG;
}

const EMPTY_CATALOG: UnitCatalog = Object.freeze({});
