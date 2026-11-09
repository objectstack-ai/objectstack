// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A mapping's `connectorSource.connector` must name a `connectors[]` entry
 * whose `provider` is `rest` or `openapi` — the author-time half of the
 * connector sync executor's binding refusals.
 *
 * ## The state this rule ends
 *
 * Nothing checked the name. A mapping whose `connectorSource.connector` named
 * a datasource (`legacy_db`) passed `os validate` at exit 0 with no finding,
 * the boot scheduled the `job` whose `pull` names the mapping, and every tick
 * then wrote a `failed` job run (`connector_not_registered`) that only a
 * reader of the job-run rows ever saw. This rule reports the name when the
 * stack is validated, so the author meets the refusal at `os validate` rather
 * than in the job-run history.
 *
 * ## What resolves
 *
 * The executor (`pullConnectorSource`, `@objectstack/service-automation`)
 * reads only a DECLARED instance (a `connectors[]` entry, never a connector a
 * plugin registers in code) whose provider is one of
 * {@link CONNECTOR_SOURCE_PROVIDERS}. So a name resolves when this stack, or a
 * sibling package of the same artifact, declares a `connectors[]` entry of
 * that name with one of those providers. Three verdicts otherwise, each naming
 * what the name IS where the stack can tell: a datasource, a connector of
 * another provider (or a provider-less catalog descriptor), or nothing.
 *
 * ## Severity: `warning`
 *
 * The nearest rules asking the same question — does a name resolve into a
 * collection whose members can also come from outside this stack? — are
 * `capability-reference-unknown` and `ai-skill-tool-unresolved`, and both
 * advise. The connector universe is the same shape: the automation plugin
 * materializes `connectors[]` from every loaded package and from connector
 * rows a Studio publish stores after boot, and one package's lint sees none
 * of those. The runtime still refuses an unresolved name on every pull, so
 * the warning names a binding that is almost certainly wrong without failing
 * a build whose connector lives elsewhere.
 *
 * Not judged: a mapping with no `connectorSource`, or one whose `connector`
 * is not a non-empty string (the schema's subject).
 */

import { packagesOf, recordsOf, suggestName } from './object-graph.js';

/** A `connectorSource.connector` that names no declared rest or openapi connector. */
export const MAPPING_CONNECTOR_SOURCE_UNKNOWN = 'mapping-connector-source-unknown';

/**
 * The providers a connector pull reads through. Mirrors
 * `CONNECTOR_PULL_PROVIDERS` in `@objectstack/service-automation`
 * (`connector-pull.ts`), which this package cannot import; the spec states the
 * same pair on `MappingSchema.connectorSource`'s description.
 */
export const CONNECTOR_SOURCE_PROVIDERS: readonly string[] = Object.freeze(['rest', 'openapi']);

export interface MappingConnectorSourceFinding {
  severity: 'warning';
  rule: string;
  /** Human-readable location, e.g. `mapping "crm_contacts" · connector "legacy_db"`. */
  where: string;
  /** Config path, e.g. `mappings[0].connectorSource.connector`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** This stack's bodies: itself, then every sibling package body of the artifact. */
function bodiesOf(stack: AnyRec): AnyRec[] {
  const bodies: AnyRec[] = [stack];
  for (const entry of packagesOf(stack)) {
    if (isRec(entry.manifest)) bodies.push(entry.manifest);
  }
  return bodies;
}

/**
 * Report every mapping whose `connectorSource.connector` names no
 * `connectors[]` entry with provider `rest` or `openapi`. Returns findings
 * (empty = clean).
 */
export function validateMappingConnectorSources(stack: AnyRec): MappingConnectorSourceFinding[] {
  const findings: MappingConnectorSourceFinding[] = [];
  if (!isRec(stack)) return findings;
  const mappings = recordsOf(stack.mappings);
  if (mappings.length === 0) return findings;

  // name → provider ('' for a provider-less catalog descriptor).
  const connectors = new Map<string, string>();
  const datasources = new Set<string>();
  for (const body of bodiesOf(stack)) {
    for (const entry of recordsOf(body.connectors)) {
      const name = strName(entry.name);
      if (!name) continue;
      const provider = strName(entry.provider) ?? '';
      // A pull-capable declaration of the name wins over any other of it.
      if (!CONNECTOR_SOURCE_PROVIDERS.includes(connectors.get(name) ?? '')) connectors.set(name, provider);
    }
    for (const entry of recordsOf(body.datasources)) {
      const name = strName(entry.name);
      if (name) datasources.add(name);
    }
  }
  const pullable = [...connectors].filter(([, p]) => CONNECTOR_SOURCE_PROVIDERS.includes(p)).map(([n]) => n);

  for (let mi = 0; mi < mappings.length; mi++) {
    const mapping = mappings[mi];
    const source = mapping.connectorSource;
    if (!isRec(source)) continue;
    const connector = strName(source.connector);
    if (!connector) continue;
    const provider = connectors.get(connector);
    if (provider !== undefined && CONNECTOR_SOURCE_PROVIDERS.includes(provider)) continue;

    const mappingName = strName(mapping.name) ?? `#${mi}`;
    const where = `mapping "${mappingName}" · connector "${connector}"`;
    const path = `mappings[${mi}].connectorSource.connector`;
    const consequence = 'so every pull of this mapping is refused and writes nothing.';
    let message: string;
    if (provider !== undefined) {
      message = provider
        ? `"${connector}" is a "${provider}" connector; a pull reads only a rest or openapi one, ${consequence}`
        : `"${connector}" is a connector with no provider (a catalog descriptor), ${consequence}`;
    } else if (datasources.has(connector)) {
      message = `"${connector}" is a datasource, not a connector, ${consequence}`;
    } else {
      message = `"${connector}" names no connectors[] entry, ${consequence}` + suggestName(connector, pullable);
    }
    findings.push({
      severity: 'warning',
      rule: MAPPING_CONNECTOR_SOURCE_UNKNOWN,
      where,
      path,
      message,
      hint:
        'Name a connectors[] entry with provider rest or openapi (declare one if none exists); ' +
        'a connector another installed package declares resolves at run time.',
    });
  }
  return findings;
}
