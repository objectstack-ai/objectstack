/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The READ face of the `position-ref` / `permission-ref` keys: a list or detail
 * cell of a textual field declaring either widget (`resolveCellRendererType`)
 * draws the registry LABEL of the stored name, with the name itself on
 * `title`, so the api name stays one hover away. A user's Permission Sets tab
 * reads "Organization Admin" where it read `organization_admin_no_bypass`.
 *
 * The label comes from the catalog the edit widget lists
 * (`./registryCatalog.ts`), read once per data source and registry type for
 * every cell that draws one. Until it answers, when it fails, when there is no
 * data source that can list a registry, and for a name the catalog does not
 * hold or holds without a label, the cell draws the stored name, exactly as the
 * text cell does.
 *
 * A permission-set name more than one holder serves (objectstack#32795): where
 * the call site hands the row and the row carries the grant's package column,
 * the cell draws the label of the holder the server reads the row as, and the
 * bare name where that is no single holder. Every other cell (one holder, no
 * row, a row without the column) labels the name by its name, as before.
 */

import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { columnIdentity, isEmptyValue } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
import { coerceToSafeValue } from '../coerceToSafeValue.js';
import type { CellRendererProps } from '../index.js';
import { loadRegistryLabels, registryLister, settledRegistryLabels, type SettledRegistryCatalog } from './registryCatalog.js';
import { holderPackageOf, rowHolderPackageFieldOf, storedGrantHolders } from './permissionSetHolders.js';

/** The registry types whose names are addressed by `(package, name)` (objectstack#32770). */
const HOLDER_ADDRESSED_TYPES: ReadonlySet<string> = new Set(['permission']);

/**
 * Where a row names a holder (`packageField` is not `null`) and more than one
 * holder serves `name`, the label of the holder the server reads the row as
 * (`storedGrantHolders`, the edit widget's reading), or the bare name when that
 * leaves no single holder (two packages, none named): never one holder's label
 * picked by order. Otherwise the label by name alone, as before
 * (objectstack#32795).
 */
function labelOf(
  settled: SettledRegistryCatalog | undefined,
  name: string,
  packageField: string | null,
  row: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (!settled || !name) return undefined;
  const byHolder = packageField ? settled.holders.get(name) : undefined;
  if (!byHolder || byHolder.size <= 1) return settled.labels.get(name);
  const reached = storedGrantHolders(holderPackageOf(row?.[packageField as string]), [...byHolder.keys()]);
  return reached.length === 1 ? byHolder.get(reached[0]) : undefined;
}

/** The catalog `type` has settled to, read once per data source and type. */
function useRegistryCatalog(type: string, name: string): SettledRegistryCatalog | undefined {
  const source = registryLister(React.useContext(SchemaRendererContext)?.dataSource);
  const settled = source ? settledRegistryLabels(source, type) : undefined;
  const [, setLoaded] = React.useState(0);

  React.useEffect(() => {
    if (!source || !name || settled) return;
    let live = true;
    loadRegistryLabels(source, type).then(
      () => {
        if (live) setLoaded((n) => n + 1);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [source, type, name, settled]);

  return settled;
}

function RegistryRefCell({
  value,
  field,
  dependentValues,
  registryType,
}: CellRendererProps & { registryType: string }) {
  const safe = coerceToSafeValue(value);
  const name = isEmptyValue(safe) ? '' : String(safe);
  const settled = useRegistryCatalog(registryType, name);
  const packageField = HOLDER_ADDRESSED_TYPES.has(registryType)
    ? rowHolderPackageFieldOf(columnIdentity(field), dependentValues)
    : null;
  const label = labelOf(settled, name, packageField, dependentValues);
  if (!name) return <EmptyValue />;
  return (
    <span className="block max-w-full truncate" title={name}>
      {label ?? name}
    </span>
  );
}

/** `position-ref`: a stored position name, drawn as the position's label. */
export function PositionRefCell(props: CellRendererProps) {
  return <RegistryRefCell {...props} registryType="position" />;
}

/** `permission-ref`: a stored permission-set name, drawn as the set's label. */
export function PermissionRefCell(props: CellRendererProps) {
  return <RegistryRefCell {...props} registryType="permission" />;
}
