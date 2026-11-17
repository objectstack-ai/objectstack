// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * 日本語 (ja-JP) — Todo App Translations
 *
 * Per-locale file: one file per language, following the `per_locale` convention.
 */
export const jaJP: TranslationData = {
  objects: {
    todo_task: {
      label: 'タスク',
      pluralLabel: 'タスク',
      fields: {
        subject: { label: '件名', help: 'タスクの簡単なタイトル' },
        description: { label: '説明' },
        status: {
          label: 'ステータス',
          options: {
            not_started: '未着手',
            in_progress: '進行中',
            waiting: '待機中',
            completed: '完了',
            deferred: '延期',
          },
        },
        priority: {
          label: '優先度',
          options: {
            low: '低',
            normal: '通常',
            high: '高',
            urgent: '緊急',
          },
        },
        category: {
          label: 'カテゴリ',
          options: {
            personal: '個人',
            work: '仕事',
            shopping: '買い物',
            health: '健康',
            finance: '財務',
            other: 'その他',
          },
        },
        due_date: { label: '期日' },
        days_overdue: { label: '超過日数', help: '期日を過ぎた整日数。期日前または期日未設定の場合は 0' },
        reminder_date: { label: 'リマインダー日時' },
        completed_date: { label: '完了日' },
        owner: { label: '担当者' },
        tags: {
          label: 'タグ',
          options: {
            important: '重要',
            quick_win: 'クイックウィン',
            blocked: 'ブロック中',
            follow_up: 'フォローアップ',
            review: 'レビュー',
          },
        },
        is_recurring: { label: '繰り返しタスク' },
        recurrence_type: {
          label: '繰り返しタイプ',
          options: {
            daily: '毎日',
            weekly: '毎週',
            monthly: '毎月',
            yearly: '毎年',
          },
        },
        recurrence_interval: { label: '繰り返し間隔' },
        progress_percent: { label: '進捗率 (%)' },
        estimated_hours: { label: '見積時間' },
        actual_hours: { label: '実績時間' },
        notes: { label: 'メモ' },
        category_color: { label: 'カテゴリ色' },
      },
      // `default` — the container's DEFAULT list; see the zh-CN bundle (#5164).
      _views: {
        default: { label: 'すべてのタスク' },
        overdue: { label: '期限切れのタスク' },
        due_today: { label: '本日期限' },
      },
    },
  },
  apps: {
    todo_app: {
      label: 'ToDo マネージャー',
      description: '個人タスク管理アプリケーション',
    },
  },
  // The app's reports, as its report index lists them and each report page is
  // headed (`reports.<name>.label` / `.description`).
  reports: {
    todo_tasks_by_status: { label: 'ステータス別タスク', description: 'ステータス別に集計したタスク' },
    todo_tasks_by_priority: { label: '優先度別タスク', description: '優先度レベル別に集計したタスク' },
    todo_tasks_by_owner: { label: '担当者別タスク', description: '担当者別のタスク集計' },
    todo_completed_tasks: { label: '完了済みタスク', description: '作業時間の記録付きの完了済みタスク' },
    todo_time_tracking: { label: '作業時間レポート', description: '見積時間と実績時間の分析' },
  },
  // The task dataset's business definitions (ADR-0149 D1), shown to whoever
  // asks a question of it and handed to the assistant to choose a member by.
  // `synonyms` are not here: they are matched in every language at once from
  // the dataset's one authored list.
  datasets: {
    todo_task_metrics: {
      dimensions: {
        status: { description: 'タスクのライフサイクル上の状態：未着手、進行中、待機中、完了、延期のいずれか。' },
        priority: { description: 'タスクの緊急度：低、通常、高、緊急のいずれか。' },
        category: { description: 'タスクが属する生活の領域：個人、仕事、買い物、健康、財務、その他のいずれか。' },
        owner: { description: 'タスクが割り当てられている人。結果には名前で表示されます。' },
        due_date: { description: 'タスクの期日。この日を過ぎても完了していないタスクは期限超過になります。' },
        completed_date: {
          description: 'タスクが完了にされた日時で、自動的に記録されます。未完了のタスクでは空で、完了したタスクを再開すると消去されます。',
        },
      },
      measures: {
        task_count: { description: 'タスクの件数。ステータスを問わず、完了済みや延期のタスクも数えます。' },
        est_hours: { description: '各タスクの「見積時間」に入力された予定時間の合計。見積のないタスクは加算されません。' },
        actual_hours: { description: '各タスクに実際にかかった時間の合計で、「実績時間」の入力値によります。時間が未入力のタスクは加算されません。' },
      },
    },
  },
  // The quick-add wizard: the flow's name in the runner header and completion
  // toast, each screen's heading and each field label.
  flows: {
    todo_quick_add_task: {
      label: 'タスクをすばやく追加',
      screens: {
        screen_1: {
          title: 'タスクの詳細',
          fields: {
            subject: { label: 'タスクの件名' },
            priority: {
              label: '優先度',
              options: { low: '低', normal: '通常', high: '高', urgent: '緊急' },
            },
            dueDate: { label: '期日' },
            category: {
              label: 'カテゴリ',
              options: { personal: '個人', work: '仕事', shopping: '買い物', health: '健康', finance: '財務', other: 'その他' },
            },
          },
        },
        success_screen: { title: 'タスクを作成しました', description: 'タスク「{{ subject }}」を作成しました！' },
      },
    },
  },
  // Single-segment `messages` ids — `t()` walks the dot path, so an id
  // containing a dot resolves to nothing; see the `en` bundle (#18566).
  messages: {
    commonSave: '保存',
    commonCancel: 'キャンセル',
    commonDelete: '削除',
    commonEdit: '編集',
    commonCreate: '新規作成',
    commonSearch: '検索',
    commonFilter: 'フィルター',
    commonSort: '並べ替え',
    commonRefresh: '更新',
    commonExport: 'エクスポート',
    commonBack: '戻る',
    commonConfirm: '確認',
    successSaved: '保存しました',
    successDeleted: '削除しました',
    successCompleted: 'タスクを完了にしました',
    confirmDelete: 'このタスクを削除してもよろしいですか？',
    confirmComplete: 'このタスクを完了にしますか？',
    errorRequired: 'この項目は必須です',
    errorLoadFailed: 'データの読み込みに失敗しました',
  },
};
