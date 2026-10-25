/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Helpers that introspect a page schema tree without needing the React
 * runtime. Used by RecordDetailView to decide which host-side fallback panels
 * a page still needs, and to enforce the object-level `enable.feeds` switch
 * over whatever the page composed.
 */

const DISCUSSION_TYPES = new Set(['record:discussion', 'record:chatter']);
/**
 * Where a page tree nests component nodes. `regions` is what makes
 * `buildDefaultPageSchema` output and full-Lightning authored pages visible to
 * these walkers at all; without it the synthesized `record:discussion` is
 * invisible and the host used to append a SECOND chatter panel on top of it.
 */
// ⚠️ `body` STAYS here through objectui#6771's retirement of the dialect, on
// the rule that governs every NON-RENDERING reader in this tree: while a
// renderer still reaches stored `body` content — `page:card` and the three
// thin `page:*` containers do — a walker that must see the SAME content keeps
// its arm. Dropping it here would make a stored `body` subtree invisible to
// the discussion dedup while the renderer still draws it, which re-creates the
// second-chatter-panel defect this list exists to prevent. Pinned in
// `__tests__/pageSchemaIntrospect.test.ts`; escalation objectui#9916.
const CONTAINER_KEYS = ['children', 'items', 'body', 'components', 'regions'] as const;
/** The same nesting one level down, inside the spec `properties` envelope. */
const NESTED_CONTAINER_KEYS = ['children', 'items'] as const;
const ATTACHMENT_TYPES = new Set(['record:attachments']);
const APPROVAL_TYPES = new Set(['record:approvals']);

/**
 * Walks a page schema tree and returns true if any node's `type` is in
 * `types`.
 *
 * Recurses into:
 *  - `children`, `items`, `body`, `components`
 *  - `properties.children`, `properties.items`
 *  - `regions` (synth + full-Lightning pages nest components here)
 *
 * Cycles are guarded with a WeakSet.
 */
function hasNodeOfType(root: unknown, types: ReadonlySet<string>): boolean {
  const seen = new WeakSet<object>();
  const walk = (node: any): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(walk);
    const t = node?.type;
    if (typeof t === 'string' && types.has(t)) return true;
    // ⚠️ The SAME tables `stripDiscussionNodes` walks, deliberately shared: a
    // container key that only one of the two knows about is a page shape where
    // "is the panel there?" and "remove the panel" disagree.
    const candidates: any[] = [
      ...CONTAINER_KEYS.map((key) => (node as any)[key]),
      ...NESTED_CONTAINER_KEYS.map((key) => node.properties?.[key]),
    ];
    return candidates.some(walk);
  };
  return walk(root);
}

/**
 * Return `root` with every `record:discussion` / `record:chatter` node removed
 * from the containers this module walks.
 *
 * This is the object-level `enable.feeds: false` gate (objectstack-ai/objectstack#2707) applied to a
 * COMPOSED page (objectui#7298). The maintainer ruling of 2026-09-12 makes the
 * declared node the only way a discussion panel reaches a record page, and
 * keeps `enable.feeds` as the object's switch *over* the page: an object with
 * feeds off shows no panel, declared or not. `RecordDetailView` deliberately
 * never fetches `sys_comment` for such an object, so a node left in the tree
 * would render a composer and an empty feed the server would 403 anyway.
 *
 * ⚠️ Identity-preserving on purpose: a subtree with nothing to remove is
 * returned by REFERENCE, so the feeds-ON path (every object that has not opted
 * out) hands the very same object through and nothing downstream sees a new
 * page identity each render.
 *
 * Shared subtrees are walked once and their result reused, so a node that
 * appears twice is pruned in both places; a cycle is left as it stands rather
 * than recursed into.
 *
 * Returns `null` when `root` ITSELF is a discussion node — there is no
 * container to remove it from. Callers pass a page, so this is a total-function
 * corner rather than a case that arises.
 */
export function stripDiscussionNodes(root: unknown): unknown {
  const done = new WeakMap<object, unknown>();
  const active = new WeakSet<object>();

  const isDiscussionNode = (node: any): boolean =>
    Boolean(node) && typeof node === 'object' && typeof node.type === 'string'
      && DISCUSSION_TYPES.has(node.type);

  const walk = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (done.has(node)) return done.get(node);
    // A cycle: return the node as it stands instead of recursing forever.
    if (active.has(node)) return node;
    active.add(node);

    // Assigned in both branches below; left uninitialised so a branch that
    // forgot to set it is a type error rather than a silent pass-through.
    let result: any;

    if (Array.isArray(node)) {
      const next: any[] = [];
      let changed = false;
      for (const entry of node) {
        if (isDiscussionNode(entry)) {
          changed = true;
          continue;
        }
        const walked = walk(entry);
        if (walked !== entry) changed = true;
        next.push(walked);
      }
      result = changed ? next : node;
    } else {
      const patch: Record<string, unknown> = {};
      let changed = false;
      for (const key of CONTAINER_KEYS) {
        const value = (node as any)[key];
        if (value === undefined || value === null) continue;
        const walked = walk(value);
        if (walked !== value) {
          patch[key] = walked;
          changed = true;
        }
      }
      const properties = (node as any).properties;
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        const propsPatch: Record<string, unknown> = {};
        let propsChanged = false;
        for (const key of NESTED_CONTAINER_KEYS) {
          const value = properties[key];
          if (value === undefined || value === null) continue;
          const walked = walk(value);
          if (walked !== value) {
            propsPatch[key] = walked;
            propsChanged = true;
          }
        }
        if (propsChanged) {
          patch.properties = { ...properties, ...propsPatch };
          changed = true;
        }
      }
      result = changed ? { ...node, ...patch } : node;
    }

    active.delete(node);
    done.set(node, result);
    return result;
  };

  if (isDiscussionNode(root)) return null;
  return walk(root);
}

/**
 * True when the page schema already places a `record:attachments` node —
 * the synthesized default does whenever the object declares
 * `enable.files: true` (objectstack#4358). The host must then skip its
 * legacy bottom-of-page attachments append.
 */
export function hasExplicitAttachments(root: unknown): boolean {
  return hasNodeOfType(root, ATTACHMENT_TYPES);
}

/**
 * True when the page schema already places a `record:approvals` node — the
 * synthesized default does whenever the record has approval requests
 * (objectui#3461, an Approvals tab). The host must then skip its bottom
 * fallback append.
 */
export function hasExplicitApprovals(root: unknown): boolean {
  return hasNodeOfType(root, APPROVAL_TYPES);
}
