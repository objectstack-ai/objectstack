// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `connector-credential-literal` — a credential typed into a declarative
 * connector's header or environment map as a LITERAL, and the two ways a
 * stdio MCP server's credential route goes wrong around it.
 *
 * ## What it reports
 *
 * One advisory per credential-shaped literal ({@link isCredentialShapedLiteral},
 * `credential-literal.ts` — the one predicate; this file holds no name list) in
 * each of the four maps a provider sends upstream as written:
 *
 *  - `providerConfig.headers`;
 *  - `providerConfig.defaultHeaders` (`rest`);
 *  - `providerConfig.transport.headers` (`mcp` over http);
 *  - `providerConfig.transport.env` (`mcp` over stdio).
 *
 * They are the four maps the connector read path withholds whole
 * (`CONNECTOR_CREDENTIAL_MAP_PATHS`, `@objectstack/spec`'s connector redactor),
 * because a map's entries cannot be told apart there. Withholding answers the
 * READ; it does not move the value out of metadata. A literal in one of these
 * maps is still stored in `sys_metadata`, carried by every build artifact and
 * every source checkout of the stack, and rotated only by editing metadata.
 *
 * Two more findings, each about the route the literal is steered to:
 *
 *  - **a stdio credential that reaches nothing.** An `mcp` entry over a stdio
 *    transport that declares a static `auth` (`bearer`, `api-key`, `basic`)
 *    and names no `transport.credentialEnv`. The reference is resolved (and a
 *    missing one degrades the instance), but the `mcp` provider applies `auth`
 *    to a stdio server only through that key, so the resolved credential is
 *    dropped and nothing says so. A grant-bearing kind on stdio is refused at
 *    boot by the provider, loudly, so it is not this rule's.
 *  - **a credential typed into `transport.credentialEnv`.** That key holds a
 *    variable NAME and is served on every metadata read, so a value that reads
 *    as a credential ({@link isCredentialShapedName}) is a secret in a served
 *    slot. Judged on every entry that carries the key, whatever its transport.
 *
 * ## Why an advisory, and why it names the connector route
 *
 * The supported home for an outbound credential is the connector's own
 * `auth: { type, credentialRef }`, whose reference is resolved through the
 * secrets layer when the instance materializes and is never stored in metadata
 * (ADR-0097 §3). The `rest` provider and an `mcp` http transport both send the
 * resolved credential themselves, so a header literal moves there by shape.
 *
 * A stdio MCP server takes the same `auth`, and one more key says where it
 * goes: `providerConfig.transport.credentialEnv` names the environment
 * variable the `mcp` provider hands the resolved credential to the child in.
 * ⛔ Without that key a stdio transport does not apply `auth` at all, so the
 * env finding names BOTH halves — `auth.credentialRef` and
 * `transport.credentialEnv` — never the reference alone, and its hint spells
 * the `auth` the way the header hint does, so the two routes read as one.
 *
 * The predicate is a heuristic (a key named `token` can hold something that is
 * not a secret), so the finding is a `warning`, always: a false positive costs
 * the author a line of reading, never a blocked save. The registry entry is
 * `tier: 'advisory'`, which `authoring-rule-wiring.test.ts` verifies by reading
 * this function's body for an `error` severity. Making it a refusal is a
 * triage decision, not an edit here.
 *
 * ## What a finding carries — and what it must not
 *
 * The name the value sits under and where it sits; ⛔ never the value. The
 * finding travels into CI logs, the runtime gate's server log line and the save
 * response, so echoing the literal would copy the credential into three more
 * places while telling the author to take it out of one.
 */

import { isCredentialShapedLiteral, isCredentialShapedName } from './credential-literal.js';
import { recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The rule id every finding of this rule carries. */
export const CONNECTOR_CREDENTIAL_LITERAL = 'connector-credential-literal';

export interface ConnectorCredentialLiteralFinding {
  /** Always a warning — see the module note. The type keeps it that way. */
  severity: 'warning';
  rule: typeof CONNECTOR_CREDENTIAL_LITERAL;
  /** `connector 'x'`. */
  where: string;
  /** Config path of the entry, e.g. `connectors[0].providerConfig.defaultHeaders.Authorization`. */
  path: string;
  message: string;
  hint: string;
}

/**
 * Why a literal here is worth a line: the read path withholds the map, but the
 * value is still metadata. Why each map is withheld is `os explain
 * connector-credential-literal`.
 */
const KEPT = 'kept in metadata, not the secrets layer';

/** The route, short, in the VERDICT as well as in the hint (see the flow rule's note). */
const STEER_HEADER = "move it to the connector's `auth.credentialRef`";
const STEER_ENV = "move it to the connector's `auth.credentialRef` with `transport.credentialEnv`";

const HEADER_ROUTE =
  "Give the entry `auth: { type: 'bearer', credentialRef }` (or `{ type: 'api-key', headerName, credentialRef }`) " +
  'and drop the header: the provider sends the resolved credential itself';

const ENV_ROUTE =
  "Give the entry `auth: { type: 'bearer', credentialRef }`, name the variable in `transport.credentialEnv` " +
  'and drop the env entry: the provider passes the resolved credential to the stdio server itself';

/**
 * The static `auth` kinds the `mcp` provider places in a stdio server's
 * environment through `transport.credentialEnv` (the token, the key, the
 * password), and drops without it.
 */
const STDIO_PLACED_AUTH_KINDS: ReadonlySet<string> = new Set(['bearer', 'api-key', 'basic']);

const STDIO_AUTH_UNPLACED_ROUTE =
  "Add `credentialEnv: 'VARIABLE_NAME'` to `providerConfig.transport`, naming the variable the server reads its " +
  'credential from: the provider passes the resolved credential to the stdio server there. If the server takes ' +
  "no credential, drop `auth`: an unresolved reference degrades the instance even though nothing uses it";

const CREDENTIAL_ENV_ROUTE =
  '`transport.credentialEnv` takes the NAME of the environment variable the stdio server reads, never the ' +
  "credential: set the secret where `auth: { type: 'bearer', credentialRef }` resolves (an environment variable " +
  'or Setup → Connector credentials) and write the variable name here';

/** One judged map: where it sits under the entry, what an entry of it is called, and its route. */
interface JudgedMap {
  path: readonly string[];
  entry: 'header' | 'env';
}

/**
 * The four maps, in the order the redactor names them. ⚠️ A mirror of the
 * spec's `CONNECTOR_CREDENTIAL_MAP_PATHS`, which the spec does not export;
 * `lint-connector-credential-literals.test.ts` holds the two equal by reading
 * that list through the redactor's own answer.
 */
const JUDGED_MAPS: readonly JudgedMap[] = [
  { path: ['providerConfig', 'headers'], entry: 'header' },
  { path: ['providerConfig', 'defaultHeaders'], entry: 'header' },
  { path: ['providerConfig', 'transport', 'headers'], entry: 'header' },
  { path: ['providerConfig', 'transport', 'env'], entry: 'env' },
];

/** The judged map paths, dotted, for a test or a caller that names them. */
export const CONNECTOR_CREDENTIAL_LITERAL_MAPS: readonly string[] = Object.freeze(
  JUDGED_MAPS.map((m) => m.path.join('.')),
);

/** A config-path segment for a map key: `.key` when it is an identifier, `["x-key"]` otherwise. */
function keySegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

/** The value at `path` under `entry`, when every step is a record. */
function mapAt(entry: AnyRec, path: readonly string[]): AnyRec | undefined {
  let at: unknown = entry;
  for (const step of path) {
    if (!isRec(at)) return undefined;
    at = at[step];
  }
  return isRec(at) ? at : undefined;
}

/**
 * Every credential-shaped literal a connector entry carries in one of its four
 * header/env maps, one advisory each, then the entry's `transport.credentialEnv`
 * when it reads as a credential, then a stdio `mcp` entry's static `auth` when
 * no `credentialEnv` places it. Pure; never throws on a malformed stack (a
 * non-record connector or map is skipped, not dereferenced).
 */
export function lintConnectorCredentialLiterals(stack: AnyRec): ConnectorCredentialLiteralFinding[] {
  const findings: ConnectorCredentialLiteralFinding[] = [];

  recordsOf(stack.connectors).forEach((connector, index) => {
    const name = typeof connector.name === 'string' && connector.name ? connector.name : `#${index}`;
    for (const judged of JUDGED_MAPS) {
      const map = mapAt(connector, judged.path);
      if (!map) continue;
      const label = judged.path.join('.');
      for (const [key, value] of Object.entries(map)) {
        if (!isCredentialShapedLiteral(key, value)) continue;
        const steer = judged.entry === 'env' ? STEER_ENV : STEER_HEADER;
        findings.push({
          severity: 'warning',
          rule: CONNECTOR_CREDENTIAL_LITERAL,
          where: `connector '${name}'`,
          path: `connectors[${index}].${label}${keySegment(key)}`,
          // One verdict sentence; why the map is withheld on read but still
          // worth moving, and the auth variants, are
          // `os explain connector-credential-literal`.
          message: `${judged.entry} '${key}' in ${label} holds a credential-shaped literal, ${KEPT}; ${steer}`,
          hint: judged.entry === 'env' ? ENV_ROUTE : HEADER_ROUTE,
        });
      }
    }

    const transport = mapAt(connector, ['providerConfig', 'transport']);
    if (!transport) return;

    // A credential typed where the variable NAME belongs. The value is never
    // echoed: the finding reports where it sits, as the map findings do.
    if (isCredentialShapedName(transport.credentialEnv)) {
      findings.push({
        severity: 'warning',
        rule: CONNECTOR_CREDENTIAL_LITERAL,
        where: `connector '${name}'`,
        path: `connectors[${index}].providerConfig.transport.credentialEnv`,
        message:
          'providerConfig.transport.credentialEnv reads as a credential, not a variable name, and is served on ' +
          'every metadata read; put the secret behind `auth.credentialRef` and name its variable here',
        hint: CREDENTIAL_ENV_ROUTE,
      });
    }

    // A static credential a stdio server is never handed.
    const auth = isRec(connector.auth) ? connector.auth : undefined;
    if (
      connector.provider === 'mcp' &&
      transport.kind === 'stdio' &&
      transport.credentialEnv === undefined &&
      typeof auth?.type === 'string' &&
      STDIO_PLACED_AUTH_KINDS.has(auth.type)
    ) {
      findings.push({
        severity: 'warning',
        rule: CONNECTOR_CREDENTIAL_LITERAL,
        where: `connector '${name}'`,
        path: `connectors[${index}].auth`,
        message:
          `auth '${auth.type}' reaches nothing: a stdio transport passes the resolved credential to the server only ` +
          'in the variable `transport.credentialEnv` names, and this entry names none',
        hint: STDIO_AUTH_UNPLACED_ROUTE,
      });
    }
  });

  return findings;
}
