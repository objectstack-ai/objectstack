// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-credentialsref-mongo-url-no-user-refused',
  surface: 'datasource (mongodb) — `external.credentialsRef` bound while `config.url` names ' +
    'no user in its userinfo',
  replacement: 'decide what the datasource is meant to do, then make the two halves agree: ' +
    'add the username to the URL\'s userinfo (`mongodb://user@host/db`) so the bound secret ' +
    'is injected at connect (#8696) — or, for a datasource genuinely meant to connect ' +
    'unauthenticated, remove the `external.credentialsRef` binding (and unbind the orphaned ' +
    '`sys_secret` row via the Setup → Datasources form)',
  reason:
    'The pair cannot work as written, and until protocol 18 it was accepted in silence at ' +
    'every door it passed. MongoClient credentials need a username as well as a password, ' +
    'and with `url` present the discrete `username` field is superseded — the only place ' +
    'the username can come from is the URL\'s own userinfo. So the #8696 injection is ' +
    'conditional on the URL naming a user: `mongodb://app@host/db` + bound secret ' +
    'authenticates, while `mongodb://host/db` + bound secret connects ANONYMOUSLY with the ' +
    'secret unused and the operator told nothing. Injecting anyway was measured worse ' +
    '(mongodb@7.5.0): fabricating an empty username turns a connection that works ' +
    'anonymously today into a guaranteed handshake failure, and refusing at connect would ' +
    'contradict `MongoConfigSchema.url`\'s published contract ("bind the secret … and it is ' +
    'injected at connect time") while planting a per-branch asymmetry inside the driver ' +
    'factory — the defect class #8696 closed. The refusal therefore lands at the ' +
    'authoring/publish door, the one place both halves are visible at once, as the ' +
    '"absence must be loud" half of the #7314/#7385/#8152/#8875/#8696 family. Deliberately ' +
    'NOT refused, each measured: the present-but-empty userinfo forms (`mongodb://@h/db`, ' +
    '`mongodb://:p@h/db` — MongoClient itself throws `MongoParseError: URI contained empty ' +
    'userinfo section`), an empty-string `credentialsRef` (not a binding — the connect path ' +
    'resolves under a truthy check), the composed branch (no `url`, where the discrete ' +
    '`username` is live), and every other driver arm (the postgres equivalent is re-judged ' +
    'after #8873, never inherited — `pg` injects on a user-less DSN by its own measured ' +
    'mechanism). There is no mechanical rewrite because the two valid fixes are ' +
    'CONTRADICTORY intents — authenticate (add the username) versus anonymous (drop the ' +
    'binding) — and choosing between them requires knowing what the datasource is for.',
  acceptanceCriteria:
    'Every mongodb datasource that binds `external.credentialsRef` and authors `config.url` ' +
    'has a username in that URL\'s userinfo and connects authenticated as that user; every ' +
    'datasource meant to connect anonymously carries no `credentialsRef`; no datasource ' +
    'parse reports the #9041 refusal.',
};
