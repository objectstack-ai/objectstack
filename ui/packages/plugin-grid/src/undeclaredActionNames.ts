/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The development warning for a bare `bulkActions` / `rowActions` name that
 * matches no action the object declares.
 *
 * `resolveBulkActions` and `resolveLegacyRowActions` draw nothing for such a
 * name: the spec says a bare name "names an action the object declares"
 * (`packages/spec/src/ui/bulk-action.zod.ts`), and lint
 * `action-name-undefined` (ADR-0049) refuses any other at authoring. This
 * module is the half that keeps the drop from being silent. It warns once per
 * distinct list, only in development, and only once the object's actions are
 * known, so a list that is still loading its object is never reported.
 */

import { useEffect } from 'react';

/** The two bare-name keys whose undeclared names this module reports. */
export type UndeclaredActionNameKey = 'bulkActions' | 'rowActions';

/** Where the offending block lives, for the first line of the message. */
export interface UndeclaredActionNamesAddress {
  /** The schema node's `type`: `object-grid`, or the `view:grid` alias. */
  blockType?: unknown;
  /** The object the grid queries, when it names one. */
  objectName?: unknown;
  /** The grid's authored label, when it has one. */
  label?: unknown;
}

const SURFACE: Record<UndeclaredActionNameKey, string> = {
  bulkActions: 'the selection bar draws no button',
  rowActions: 'the row menu draws no entry',
};

function describeAddress({ blockType, objectName, label }: UndeclaredActionNamesAddress): string {
  const block = typeof blockType === 'string' && blockType.length > 0 ? blockType : 'object-grid';
  const parts: string[] = [];
  if (typeof objectName === 'string' && objectName.length > 0) parts.push(`objectName: '${objectName}'`);
  else parts.push('no objectName');
  if (typeof label === 'string' && label.length > 0) parts.push(`label: '${label}'`);
  return `${block} (${parts.join(', ')})`;
}

/**
 * The message for the names one fold did not draw, or `null` when there are
 * none. It names the key, the block, and every name, and says what to write.
 */
export function describeUndeclaredActionNames(
  key: UndeclaredActionNameKey,
  names: readonly string[],
  address: UndeclaredActionNamesAddress,
): string | null {
  if (names.length === 0) return null;
  const count = names.length === 1 ? '1 name matches' : `${names.length} names match`;
  const them = names.length === 1 ? 'it' : 'them';
  return `[ObjectUI] ObjectGrid ${key}: ${describeAddress(address)} — ${count} no action the object `
    + `declares, so ${SURFACE[key]} for ${them}: ${names.map((n) => `'${n}'`).join(', ')}.\n`
    + `  A bare \`${key}\` name must name an action declared on the object. Declare the action on the `
    + 'object, or remove the name. An action that a disabled package withholds is left out of the '
    + 'object the same way, so it is not drawn either.';
}

function isDevelopment(): boolean {
  return (globalThis as any).process?.env?.NODE_ENV !== 'production';
}

/**
 * Logs {@link describeUndeclaredActionNames} once per distinct list, in
 * development only. `ready` is false until the object's actions are known:
 * before that every name is undeclared and none is worth reporting.
 */
export function useUndeclaredActionNamesWarning(input: {
  key: UndeclaredActionNameKey;
  names: readonly string[];
  ready: boolean;
  address: UndeclaredActionNamesAddress;
}): void {
  const { key, ready } = input;
  // Keyed on the names' VALUES, never on the array the fold returns, which is
  // a fresh one on every render.
  const namesKey = ready ? JSON.stringify(input.names) : '';
  const { blockType, objectName, label } = input.address;
  useEffect(() => {
    if (!namesKey || !isDevelopment()) return;
    const message = describeUndeclaredActionNames(key, JSON.parse(namesKey) as string[], {
      blockType,
      objectName,
      label,
    });
    if (message) console.warn(message);
  }, [key, namesKey, blockType, objectName, label]);
}
