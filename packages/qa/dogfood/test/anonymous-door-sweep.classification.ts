// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The CLOSED classification the anonymous door sweep judges every mounted route
// by (ADR-0138 D2; the test half of ruling 6134095444 on #22146).
//
// ── What this table is ───────────────────────────────────────────────────────
//
// D2 says an unauthenticated request is served by exactly six door classes,
// that a short list of surfaces is "outside the guest model by construction",
// and that EVERYTHING ELSE answers 401. This module writes that sentence down as
// data the sweep can execute:
//
//   - `DOOR_CLASSES`        the six classes, each with the routes that carry it
//                           and the class-level answer D2 gives an anonymous
//                           request that names no declared subject;
//   - `OUTSIDE_FAMILIES`    the surfaces outside the guest model by
//                           construction, each with the reason it is outside;
//   - `MIDDLEWARE`          registrations that answer no request of their own;
//   - and NOTHING ELSE.     A route none of the above claims is in the
//                           everything-else class, and must answer 401.
//
// ⛔ That last line is the whole point. There is no "unclassified" bucket and no
// tolerance list: a new anonymous door that nobody wrote down here lands in the
// everything-else class and turns the sweep red, which is the "a new surface is
// therefore 401 until this list names it" sentence of D2 made mechanical.
// Naming a new door class is an amendment of ADR-0138, never an edit here alone.
//
// ── What a row may and may not say ───────────────────────────────────────────
//
// Rows are keyed by the pattern the router registered (`METHOD pattern`, `*` for
// every verb), or by the platform's own predicate where one exists (the
// control-plane allowlist is `isAuthGateAllowlisted` itself, never a copy of its
// paths). Every row carries the reason it is where it is.
//
// The expectations are CLASS-LEVEL: one predicate per class, over the status
// class and over whether anything was served. No row pins one route's own
// answer, and no measured route-level reading belongs in this file (#22146:
// classes, positions and functions only).
//
// ── Ordering ─────────────────────────────────────────────────────────────────
//
// First match wins, in this order: door classes, outside families, the
// control-plane allowlist, middleware. The explicit outside families sit ahead
// of the allowlist on purpose: two of them (the approval action page and the
// signed inbound hook) are ALSO admitted by the allowlist predicate, and each
// deserves its own reason and, for the hook, its own D2-stated answer.

import { isAuthGateAllowlisted } from '@objectstack/core';

/** One route of the swept population. */
export interface SweptRoute {
  /** `GET`, `POST`, … or `ALL` for a framework registration on every verb. */
  readonly method: string;
  /** The registered pattern (`/api/v1/meta/:type`), or a declared endpoint's literal path. */
  readonly pattern: string;
  /**
   * Where the population read it from:
   *  - `port`     — `IHttpServer.getMountedRoutes()`, the adapter's record of every
   *                 route registered through the HTTP-server contract;
   *  - `raw`      — the framework's own route table only (a mount on the raw app
   *                 handle, outside the port by construction);
   *  - `declared` — an ADR-0121 declared endpoint, served by the transport's
   *                 fallback seam and therefore in no route table at all.
   */
  readonly source: 'port' | 'raw' | 'declared';
  /** For `declared`: the parsed declaration the metadata service matches. */
  readonly endpoint?: { readonly type?: string; readonly authRequired?: boolean };
}

/** What one anonymous request got back, as the sweep records it. */
export interface SweepAnswer {
  readonly status: number;
  readonly contentType: string;
  /** The parsed body when the answer was JSON, else `undefined`. */
  readonly json?: Record<string, unknown>;
}

/** `undefined` when the answer is the class's answer, otherwise why it is not. */
export type ClassExpectation = (answer: SweepAnswer) => string | undefined;

const isJson = (a: SweepAnswer): boolean => a.json !== undefined;

