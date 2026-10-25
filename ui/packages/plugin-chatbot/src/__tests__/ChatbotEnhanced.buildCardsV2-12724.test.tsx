/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12724, phase 2 — the AiBuild artboard's v2 rows, drawn from the keys
 * objectstack-ai/cloud declares (`build-cards.schema.json`, vendored as
 * `fixtures/build-cards.schema.ts`; every fixture here is checked against it by
 * `buildCards.contract-12724.test.ts`):
 *
 *  - the plan card, from `propose_blueprint`'s `planCard`: field chips with the
 *    format constraint in mono type and a dashed 「补充」 chip for a suggested
 *    field, 「名称：FIELD」 from `nameField`, one intent line per view, the
 *    assumptions as a list, and the sample-data line;
 *  - the result card, from `apply_blueprint` / `verify_build`'s `checklist`:
 *    the 核对通过 chip, the verified lines in two columns, and 打开应用 / 在
 *    Studio 中查看 fed by `checklist.app` and `checklist.packageId`;
 *  - the 「接下来可以说」 line from `nextSteps`, on both envelopes a build really
 *    sends (drafted, and drafted with `materialized: true` when it was
 *    published in the turn).
 *
 * And every row degrades to phase 1's shape when its key is absent: a tenant
 * on an older cloud build sends none of them.
 *
 * Each message goes through the real mapper (`uiMessageToChatMessage`) from a
 * raw tool part, so the lift is under test, not a hand-built invocation.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessageToChatMessage } from '../mapMessages';
import { applyEnvelope, checklistOf, planEnvelope, verifyEnvelope } from './fixtures/buildCards.fixtures';

function inLocale(lang: 'zh' | 'en', ui: React.ReactElement) {
  return (
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>
  );
}

/** One assistant turn whose tool parts finished with these envelopes. */
const turn = (id: string, ...tools: Array<[string, unknown]>) =>
  uiMessageToChatMessage({
    id,
    role: 'assistant',
    parts: tools.map(([toolName, output], i) => ({
      type: `tool-${toolName}`,
      toolCallId: `${id}-${i}`,
      state: 'output-available',
      input: {},
      output,
    })),
  });

const chipsOf = (objectName: string) =>
  within(screen.getByTestId(`proposed-plan-object-${objectName}`))
    .getAllByTestId('proposed-plan-field')
    .map((c) => c.textContent);

describe('objectui#12724 phase 2 — the plan card draws planCard', () => {
  const renderPlan = (envelope: unknown, lang: 'zh' | 'en' = 'zh') =>
    render(
      inLocale(
        lang,
        <ChatbotEnhanced messages={[turn('plan', ['propose_blueprint', envelope])]} onSendMessage={vi.fn()} />,
      ),
    );

  it('zh: one chip per field, the format in mono type, the suggested field dashed with 「补充」', () => {
    renderPlan(planEnvelope('zh'));
    expect(chipsOf('book')).toEqual(['书名', '作者', 'ISBN13 位数字', '馆藏数量', '分类· 补充']);
    expect(chipsOf('reader')).toEqual(['姓名', '邮箱邮箱格式', '电话电话格式']);
    const book = screen.getByTestId('proposed-plan-object-book');
    const isbn = within(book).getAllByTestId('proposed-plan-field')[2];
    expect(within(isbn).getByTestId('proposed-plan-field-format')).toHaveTextContent('13 位数字');
    expect(within(isbn).getByTestId('proposed-plan-field-format').className).toContain('font-mono');
    const category = within(book).getAllByTestId('proposed-plan-field')[4];
    expect(category).toHaveAttribute('data-suggested', 'true');
    expect(category.className).toContain('border-dashed');
    // A field with neither key draws a plain chip.
    const author = within(book).getAllByTestId('proposed-plan-field')[1];
    expect(author).not.toHaveAttribute('data-suggested');
    expect(within(author).queryByTestId('proposed-plan-field-format')).not.toBeInTheDocument();
  });

  it('zh: 「名称：FIELD」 under an object that declares its name field, and none under one that does not', () => {
    renderPlan(planEnvelope('zh'));
    const nameOf = (o: string) =>
      within(screen.getByTestId(`proposed-plan-object-${o}`)).queryByTestId('proposed-plan-name-field');
    expect(nameOf('book')).toHaveTextContent(/^名称：书名$/);
    expect(nameOf('reader')).toHaveTextContent(/^名称：姓名$/);
    expect(nameOf('loan')).not.toBeInTheDocument();
  });

  it('zh: each view with its intent line, the assumptions as a list, and the sample-data line', () => {
    renderPlan(planEnvelope('zh'));
    expect(screen.getAllByTestId('proposed-plan-view-line').map((l) => l.textContent)).toEqual([
      '看板 · 按 状态 分组 · 卡片：图书、读者、应还日期',
      '列表 · 筛选 状态 = 逾期 且 归还日期 为空 · 按应还日期升序',
      '列表 · 显示全部记录',
    ]);
    const items = within(screen.getByTestId('proposed-plan-assumptions')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '只建这三部分，不建仪表盘、预约、罚款；补充的字段（分类）可以去掉。',
      '归还后状态置为已还；逾期由应还日期已过且未归还判定。',
    ]);
    expect(screen.getByTestId('proposed-plan-counts')).toHaveTextContent(
      /^3 个对象 · 3 个视图 · 示例数据 12 条\/对象$/,
    );
  });

  it('en: the same rows in English', () => {
    renderPlan(planEnvelope('en'), 'en');
    expect(chipsOf('book')).toEqual(['Title', 'Author', 'ISBN13 digits', 'Copies', 'Category· suggested']);
    expect(within(screen.getByTestId('proposed-plan-object-book')).getByTestId('proposed-plan-name-field')).toHaveTextContent(
      /^Name: Title$/,
    );
    expect(screen.getByTestId('proposed-plan-counts')).toHaveTextContent(
      /^3 objects · 3 views · Sample data: 12 rows per object$/,
    );
  });
});

