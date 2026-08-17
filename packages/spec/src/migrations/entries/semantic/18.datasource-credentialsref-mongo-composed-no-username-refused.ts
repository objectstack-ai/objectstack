// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The COMPOSED-branch twin of `datasource-credentialsref-mongo-url-no-user-refused`
// (#9147 widening #9041's refinement). Same silent discard, one branch over, and a
// DIFFERENT remedy — which is why it is its own entry rather than a widened surface
// on that one: with no `url` the discrete `config.username` is the live field, so the
// fix is `config.username`, not the URL's userinfo.
export const entry: SemanticMigration = {
  id: 'datasource-credentialsref-mongo-composed-no-username-refused',
  surface: 'datasource (mongodb) — `external.credentialsRef` bound while `config` authors no ' +
    '`url` and names no `username`',
  replacement: 'decide what the datasource is meant to do, then make the two halves agree: ' +
    'add `username` to `config` so the bound secret is interpolated beside it into the ' +
    'composed connection URI at connect (#8696) — or, for a datasource genuinely meant to ' +
    'connect unauthenticated, remove the `external.credentialsRef` binding (and unbind the ' +
    'orphaned `sys_secret` row via the Setup → Datasources form). Authoring a `config.url` ' +
    'that names a user is a third valid shape, judged by the sibling #9041 prescription.',
  reason:
    'The pair cannot work as written, and until protocol 18 it was accepted in silence at ' +
    'every door it passed. With no `config.url` the driver factory COMPOSES the connection ' +
    'URI from the discrete fields, and the bound secret has exactly one route into it — the ' +
    'userinfo written beside a username (`buildMongoUrl`: `const auth = user ? … : \'\'`). A ' +
    'falsy `username` closes that route, and the branch has no second one: `buildMongoAuth` ' +
    'returns early when there is no `url`, because the composed branch injects THROUGH the ' +
    'URI it builds rather than beside it. So `credentialsRef` bound with no `url` and no ' +
    '`username` composed `mongodb://host:port/db`, connected ANONYMOUSLY, and told the ' +
    'operator nothing. Nothing can be fabricated to rescue it: a MongoDB handshake cannot ' +
    'authenticate from a password alone — the same measured asymmetry behind the sibling ' +
    'URL-branch refusal. Both branches had always agreed on this input, so this inherits that ' +
    'ruling rather than re-opening it, and lands at the same authoring/publish door — the one ' +
    'place both halves are visible at once — as the "absence must be loud" half of the ' +
    '#7314/#7385/#8152/#8875/#8696 family. Deliberately NOT refused, each measured: a ' +
    'discrete `username` that is present and non-empty (the secret is live there — that is ' +
    'the branch #8696 already works on), an empty-string `credentialsRef` (not a binding — ' +
    'the connect path resolves under a truthy check), a non-string `username` (the driver ' +
    'config gate already reports the type error), and every other driver arm (the postgres ' +
    'equivalent is re-judged after #8873, never inherited — `pg` receives the bound password ' +
    'regardless of the DSN naming a user). An EMPTY-STRING `username` IS refused, unlike the ' +
    'sibling entry\'s present-but-empty userinfo carve-out: there MongoClient itself throws ' +
    '(`URI contained empty userinfo section`) so the shape is already loud, while here ' +
    '`username: \'\'` composes the same userinfo-free URI and connects — silently. There is ' +
    'no mechanical rewrite because the valid fixes are CONTRADICTORY intents — authenticate ' +
    '(name the user) versus anonymous (drop the binding) — and choosing between them requires ' +
    'knowing what the datasource is for.',
  acceptanceCriteria:
    'Every mongodb datasource that binds `external.credentialsRef` and authors no `config.url` ' +
    'names a non-empty `config.username` and connects authenticated as that user; every ' +
    'datasource meant to connect anonymously carries no `credentialsRef`; no datasource parse ' +
    'reports the #9147 refusal.',
};
