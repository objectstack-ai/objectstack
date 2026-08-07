// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Document Version Schema
 * 
 * Represents a single version of a document in a version-controlled system.
 * Each version is immutable and maintains its own metadata and download URL.
 * 
 * @example
 * ```json
 * {
 *   "versionNumber": 2,
 *   "createdAt": 1704067200000,
 *   "createdBy": "user_123",
 *   "size": 2048576,
 *   "checksum": "a1b2c3d4e5f6",
 *   "downloadUrl": "https://storage.example.com/docs/v2/file.pdf",
 *   "isLatest": true
 * }
 * ```
 */
import { lazySchema } from '../shared/lazy-schema';
export const DocumentVersionSchema = lazySchema(() => z.object({
  /**
   * Sequential version number (increments with each new version)
   */
  versionNumber: z.number().describe('Version number'),

  /**
   * Timestamp when this version was created (Unix milliseconds)
   */
  createdAt: z.number().describe('Creation timestamp'),

  /**
   * User ID who created this version
   */
  createdBy: z.string().describe('Creator user ID'),

  /**
   * File size in bytes
   */
  size: z.number().describe('File size in bytes'),

  /**
   * Checksum/hash of the file content (for integrity verification)
   */
  checksum: z.string().describe('File checksum'),

  /**
   * URL to download this specific version
   */
  downloadUrl: z.string().url().describe('Download URL'),

  /**
   * Whether this is the latest version
   * @default false
   */
  isLatest: z.boolean().optional().default(false).describe('Is latest version'),
}));

/**
 * Document Template Schema
 * 
 * Defines a reusable document template with dynamic placeholders.
 * Templates can be used to generate documents with variable content.
 * 
 * @example
 * ```json
 * {
 *   "id": "contract-template",
 *   "name": "Service Agreement",
 *   "description": "Standard service agreement template",
 *   "fileUrl": "https://example.com/templates/contract.docx",
 *   "fileType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 *   "placeholders": [
 *     {
 *       "key": "client_name",
 *       "label": "Client Name",
 *       "type": "text",
 *       "required": true
 *     },
 *     {
 *       "key": "contract_date",
 *       "label": "Contract Date",
 *       "type": "date",
 *       "required": true
 *     }
 *   ]
 * }
 * ```
 */
export const DocumentTemplateSchema = lazySchema(() => z.object({
  /**
   * Unique identifier for the template
   */
  id: z.string().describe('Template ID'),

  /**
   * Human-readable name of the template
   */
  name: z.string().describe('Template name'),

  /**
   * Optional description of the template's purpose
   */
  description: z.string().optional().describe('Template description'),

  /**
   * URL to the template file
   */
  fileUrl: z.string().url().describe('Template file URL'),

  /**
   * MIME type of the template file
   */
  fileType: z.string().describe('File MIME type'),

  /**
   * List of dynamic placeholders in the template
   */
  placeholders: z.array(z.object({
    /**
     * Placeholder identifier (used in template)
     */
    key: z.string().describe('Placeholder key'),

    /**
     * Human-readable label for the placeholder
     */
    label: z.string().describe('Placeholder label'),

    /**
     * Data type of the placeholder value
     */
    type: z.enum(['text', 'number', 'date', 'image']).describe('Placeholder type'),

    /**
     * Whether this placeholder must be filled
     * @default false
     */
    required: z.boolean().optional().default(false).describe('Is required'),
  })).describe('Template placeholders'),
}));

/**
 * E-Signature Configuration Schema
 * 
 * Configuration for electronic signature workflows.
 * Supports integration with popular e-signature providers.
 * 
 * @example
 * ```json
 * {
 *   "provider": "docusign",
 *   "enabled": true,
 *   "signers": [
 *     {
 *       "email": "client@example.com",
 *       "name": "John Doe",
 *       "role": "Client",
 *       "order": 1
 *     },
 *     {
 *       "email": "manager@example.com",
 *       "name": "Jane Smith",
 *       "role": "Manager",
 *       "order": 2
 *     }
 *   ],
 *   "expirationDays": 30,
 *   "reminderDays": 7
 * }
 * ```
 */
export const ESignatureConfigSchema = lazySchema(() => z.object({
  /**
   * E-signature service provider
   */
  provider: z.enum(['docusign', 'adobe-sign', 'hellosign', 'custom']).describe('E-signature provider'),

  /**
   * Whether e-signature is enabled for this document
   * @default false
   */
  enabled: z.boolean().optional().default(false).describe('E-signature enabled'),

  /**
   * List of signers in signing order
   */
  signers: z.array(z.object({
    /**
     * Signer's email address
     */
    email: z.string().email().describe('Signer email'),

    /**
     * Signer's full name
     */
    name: z.string().describe('Signer name'),

    /**
     * Signer's role in the document
     */
    role: z.string().describe('Signer role'),

    /**
     * Signing order (lower numbers sign first)
     */
    order: z.number().describe('Signing order'),
  })).describe('Document signers'),

  /**
   * Days until signature request expires
   * @default 30
   */
  expirationDays: z.number().optional().default(30).describe('Expiration days'),

  /**
   * Days between reminder emails
   * @default 7
   */
  reminderDays: z.number().optional().default(7).describe('Reminder interval days'),
}));

