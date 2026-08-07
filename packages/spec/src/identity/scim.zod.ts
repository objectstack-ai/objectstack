// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # SCIM 2.0 Protocol Implementation
 * 
 * System for Cross-domain Identity Management (SCIM) 2.0 specification
 * implementation for ObjectStack.
 * 
 * ## Overview
 * 
 * SCIM 2.0 is an HTTP-based protocol for managing user and group identities
 * across domains. It provides a standardized REST API for user provisioning,
 * de-provisioning, and synchronization.
 * 
 * ## Use Cases
 * 
 * 1. **Enterprise SSO Integration**
 *    - Integrate with Okta, Azure AD, OneLogin
 *    - Automatic user provisioning from corporate directory
 *    - Just-in-Time (JIT) user creation on first login
 * 
 * 2. **User Lifecycle Management**
 *    - Automatically create users when they join organization
 *    - Update user attributes when they change roles
 *    - Deactivate users when they leave organization
 * 
 * 3. **Group/Department Synchronization**
 *    - Sync organizational structure from AD/LDAP
 *    - Maintain group memberships automatically
 *    - Map corporate roles to application permissions
 * 
 * 4. **Compliance & Audit**
 *    - Maintain accurate user directory
 *    - Track all identity changes
 *    - Meet SOX/HIPAA requirements for user management
 * 
 * ## Specification References
 * 
 * - **RFC 7643**: SCIM Core Schema
 * - **RFC 7644**: SCIM Protocol
 * - **RFC 7642**: SCIM Requirements
 * 
 * ## Industry Implementations
 * 
 * - **Okta**: Leading SCIM provider
 * - **Azure AD**: Microsoft's identity platform
 * - **OneLogin**: Enterprise SSO provider
 * - **Google Workspace**: Google's identity management
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7643
 * @see https://datatracker.ietf.org/doc/html/rfc7644
 */

/**
 * SCIM Schema URIs
 * Standard schema identifiers defined in RFC 7643
 */
import { lazySchema } from '../shared/lazy-schema';
export const SCIM_SCHEMAS = {
  USER: 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  ENTERPRISE_USER: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  RESOURCE_TYPE: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  SERVICE_PROVIDER_CONFIG: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  SCHEMA: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
  LIST_RESPONSE: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  PATCH_OP: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  BULK_REQUEST: 'urn:ietf:params:scim:api:messages:2.0:BulkRequest',
  BULK_RESPONSE: 'urn:ietf:params:scim:api:messages:2.0:BulkResponse',
  ERROR: 'urn:ietf:params:scim:api:messages:2.0:Error',
} as const;

/**
 * SCIM Meta Schema
 * Common metadata for all SCIM resources
 */
export const SCIMMetaSchema = lazySchema(() => z.object({
  /**
   * Resource type name
   * @example "User", "Group"
   */
  resourceType: z.string()
    .optional()
    .describe('Resource type'),

  /**
   * Resource creation timestamp (ISO 8601)
   */
  created: z.string()
    .datetime()
    .optional()
    .describe('Creation timestamp'),

  /**
   * Last modification timestamp (ISO 8601)
   */
  lastModified: z.string()
    .datetime()
    .optional()
    .describe('Last modification timestamp'),

  /**
   * Resource location URI
   * Absolute URL to the resource
   */
  location: z.string()
    .url()
    .optional()
    .describe('Resource location URI'),

  /**
   * Entity tag for optimistic concurrency control
   * Used with If-Match header for conditional updates
   */
  version: z.string()
    .optional()
    .describe('Entity tag (ETag) for concurrency control'),
}));

export type SCIMMeta = z.input<typeof SCIMMetaSchema>;

/**
 * SCIM Name Schema
 * Structured name components
 */
