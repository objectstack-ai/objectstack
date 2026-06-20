// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ⚠️ EXPERIMENTAL — NOT ENFORCED (ADR-0056). Field-level encryption is declared but
// no runtime crypto provider reads this config to encrypt/decrypt at rest.
// Authoring it does NOT change behaviour (roadmap M2+; per ADR-0049).

/**
 * Field-level encryption protocol
 * GDPR/HIPAA/PCI-DSS compliant
 */
import { lazySchema } from '../shared/lazy-schema';
export const EncryptionAlgorithmSchema = lazySchema(() => z.enum([
  'aes-256-gcm',
  'aes-256-cbc',
  'chacha20-poly1305',
]).describe('Supported encryption algorithm'));

export type EncryptionAlgorithm = z.infer<typeof EncryptionAlgorithmSchema>;

export const KeyManagementProviderSchema = lazySchema(() => z.enum([
  'local',
  'aws-kms',
  'azure-key-vault',
  'gcp-kms',
  'hashicorp-vault',
]).describe('Key management service provider'));

export type KeyManagementProvider = z.infer<typeof KeyManagementProviderSchema>;

export const KeyRotationPolicySchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable automatic key rotation'),
  frequencyDays: z.number().min(1).default(90).describe('Rotation frequency in days'),
  retainOldVersions: z.number().default(3).describe('Number of old key versions to retain'),
  autoRotate: z.boolean().default(true).describe('Automatically rotate without manual approval'),
}).describe('Policy for automatic encryption key rotation'));

export type KeyRotationPolicy = z.infer<typeof KeyRotationPolicySchema>;
export type KeyRotationPolicyInput = z.input<typeof KeyRotationPolicySchema>;

export const EncryptionConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable field-level encryption'),
  algorithm: EncryptionAlgorithmSchema.default('aes-256-gcm').describe('Encryption algorithm'),
  keyManagement: z.object({
    provider: KeyManagementProviderSchema.describe('Key management service provider'),
    keyId: z.string().optional().describe('Key identifier in the provider'),
    rotationPolicy: KeyRotationPolicySchema.optional().describe('Key rotation policy'),
  }).describe('Key management configuration'),
  scope: z.enum(['field', 'record', 'table', 'database']).describe('Encryption scope level'),
  deterministicEncryption: z.boolean().default(false).describe('Allows equality queries on encrypted data'),
  searchableEncryption: z.boolean().default(false).describe('Allows search on encrypted data'),
}).describe('Field-level encryption configuration'));

export type EncryptionConfig = z.infer<typeof EncryptionConfigSchema>;
export type EncryptionConfigInput = z.input<typeof EncryptionConfigSchema>;

export const FieldEncryptionSchema = lazySchema(() => z.object({
  fieldName: z.string().describe('Name of the field to encrypt'),
  encryptionConfig: EncryptionConfigSchema.describe('Encryption settings for this field'),
  indexable: z.boolean().default(false).describe('Allow indexing on encrypted field'),
}).describe('Per-field encryption assignment'));

export type FieldEncryption = z.infer<typeof FieldEncryptionSchema>;
export type FieldEncryptionInput = z.input<typeof FieldEncryptionSchema>;
