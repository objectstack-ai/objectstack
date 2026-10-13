// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23015, maintainer ruling A (record 6134056653). An accept-set narrowing: a
// second isDefault: true record page for one object is refused — by
// defineStack (and so os validate and os build) within one stack, by
// composeStacks across its inputs, at package registration across packages,
// and at metadata save. No D2 conversion: which page stays the default is the
// author's call. No relevance question either: the surface reaches past the
// stack's own keys, to pages a plugin registers in code and to stored rows.
export const entry: SemanticMigration = {
  id: 'page-default-record-page-one-per-object-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'pages[] — two or more record pages (type record, the default) bound to one object and both declared '
    + 'isDefault: true, within one stack, across the stacks composeStacks composes, across the packages one '
    + 'deployment registers (manifest pages and nested plugins[].pages, including pages a plugin registers '
    + 'through manifest.register), or between a page saved through the metadata API and a page already stored '
    + 'or shipped',
  replacement:
    'One default record page per object per deployment: keep isDefault: true on the page that should open the '
    + 'record view and set isDefault: false on every other record page of that object. To replace a page a '
    + 'package ships, compose the deployment without that package\'s page (host composition); to replace a page '
    + 'authored in the environment, save it again under its own name — a save under the existing default\'s '
    + 'name is that page, not a second default. Shipping a second default is not an override path. isDefault '
    + 'on a page that is not a record page bound to an object is unchanged.',
  reason:
    'The renderer opens an object\'s record view on its default record page and honours isDefault with no '
    + 'tie-break, and nothing decided between two defaults for one object: the page that opened was whichever '
    + 'plugin initialised first, an accident no author wrote and a refactor could flip silently. The rule now '
    + 'stated on PageSchema.isDefault is refused at every door that can add a second default, naming both '
    + 'pages: defineStack and composeStacks refuse with STACK_CROSS_REFERENCE_INVALID (422); package '
    + 'registration (SchemaRegistry.installPackage and registerItem) and the metadata save door (saveMetaItem) '
    + 'refuse with DEFAULT_RECORD_PAGE_CONFLICT (422). Not convertible: which of the two pages stays the default '
    + 'is a fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build load the stack without a finding of the form "Object X has two default record '
    + 'pages", the deployment boots without DEFAULT_RECORD_PAGE_CONFLICT, and each object\'s record view opens '
    + 'the page you kept as its default — check it, because before this change the page that opened was decided '
    + 'by registration order and may not be the one you keep. Stored pages that already form a pair keep '
    + 'serving; the next save of the one that is not kept as the default is refused until it carries '
    + 'isDefault: false.',
};
