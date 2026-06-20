// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ⚠️ EXPERIMENTAL — NOT ENFORCED (ADR-0056). Data-masking rules are declared but no
// redaction layer applies them — Field-Level Security (PermissionSet.fields) is the
// enforced field-visibility mechanism today. Authoring masking does NOT change
// behaviour (roadmap M2+; per ADR-0049).

/**
 * Data masking protocol for PII protection
 */
import { lazySchema } from '../shared/lazy-schema';
export const MaskingStrategySchema = lazySchema(() => z.enum([
  'redact',       // Complete redaction: ****
  'partial',      // Partial masking: 138****5678
  'hash',         // Hash value: sha256(value)
  'tokenize',     // Tokenization: token-12345
  'randomize',    // Randomize: generate random value
  'nullify',      // Null value: null
  'substitute',   // Substitute with dummy data
]).describe('Data masking strategy for PII protection'));

export type MaskingStrategy = z.infer<typeof MaskingStrategySchema>;

export const MaskingRuleSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name to apply masking to'),
  strategy: MaskingStrategySchema.describe('Masking strategy to use'),
  pattern: z.string().optional().describe('Regex pattern for partial masking'),
  preserveFormat: z.boolean().default(true).describe('Keep the original data format after masking'),
  preserveLength: z.boolean().default(true).describe('Keep the original data length after masking'),
  roles: z.array(z.string()).optional().describe('Roles that see masked data'),
  exemptRoles: z.array(z.string()).optional().describe('Roles that see unmasked data'),
}).describe('Masking rule for a single field'));

export type MaskingRule = z.infer<typeof MaskingRuleSchema>;
export type MaskingRuleInput = z.input<typeof MaskingRuleSchema>;

export const MaskingConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable data masking'),
  rules: z.array(MaskingRuleSchema).describe('List of field-level masking rules'),
  auditUnmasking: z.boolean().default(true).describe('Log when masked data is accessed unmasked'),
}).describe('Top-level data masking configuration for PII protection'));

export type MaskingConfig = z.infer<typeof MaskingConfigSchema>;
export type MaskingConfigInput = z.input<typeof MaskingConfigSchema>;
