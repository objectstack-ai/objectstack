// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The AUTHORING half of the turso driver's constructor refusals. The driver
// refuses these configurations when it is built; this entry records that the
// datasource contract now refuses them where they are written, together with
// the one combination the driver used to build and then ignore (syncUrl under
// a forced remote mode), which the constructor refuses too since #20200. A
// structured TODO, not a D2 conversion: which way out an author wants — a
// remote database, an embedded replica on a local file, or a plain local
// file — is intent no artifact records.
export const entry: SemanticMigration = {
  id: 'turso-config-transport-mismatch-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.TursoConfig (a turso / libsql datasource.config) and the published TursoConfigSchema '
    + 'mirror of @objectstack/driver-turso — combinations of url, syncUrl, mode and timeoutMs that '
    + 'are now refused at parse: a remote url (libsql, https, http, wss, ws, any letter case) '
    + 'beside syncUrl or under a forced local or replica mode; in a local or replica mode, a url '
    + 'that is none of a file: url, :memory: or a remote url (a bare path, another scheme, '
    + ':MEMORY:, a blank url); a replica on an in-memory url; timeoutMs beside a wss or ws url in '
    + 'remote mode; and syncUrl under a forced remote mode. The driver mirror also refuses sync '
    + 'with no syncUrl, as the spec contract already did',
  replacement:
    'the configuration the author meant, spelled the way the driver runs it. A remote database '
    + 'is the remote url alone (drop syncUrl and sync, and drop a forced local or replica mode or '
    + 'set it to remote). An embedded replica is a local file written as a file: url beside '
    + 'syncUrl, for example url file:./data/replica.db with syncUrl naming the remote. A local '
    + 'database is a file: url (file:./data/app.db, never the bare path ./data/app.db) or '
    + ':memory: for a throwaway one. A remote database that needs timeoutMs spells its url libsql '
    + 'or https, or drops timeoutMs. Each refusal names the key it sits on (url, syncUrl or '
    + 'timeoutMs) and prints the spellings above',
  reason:
    'Each key parsed on its own, so the contract accepted configurations the turso driver '
    + 'refuses when it is built (VALIDATION_ERROR / 400 from the constructor, since the fixes '
    + 'that stopped a remote url beside a syncUrl from writing to process memory and an '
    + 'unrecognised url scheme from falling through to an in-memory local engine) — a '
    + 'datasource published clean and then failed at boot or at test connection. One more it '
    + 'built and then ignored until the constructor was taught to refuse it as well: syncUrl '
    + 'under a forced remote '
    + 'mode, where the remote client was created without it, no sync ever ran and the sync call '
    + 'failed as not supported while the driver reported sync as enabled (measured on the built '
    + 'driver). Authoring now refuses exactly the constructor\'s refused set — the same predicates, '
    + 'a scheme matched in any letter case, the url read trimmed as both datasource loaders hand '
    + 'it over — plus that key, refused at authoring first as the declared-but-not-enforced shape '
    + 'ADR-0049 does not ship, and by the constructor too since that later fix. Nothing the '
    + 'constructor accepts is refused (when authoring first refused that key it was the one '
    + 'exception; since the constructor refuses it too there is none): '
    + 'a forced remote mode keeps its url unjudged, as the constructor does. Stored datasource '
    + 'rows are not re-parsed '
    + 'when they load, so a stored row still reaches the constructor as written; the constructor '
    + 'refuses the first four shapes there already and, since that later fix, also refuses '
    + 'syncUrl under '
    + 'a forced remote mode and sync with no syncUrl when the datasource boots. What changes here '
    + 'is that creating, testing or editing '
    + 'its config through the datasource admin service, defineStack or os validate is refused at '
    + 'the key. Measured on this tree at the change: no example, template, published skill or '
    + 'hand-written doc authors a refused combination. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every turso datasource: os validate or defineStack, and a '
    + 'save or test connection through the datasource admin service, report each refused '
    + 'combination at config.url, config.syncUrl or config.timeoutMs with the ways out. Decide per '
    + 'datasource whether it is a remote database, an embedded replica on a local file, or a '
    + 'local file, and rewrite it to that spelling. Done when every turso datasource parses, the '
    + 'driver builds from it, and a replica datasource reports a file: url beside its syncUrl.',
};
