// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Doc } from '@objectstack/spec/system';

/**
 * Studio app overview doc (ADR-0046), registered in this package's manifest so
 * it groups under "Studio" in the `/_console/docs` index.
 *
 * Authored inline rather than as a flat `src/docs/*.md` file because this is a
 * TS-first code package built by tsup, not a user app built by `os build` —
 * `defineStack({ docs })` / manifest `docs[]` is the supported path for those
 * (see `DocSchema` in `@objectstack/spec/system`). The `content` below is plain
 * CommonMark + GFM with no images/MDX, per ADR-0046 §3.4.
 *
 * Principle (from the HotCRM reference docs): document the *invisible*
 * business logic, not what the Studio UI already shows on screen.
 *
 * `translations` carries per-locale variants (ADR-0046 i18n); the REST layer
 * collapses the doc to the request's `Accept-Language` and serves one body.
 */
export const STUDIO_OVERVIEW_DOC: Doc = {
  name: 'studio_overview',
  label: 'Studio overview',
  description: 'Orientation for builders: the metadata-first model, overlay precedence, and publishing.',
  content: `# Studio overview

Studio is the builder app — the workbench for shaping the platform's
*metadata*: objects, fields, views, flows, agents, and the rest. Most of its
screens are self-explanatory; this page covers the one rule that is not visible
on screen but governs everything you do here. For the full reference, see
<https://objectstack.ai>.

## Metadata-first

In Studio you do not edit a running database — you edit *definitions*. Every
object, field, and view is a metadata record, and the live application is
generated from that metadata. This is why a change in Studio can reshape the UI
and the API at once: you are changing the model, not patching a screen.

## Edits are overlays (the invisible rule)

Your changes do not mutate the metadata shipped by a package in place. Studio
writes an **overlay** on top of the base definition, and the runtime resolves
the two by precedence: an unpublished **draft** wins for you while you work, a
published **tenant overlay** wins over the package's baseline, and the package
baseline is the fallback (ADR-0005, ADR-0033). The practical consequence: the
base definition is never destroyed, so an overlay can always be reverted to
recover the original — and a field that "won't change" is usually being shadowed
by a higher-precedence layer.

## Publishing & deploying

A draft is visible only to you until you **publish** it, which promotes the
overlay so the rest of the tenant sees it. Moving changes between environments
(for example dev → production) is a separate **deploy** step, not an automatic
side effect of publishing — keeping the two distinct is what lets you build
safely in one environment before shipping.

See <https://objectstack.ai> for drafts, overlays, and deployment in depth.
`,
  translations: {
    zh: {
      label: 'Studio 概览',
      description: '搭建者入门:元数据优先模型、覆盖层优先级、发布与部署。',
      content: `# Studio 概览

Studio 是搭建者应用——塑造平台*元数据*的工作台:对象、字段、视图、流程、智能体等。
它的大多数界面一目了然;本页讲的是那条界面上看不见、却支配你在这里一切操作的规则。
完整参考见 <https://objectstack.ai>。

## 元数据优先

在 Studio 里你编辑的不是运行中的数据库,而是*定义*。每个对象、字段、视图都是一条
元数据记录,运行的应用由这些元数据生成。这就是为什么 Studio 里的一处改动能同时重塑
UI 和 API:你改的是模型,而不是修补某个界面。

## 编辑即覆盖层(看不见的规则)

你的改动不会原地修改某个包发布的元数据。Studio 在基础定义之上写一层**覆盖层**,
运行时按优先级解析两者:未发布的**草稿**在你编辑时对你生效,已发布的**租户覆盖层**
优先于包的基线,包基线则是兜底(ADR-0005、ADR-0033)。实际后果:基础定义永不被
销毁,所以覆盖层总能回退以恢复原样——而一个"改不动"的字段,通常是被更高优先级的
层遮住了。

## 发布与部署

草稿只对你自己可见,直到你**发布**它,把覆盖层提升给整个租户看到。在环境之间搬运
改动(例如开发 → 生产)是单独的**部署**步骤,不是发布的自动副作用——把两者分开,
才能让你在一个环境里安全搭建、再上线。

草稿、覆盖层与部署的细节见 <https://objectstack.ai>。
`,
    },
  },
};
