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
