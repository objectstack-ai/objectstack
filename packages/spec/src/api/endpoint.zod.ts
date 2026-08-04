// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod, RateLimitConfigSchema } from '../shared/http.zod';

/**
 * API Mapping Schema
 * Transform input/output data.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ApiMappingSchema = lazySchema(() => z.object({
  source: z.string().describe('Source field/path'),
  target: z.string().describe('Target field/path'),
  transform: z.string().optional().describe('Transformation function name'),
}));

/**
 * API Endpoint Schema
 * Defines an external facing API contract.
 */
export const ApiEndpointSchema = z.object({
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique endpoint ID'),
  path: z.string().regex(/^\//).describe('URL Path (e.g. /api/v1/customers)'),
  method: HttpMethod.describe('HTTP Method'),
  
  /** Documentation */
  summary: z.string().optional(),
  description: z.string().optional(),
  
  /** Execution Logic */
  type: z.enum(['flow', 'script', 'object_operation', 'proxy']).describe('Implementation type'),
  target: z.string().describe('Target Flow ID, Script Name, or Proxy URL'),
  
  /** Logic Config */
  objectParams: z.object({
    object: z.string().optional(),
    operation: z.enum(['find', 'get', 'create', 'update', 'delete']).optional(),
  }).optional().describe('For object_operation type'),
  
  /** Data Transformation */
  inputMapping: z.array(ApiMappingSchema).optional().describe('Map Request Body to Internal Params'),
  outputMapping: z.array(ApiMappingSchema).optional().describe('Map Internal Result to Response Body'),
  
  /** Policies */
  authRequired: z.boolean().default(true).describe('Require authentication'),
  rateLimit: RateLimitConfigSchema.optional().describe('Rate limiting policy'),
  cacheTtl: z.number().optional().describe('Response cache TTL in seconds'),
});

/**
 * The canonical form of an endpoint `path` — exactly ONE trailing slash
 * trimmed, never from a lone `/`.
 *
 * Declared here, with the vocabulary, because two independent consumers must
 * agree on it byte for byte or a declaration passes one and fails the other:
 *
 *  - the **matcher** (`packages/metadata/src/endpoint-matcher.ts`) normalizes
 *    both the stored declaration and the request path with it, so a request for
 *    `/x/` reaches an endpoint declared as `/x`;
 *  - the **publish gate** (#5040 E7) compares declarations with it to reject
 *    two endpoints in one stack claiming the same METHOD + path.
 *
 * Were the gate to normalize differently, a stack could publish two endpoints
 * the matcher then treats as one — and the loser would be dead metadata that
 * passed validation. Trimming ONE (not all) keeps `/x//` and `/x/` distinct,
 * matching how every router in this stack treats an empty path segment; keeping
 * a lone `/` whole means the normalized form is still a legal
 * `ApiEndpointSchema.path`. Nothing else happens: no percent-decoding, no
 * Unicode normalization, no case folding (an open vocabulary question, #5040
 * §7-5 — not something for an implementation to settle).
 */
export function normalizeEndpointPath(path: string): string {
  const raw = String(path ?? '');
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw;
}

export const ApiEndpoint = Object.assign(ApiEndpointSchema, {
  create: <T extends z.input<typeof ApiEndpointSchema>>(config: T) => config,
});

export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;
export type ApiEndpointInput = z.input<typeof ApiEndpointSchema>;
