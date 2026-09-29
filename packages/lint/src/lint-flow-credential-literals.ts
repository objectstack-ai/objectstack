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

/** Why the value is exposed — the same sentence for all three positions. */
const SERVED =
  'A flow definition is served, as authored, to every member who can read flows, so this value is ' +
  'readable by all of them';

/**
 * The route, in the MESSAGE and not only in the hint: `os validate` and `os lint`
 * print `where: message` on their text faces and leave the hint to `--json`, so
 * a route stated only in the hint never reaches the author who reads the terminal.
 *
 * Routed BY SHAPE, to a variant `ConnectorInstanceAuthSchema` really has
 * (`none` / `bearer` / `api-key` / `basic`): a header credential goes to
 * `bearer` or a header `api-key`, a query-string key to `api-key` with
 * `paramName`. ⛔ No variant carries a secret in a url PATH, so no text here
 * may promise that `credentialRef` can hold one — an author cannot follow it.
 * (This rule does not judge url paths; it judges query parameters only.)
 */
const STEER_HEADER =
  "; move it to a declarative connector whose `auth` is `bearer` or `api-key` (a header), with " +
  '`auth.credentialRef` naming the secret, called from a `connector_action` node.';
const STEER_QUERY =
  "; move it to a declarative connector whose `auth` is `api-key` with `paramName` (the query parameter), " +
  'with `auth.credentialRef` naming the secret, called from a `connector_action` node.';
const STEER_INPUT = "; drop it from `input` — the connector authenticates through its own `auth.credentialRef`.";

/** Where `credentialRef` resolves — stated once, in every hint. */
const RESOLVES =
  ' `credentialRef` names a secrets-layer reference that is resolved at boot (an environment variable in ' +
  'the open tier), so the secret never lands in metadata.';

const HEADER_ROUTE =
  "Declare a `connectors:` entry with a `provider` (`'rest'` for a plain HTTP API) and " +
  "`auth: { type: 'bearer', credentialRef }` for a bearer token, or " +
  "`auth: { type: 'api-key', headerName, credentialRef }` for a key in a named header (a Basic pair is " +
  "`auth: { type: 'basic', username, credentialRef }`), and call it from a `connector_action` node." +
  RESOLVES;

const QUERY_ROUTE =
  "Declare a `connectors:` entry with a `provider` (`'rest'` for a plain HTTP API) and " +
  "`auth: { type: 'api-key', paramName, credentialRef }`, which sends the key as that query parameter, and " +
  'call it from a `connector_action` node.' +
  RESOLVES;

const INPUT_ROUTE =
  'The connector authenticates through its own declaration: give its `connectors:` entry ' +
  "`auth: { type: 'bearer' | 'api-key' | 'basic', credentialRef }` and drop the credential from `input`." +
  RESOLVES;

const NOT_A_GATE =
  ' A `{variable}` template is not a literal and draws nothing. This is an advisory: nothing is ' +
  'refused. See content/docs/automation/connectors.mdx.';

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
          message: `${what} holds a literal value that reads as a credential. ${SERVED}${steer}`,
          hint: `${route}${NOT_A_GATE}`,
        });
      };

      if (node.type === 'http' && isRec(node.config)) {
        const { headers, url } = node.config;
        if (isRec(headers)) {
          for (const [name, value] of Object.entries(headers)) {
            if (!isCredentialShapedLiteral(name, value)) continue;
            report(`${path}.config.headers${keySegment(name)}`, `header '${name}'`, STEER_HEADER, HEADER_ROUTE);
          }
        }
        if (typeof url === 'string') {
          for (const [name, value] of queryParameters(url)) {
            if (!isCredentialShapedLiteral(name, value)) continue;
            report(`${path}.config.url`, `the url's query parameter '${name}'`, STEER_QUERY, QUERY_ROUTE);
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
