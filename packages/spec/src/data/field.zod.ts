// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SystemIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Field Type Enum
 */
import { lazySchema } from '../shared/lazy-schema';
export const FieldType = z.enum([
  // Core Text
  'text', 'textarea', 'email', 'url', 'phone', 'password',
  // Secret — reversible, encrypted-at-rest value (DB password, API key, token).
  // UNLIKE 'password' (a one-way hash owned by the auth subsystem), a 'secret'
  // is round-tripped: the engine encrypts it on write via the registered
  // ICryptoProvider, stores the ciphertext handle in `sys_secret`, persists only
  // an opaque ref on the row, and masks it on read. Fail-closed: no provider ⇒
  // writes throw rather than persist cleartext. See ADR (secret field channel).
  'secret',
  // Rich Content
  'markdown', 'html', 'richtext',
  // Numbers
  'number', 'currency', 'percent', 
  // Date & Time
  'date', 'datetime', 'time',
  // Logic
  'boolean', 'toggle', // Toggle is a distinct UI from checkbox
  // Selection
  'select',       // Single select dropdown
  'multiselect',  // Multi select (often tags)
  'radio',        // Radio group
  'checkboxes',   // Checkbox group
  // Relational
  'lookup', 'master_detail', // Dynamic reference
  'tree',         // Hierarchical reference
  // Media
  'image', 'file', 'avatar', 'video', 'audio',
  // Calculated / System
  'formula', 'summary', 'autonumber',
  // Embedded structured values (stored as JSON on the parent row — no separate table / FK)
  'composite',    // Single embedded sub-object with declared sub-fields  (≈ Strapi component / ACF group)
  'repeater',     // Repeating embedded sub-object array with declared sub-fields  (≈ Strapi repeatable component / ACF repeater)
  'record',       // Name-keyed map of embedded sub-objects (Record<string, SubObject>). Insertion order = display order. Used for collections where each item has a stable machine name (e.g. object.fields). See ADR-0007.
  // Enhanced Types
  'location',     // GPS coordinates
  'address',      // Structured address
  'code',         // Code editor (JSON/SQL/JS)
  'json',         // Structured JSON data (untyped escape hatch)
  'color',        // Color picker
  'rating',       // Star rating
  'slider',       // Numeric slider
  'signature',    // Digital signature
  'qrcode',       // QR code / Barcode
  'progress',     // Progress bar
  'tags',         // Simple tag list
  // AI/ML Types
  'vector',       // Vector embeddings for AI/ML (semantic search, RAG)
]);

export type FieldType = z.infer<typeof FieldType>;

/**
 * Select Option Schema
 * 
 * Defines option values for select/picklist fields.
 * 
 * **CRITICAL RULE**: The `value` field is a machine identifier that gets stored in the database.
 * It MUST be lowercase to avoid case-sensitivity issues in queries and comparisons.
 * 
 * @example Good
 * { label: 'New', value: 'new' }
 * { label: 'In Progress', value: 'in_progress' }
 * { label: 'Closed Won', value: 'closed_won' }
 * 
 * @example Bad (will be rejected)
 * { label: 'New', value: 'New' } // uppercase
 * { label: 'In Progress', value: 'In Progress' } // spaces and uppercase
 * { label: 'Closed Won', value: 'Closed_Won' } // mixed case
 */
export const SelectOptionSchema = lazySchema(() => z.object({
  label: z.string().describe('Display label (human-readable, any case allowed)'),
  value: SystemIdentifierSchema.describe('Stored value (lowercase machine identifier)'),
  color: z.string().optional().describe('Color code for badges/charts'),
  default: z.boolean().optional().describe('Is default option'),
}));

/**
 * Location Coordinates Schema
 * GPS coordinates for location field type
 */
export const LocationCoordinatesSchema = lazySchema(() => z.object({
  latitude: z.number().min(-90).max(90).describe('Latitude coordinate'),
  longitude: z.number().min(-180).max(180).describe('Longitude coordinate'),
  altitude: z.number().optional().describe('Altitude in meters'),
  accuracy: z.number().optional().describe('Accuracy in meters'),
}));

