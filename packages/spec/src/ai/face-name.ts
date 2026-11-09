// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI face name: the one flat name a tool, a skill, an agent or an action
 * is listed under on an MCP server and handed to a model provider
 * (ADR-0150 D6, ruled Q1 = A with the object-action refinement).
 *
 * MCP requires one unique name per tool and per prompt on a server, and the
 * providers that consume them admit only letters, digits, `_` and `-` in a
 * tool name, at most 64 characters. A face is therefore derived from the
 * item's address, never authored (ADR-0028 D2's "derived physical name"):
 *
 * | Item | Face | Example |
 * |:--|:--|:--|
 * | a package's tool, skill, agent or object-less action | `NS-NAME` | `crm-qualify_lead` |
 * | an action bound to an object (any holder) | `OBJECT-ACTION` | `crm_lead-convert_lead` |
 * | an environment-authored tool, skill, agent or object-less action | `NAME` | `qualify_lead` |
 *
 * An object-bound action never repeats the namespace: the object name already
 * carries the package's literal prefix (ADR-0129), and one package may bind
 * the same action name to several objects, so `NS-NAME` would not name one
 * action. No namespace, object name or item name contains `-`, so an uncut
 * face splits at its only `-`; whether the left part is a namespace or an
 * object is the server catalogue's answer, and child K's predicate
 * (`findNamespaceObjectNameClashes`, `kernel/namespace-prefix.ts`) keeps the
 * two from ever being the same string.
 *
 * This module derives; it registers nothing. The face list's duplicate
 * refusal (the 64-character boundary, a cross-type collision such as the
 * cloud's `action_` prefix, a hash collision) is the carrier's (G2 for the MCP
 * server, C for the cloud's action tools), which call {@link deriveAiFaceName}.
 */

/** The longest face a provider admits; a face of exactly this length is not cut. */
export const AI_FACE_NAME_MAX_LENGTH = 64;

/** The characters of the uncut face a cut face keeps, before the separator and the hash. */
export const AI_FACE_NAME_CUT_LENGTH = 55;

/** The separator between a face's two parts, and before the hash of a cut face. */
export const AI_FACE_NAME_SEPARATOR = '-';

/** The hex characters of the hash a cut face ends with. */
export const AI_FACE_NAME_HASH_LENGTH = 8;

/** The address a face is derived from. */
export interface AiFaceAddress {
  /** The item's name: the tool, skill or agent name, or the action name. */
  readonly name: string;
  /** The manifest namespace of the package that holds the item; absent for an environment item. */
  readonly namespace?: string | null;
  /** The object an action is bound to; set only for an object-bound action. */
  readonly objectName?: string | null;
}

/**
 * FNV-1a, 32-bit, over the UTF-8 bytes of `text`, as 8 lowercase hex
 * characters. Not cryptographic, and it need not be: the hash only keeps two
 * long faces that share their first 55 characters apart, and the face list
 * refuses the rare collision by name. Spec runs in the browser and the
 * server alike and the derivation is synchronous, so a `node:crypto` digest
 * is not available here; FNV-1a 32 is the isomorphic hash the tree already
 * uses (`service-settings`' `fnv32:` digest, `service-messaging`'s backoff).
 */
function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(AI_FACE_NAME_HASH_LENGTH, '0');
}

/**
 * Derive an item's AI face name (ADR-0150 D6).
 *
 * `OBJECT-ACTION` when `objectName` is set, else `NS-NAME` when `namespace`
 * is set, else the bare `NAME`. A face longer than
 * {@link AI_FACE_NAME_MAX_LENGTH} keeps its first
 * {@link AI_FACE_NAME_CUT_LENGTH} characters, then
 * {@link AI_FACE_NAME_SEPARATOR} and {@link AI_FACE_NAME_HASH_LENGTH} hex
 * characters of FNV-1a 32 over the UTF-8 bytes of the whole uncut face, so
 * every server derives the same 64-character name. A cut face no longer
 * splits back into its parts; the server's catalogue resolves it.
 */
export function deriveAiFaceName(address: AiFaceAddress): string {
  const left = address.objectName || address.namespace;
  const face = left ? `${left}${AI_FACE_NAME_SEPARATOR}${address.name}` : address.name;
  if (face.length <= AI_FACE_NAME_MAX_LENGTH) return face;
  return `${face.slice(0, AI_FACE_NAME_CUT_LENGTH)}${AI_FACE_NAME_SEPARATOR}${fnv1a32Hex(face)}`;
}
