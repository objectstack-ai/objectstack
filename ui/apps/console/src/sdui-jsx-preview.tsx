/* ADR-0080 browser preview: a kind:'html' page rendered through the real
 * PageRenderer (compile -> SchemaRenderer).
 *
 * ADR-0080 EXCEPTION — Tailwind in page source
 * The page source below authors Tailwind classNames. The rule forbids that in
 * real page metadata: `source` is RUNTIME metadata, the console's Tailwind is
 * compiled at BUILD time by scanning the console's own `src` (`@source
 * '../src/**'` in index.css) with no safelist, so a utility class authored in a
 * real page produces no CSS and no error anywhere. `os validate` reports it as
 * `page-source-className-tailwind` (ADR-0065; ADR-0080's 2026-06-30 amendment;
 * `content/docs/guide/react-pages.md` §Styling).
 *
 * It renders fully styled HERE only because this harness file is itself inside
 * the scanned `src` — precisely the "works only by coincidence" failure mode
 * ADR-0065 names. This file is a renderer-PLUMBING preview (does the html tier
 * compile and mount the registered blocks), not an authoring example: DO NOT
 * copy its source string into a page. The authoring example is
 * `sdui-tiers-preview.tsx`, whose sources carry no className at all and style
 * with each tier's real primitive.
 *
 * `__tests__/sdui-preview-page-source-styling.test.ts` pins this exception:
 * the note cannot be dropped while the classNames stand, and a NEW harness
 * cannot inherit the exception unnoticed. */
import './index.css';
import '@object-ui/components';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchemaRenderer } from '@object-ui/react';

const source = `
<flex direction="col" className="min-h-screen gap-10 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-10">

  <flex direction="col" className="gap-3">
    <badge className="w-fit rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-indigo-700" label="Operations · JSX-source page" />
    <text className="block text-5xl font-bold tracking-tight text-slate-900" content="Command Center" />
    <text className="block max-w-2xl text-base leading-relaxed text-slate-500" content="This whole page is authored as constrained JSX + Tailwind and compiled to the SDUI tree — parsed, never executed. Every card is a real registered component." />
  </flex>

  <grid columns={4} className="gap-5">
    <card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <text className="block text-sm font-medium text-slate-500" content="Open Tasks" />
      <text className="mt-3 block text-4xl font-bold text-slate-900" content="128" />
      <text className="mt-2 block text-xs font-semibold text-emerald-600" content="▲ 12% vs last week" />
    </card>
    <card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <text className="block text-sm font-medium text-slate-500" content="In Progress" />
      <text className="mt-3 block text-4xl font-bold text-slate-900" content="47" />
      <text className="mt-2 block text-xs font-semibold text-amber-600" content="● 9 due today" />
    </card>
    <card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <text className="block text-sm font-medium text-slate-500" content="Completed" />
      <text className="mt-3 block text-4xl font-bold text-slate-900" content="1,902" />
      <text className="mt-2 block text-xs font-semibold text-emerald-600" content="▲ 4% this month" />
    </card>
    <card className="rounded-2xl border border-indigo-300 bg-gradient-to-br from-indigo-500 to-violet-600 p-6 shadow-md">
      <text className="block text-sm font-medium text-indigo-100" content="Cycle Time" />
      <text className="mt-3 block text-4xl font-bold text-white" content="2.4d" />
      <text className="mt-2 block text-xs font-semibold text-indigo-100" content="▼ 18% faster" />
    </card>
  </grid>

  <grid columns={3} className="gap-5">
    <card className="col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <text className="block text-lg font-semibold text-slate-900" content="Weekly Throughput" />
      <flex direction="row" className="mt-8 items-end gap-4">
        <flex className="h-12 w-full rounded-lg bg-indigo-400" />
        <flex className="h-20 w-full rounded-lg bg-indigo-500" />
        <flex className="h-16 w-full rounded-lg bg-indigo-400" />
        <flex className="h-28 w-full rounded-lg bg-violet-500" />
        <flex className="h-14 w-full rounded-lg bg-indigo-400" />
        <flex className="h-24 w-full rounded-lg bg-indigo-500" />
        <flex className="h-10 w-full rounded-lg bg-indigo-300" />
      </flex>
    </card>
    <card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <text className="block text-lg font-semibold text-slate-900" content="Recent Activity" />
      <stack className="mt-4 gap-3">
        <flex direction="row" className="items-center gap-3"><flex className="h-2 w-2 rounded-full bg-emerald-500" /><text className="text-sm text-slate-600" content="Onboarding flow shipped" /></flex>
        <flex direction="row" className="items-center gap-3"><flex className="h-2 w-2 rounded-full bg-indigo-500" /><text className="text-sm text-slate-600" content="12 tasks moved to Review" /></flex>
        <flex direction="row" className="items-center gap-3"><flex className="h-2 w-2 rounded-full bg-amber-500" /><text className="text-sm text-slate-600" content="SLA breach on #4821" /></flex>
        <flex direction="row" className="items-center gap-3"><flex className="h-2 w-2 rounded-full bg-slate-300" /><text className="text-sm text-slate-600" content="Sprint 42 planning" /></flex>
      </stack>
    </card>
  </grid>
</flex>`;

const page = { type: 'home', kind: 'html', name: 'command_center', label: 'Command Center', source };

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SchemaRenderer schema={page as any} />
  </React.StrictMode>,
);
