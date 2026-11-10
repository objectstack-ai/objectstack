import * as UI from '@objectstack/spec/ui';
import { Note } from '../objects/note.object.js';

/**
 * Note Views
 */
// The list the Console opens when the `Notes` entry of `src/apps/main.app.ts`
// is clicked. Written by `objectstack generate view note`. The sample object
// is referenced as `Note.name`, never as a typed-out string: scaffolding
// renamed it to carry this project's namespace. When you delete the sample
// `note` object, delete this file and its export line in `src/views/index.ts`.
const noteViews: UI.View = {
  // A views container is registered under the object it binds to: `object`
  // is its identity, so it declares no `name` or `label` of its own. The
  // label people see is the list view's, below.
  object: Note.name,
  list: {
    label: 'All Notes',
    type: 'grid',
    columns: [
      { field: 'title' },
      { field: 'body' },
    ],
    sort: [{ field: 'title', order: 'asc' }],
    pagination: { pageSize: 25 },
  },
};

export default noteViews;
