/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The form renderers the console shell draws outside a route — the global
 * record form, the action modal's form and a flow's object-form screen —
 * loaded the first time one is drawn.
 *
 * `@object-ui/plugin-form`'s entry registers the form renderers when it is
 * evaluated and reaches every form surface, so a static import of `ModalForm`
 * or `ObjectForm` from an always-eager shell module keeps the whole package in
 * every first load. These wrappers import the entry on first draw instead; its
 * registrations run then, once. The pure helpers the shell needs on every page
 * come from `@object-ui/plugin-form/core`, which registers nothing.
 *
 * ⛔ No static value import of `@object-ui/plugin-form` here: the `import type`
 * below is erased, and that is the only reason this module may name the entry.
 */

import { lazy, Suspense, type ComponentProps } from 'react';
import type { ModalForm as ModalFormComponent, ObjectForm as ObjectFormComponent } from '@object-ui/plugin-form';

const ModalFormChunk = lazy(() => import('@object-ui/plugin-form').then((m) => ({ default: m.ModalForm })));
const ObjectFormChunk = lazy(() => import('@object-ui/plugin-form').then((m) => ({ default: m.ObjectForm })));

/** `ModalForm`, loaded on first draw. Nothing shows until the form chunk is in. */
export function LazyModalForm(props: ComponentProps<typeof ModalFormComponent>) {
  return (
    <Suspense fallback={null}>
      <ModalFormChunk {...props} />
    </Suspense>
  );
}

/** `ObjectForm`, loaded on first draw. Nothing shows until the form chunk is in. */
export function LazyObjectForm(props: ComponentProps<typeof ObjectFormComponent>) {
  return (
    <Suspense fallback={null}>
      <ObjectFormChunk {...props} />
    </Suspense>
  );
}
