// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `.describe()` text of four record-page keys says what the runtime does,
 * in the projection every reader sees (the generated references, Studio's
 * inspector help, the skills): the JSON-schema `description`.
 *
 *  - [#27311] `ObjectSchema.relatedLists` and `fieldGroups[i].relatedList`
 *    promise exactly the refusal that is enforced. A child that is in the stack
 *    with no inbound FK is refused everywhere; a child that exists nowhere is
 *    refused by `defineStack` and by a metadata write that names no package; a
 *    write into a package stores it (the `validate-related-list-refs` header in
 *    `@objectstack/lint` holds the reasoning). `defineStack` leaves a
 *    platform-prefixed name (`sys_` / `cloud_` / `ai_`) to the runtime, and the
 *    text says so. The old text promised a refusal with no boundary.
 *  - [#27312] `relatedList: 'primary'` and `enable.trackHistory` describe the
 *    v3 synthesized record page: a primary list is a body table in the details
 *    column (inside the Details tab when tabbed), and field changes join the
 *    record's one timeline stream. Neither key gets a tab of its own, so the
 *    v2 phrases ("its own tab", "History tab") must not come back.
 *
 * Phrases are pinned, not whole sentences, so a later rewording that keeps the
 * contract stays green.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

type JsonNode = { description?: string; properties?: Record<string, JsonNode>; items?: JsonNode; $ref?: string };
type JsonRoot = JsonNode & { $defs?: Record<string, JsonNode>; definitions?: Record<string, JsonNode> };

const project = (schema: unknown): JsonRoot =>
  z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any', io: 'input' }) as JsonRoot;

/** Follow a `#/$defs/NAME` (or `#/definitions/NAME`) ref inside the same root. */
const deref = (root: JsonRoot, node: JsonNode | undefined): JsonNode | undefined => {
  if (!node?.$ref) return node;
  const name = node.$ref.split('/').pop()!;
  return root.$defs?.[name] ?? root.definitions?.[name];
};

/** The description at a property path, refs followed; `[]` steps into an array's items. */
const descriptionAt = (root: JsonRoot, path: string[]): string => {
  let node: JsonNode | undefined = root;
  for (const step of path) {
    node = deref(root, node);
    node = step === '[]' ? node?.items : node?.properties?.[step];
  }
  const own = node?.description;
  const description = own ?? deref(root, node)?.description;
  expect(description, `no description at ${path.join('.')}`).toBeTypeOf('string');
  return description!;
};

const objectRoot = project(ObjectSchema);
const fieldRoot = project(FieldSchema);

const V2_PHRASES = [/its own tab/i, /History tab/i];

describe('[#27311] relatedLists describes the refusal that is enforced', () => {
  const text = descriptionAt(objectRoot, ['relatedLists']);

  it('refuses a stack child with no inbound FK everywhere', () => {
    expect(text).toContain('is in the stack but has no inbound lookup / master_detail field to this object is refused everywhere');
  });

  it('refuses a child that exists nowhere on os validate / os build and on a write that names no package', () => {
    expect(text).toContain('exists nowhere is refused by os validate / os build (which leave a sys_ / cloud_ / ai_ name to the runtime) and by a metadata write that names no package');
  });

  it('says a write into a package stores the entry and the page places nothing', () => {
    expect(text).toContain('a write into a package stores it');
    expect(text).toContain('the record page places nothing for it');
  });

  it('no longer promises an unbounded refusal', () => {
    expect(text).not.toContain('An entry that matches no inbound lookup / master_detail field of this object is refused.');
  });
});

describe('[#27311] fieldGroups[i].relatedList is judged as a relatedLists entry is', () => {
  const text = descriptionAt(objectRoot, ['fieldGroups', '[]', 'relatedList']);

  it('names the same two refusals and the package-write boundary', () => {
    expect(text).toContain('The name is judged as a relatedLists entry is');
    expect(text).toContain('in the stack with no inbound lookup / master_detail field, or exists nowhere');
    expect(text).toContain('which leave a sys_ / cloud_ / ai_ name to the runtime');
    expect(text).toContain('a write into a package stores it');
  });

  it('no longer promises an unbounded refusal', () => {
    expect(text).not.toContain('and so is a name that matches no inbound lookup / master_detail field');
  });
});

describe('[#27312] relatedList: \'primary\' describes the v3 body table', () => {
  const text = descriptionAt(fieldRoot, ['relatedList']);

  it('places a primary list in the details column, inside the Details tab when tabbed', () => {
    expect(text).toContain('the details column, after its first field section');
    expect(text).toContain('inside the Details tab on the tabbed page, with no tab of its own');
  });

  it('carries no v2 tab phrase', () => {
    for (const phrase of V2_PHRASES) expect(text).not.toMatch(phrase);
  });
});

describe('[#27312] enable.trackHistory describes the one timeline stream', () => {
  const text = descriptionAt(objectRoot, ['enable', 'trackHistory']);

  it('sends field changes into the record\'s timeline stream', () => {
    expect(text).toContain('join the record\'s one timeline stream, under its Changes filter');
    expect(text).toContain('On an authored page, a record:history or record:activity block shows the record\'s field changes from its own activity, and neither reads this flag');
    // Neither block is the only place an authored page shows changes.
    expect(text).not.toMatch(/only where it places/);
    expect(text).not.toMatch(/activity lines/);
  });

  it('carries no v2 tab phrase', () => {
    for (const phrase of V2_PHRASES) expect(text).not.toMatch(phrase);
  });
});
