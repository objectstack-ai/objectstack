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
 */

import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { isEmptyValue } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
import { coerceToSafeValue } from '../coerceToSafeValue.js';
import type { CellRendererProps } from '../index.js';
import { loadRegistryLabels, registryLister, settledRegistryLabels } from './registryCatalog.js';

/** The label `type`'s catalog holds for `name`, or `undefined` (not read, not held). */
function useRegistryLabel(type: string, name: string): string | undefined {
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

  return name ? settled?.get(name) : undefined;
}

function RegistryRefCell({ value, registryType }: CellRendererProps & { registryType: string }) {
  const safe = coerceToSafeValue(value);
  const name = isEmptyValue(safe) ? '' : String(safe);
  const label = useRegistryLabel(registryType, name);
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
