// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RFC 8785 — the JSON Canonicalization Scheme (JCS), ADR-0154 D1.
 *
 * Every byte the sealer hashes or signs is the JCS form of a JSON value: a
 * row's leaf input, a value under commitment, a checkpoint's or an
 * amendment's signed body. One serialization, written once here, so the
 * sealer, the verifier and an offline bundle check cannot drift apart.
 *
 * What RFC 8785 asks, and how this file meets it:
 *
 *  - **Numbers** in the ECMAScript `Number.prototype.toString` form, which is
 *    what `JSON.stringify` writes for a finite number (`1e+21`, `-0` → `0`).
 *    A non-finite number has no JSON form and is refused.
 *  - **Strings** escaped as `JSON.stringify` escapes them, which is the RFC's
 *    own definition. A string holding an unpaired surrogate is refused (RFC
 *    8785 §3.2.2.2 works on I-JSON, which forbids them).
 *  - **Object members** sorted by their names' UTF-16 code units, which is
 *    the default order of `Array.prototype.sort` on strings.
 *  - **No whitespace.**
 *
 * ⛔ Refused rather than coerced: `undefined`, a function, a symbol, a bigint,
 * and any object that is not a plain object or an array (a `Date`, a
 * `Buffer`). A value that reaches this file in such a shape was not put into
 * canonical form first, and guessing a spelling here is exactly the silent
 * divergence between two stores the canonical form exists to remove.
 */

/** A value JCS cannot serialize, named with where it sits. */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * How a refusal says where it sits. By default a member is named by its name
 * (`$.a.b[0]`); with `opaqueNames` by its position in sorted order (`$.#0.#1[0]`),
 * for a value whose member names are themselves payload — a committed column's
 * JSON (round-1 n2 of #31908's P1a record): a refusal is logged, and must not
 * carry what the commitment keeps off the checkpoint.
 */
export interface CanonicalJsonOptions {
  /** Where the value sits, as the refusal's path prefix. Default `$`. */
  readonly at?: string;
  /** Name members by sorted position instead of by name in a refusal's path. */
  readonly opaqueNames?: boolean;
}

function write(value: unknown, at: string, opaqueNames: boolean): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`${at}: a non-finite number has no JSON form`);
      return JSON.stringify(value);
    case 'string':
      if (UNPAIRED_SURROGATE.test(value)) throw new CanonicalJsonError(`${at}: a string holds an unpaired surrogate`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item, i) => write(item, `${at}[${i}]`, opaqueNames)).join(',')}]`;
      if (!isPlainObject(value)) {
        throw new CanonicalJsonError(`${at}: a ${value.constructor?.name ?? 'non-plain'} object is not JSON; canonicalize it first`);
      }
      const names = Object.keys(value).sort();
      const members: string[] = [];
      names.forEach((name, index) => {
        if (UNPAIRED_SURROGATE.test(name)) throw new CanonicalJsonError(`${at}: a member name holds an unpaired surrogate`);
        members.push(`${JSON.stringify(name)}:${write(value[name], opaqueNames ? `${at}.#${index}` : `${at}.${name}`, opaqueNames)}`);
      });
      return `{${members.join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(`${at}: a ${typeof value} is not JSON`);
  }
}

/** The RFC 8785 serialization of `value`. Throws {@link CanonicalJsonError} on anything that is not JSON. */
export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  return write(value, options.at ?? '$', options.opaqueNames === true);
}

/** The UTF-8 bytes of {@link canonicalJson} — what is hashed and signed. */
export function canonicalJsonBytes(value: unknown, options: CanonicalJsonOptions = {}): Buffer {
  return Buffer.from(canonicalJson(value, options), 'utf8');
}