/**
 * Currency Configuration Schema
 * Configuration for currency field type supporting multi-currency
 * 
 * Note: Currency codes are validated by length only (3 characters) to support:
 * - Standard ISO 4217 codes (USD, EUR, CNY, etc.)
 * - Cryptocurrency codes (BTC, ETH, etc.)
 * - Custom business-specific codes
 * Stricter validation can be implemented at the application layer based on business requirements.
 */
export const CurrencyConfigSchema = lazySchema(() => z.object({
  precision: z.number().int().min(0).max(10).default(2).describe('Decimal precision (default: 2)'),
  currencyMode: z.enum(['dynamic', 'fixed']).default('dynamic').describe('Currency mode: dynamic (user selectable) or fixed (single currency)'),
  defaultCurrency: z.string().length(3).default('CNY').describe('Default or fixed currency code (ISO 4217, e.g., USD, CNY, EUR)'),
}));

/**
 * Currency Value Schema
 * Runtime value structure for currency fields
 * 
 * Note: Currency codes are validated by length only (3 characters) to support flexibility.
 * See CurrencyConfigSchema for details on currency code validation strategy.
 */
export const CurrencyValueSchema = lazySchema(() => z.object({
  value: z.number().describe('Monetary amount'),
  currency: z.string().length(3).describe('Currency code (ISO 4217)'),
}));

/**
 * Address Schema
 * Structured address for address field type
 */
export const AddressSchema = lazySchema(() => z.object({
  street: z.string().optional().describe('Street address'),
  city: z.string().optional().describe('City name'),
  state: z.string().optional().describe('State/Province'),
  postalCode: z.string().optional().describe('Postal/ZIP code'),
  country: z.string().optional().describe('Country name or code'),
  countryCode: z.string().optional().describe('ISO country code (e.g., US, GB)'),
  formatted: z.string().optional().describe('Formatted address string'),
}));

/**
 * Vector Configuration Schema
 * Configuration for vector field type supporting AI/ML embeddings
 * 
 * Vector fields store numerical embeddings for semantic search, similarity matching,
 * and Retrieval-Augmented Generation (RAG) workflows.
 * 
 * @example
 * // Text embeddings for semantic search
 * {
 *   dimensions: 1536,  // OpenAI text-embedding-ada-002
 *   distanceMetric: 'cosine',
 *   indexed: true
 * }
 * 
 * @example
 * // Image embeddings with normalization
 * {
 *   dimensions: 512,   // ResNet-50
 *   distanceMetric: 'euclidean',
 *   normalized: true,
 *   indexed: true
 * }
 */
export const VectorConfigSchema = lazySchema(() => z.object({
  dimensions: z.number().int().min(1).max(10000).describe('Vector dimensionality (e.g., 1536 for OpenAI embeddings)'),
  distanceMetric: z.enum(['cosine', 'euclidean', 'dotProduct', 'manhattan']).default('cosine').describe('Distance/similarity metric for vector search'),
  normalized: z.boolean().default(false).describe('Whether vectors are normalized (unit length)'),
  indexed: z.boolean().default(true).describe('Whether to create a vector index for fast similarity search'),
  indexType: z.enum(['hnsw', 'ivfflat', 'flat']).optional().describe('Vector index algorithm (HNSW for high accuracy, IVFFlat for large datasets)'),
}));

/**
 * File Attachment Configuration Schema
 * Configuration for file and attachment field types
 * 
 * Provides comprehensive file upload capabilities with:
 * - File type restrictions (allowed/blocked)
 * - File size limits (min/max)
 * - Virus scanning integration
 * - Storage provider integration
 * - Image-specific features (dimensions, thumbnails)
 * 
 * @example Basic file upload with size limit
 * {
 *   maxSize: 10485760,  // 10MB
 *   allowedTypes: ['.pdf', '.docx', '.xlsx'],
 *   virusScan: true
 * }
 * 
 * @example Image upload with validation
 * {
 *   maxSize: 5242880,  // 5MB
 *   allowedTypes: ['.jpg', '.jpeg', '.png', '.webp'],
 *   imageValidation: {
 *     maxWidth: 4096,
 *     maxHeight: 4096,
 *     generateThumbnails: true
 *   }
 * }
 */
