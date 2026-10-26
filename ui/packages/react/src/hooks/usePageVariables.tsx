/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { PageVariable } from '@object-ui/types';

/**
 * Page variables context value.
 * Provides access to page-level state variables.
 */
export interface PageVariablesContextValue {
  /** Current variable values */
  variables: Record<string, any>;
  /**
   * The variable definitions backing this provider. Exposed so writer
   * elements can resolve which variable they feed via `PageVariable.source`
   * (the component id that writes to the variable) — see
   * {@link usePageVariableBinding}.
   */
  definitions: PageVariable[];
  /** Set a single variable value */
  setVariable: (name: string, value: any) => void;
  /** Set multiple variable values at once */
  setVariables: (updates: Record<string, any>) => void;
  /** Reset all variables to their default values */
  resetVariables: () => void;
}

const PageVariablesContext = createContext<PageVariablesContextValue | null>(null);

/**
 * Initialize page variables from their definitions.
 * Sets each variable to its defaultValue or type-appropriate default.
 */
function initializeVariables(definitions?: PageVariable[]): Record<string, any> {
  if (!definitions || definitions.length === 0) return {};

  const initial: Record<string, any> = {};
  for (const def of definitions) {
    if (def.defaultValue !== undefined) {
      initial[def.name] = def.defaultValue;
    } else {
      // Type-appropriate defaults
      switch (def.type) {
        case 'number':
          initial[def.name] = 0;
          break;
        case 'boolean':
          initial[def.name] = false;
          break;
        case 'object':
          initial[def.name] = {};
          break;
        case 'array':
          initial[def.name] = [];
          break;
        case 'string':
        default:
          initial[def.name] = '';
          break;
      }
    }
  }
  return initial;
}

/**
 * Props for PageVariablesProvider
 */
export interface PageVariablesProviderProps {
  /** Variable definitions from PageSchema.variables */
  definitions?: PageVariable[];
  /** Child components */
  children: React.ReactNode;
}

/**
 * PageVariablesProvider — Provides page-level state variables to the component tree.
 *
 * Initializes variables from their definitions and provides read/write access
 * to all child components via the usePageVariables hook.
 *
 * Nesting MERGES contexts (objectui#2578): a nested provider (e.g. a filtered
 * dashboard embedded in a Page that declares its own `variables`) no longer
 * shadows the outer scope wholesale. Inside the nested subtree, `variables`
 * exposes the outer values plus the inner ones (an inner definition with the
 * SAME name shadows the outer one, deliberately), and writes route to the
 * scope that DEFINES the variable — writing an outer-defined name from inside
 * the nested subtree updates the outer provider, so both subtrees stay in
 * sync. Names defined nowhere are written locally. `resetVariables` resets
 * only the local scope's definitions.
 *
 * @example
 * ```tsx
 * <PageVariablesProvider definitions={[
 *   { name: 'selectedId', type: 'string', defaultValue: '' },
 *   { name: 'count', type: 'number', defaultValue: 0 },
 * ]}>
 *   <MyComponents />
 * </PageVariablesProvider>
 * ```
 */
export const PageVariablesProvider: React.FC<PageVariablesProviderProps> = ({
  definitions,
  children,
}) => {
  const parent = useContext(PageVariablesContext);

  const [ownVariables, setVariablesState] = useState<Record<string, any>>(() =>
    initializeVariables(definitions)
  );

  const defs = useMemo<PageVariable[]>(() => definitions ?? [], [definitions]);

  // Names THIS provider owns (defines). Writes to a name an ancestor defines
  // — and this provider doesn't — delegate upward; everything else (own
  // names AND names defined nowhere) writes locally, so ad-hoc variables
  // behave exactly as before.
  const ownNames = useMemo(() => new Set(defs.map((d) => d.name)), [defs]);

  const setVariable = useCallback(
    (name: string, value: any) => {
      if (!ownNames.has(name) && parent && parent.definitions.some((d) => d.name === name)) {
        parent.setVariable(name, value);
        return;
      }
      setVariablesState((prev) => ({ ...prev, [name]: value }));
    },
    [ownNames, parent]
  );

  const setVariables = useCallback(
    (updates: Record<string, any>) => {
      for (const [name, value] of Object.entries(updates)) setVariable(name, value);
    },
    [setVariable]
  );

  const resetVariables = useCallback(() => {
    setVariablesState(initializeVariables(definitions));
  }, [definitions]);

  // Merged view: outer scope first, own values win on name collisions.
  const variables = useMemo<Record<string, any>>(
    () => (parent ? { ...parent.variables, ...ownVariables } : ownVariables),
    [parent, ownVariables]
  );
  const mergedDefs = useMemo<PageVariable[]>(
    () =>
      parent
        ? [...parent.definitions.filter((d) => !ownNames.has(d.name)), ...defs]
        : defs,
    [parent, defs, ownNames]
  );

  const value = useMemo<PageVariablesContextValue>(
    () => ({ variables, definitions: mergedDefs, setVariable, setVariables, resetVariables }),
    [variables, mergedDefs, setVariable, setVariables, resetVariables]
  );

  return (
    <PageVariablesContext.Provider value={value}>
      {children}
    </PageVariablesContext.Provider>
  );
};

