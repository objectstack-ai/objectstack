// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Parameter serialization for the OpenAPI connector — the OpenAPI 3.x
 * Parameter Object's `style` / `explode` (its Style Values and Style Examples
 * tables), read for each parameter the action sends.
 *
 * A parameter value that is not a scalar is never passed through `String()`:
 * an object would go out as `[object Object]` and an array as a comma list,
 * whatever the document declares, and the upstream answers a request it was
 * never meant to receive. Every value is instead encoded by the style its
 * parameter declares, or by the OpenAPI 3.x default for its location when it
 * declares none (`query` → `form`, `path` / `header` → `simple`; `explode`
 * defaults to true for `form` and to false for every other style).
 *
 * Two places refuse, both loudly:
 *
 *   - **materialization** ({@link resolveParameterEncoding}) — a parameter
 *     whose `style` OpenAPI 3.x does not define for its location (`deepObject`
 *     on a path parameter, `form` on a header), or whose `style` / `explode` is
 *     not a string / boolean: the document is malformed, and guessing an
 *     encoding for it is how a wrong request gets sent with no error;
 *   - **dispatch** ({@link ParameterValueError}) — a value whose shape the
 *     declared style defines no encoding for (an object for `spaceDelimited`
 *     with `explode: true`, an array of objects for `form`, any non-scalar for
 *     a `content`-typed parameter, which carries no style).
 *
 * `deepObject` is defined by OpenAPI 3.x for an object of scalars
 * (`created[gte]=1700000000`). For an array and for a nested value, the
 * connector applies the same rule to the value's own keys — each object key or
 * array index in its own brackets (`expand[0]=a&expand[1]=b`,
 * `metadata[a][b]=c`) — the nesting the bracket query parsers that read
 * `deepObject` (PHP, Rails, `qs`) decode. Stripe's list operations declare
 * `expand` as an array with `style: deepObject`.
 *
 * Encoding: a query pair is appended through `URLSearchParams`, so names,
 * values and the style's delimiters are percent-encoded the way a scalar has
 * always been (`application/x-www-form-urlencoded`: a space is `+`, `[` is
 * `%5B`, `,` is `%2C`); a path value is encoded with `encodeURIComponent`, its
 * style's delimiters (`,` `.` `;` `=`) left literal; a header value is sent as
 * text.
 */

import type { OpenApiParameter } from './openapi-connector.js';

/** The parameter locations the connector sends from an action's input. */
export type SentParameterLocation = 'path' | 'query' | 'header';

/** The `style` values OpenAPI 3.x defines, per location (its Style Values table). */
const STYLES_BY_LOCATION: Readonly<Record<SentParameterLocation, readonly string[]>> = {
    path: ['simple', 'label', 'matrix'],
    query: ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'],
    header: ['simple'],
};

/** The default `style` per location when a parameter declares none. */
const DEFAULT_STYLE: Readonly<Record<SentParameterLocation, string>> = {
    path: 'simple',
    query: 'form',
    header: 'simple',
};

/** How one parameter is encoded on the wire. */
export interface ParameterEncoding {
    name: string;
    in: SentParameterLocation;
    style: string;
    explode: boolean;
    /** A `content`-typed parameter (`content` instead of `schema`): no style, a scalar sent as is. */
    content: boolean;
}

/** The encoding of a parameter the document does not declare: its location's default. */
export function defaultParameterEncoding(name: string, where: SentParameterLocation): ParameterEncoding {
    const style = DEFAULT_STYLE[where];
    return { name, in: where, style, explode: style === 'form', content: false };
}

/**
 * Read a declared parameter's encoding, refusing a `style` / `explode` the
 * connector cannot honour (see the file header). `operation` names the
 * operation in the refusal (`GET /v1/invoices (GetInvoices)`).
 */
