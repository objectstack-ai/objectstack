// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector, permission-set and form-view advisories' user-facing
 * sentences in the request's language (ruling record 6819749037, the pattern
 * `finding-user-text.test.ts` pins for the security-posture rule): the
 * connector credential rule's catalog (`lint-connector-credential-literals.user-text.ts`),
 * the retired permission key rule's (`validate-retired-permission-residue.user-text.ts`)
 * and the form predicate rule's (`validate-predicate-path-refs.user-text.ts`),
 * each rendered from the rule's REAL findings in every platform locale, and
 * carried out of the publish door.
 *
 * Of the ten advisory ids in the AI agent and tool, connector, mapping and
 * sharing rule files, these three are the ones the publish door returns; the
 * other seven are named below, with the reason each never reaches it.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { FINDING_USER_TEXT_CATALOG, findingUserMessage } from './finding-user-text.js';
import { CONNECTOR_CREDENTIAL_LITERALS_USER_TEXT } from './lint-connector-credential-literals.user-text.js';
import { RETIRED_PERMISSION_RESIDUE_USER_TEXT } from './validate-retired-permission-residue.user-text.js';
import { PREDICATE_PATH_REFS_USER_TEXT } from './validate-predicate-path-refs.user-text.js';
import { CONNECTOR_CREDENTIAL_LITERAL, lintConnectorCredentialLiterals } from './lint-connector-credential-literals.js';
import {
  PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
  validateRetiredPermissionResidue,
} from './validate-retired-permission-residue.js';
import { PREDICATE_RHS_PATH_SHAPED, validatePredicatePathRefs } from './validate-predicate-path-refs.js';
import {
  AGENT_AUTHORING_WITHDRAWN,
  DEFAULT_AGENT_LEGACY_ALIAS,
  DEFAULT_AGENT_OUTSIDE_ROSTER,
} from './validate-ai-agent-authoring.js';
import { AI_SKILL_TOOL_UNRESOLVED } from './validate-ai-tool-references.js';
import { MAPPING_CONNECTOR_SOURCE_UNKNOWN } from './validate-mapping-connector-source.js';
import { SECURITY_EXTERNAL_OWNER_UNMAPPED } from './validate-external-owner-sharing.js';
import { SHARING_RULE_OBJECT_NOT_SHAREABLE } from './validate-sharing-rule-enforceability.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

type AnyRec = Record<string, unknown>;

/** The advisory ids of these rule files the publish door returns, one catalog each. */
const CATALOGS = [
  { catalog: CONNECTOR_CREDENTIAL_LITERALS_USER_TEXT, rules: [CONNECTOR_CREDENTIAL_LITERAL] },
  { catalog: RETIRED_PERMISSION_RESIDUE_USER_TEXT, rules: [PERMISSION_RETIRED_LIFECYCLE_RESIDUE] },
  { catalog: PREDICATE_PATH_REFS_USER_TEXT, rules: [PREDICATE_RHS_PATH_SHAPED] },
] as const;

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Probe sentinels shaped like credentials. ⛔ None may reach a param or a sentence. */
const SECRET = {
  header: 'Bearer probe-header-sentinel',
  env: 'Bearer probe-env-sentinel',
  credentialEnv: 'probe7sentinel3value9token5x',
} as const;

const restConnector = {
  name: 'acme_billing',
  label: 'Acme Billing',
  type: 'api',
  provider: 'rest',
  providerConfig: {
    baseUrl: 'https://api.acme.invalid/v1',
    defaultHeaders: { Authorization: SECRET.header, Accept: 'application/json' },
  },
};

/** A stdio `mcp` entry with the transport keys and `auth` it is given. */
const stdioConnector = (transport: AnyRec, auth?: AnyRec): AnyRec => ({
  name: 'acme_repo_tools',
  label: 'Acme Repo Tools',
  type: 'api',
  provider: 'mcp',
  providerConfig: { transport: { kind: 'stdio', command: 'repo-mcp-server', ...transport } },
  ...(auth ? { auth } : {}),
});

const envConnector = stdioConnector({ env: { MCP_UPSTREAM: SECRET.env, LOG_LEVEL: 'info' } });
const credentialEnvConnector = stdioConnector(
  { credentialEnv: SECRET.credentialEnv },
  { type: 'bearer', credentialRef: 'ACME_REPO_TOKEN' },
);
const stdioAuthConnector = stdioConnector({ env: { LOG_LEVEL: 'info' } }, { type: 'bearer', credentialRef: 'ACME_REPO_TOKEN' });