PageVariablesProvider.displayName = 'PageVariablesProvider';

/**
 * Hook to access page-level variables.
 *
 * Returns the current variable values and setter functions.
 * Returns a no-op fallback if used outside a PageVariablesProvider.
 *
 * @example
 * ```tsx
 * const { variables, setVariable } = usePageVariables();
 * const userId = variables.selectedId;
 * setVariable('selectedId', '123');
 * ```
 */
export function usePageVariables(): PageVariablesContextValue {
  const ctx = useContext(PageVariablesContext);
  return ctx ?? OUTSIDE_PAGE;
}

/**
 * Graceful fallback — allows components to work outside a Page.
 *
 * MUST be a module constant, not a fresh literal per call. `SchemaRenderer`
 * feeds `variables` into the `evaluatedSchema` memo's dependency list, so a new
 * object each render defeats that memo for every component rendered outside a
 * PageVariablesProvider — and hands children a new schema identity every time.
 * A `kind:'react'` page memoises its compiled source on that identity, so the
 * page was being remounted and its `useState` reset (objectui#2954).
 *
 * Frozen through, because sharing one instance means a stray write would no
 * longer be scoped to one render — it would leak to every consumer outside a
 * provider. There is no writer today (the setters are the API, and here they
 * are no-ops); the freeze keeps it that way.
 */
const OUTSIDE_PAGE: PageVariablesContextValue = Object.freeze({
  variables: Object.freeze({}),
  definitions: Object.freeze([]) as never,
  setVariable: () => {},
  setVariables: () => {},
  resetVariables: () => {},
});

/**
 * Hook to check if a PageVariablesProvider is available.
 */
export function useHasPageVariables(): boolean {
  return useContext(PageVariablesContext) !== null;
}

/**
 * A writer binding for a page variable, resolved from a component id.
 */
export interface PageVariableBinding {
  /** The bound variable's name */
  name: string;
  /** The bound variable's current value */
  value: any;
  /** Write a new value into the bound variable */
  setValue: (value: any) => void;
}

/**
 * Resolve the page variable that a given component writes to.
 *
 * Per `@objectstack/spec`'s `PageVariableSchema`, a variable's `source`
 * names the **component id** that feeds it — e.g. a `variables` entry
 * `{ name: 'selectedProjectId', source: 'project_picker' }` is written by the
 * component whose `id` is `project_picker`. An interactive element (record
 * picker, filter, …) calls this with its own `schema.id` and writes the
 * user's selection through the returned `setValue`.
 *
 * Returns `null` when no variable targets the given component (or when called
 * outside a {@link PageVariablesProvider}), so callers can treat themselves as
 * uncontrolled in that case.
 *
 * @example
 * ```tsx
 * const binding = usePageVariableBinding(schema.id);
 * // on selection:
 * binding?.setValue(record.id);
 * ```
 */
export function usePageVariableBinding(componentId?: string): PageVariableBinding | null {
  const { variables, definitions, setVariable } = usePageVariables();
  return useMemo(() => {
    if (!componentId) return null;
    const def = definitions.find((d) => d.source === componentId);
    if (!def) return null;
    return {
      name: def.name,
      value: variables[def.name],
      setValue: (value: any) => setVariable(def.name, value),
    };
  }, [componentId, definitions, variables, setVariable]);
}
