// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type { McpToolDescriptor } from './mcp-connector.js';

/**
 * `providerConfig.toolsSnapshot` on a `provider: 'mcp'` instance: a pin on each
 * tool the instance depends on (ruling 6506797088 on the tool-snapshot card,
 * letter B). A record keyed by **tool name** — the key `include` uses, so the
 * two compose — whose value is the sha256 of that tool's definition as the
 * server serves it. On every materialization the selected tools are hashed and
 * compared one by one, so a server that rewrites a tool's description or
 * input schema (the "rug-pull" class) is reported by the tool's name instead of
 * being silently accepted.
 *
 * What is hashed — {@link mcpToolDigest}: the {@link canonicalJson} of the
 * object `{ name, description, inputSchema }` taken from the tool's `tools/list`
 * entry, encoded as UTF-8, sha256, lowercase hex. A member the server does not
 * send is left out of the object (it is not hashed as `null`).
 */
export type McpToolsSnapshot = Readonly<Record<string, string>>;

/** A sha256 digest as {@link mcpToolDigest} writes it: 64 lowercase hex characters. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Canonical JSON — the one serialization the pin is defined over:
 *
 *  - object members sorted by key in UTF-16 code-unit order (JavaScript's
 *    default string sort), recursively; a member whose value is `undefined` is
 *    omitted;
 *  - array elements kept in order;
 *  - strings, numbers, booleans and `null` written exactly as `JSON.stringify`
 *    writes them;
 *  - no whitespace anywhere.
 *
 * For any value parsed from JSON this is the RFC 8785 (JCS) serialization, so
 * an offline tool reproduces it with any JCS implementation, or with the rules
 * above.
 */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        // An `undefined` element is written as `null`, as JSON.stringify does.
        return `[${value.map((element) => (element === undefined ? 'null' : canonicalJson(element))).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const members = Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
        return `{${members.join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * The pin of one tool: sha256 (lowercase hex) of the UTF-8 {@link canonicalJson}
 * of `{ name, description, inputSchema }`, members the server does not send
 * left out.
 */
export function mcpToolDigest(tool: Pick<McpToolDescriptor, 'name' | 'description' | 'inputSchema'>): string {
    const pinned = { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
    return createHash('sha256').update(canonicalJson(pinned), 'utf8').digest('hex');
}

/**
 * The `toolsSnapshot` record for a set of tools, keyed by tool name — what an
 * author writes to pin them. The materialization check computes each value
 * with the same {@link mcpToolDigest}, so a record built here matches the
 * tools it was built from.
 */
export function computeMcpToolsSnapshot(tools: readonly McpToolDescriptor[]): Record<string, string> {
    const snapshot: Record<string, string> = {};
    for (const tool of tools) snapshot[tool.name] = mcpToolDigest(tool);
    return snapshot;
}

/**
 * Validate `providerConfig.toolsSnapshot`: absent ⇒ `undefined` (no pin);
 * otherwise a plain object whose every key is a non-empty tool name and whose
 * every value is a sha256 digest in lowercase hex. Any other shape is a
 * configuration fault, thrown plain before connecting, with `include`'s
 * message shape: a pin that dropped an entry it could not read would accept
 * the very rewrite it was written to catch.
 */
export function parseToolsSnapshot(raw: unknown, connectorName: string): McpToolsSnapshot | undefined {
    if (raw === undefined) return undefined;
    const problem = toolsSnapshotProblem(raw);
    if (problem !== undefined) {
        throw new Error(
            `connector-mcp provider: connector '${connectorName}' providerConfig.toolsSnapshot must be a record of ` +
                `tool name → sha256 digest (64 lowercase hex characters), one entry per pinned tool: ${problem}.`,
        );
    }
    return raw as McpToolsSnapshot;
}

/** What is wrong with a `toolsSnapshot` value, or `undefined` when it is well-formed. */
function toolsSnapshotProblem(raw: unknown): string | undefined {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return `got ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : `a ${typeof raw}`}`;
    }
    for (const [name, digest] of Object.entries(raw as Record<string, unknown>)) {
        if (name.length === 0) return 'an entry has an empty tool name';
        if (typeof digest !== 'string' || !SHA256_HEX.test(digest)) {
            return `the entry for '${name}' is not a sha256 hex digest`;
        }
    }
    return undefined;
}

/** How the served tools differ from a pin: each changed tool, and each pinned tool no longer served. */
export interface ToolsSnapshotDrift {
    /** Pinned tools the server serves with a different definition, with the digest it now serves. */
    readonly changed: ReadonlyArray<{ readonly name: string; readonly served: string }>;
    /** Pinned tools the server no longer serves. */
    readonly missing: readonly string[];
}

/**
 * Compare a pin with the served tools, **one tool at a time**: every pinned
 * name is looked up among `served` (the instance's selected tools, as the
 * server listed them) and its digest recomputed. A selected tool the pin does
 * not name is not compared — a tool the server adds is kept out by `include`.
 * Returns `undefined` when every pinned tool is served with its pinned
 * definition.
 */
export function compareToolsSnapshot(
    pin: McpToolsSnapshot,
    served: ReadonlyMap<string, McpToolDescriptor>,
): ToolsSnapshotDrift | undefined {
    const changed: Array<{ name: string; served: string }> = [];
    const missing: string[] = [];
    for (const [name, pinned] of Object.entries(pin)) {
        const tool = served.get(name);
        if (tool === undefined) {
            missing.push(name);
            continue;
        }
        const digest = mcpToolDigest(tool);
        if (digest !== pinned) changed.push({ name, served: digest });
    }
    return changed.length === 0 && missing.length === 0 ? undefined : { changed, missing };
}