export const FileAttachmentConfigSchema = lazySchema(() => z.object({
  /** File Size Limits */
  minSize: z.number().min(0).optional().describe('Minimum file size in bytes'),
  maxSize: z.number().min(1).optional().describe('Maximum file size in bytes (e.g., 10485760 = 10MB)'),
  
  /** File Type Restrictions */
  allowedTypes: z.array(z.string()).optional().describe('Allowed file extensions (e.g., [".pdf", ".docx", ".jpg"])'),
  blockedTypes: z.array(z.string()).optional().describe('Blocked file extensions (e.g., [".exe", ".bat", ".sh"])'),
  allowedMimeTypes: z.array(z.string()).optional().describe('Allowed MIME types (e.g., ["image/jpeg", "application/pdf"])'),
  blockedMimeTypes: z.array(z.string()).optional().describe('Blocked MIME types'),
  
  /** Virus Scanning */
  virusScan: z.boolean().default(false).describe('Enable virus scanning for uploaded files'),
  virusScanProvider: z.enum(['clamav', 'virustotal', 'metadefender', 'custom']).optional().describe('Virus scanning service provider'),
  virusScanOnUpload: z.boolean().default(true).describe('Scan files immediately on upload'),
  quarantineOnThreat: z.boolean().default(true).describe('Quarantine files if threat detected'),
  
  /** Storage Configuration */
  storageProvider: z.string().optional().describe('Object storage provider name (references ObjectStorageConfig)'),
  storageBucket: z.string().optional().describe('Target bucket name'),
  storagePrefix: z.string().optional().describe('Storage path prefix (e.g., "uploads/documents/")'),
  
  /** Image-Specific Validation */
  imageValidation: z.object({
    minWidth: z.number().min(1).optional().describe('Minimum image width in pixels'),
    maxWidth: z.number().min(1).optional().describe('Maximum image width in pixels'),
    minHeight: z.number().min(1).optional().describe('Minimum image height in pixels'),
    maxHeight: z.number().min(1).optional().describe('Maximum image height in pixels'),
    aspectRatio: z.string().optional().describe('Required aspect ratio (e.g., "16:9", "1:1")'),
    generateThumbnails: z.boolean().default(false).describe('Auto-generate thumbnails'),
    thumbnailSizes: z.array(z.object({
      name: z.string().describe('Thumbnail variant name (e.g., "small", "medium", "large")'),
      width: z.number().min(1).describe('Thumbnail width in pixels'),
      height: z.number().min(1).describe('Thumbnail height in pixels'),
      crop: z.boolean().default(false).describe('Crop to exact dimensions'),
    })).optional().describe('Thumbnail size configurations'),
    preserveMetadata: z.boolean().default(false).describe('Preserve EXIF metadata'),
    autoRotate: z.boolean().default(true).describe('Auto-rotate based on EXIF orientation'),
  }).optional().describe('Image-specific validation rules'),
  
  /** Upload Behavior */
  allowMultiple: z.boolean().default(false).describe('Allow multiple file uploads (overrides field.multiple)'),
  allowReplace: z.boolean().default(true).describe('Allow replacing existing files'),
  allowDelete: z.boolean().default(true).describe('Allow deleting uploaded files'),
  requireUpload: z.boolean().default(false).describe('Require at least one file when field is required'),
  
  /** Metadata Extraction */
  extractMetadata: z.boolean().default(true).describe('Extract file metadata (name, size, type, etc.)'),
  extractText: z.boolean().default(false).describe('Extract text content from documents (OCR/parsing)'),
  
  /** Versioning */
  versioningEnabled: z.boolean().default(false).describe('Keep previous versions of replaced files'),
  maxVersions: z.number().min(1).optional().describe('Maximum number of versions to retain'),
  
  /** Access Control */
  publicRead: z.boolean().default(false).describe('Allow public read access to uploaded files'),
  presignedUrlExpiry: z.number().min(60).max(604800).default(3600).describe('Presigned URL expiration in seconds (default: 1 hour)'),
}).refine((data) => {
  // Validate minSize is less than or equal to maxSize
  if (data.minSize !== undefined && data.maxSize !== undefined && data.minSize > data.maxSize) {
    return false;
  }
  return true;
}, {
  message: 'minSize must be less than or equal to maxSize',
}).refine((data) => {
  // Validate virusScanProvider requires virusScan to be enabled
  if (data.virusScanProvider !== undefined && data.virusScan !== true) {
    return false;
  }
  return true;
}, {
  message: 'virusScanProvider requires virusScan to be enabled',
}));

