/**
 * The Console's opt-in to the edit form's read-only owner line, with Change
 * Owner beside it (objectstack#35403). Eager and light: the action and its
 * dialog load the first time an edit form draws the line.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { FormOwnerLineContext, type FormOwnerLineHost } from '@object-ui/plugin-form/core';

const FormOwnerChangeActionChunk = lazy(() =>
  import('./FormOwnerChangeAction.js').then((m) => ({ default: m.FormOwnerChangeAction })));

const CONSOLE_FORM_OWNER_LINE: FormOwnerLineHost = {
  renderAction: (target) => (
    <Suspense fallback={null}>
      <FormOwnerChangeActionChunk {...target} />
    </Suspense>
  ),
};

export function ConsoleFormOwnerLine({ children }: { children: ReactNode }) {
  return <FormOwnerLineContext.Provider value={CONSOLE_FORM_OWNER_LINE}>{children}</FormOwnerLineContext.Provider>;
}
