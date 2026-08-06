// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// Dynamic imports from spec source
import * as API from '../src/api';
import * as Data from '../src/data';
import { assertRefsResolve, assertNoDegradedSchemas } from './lib/openapi-self-consistency';

const OUT_DIR = path.resolve(__dirname, '../json-schema');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const SPEC_VERSION = pkg.version;

/**
 * Generates the OpenAPI 3.1 **contract half** of `GET {apiPath}/openapi.json`
 * from this package's REST API protocol schemas: `components.schemas`, `info`,
 * `securitySchemes`, the document-level `security` requirement, and a fallback
 * `servers` entry. That is the whole artifact, and the whole of what
 * `packages/spec` owns.
 *
 * ## It deliberately describes NO routes (#5588 ruling C, #5744)
 *
 * This generator used to hand-write a built-in route section —
 * `generateCrudPaths` / `generateMetadataPaths` / `generateDiscoveryPaths`,
 * 7 paths and 10 operations under a literal `basePath = '/api'`. A real boot
 * probed it row by row and matched **0 of 10**: every path was missing `/v1`
 * (CRUD also missing `/data`), `PUT {object}/{id}` named a verb the server
 * answers 405 to, `/api/meta/types` exists nowhere in the repo, and
 * `/api/.well-known/objectstack` is the runtime dispatcher's route, served at
 * the ROOT rather than under the API base.
 *
 * It could not be written correctly from this seat, either: `apiPath` is
 * per-deployment configuration (`api.apiPath ?? api.basePath + '/' + version`),
 * so no statically published JSON can spell the prefix right for every
 * deployment. A route section can only be produced by the package that MOUNTS
 * the routes — ADR-0076 (one route, one owner), with `packages/rest` confirmed
 * as this document's owner by the real boot in #5078.
 *
 * So the section has one producer, and it is not here: since #5821 the REST
 * server builds it at serve time from `routeManager.getAll()` — the same table
 * the router matches requests against — and DISCARDS whatever `paths` the
 * static artifact carries. #5744 (this change) removes the emission, which is
 * why the removal is a zero-behaviour-change cleanup rather than a regression:
 * the served document's route section was already rest's, byte for byte.
 *
 * `paths` is therefore ABSENT from the emitted document rather than present
 * and empty. OpenAPI 3.1 makes `paths` optional (a document is valid with any
 * one of `paths` / `components` / `webhooks`), and the two spellings say
 * different things: `paths: {}` asserts "this API serves nothing", which is
 * false, while an absent key asserts nothing about routes, which is exactly
 * the claim this artifact is entitled to make.
 */

function generateComponentSchemas(): Record<string, Record<string, unknown>> {
  const schemas: Record<string, Record<string, unknown>> = {};
  const degraded: string[] = [];

  // Map of contract schema names to their Zod schemas
  const contractSchemas: Record<string, z.ZodType> = {
    CreateRequest: (API as any).CreateRequestSchema,
    UpdateRequest: (API as any).UpdateRequestSchema,
    SingleRecordResponse: (API as any).SingleRecordResponseSchema,
    ListRecordResponse: (API as any).ListRecordResponseSchema,
    DeleteResponse: (API as any).DeleteResponseSchema,
    ApiError: (API as any).ApiErrorSchema,
    BulkRequest: (API as any).BulkRequestSchema,
    BulkResponse: (API as any).BulkResponseSchema,
    BaseResponse: (API as any).BaseResponseSchema,
  };

  for (const [name, schema] of Object.entries(contractSchemas)) {
    // `typeof` must admit BOTH 'object' and 'function': every contract schema
    // here is wrapped in `lazySchema()`, whose Proxy target is
    // `function lazyZod() {}`, so `typeof schema === 'function'`. Demanding
    // 'object' short-circuited all nine and published an empty
    // `components.schemas` behind six dangling `$ref`s (#5168). The `_zod`
    // half of the guard is Proxy-safe as written — `lazySchema` maintains a
    // `_zod` facade precisely so `toJSONSchema` can traverse it.
    const isZodLike =
      !!schema && (typeof schema === 'object' || typeof schema === 'function') && '_zod' in schema;
    if (!isZodLike) continue; // reported by assertNoDegradedSchemas below

    try {
      schemas[name] = z.toJSONSchema(schema as z.ZodType, { target: 'draft-2020-12' });
    } catch {
      degraded.push(name);
    }
  }

  // Declared = enforced: the table above is a literal list of the contract's
  // nine schemas, so a name that produced nothing is a defect, never an
  // optional input. Failing here is what makes the #5168 shape unrepeatable.
  assertNoDegradedSchemas(Object.keys(contractSchemas), schemas, degraded);

  return schemas;
}

// ─── Build OpenAPI Spec ──────────────────────────────────────────────

const openapi: Record<string, unknown> = {
  openapi: '3.1.0',
  info: {
    title: 'ObjectStack REST API',
    version: SPEC_VERSION,
    description: 'Auto-generated OpenAPI specification from @objectstack/spec protocol schemas.',
    contact: {
      name: 'ObjectStack',
      url: 'https://objectstack.io',
    },
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  },
  // Kept: the REST server prepends the live request origin and keeps this as a
  // trailing fallback entry, so dropping it would change the SERVED document —
  // and this change is meant to be invisible there.
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  // No `tags`. The three that used to sit here (`CRUD` / `Metadata` /
  // `Discovery`) existed only to name the removed route sections; no operation
  // in any document carries them, and the served document's tag list is
  // produced with its route section, from the tags the routes register.
  components: {
    schemas: generateComponentSchemas(),
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
  },
  security: [
    { bearerAuth: [] },
  ],
};

// ─── Self-consistency gate (#5168) ───────────────────────────────────
//
// Runs BEFORE the write, so a document whose `$ref`s do not resolve is never
// emitted at all. `gen:openapi` still has no staleness gate (`check:generated`
// reports it as one of the two ungated generators), so this is the only thing
// standing between a silently-broken collector and the published artifact.
// Throwing exits non-zero and fails the build.
//
// Since #5744 removed the hand-written route section, the emitted document
// happens to carry ZERO `$ref`s — every one of the nine lived in a path
// operation's request/response body. Be honest about what that means: on
// today's document this call is VACUOUS, and it is retained for a reason that
// is about tomorrow's, not a reason to feel covered by it now.
//
// The live hazard it guards is `$defs`. `z.toJSONSchema` emits reused and
// recursive subschemas into a `$defs` block at the root of the schema it
// RETURNS, pointing at them with root-relative `#/$defs/…` pointers. Each of
// the nine is converted independently and then parked at
// `components.schemas[Name]`, so the moment any contract schema becomes
// recursive or shares a subschema, the pointer means `#/$defs/…` of the whole
// OpenAPI document — which has no `$defs` — and every consumer that resolves it
// gets nothing. None of the nine is in that shape today; `findDanglingRefs`
// resolves by JSON Pointer rather than by a `#/components/schemas/` prefix
// precisely so that day costs nobody a debugging session.
assertRefsResolve(openapi);

// Write output
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const outPath = path.join(OUT_DIR, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(openapi, null, 2));
console.log(`✅ Generated OpenAPI spec: ${outPath}`);
console.log(`   Version: ${SPEC_VERSION}`);
// No `Paths:` line — the document has no `paths`, and a `Paths: 0` would read
// as "the collector produced nothing" rather than "this artifact does not
// describe routes". The route section is served by @objectstack/rest (#5588).
console.log(`   Components: ${Object.keys((openapi.components as any).schemas).length}`);
console.log(`   Route sections: none — served by @objectstack/rest (#5588, ADR-0076)`);
