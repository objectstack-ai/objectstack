/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * formDirtyReport — the package-internal channel a record form's unsaved-input
 * verdict travels UP through when its host cannot hand it a callback
 * (objectstack#34599).
 *
 * ## What it carries
 *
 * `ModalForm` and `DrawerForm` guard a close (backdrop, Escape, the X) and a
 * page unload with a "Discard changes?" prompt while the form holds unsaved
 * input. Their plain arm hears that from the form renderer's `onDirtyChange`.
 * Their master-detail arm renders `MasterDetailForm`, whose unsaved input
 * lives in three places no host can see: the header `ObjectForm`'s renderer,
 * the line grids' row state, and the open row editor's own `ObjectForm`.
 *
 * ## The shape
 *
 * One React context holding a reporter, `(dirty: boolean) => void`. The NEAREST
 * provider is the one a form reports to:
 *
 *   - `ModalForm` / `DrawerForm` provide their close guard's setter around the
 *     master-detail form they host;
 *   - `MasterDetailForm` reports its combined verdict (header OR lines OR row
 *     editor) to that one, and provides its OWN reporters around the header
 *     form and the row editor, so neither reaches the host directly;
 *   - the record-form layouts the header and the row editor render through
 *     (`ObjectForm`'s default arm, `TabbedForm`) report the renderer's
 *     `onDirtyChange` verdict to the nearest provider, beside their bus gate,
 *     through {@link useReportedDirtyChange}.
 *
 * With no provider mounted nothing is reported and every form behaves as
 * before. The module is not re-exported from the package index: no prop or
 * schema key is added to any exported type, so a host outside this package
 * cannot depend on it.
 *
 * A reporter must be referentially stable (a state setter, or a `useCallback`
 * on stable inputs): the form renderer resubscribes its dirty watcher whenever
 * the `onDirtyChange` it is handed changes identity.
 */
import { createContext, useCallback, useContext } from 'react';

export type FormDirtyReporter = (dirty: boolean) => void;

export const FormDirtyReportContext = createContext<FormDirtyReporter | null>(null);

/**
 * The verdict this form reports: `onDirtyChange` (the layout's own handling,
 * e.g. the data-invalidation bus gate) composed with the nearest provider's
 * reporter, when one is mounted.
 */
export function useReportedDirtyChange(onDirtyChange: FormDirtyReporter): FormDirtyReporter {
  const report = useContext(FormDirtyReportContext);
  return useCallback(
    (dirty: boolean) => {
      onDirtyChange(dirty);
      report?.(dirty);
    },
    [onDirtyChange, report],
  );
}
