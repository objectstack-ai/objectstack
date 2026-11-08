/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * The fields of a form whose OPENING value was suggested by AI rather than
 * typed by the person or declared by the form (objectstack#28104).
 *
 * The console's create page provides it when it opens on a record-write
 * card's values from the AI chat ("Open the full form"). Every `form` renderer
 * below it marks each named field "AI suggestion" under its control for as
 * long as the field still holds its opening value; the first edit takes the
 * mark away. A field this set does not name is drawn exactly as before.
 *
 * It is a host slot, never metadata: no form or field key says it, so an
 * authored page cannot mark a field. `undefined` (the default) marks nothing.
 * It marks, and nothing more: the form still only submits when the person
 * presses Save.
 */
export const SuggestedFieldsContext = React.createContext<ReadonlySet<string> | undefined>(undefined);

/**
 * The CHANGES AI proposes to a stored record's fields, field name → proposed
 * value (objectstack#28106). The sibling of {@link SuggestedFieldsContext} for
 * an edit form: there the opening value is the stored one, so the suggestion
 * cannot be the opening value.
 *
 * The console's edit page provides it when it opens on an update card's
 * proposed values from the AI chat ("Open the full form"). A `form` renderer
 * below it applies each proposed value to a field it draws, once, over the
 * record it opened on, as an unsaved change the person's own edit would be
 * (the form reads dirty and the save writes it). While the field holds the
 * proposed value it shows the same "AI suggestion" mark, the stored value it
 * replaces (before → after) and a revert that puts the stored value back.
 * A read-only or disabled field, and a field the form does not draw, is left
 * alone: nothing is applied where the person cannot see or undo it.
 *
 * Like its sibling it is a host slot, never metadata, and it never submits:
 * the record changes only when the person presses Save.
 */
export const SuggestedFieldChangesContext = React.createContext<ReadonlyMap<string, unknown> | undefined>(undefined);