const permissionSet = (key: 'allowRestore' | 'allowPurge') => ({
  name: 'acme_support_agent',
  label: 'Support Agent',
  objects: { acme_ticket: { allowRead: true, allowEdit: true, [key]: false } },
});

/** A schema-bound form view: its predicates resolve against `FieldSchema`. */
const formView = (visibleWhen: string) => ({
  name: 'acme_field_editor',
  label: 'Field editor',
  form: {
    data: { provider: 'schema', schemaId: 'field' },
    sections: [{ label: 'Main', fields: [{ field: 'name', visibleWhen }] }],
  },
});

type Finding = { rule: string; severity: string; userTextParams?: Record<string, string> };
type Case = {
  label: string;
  rule: string;
  stack: AnyRec;
  params: Record<string, string>;
  run: (stack: AnyRec) => readonly Finding[];
};

/**
 * One stack per advisory push site the publish door reaches, with the params
 * each finding must carry: the connector rule's three sites (the map-entry site
 * in both its header and env positions, the credentialEnv site and the stdio
 * auth site), the permission site for both retired keys, and the bare-word arm
 * of the predicate rule.
 */
const CASES: readonly Case[] = [
  {
    label: 'connector header holding a credential',
    rule: CONNECTOR_CREDENTIAL_LITERAL,
    stack: { connectors: [restConnector] },
    params: { connector: 'acme_billing', name: 'Authorization', position: 'header' },
    run: (s) => lintConnectorCredentialLiterals(s),
  },
  {
    label: 'MCP server environment variable holding a credential',
    rule: CONNECTOR_CREDENTIAL_LITERAL,
    stack: { connectors: [envConnector] },
    params: { connector: 'acme_repo_tools', name: 'MCP_UPSTREAM', position: 'env' },
    run: (s) => lintConnectorCredentialLiterals(s),
  },
  {
    label: 'credentialEnv holding a credential instead of a variable name',
    rule: CONNECTOR_CREDENTIAL_LITERAL,
    stack: { connectors: [credentialEnvConnector] },
    params: { connector: 'acme_repo_tools', position: 'credential-env' },
    run: (s) => lintConnectorCredentialLiterals(s),
  },
  {
    label: 'stdio MCP server whose credential reaches nothing',
    rule: CONNECTOR_CREDENTIAL_LITERAL,
    stack: { connectors: [stdioAuthConnector] },
    params: { connector: 'acme_repo_tools', position: 'stdio-auth' },
    run: (s) => lintConnectorCredentialLiterals(s),
  },
  {
    label: 'permission set writing the retired allowRestore default',
    rule: PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
    stack: { permissions: [permissionSet('allowRestore')] },
    params: { permissionSet: 'acme_support_agent', object: 'acme_ticket', key: 'allowRestore' },
    run: (s) => validateRetiredPermissionResidue(s),
  },
  {
    label: 'permission set writing the retired allowPurge default',
    rule: PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
    stack: { permissions: [permissionSet('allowPurge')] },
    params: { permissionSet: 'acme_support_agent', object: 'acme_ticket', key: 'allowPurge' },
    run: (s) => validateRetiredPermissionResidue(s),
  },
  {
    label: 'form predicate comparing with an unquoted word',
    rule: PREDICATE_RHS_PATH_SHAPED,
    stack: { views: [formView('data.type == active')] },
    params: { view: 'acme_field_editor', word: 'active', op: '==' },
    run: (s) => validatePredicatePathRefs(s),
  },
];

/** The one finding of `rule` the case's stack produces. */
const findingOf = (c: Case) => {
  const found = c.run(c.stack).filter((f) => f.rule === c.rule);
  expect(found, `${c.label}: exactly one ${c.rule} finding`).toHaveLength(1);
  return found[0]!;
};

/** The params that are NAMES the sentence must show (not the arm selector). */
const namesOf = (params: Record<string, string>): string[] =>
  Object.entries(params).filter(([key]) => key !== 'position').map(([, value]) => value);

