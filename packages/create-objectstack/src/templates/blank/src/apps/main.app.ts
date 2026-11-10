import * as UI from '@objectstack/spec/ui';
import { Note } from '../objects/note.object.js';

/**
 * Main App
 */
// This project's app: what the Console lists beside the platform's own apps,
// and what puts an object in the Console's navigation. An object no app lists
// is still served over REST and MCP, but the Console has no route to it.
// Written by `objectstack generate app main --object note`; to put another
// object in the Console, add a navigation entry for it here (or generate an
// app of its own), and give it a list view with `objectstack generate view`.
//
// The sample object is referenced as `Note.name`, never as a typed-out string:
// scaffolding renamed it to carry this project's namespace. When you delete
// the sample `note` object, delete its entry below too.
const mainApp: UI.App = {
  name: 'blank_main_app',
  label: 'Main',
  navigation: [
    {
      id: `${Note.name}_nav`,
      type: 'object',
      label: 'Notes',
      objectName: Note.name,
    },
  ],
};

export default mainApp;