/**
 * Data Quality Rules Schema
 * Defines data quality validation and monitoring for fields
 * 
 * @example Unique SSN field with completeness requirement
 * {
 *   uniqueness: true,
 *   completeness: 0.95,  // 95% of records must have this field
 *   accuracy: {
 *     source: 'government_db',
 *     threshold: 0.98
 *   }
 * }
 */
export const DataQualityRulesSchema = lazySchema(() => z.object({
  /** Enforce uniqueness constraint */
  uniqueness: z.boolean().default(false).describe('Enforce unique values across all records'),
  
  /** Completeness ratio (0-1) indicating minimum percentage of non-null values */
  completeness: z.number().min(0).max(1).default(0).describe('Minimum ratio of non-null values (0-1, default: 0 = no requirement)'),
  
  /** Accuracy validation against authoritative source */
  accuracy: z.object({
    source: z.string().describe('Reference data source for validation (e.g., "api.verify.com", "master_data")'),
    threshold: z.number().min(0).max(1).describe('Minimum accuracy threshold (0-1, e.g., 0.95 = 95% match required)'),
  }).optional().describe('Accuracy validation configuration'),
}));

/**
 * Computed Field Caching Schema
 * Configuration for caching computed/formula field results
 * 
 * @example Cache product price with 1-hour TTL, invalidate on inventory changes
 * {
 *   enabled: true,
 *   ttl: 3600,
 *   invalidateOn: ['inventory.quantity', 'pricing.discount']
 * }
 */
export const ComputedFieldCacheSchema = lazySchema(() => z.object({
  /** Enable caching for this computed field */
  enabled: z.boolean().describe('Enable caching for computed field results'),
  
  /** Time-to-live in seconds */
  ttl: z.number().min(0).describe('Cache TTL in seconds (0 = no expiration)'),
  
  /** Array of field paths that trigger cache invalidation when changed */
  invalidateOn: z.array(z.string()).describe('Field paths that invalidate cache (e.g., ["inventory.quantity", "pricing.base_price"])'),
}));

/**
 * Field Schema - Best Practice Enterprise Pattern
 */
/**
 * Field Definition Schema
 * Defines the properties, type, and behavior of a single field (column) on an object.
 * 
 * @example Lookup Field
 * {
 *   name: "account_id",
 *   label: "Account",
 *   type: "lookup",
 *   reference: "accounts",
 *   required: true
 * }
 * 
 * @example Select Field
 * {
 *   name: "status",
 *   label: "Status",
 *   type: "select",
 *   options: [
 *     { label: "Open", value: "open" },
 *     { label: "Closed", value: "closed" }
 *   ],
 *   defaultValue: "open"
 * }
 */