/** Nothing served: an error envelope, never a `data` payload or a success flag. */
function servedNothing(a: SweepAnswer): string | undefined {
  if (!isJson(a)) return undefined;
  if (a.json!.success === true) return 'the body says success:true';
  if ('data' in a.json!) return 'the body carries a data payload';
  return undefined;
}

/** The everything-else answer: 401, as an error envelope, with nothing served. */
export const EVERYTHING_ELSE: ClassExpectation = (a) => {
  if (a.status !== 401) return `answered ${a.status}, not 401`;
  if (!isJson(a) || a.json!.error === undefined) return 'answered 401 without an error envelope';
  return servedNothing(a);
};

/** A door that admits only by a declared subject, asked about none: a 4xx refusal, nothing served. */
const REFUSED_WITHOUT_A_SUBJECT: ClassExpectation = (a) => {
  if (a.status < 400 || a.status >= 500) return `answered ${a.status}, not a 4xx refusal`;
  return servedNothing(a);
};

const codeOf = (a: SweepAnswer): unknown => {
  const error = a.json?.error;
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : a.json?.code;
};

export type DoorClassId = 1 | 2 | 3 | 4 | 5 | 6;

export interface DoorClass {
  readonly id: DoorClassId;
  /** D2's own name for the class. */
  readonly name: string;
  /** D2's enforcer for it, by function. */
  readonly enforcedBy: string;
  /**
   * The routes that carry this class. `undefined` for the one class that has no
   * route of its own (class 3 rides the shared `/meta` read routes, whose every
   * other reading is everything-else); see `ridesOn`.
   */
  readonly match?: (r: SweptRoute) => boolean;
  /** For a class with no route of its own: the routes it rides, all in the population. */
  readonly ridesOn?: readonly string[];
  /** The class-level answer to the sweep's request on one of its routes. */
  readonly expect?: ClassExpectation;
}

const routeIs = (...keys: string[]) => {
  const set = new Set(keys);
  return (r: SweptRoute) => set.has(`${r.method} ${r.pattern}`);
};

const declaredAnonymous = (type: string) => (r: SweptRoute) =>
  r.source === 'declared' && r.endpoint?.authRequired === false && r.endpoint?.type === type;

/** ADR-0138 D2's six door classes. */
export const DOOR_CLASSES: readonly DoorClass[] = [
  {
    id: 1,
    name: 'the public form doors (resolve and submit)',
    enforcedBy: 'RestServer.registerFormEndpoints; the publicFormGrant branch of SecurityPlugin',
    match: routeIs('GET /api/v1/forms/:slug', 'POST /api/v1/forms/:slug/submit'),
    // Admitted by the form's own `sharing` declaration; a slug no form declares
    // is no door.
    expect: REFUSED_WITHOUT_A_SUBJECT,
  },
  {
    id: 2,
    name: 'share links',
    enforcedBy: 'registerShareLinkRoutes (plugin-sharing), the capability token',
    // The two token-addressed reads. The create / list / revoke routes beside
    // them manage links and need a signed-in caller: they are everything-else.
    match: routeIs('GET /api/v1/share-links/:token/resolve', 'GET /api/v1/share-links/:token/messages'),
    expect: REFUSED_WITHOUT_A_SUBJECT,
  },
  {
    id: 3,
    name: 'the public book and doc metadata reads',
    enforcedBy: 'isPublicAudienceRead (rest meta-item-read-gate), the ADR-0046 §6.7 audience gate',
    // No route of its own: the audience gate admits by the book's
    // `audience: 'public'` VALUE, on the same read routes every other metadata
    // read takes. Asked about any other subject those routes are
    // everything-else and answer 401, so the sweep holds them to 401 and the
    // class itself is asserted on its real subjects.
    ridesOn: ['GET /api/v1/meta/:type', 'GET /api/v1/meta/:type/:name', 'GET /api/v1/meta/book/:name/tree'],
  },
  {
    id: 4,
    name: "authRequired: false endpoints of type 'object_operation'",
    enforcedBy: 'resolveExecutionContext (the guest envelope); the CRUD gate',
    match: declaredAnonymous('object_operation'),
    // The guest envelope under the guest's grants (D3). No grant is bound to
    // the guest on this boot, so D3's empty state applies: deny all.
    expect: (a) => {
      if (a.status !== 403) return `answered ${a.status}, not D3's empty-state 403`;
      if (codeOf(a) !== 'PERMISSION_DENIED') return `answered 403 with code ${String(codeOf(a))}`;
      return servedNothing(a);
    },
  },
  {
    id: 5,
    name: "authRequired: false endpoints of type 'flow'",
    enforcedBy: 'resolveExecutionContext (the guest envelope), then @objectstack/service-automation',
    match: declaredAnonymous('flow'),
    // Admitted at the door as the guest; what the run answers is the flow's own
    // declared behaviour, asserted on the class's fixture, not here.
    expect: (a) => (a.status === 401 ? 'answered 401: the door did not admit the guest' : undefined),
  },
  {
    id: 6,
    name: "the acl: 'public_read' file download",
    enforcedBy: 'registerStorageRoutes, at the download gate authorizeDownload both download routes call',
    match: routeIs('GET /api/v1/storage/files/:fileId', 'GET /api/v1/storage/files/:fileId/url'),
    // Admitted by the file's own `acl: 'public_read'`; an id that names no such
    // file is no door.
    expect: REFUSED_WITHOUT_A_SUBJECT,
  },
];

