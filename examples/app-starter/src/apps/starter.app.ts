// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { App } from '@objectstack/spec/ui';

/**
 * The starter's menu: the package's companies and contacts, then the
 * platform's tasks and notes, then the overview dashboard.
 *
 * Tasks and notes are the platform objects `sys_task` and `sys_note`, which
 * every environment carries; the package declares no copy of them, so
 * uninstalling it leaves every task and note in place. No entry carries a
 * label: each shows the current, localized label of what it opens.
 */
export const StarterApp = App.create({
  name: 'starter_app',
  label: 'Starter',
  icon: 'rocket',
  branding: {
    primaryColor: '#2563EB',
  },

  navigation: [
    { id: 'nav_companies', type: 'object', objectName: 'starter_company', icon: 'building-2' },
    { id: 'nav_contacts', type: 'object', objectName: 'starter_contact', icon: 'contact' },
    // `requiresObject` names the object again because `defineStack` refuses a
    // menu entry for an object the stack does not declare unless the entry
    // says the object comes from elsewhere — here, the platform.
    { id: 'nav_tasks', type: 'object', objectName: 'sys_task', requiresObject: 'sys_task', icon: 'square-check' },
    { id: 'nav_notes', type: 'object', objectName: 'sys_note', requiresObject: 'sys_note', icon: 'notebook-pen' },
    { id: 'nav_overview', type: 'dashboard', dashboardName: 'starter_overview_dashboard', icon: 'layout-dashboard' },
  ],
});
