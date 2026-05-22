// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { App } from '@objectstack/spec/ui';

export const TodoApp = App.create({
  name: 'todo_app',
  label: 'Todo Manager',
  icon: 'check-square',
  branding: {
    primaryColor: '#10B981',
    logo: '/assets/todo-logo.png',
    favicon: '/assets/todo-favicon.ico',
  },
  
  navigation: [
    {
      id: 'group_tasks',
      type: 'group',
      label: 'Tasks',
      icon: 'check-square',
      children: [
        { id: 'nav_all_tasks', type: 'object', objectName: 'task', label: 'All Tasks', icon: 'list' },
        { id: 'nav_my_tasks', type: 'object', objectName: 'task', label: 'My Tasks', icon: 'user-check' },
        { id: 'nav_overdue', type: 'object', objectName: 'task', label: 'Overdue', icon: 'alert-circle' },
        { id: 'nav_today', type: 'object', objectName: 'task', label: 'Due Today', icon: 'calendar' },
        { id: 'nav_upcoming', type: 'object', objectName: 'task', label: 'Upcoming', icon: 'calendar-plus' },
      ]
    },
    {
      id: 'group_analytics',
      type: 'group',
      label: 'Analytics',
      icon: 'chart-bar',
      children: [
        { id: 'nav_dashboard', type: 'dashboard', dashboardName: 'task_dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
      ]
    },
  ]
});