/**
 * Document Schema
 * 
 * Comprehensive document management protocol supporting versioning,
 * templates, e-signatures, and access control.
 * 
 * @example
 * ```json
 * {
 *   "id": "doc_123",
 *   "name": "Service Agreement 2024",
 *   "description": "Annual service agreement",
 *   "fileType": "application/pdf",
 *   "fileSize": 1048576,
 *   "category": "contracts",
 *   "tags": ["legal", "2024", "services"],
 *   "versioning": {
 *     "enabled": true,
 *     "versions": [
 *       {
 *         "versionNumber": 1,
 *         "createdAt": 1704067200000,
 *         "createdBy": "user_123",
 *         "size": 1048576,
 *         "checksum": "abc123",
 *         "downloadUrl": "https://example.com/docs/v1.pdf",
 *         "isLatest": true
 *       }
 *     ],
 *     "majorVersion": 1,
 *     "minorVersion": 0
 *   },
 *   "access": {
 *     "isPublic": false,
 *     "sharedWith": ["user_456", "team_789"],
 *     "expiresAt": 1735689600000
 *   },
 *   "metadata": {
 *     "author": "John Doe",
 *     "department": "Legal"
 *   }
 * }
 * ```
 */
export const DocumentSchema = lazySchema(() => z.object({
  /**
   * Unique document identifier
   */
  id: z.string().describe('Document ID'),

  /**
   * Document name
   */
  name: z.string().describe('Document name'),

  /**
   * Optional document description
   */
  description: z.string().optional().describe('Document description'),

  /**
   * MIME type of the document
   */
  fileType: z.string().describe('File MIME type'),

  /**
   * File size in bytes
   */
  fileSize: z.number().describe('File size in bytes'),

  /**
   * Document category for organization
   */
  category: z.string().optional().describe('Document category'),

  /**
   * Tags for searchability and organization
   */
  tags: z.array(z.string()).optional().describe('Document tags'),

  /**
   * Version control configuration
   */
  versioning: z.object({
    /**
     * Whether versioning is enabled
     */
    enabled: z.boolean().describe('Versioning enabled'),

    /**
     * List of all document versions
     */
    versions: z.array(DocumentVersionSchema).describe('Version history'),

    /**
     * Current major version number
     */
    majorVersion: z.number().describe('Major version'),

    /**
     * Current minor version number
     */
    minorVersion: z.number().describe('Minor version'),
  }).optional().describe('Version control'),

  /**
   * Template configuration (if document is generated from template)
   */
  template: DocumentTemplateSchema.optional().describe('Document template'),

  /**
   * E-signature configuration
   */
  eSignature: ESignatureConfigSchema.optional().describe('E-signature config'),

  /**
   * Access control settings
   */
  access: z.object({
    /**
     * Whether document is publicly accessible
     * @default false
     */
    isPublic: z.boolean().optional().default(false).describe('Public access'),

    /**
     * List of user/team IDs with access
     */
    sharedWith: z.array(z.string()).optional().describe('Shared with'),

    /**
     * Timestamp when access expires (Unix milliseconds)
     */
    expiresAt: z.number().optional().describe('Access expiration'),
  }).optional().describe('Access control'),

  /**
   * Custom metadata fields
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata'),
}));

// Type exports
export type Document = z.infer<typeof DocumentSchema>;
/** Post-parse shape of {@link Document} — defaults applied, transforms run (ADR-0122). */
export type DocumentParsed = z.infer<typeof DocumentSchema>;
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;
/** Post-parse shape of {@link DocumentVersion} — defaults applied, transforms run (ADR-0122). */
export type DocumentVersionParsed = z.infer<typeof DocumentVersionSchema>;
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;
/** Post-parse shape of {@link DocumentTemplate} — defaults applied, transforms run (ADR-0122). */
export type DocumentTemplateParsed = z.infer<typeof DocumentTemplateSchema>;
export type ESignatureConfig = z.infer<typeof ESignatureConfigSchema>;
/** Post-parse shape of {@link ESignatureConfig} — defaults applied, transforms run (ADR-0122). */
export type ESignatureConfigParsed = z.infer<typeof ESignatureConfigSchema>;