describe('connector, permission and form advisories user text · the catalogs', () => {
  it.each(CATALOGS.map((c) => [c.rules.join(', '), c] as const))(
    'the catalog of %s holds a sentence for exactly its door-reaching ids, in every platform locale',
    (_label, { catalog, rules }) => {
      expect(Object.keys(catalog).sort()).toEqual([...rules].sort());
      for (const [rule, entry] of Object.entries(catalog)) {
        expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
      }
    },
  );

  it('all three are merged into the one finding catalog the door renders from', () => {
    for (const { catalog, rules } of CATALOGS) {
      for (const rule of rules) expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(catalog[rule]);
    }
  });

  it('keeps every rule id stable: the catalogs are keyed by the ids the findings already carry', () => {
    expect(CATALOGS.flatMap((c) => c.rules)).toEqual([
      'connector-credential-literal',
      'permission-retired-lifecycle-residue',
      'predicate-rhs-path-shaped',
    ]);
  });

  it('the advisory ids the door never returns have no sentence here, and stay on the English message', () => {
    for (const rule of [
      // Reference-integrity suite members on its frozen `flow` default: an
      // agent, app, skill or mapping write dispatches none of them, and a flow
      // write's snapshot carries no agents, apps, skills or mappings. The skill
      // one stays off the door by ruling 5791822697 (ADR-0109 Decision §3).
      AGENT_AUTHORING_WITHDRAWN,
      DEFAULT_AGENT_OUTSIDE_ROSTER,
      DEFAULT_AGENT_LEGACY_ALIAS,
      AI_SKILL_TOOL_UNRESOLVED,
      MAPPING_CONNECTOR_SOURCE_UNKNOWN,
      // CLI-only registry entries.
      SECURITY_EXTERNAL_OWNER_UNMAPPED,
      SHARING_RULE_OBJECT_NOT_SHAREABLE,
    ]) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBeUndefined();
    }
  });
});

describe('connector, permission and form advisories user text · rendered from the rules\' real findings', () => {
  it.each(CASES.map((c) => [c.label, c] as const))('%s: carries its params and renders in every platform locale', (_label, c) => {
    const finding = findingOf(c);
    expect(finding.severity).toBe('warning');
    expect(finding.userTextParams).toEqual(c.params);

    const english = findingUserMessage(finding, ['en'])!;
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const text = findingUserMessage(finding, [tag]);
      expect(text, `${c.rule} · ${tag}`).toBeTruthy();
      expect(text, `${c.rule} · ${tag}`).not.toMatch(/undefined|\$\{/);
      for (const name of namesOf(c.params)) expect(text, `${c.rule} · ${tag} names ${name}`).toContain(name);
      // A real translation, not the English floor standing in for it.
      if (tag !== 'en') expect(text, `${c.rule} · ${tag}`).not.toBe(english);
    }
  });

  it('never carries the credential itself: not in the params, not in any locale\'s sentence', () => {
    for (const c of CASES.filter((x) => x.rule === CONNECTOR_CREDENTIAL_LITERAL)) {
      const finding = findingOf(c);
      for (const secret of Object.values(SECRET)) {
        expect(JSON.stringify(finding.userTextParams), c.label).not.toContain(secret);
        for (const tag of PLATFORM_LOCALE_TAGS) {
          expect(findingUserMessage(finding, [tag]), `${c.label} · ${tag}`).not.toContain(secret);
        }
      }
    }
  });

  it('renders the four connector arms apart in every platform locale', () => {
    const findings = CASES.filter((c) => c.rule === CONNECTOR_CREDENTIAL_LITERAL).map(findingOf);
    expect(findings).toHaveLength(4);
    for (const tag of PLATFORM_LOCALE_TAGS) {
      // Same names, so only the position tells the arms apart.
      const texts = findings.map((f) =>
        findingUserMessage({ ...f, userTextParams: { ...f.userTextParams!, connector: 'c', name: 'n' } }, [tag]));
      expect(new Set(texts).size, tag).toBe(4);
    }
  });

  it('names both readings of the unquoted word, with the supported spelling of each, in every platform locale', () => {
    // The rule cannot tell which reading the author meant, so the sentence must
    // not pick one, and must never put the root in front of the word where it
    // stands: `== data.active` is the path-on-the-right this rule refuses.
    for (const op of ['==', '!='] as const) {
      const [finding] = validatePredicatePathRefs({ views: [formView(`data.type ${op} pending`)] })
        .filter((f) => f.rule === PREDICATE_RHS_PATH_SHAPED);
      expect(finding!.userTextParams).toEqual({ view: 'acme_field_editor', word: 'pending', op });
      for (const tag of PLATFORM_LOCALE_TAGS) {
        const text = findingUserMessage(finding!, [tag])!;
        expect(text, `${op} · ${tag}: the text reading`).toContain(`${op} 'pending'`);
        expect(text, `${op} · ${tag}: the field reading`).toContain("data.pending == 'yes'");
        expect(text, `${op} · ${tag}: never the root in place`).not.toContain(`${op} data.pending`);
      }
    }
  });

  it('renders the connector and permission sentences in zh-Hans and en with the names they carry', () => {
    const header = findingOf(CASES[0]!);
    expect(findingUserMessage(header, ['zh-CN'])).toContain('连接器“acme_billing”的请求头“Authorization”');
    expect(findingUserMessage(header, ['zh-CN'])).toContain('请将它保存到连接器凭据');
    expect(findingUserMessage(header, ['en-US'])).toContain(
      'Connector "acme_billing" has a credential written directly into its header "Authorization"',
    );
    const residue = findingOf(CASES[4]!);
    expect(findingUserMessage(residue, ['zh-CN'])).toContain('权限集“acme_support_agent”仍为对象“acme_ticket”设置了“allowRestore: false”');
  });

  it('gives no sentence where the finding is not advice the door returns', () => {
    // The dotted arm of the same id refuses the write: no params.
    const dotted = validatePredicatePathRefs({ views: [formView('data.type == data.label')] })
      .filter((f) => f.rule === PREDICATE_RHS_PATH_SHAPED);
    expect(dotted.map((f) => f.severity)).toEqual(['error']);
    expect(dotted[0]!.userTextParams).toBeUndefined();
  });
});

