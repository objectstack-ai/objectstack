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
 * distinct list, only in development, and only once there is nothing left to
 * wait for: the object's schema has landed, or it never will (no
 * `getObjectSchema`, or the read failed). A list still loading its object is
 * never reported; a list whose object could not be read is, and the message
 * says the object's actions are unknown rather than that the name is
 * undeclared.
 */

import { useEffect } from 'react';

/**
 * The bundler-replaced `process.env.NODE_ENV` idiom, declared for THIS module
 * only (the same stance as `@object-ui/fields`' `resolveActionParams.ts`): the
 * package's source program carries no node typings, and a module-scoped
 * declaration cannot shadow the real node global anywhere else.
 *
 * ⛔ Spell the gate as the literal `process.env.NODE_ENV`, never as an optional
 * chain off `globalThis.process`. Only the literal is a token the bundler
 * replaces: the Console's production build turns it into `"production"`, while
 * the chain survives the build and reads the Console's `window.process` shim
 * (`ui/apps/console/index.html`), which says `development` unconditionally, so
 * a production Console would log the warning too. Pinned by
 * `__tests__/undeclaredActionNames.test.ts`.
 */
declare const process: { env: { NODE_ENV?: string } };

/** The two bare-name keys whose undeclared names this module reports. */
export type UndeclaredActionNameKey = 'bulkActions' | 'rowActions';

/** Where the offending block lives, for the first line of the message. */
export interface UndeclaredActionNamesAddress {
  /**
   * The component whose bar or menu left the names undrawn, for the message's
   * head. Omitted: `ObjectGrid`. `@object-ui/plugin-list`'s ListView passes
   * `ListView` for the selection bar it draws itself over a non-grid view.
   */
  component?: unknown;
  /**
   * The schema node's `type`: `object-grid`, or the `view:grid` alias; for
   * ListView, the view on screen (`kanban`, `calendar`, …).
   */
  blockType?: unknown;
  /** The object the grid queries, when it names one. */
  objectName?: unknown;
  /** The grid's authored label, when it has one. */
  label?: unknown;
}

/**
 * Whether the object's actions were known when the names were judged.
 * `'unread'`: the grid names an object but its schema never arrived (no
 * `getObjectSchema`, or the read failed), so every bare name went undrawn
 * without the object being asked.
 */
export type UndeclaredActionNamesBasis = 'declared' | 'unread';

const SURFACE: Record<UndeclaredActionNameKey, string> = {
  bulkActions: 'the selection bar draws no button',
  rowActions: 'the row menu draws no entry',
};

function describeComponent(component: unknown): string {
  return typeof component === 'string' && component.length > 0 ? component : 'ObjectGrid';
}

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
  basis: UndeclaredActionNamesBasis = 'declared',
): string | null {
  if (names.length === 0) return null;
  const them = names.length === 1 ? 'it' : 'them';
  const listed = names.map((n) => `'${n}'`).join(', ');
  const rule = `  A bare \`${key}\` name must name an action declared on the object.`;
  if (basis === 'unread') {
    const count = names.length === 1 ? '1 name' : `${names.length} names`;
    return `[ObjectUI] ${describeComponent(address.component)} ${key}: ${describeAddress(address)} — the object's schema could not `
      + `be read (no getObjectSchema on the data source, or the read failed), so its declared actions `
      + `are unknown and ${SURFACE[key]} for ${count}: ${listed}.\n`
      + `${rule} Give the grid a data source that answers getObjectSchema, or check why the read failed.`;
  }
  const count = names.length === 1 ? '1 name matches' : `${names.length} names match`;
  return `[ObjectUI] ${describeComponent(address.component)} ${key}: ${describeAddress(address)} — ${count} no action the object `
    + `declares, so ${SURFACE[key]} for ${them}: ${listed}.\n`
    + `${rule} Declare the action on the `
    + 'object, or remove the name. An action that a disabled package withholds is left out of the '
    + 'object the same way, so it is not drawn either.';
}

/** Development only; see the `process` declaration above for the spelling. */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

// Warn once per message, not once per effect run: under React StrictMode every
// effect runs setup → cleanup → setup in development, and a list that remounts
// (navigating away and back) would say the same thing again. Keyed by the
// message, which already carries the key, the block's address and every name,
// so a list that changes its names, or a second list, still reports. The same
// memo shape as `@object-ui/core`'s `column-identity.ts`.
const warnedMessages = new Set<string>();

/** Reset the warn-once memo. Exported for tests. */
export function resetUndeclaredActionNamesWarnings(): void {
  warnedMessages.clear();
}

/**
 * Logs {@link describeUndeclaredActionNames} once per distinct message, in
 * development only. `ready` is false while the object's schema is still on its
 * way: before that every name is undeclared and none is worth reporting.
 * `basis` says whether the object's actions were read at all.
 */
export function useUndeclaredActionNamesWarning(input: {
  key: UndeclaredActionNameKey;
  names: readonly string[];
  ready: boolean;
  basis?: UndeclaredActionNamesBasis;
  address: UndeclaredActionNamesAddress;
}): void {
  const { key, ready } = input;
  const basis = input.basis ?? 'declared';
  // Keyed on the names' VALUES, never on the array the fold returns, which is
  // a fresh one on every render.
  const namesKey = ready ? JSON.stringify(input.names) : '';
  const { component, blockType, objectName, label } = input.address;
  useEffect(() => {
    if (!namesKey || !isDevelopment()) return;
    const message = describeUndeclaredActionNames(key, JSON.parse(namesKey) as string[], {
      component,
      blockType,
      objectName,
      label,
    }, basis);
    if (!message || warnedMessages.has(message)) return;
    warnedMessages.add(message);
    console.warn(message);
  }, [key, namesKey, basis, component, blockType, objectName, label]);
}
