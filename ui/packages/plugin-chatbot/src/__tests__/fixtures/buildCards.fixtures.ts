/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12724 — tool envelopes carrying the two build cards' payloads, in the
 * shape objectstack-ai/cloud's `build-cards.schema.json` declares (vendored
 * beside this file as `build-cards.schema.ts`). The library-lending build the
 * AiBuild artboard draws, once in each language the screenshots use.
 *
 * Every payload exported here is checked against the vendored schema by
 * `buildCards.contract-12724.test.ts`, so a card test cannot pass on a key the
 * producer never declared.
 */

type Lang = 'zh' | 'en';

const W = {
  zh: {
    app: '图书借阅管理',
    book: '图书',
    reader: '读者',
    loan: '借阅记录',
    title: '书名',
    author: '作者',
    copies: '馆藏数量',
    category: '分类',
    fullName: '姓名',
    email: '邮箱',
    phone: '电话',
    loanDate: '借出日期',
    dueDate: '应还日期',
    returnDate: '归还日期',
    status: '状态',
    isbnFormat: '13 位数字',
    emailFormat: '邮箱格式',
    phoneFormat: '电话格式',
    board: '借阅看板',
    overdue: '逾期未还记录',
    boardLine: '看板 · 按 状态 分组 · 卡片：图书、读者、应还日期',
    overdueLine: '列表 · 筛选 状态 = 逾期 且 归还日期 为空 · 按应还日期升序',
    allBooksLine: '列表 · 显示全部记录',
    assumptions: [
      '只建这三部分，不建仪表盘、预约、罚款；补充的字段（分类）可以去掉。',
      '归还后状态置为已还；逾期由应还日期已过且未归还判定。',
    ],
    sampleLine: '示例数据 12 条/对象',
    bookLine: '图书 · 5 个字段 · 12 条示例',
    readerLine: '读者 · 3 个字段 · 12 条示例',
    loanLine: '借阅记录 · 6 个字段 · 12 条示例',
    boardCheck: '借阅看板 · 按状态分组 · 5 / 4 / 3',
    overdueCheck: '逾期未还记录 · 筛选生效 · 命中 3 条',
    allBooksCheck: '图书 · 显示全部记录 · 12 条',
    sampleCheck: '示例数据 · 无重复 · ISBN / 邮箱格式通过',
    borrowed: '借出',
    returned: '已还',
    overdueOption: '逾期',
    statusLifecycle: '借出 · 已还 ✓完成 · 逾期 ⚠',
    loanTitle: '借阅标题',
    loanTitleTemplate: '{图书} · {读者} · {借出日期}',
    loanTitleLine: '名称：自动生成「{图书} · {读者} · {借出日期}」，表单里不出现',
    nextSteps: ['给借阅记录加续借次数', '做一个本月借出统计的仪表盘', '只允许管理员删除图书'],
  },
  en: {
    app: 'Library Lending',
    book: 'Book',
    reader: 'Reader',
    loan: 'Loan',
    title: 'Title',
    author: 'Author',
    copies: 'Copies',
    category: 'Category',
    fullName: 'Full name',
    email: 'Email',
    phone: 'Phone',
    loanDate: 'Loan date',
    dueDate: 'Due date',
    returnDate: 'Return date',
    status: 'Status',
    isbnFormat: '13 digits',
    emailFormat: 'email format',
    phoneFormat: 'phone format',
    board: 'Loan board',
    overdue: 'Overdue loans',
    boardLine: 'Board · grouped by Status · cards: Book, Reader, Due date',
    overdueLine: 'List · filter Status = Overdue and Return date is empty · by Due date ascending',
    allBooksLine: 'List · shows every record',
    assumptions: [
      'Only these three parts: no dashboard, reservations or fines; the suggested field (Category) can go.',
      'Returning a book sets its status to Returned; a loan is overdue once its due date passes unreturned.',
    ],
    sampleLine: 'Sample data: 12 rows per object',
    bookLine: 'Book · 5 fields · 12 sample rows',
    readerLine: 'Reader · 3 fields · 12 sample rows',
    loanLine: 'Loan · 6 fields · 12 sample rows',
    boardCheck: 'Loan board · grouped by Status · 5 / 4 / 3',
    overdueCheck: 'Overdue loans · filter applied · 3 rows match',
    allBooksCheck: 'Book · shows every record · 12 rows',
    sampleCheck: 'Sample data · no duplicates · ISBN and email formats pass',
    borrowed: 'Borrowed',
    returned: 'Returned',
    overdueOption: 'Overdue',
    statusLifecycle: 'Borrowed · Returned ✓done · Overdue ⚠',
    loanTitle: 'Loan title',
    loanTitleTemplate: '{Book} · {Reader} · {Loan date}',
    loanTitleLine: 'Name: generated as “{Book} · {Reader} · {Loan date}”, not on the form',
    nextSteps: ['Add a renewal count to loans', 'Make a dashboard of this month’s loans', 'Only admins may delete books'],
  },
} as const;