describe('connector, permission and form advisories user text · from the runtime gate to the wire field', () => {
  /** The element the save door's `advisories[]` carries, with the sentence it renders. */
  const issueOf = (advisory: { rule: string; path: string; where: string; message: string; hint: string; severity: string; userTextParams?: Record<string, string> }, locales: string[]) =>
    RuntimeAuthoringIssueSchema.parse({
      rule: advisory.rule,
      path: advisory.path,
      where: advisory.where,
      message: advisory.message,
      hint: advisory.hint,
      severity: advisory.severity,
      userMessage: findingUserMessage(advisory, locales),
    });

  it('a connector write\'s credential advisory carries its params through the registry adapter', () => {
    const result = runRuntimeAuthoringRules({ type: 'connector', item: restConnector, context: { objects: [] } });
    const advisory = result.advisories.find((f) => f.rule === CONNECTOR_CREDENTIAL_LITERAL);
    expect(advisory, JSON.stringify(result.advisories)).toBeDefined();
    expect(advisory!.userTextParams).toEqual({ connector: 'acme_billing', name: 'Authorization', position: 'header' });

    const issue = issueOf(advisory!, ['de-DE', 'en']);
    expect(issue.rule).toBe('connector-credential-literal');
    expect(issue.userMessage).toContain('Der Connector „acme_billing“');
    expect(issue.userMessage).not.toContain(SECRET.header);
    expect(issue.message).toBe(advisory!.message);
  });

  it('a permission write\'s retired-key advisory carries its params through the registry adapter', () => {
    const result = runRuntimeAuthoringRules({ type: 'permission', item: permissionSet('allowPurge'), context: { objects: [] } });
    const advisory = result.advisories.find((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
    expect(advisory, JSON.stringify(result.advisories)).toBeDefined();
    expect(advisory!.userTextParams).toEqual({ permissionSet: 'acme_support_agent', object: 'acme_ticket', key: 'allowPurge' });

    const issue = issueOf(advisory!, ['ja-JP']);
    expect(issue.userMessage).toContain('権限セット「acme_support_agent」は、オブジェクト「acme_ticket」に対してまだ「allowPurge: false」');
  });

  it('a view write\'s unquoted-word advisory renders a valid userMessage', () => {
    const result = runRuntimeAuthoringRules({ type: 'view', item: formView('data.type == active'), context: { objects: [] } });
    const advisory = result.advisories.find((f) => f.rule === PREDICATE_RHS_PATH_SHAPED);
    expect(advisory, JSON.stringify(result.advisories)).toBeDefined();
    expect(advisory!.userTextParams).toEqual({ view: 'acme_field_editor', word: 'active', op: '==' });

    const issue = issueOf(advisory!, ['fr-FR']);
    expect(issue.userMessage).toContain('formulaire « acme_field_editor »');
    expect(issue.userMessage).toContain("== 'active'");
  });
});