export function resolveParameterEncoding(p: OpenApiParameter, operation: string): ParameterEncoding {
    const where = p.in as SentParameterLocation;
    const declared = p as { style?: unknown; explode?: unknown; content?: unknown };
    const subject = `operation ${operation} ${where} parameter '${p.name}'`;
    const content = declared.content !== undefined && p.schema === undefined;
    let style = DEFAULT_STYLE[where];
    if (declared.style !== undefined) {
        if (typeof declared.style !== 'string' || !STYLES_BY_LOCATION[where].includes(declared.style)) {
            throw new Error(
                `createOpenApiConnector: ${subject} declares style ${JSON.stringify(declared.style)}, which OpenAPI 3.x ` +
                    `does not define for a ${where} parameter (defined: ${STYLES_BY_LOCATION[where].join(', ')}), so no ` +
                    `encoding of its value can be chosen. Correct the document, or leave the operation out of the ` +
                    `connector's include allowlist.`,
            );
        }
        style = declared.style;
    }
    if (declared.explode !== undefined && typeof declared.explode !== 'boolean') {
        throw new Error(
            `createOpenApiConnector: ${subject} declares explode ${JSON.stringify(declared.explode)}; OpenAPI 3.x ` +
                `explode is a boolean. Correct the document, or leave the operation out of the connector's include allowlist.`,
        );
    }
    const explode = typeof declared.explode === 'boolean' ? declared.explode : style === 'form';
    return { name: p.name, in: where, style, explode, content };
}

/**
 * A dispatch-time refusal: the value the action's input supplies has a shape
 * the parameter's declared style defines no encoding for. Thrown before any
 * request is sent, so the `connector_action` step fails naming the parameter.
 */
export class ParameterValueError extends Error {
    constructor(encoding: ParameterEncoding, shape: string) {
        const how = encoding.content
            ? 'a content-typed parameter, which is sent as the scalar text the input supplies'
            : `style '${encoding.style}' with explode ${encoding.explode}`;
        super(
            `connector-openapi: ${encoding.in} parameter '${encoding.name}' was given ${shape}, which ${how} defines ` +
                `no encoding for; nothing was sent. Supply the shape the parameter's schema declares.`,
        );
        this.name = 'ParameterValueError';
    }
}

type Scalar = string | number | boolean | bigint;

function isScalar(v: unknown): v is Scalar {
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint';
}

/** The only place a value becomes text: a scalar, never an object or array. */
function text(v: Scalar): string {
    return String(v);
}

function isAbsent(v: unknown): v is null | undefined {
    return v === undefined || v === null;
}

function shapeOf(v: unknown): string {
    if (Array.isArray(v)) return 'an array';
    if (v && typeof v === 'object') return 'an object';
    return `a ${typeof v}`;
}

/** An array's present elements, each required to be a scalar. */
function scalarItems(encoding: ParameterEncoding, list: readonly unknown[]): string[] {
    const out: string[] = [];
    for (const item of list) {
        if (isAbsent(item)) continue;
        if (!isScalar(item)) throw new ParameterValueError(encoding, `an array holding ${shapeOf(item)}`);
        out.push(text(item));
    }
    return out;
}

/** An object's present entries, each value required to be a scalar. */
function scalarEntries(encoding: ParameterEncoding, rec: Record<string, unknown>): [string, string][] {
    const out: [string, string][] = [];
    for (const [k, v] of Object.entries(rec)) {
        if (isAbsent(v)) continue;
        if (!isScalar(v)) throw new ParameterValueError(encoding, `an object whose '${k}' is ${shapeOf(v)}`);
        out.push([k, text(v)]);
    }
    return out;
}

/** The `deepObject` flattening: every key or index bracketed, recursively. */
function deepPairs(encoding: ParameterEncoding, prefix: string, value: unknown, out: [string, string][]): void {
    if (isAbsent(value)) return;
    if (isScalar(value)) {
        out.push([prefix, text(value)]);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, i) => deepPairs(encoding, `${prefix}[${i}]`, item, out));
        return;
    }
    if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) deepPairs(encoding, `${prefix}[${k}]`, v, out);
        return;
    }
    throw new ParameterValueError(encoding, shapeOf(value));
}