/**
 * `propose_blueprint`'s `blueprint_proposed` envelope with `planCard` and `viewIntents`.
 * `generatedTitle: true` (objectui#13004) gives the loan a record title composed
 * from its two lookups and its date, as cloud#2925's builder writes it: a formula
 * `nameField` on the blueprint, and on the plan card `nameField.generated` with
 * the title field left out of the loan's chips (its line stands for it).
 */
export function planEnvelope(lang: Lang, opts: { generatedTitle?: boolean } = {}) {
  const w = W[lang];
  const loanTitleField = {
    name: 'title',
    label: w.loanTitle,
    type: 'formula',
    expression: "joinNonEmpty([record.book.title, record.reader.full_name, record.loan_date], ' · ')",
  };
  const planViews = [
    {
      view: 'loan_board',
      object: 'loan',
      label: w.board,
      layout: 'kanban',
      groupBy: { name: 'status', label: w.status },
      filters: [],
      sort: [],
      fields: [
        { name: 'book', label: w.book },
        { name: 'reader', label: w.reader },
        { name: 'due_date', label: w.dueDate },
      ],
      line: w.boardLine,
    },
    {
      view: 'overdue_loans',
      object: 'loan',
      label: w.overdue,
      layout: 'list',
      filters: [
        { field: 'status', operator: '=', value: 'overdue' },
        { field: 'return_date', operator: 'is_null' },
      ],
      sort: [{ field: 'due_date', order: 'asc' }],
      fields: [],
      line: w.overdueLine,
    },
    { view: 'all_books', object: 'book', label: w.book, layout: 'list', filters: [], sort: [], fields: [], line: w.allBooksLine },
  ];
  return {
    status: 'blueprint_proposed',
    counts: { objects: 3, views: 3, dashboards: 0, seedData: 0 },
    questions: [],
    blueprint: {
      app: { name: 'library_app', label: w.app },
      objects: [
        {
          name: 'book',
          label: w.book,
          nameField: 'title',
          fields: [
            { name: 'title', label: w.title, type: 'text' },
            { name: 'author', label: w.author, type: 'text' },
            { name: 'isbn', label: 'ISBN', type: 'text' },
            { name: 'copies', label: w.copies, type: 'number' },
            { name: 'category', label: w.category, type: 'text' },
          ],
        },
        {
          name: 'reader',
          label: w.reader,
          nameField: 'full_name',
          fields: [
            { name: 'full_name', label: w.fullName, type: 'text' },
            { name: 'email', label: w.email, type: 'email' },
            { name: 'phone', label: w.phone, type: 'phone' },
          ],
        },
        {
          name: 'loan',
          label: w.loan,
          ...(opts.generatedTitle ? { nameField: 'title' } : {}),
          fields: [
            ...(opts.generatedTitle ? [loanTitleField] : []),
            { name: 'book', label: w.book, type: 'lookup', reference: 'book' },
            { name: 'reader', label: w.reader, type: 'lookup', reference: 'reader' },
            { name: 'loan_date', label: w.loanDate, type: 'date' },
            { name: 'due_date', label: w.dueDate, type: 'date' },
            { name: 'return_date', label: w.returnDate, type: 'date' },
            { name: 'status', label: w.status, type: 'select' },
          ],
        },
      ],
      views: [
        { object: 'loan', name: 'loan_board', label: w.board, type: 'kanban', groupBy: 'status' },
        { object: 'loan', name: 'overdue_loans', label: w.overdue, type: 'list' },
        { object: 'book', name: 'all_books', label: w.book, type: 'list' },
      ],
      // Deliberately NOT the plan card's list: the card must read `planCard`.
      assumptions: ['blueprint assumption the plan card does not repeat'],
    },
    viewIntents: planViews.map(({ view, object, label, line }) => ({ view, object, label, line })),
    planCard: {
      objects: [
        {
          name: 'book',
          label: w.book,
          fields: [
            { name: 'title', label: w.title, type: 'text' },
            { name: 'author', label: w.author, type: 'text' },
            { name: 'isbn', label: 'ISBN', type: 'text', format: { kind: 'isbn13', label: w.isbnFormat } },
            { name: 'copies', label: w.copies, type: 'number' },
            { name: 'category', label: w.category, type: 'text', suggested: true },
          ],
          nameField: { name: 'title', label: w.title },
        },
        {
          name: 'reader',
          label: w.reader,
          fields: [
            { name: 'full_name', label: w.fullName, type: 'text' },
            { name: 'email', label: w.email, type: 'email', format: { kind: 'email', label: w.emailFormat } },
            { name: 'phone', label: w.phone, type: 'phone', format: { kind: 'phone', label: w.phoneFormat } },
          ],
          nameField: { name: 'full_name', label: w.fullName },
        },
        {
          name: 'loan',
          label: w.loan,
          fields: [
            { name: 'book', label: w.book, type: 'lookup' },
            { name: 'reader', label: w.reader, type: 'lookup' },
            { name: 'loan_date', label: w.loanDate, type: 'date' },
            { name: 'due_date', label: w.dueDate, type: 'date' },
            { name: 'return_date', label: w.returnDate, type: 'date' },
            {
              name: 'status',
              label: w.status,
              type: 'select',
              // objectui#12994 — the stage field's lifecycle, as cloud's `cardFieldLifecycle` writes it.
              lifecycle: {
                options: [
                  { value: 'borrowed', label: w.borrowed, kind: 'open' },
                  { value: 'returned', label: w.returned, kind: 'won' },
                  { value: 'overdue', label: w.overdueOption, kind: 'lost' },
                ],
                label: w.statusLifecycle,
              },
            },
          ],
          ...(opts.generatedTitle
            ? {
                nameField: {
                  name: 'title',
                  label: w.loanTitle,
                  generated: { template: w.loanTitleTemplate, line: w.loanTitleLine },
                },
              }
            : {}),
        },
      ],
      views: planViews,
      assumptions: [...w.assumptions],
      sampleData: {
        objects: [
          { object: 'book', label: w.book, rows: 12 },
          { object: 'reader', label: w.reader, rows: 12 },
          { object: 'loan', label: w.loan, rows: 12 },
        ],
        unique: [{ object: 'book', fields: [{ name: 'isbn', label: 'ISBN' }] }],
        formats: [
          { object: 'book', field: 'isbn', label: 'ISBN', format: { kind: 'isbn13', label: w.isbnFormat } },
          { object: 'reader', field: 'email', label: w.email, format: { kind: 'email', label: w.emailFormat } },
        ],
        line: w.sampleLine,
      },
    },
  };
}

