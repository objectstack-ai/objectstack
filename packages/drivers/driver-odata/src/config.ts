// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OData driver's own config contract.
 *
 * The driver is a PLUGIN driver: its id is not in the spec's
 * `DRIVER_VOCABULARY`, so `DatasourceSchema` leaves the datasource's `config`
 * unvalidated ("we validate what we can construct") and the engine holds the
 * driver behind its external-driver floor. The contract therefore lives here,
 * beside the code that reads it, and is parsed when the plugin is built — a
 * wrong key refuses the boot instead of connecting to the wrong place.
 *
 * ⛔ No credential is a key of this config. The secret comes from the
 * datasource's `external.credentialsRef`, resolved through the host's secret
 * store at the first request (see `plugin.ts`); the config names only the
 * scheme and, for `basic`, the user name.
 */

import { z } from 'zod';

/** The default number of rows asked for per page (`Prefer: odata.maxpagesize`). */
export const DEFAULT_PAGE_SIZE = 500;

/** The default per-request timeout, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const AuthSchema = z.discriminatedUnion('scheme', [
  z.strictObject({
    scheme: z.literal('none'),
  }),
  z.strictObject({
    scheme: z.literal('bearer'),
  }),
  z.strictObject({
    scheme: z.literal('basic'),
    username: z.string().min(1).describe('The user name; the password is the resolved credentialsRef secret.'),
  }),
]).describe('How each request authenticates. The secret is the datasource\'s external.credentialsRef.');

export const ODataDriverConfigSchema = z.strictObject({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/)
    .default('odata')
    .describe('The datasource this driver serves; also the driver name and its `driver.<name>` service suffix.'),
  serviceRoot: z.string().url()
    .refine((value) => /^https?:$/.test(new URL(value).protocol), 'serviceRoot must be an http(s) URL')
    .refine((value) => {
      const url = new URL(value);
      return url.username === '' && url.password === '';
    }, 'serviceRoot must not carry credentials; declare external.credentialsRef on the datasource instead')
    .refine((value) => new URL(value).search === '', 'serviceRoot must not carry a query string')
    .describe('The OData service root, e.g. https://erp.example.com/odata/v4/sales/'),
  version: z.literal('4.0').default('4.0')
    .describe('The OData protocol version the service speaks. Only 4.0 is shipped; a v2 dialect is a new file.'),
  auth: AuthSchema.default({ scheme: 'none' }),
  pageSize: z.number().int().min(1).max(5000).default(DEFAULT_PAGE_SIZE)
    .describe('Rows asked for per server page (Prefer: odata.maxpagesize).'),
  requestTimeoutMs: z.number().int().min(1).max(600_000).default(DEFAULT_REQUEST_TIMEOUT_MS)
    .describe('Per-request timeout in milliseconds.'),
});

export type ODataDriverConfigInput = z.input<typeof ODataDriverConfigSchema>;
export type ODataDriverConfig = z.output<typeof ODataDriverConfigSchema>;

/** Parse the config, refusing with every issue named. */
export function parseODataDriverConfig(input: ODataDriverConfigInput): ODataDriverConfig {
  const parsed = ODataDriverConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`driver-odata: invalid config — ${issues.join('; ')}`);
  }
  return parsed.data;
}
