// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/**
 * Territory Management Protocol
 * Defines a matrix reporting structure that exists parallel to the
 * business-unit hierarchy (ADR-0090 D3 — the org tree is `sys_business_unit`).
 *
 * USE CASE:
 * - Enterprise Sales Teams (Geo-based: "EMEA", "APAC")
 * - Industry Verticals (Industry-based: "Healthcare", "Financial")
 * - Strategic Accounts (Account-based: "Strategic Accounts")
 *
 * DIFFERENCE FROM THE BUSINESS-UNIT TREE:
 * - Business unit: Hierarchy of PEOPLE (org structure). Stable. HR-driven.
 * - Territory: Hierarchy of ACCOUNTS/REVENUE (Who owns which market). Flexible. Sales-driven.
 * - One User can be assigned to MANY Territories (Matrix).
 * - One User belongs to one primary business unit (Tree).
 */

import { lazySchema } from '../shared/lazy-schema';
export const TerritoryType = z.enum([
  'geography',      // Region/Country/City
  'industry',       // Vertical
  'named_account',  // Key Accounts
  'product_line'    // Product Specialty
]);

/**
 * Territory Model Schema
 * A container for a version of territory planning.
 * (e.g. "Fiscal Year 2024 Planning" vs "Fiscal Year 2025 Planning")
 */
export const TerritoryModelSchema = lazySchema(() => z.object({
  name: z.string().describe('Model Name (e.g. FY24 Planning)'),
  state: z.enum(['planning', 'active', 'archived']).default('planning'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}));

/**
 * Territory Node Schema
 * A single node in the territory tree.
 * 
 * **NAMING CONVENTION:**
 * Territory names are machine identifiers and must be lowercase snake_case.
 * 
 * @example Good territory names
 * - 'west_coast'
 * - 'emea_region'
 * - 'healthcare_vertical'
 * - 'strategic_accounts'
 * 
 * @example Bad territory names (will be rejected)
 * - 'WestCoast' (PascalCase)
 * - 'West Coast' (spaces)
 */
export const TerritorySchema = lazySchema(() => z.object({
  /** Identity */
  name: SnakeCaseIdentifierSchema.describe('Territory unique name (lowercase snake_case)'),
  label: z.string().describe('Territory Label (e.g. "West Coast")'),
  
  /** Structure */
  modelId: z.string().describe('Belongs to which Territory Model'),
  parent: z.string().optional().describe('Parent Territory'),
  type: TerritoryType.default('geography'),
  
  /** 
   * Assignment Rules (The "Magic")
   * How do accounts automatically fall into this territory?
   * e.g. "BillingCountry = 'US' AND BillingState = 'CA'"
   */
  assignmentRule: z.string().optional().describe('Criteria based assignment rule'),
  
  /**
   * User Assignment
   * Users assigned to work this territory.
   */
  assignedUsers: z.array(z.string()).optional(),
  
  /** Access Level */
  accountAccess: z.enum(['read', 'edit']).default('read'),
  opportunityAccess: z.enum(['read', 'edit']).default('read'),
  caseAccess: z.enum(['read', 'edit']).default('read'),
}));

export type Territory = z.infer<typeof TerritorySchema>;
export type TerritoryModel = z.infer<typeof TerritoryModelSchema>;