/** The result card's `checklist`, as `buildResultChecklist` measures it. */
export function checklistOf(lang: Lang, opts: { failedView?: boolean } = {}) {
  const w = W[lang];
  const lines = [
    { kind: 'object', object: 'book', label: w.book, status: 'passed', fields: 5, sampleRows: 12, line: w.bookLine },
    { kind: 'object', object: 'reader', label: w.reader, status: 'passed', fields: 3, sampleRows: 12, line: w.readerLine },
    { kind: 'object', object: 'loan', label: w.loan, status: 'passed', fields: 6, sampleRows: 12, line: w.loanLine },
    {
      kind: 'view',
      view: 'loan.loan_board',
      object: 'loan',
      label: w.board,
      status: 'passed',
      matched: 12,
      total: 12,
      groups: [
        { value: 'borrowed', label: w.borrowed, count: 5 },
        { value: 'returned', label: w.returned, count: 4 },
        { value: 'overdue', label: w.overdueOption, count: 3 },
      ],
      line: w.boardCheck,
    },
    {
      kind: 'view',
      view: 'loan.overdue_loans',
      object: 'loan',
      label: w.overdue,
      status: opts.failedView ? 'failed' : 'passed',
      matched: 3,
      total: 12,
      line: w.overdueCheck,
    },
    { kind: 'view', view: 'book.all_books', object: 'book', label: w.book, status: 'passed', matched: 12, total: 12, line: w.allBooksCheck },
    {
      kind: 'sampleData',
      status: 'passed',
      unique: { book: ['isbn'] },
      formats: [
        { object: 'book', field: 'isbn', format: 'isbn13' },
        { object: 'reader', field: 'email', format: 'email' },
      ],
      line: w.sampleCheck,
    },
  ];
  const passed = lines.filter((l) => l.status === 'passed').length;
  return {
    status: passed === lines.length ? 'passed' : 'failed',
    passed,
    total: lines.length,
    lines,
    app: { name: 'library_app', label: w.app },
    packageId: 'app.hcpl',
  };
}

const DRAFTED = [
  { type: 'object', name: 'book' },
  { type: 'object', name: 'reader' },
  { type: 'object', name: 'loan' },
  { type: 'view', name: 'loan.loan_board' },
  { type: 'view', name: 'loan.overdue_loans' },
  { type: 'view', name: 'book.all_books' },
  { type: 'app', name: 'library_app' },
];

/**
 * `apply_blueprint`'s envelope. `materialized: true` is the published-in-turn
 * build: no cloud producer answers `apply_blueprint` with `status: 'published'`,
 * an in-turn publish stays `drafted` and says it materialized.
 */
export function applyEnvelope(lang: Lang, opts: { materialized?: boolean } = {}) {
  return {
    status: 'drafted',
    packageId: 'app.hcpl',
    drafted: DRAFTED,
    failed: [],
    autoPublishable: true,
    ...(opts.materialized ? { materialized: true } : {}),
    summary: lang === 'zh' ? '已搭建 7 项' : 'Built 7 artifacts',
    checklist: checklistOf(lang),
    nextSteps: [...W[lang].nextSteps],
  };
}

/** `verify_build`'s envelope after a repair: it re-measures the checklist. */
export function verifyEnvelope(lang: Lang, opts: { failedView?: boolean } = {}) {
  return {
    status: opts.failedView ? 'failed' : 'passed',
    checked: 7,
    errors: opts.failedView ? 1 : 0,
    warnings: 0,
    issues: [],
    checklist: checklistOf(lang, opts),
    nextSteps: [...W[lang].nextSteps],
    note: 'verified',
  };
}
