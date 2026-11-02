// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under zh-CN, the Task Detail page's "Awaiting review" banner
 * (`record:alert`, shown while a task is in review) is served in Chinese
 * like the rest of the page.
 *
 * The banner's two strings travel by two routes. `title` is translated by the
 * bundle through the page-component route
 * (`pages.showcase_task_detail.components.review_alert.title`), which needs
 * the node's `id` — before it had one the route could not address it and the
 * title stayed English. `body` has no key on that face, so it is an inline
 * locale map on the page; the renderer picks the reader's locale from it
 * (`pickLocalized`), so the served document must still carry that map
 * intact. The pin is the translator applied to the page with the app's own
 * bundle, which is what the REST boundary does per request locale.
 */
import { describe, expect, it } from 'vitest';
import {
  translateMetadataDocument,
  TranslationBundleSchema,
  type TranslationBundle,
} from '@objectstack/spec/system';
import { TaskDetailPage } from '../src/ui/pages/task-detail.page.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

const bundle = ShowcaseTranslationBundle as unknown as TranslationBundle;

type Node = { id?: string; type: string; properties?: Record<string, unknown> };
const reviewAlert = (page: { regions?: Array<{ components: Node[] }> }): Node | undefined =>
  page.regions?.flatMap((r) => r.components).find((c) => c.type === 'record:alert');

describe('showcase Task Detail — the review banner under zh-CN', () => {
  it('serves the banner title from the bundle and keeps the body\'s locale map', () => {
    const out = translateMetadataDocument('page', TaskDetailPage, bundle, { locale: 'zh-CN' });
    const alert = reviewAlert(out);
    expect(alert?.id).toBe('review_alert');
    expect(alert?.properties?.title).toBe('待评审');
    expect(alert?.properties?.body).toEqual({
      en: 'This task is in review — confirm the work before marking it done.',
      'zh-CN': '此任务正在评审中——请先确认工作成果，再标记为完成。',
    });
    // The dismissal key does not move with the translated title.
    expect(alert?.properties?.dismissKey).toBe('showcase_task_review');
  });

  it('leaves the authored English title in place for the default locale', () => {
    const out = translateMetadataDocument('page', TaskDetailPage, bundle, { locale: 'en' });
    expect(reviewAlert(out)?.properties?.title).toBe('Awaiting review');
  });

  it('carries the title entry in a bundle the spec accepts', () => {
    // The bundle schema is strict on `components.<id>`: a key outside the
    // page-component copy face (such as `body`) is refused, so the entry
    // this page relies on must parse as written.
    const zh = (ShowcaseTranslationBundle as Record<string, unknown>)['zh-CN'];
    expect(TranslationBundleSchema.safeParse({ 'zh-CN': zh }).success).toBe(true);
  });
});
