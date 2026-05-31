// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';
import { Account } from '../objects/account.object.js';
import { Project } from '../objects/project.object.js';
import { Task } from '../objects/task.object.js';
import { Category } from '../objects/category.object.js';
import { Team, ProjectMembership } from '../objects/team.object.js';

/**
 * Seed data sized to "feed every view": every Kanban column is populated,
 * tasks carry due/start/end/created dates (calendar, gantt, timeline) and a
 * work location (map), and projects span every status and health.
 */

const accounts = defineDataset(Account, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Northwind', industry: 'retail', annual_revenue: 8_000_000, website: 'https://northwind.example' },
    { name: 'Contoso', industry: 'technology', annual_revenue: 25_000_000, website: 'https://contoso.example' },
    { name: 'Fabrikam', industry: 'healthcare', annual_revenue: 12_000_000, website: 'https://fabrikam.example' },
  ],
});

const projects = defineDataset(Project, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Website Relaunch', account: { externalId: 'Northwind' }, status: 'active', health: 'green', budget: 150_000, spent: 60_000, owner: 'ada@example.com', start_date: cel`daysAgo(30)`, end_date: cel`daysFromNow(60)` },
    { name: 'Data Platform', account: { externalId: 'Contoso' }, status: 'active', health: 'yellow', budget: 600_000, spent: 420_000, owner: 'linus@example.com', start_date: cel`daysAgo(90)`, end_date: cel`daysFromNow(120)` },
    { name: 'Compliance Audit', account: { externalId: 'Fabrikam' }, status: 'on_hold', health: 'red', budget: 90_000, spent: 88_000, owner: 'grace@example.com', start_date: cel`daysAgo(15)`, end_date: cel`daysFromNow(30)` },
    { name: 'Mobile App', account: { externalId: 'Contoso' }, status: 'planned', health: 'green', budget: 200_000, spent: 0, owner: 'ada@example.com', start_date: cel`daysFromNow(14)`, end_date: cel`daysFromNow(140)` },
    { name: 'Legacy Sunset', account: { externalId: 'Northwind' }, status: 'completed', health: 'green', budget: 50_000, spent: 48_000, owner: 'linus@example.com', start_date: cel`daysAgo(180)`, end_date: cel`daysAgo(20)` },
  ],
});

// Tasks across all five board columns, with dates + locations to drive every view.
const tasks = defineDataset(Task, {
  mode: 'upsert',
  externalId: 'title',
  records: [
    { title: 'Audit current IA', project: { externalId: 'Website Relaunch' }, assignee: 'ada@example.com', status: 'done', priority: 'medium', estimate_hours: 8, progress: 100, done: true, created_at: cel`daysAgo(20)`, start_date: cel`daysAgo(20)`, end_date: cel`daysAgo(18)`, due_date: cel`daysAgo(18)` },
    { title: 'Design system', project: { externalId: 'Website Relaunch' }, assignee: 'ada@example.com', status: 'in_review', priority: 'high', estimate_hours: 24, progress: 80, done: false, created_at: cel`daysAgo(14)`, start_date: cel`daysAgo(12)`, end_date: cel`daysFromNow(2)`, due_date: cel`daysFromNow(2)` },
    { title: 'Build homepage', project: { externalId: 'Website Relaunch' }, assignee: 'sam@example.com', status: 'in_progress', priority: 'high', estimate_hours: 40, progress: 45, done: false, created_at: cel`daysAgo(8)`, start_date: cel`daysAgo(6)`, end_date: cel`daysFromNow(10)`, due_date: cel`daysFromNow(10)` },
    { title: 'SEO migration plan', project: { externalId: 'Website Relaunch' }, assignee: 'sam@example.com', status: 'todo', priority: 'medium', estimate_hours: 16, progress: 0, done: false, created_at: cel`daysAgo(3)`, start_date: cel`daysFromNow(5)`, end_date: cel`daysFromNow(15)`, due_date: cel`daysFromNow(15)` },
    { title: 'Content backlog', project: { externalId: 'Website Relaunch' }, assignee: 'grace@example.com', status: 'backlog', priority: 'low', estimate_hours: 12, progress: 0, done: false, created_at: cel`daysAgo(2)`, due_date: cel`daysFromNow(30)` },
    { title: 'Ingest pipeline', project: { externalId: 'Data Platform' }, assignee: 'linus@example.com', status: 'in_progress', priority: 'urgent', estimate_hours: 60, progress: 55, done: false, created_at: cel`daysAgo(40)`, start_date: cel`daysAgo(35)`, end_date: cel`daysFromNow(20)`, due_date: cel`daysFromNow(20)` },
    { title: 'Warehouse schema', project: { externalId: 'Data Platform' }, assignee: 'linus@example.com', status: 'in_review', priority: 'high', estimate_hours: 30, progress: 90, done: false, created_at: cel`daysAgo(25)`, start_date: cel`daysAgo(22)`, end_date: cel`daysFromNow(3)`, due_date: cel`daysFromNow(3)` },
    { title: 'PII access review', project: { externalId: 'Compliance Audit' }, assignee: 'grace@example.com', status: 'todo', priority: 'urgent', estimate_hours: 20, progress: 0, done: false, created_at: cel`daysAgo(5)`, start_date: cel`daysFromNow(2)`, end_date: cel`daysFromNow(12)`, due_date: cel`daysFromNow(12)` },
    { title: 'Evidence collection', project: { externalId: 'Compliance Audit' }, assignee: 'grace@example.com', status: 'backlog', priority: 'medium', estimate_hours: 18, progress: 0, done: false, created_at: cel`daysAgo(1)`, due_date: cel`daysFromNow(25)` },
    { title: 'App wireframes', project: { externalId: 'Mobile App' }, assignee: 'ada@example.com', status: 'done', priority: 'medium', estimate_hours: 16, progress: 100, done: true, created_at: cel`daysAgo(10)`, start_date: cel`daysAgo(10)`, end_date: cel`daysAgo(6)`, due_date: cel`daysAgo(6)` },
  ],
});

const categories = defineDataset(Category, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Engineering', sort_order: 1, color: '#3B82F6' },
    { name: 'Frontend', parent: { externalId: 'Engineering' }, sort_order: 1, color: '#06B6D4' },
    { name: 'Backend', parent: { externalId: 'Engineering' }, sort_order: 2, color: '#8B5CF6' },
    { name: 'Operations', sort_order: 2, color: '#10B981' },
  ],
});

const teams = defineDataset(Team, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Platform', lead: 'linus@example.com', capacity_hours: 200 },
    { name: 'Experience', lead: 'ada@example.com', capacity_hours: 160 },
  ],
});

const memberships = defineDataset(ProjectMembership, {
  mode: 'insert',
  records: [
    { team: { externalId: 'Experience' }, project: { externalId: 'Website Relaunch' }, role: 'owner', allocation_percent: 80 },
    { team: { externalId: 'Platform' }, project: { externalId: 'Data Platform' }, role: 'owner', allocation_percent: 100 },
    { team: { externalId: 'Platform' }, project: { externalId: 'Website Relaunch' }, role: 'contributor', allocation_percent: 20 },
  ],
});

export const ShowcaseSeedData = [accounts, projects, tasks, categories, teams, memberships];