export const SCIMNameSchema = lazySchema(() => z.object({
  /**
   * Full name formatted for display
   * @example "Ms. Barbara Jane Jensen III"
   */
  formatted: z.string()
    .optional()
    .describe('Formatted full name'),

  /**
   * Family name (surname)
   * @example "Jensen"
   */
  familyName: z.string()
    .optional()
    .describe('Family name (last name)'),

  /**
   * Given name (first name)
   * @example "Barbara"
   */
  givenName: z.string()
    .optional()
    .describe('Given name (first name)'),

  /**
   * Middle name
   * @example "Jane"
   */
  middleName: z.string()
    .optional()
    .describe('Middle name'),

  /**
   * Honorific prefix
   * @example "Ms.", "Dr.", "Prof."
   */
  honorificPrefix: z.string()
    .optional()
    .describe('Honorific prefix (Mr., Ms., Dr.)'),

  /**
   * Honorific suffix
   * @example "III", "Jr.", "Sr."
   */
  honorificSuffix: z.string()
    .optional()
    .describe('Honorific suffix (Jr., Sr.)'),
}));

export type SCIMName = z.input<typeof SCIMNameSchema>;

/**
 * SCIM Email Schema
 * Multi-valued email address
 */
export const SCIMEmailSchema = lazySchema(() => z.object({
  /**
   * Email address value
   */
  value: z.string()
    .email()
    .describe('Email address'),

  /**
   * Email type
   * @example "work", "home", "other"
   */
  type: z.enum(['work', 'home', 'other'])
    .optional()
    .describe('Email type'),

  /**
   * Display label for the email
   */
  display: z.string()
    .optional()
    .describe('Display label'),

  /**
   * Whether this is the primary email
   */
  primary: z.boolean()
    .optional()
    .default(false)
    .describe('Primary email indicator'),
}));

export type SCIMEmail = z.input<typeof SCIMEmailSchema>;
/** Post-parse shape of {@link SCIMEmail} — defaults applied, transforms run (ADR-0122). */
export type SCIMEmailParsed = z.infer<typeof SCIMEmailSchema>;

/**
 * SCIM Phone Number Schema
 * Multi-valued phone number
 */
export const SCIMPhoneNumberSchema = lazySchema(() => z.object({
  /**
   * Phone number value
   * Format is not enforced to support international numbers
   */
  value: z.string()
    .describe('Phone number'),

  /**
   * Phone type
   */
  type: z.enum(['work', 'home', 'mobile', 'fax', 'pager', 'other'])
    .optional()
    .describe('Phone number type'),

  /**
   * Display label for the phone number
   */
  display: z.string()
    .optional()
    .describe('Display label'),

  /**
   * Whether this is the primary phone
   */
  primary: z.boolean()
    .optional()
    .default(false)
    .describe('Primary phone indicator'),
}));

export type SCIMPhoneNumber = z.input<typeof SCIMPhoneNumberSchema>;
/** Post-parse shape of {@link SCIMPhoneNumber} — defaults applied, transforms run (ADR-0122). */
export type SCIMPhoneNumberParsed = z.infer<typeof SCIMPhoneNumberSchema>;

/**
 * SCIM Address Schema
 * Multi-valued physical mailing address
 */
export const SCIMAddressSchema = lazySchema(() => z.object({
  /**
   * Full mailing address formatted for display
   */
  formatted: z.string()
    .optional()
    .describe('Formatted address'),

  /**
   * Full street address
   */
  streetAddress: z.string()
    .optional()
    .describe('Street address'),

  /**
   * City or locality
   */
  locality: z.string()
    .optional()
    .describe('City/Locality'),

  /**
   * State or region
   */
  region: z.string()
    .optional()
    .describe('State/Region'),

  /**
   * Zip code or postal code
   */
  postalCode: z.string()
    .optional()
    .describe('Postal code'),

  /**
   * Country
   */
  country: z.string()
    .optional()
    .describe('Country'),

  /**
   * Address type
   */
  type: z.enum(['work', 'home', 'other'])
    .optional()
    .describe('Address type'),

  /**
   * Whether this is the primary address
   */
  primary: z.boolean()
    .optional()
    .default(false)
    .describe('Primary address indicator'),
}));