describe('objectui#12724 phase 2 — each plan row degrades to phase 1 when its key is absent', () => {
  const withoutCard = () => {
    const { planCard: _card, viewIntents: _intents, ...rest } = planEnvelope('zh');
    return rest;
  };

  it('no planCard: field chips from the blueprint with no format or suggested mark, no name line, view names only, the blueprint`s assumptions, no sample-data line', () => {
    render(<ChatbotEnhanced messages={[turn('plan', ['propose_blueprint', withoutCard()])]} onSendMessage={vi.fn()} />);
    expect(chipsOf('book')).toEqual(['书名', '作者', 'ISBN', '馆藏数量', '分类']);
    expect(screen.queryByTestId('proposed-plan-field-format')).not.toBeInTheDocument();
    expect(document.querySelector('[data-suggested]')).toBeNull();
    expect(screen.queryByTestId('proposed-plan-name-field')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('proposed-plan-view').map((v) => v.textContent)).toEqual([
      '·借阅看板',
      '·逾期未还记录',
      '·图书',
    ]);
    expect(screen.queryByTestId('proposed-plan-view-line')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('proposed-plan-assumptions')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'blueprint assumption the plan card does not repeat',
    ]);
    expect(screen.getByTestId('proposed-plan-counts')).toHaveTextContent(/^3 objects · 3 views$/);
  });

  it('no planCard but viewIntents (a producer between the two): the intent lines come from viewIntents', () => {
    const { planCard: _card, ...rest } = planEnvelope('zh');
    render(<ChatbotEnhanced messages={[turn('plan', ['propose_blueprint', rest])]} onSendMessage={vi.fn()} />);
    expect(screen.getAllByTestId('proposed-plan-view-line')).toHaveLength(3);
    expect(screen.getAllByTestId('proposed-plan-view-line')[1]).toHaveTextContent(
      '列表 · 筛选 状态 = 逾期 且 归还日期 为空 · 按应还日期升序',
    );
    expect(screen.queryByTestId('proposed-plan-name-field')).not.toBeInTheDocument();
  });

  it('a planCard without sampleData: the count line keeps the bare sample-data bit', () => {
    const plan = planEnvelope('zh');
    const { sampleData: _sample, ...card } = plan.planCard;
    const envelope = { ...plan, counts: { ...plan.counts, seedData: 3 }, planCard: card };
    render(
      inLocale('zh', <ChatbotEnhanced messages={[turn('plan', ['propose_blueprint', envelope])]} onSendMessage={vi.fn()} />),
    );
    expect(screen.getByTestId('proposed-plan-counts')).toHaveTextContent(/^3 个对象 · 3 个视图 · 示例数据$/);
    // The rest of the card still reads planCard.
    expect(screen.getAllByTestId('proposed-plan-view-line')).toHaveLength(3);
  });
});

