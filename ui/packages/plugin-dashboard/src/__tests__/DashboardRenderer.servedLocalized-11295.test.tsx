/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11295 — a SERVED dashboard is not translated a second time.
 *
 * ## The defect
 *
 * A dashboard read from the server's `/meta` route is already resolved for the
 * request's locale: `translateDashboard` (`@objectstack/spec`) overlays the
 * packaged catalog onto `label`, `description` and each widget's `title` and
 * `description`, and since
 * objectstack#20680 / #20730 it keeps a published edit over that catalog (an
 * explicit override beats the packaged default). The renderer then ran the
 * client bundle over the served strings AGAIN, offering each served value as
 * the bundle's fallback — and a bundle entry always wins a fallback. So the
 * packaged catalog won a second time, client-side, and a published edit drew as
 * the shipped string. Measured in a browser on objectstack#20730: the console
 * drew `Total Users` (en) and `用户总数` (zh-CN) while its own `/meta/dashboard`
 * answer carried the edit.
 *
 * ## The signal
 *
 * `DashboardRenderer` cannot see where its document came from, so the host that
 * read it says so: `localized` is set by the console's dashboard page, which
 * draws a document from the `/meta` read (`DashboardView`). With it, the served
 * title and description are drawn as given. Without it — an inline
 * or preview document the server never translated — the bundle composition is
 * unchanged, and the last block below is the control for that.
 *
 * ## Directions, written before the run
 *
 *  - served + published edit, `en` and `zh-CN` → RED before the change (the
 *    bundle answered), GREEN after;
 *  - served + unedited (the server already put the translation in) → GREEN on
 *    both sides: drawing as given and re-translating agree when nothing was
 *    edited;
 *  - inline, the same edited document with no `localized` → GREEN on both
 *    sides: the bundle still wins there, which is the control.
 *
 * ## The retired sub-caption (objectui#11389)
 *
 * The widget used to carry a fifth text, its sub-caption
 * (`options.description`, translated by a `subCaption` bundle entry). Ruling C
 * retired it at both ends, so the fixtures keep both on the widget and in the
 * bundle, and every case pins that neither draws, served or inline.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope, never a hook — AGENTS.md §测试纪律. The widgets render through
// `SchemaRenderer`, which resolves `kpi` from the registry the barrel fills.
import { DashboardRenderer } from '../index';

afterEach(cleanup);

/**
 * The packaged catalog, as the console loads it into `I18nProvider`. `platform`
 * is discovered as an app namespace because it carries a `dashboards` key. The
 * `en` entries repeat the shipped English, as the platform's own `en` bundle
 * does — which is why an `en` reader lost the edit too.
 */
const BUNDLE = {
  en: {
    platform: {
      dashboards: {
        system_overview: {
          label: 'System Overview',
          description: 'Platform health at a glance',
          widgets: {
            widget_total_users: {
              title: 'Total Users',
              description: 'Active accounts',
              // Refused by the installed spec; kept to pin that it draws nothing.
              subCaption: 'Across all organizations',
            },
          },
        },
      },
    },
  },
  'zh-CN': {
    platform: {
      dashboards: {
        system_overview: {
          label: '系统概览',
          description: '平台健康一览',
          widgets: {
            widget_total_users: {
              title: '用户总数',
              description: '活跃账户',
              subCaption: '覆盖所有组织',
            },
          },
        },
      },
    },
  },
};

interface Texts {
  label: string;
  description: string;
  title: string;
  widgetDescription: string;
}

/**
 * The retired sub-caption: authored on the widget's `options` and translated
 * by the bundle's `subCaption` entries above. None of these may draw.
 */
const RETIRED_SUB_CAPTION = 'All orgs (edited-11295)';
const RETIRED_TEXTS = [RETIRED_SUB_CAPTION, 'Across all organizations', '覆盖所有组织'];

/** A published edit, as the server serves it in every locale. */
const EDITED: Texts = {
  label: 'Operations board (edited-11295)',
  description: 'What the ops team watches (edited-11295)',
  title: 'Total Users (edited-11295)',
  widgetDescription: 'Accounts (edited-11295)',
};

/** The unedited document, as the server serves it per locale: already translated. */
const SERVED_UNEDITED: Record<'en' | 'zh-CN', Texts> = {
  en: {
    label: 'System Overview',
    description: 'Platform health at a glance',
    title: 'Total Users',
    widgetDescription: 'Active accounts',
  },
  'zh-CN': {
    label: '系统概览',
    description: '平台健康一览',
    title: '用户总数',
    widgetDescription: '活跃账户',
  },
};

/**
 * One `kpi` widget: metric-family but not self-contained, so the card header
 * draws `title` + `description` and the metric inside draws its value. Its
 * `options.description` is the retired sub-caption, kept to pin its absence.
 * `header` makes the renderer's own title and description visible too.
 */
function dashboard(texts: Texts): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'system_overview',
    label: texts.label,
    description: texts.description,
    header: { showTitle: true, showDescription: true },
    widgets: [
      {
        id: 'widget_total_users',
        type: 'kpi',
        title: texts.title,
        description: texts.widgetDescription,
        options: { value: 42, description: RETIRED_SUB_CAPTION },
      },
    ],
  } as unknown as DashboardComponentSchema;
}

function renderIn(language: 'en' | 'zh-CN', schema: DashboardComponentSchema, localized: boolean) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }}>
      {localized ? <DashboardRenderer schema={schema} localized /> : <DashboardRenderer schema={schema} />}
    </I18nProvider>,
  );
}

/** Every text on screen at least once — a `kpi` draws its title twice (card header and metric label). */
function expectDrawn(texts: Texts) {
  for (const text of Object.values(texts)) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}

function expectAbsent(texts: Texts | readonly string[]) {
  for (const text of Object.values(texts)) expect(screen.queryByText(text)).toBeNull();
}

describe('DashboardRenderer — a served dashboard is drawn as served (objectui#11295)', () => {
  it.each(['en', 'zh-CN'] as const)('%s: a published edit renders as served, not as the packaged string', (language) => {
    renderIn(language, dashboard(EDITED), true);

    expectDrawn(EDITED);
    // The packaged catalog must not win a second time, client-side.
    expectAbsent(SERVED_UNEDITED[language]);
    expectAbsent(RETIRED_TEXTS);
  });

  it.each(['en', 'zh-CN'] as const)('%s: an unedited widget still shows the packaged translation the server put in', (language) => {
    renderIn(language, dashboard(SERVED_UNEDITED[language]), true);

    expectDrawn(SERVED_UNEDITED[language]);
    expectAbsent(RETIRED_TEXTS);
  });
});

describe('DashboardRenderer — an inline document keeps the bundle composition (control, objectui#11295)', () => {
  it.each(['en', 'zh-CN'] as const)('%s: the bundle still wins over the authored strings', (language) => {
    // The same edited strings, but authored inline: no server translated this
    // document, so the client bundle is its one translation pass.
    renderIn(language, dashboard(EDITED), false);

    expectDrawn(SERVED_UNEDITED[language]);
    expectAbsent(EDITED);
    expectAbsent(RETIRED_TEXTS);
  });
});