export type SCIMAddress = z.input<typeof SCIMAddressSchema>;
/** Post-parse shape of {@link SCIMAddress} — defaults applied, transforms run (ADR-0122). */
export type SCIMAddressParsed = z.infer<typeof SCIMAddressSchema>;

/**
 * SCIM Group Reference
 * Reference to a group the user belongs to
 */
export const SCIMGroupReferenceSchema = lazySchema(() => z.object({
  /**
   * Group identifier
   */
  value: z.string()
    .describe('Group ID'),

  /**
   * Direct reference to the group resource
   */
  $ref: z.string()
    .url()
    .optional()
    .describe('URI reference to the group'),

  /**
   * Human-readable group name
   */
  display: z.string()
    .optional()
    .describe('Group display name'),

  /**
   * Type of group
   */
  type: z.enum(['direct', 'indirect'])
    .optional()
    .describe('Membership type'),
}));

export type SCIMGroupReference = z.input<typeof SCIMGroupReferenceSchema>;

/**
 * SCIM Enterprise User Extension
 * Enterprise-specific user attributes
 */
export const SCIMEnterpriseUserSchema = lazySchema(() => z.object({
  /**
   * Employee number
   */
  employeeNumber: z.string()
    .optional()
    .describe('Employee number'),

  /**
   * Cost center
   */
  costCenter: z.string()
    .optional()
    .describe('Cost center'),

  /**
   * Organization unit
   */
  organization: z.string()
    .optional()
    .describe('Organization'),

  /**
   * Division
   */
  division: z.string()
    .optional()
    .describe('Division'),

  /**
   * Department
   */
  department: z.string()
    .optional()
    .describe('Department'),

  /**
   * Manager reference
   */
  manager: z.object({
    value: z.string().describe('Manager ID'),
    $ref: z.string().url().optional().describe('Manager URI'),
    displayName: z.string().optional().describe('Manager name'),
  })
    .optional()
    .describe('Manager reference'),
}));

export type SCIMEnterpriseUser = z.input<typeof SCIMEnterpriseUserSchema>;

/**
 * SCIM User Schema (Core)
 * Complete SCIM 2.0 User resource
 */
