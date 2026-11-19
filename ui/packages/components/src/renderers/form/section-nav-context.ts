/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * One section heading of a sectioned form, as the form renderer drew it
 * (objectstack#34605). The renderer reports the list; a host draws the
 * section navigation from it.
 */
export interface FormSectionNavItem {
  /** The section's divider row name — stable for the life of the form. */
  key: string;
  /** The heading text the row draws. */
  label: string;
  /** The `id` of the heading row in the DOM, the scroll target. */
  anchorId: string;
  /**
   * Fields of this section that hold a validation error right now — a client
   * rule, a required field left empty at submit, or a field the server
   * rejected. `0` when none.
   */
  errorCount: number;
  /** The section's fields are folded away behind its heading. */
  collapsed: boolean;
  /** Unfold the section; a no-op when it is not collapsed. */
  expand: () => void;
}

/**
 * The section list sink a host provides (objectstack#34605).
 *
 * A `form` renderer below it reports the section headings it draws — only the
 * visible ones, in order, with each section's error count — every time that
 * list changes, and `null` when it draws no stacked sections (a flat form, a
 * tabbed or paned layout) or unmounts. The renderer provides `null` to its own
 * descendants, so a form nested inside another never reports into the outer
 * form's sink.
 *
 * It is a host slot, never metadata: no form or section key says it, so every
 * sectioned form under a host that mounts it gets the navigation, with nothing
 * for an author to configure. `null` (the default) means nobody is listening.
 */
export type FormSectionNavSink = (items: FormSectionNavItem[] | null) => void;

export const FormSectionNavContext = React.createContext<FormSectionNavSink | null>(null);
