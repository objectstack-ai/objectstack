// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Command Center — a `kind:'html'` page (ADR-0080): constrained JSX compiled to
 * the SDUI tree, parsed-never-executed. It composes registered components with
 * structured layout — the html tier's actual purpose.
 *
 * Styling (ADR-0065): a page's source is runtime metadata the build's Tailwind
 * never scans, so utility `className`s silently no-op. So this page uses NO
 * Tailwind: layout is the components' own structured props (`<flex direction gap>`,
 * `<grid columns>`), and any custom CSS is a JSON `style` object with
 * `hsl(var(--token))` theme colors (quoted keys/values — a JS-style object is
 * parsed as a deferred expression and won't apply).
 *
 * The KPI numbers are STATIC SAMPLE COPY, and the page says so on screen —
 * hand-authored html JSX carries no data bindings. Its data-bound twin
 * (command-center.page.ts, kind:'full' with `object-metric`/`object-chart`)
 * shows the same board with live numbers; together they demo the tier
 * trade-off honestly.
 */
export const CommandCenterJsxPage = definePage({
  name: 'showcase_command_center_jsx',
  label: 'Command Center (HTML)',
  type: 'home',
  kind: 'html',
  source: `
<flex direction="col" gap={8} style={{"padding":"40px"}}>

  <flex direction="col" gap={2}>
    <box style={{"fontSize":"12px","fontWeight":"600","letterSpacing":"0.12em","textTransform":"uppercase","color":"hsl(var(--primary))"}}>Operations · HTML-source page</box>
    <box style={{"fontSize":"36px","fontWeight":"700","letterSpacing":"-0.02em","color":"hsl(var(--foreground))"}}>Command Center</box>
    <box style={{"maxWidth":"640px","fontSize":"15px","lineHeight":"1.6","color":"hsl(var(--muted-foreground))"}}>Authored as constrained JSX and compiled to the SDUI tree — parsed, never executed. Layout is structured component props; color is an inline style object with theme tokens. No Tailwind. The KPI numbers are static sample copy — for the live, data-bound version of this board see Command Center (大屏) in Analytics.</box>
  </flex>

  <grid columns={4} gap={5}>
    <flex direction="col" gap={2} style={{"background":"hsl(var(--card))","border":"1px solid hsl(var(--border))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"13px","fontWeight":"500","color":"hsl(var(--muted-foreground))"}}>Open Tasks</box>
      <box style={{"fontSize":"34px","fontWeight":"700","color":"hsl(var(--foreground))"}}>128</box>
      <box style={{"fontSize":"12px","fontWeight":"600","color":"hsl(142 70% 45%)"}}>▲ 12% vs last week</box>
    </flex>
    <flex direction="col" gap={2} style={{"background":"hsl(var(--card))","border":"1px solid hsl(var(--border))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"13px","fontWeight":"500","color":"hsl(var(--muted-foreground))"}}>In Progress</box>
      <box style={{"fontSize":"34px","fontWeight":"700","color":"hsl(var(--foreground))"}}>47</box>
      <box style={{"fontSize":"12px","fontWeight":"600","color":"hsl(38 92% 50%)"}}>● 9 due today</box>
    </flex>
    <flex direction="col" gap={2} style={{"background":"hsl(var(--card))","border":"1px solid hsl(var(--border))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"13px","fontWeight":"500","color":"hsl(var(--muted-foreground))"}}>Completed</box>
      <box style={{"fontSize":"34px","fontWeight":"700","color":"hsl(var(--foreground))"}}>1,902</box>
      <box style={{"fontSize":"12px","fontWeight":"600","color":"hsl(142 70% 45%)"}}>▲ 4% this month</box>
    </flex>
    <flex direction="col" gap={2} style={{"background":"hsl(var(--primary))","border":"1px solid hsl(var(--primary))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"13px","fontWeight":"500","color":"hsl(var(--primary-foreground))"}}>Cycle Time</box>
      <box style={{"fontSize":"34px","fontWeight":"700","color":"hsl(var(--primary-foreground))"}}>2.4d</box>
      <box style={{"fontSize":"12px","fontWeight":"600","color":"hsl(var(--primary-foreground))"}}>▼ 18% faster</box>
    </flex>
  </grid>

  <grid columns={3} gap={5}>
    <flex direction="col" gap={6} style={{"gridColumn":"span 2","background":"hsl(var(--card))","border":"1px solid hsl(var(--border))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"16px","fontWeight":"600","color":"hsl(var(--foreground))"}}>Weekly Throughput</box>
      <box style={{"display":"grid","gridTemplateColumns":"repeat(7, 1fr)","gap":"16px","height":"140px","width":"100%","alignItems":"end"}}>
        <box style={{"height":"48px","borderRadius":"8px","background":"hsl(var(--primary) / 0.55)"}} />
        <box style={{"height":"86px","borderRadius":"8px","background":"hsl(var(--primary) / 0.7)"}} />
        <box style={{"height":"64px","borderRadius":"8px","background":"hsl(var(--primary) / 0.55)"}} />
        <box style={{"height":"120px","borderRadius":"8px","background":"hsl(var(--primary))"}} />
        <box style={{"height":"58px","borderRadius":"8px","background":"hsl(var(--primary) / 0.55)"}} />
        <box style={{"height":"100px","borderRadius":"8px","background":"hsl(var(--primary) / 0.7)"}} />
        <box style={{"height":"40px","borderRadius":"8px","background":"hsl(var(--primary) / 0.4)"}} />
      </box>
    </flex>
    <flex direction="col" gap={4} style={{"background":"hsl(var(--card))","border":"1px solid hsl(var(--border))","borderRadius":"var(--radius)","padding":"24px"}}>
      <box style={{"fontSize":"16px","fontWeight":"600","color":"hsl(var(--foreground))"}}>Recent Activity</box>
      <flex direction="row" gap={3} align="center"><flex style={{"width":"8px","height":"8px","borderRadius":"9999px","background":"hsl(142 70% 45%)"}} /><box style={{"fontSize":"14px","color":"hsl(var(--muted-foreground))"}}>Onboarding flow shipped</box></flex>
      <flex direction="row" gap={3} align="center"><flex style={{"width":"8px","height":"8px","borderRadius":"9999px","background":"hsl(var(--primary))"}} /><box style={{"fontSize":"14px","color":"hsl(var(--muted-foreground))"}}>12 tasks moved to Review</box></flex>
      <flex direction="row" gap={3} align="center"><flex style={{"width":"8px","height":"8px","borderRadius":"9999px","background":"hsl(38 92% 50%)"}} /><box style={{"fontSize":"14px","color":"hsl(var(--muted-foreground))"}}>SLA breach on #4821</box></flex>
      <flex direction="row" gap={3} align="center"><flex style={{"width":"8px","height":"8px","borderRadius":"9999px","background":"hsl(var(--muted-foreground))"}} /><box style={{"fontSize":"14px","color":"hsl(var(--muted-foreground))"}}>Sprint 42 planning</box></flex>
    </flex>
  </grid>
</flex>`,
});
