// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Capability Map — the showcase's landing page and index.
 *
 * One card per protocol domain (the same six-domain taxonomy as
 * `DEFAULT_METADATA_TYPE_REGISTRY` and the `src/` layout), each linking the
 * domain's flagship demos plus its guided-tour doc. Self-referential by
 * design: the map of the platform's capabilities is itself built from them
 * (`kind: 'html'` constrained JSX — parsed, never executed, ADR-0080; theme
 * tokens per ADR-0065).
 *
 * The AI card is deliberately a "deferred" card, not a demo: agents are
 * platform-owned (ADR-0063) and the open framework exposes AI via MCP only —
 * the coverage manifest waives agent/tool/skill with issue #2610. Never
 * advertise what the runtime doesn't deliver (Prime Directive #10).
 */

const card = (
  eyebrow: string,
  title: string,
  body: string,
  links: Array<[href: string, label: string]>,
) => `
    <flex direction="col" gap={2} style={{"background":"hsl(var(--card))","border":"1px solid hsl(var(--border))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"12px","fontWeight":"700","letterSpacing":"0.06em","textTransform":"uppercase","color":"hsl(var(--primary))"}}>${eyebrow}</box>
      <box style={{"fontSize":"18px","fontWeight":"600","color":"hsl(var(--foreground))"}}>${title}</box>
      <box style={{"fontSize":"14px","lineHeight":"1.6","color":"hsl(var(--muted-foreground))"}}>${body}</box>
      <flex direction="col" gap={1} style={{"marginTop":"4px"}}>
${links
  .map(
    ([href, label]) =>
      `        <a href="${href}" style={{"fontSize":"13px","fontWeight":"600","color":"hsl(var(--primary))","textDecoration":"none"}}>→ ${label}</a>`,
  )
  .join('\n')}
      </flex>
    </flex>`;

export const CapabilityMapPage = definePage({
  name: 'showcase_capability_map',
  label: 'Capability Map',
  type: 'home',
  kind: 'html',
  isDefault: true,
  source: `
<flex direction="col" gap={8} style={{"maxWidth":"1080px","margin":"0 auto","padding":"40px"}}>

  <flex direction="col" gap={2}>
    <box style={{"fontSize":"12px","fontWeight":"600","letterSpacing":"0.12em","textTransform":"uppercase","color":"hsl(var(--primary))"}}>ObjectStack Showcase</box>
    <box style={{"fontSize":"32px","fontWeight":"700","letterSpacing":"-0.02em","color":"hsl(var(--foreground))"}}>The capability map</box>
    <box style={{"maxWidth":"720px","fontSize":"15px","lineHeight":"1.6","color":"hsl(var(--muted-foreground))"}}>Every metadata capability the platform delivers, demonstrated once and indexed here — one card per protocol domain, mirroring the registry and the src/ layout. The coverage test keeps this map honest: a new capability fails CI until it is demonstrated or explicitly waived.</box>
  </flex>

  <box style={{"display":"grid","gridTemplateColumns":"repeat(2, 1fr)","gap":"20px"}}>
${card('data', 'Objects, fields & rules', 'The Account → Project → Task backbone plus the Field Zoo specimen (every field type), relationships, enforced validation rules, hooks, seed data, an object-extension overlay, and the analytics cube.', [
  ['apps/com.example.showcase/showcase_field_zoo', 'Field Zoo'],
  ['apps/com.example.showcase/showcase_project', 'Projects (backbone)'],
  ['apps/com.example.showcase/showcase_account', 'Accounts (extension overlay)'],
  ['docs/showcase_tour_data', 'Read the Data tour'],
])}
${card('ui', 'Views, pages & analytics surfaces', 'Every list-view and form-view type on one object, four page-authoring models, one widget per chart family, summary/matrix/joined reports, datasets, and the action matrix.', [
  ['apps/com.example.showcase/page/showcase_task_all_views', 'All Views'],
  ['apps/com.example.showcase/dashboard/showcase_chart_gallery', 'Chart Gallery'],
  ['apps/com.example.showcase/page/showcase_start_here', 'Page authoring (Start Here)'],
  ['docs/showcase_tour_ui', 'Read the UI tour'],
])}
${card('automation', 'Flows, approvals & schedules', 'Record-change flows, a screen wizard, an approval chain with escalation, scheduled jobs, webhooks, and live REST/Slack connector actions.', [
  ['apps/com.example.showcase/page/showcase_review_queue', 'Approvals inbox'],
  ['apps/com.example.showcase/page/showcase_command_center', 'Command Center'],
  ['docs/showcase_tour_automation', 'Read the Automation tour'],
])}
${card('system', 'Datasources, i18n & docs', 'External-datasource federation (auto-connecting, read-only), en/zh-CN translations, email templates, a custom REST endpoint, and this manual itself — docs and books as metadata.', [
  ['apps/com.example.showcase/showcase_external_customer', 'Federated External Customers'],
  ['docs/showcase_index', 'The manual (docs-as-metadata)'],
  ['docs/showcase_tour_system', 'Read the System tour'],
])}
${card('security', 'Roles, permissions & sharing', 'A role hierarchy, permission sets with field- and row-level security, the fallback profile, and sharing rules — declared in metadata and enforced end to end.', [
  ['apps/com.example.showcase/showcase_private_note', 'Private Notes (owner-only)'],
  ['docs/showcase_tour_security', 'Read the Security tour'],
])}
${card('ai · deferred', 'Agents, tools & skills', 'Deliberately not demonstrated here: agents are platform-owned (ADR-0063) and the open framework exposes AI via MCP only. The coverage manifest waives agent/tool/skill with a tracking issue instead of faking a demo.', [
  ['https://github.com/objectstack-ai/objectstack/issues/2610', 'Tracking issue #2610'],
])}
  </box>

  <box style={{"fontSize":"13px","lineHeight":"1.6","color":"hsl(var(--muted-foreground))"}}>Provenance: src/coverage.ts — every metadata kind in the registry is either demonstrated (with proof files) or waived (with a reason and an issue). Run pnpm verify to hold the map to it.</box>
</flex>`,
});
