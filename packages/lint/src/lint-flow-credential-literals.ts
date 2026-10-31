// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `flow-credential-literal` — a credential typed into a flow as a LITERAL, in a
 * position every flow reader is served.
 *
 * ## What it reports
 *
 * One advisory per credential-shaped literal ({@link isCredentialShapedLiteral},
 * `credential-literal.ts` — the one predicate; this file holds no name list) in
 * each of the three positions a flow definition serves as authored:
 *
 *  - an `http` node's `config.headers` entry;
 *  - a query parameter of an `http` node's `config.url`;
 *  - a node's `connectorConfig.input`, walked to every depth (nested objects
 *    and arrays; an array element is judged under its parent's key).
 *
 * Every node of the flow is visited, including those nested in `try_catch` /
 * `loop` / `parallel` regions ({@link walkFlowNodes}), because the read path
 * serves a region node exactly as it serves a top-level one.
 *
 * ## Why an advisory, and why it names the connector route
 *
 * A flow definition is served to every member who can read flows, and these
 * three positions are open: the read projection that withholds the spec's
 * DECLARED credential slots cannot withhold a value here without also breaking
 * the round trip of every ordinary value. The supported home for an outbound
 * credential is a declarative connector, whose `auth.credentialRef` names a
 * secrets-layer reference resolved at boot and never stored in metadata
 * (ADR-0097 §3). So the author is told, at every authoring door, where the
 * credential belongs — and nothing is withheld or refused.
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

import { isCredentialShapedLiteral } from './credential-literal.js';
import { walkFlowNodes } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The rule id every finding of this rule carries. */
export const FLOW_CREDENTIAL_LITERAL = 'flow-credential-literal';

export interface FlowCredentialLiteralFinding {
  /** Always a warning — see the module note. The type keeps it that way. */
  severity: 'warning';
  rule: typeof FLOW_CREDENTIAL_LITERAL;
  /** `flow 'x' · node 'y' (http)`, with the region trail when the node is nested. */
  where: string;
  /** Config path of the entry, e.g. `flows[0].nodes[1].config.headers.Authorization`. */
  path: string;
  message: string;
  hint: string;
}

/**
 * [#22161] Who can read the value — the one clause all three positions share.
 * Why the read path cannot withhold it is `os explain flow-credential-literal`.
 */
const SERVED = 'readable by every member who can read flows';

/**
 * The route, short, in the VERDICT as well as in the hint: `os validate` and
 * `os build` print the hint as their `fix:` line, but `os lint`'s text face
 * prints it only under `--fix`, so a route stated only in the hint misses the
 * author who runs `os lint`.
 *
 * The hint carries the route BY SHAPE, to a static variant
 * `ConnectorInstanceAuthSchema` really has (`bearer` / `api-key` / `basic`): a
 * header credential goes to `bearer` or a header `api-key`, a query-string key
 * to `api-key` with `paramName`. Its other kinds (`oauth2`, `app-credential`,
 * `signed`) carry a grant or a signing key, not a value a literal moves into by
 * shape, so no hint routes to them; the explanation names them. ⛔ No variant carries a secret in a url PATH, so no text here
 * may promise that `credentialRef` can hold one — an author cannot follow it.
 * (This rule does not judge url paths; it judges query parameters only.)
 */
const STEER_CONNECTOR = "move it to a connector's `auth.credentialRef`";
const STEER_INPUT = 'drop it: the connector authenticates through `auth.credentialRef`';

/**
 * [#22161] One remedy line per position: the auth variant that holds the
 * credential and the node that calls the connector. Where `credentialRef`
 * resolves, the connector's `provider`, the Basic variant, that a `{variable}`
 * template draws nothing, that nothing is refused and the connector guide are
 * `os explain flow-credential-literal`.
 */
const HEADER_ROUTE =
  "Declare a `connectors:` entry with `auth: { type: 'bearer', credentialRef }` (or " +
  "`{ type: 'api-key', headerName, credentialRef }`) and call it from a `connector_action` node";