export const SCIMUserSchema = lazySchema(() => z.object({
  /**
   * SCIM schema URIs
   * Must include at minimum the core User schema URI
   */
  schemas: z.array(z.string())
    .min(1)
    .refine(
      (schemas) => schemas.includes(SCIM_SCHEMAS.USER),
      'Must include core User schema URI'
    )
    .default([SCIM_SCHEMAS.USER])
    .describe('SCIM schema URIs (must include User schema)'),

  /**
   * Unique identifier
   */
  id: z.string()
    .optional()
    .describe('Unique resource identifier'),

  /**
   * External identifier
   * Identifier from the provisioning client
   */
  externalId: z.string()
    .optional()
    .describe('External identifier from client system'),

  /**
   * Unique username
   * REQUIRED for user creation
   */
  userName: z.string()
    .describe('Unique username (REQUIRED)'),

  /**
   * Structured name
   */
  name: SCIMNameSchema
    .optional()
    .describe('Structured name components'),

  /**
   * Display name
   */
  displayName: z.string()
    .optional()
    .describe('Display name for UI'),

  /**
   * Nickname or casual name
   */
  nickName: z.string()
    .optional()
    .describe('Nickname'),

  /**
   * Profile URL
   */
  profileUrl: z.string()
    .url()
    .optional()
    .describe('Profile page URL'),

  /**
   * Job title
   */
  title: z.string()
    .optional()
    .describe('Job title'),

  /**
   * User type (employee, contractor, etc.)
   */
  userType: z.string()
    .optional()
    .describe('User type (employee, contractor)'),

  /**
   * Preferred language (ISO 639-1)
   */
  preferredLanguage: z.string()
    .optional()
    .describe('Preferred language (ISO 639-1)'),

  /**
   * Locale (e.g., en-US)
   */
  locale: z.string()
    .optional()
    .describe('Locale (e.g., en-US)'),

  /**
   * Timezone (e.g., America/Los_Angeles)
   */
  timezone: z.string()
    .optional()
    .describe('Timezone'),

  /**
   * Account active status
   */
  active: z.boolean()
    .optional()
    .default(true)
    .describe('Account active status'),

  /**
   * Password (write-only, never returned)
   */
  password: z.string()
    .optional()
    .describe('Password (write-only)'),

  /**
   * Email addresses (multi-valued)
   */
  emails: z.array(SCIMEmailSchema)
    .optional()
    .describe('Email addresses'),

  /**
   * Phone numbers (multi-valued)
   */
  phoneNumbers: z.array(SCIMPhoneNumberSchema)
    .optional()
    .describe('Phone numbers'),

  /**
   * Instant messaging addresses
   */
  ims: z.array(z.object({
    value: z.string(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  }))
    .optional()
    .describe('IM addresses'),

  /**
   * Photos (profile pictures)
   */
  photos: z.array(z.object({
    value: z.string().url(),
    type: z.enum(['photo', 'thumbnail']).optional(),
    primary: z.boolean().optional(),
  }))
    .optional()
    .describe('Photo URLs'),

  /**
   * Physical addresses
   */
  addresses: z.array(SCIMAddressSchema)
    .optional()
    .describe('Physical addresses'),

  /**
   * Group memberships
   */
  groups: z.array(SCIMGroupReferenceSchema)
    .optional()
    .describe('Group memberships'),

  /**
   * User entitlements
   */
  entitlements: z.array(z.object({
    value: z.string(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  }))
    .optional()
    .describe('Entitlements'),

  /**
   * User roles
   */
  roles: z.array(z.object({
    value: z.string(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  }))
    .optional()
    .describe('Roles'),

  /**
   * X509 certificates
   */
  x509Certificates: z.array(z.object({
    value: z.string(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  }))
    .optional()
    .describe('X509 certificates'),

  /**
   * Resource metadata
   */
  meta: SCIMMetaSchema
    .optional()
    .describe('Resource metadata'),

  /**
   * Enterprise user extension
   * Only present when enterprise extension is used
   */
  [SCIM_SCHEMAS.ENTERPRISE_USER]: SCIMEnterpriseUserSchema
    .optional()
    .describe('Enterprise user attributes'),
}).superRefine((data, ctx) => {
  // Validate that enterprise extension schema URI is present when extension data is provided
  const hasEnterpriseExtension = data[SCIM_SCHEMAS.ENTERPRISE_USER] != null;
  if (!hasEnterpriseExtension) {
    return;
  }

  const schemas = data.schemas || [];
  if (!schemas.includes(SCIM_SCHEMAS.ENTERPRISE_USER)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schemas'],
      message: `schemas must include "${SCIM_SCHEMAS.ENTERPRISE_USER}" when enterprise user extension attributes are present`,
    });
  }
}));

export type SCIMUser = z.input<typeof SCIMUserSchema>;
/** Post-parse shape of {@link SCIMUser} — defaults applied, transforms run (ADR-0122). */
export type SCIMUserParsed = z.infer<typeof SCIMUserSchema>;

/**
 * SCIM Member Reference
 * Reference to a member in a group
 */
export const SCIMMemberReferenceSchema = lazySchema(() => z.object({
  /**
   * Member identifier
   */
  value: z.string()
    .describe('Member ID'),

  /**
   * Direct reference to the member resource
   */
  $ref: z.string()
    .url()
    .optional()
    .describe('URI reference to the member'),

  /**
   * Member type (User or Group for nested groups)
   */
  type: z.enum(['User', 'Group'])
    .optional()
    .describe('Member type'),

  /**
   * Human-readable member name
   */
  display: z.string()
    .optional()
    .describe('Member display name'),
}));

export type SCIMMemberReference = z.input<typeof SCIMMemberReferenceSchema>;

/**
 * SCIM Group Schema
 * Complete SCIM 2.0 Group resource
 */
export const SCIMGroupSchema = lazySchema(() => z.object({
  /**
   * SCIM schema URIs
   * Must include at minimum the core Group schema URI
   */
  schemas: z.array(z.string())
    .min(1)
    .refine(
      (schemas) => schemas.includes(SCIM_SCHEMAS.GROUP),
      'Must include core Group schema URI'
    )
    .default([SCIM_SCHEMAS.GROUP])
    .describe('SCIM schema URIs (must include Group schema)'),

  /**
   * Unique identifier
   */
  id: z.string()
    .optional()
    .describe('Unique resource identifier'),

  /**
   * External identifier
   */
  externalId: z.string()
    .optional()
    .describe('External identifier from client system'),

  /**
   * Group display name
   * REQUIRED for group creation
   */
  displayName: z.string()
    .describe('Group display name (REQUIRED)'),

  /**
   * Group members
   */
  members: z.array(SCIMMemberReferenceSchema)
    .optional()
    .describe('Group members'),

  /**
   * Resource metadata
   */
  meta: SCIMMetaSchema
    .optional()
    .describe('Resource metadata'),
}));

export type SCIMGroup = z.input<typeof SCIMGroupSchema>;
/** Post-parse shape of {@link SCIMGroup} — defaults applied, transforms run (ADR-0122). */
export type SCIMGroupParsed = z.infer<typeof SCIMGroupSchema>;

/**
 * SCIM Resource Union Type
 * Known SCIM resource types for type-safe list responses
 */
export type SCIMResource = SCIMUser | SCIMGroup;

/**
 * SCIM List Response
 * Paginated list of resources
 * 
 * Generic type T allows for type-safe responses when the resource type is known.
 * For mixed resource types, use SCIMResource union.
 */
export const SCIMListResponseSchema = lazySchema(() => z.object({
  /**
   * SCIM schema URI
   */
  schemas: z.array(z.string())
    .min(1)
    .refine(
      (schemas) => schemas.includes(SCIM_SCHEMAS.LIST_RESPONSE),
      { message: `schemas must include ${SCIM_SCHEMAS.LIST_RESPONSE}` }
    )
    .default([SCIM_SCHEMAS.LIST_RESPONSE])
    .describe('SCIM schema URIs'),

  /**
   * Total number of results matching the query
   */
  totalResults: z.number()
    .int()
    .min(0)
    .describe('Total results count'),

  /**
   * Resources returned in this response
   * Use SCIMListResponseOf<T> for type-safe responses
   */
  Resources: z.array(z.union([SCIMUserSchema, SCIMGroupSchema, z.record(z.string(), z.unknown())]))
    .describe('Resources array (Users, Groups, or custom resources)'),

  /**
   * 1-based index of the first result
   */
  startIndex: z.number()
    .int()
    .min(1)
    .optional()
    .describe('Start index (1-based)'),

  /**
   * Number of resources per page
   */
  itemsPerPage: z.number()
    .int()
    .min(0)
    .optional()
    .describe('Items per page'),
}));

export type SCIMListResponse = z.input<typeof SCIMListResponseSchema>;
/** Post-parse shape of {@link SCIMListResponse} — defaults applied, transforms run (ADR-0122). */
export type SCIMListResponseParsed = z.infer<typeof SCIMListResponseSchema>;

/**
 * SCIM Error Response
 * Error response format
 */
export const SCIMErrorSchema = lazySchema(() => z.object({
  /**
   * SCIM schema URI
   */
  schemas: z.array(z.string())
    .min(1)
    .refine(
      (schemas) => schemas.includes(SCIM_SCHEMAS.ERROR),
      { message: `schemas must include ${SCIM_SCHEMAS.ERROR}` }
    )
    .default([SCIM_SCHEMAS.ERROR])
    .describe('SCIM schema URIs'),

  /**
   * HTTP status code
   */
  status: z.number()
    .int()
    .min(400)
    .max(599)
    .describe('HTTP status code'),

  /**
   * SCIM error type
   */
  scimType: z.enum([
    'invalidFilter',
    'tooMany',
    'uniqueness',
    'mutability',
    'invalidSyntax',
    'invalidPath',
    'noTarget',
    'invalidValue',
    'invalidVers',
    'sensitive',
  ])
    .optional()
    .describe('SCIM error type'),

  /**
   * Human-readable error description
   */
  detail: z.string()
    .optional()
    .describe('Error detail message'),
}));

export type SCIMError = z.input<typeof SCIMErrorSchema>;
/** Post-parse shape of {@link SCIMError} — defaults applied, transforms run (ADR-0122). */
export type SCIMErrorParsed = z.infer<typeof SCIMErrorSchema>;

/**
 * SCIM Patch Operation
 * For PATCH requests
 */
export const SCIMPatchOperationSchema = lazySchema(() => z.object({
  /**
   * Operation type
   */
  op: z.enum(['add', 'remove', 'replace'])
    .describe('Operation type'),

  /**
   * Attribute path to modify
   */
  path: z.string()
    .optional()
    .describe('Attribute path (optional for add)'),

  /**
   * Value to set
   */
  value: z.unknown()
    .optional()
    .describe('Value to set'),
}));

export type SCIMPatchOperation = z.input<typeof SCIMPatchOperationSchema>;

/**
 * SCIM Patch Request
 */
export const SCIMPatchRequestSchema = lazySchema(() => z.object({
  /**
   * SCIM schema URI
   */
  schemas: z.array(z.string())
    .min(1)
    .refine(
      (schemas) => schemas.includes(SCIM_SCHEMAS.PATCH_OP),
      { message: 'SCIM PATCH requests must include the PatchOp schema URI' }
    )
    .default([SCIM_SCHEMAS.PATCH_OP])
    .describe('SCIM schema URIs'),

  /**
   * Array of patch operations
   */
  Operations: z.array(SCIMPatchOperationSchema)
    .min(1)
    .describe('Patch operations'),
}));

export type SCIMPatchRequest = z.input<typeof SCIMPatchRequestSchema>;
/** Post-parse shape of {@link SCIMPatchRequest} — defaults applied, transforms run (ADR-0122). */
export type SCIMPatchRequestParsed = z.infer<typeof SCIMPatchRequestSchema>;

/**
 * Helper factory for creating SCIM resources
 */
export const SCIM = {
  /**
   * Create a basic SCIM user
   */
  user: (userName: string, email: string, givenName?: string, familyName?: string): SCIMUser => ({
    schemas: [SCIM_SCHEMAS.USER],
    userName,
    emails: [{ value: email, type: 'work', primary: true }],
    name: {
      givenName,
      familyName,
    },
    active: true,
  }),

  /**
   * Create a SCIM group
   */
  group: (displayName: string, members?: SCIMMemberReference[]): SCIMGroup => ({
    schemas: [SCIM_SCHEMAS.GROUP],
    displayName,
    members: members || [],
  }),

  /**
   * Create a list response
   */
  listResponse: <T>(resources: T[], totalResults?: number): SCIMListResponse => ({
    schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
    totalResults: totalResults ?? resources.length,
    Resources: resources as Array<SCIMResource | Record<string, any>>,
    startIndex: 1,
    itemsPerPage: resources.length,
  }),

  /**
   * Create an error response
   */
  error: (
    status: number,
    detail: string,
    scimType?: 'invalidFilter' | 'tooMany' | 'uniqueness' | 'mutability' | 
                'invalidSyntax' | 'invalidPath' | 'noTarget' | 'invalidValue' | 
                'invalidVers' | 'sensitive'
  ): SCIMError => ({
    schemas: [SCIM_SCHEMAS.ERROR],
    status,
    detail,
    scimType,
  }),
} as const;

// ─── SCIM 2.0 Bulk Operations (RFC 7644 §3.7) ──────────────────────────────

/**
 * SCIM Bulk Operation Schema
 * A single operation within a bulk request
 */
export const SCIMBulkOperationSchema = lazySchema(() => z.object({
  /** HTTP method for this operation */
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE'])
    .describe('HTTP method for the bulk operation'),

  /** Resource path (e.g. /Users, /Groups/{id}) */
  path: z.string()
    .describe('Resource endpoint path (e.g. /Users, /Groups/{id})'),

  /** Client-assigned identifier for cross-referencing operations */
  bulkId: z.string()
    .optional()
    .describe('Client-assigned ID for cross-referencing between operations'),

  /** Request body for POST/PUT/PATCH operations */
  data: z.record(z.string(), z.unknown())
    .optional()
    .describe('Request body for POST/PUT/PATCH operations'),

  /** ETag value for optimistic concurrency control */
  version: z.string()
    .optional()
    .describe('ETag for optimistic concurrency control'),
}));

export type SCIMBulkOperation = z.input<typeof SCIMBulkOperationSchema>;

/**
 * SCIM Bulk Request Schema
 * Batch multiple SCIM operations into a single HTTP request
 */
export const SCIMBulkRequestSchema = lazySchema(() => z.object({
  /** SCIM schema URI for bulk request */
  schemas: z.array(z.literal(SCIM_SCHEMAS.BULK_REQUEST))
    .default([SCIM_SCHEMAS.BULK_REQUEST])
    .describe('SCIM schema URIs (BulkRequest)'),

  /** Array of operations to execute */
  operations: z.array(SCIMBulkOperationSchema)
    .min(1)
    .describe('Bulk operations to execute (minimum 1)'),

  /** Stop processing after N errors */
  failOnErrors: z.number()
    .int()
    .optional()
    .describe('Stop processing after this many errors'),
}));

export type SCIMBulkRequest = z.input<typeof SCIMBulkRequestSchema>;
/** Post-parse shape of {@link SCIMBulkRequest} — defaults applied, transforms run (ADR-0122). */
export type SCIMBulkRequestParsed = z.infer<typeof SCIMBulkRequestSchema>;

/**
 * SCIM Bulk Response Operation Schema
 * Result of a single operation within a bulk response
 */
export const SCIMBulkResponseOperationSchema = lazySchema(() => z.object({
  /** HTTP method that was executed */
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE'])
    .describe('HTTP method that was executed'),

  /** Client-assigned bulk operation ID */
  bulkId: z.string()
    .optional()
    .describe('Client-assigned bulk operation ID'),

  /** URL of the created/modified resource */
  location: z.string()
    .optional()
    .describe('URL of the created or modified resource'),

  /** HTTP status code as string */
  status: z.string()
    .describe('HTTP status code as string (e.g. "201", "400")'),

  /** Response body, typically present for errors */
  response: z.unknown()
    .optional()
    .describe('Response body (typically present for errors)'),
}));

export type SCIMBulkResponseOperation = z.input<typeof SCIMBulkResponseOperationSchema>;

/**
 * SCIM Bulk Response Schema
 * Response to a bulk request containing results for each operation
 */
export const SCIMBulkResponseSchema = lazySchema(() => z.object({
  /** SCIM schema URI for bulk response */
  schemas: z.array(z.literal(SCIM_SCHEMAS.BULK_RESPONSE))
    .default([SCIM_SCHEMAS.BULK_RESPONSE])
    .describe('SCIM schema URIs (BulkResponse)'),

  /** Array of operation results */
  operations: z.array(SCIMBulkResponseOperationSchema)
    .describe('Results for each bulk operation'),
}));

export type SCIMBulkResponse = z.input<typeof SCIMBulkResponseSchema>;
/** Post-parse shape of {@link SCIMBulkResponse} — defaults applied, transforms run (ADR-0122). */
export type SCIMBulkResponseParsed = z.infer<typeof SCIMBulkResponseSchema>;
