import * as UI from '@objectstack/spec/ui';

/**
 * Main App
 */
// This project's app: what the Console lists beside the platform's own apps,
// and what puts an object in the Console's navigation. An object no app lists
// is still served over REST and MCP, but the Console has no route to it. A
// package whose manifest type is 'app' holds at most one app, so this is the
// one: to put another object in the Console, add a navigation entry for it
// below (a 'group' entry with children nests them) rather than a second app,
// and give it a list view — `objectstack generate view OBJECT` writes one.
//
// The menu is the platform's Starter app's: this project's companies and
// contacts, then the platform's tasks and notes. Tasks and notes are the
// platform objects `sys_task` and `sys_note`, which every environment carries;
// this project declares no copy of them, so a task or a note can be about any
// record without changing who may see that record. No entry carries a label:
// each shows the current, localized label of what it opens.
const mainApp: UI.App = {
  name: 'blank_main_app',
  label: 'Main',
  navigation: [
    { id: 'nav_companies', type: 'object', objectName: 'blank_company', icon: 'building-2' },
    { id: 'nav_contacts', type: 'object', objectName: 'blank_contact', icon: 'contact' },
    // `requiresObject` names the object again because `defineStack` refuses a
    // menu entry for an object the stack does not declare unless the entry
    // says the object comes from elsewhere — here, the platform.
    { id: 'nav_tasks', type: 'object', objectName: 'sys_task', requiresObject: 'sys_task', icon: 'square-check' },
    { id: 'nav_notes', type: 'object', objectName: 'sys_note', requiresObject: 'sys_note', icon: 'notebook-pen' },
  ],
};

export default mainApp;
