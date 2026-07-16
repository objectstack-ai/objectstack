// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Permission Protocol Exports
 * 
 * Fine-grained Access Control
 * - Permission Sets (CRUD + Field-Level Security)
 * - Sharing Rules (Record Ownership)
 * - Territory Management (Geographic/Hierarchical)
 * - Row-Level Security (RLS - PostgreSQL-style)
 */

export * from './permission.zod';
export * from './permission.form';
export * from './capabilities';
export * from './high-privilege';
export * from './public-form';
export * from './explain.zod';
export * from './sharing.zod';
export * from './territory.zod';
export * from './rls.zod';
