// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4 · ADR-0078] A deployment that holds `knowledge_source` items
 * and mounts no knowledge service says so once at boot.
 *
 * A `knowledge_source` item is loaded by its one reader, the knowledge
 * service's plugin (`@objectstack/service-knowledge`). Where that plugin is
 * not in the composition the item still parses, publishes and is listed in
 * Studio, and nothing indexes or searches it: the valid-and-inert shape
 * ADR-0078 says must be loud. The reader cannot say so itself — it is the
 * thing that is missing — so the plugin that serves the metadata protocol
 * does, beside the same statement for `queues` and `assignmentRules`
 * (`describeMissingOwnershipQueueService`).
 *
 * A statement at `warn`, never a boot refusal: a package may ship a source to
 * a deployment that chose not to run retrieval, and its objects, pages and
 * flows must keep serving there.
 */

import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';

/** The metadata type of a knowledge source. */
const KNOWLEDGE_SOURCE_TYPE = 'knowledge_source';

/** How many item names the statement spells out before it counts the rest. */
export const UNSERVED_KNOWLEDGE_SOURCES_NAMED = 5;

/**
 * The statement for `names` (the published `knowledge_source` items), or
 * `null` when there is nothing to say: no item, or a knowledge service is
 * registered.
 */
export function describeUnservedKnowledgeSources(names: readonly string[], serviceRegistered: boolean): string | null {
  if (serviceRegistered || names.length === 0) return null;
  const distinct = [...new Set(names)].sort();
  const shown = distinct.slice(0, UNSERVED_KNOWLEDGE_SOURCES_NAMED).map((name) => `'${name}'`).join(', ');
  const rest = distinct.length - Math.min(distinct.length, UNSERVED_KNOWLEDGE_SOURCES_NAMED);
  const count = names.length;
  return (
    `[ObjectQLPlugin] this deployment holds ${count} knowledge_source ${count === 1 ? 'item' : 'items'} ` +
    `(${shown}${rest > 0 ? `, and ${rest} more` : ''}), but no '${KNOWLEDGE_SERVICE}' service is registered, so ` +
    `${count === 1 ? 'it is' : 'none is'} loaded, indexed or searched. Add KnowledgeServicePlugin ` +
    '(@objectstack/service-knowledge) and a knowledge adapter to the composition, or remove the ' +
    `${count === 1 ? 'item' : 'items'}.`
  );
}

/** What {@link announceUnservedKnowledgeSources} reads of its host. */
export interface UnservedKnowledgeSourcesHost {
  /** Resolve a kernel service by name; throws or answers nothing when none is registered. */
  getService(name: string): unknown;
  logger?: { warn?: (message: string) => void };
}

/**
 * Read the published `knowledge_source` items through the metadata protocol
 * and say {@link describeUnservedKnowledgeSources} at `warn`. Called once, at
 * `kernel:bootstrapped`: every plugin has registered its services and every
 * package of the boot is registered, so "no knowledge service" and the item
 * list are both final. Never throws; a listing that cannot be read says
 * nothing.
 */
export async function announceUnservedKnowledgeSources(host: UnservedKnowledgeSourcesHost): Promise<void> {
  const service = (name: string): unknown => {
    try {
      return host.getService(name) ?? undefined;
    } catch {
      return undefined;
    }
  };
  if (service(KNOWLEDGE_SERVICE) !== undefined) return;
  const protocol = service('protocol') as
    | {
        getMetaItemsForExecution?(request: { type: string }): Promise<unknown>;
        getMetaItems?(request: { type: string }): Promise<unknown>;
      }
    | undefined;
  const read = typeof protocol?.getMetaItemsForExecution === 'function'
    ? protocol.getMetaItemsForExecution.bind(protocol)
    : typeof protocol?.getMetaItems === 'function'
      ? protocol.getMetaItems.bind(protocol)
      : undefined;
  if (!read) return;
  let raw: unknown;
  try {
    raw = await read({ type: KNOWLEDGE_SOURCE_TYPE });
  } catch {
    return;
  }
  const list = Array.isArray(raw) ? raw : (raw as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(list)) return;
  const names: string[] = [];
  for (const entry of list) {
    const doc = entry && typeof entry === 'object' && 'item' in entry ? (entry as { item: unknown }).item : entry;
    const name = (doc as { name?: unknown } | null | undefined)?.name;
    if (typeof name === 'string' && name !== '') names.push(name);
  }
  const statement = describeUnservedKnowledgeSources(names, false);
  if (statement) host.logger?.warn?.(statement);
}