export type OutsideFamilyId =
  | 'signed-inbound-hook'
  | 'mcp'
  | 'mcp-skill-document'
  | 'approval-action-token'
  | 'storage-signed-url'
  | 'discovery'
  | 'oauth-discovery-metadata'
  | 'console-bootstrap'
  | 'dev-metadata-hmr'
  | 'control-plane-allowlist';

export interface OutsideFamily {
  readonly id: OutsideFamilyId;
  /** Why this surface is outside the guest model by construction. */
  readonly reason: string;
  readonly match: (r: SweptRoute, probePath: string) => boolean;
  /** Only where D2 itself states the anonymous answer. */
  readonly expect?: ClassExpectation;
}

const statusIs401: ClassExpectation = (a) => (a.status === 401 ? servedNothing(a) : `answered ${a.status}, not 401`);

/**
 * The surfaces outside the guest model by construction. The first three are
 * D2's own list (the allowlist, the signed inbound-hook channel, MCP); the rest
 * are the token-addressed approval pages and the raw-app mounts ruling
 * 6134095444 ordered classified explicitly, each with its reason.
 */
export const OUTSIDE_FAMILIES: readonly OutsideFamily[] = [
  {
    id: 'signed-inbound-hook',
    reason:
      'ADR-0041 signed inbound hook (trigger-api verifySignature): the per-flow secret is the credential, and ' +
      'D2 states the answer to a missing or bad signature: 401',
    match: routeIs('POST /api/v1/automation/hooks/:flowName/:hookId'),
    expect: statusIs401,
  },
  {
    id: 'mcp',
    reason: 'MCP admits an OAuth token or an API key and never an anonymous caller (D2), so its answer is 401',
    match: (r) => r.pattern === '/api/v1/mcp',
    expect: statusIs401,
  },
  {
    id: 'mcp-skill-document',
    reason:
      'the portable Agent Skill document (ADR-0036 Amendment C, renderSkillMarkdown): generic instructions and the ' +
      "environment's MCP URL, never a tenant's schema or data; the verbs it does not serve answer for themselves",
    match: (r) => r.pattern === '/api/v1/mcp/skill',
  },
  {
    id: 'approval-action-token',
    reason:
      "ADR-0043 actionable-link pages (ApprovalsServicePlugin's peek and redeem): the single-use action token is " +
      'the whole credential, and a decision binds the approver that token names, never a guest; ' +
      'isAuthGateAllowlisted admits this exact route',
    match: routeIs('GET /api/v1/approvals/act', 'POST /api/v1/approvals/act'),
  },
  {
    id: 'storage-signed-url',
    reason:
      "the local storage adapter's signed byte URLs: the signed, expiring token an authorized upload or download " +
      "mints is the credential, the role a cloud store's presigned URL plays, and no principal is evaluated",
    match: routeIs('GET /api/v1/storage/_local/raw/:token', 'PUT /api/v1/storage/_local/raw/:token'),
  },
  {
    id: 'discovery',
    reason:
      "the discovery documents (the REST root and the dispatcher's well-known document): the allowlist's " +
      'discovery role, at the two spellings isAuthGateAllowlisted does not name literally',
    match: routeIs('GET /api/v1', 'GET /.well-known/objectstack'),
  },
  {
    id: 'oauth-discovery-metadata',
    reason:
      'the OAuth / OpenID discovery metadata (RFC 8414, RFC 9728) plugin-auth serves: public by standard, read by ' +
      'an MCP or OAuth client before it holds any token, and carrying no business data',
    match: (r) =>
      r.method === 'GET' &&
      (r.pattern.startsWith('/.well-known/oauth-authorization-server') ||
        r.pattern.startsWith('/.well-known/oauth-protected-resource') ||
        r.pattern === '/.well-known/openid-configuration'),
  },
  {
    id: 'console-bootstrap',
    reason:
      "RuntimeConfigPlugin's bootstrap reads: the console's pre-sign-in branding and runtime posture, no tenant data",
    match: routeIs('GET /api/v1/runtime/config', 'GET /api/v1/studio/runtime-config'),
  },
  {
    id: 'dev-metadata-hmr',
    reason:
      "MetadataPlugin's metadata HMR stream: a build-tool door mounted only under an explicit " +
      'NODE_ENV=development posture (isDevMetadataEndpointEnabled), never on a production deployment',
    match: routeIs('GET /api/v1/dev/metadata-events', 'POST /api/v1/dev/metadata-events'),
  },
  {
    id: 'control-plane-allowlist',
    reason:
      'the control-plane allowlist, by its own predicate (isAuthGateAllowlisted): sign-in and the auth surface, ' +
      'health, readiness, discovery and the current-user reads the ADR-0069 remediation screen needs',
    match: (r, probePath) => isAuthGateAllowlisted(probePath, r.method === 'ALL' ? 'GET' : r.method),
  },
];

