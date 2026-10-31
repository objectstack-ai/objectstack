// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23610, maintainer ruling A on Q1 (record 6190536588). An accept-set
// narrowing, not a key removal: `isDefault` stays live on a record page bound
// to an object, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row — the
// parse refuses the flag elsewhere through `checkPageDefaultPlacement`
// (ui/page.zod.ts), and the registry refuses it on a page a package registers
// without a parse. No grace window on the AUTHORING surface, per the ruling:
// the delete is lossless (nothing read the flag), but whether the page should
// be the app's landing — and so first in its navigation — is the author's
// call. Data at rest is the other half: an installed or stored page carrying
// the flag replays the retired D2 entry
// `page-is-default-off-record-page-removed` on read (the maintainer's P0 order
// after the refusal stopped kernel builds on environments holding an installed
// package built before it), so the kernel builds with a named notice instead
// of refusing. No relevance question: the surface reaches pages a plugin
// registers in code and stored rows.
export const entry: SemanticMigration = {
  id: 'page-is-default-off-record-page-refused',
  surface:
    'pages[] — isDefault: true on a page that is not a record page bound to an object: a home, app, utility '
    + 'or list page, or a record page (type record, the default) with no object; in a stack, on a page a '
    + 'package registers (manifest pages, nested plugins[].pages, manifest.register), or in a page saved '
    + 'through the metadata API',
  replacement:
    'Delete `isDefault` from the page. To make it the page an app opens, put its entry first in the app\'s '
    + '`navigation` (an app\'s landing page is its first navigation item, by `order`); the root landing '
    + 'follows the app\'s own `isDefault`. On a record page meant to be an object\'s default record page, '
    + 'bind it with `object` instead.',
  reason:
    'PageSchema.isDefault has one meaning — the default record page of the object a record page binds, the '
    + 'page that object\'s record view opens. On every other page nothing read it: the console opens an app on '
    + 'its first navigation item and the root landing on the app marked isDefault, so a home page declared '
    + 'isDefault: true validated, saved and was served while it decided nothing. A shipped app set it on its '
    + 'home page to make a landing page that never landed; this repository\'s showcase example set it on a '
    + 'page that is its landing only because it is first in navigation, and dropped the flag with no change '
    + 'to where the app opens. The flag is now refused, with the landing\'s real spelling in the refusal: by '
    + 'the page parse (definePage; defineStack, so objectstack validate and objectstack build, with '
    + 'STACK_SCHEMA_INVALID 422; the metadata save door with 422 INVALID_METADATA) and at package '
    + 'registration (SchemaRegistry.installPackage and registerItem, 422 INVALID_METADATA). '
    + '⚠️ No D2 conversion on the authoring surface: deleting the flag changes nothing at runtime, but where the '
    + 'app should open is the author\'s decision, made in its navigation. '
    + '⚠️ Data at rest converts instead of failing: a page row already stored with the flag, a compiled artifact '
    + 'inside the window its manifest opens, and a package body registered with a declared engines.protocol '
    + 'range (an installed package) replay the retired conversion page-is-default-off-record-page-removed on '
    + 'read, which deletes the flag with an OS_METADATA_CONVERTED notice, so the kernel builds; saving the page '
    + 'again is refused until the flag is deleted. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in defineStack pages sources, exported stacks, pages a plugin registers in code and every '
    + 'page row in sys_metadata for isDefault: true on a page whose type is not record, or that binds no '
    + 'object. Delete the flag; where the page should be the app\'s landing, make its navigation entry the '
    + 'first. Then objectstack validate reports nothing at pages.N.isDefault, the deployment boots without an '
    + 'INVALID_METADATA refusal naming isDefault, saving each formerly affected page through the metadata API '
    + 'succeeds, and every app opens where it opened before. A record page bound to an object parses, '
    + 'registers and saves exactly as before.',
};
