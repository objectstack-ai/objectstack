/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { usePermissions } from './usePermissions.js';

/**
 * Hook to get field-level permissions for a specific object.
 * Returns utilities for checking individual field access.
 */
export function useFieldPermissions(objectName: string) {
  const { checkField, getFieldPermissions } = usePermissions();

  const fieldPermissions = useMemo(
    () => getFieldPermissions(objectName),
    [getFieldPermissions, objectName],
  );

  return useMemo(
    () => ({
      /** All field permissions for this object */
      permissions: fieldPermissions,
      /** Check if a field is readable */
      canRead: (field: string) => checkField(objectName, field, 'read'),
      /** Check if a field is writable */
      canWrite: (field: string) => checkField(objectName, field, 'write'),
      /** Get fields that are readable */
      readableFields: (fields: string[]) => fields.filter((f) => checkField(objectName, f, 'read')),
      /** Get fields that are writable */
      writableFields: (fields: string[]) => fields.filter((f) => checkField(objectName, f, 'write')),
    }),
    [fieldPermissions, checkField, objectName],
  );
}