/** Registrations that run around other routes and answer no request of their own. */
export const MIDDLEWARE: readonly { readonly key: string; readonly reason: string }[] = [
  {
    key: 'ALL /*',
    reason: 'the server-wide middleware (request context, CORS, error shaping): it wraps every route and serves none',
  },
];

export type SweepClass =
  | { readonly kind: 'door'; readonly door: DoorClass }
  | { readonly kind: 'outside'; readonly family: OutsideFamily }
  | { readonly kind: 'middleware' }
  | { readonly kind: 'everything-else' };

/** The one classification of a route. First match wins, in the order the header states. */
export function classify(route: SweptRoute, probePath: string): SweepClass {
  for (const door of DOOR_CLASSES) if (door.match?.(route)) return { kind: 'door', door };
  for (const family of OUTSIDE_FAMILIES) if (family.match(route, probePath)) return { kind: 'outside', family };
  if (MIDDLEWARE.some((m) => m.key === `${route.method} ${route.pattern}`)) return { kind: 'middleware' };
  return { kind: 'everything-else' };
}

/**
 * A concrete request path for a registered pattern: every `:param` becomes a
 * value no declaration can name, and a trailing `*` a segment under it.
 */
export function probePathOf(pattern: string): string {
  let n = 0;
  return pattern
    .split('/')
    .map((seg) => (seg.startsWith(':') ? `anon-sweep-${n++}` : seg === '*' ? 'anon-sweep-any' : seg))
    .join('/');
}
