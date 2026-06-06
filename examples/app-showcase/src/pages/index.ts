// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

export { ProjectWorkspacePage } from './project-workspace.page.js';
export { ProjectDetailPage } from './project-detail.page.js';

/**
 * Component Gallery — a custom page that places a spread of standard page
 * components (header, card, tabs, text/number/image/divider/button elements,
 * and the AI chat window) so the page renderer and component registry can be
 * exercised visually.
 */
export const ComponentGalleryPage: Page = {
  name: 'showcase_component_gallery',
  label: 'Component Gallery',
  type: 'home',
  template: 'header-sidebar-main',
  isDefault: true,
  kind: 'full',
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'ObjectStack Showcase',
            subtitle: 'Every metadata type, every view, every chart — in one workspace.',
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        { type: 'element:text', properties: { content: 'This page demonstrates the standard page component set. Open the navigation to explore objects, the 8 list-view types on Tasks, the Chart Gallery dashboard, and the four report types.' } },
        { type: 'element:divider', properties: {} },
        { type: 'page:card', properties: { title: 'Getting Started' } },
        { type: 'element:number', properties: { label: 'Demo Tasks', value: 12 } },
        { type: 'element:image', properties: { src: 'https://objectstack.ai/logo.png', alt: 'Logo' } },
        { type: 'element:button', properties: { label: 'Create Task', actionName: 'showcase_new_task' } },
      ],
    },
    {
      name: 'sidebar',
      width: 'small',
      components: [
        // NOTE: `ai:chat_window` is intentionally NOT a supported inline page
        // component — the canonical chat entry point is the floating chatbot
        // overlay (plugin-chatbot), so referencing it here surfaces a loud
        // "Unknown component type". Use a supported inline AI block instead.
        { type: 'ai:input', properties: { agentName: 'showcase_assistant', placeholder: 'Ask the showcase assistant…' } },
      ],
    },
  ],
};
