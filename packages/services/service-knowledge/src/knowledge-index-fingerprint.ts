// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The index fingerprint and the recipe hash (ADR-0161 K7; K8, item 8): the
 * two hashes the knowledge service computes, each in ONE function here, and
 * hands to the adapter on every call (`AdapterContext.index`,
 * `AdapterSearchOptions.index`).
 *
 * ## The fingerprint — may yesterday's vector be ranked against today's?
 *
 * Five components (K7):
 *
 * | Component | Read from |
 * |:--|:--|
 * | embedding model (with `variant`, an adapter option that changes stored vectors) | the adapter's `embedding` descriptor: what it reports for the embedder it calls |
 * | dimensions | the same descriptor |
 * | split configuration | the RESOLVED split (`strategy`, `maxChars`, `minChars`, the token budget) — the split that is applied, not the one that is written; absent for an adapter that does not take chunks, which splits for itself |
 * | split algorithm version | {@link SPLIT_ALGORITHM_VERSION}, the splitter's constant |
 * | content recipe | the source kind, the object, the ordered `content` list, and {@link ASSEMBLY_RULE_VERSION} |
 *
 * Model and dimensions are always what the adapter reports, never what the
 * deployment's settings say around it (K7, "Whose embedder"). An adapter that
 * reports no descriptor gives the fingerprint no model and no dimensions, so a
 * change of either cannot be seen for it (K7, rule 8).
 *
 * ## The recipe hash — what assembly reads that the fingerprint leaves out
 *
 * The source's `where`, its `metadataFields`, the title rule (the field the
 * title is read from, as it resolves now, and {@link TITLE_RULE_VERSION}), and
 * the fields an index may not carry as they resolve now (credential-class and
 * `internal`). None of them changes a vector, so a change is repaired by a
 * complete rebuild inside the same generation, not by a new one (K7, point 2).
 *
 * ## Over values, in a fixed order, pinned by a test (K7, rules 6 and 7)
 *
 * Both hashes are SHA-256 over a JSON body whose object keys are sorted, so
 * the same source and the same adapter give the same hash on every machine.
 * They hash values, never key spellings: a key rename changes neither. Both
 * are derived; no key on a source sets them. Pinned by
 * `__tests__/index-fingerprint.test.ts`, which holds the hash of a fixed input.
 */

import { createHash } from 'node:crypto';
import type { AdapterIndexExpectation, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { collectCredentialWriteResponseFields, collectInternalWriteResponseFields } from '@objectstack/core';
import { SPLIT_ALGORITHM_VERSION, type ResolvedSplit } from './split/index.js';
import { documentTitleField } from './knowledge-source-admission.js';

/** The fingerprint's prefix; bump it when what the fingerprint covers or how it serializes changes. */
export const INDEX_FINGERPRINT_VERSION = 'fp1';

/** The recipe hash's prefix; bump it when what the recipe hash covers or how it serializes changes. */
export const RECIPE_HASH_VERSION = 'rh1';

/**
 * The version of the assembly rule — how the listed content values become one
 * text (`recordToDocument`: each listed field's value, `'*'` as every string
 * field, joined by a blank line). Part of the content recipe. Bump it in the
 * change that makes assembly give another text for the same record and source.
 */
export const ASSEMBLY_RULE_VERSION = 1;

/**
 * The version of the title rule — how a document's title is read from its
 * record (`documentTitle`). Part of the recipe hash. Bump it in the change
 * that makes the same record give another title.
 */
export const TITLE_RULE_VERSION = 1;

/** What {@link computeIndexFingerprint} reads. */
export interface IndexFingerprintInput {
  source: KnowledgeSource;
  /** The adapter's `embedding` descriptor, read now. */
  embedding: IKnowledgeAdapter['embedding'];
  /** The split the service applies for this adapter; absent when the adapter does not take chunks. */
  split?: ResolvedSplit;
}

/** What {@link computeRecipeHash} reads. */
export interface RecipeHashInput {
  source: KnowledgeSource;
  /** The registered object definition of an object source, when the engine exposes one. */
  schema?: unknown;
}

/** The index fingerprint of a source under an adapter (ADR-0161 K7). */
export function computeIndexFingerprint(input: IndexFingerprintInput): string {
  const embedding = input.embedding;
  const split = input.split;
  return hashed(INDEX_FINGERPRINT_VERSION, {
    model: embedding?.model ?? null,
    variant: embedding?.variant ?? null,
    dimensions: embedding?.dimensions ?? null,
    split: split === undefined
      ? null
      : {
        strategy: split.strategy,
        maxChars: split.maxChars,
        minChars: split.minChars,
        maxTokens: split.maxTokens ?? null,
      },
    splitAlgorithm: split === undefined ? null : SPLIT_ALGORITHM_VERSION,
    recipe: contentRecipe(input.source),
  });
}

/** The recipe hash of a source (ADR-0161 K7, "The recipe hash"). */
export function computeRecipeHash(input: RecipeHashInput): string {
  const { source, schema } = input;
  if (source.source.kind !== 'object') {
    return hashed(RECIPE_HASH_VERSION, { kind: source.source.kind });
  }
  const objSource = source.source as ObjectKnowledgeSource;
  const withheld = [...new Set([
    ...collectCredentialWriteResponseFields(schema),
    ...collectInternalWriteResponseFields(schema),
  ])].sort();
  return hashed(RECIPE_HASH_VERSION, {
    where: objSource.where ?? null,
    metadataFields: objSource.metadataFields ?? [],
    title: { field: documentTitleField(schema) ?? null, rule: TITLE_RULE_VERSION },
    withheld,
  });
}

/** Both hashes, as the adapter is handed them. */
export function indexExpectation(fingerprint: IndexFingerprintInput, recipe: RecipeHashInput): AdapterIndexExpectation {
  return { fingerprint: computeIndexFingerprint(fingerprint), recipeHash: computeRecipeHash(recipe) };
}

/**
 * The content recipe (K7, point 2): what assembly reads to build the text.
 * For an object source, the object and the ORDERED content list — the order is
 * the order of the text. Another kind is not assembled by the service; its
 * recipe is its kind.
 */
function contentRecipe(source: KnowledgeSource): Record<string, unknown> {
  if (source.source.kind !== 'object') return { kind: source.source.kind };
  const objSource = source.source as ObjectKnowledgeSource;
  return {
    kind: 'object',
    object: objSource.object,
    content: [...objSource.contentFields],
    assembly: ASSEMBLY_RULE_VERSION,
  };
}

function hashed(prefix: string, body: unknown): string {
  return `${prefix}:${createHash('sha256').update(stableJson(body)).digest('hex')}`;
}

/** `JSON.stringify` with every plain object's keys sorted, and a bigint as its decimal text. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}