/**
 * The query pairs one parameter contributes, in order — empty when the value
 * is absent, or an array / object with no present entries (RFC 6570: an empty
 * list or map is undefined).
 */
export function serializeQueryParameter(encoding: ParameterEncoding, value: unknown): [string, string][] {
    const { name, style, explode } = encoding;
    if (isAbsent(value)) return [];
    if (isScalar(value)) return [[name, text(value)]];
    if (encoding.content) throw new ParameterValueError(encoding, shapeOf(value));
    if (style === 'deepObject') {
        const out: [string, string][] = [];
        deepPairs(encoding, name, value, out);
        return out;
    }
    if (Array.isArray(value)) {
        const items = scalarItems(encoding, value);
        if (items.length === 0) return [];
        if (explode) return items.map((item) => [name, item]);
        return [[name, items.join(DELIMITER[style])]];
    }
    if (typeof value === 'object') {
        const entries = scalarEntries(encoding, value as Record<string, unknown>);
        if (entries.length === 0) return [];
        if (style === 'form' && explode) return entries;
        if (explode) throw new ParameterValueError(encoding, 'an object');
        return [[name, entries.flat().join(DELIMITER[style])]];
    }
    throw new ParameterValueError(encoding, shapeOf(value));
}

/** The value delimiter of each non-exploded query style. */
const DELIMITER: Readonly<Record<string, string>> = { form: ',', spaceDelimited: ' ', pipeDelimited: '|' };

/**
 * The path segment text that replaces one `{name}` template — `undefined` when
 * the value is absent (the template is left as it is), or an empty array /
 * object.
 */
export function serializePathParameter(encoding: ParameterEncoding, value: unknown): string | undefined {
    const { style, explode } = encoding;
    const name = encodeURIComponent(encoding.name);
    if (isAbsent(value)) return undefined;
    let items: string[];
    let pairs: [string, string][] | undefined;
    if (isScalar(value)) {
        items = [encodeURIComponent(text(value))];
    } else if (encoding.content) {
        throw new ParameterValueError(encoding, shapeOf(value));
    } else if (Array.isArray(value)) {
        items = scalarItems(encoding, value).map(encodeURIComponent);
    } else if (typeof value === 'object') {
        pairs = scalarEntries(encoding, value as Record<string, unknown>).map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]);
        items = pairs.map(([k, v]) => (explode ? `${k}=${v}` : `${k},${v}`));
    } else {
        throw new ParameterValueError(encoding, shapeOf(value));
    }
    if (items.length === 0) return undefined;
    const isList = !isScalar(value);
    switch (style) {
        case 'label':
            return `.${items.join(explode && isList ? '.' : ',')}`;
        case 'matrix':
            if (!isList) return `;${name}=${items[0]}`;
            if (!explode) return `;${name}=${items.join(',')}`;
            // Exploded: an array repeats the name, an object names each key.
            return pairs ? pairs.map(([k, v]) => `;${k}=${v}`).join('') : items.map((item) => `;${name}=${item}`).join('');
        default:
            return items.join(',');
    }
}

/** The header value one parameter sends — `undefined` when there is nothing to send. */
export function serializeHeaderParameter(encoding: ParameterEncoding, value: unknown): string | undefined {
    if (isAbsent(value)) return undefined;
    if (isScalar(value)) return text(value);
    if (encoding.content) throw new ParameterValueError(encoding, shapeOf(value));
    if (Array.isArray(value)) {
        const items = scalarItems(encoding, value);
        return items.length === 0 ? undefined : items.join(',');
    }
    if (typeof value === 'object') {
        const entries = scalarEntries(encoding, value as Record<string, unknown>);
        if (entries.length === 0) return undefined;
        return entries.map(([k, v]) => (encoding.explode ? `${k}=${v}` : `${k},${v}`)).join(',');
    }
    throw new ParameterValueError(encoding, shapeOf(value));
}