const QUERY_ROUTE =
  "Declare a `connectors:` entry with `auth: { type: 'api-key', paramName, credentialRef }`, which sends the " +
  'key as that query parameter, and call it from a `connector_action` node';

const INPUT_ROUTE =
  "Give the connector's `connectors:` entry `auth: { type: 'bearer' | 'api-key' | 'basic', credentialRef }` " +
  'and drop the credential from `input`';

/** A config-path segment for a map key: `.key` when it is an identifier, `["x-key"]` otherwise. */
function keySegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // A malformed escape is judged as written rather than dropped.
    return raw;
  }
}

/** The `name=value` pairs of a url's query string (fragment excluded). */
function queryParameters(url: string): Array<[string, string]> {
  const start = url.indexOf('?');
  if (start < 0) return [];
  const hash = url.indexOf('#', start);
  const query = url.slice(start + 1, hash < 0 ? undefined : hash);
  const out: Array<[string, string]> = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    out.push(eq < 0 ? [decode(part), ''] : [decode(part.slice(0, eq)), decode(part.slice(eq + 1))]);
  }
  return out;
}

/**
 * Every credential-shaped literal a flow serves as authored, one advisory each.
 * Pure; never throws on a malformed stack (a non-record flow, node, map or
 * input is skipped, not dereferenced).
 */
export function lintFlowCredentialLiterals(stack: AnyRec): FlowCredentialLiteralFinding[] {
  const findings: FlowCredentialLiteralFinding[] = [];

  recordsOf(stack.flows).forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' && flow.name ? flow.name : `#${flowIndex}`;

    for (const { node, path, regionTrail } of walkFlowNodes(flow, `flows[${flowIndex}]`)) {
      const nodeId = typeof node.id === 'string' && node.id ? node.id : '(unnamed node)';
      const nodeType = typeof node.type === 'string' && node.type ? node.type : 'node';
      const where = regionTrail
        ? `flow '${flowName}' · ${regionTrail} · node '${nodeId}' (${nodeType})`
        : `flow '${flowName}' · node '${nodeId}' (${nodeType})`;
      const report = (entryPath: string, what: string, steer: string, route: string): void => {
        findings.push({
          severity: 'warning',
          rule: FLOW_CREDENTIAL_LITERAL,
          where,
          path: entryPath,
          // [#22161] One verdict sentence; the three positions, the route by
          // auth variant and why it only warns are
          // `os explain flow-credential-literal`.
          message: `${what} holds a credential-shaped literal, ${SERVED}; ${steer}`,
          hint: route,
        });
      };

      if (node.type === 'http' && isRec(node.config)) {
        const { headers, url } = node.config;
        if (isRec(headers)) {
          for (const [name, value] of Object.entries(headers)) {
            if (!isCredentialShapedLiteral(name, value)) continue;
            report(`${path}.config.headers${keySegment(name)}`, `header '${name}'`, STEER_CONNECTOR, HEADER_ROUTE);
          }
        }
        if (typeof url === 'string') {
          for (const [name, value] of queryParameters(url)) {
            if (!isCredentialShapedLiteral(name, value)) continue;
            report(`${path}.config.url`, `url query parameter '${name}'`, STEER_CONNECTOR, QUERY_ROUTE);
          }
        }
      }

      const connectorConfig = node.connectorConfig;
      if (isRec(connectorConfig) && isRec(connectorConfig.input)) {
        const walk = (value: unknown, name: string, at: string, label: string, depth: number): void => {
          if (depth > 32) return;
          if (Array.isArray(value)) {
            value.forEach((item, i) => walk(item, name, `${at}[${i}]`, `${label}[${i}]`, depth + 1));
            return;
          }
          if (isRec(value)) {
            for (const [key, inner] of Object.entries(value)) {
              walk(inner, key, `${at}${keySegment(key)}`, label ? `${label}.${key}` : key, depth + 1);
            }
            return;
          }
          if (isCredentialShapedLiteral(name, value)) {
            report(at, `connector input '${label}'`, STEER_INPUT, INPUT_ROUTE);
          }
        };
        walk(connectorConfig.input, '', `${path}.connectorConfig.input`, '', 0);
      }
    }
  });

  return findings;
}