export const FieldSchema = lazySchema(() => z.object({
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name (snake_case)').optional(),
  label: z.string().optional().describe('Human readable label'),
  type: FieldType.describe('Field Data Type'),
  description: z.string().optional().describe('Tooltip/Help text'),
  format: z.string().optional().describe('Format string (e.g. email, phone)'),

  /** Storage Layer Mapping */
  columnName: z.string().optional().describe('Physical column name in the target datasource. Defaults to the field key when not set.'),

  /** Database Constraints */
  required: z.boolean().default(false).describe('Is required'),
  searchable: z.boolean().default(false).describe('Is searchable'),
  multiple: z.boolean().default(false).describe('Allow multiple values (Stores as Array/JSON). Applicable for select, lookup, file, image.'),
  unique: z.boolean().default(false).describe('Is unique constraint'),
  defaultValue: z.unknown().optional().describe('Default value'),
  
  /** Text/String Constraints */
  maxLength: z.number().optional().describe('Max character length'),
  minLength: z.number().optional().describe('Min character length'),
  
  /** Number Constraints */
  precision: z.number().optional().describe('Total digits'),
  scale: z.number().optional().describe('Decimal places'),
  min: z.number().optional().describe('Minimum value'),
  max: z.number().optional().describe('Maximum value'),

  /** Selection Options */
  options: z.array(SelectOptionSchema).optional().describe('Static options for select/multiselect'),

  /**
   * Relationship Config
   * 
   * Used by `lookup` and `master_detail` field types to define cross-object references.
   * The `reference` property is **required** for these types — it identifies the target
   * object whose records this field links to. The engine uses `reference` during $expand
   * post-processing to resolve foreign key IDs into full related objects via batch queries.
   * 
   * For `master_detail` fields, the parent record controls the lifecycle of child records
   * (e.g., cascade delete). For `lookup` fields, the reference is a soft link.
   */
  reference: z.string().optional().describe(
    'Target object name (snake_case) for lookup/master_detail fields. '
    + 'Required for relationship types. Used by $expand to resolve foreign key IDs into full objects.'
  ),
  referenceFilters: z.array(z.string()).optional().describe('Filters applied to lookup dialogs (e.g. "active = true")'),
  deleteBehavior: z.enum(['set_null', 'cascade', 'restrict']).optional().default('set_null').describe('What happens if referenced record is deleted'),
  /**
   * Master-detail INLINE EDITING. On a child's `master_detail`/`lookup` field
   * (whose `reference` is the parent object), declare that "this child is
   * entered/edited inline within the parent's form". The parent's standard
   * create/edit form then renders the children and saves parent + children in
   * ONE atomic transaction — no form view config and no bespoke page. The intent
   * lives here in the data model; forms derive the UI.
   *
   * The value also selects the EDITING FORM FACTOR:
   *   - `true`   → auto: the UI picks `grid` or `form` from the child's shape
   *                (rich types / many fields → `form`, else `grid`).
   *   - `'grid'` → an editable line-item grid (fast bulk entry; thin children
   *                like invoice lines / order items).
   *   - `'form'` → a compact read-only list; "Add" / per-row edit opens the
   *                child's FULL form (fat children with rich types, e.g. long
   *                text, attachments, many fields).
   * Use for true line-item/composition children; leave off for associations
   * (comments, attachments) — surface those as detail-page related lists.
   */
  inlineEdit: z.union([z.boolean(), z.enum(['grid', 'form'])]).optional().describe('Edit these child records inline within the parent\'s form (atomic master-detail). true = auto-pick grid/form by child shape; \'grid\' = editable line-item grid; \'form\' = list + per-row full form.'),
  /** Optional section title for the inline grid (defaults to the child object label). */
  inlineTitle: z.string().optional().describe('Title for the inline master-detail grid'),
  /** Optional explicit grid columns for the inline editor (derived from the child object when omitted). */
  inlineColumns: z.array(z.any()).optional().describe('Explicit columns for the inline grid (derived from the child object when omitted)'),
  /** Optional numeric child field summed for the inline grid running total. */
  inlineAmountField: z.string().optional().describe('Numeric child field summed for the inline grid total'),

  /**
   * Detail-page RELATED LIST — the read-side mirror of `inlineEdit`. On a
   * child's `master_detail`/`lookup` field (whose `reference` is the parent),
   * this governs whether/how the child collection appears as a related list on
   * the parent's record DETAIL page. Owned children (`master_detail`) and
   * `lookup` children are shown by default (derived from the relationship);
   * set `relatedList: false` to suppress a child from the detail page (e.g.
   * noisy audit/association links you don't want surfaced). Where `inlineEdit`
   * pulls a child INTO the parent's entry form (write side), `relatedList`
   * controls its appearance on the parent's detail page (read side). The intent
   * lives here in the data model; the detail page derives the UI.
   */
  relatedList: z.boolean().optional().describe('Show this child collection as a related list on the parent\'s detail page (read-side mirror of inlineEdit). Defaults to shown for master_detail/lookup; set false to suppress.'),
  /** Optional section title for the detail-page related list (defaults to the child object label). */
  relatedListTitle: z.string().optional().describe('Title for the detail-page related list'),
  /** Optional explicit columns for the detail-page related list (derived from the child object when omitted). */
  relatedListColumns: z.array(z.any()).optional().describe('Explicit columns for the detail-page related list (derived from the child object when omitted)'),

  /** Calculation — CEL formula. Plain string accepted for back-compat; build emits canonical envelope. */
  expression: ExpressionInputSchema.optional().describe('Formula expression (CEL). e.g. F`record.amount * 0.1`'),
  summaryOperations: z.object({
    object: z.string().describe('Source child object name for roll-up'),
    field: z.string().describe('Field on child object to aggregate (ignored for count)'),
    function: z.enum(['count', 'sum', 'min', 'max', 'avg']).describe('Aggregation function to apply'),
    relationshipField: z.string().optional().describe('FK field on the child pointing back to this parent. Auto-detected from the child\'s lookup/master_detail field referencing this object when omitted; set explicitly only when the child has more than one such reference.'),
  }).optional().describe('Roll-up summary definition. The engine recomputes the value when child records are inserted/updated/deleted.'),

  /** Enhanced Field Type Configurations */
  // Pruned 2026-06 — per-type *display* knobs that were dead in both layers (no
  // runtime reader; renderers ignore them). See
  // docs/audits/2026-06-dead-surface-disposition-plan.md (P2 field prune): code
  // theme/lineNumbers, rating allowHalf, location displayMap/allowGeocoding, address
  // addressFormat, color colorFormat/allowAlpha/presetColors, slider showValue/marks,
  // barcode/qr barcodeFormat/qrErrorCorrection/displayValue/allowScanning.
  language: z.string().optional().describe('Programming language for syntax highlighting (e.g., javascript, python, sql)'),
  maxRating: z.number().optional().describe('Maximum rating value (default: 5)'),
  step: z.number().optional().describe('Step increment for slider (default: 1)'),

  // Currency field config
  currencyConfig: CurrencyConfigSchema.optional().describe('Configuration for currency field type'),

  // Vector field config
  vectorConfig: VectorConfigSchema.optional().describe('Configuration for vector field type (AI/ML embeddings)'),

  // File attachment field config
  fileAttachmentConfig: FileAttachmentConfigSchema.optional().describe('Configuration for file and attachment field types'),

  // Pruned 2026-06 (dead in both layers — aspirational governance with no runtime
  // consumer; encryption/masking implied at-rest protection that never happened —
  // the real channel is type:'secret'). See
  // docs/audits/2026-06-dead-surface-disposition-plan.md (P0/P2 field prune):
  // encryptionConfig, maskingRule, auditTrail, cached, dataQuality.

  /** Field Dependencies & Relationships */
  dependencies: z.array(z.string()).optional().describe('Array of field names that this field depends on (for formulas, visibility rules, etc.)'),

  /** Layout & Grouping */
  group: z.string().optional().describe('Field group name for organizing fields in forms and layouts (e.g., "contact_info", "billing", "system")'),

  /**
   * Conditional field rules (CEL predicates over `record`). Evaluated on BOTH
   * sides: the client form toggles the field's visibility / read-only / required
   * state live as the record changes (UX), and the server enforces
   * `requiredWhen` and ignores writes to a field whose `readonlyWhen` is TRUE
   * (so the rule can't be bypassed). e.g. `P\`record.status == 'paid'\``.
   */
  visibleWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — field is shown only when TRUE (else hidden). e.g. P`record.type == 'invoice'`"),
  readonlyWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — field is read-only when TRUE. e.g. P`record.status == 'paid'`"),
  requiredWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — field is required when TRUE. Canonical name for `conditionalRequired`."),

  /** Conditional Requirements
   *  @deprecated Alias of `requiredWhen` — kept for back-compat. */
  conditionalRequired: ExpressionInputSchema.optional().describe('Predicate (CEL) — field is required when TRUE. Alias of `requiredWhen`.'),

  /** Security & Visibility */
  hidden: z.boolean().default(false).describe('Hidden from default UI'),
  readonly: z.boolean().default(false).describe('Read-only in UI'),
  system: z.boolean().optional().describe('Auto-injected system/audit field (e.g. created_at, updated_by, organization_id). Tools that surface system fields separately from author-declared business fields should branch on this flag.'),
  sortable: z.boolean().optional().default(true).describe('Whether field is sortable in list views'),
  inlineHelpText: z.string().optional().describe('Help text displayed below the field in forms'),
  caseSensitive: z.boolean().optional().describe('Whether text comparisons are case-sensitive'),
  autonumberFormat: z.string().optional().describe('Auto-number display format pattern (e.g., "CASE-{0000}")'),
  /** Indexing */
  index: z.boolean().default(false).describe('Create standard database index'),
  externalId: z.boolean().default(false).describe('Is external ID for upsert operations'),
}));

