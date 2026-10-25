// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * connector-input-fields — turn a connector action descriptor's `inputSchema`
 * into the typed Input fields of a committed `connector_action` node (#4305).
 *
 * Before this, the Input section was a single generic key/value repeater: the
 * descriptor published a JSON Schema for the action's inputs and nothing in
 * `app-shell` read it, so an author typed raw key names against a contract the
 * designer already knew.
 *
 * ## One resolver, not a second field generator
 *
 * The mapping itself is {@link jsonSchemaToFlowFields} — the same engine-schema
 * resolver the inspector already uses for a node type's published `configSchema`.
 * The descriptor's input language is the same language (measured below), so this
 * module adds no interpreter: it only RE-ROOTS the resolver's output, because
 * that resolver hard-roots every field it emits at `['config', <key>]` while a
 * connector's inputs live in the spec-structured sibling block
 * `node.connectorConfig.input` ({@link CONNECTOR_INPUT_PATH}) — which is what the
 * executor reads (`service-automation` `connector-nodes.ts`:
 * `handler((cfg.input ?? {}) as Record<string, unknown>, handlerCtx)`).
 *
 * Anything the resolver declines to map (an `array` with no `items`, a bare
 * `{type:'object'}`, a union) is simply not claimed here either — it stays
 * editable in the repeater, so no descriptor can make a stored key unreachable.
 *
 * ## The measured schema language
 *
 * `ConnectorActionDescriptor.inputSchema` is `Record<string, unknown>` typed and
 * documented as JSON Schema (`@objectstack/spec`
 * `integration/connector-descriptor.ts`), and the engine projects it VERBATIM
 * from the connector's authored `ConnectorActionSchema.inputSchema`. Every
 * shipped connector emits a plain object schema:
 *   • slack    `{type:'object', required:['channel'], properties:{…string/array}}`
 *   • rest     `{type:'object', properties:{ method, path, headers:{type:'object'}, … }}`
 *   • openapi  `{type:'object', properties:{ path|query|header:{type:'object',properties}, body }, required}`
 *   • mcp      the MCP tool's own `inputSchema`, passed straight through
 *
 * ⚠️ This is NOT the flow-node dialect of the same word: `flow.nodes[].inputSchema`
 * (spec `automation/flow.zod.ts`) is `Record<string, {type, required, description}>`
 * — a per-key `required: true` map, not JSON Schema. They are different contracts
 * that share a name; only the descriptor one is read here.
 *
 * ## additionalProperties — measured, then followed
 *
 * No shipped connector emits `additionalProperties` at all, and JSON Schema's
 * default for an absent one is OPEN. The runtime agrees: the executor passes the
 * whole input map to the handler unvalidated, so undeclared keys really are
 * accepted. So the rule is the JSON-Schema rule — CLOSED iff
 * `additionalProperties === false`, OPEN otherwise (absent, `true`, or a value
 * schema) — and an open schema keeps the repeater alongside the typed fields for
 * exactly the keys the typed fields don't own.
 *
 * A closed schema drops the repeater, EXCEPT when the stored map already holds
 * undeclared keys: this package's standing rule is that a field is shown when it
 * holds a stored value "so existing config is never hidden"
 * ({@link isFieldVisible}), and silently hiding a key an older flow committed
 * would be worse than offering an editor the new schema no longer invites.
 *
 * NOT represented: JSON Schema `required`. `FlowConfigField` has no requiredness
 * concept, so the typed fields cannot mark it — a descriptor's `required: [...]`
 * is read by the engine at dispatch, not enforced in this form.
 */

import * as React from 'react';
import { jsonSchemaToFlowFields } from './json-schema-to-fields.js';
import type { FlowConfigField } from './flow-node-config.js';
import { apiBase } from '../previews/useFlowNodePalette.js';

/** Where a connector node's mapped inputs live on the node (spec-structured). */
export const CONNECTOR_INPUT_PATH: readonly string[] = ['connectorConfig', 'input'];

/** Field-id prefix for the re-rooted inputs — matches the `block.key` convention. */
const ID_PREFIX = CONNECTOR_INPUT_PATH.join('.');

/** The id of the generic Input repeater this form replaces / trims. */
export const CONNECTOR_INPUT_FIELD_ID = ID_PREFIX;

/** A descriptor's input contract, resolved into inspector fields. */
export interface ConnectorInputForm {
  /** Typed fields, rooted at `connectorConfig.input.*`, in schema order. */
  fields: FlowConfigField[];
  /**
   * The top-level input keys the typed fields own — i.e. the keys the extras
   * repeater must NOT re-offer. Derived from the fields actually emitted, so a
   * property the resolver declined is absent here and stays repeater-editable.
   */
  declaredKeys: string[];
  /** Whether undeclared keys are accepted (`additionalProperties !== false`). */
  open: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Find one action's `inputSchema` in a `GET /automation/connectors` payload
 * (already unwrapped to the connector array). Returns undefined for any miss —
 * unknown connector, unknown action, or an action that declares none — so the
 * caller simply keeps the generic repeater.
 */
export function connectorActionInputSchema(
  connectors: unknown,
  connectorName: string | undefined,
  actionKey: string | undefined,
): unknown {
  if (!Array.isArray(connectors) || !connectorName || !actionKey) return undefined;
  const connector = connectors.find(
    (c) => isPlainObject(c) && c.name === connectorName,
  ) as Record<string, unknown> | undefined;
  if (!connector || !Array.isArray(connector.actions)) return undefined;
  const action = connector.actions.find(
    (a) => isPlainObject(a) && a.key === actionKey,
  ) as Record<string, unknown> | undefined;
  const schema = action?.inputSchema;
  return isPlainObject(schema) ? schema : undefined;
}

/** Re-root one resolver field from `config.*` onto `connectorConfig.input.*`. */
function reroot(field: FlowConfigField): FlowConfigField {
  const out: FlowConfigField = {
    ...field,
    id: `${ID_PREFIX}.${field.id}`,
    // Drop the resolver's `config` root, keep the key (and any flattened
    // sub-key) it appended.
    path: [...CONNECTOR_INPUT_PATH, ...field.path.slice(1)],
  };
  // A gated group's `showWhen` names its controller BY ID, so it has to follow
  // the same re-rooting or it would point at a field that no longer exists.
  if (field.showWhen) {
    out.showWhen = { ...field.showWhen, field: `${ID_PREFIX}.${field.showWhen.field}` };
  }
  return out;
}

/**
 * Resolve a descriptor `inputSchema` into the Input section's typed fields, or
 * `null` when it is not a usable object schema (so the caller keeps the generic
 * repeater unchanged).
 */
export function connectorInputFields(schema: unknown): ConnectorInputForm | null {
  const raw = jsonSchemaToFlowFields(schema);
  if (!raw || raw.length === 0) return null;
  const fields = raw.map(reroot);
  // The owned key is the first segment after `connectorConfig.input` — so a
  // flattened group (`…input.retry.attempts`) is claimed by `retry`, once.
  const declaredKeys: string[] = [];
  for (const f of fields) {
    const key = f.path[CONNECTOR_INPUT_PATH.length];
    if (key && !declaredKeys.includes(key)) declaredKeys.push(key);
  }
  const additional = isPlainObject(schema) ? (schema as { additionalProperties?: unknown }).additionalProperties : undefined;
  return { fields, declaredKeys, open: additional !== false };
}

/**
 * The stored input keys the typed fields do NOT own — what the repeater edits
 * once a schema is in play. A non-object (or absent) stored value has none: the
 * array form some key/value fields tolerate is not a legal connector input
 * (spec: `input: z.record(z.string(), z.unknown())`), and is left wholly alone.
 */
export function connectorInputExtras(
  stored: unknown,
  declaredKeys: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(stored)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (!declaredKeys.includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Fold an edited extras map back into the full stored input map — the round-trip
 * contract. The repeater's own commit REPLACES whatever it was given, so handing
 * it the extras subset without this merge would drop every typed key on the
 * first extras edit.
 *
 * Stored key ORDER is preserved (declared keys keep their values and positions,
 * edited extras keep theirs, removed extras drop out, new ones append) so an
 * untouched key is written back exactly as it was read.
 */
export function mergeConnectorInputExtras(
  stored: unknown,
  extras: Record<string, unknown>,
  declaredKeys: readonly string[],
): Record<string, unknown> | undefined {
  const base = isPlainObject(stored) ? stored : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (declaredKeys.includes(k)) out[k] = v;
    else if (Object.prototype.hasOwnProperty.call(extras, k)) out[k] = extras[k];
  }
  for (const [k, v] of Object.entries(extras)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Splice a resolved form into a node's field list, replacing the generic Input
 * repeater IN PLACE (so the connector / action pickers above it and `timeoutMs`
 * below it keep their positions).
 *
 * The repeater is kept after the typed fields when the schema is open, or when
 * the stored map still holds undeclared keys (never hide existing config); it
 * then carries `omitKeys` so it edits only what the typed fields don't own.
 * Returns the input array unchanged (same reference) when there is nothing to do.
 */
export function applyConnectorInputForm(
  fields: FlowConfigField[],
  form: ConnectorInputForm | null,
  storedInput?: unknown,
): FlowConfigField[] {
  if (!form) return fields;
  // The array form is not a legal connector input; typed fields would have to
  // objectify it to write, so the whole map is left to the repeater instead.
  if (Array.isArray(storedInput)) return fields;
  const at = fields.findIndex((f) => f.id === CONNECTOR_INPUT_FIELD_ID);
  if (at === -1) return fields;
  const repeater = fields[at];
  const hasExtras = Object.keys(connectorInputExtras(storedInput, form.declaredKeys)).length > 0;
  const keepRepeater = form.open || hasExtras;
  return [
    ...fields.slice(0, at),
    ...form.fields,
    ...(keepRepeater ? [{ ...repeater, omitKeys: form.declaredKeys }] : []),
    ...fields.slice(at + 1),
  ];
}

/**
 * The runtime connector registry (`GET /api/v1/automation/connectors`) — the
 * same list the connector / action pickers follow, so the Input section can only
 * ever type itself from a descriptor those pickers would also offer.
 *
 * `enabled === false` skips the fetch entirely (the hook stays unconditional).
 * Any failure degrades to `[]`, which resolves to no schema and therefore to the
 * unchanged generic repeater — offline, older backend, or plugin absent.
 */
export function useConnectorRegistry(enabled: boolean): unknown[] {
  const [connectors, setConnectors] = React.useState<unknown[]>([]);

  React.useEffect(() => {
    // No synchronous reset on the disabled edge: setting state straight from an
    // effect body cascades a render, and there is nothing to reset for — with no
    // committed connector/action, `connectorActionInputSchema` resolves to
    // undefined regardless of what this list still holds, so the Input section
    // falls back to the generic repeater either way.
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/automation/connectors`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          data?: { connectors?: unknown[] };
          connectors?: unknown[];
        };
        const list = payload?.data?.connectors ?? payload?.connectors ?? [];
        if (!cancelled && Array.isArray(list)) setConnectors(list);
      } catch {
        /* offline / aborted — the generic repeater stays */
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled]);

  return connectors;
}