describe('objectui#12724 phase 2 — the result card draws the checklist', () => {
  it('zh: 核对通过 7/7, the verified lines in two columns, in place of the artifact list', () => {
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[turn('built', ['apply_blueprint', applyEnvelope('zh')])]}
          onOpenBuiltApp={vi.fn()}
          onDesignBuiltApp={vi.fn()}
        />,
      ),
    );
    const chip = screen.getByTestId('build-checklist-chip');
    expect(chip).toHaveTextContent(/^核对通过 7\/7$/);
    expect(chip).toHaveAttribute('data-status', 'passed');
    const col = (id: string) =>
      within(screen.getByTestId(id)).getAllByTestId('build-checklist-line').map((l) => l.textContent);
    expect(col('build-checklist-objects')).toEqual([
      '图书 · 5 个字段 · 12 条示例',
      '读者 · 3 个字段 · 12 条示例',
      '借阅记录 · 6 个字段 · 12 条示例',
    ]);
    expect(col('build-checklist-checks')).toEqual([
      '借阅看板 · 按状态分组 · 5 / 4 / 3',
      '逾期未还记录 · 筛选生效 · 命中 3 条',
      '图书 · 显示全部记录 · 12 条',
      '示例数据 · 无重复 · ISBN / 邮箱格式通过',
    ]);
    expect(screen.getByTestId('build-checklist').firstElementChild?.className).toContain('@md:grid-cols-2');
    // The checklist's app label names the card.
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent('图书借阅管理');
    // No staged-artifact list beside what was verified.
    expect(screen.queryByText('library_app')).not.toBeInTheDocument();
  });

  it('打开应用 and 在 Studio 中查看 open what checklist.app and checklist.packageId name', () => {
    const onOpenBuiltApp = vi.fn();
    const onDesignBuiltApp = vi.fn();
    // An extend build: the checklist names the app the build LANDED in, which
    // is not the app artifact the envelope staged.
    const envelope = {
      ...applyEnvelope('zh'),
      checklist: { ...checklistOf('zh'), app: { name: 'campus_app', label: '校园' }, packageId: 'app.campus' },
    };
    render(
      <ChatbotEnhanced
        messages={[turn('built', ['apply_blueprint', envelope])]}
        onOpenBuiltApp={onOpenBuiltApp}
        onDesignBuiltApp={onDesignBuiltApp}
      />,
    );
    fireEvent.click(screen.getByTestId('build-progress-open-app'));
    expect(onOpenBuiltApp).toHaveBeenCalledWith('campus_app');
    fireEvent.click(screen.getByTestId('build-progress-design-app'));
    expect(onDesignBuiltApp).toHaveBeenCalledWith('campus_app', 'app.campus');
  });

  it('a verify_build later in the turn supersedes apply_blueprint`s checklist', () => {
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[
            turn(
              'built',
              ['apply_blueprint', applyEnvelope('zh')],
              ['verify_build', verifyEnvelope('zh', { failedView: true })],
            ),
          ]}
          onOpenBuiltApp={vi.fn()}
        />,
      ),
    );
    const chip = screen.getByTestId('build-checklist-chip');
    expect(chip).toHaveTextContent(/^核对通过 6\/7$/);
    expect(chip).toHaveAttribute('data-status', 'failed');
    const failed = screen
      .getAllByTestId('build-checklist-line')
      .filter((l) => l.getAttribute('data-status') === 'failed');
    expect(failed.map((l) => l.textContent)).toEqual(['逾期未还记录 · 筛选生效 · 命中 3 条']);
  });

  it('en: Checks passed 7/7', () => {
    render(
      inLocale(
        'en',
        <ChatbotEnhanced messages={[turn('built', ['apply_blueprint', applyEnvelope('en')])]} onOpenBuiltApp={vi.fn()} />,
      ),
    );
    expect(screen.getByTestId('build-checklist-chip')).toHaveTextContent(/^Checks passed 7\/7$/);
    expect(screen.getAllByTestId('build-checklist-line')[0]).toHaveTextContent('Book · 5 fields · 12 sample rows');
  });

  it('no checklist (an older producer): no chip, the artifact list, and the doors read the staged app and the envelope`s package', () => {
    const onOpenBuiltApp = vi.fn();
    const onDesignBuiltApp = vi.fn();
    const { checklist: _c, ...envelope } = applyEnvelope('zh');
    render(
      <ChatbotEnhanced
        messages={[turn('built', ['apply_blueprint', envelope])]}
        onOpenBuiltApp={onOpenBuiltApp}
        onDesignBuiltApp={onDesignBuiltApp}
      />,
    );
    expect(screen.queryByTestId('build-checklist-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('build-checklist')).not.toBeInTheDocument();
    expect(screen.getByTestId('build-progress')).toHaveTextContent('library_app');
    fireEvent.click(screen.getByTestId('build-progress-open-app'));
    expect(onOpenBuiltApp).toHaveBeenCalledWith('library_app');
    fireEvent.click(screen.getByTestId('build-progress-design-app'));
    expect(onDesignBuiltApp).toHaveBeenCalledWith('library_app', 'app.hcpl');
  });
});

describe('objectui#12724 phase 2 — 「接下来可以说」 on both envelopes a build sends', () => {
  const NEXT = '接下来可以说：「给借阅记录加续借次数」 「做一个本月借出统计的仪表盘」 「只允许管理员删除图书」';

  it.each([
    ['drafted', applyEnvelope('zh')],
    ['drafted and materialized (published in the turn)', applyEnvelope('zh', { materialized: true })],
  ])('%s: the line quotes the envelope`s nextSteps', (_name, envelope) => {
    render(
      inLocale('zh', <ChatbotEnhanced messages={[turn('built', ['apply_blueprint', envelope])]} onOpenBuiltApp={vi.fn()} />),
    );
    expect(screen.getByTestId('build-result-next-steps')).toHaveTextContent(NEXT);
  });

  it('no nextSteps: no line, the posture sentence stays', () => {
    const { nextSteps: _n, ...envelope } = applyEnvelope('zh');
    render(
      inLocale('zh', <ChatbotEnhanced messages={[turn('built', ['apply_blueprint', envelope])]} onOpenBuiltApp={vi.fn()} />),
    );
    expect(screen.queryByTestId('build-result-next-steps')).not.toBeInTheDocument();
    expect(screen.getByTestId('build-result-posture')).toBeInTheDocument();
  });
});
