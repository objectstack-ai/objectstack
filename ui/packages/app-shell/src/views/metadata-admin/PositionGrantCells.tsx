// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Setup position list's two served columns (objectstack#25333): who holds
 * each position, and which permission sets it grants.
 *
 * Both are the server's answer, read with `GET /meta/position?include=grants`
 * (the registry's `listInclude`): `_holderCount` and `_grantedPermissionSets`,
 * computed by the reader the authorization resolver enforces with. This file
 * renders them and computes neither.
 *
 *  - `_grantedPermissionSets` is `[{ name, via }]`. `via: 'name'` is the set
 *    that shares the position's name, which the position-name fold grants
 *    though the definition does not list it (objectstack#24757). It is marked,
 *    never hidden: it is in force.
 *  - `_holderCount` is a number, or `null` when the server serves no count
 *    (no active organization, a caller who may not read the assignments, a
 *    derived position). `null` and an absent key both read "—", ⛔ never 0: a
 *    count nobody measured is not zero.
 */

import * as React from 'react';
import { Badge } from '@object-ui/components';
import { t, useMetadataLocale } from './i18n.js';

/** One entry of the served `_grantedPermissionSets`. */
export interface PositionGrantedSet {
  name: string;
  via: 'definition' | 'name';
}

function readGrantedSets(value: unknown): PositionGrantedSet[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (v): v is PositionGrantedSet =>
      !!v && typeof v === 'object' && typeof (v as PositionGrantedSet).name === 'string'
      && ((v as PositionGrantedSet).via === 'definition' || (v as PositionGrantedSet).via === 'name'),
  );
}

export function PositionHolderCountCell({ value }: { value: unknown }): React.ReactElement {
  const locale = useMetadataLocale();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return <span className="tabular-nums" data-testid="position-holder-count">{value}</span>;
  }
  return (
    <span
      className="text-muted-foreground"
      title={t('engine.position.holders.unknown', locale)}
      data-testid="position-holder-count"
    >
      —
    </span>
  );
}

export function PositionGrantedSetsCell({ value }: { value: unknown }): React.ReactElement {
  const locale = useMetadataLocale();
  const sets = readGrantedSets(value);
  if (!sets) {
    return <span className="text-muted-foreground" data-testid="position-granted-sets">—</span>;
  }
  if (sets.length === 0) {
    return (
      <span className="text-muted-foreground" data-testid="position-granted-sets">
        {t('engine.position.grants.none', locale)}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="position-granted-sets">
      {sets.map((set) => (
        <Badge
          key={set.name}
          variant="outline"
          className="font-mono text-[11px] font-normal"
          data-via={set.via}
          title={set.via === 'name' ? t('engine.position.grants.byNameHint', locale) : undefined}
        >
          {set.name}
          {set.via === 'name' && (
            <span className="ml-1 font-sans text-muted-foreground">
              {t('engine.position.grants.byName', locale)}
            </span>
          )}
        </Badge>
      ))}
    </span>
  );
}
