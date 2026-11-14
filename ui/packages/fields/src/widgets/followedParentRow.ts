/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, in a form: an amount that follows its parent's
 * currency reads the code off the parent row, and a form record holds the
 * `master_detail` as a bare id. This reads that parent once per id, the code
 * field alone, and lays it on the record the resolver reads. Keyed on the
 * id, so picking another parent re-reads, and the symbol follows the pick.
 */
import { useContext, useEffect, useState } from 'react';
import { SchemaRendererContext } from '@object-ui/react';
import { recordCurrencyPath, withFollowedParent, type FieldCurrencyConfig } from '@object-ui/i18n';
import { readFollowedParentObject } from '../currency.js';

interface ParentSource {
  findOne?: (resource: string, id: string, params?: Record<string, unknown>) => Promise<unknown>;
}

const isRow = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * `record` as the resolver should read it for `field`: unchanged unless the
 * field follows a parent the record names by a bare id, in which case the
 * parent row read for that id is laid under the `master_detail` once it lands.
 * A read that fails, or a source that cannot read, leaves the record as it is,
 * so the amount shows no symbol rather than a currency nobody named.
 */
export function useFollowedParentRecord(
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
  record: Readonly<Record<string, unknown>> | null | undefined,
  dataSource: unknown,
): Readonly<Record<string, unknown>> | null | undefined {
  const ctx = useContext(SchemaRendererContext);
  const source = (dataSource ?? ctx?.dataSource) as ParentSource | null | undefined;
  const path = recordCurrencyPath(field);
  const parentObject = path ? readFollowedParentObject(field) : undefined;
  const named = path ? record?.[path.via] : undefined;
  const id = typeof named === 'string' && named !== '' ? named : typeof named === 'number' ? String(named) : undefined;
  const canRead = !!path && !!parentObject && id !== undefined && typeof source?.findOne === 'function';
  const key = canRead ? `${parentObject}\u0000${id}` : '';

  const [answer, setAnswer] = useState<{ key: string; row: Record<string, unknown> } | undefined>(undefined);
  useEffect(() => {
    if (!canRead || !source?.findOne) return;
    let current = true;
    source.findOne(parentObject!, id!, { $select: ['id', path!.codeField] }).then(
      (row) => { if (current && isRow(row)) setAnswer({ key, row }); },
      () => { if (current) setAnswer(undefined); },
    );
    return () => { current = false; };
  }, [canRead, source, parentObject, id, key, path?.codeField]);

  if (!canRead || answer?.key !== key) return record;
  return withFollowedParent(record ?? {}, field, answer.row) as Readonly<Record<string, unknown>>;
}
