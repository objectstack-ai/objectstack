// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import type { StrictObjectTranslation } from '@objectstack/spec/system';
import { Task } from '../objects/task.object';

type TaskTranslation = StrictObjectTranslation<typeof Task>;

/**
 * 简体中文 (zh-CN) — Todo App Translations
 *
 * Per-locale file: one file per language, following the `per_locale` convention.
 */
export const zhCN: TranslationData = {
  objects: {
    todo_task: {
      label: '任务',
      pluralLabel: '任务',
      fields: {
        subject: { label: '主题', help: '任务的简要标题' },
        description: { label: '描述' },
        status: {
          label: '状态',
          options: {
            not_started: '未开始',
            in_progress: '进行中',
            waiting: '等待中',
            completed: '已完成',
            deferred: '已推迟',
          },
        },
        priority: {
          label: '优先级',
          options: {
            low: '低',
            normal: '普通',
            high: '高',
            urgent: '紧急',
          },
        },
        category: {
          label: '分类',
          options: {
            personal: '个人',
            work: '工作',
            shopping: '购物',
            health: '健康',
            finance: '财务',
            other: '其他',
          },
        },
        due_date: { label: '截止日期' },
        reminder_date: { label: '提醒日期/时间' },
        completed_date: { label: '完成日期' },
        owner: { label: '负责人' },
        tags: {
          label: '标签',
          options: {
            important: '重要',
            quick_win: '速胜',
            blocked: '受阻',
            follow_up: '待跟进',
            review: '待审核',
          },
        },
        is_recurring: { label: '周期性任务' },
        recurrence_type: {
          label: '重复类型',
          options: {
            daily: '每天',
            weekly: '每周',
            monthly: '每月',
            yearly: '每年',
          },
        },
        recurrence_interval: { label: '重复间隔' },
        progress_percent: { label: '进度 (%)' },
        estimated_hours: { label: '预估工时' },
        actual_hours: { label: '实际工时' },
        notes: { label: '备注' },
        category_color: { label: '分类颜色' },
      },
      // `default` — the container's DEFAULT list. `defineView({ list })`
      // declares it without a `name`, so the composer registers it as
      // `todo_task.default` and the bundle key is that bare runtime key
      // (#5164, ruled 2026-08-06). It read `list` until then — a spelling
      // no lookup could reach.
      _views: {
        default: { label: '全部任务' },
        overdue: { label: '逾期任务' },
        due_today: { label: '今日到期' },
      },
    } satisfies TaskTranslation,
  },
  apps: {
    todo_app: {
      label: '待办管理',
      description: '个人任务管理应用',
    },
  },
  messages: {
    'common.save': '保存',
    'common.cancel': '取消',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.create': '新建',
    'common.search': '搜索',
    'common.filter': '筛选',
    'common.sort': '排序',
    'common.refresh': '刷新',
    'common.export': '导出',
    'common.back': '返回',
    'common.confirm': '确认',
    'success.saved': '保存成功',
    'success.deleted': '删除成功',
    'success.completed': '任务已标记为完成',
    'confirm.delete': '确定要删除此任务吗？',
    'confirm.complete': '确定将此任务标记为完成？',
    'error.required': '此字段为必填项',
    'error.load_failed': '数据加载失败',
  },
};
