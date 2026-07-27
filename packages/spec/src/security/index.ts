// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Permission Protocol Exports
 * 
 * Fine-grained Access Control
 * - Permission Sets (CRUD + Field-Level Security)
 * - Sharing Rules (Record Ownership)
 * - Row-Level Security (RLS - PostgreSQL-style)
 *
 * [ADR-0105 D11] Territory Management was removed (enforce-or-remove, ADR-0049):
 * the schemas had no runtime object, stack field, or resolver. Matrix
 * requirements are served today by multi-position × business-unit anchoring; a
 * generalized dimension-security module will arrive with its own ADR.
 */

export * from './permission.zod';
export * from './permission.form';
export * from './capabilities';
export * from './high-privilege';
export * from './public-form';
export * from './explain.zod';
export * from './sharing.zod';
export * from './rls.zod';
export * from './tenancy-posture';
