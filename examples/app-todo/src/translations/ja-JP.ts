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
  messages: {
    'common.save': '保存',
    'common.cancel': 'キャンセル',
    'common.delete': '削除',
    'common.edit': '編集',
    'common.create': '新規作成',
    'common.search': '検索',
    'common.filter': 'フィルター',
    'common.sort': '並べ替え',
    'common.refresh': '更新',
    'common.export': 'エクスポート',
    'common.back': '戻る',
    'common.confirm': '確認',
    'success.saved': '保存しました',
    'success.deleted': '削除しました',
    'success.completed': 'タスクを完了にしました',
    'confirm.delete': 'このタスクを削除してもよろしいですか？',
    'confirm.complete': 'このタスクを完了にしますか？',
    'error.required': 'この項目は必須です',
    'error.load_failed': 'データの読み込みに失敗しました',
  },
};