export type Field = z.infer<typeof FieldSchema>;
export type SelectOption = z.infer<typeof SelectOptionSchema>;
export type LocationCoordinates = z.infer<typeof LocationCoordinatesSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type CurrencyConfig = z.infer<typeof CurrencyConfigSchema>;
export type CurrencyConfigInput = z.input<typeof CurrencyConfigSchema>;
export type CurrencyValue = z.infer<typeof CurrencyValueSchema>;
export type VectorConfig = z.infer<typeof VectorConfigSchema>;
export type VectorConfigInput = z.input<typeof VectorConfigSchema>;
export type FileAttachmentConfig = z.infer<typeof FileAttachmentConfigSchema>;
export type FileAttachmentConfigInput = z.input<typeof FileAttachmentConfigSchema>;
export type DataQualityRules = z.infer<typeof DataQualityRulesSchema>;
export type DataQualityRulesInput = z.input<typeof DataQualityRulesSchema>;
export type ComputedFieldCache = z.infer<typeof ComputedFieldCacheSchema>;

/**
 * Field Factory Helper
 */
export type FieldInput = Omit<Partial<Field>, 'type'>;

export const Field = {
  text: (config: FieldInput = {}) => ({ type: 'text', ...config } as const),
  textarea: (config: FieldInput = {}) => ({ type: 'textarea', ...config } as const),
  number: (config: FieldInput = {}) => ({ type: 'number', ...config } as const),
  boolean: (config: FieldInput = {}) => ({ type: 'boolean', ...config } as const),
  date: (config: FieldInput = {}) => ({ type: 'date', ...config } as const),
  datetime: (config: FieldInput = {}) => ({ type: 'datetime', ...config } as const),
  currency: (config: FieldInput = {}) => ({ type: 'currency', ...config } as const),
  percent: (config: FieldInput = {}) => ({ type: 'percent', ...config } as const),
  url: (config: FieldInput = {}) => ({ type: 'url', ...config } as const),
  email: (config: FieldInput = {}) => ({ type: 'email', ...config } as const),
  phone: (config: FieldInput = {}) => ({ type: 'phone', ...config } as const),
  image: (config: FieldInput = {}) => ({ type: 'image', ...config } as const),
  file: (config: FieldInput = {}) => ({ type: 'file', ...config } as const),
  avatar: (config: FieldInput = {}) => ({ type: 'avatar', ...config } as const),
  formula: (config: FieldInput = {}) => ({ type: 'formula', ...config } as const),
  summary: (config: FieldInput = {}) => ({ type: 'summary', ...config } as const),
  autonumber: (config: FieldInput = {}) => ({ type: 'autonumber', ...config } as const),
  markdown: (config: FieldInput = {}) => ({ type: 'markdown', ...config } as const),
  html: (config: FieldInput = {}) => ({ type: 'html', ...config } as const),
  password: (config: FieldInput = {}) => ({ type: 'password', ...config } as const),
  /**
   * Secret field — reversible encrypted-at-rest value (DB password, API key,
   * token). Encrypted on write to `sys_secret` via the registered
   * ICryptoProvider; only an opaque ref is persisted on the row; masked on
   * read. Distinct from `password` (one-way hash, owned by the auth subsystem).
   */
  secret: (config: FieldInput = {}) => ({ type: 'secret', ...config } as const),
  
  /**
   * Select field helper with backward-compatible API
   * 
   * Automatically converts option values to lowercase to enforce naming conventions.
   * 
   * @example Old API (array first) - auto-converts to lowercase
   * Field.select(['High', 'Low'], { label: 'Priority' })
   * // Results in: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }]
   * 
   * @example New API (config object) - enforces lowercase
   * Field.select({ options: [{label: 'High', value: 'high'}], label: 'Priority' })
   * 
   * @example Multi-word values - converts to snake_case
   * Field.select(['In Progress', 'Closed Won'], { label: 'Status' })
   * // Results in: [{ label: 'In Progress', value: 'in_progress' }, { label: 'Closed Won', value: 'closed_won' }]
   */
  select: (optionsOrConfig: SelectOption[] | string[] | FieldInput & { options: SelectOption[] | string[] }, config?: FieldInput) => {
    // Helper function to convert string to lowercase snake_case
    const toSnakeCase = (str: string): string => {
      return str
        .toLowerCase()
        .replace(/\s+/g, '_')  // Replace spaces with underscores
        .replace(/[^a-z0-9_]/g, ''); // Remove invalid characters (keeping underscores only)
    };

    // Support both old and new signatures:
    // Old: Field.select(['a', 'b'], { label: 'X' })
    // New: Field.select({ options: [{label: 'A', value: 'a'}], label: 'X' })
    let options: SelectOption[];
    let finalConfig: FieldInput;
    
    if (Array.isArray(optionsOrConfig)) {
      // Old signature: array as first param
      options = optionsOrConfig.map(o => 
        typeof o === 'string' 
          ? { label: o, value: toSnakeCase(o) }  // Auto-convert string to snake_case
          : { ...o, value: o.value.toLowerCase() }  // Ensure value is lowercase
      );
      finalConfig = config || {};
    } else {
      // New signature: config object with options
      options = (optionsOrConfig.options || []).map(o => 
        typeof o === 'string' 
          ? { label: o, value: toSnakeCase(o) }  // Auto-convert string to snake_case
          : { ...o, value: o.value.toLowerCase() }  // Ensure value is lowercase
      );
      // Remove options from config to avoid confusion
      const { options: _, ...restConfig } = optionsOrConfig;
      finalConfig = restConfig;
    }
    
    return { type: 'select', options, ...finalConfig } as const;
  },

  
  lookup: (reference: string, config: FieldInput = {}) => ({ 
    type: 'lookup', 
    reference, 
    ...config 
  } as const),
  
  masterDetail: (reference: string, config: FieldInput = {}) => ({
    type: 'master_detail',
    reference,
    ...config
  } as const),

  // Enhanced Field Type Helpers
  location: (config: FieldInput = {}) => ({ 
    type: 'location', 
    ...config 
  } as const),
  
  address: (config: FieldInput = {}) => ({ 
    type: 'address', 
    ...config 
  } as const),
  
  richtext: (config: FieldInput = {}) => ({ 
    type: 'richtext', 
    ...config 
  } as const),
  
  code: (language?: string, config: FieldInput = {}) => ({ 
    type: 'code', 
    language,
    ...config 
  } as const),
  
  color: (config: FieldInput = {}) => ({ 
    type: 'color', 
    ...config 
  } as const),
  
  rating: (maxRating: number = 5, config: FieldInput = {}) => ({ 
    type: 'rating', 
    maxRating,
    ...config 
  } as const),
  
  signature: (config: FieldInput = {}) => ({ 
    type: 'signature', 
    ...config 
  } as const),
  
  slider: (config: FieldInput = {}) => ({ 
    type: 'slider', 
    ...config 
  } as const),
  
  qrcode: (config: FieldInput = {}) => ({ 
    type: 'qrcode', 
    ...config 
  } as const),
  
  json: (config: FieldInput = {}) => ({ 
    type: 'json', 
    ...config 
  } as const),
  
  vector: (dimensions: number, config: FieldInput = {}) => ({ 
    type: 'vector', 
    vectorConfig: {
      dimensions,
      distanceMetric: 'cosine' as const,
      normalized: false,
      indexed: true,
      ...config.vectorConfig
    },
    ...config 
  } as const),
};
