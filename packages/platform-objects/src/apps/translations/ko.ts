// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { koObjects } from './ko.objects.generated.js';

/**
 * 한국어 (ko) — Setup App Translations
 */
export const ko: TranslationData = {
  objects: koObjects,
  apps: {
    account: {
      label: '계정',
      description: '개인 보안 및 ID 설정',
      navigation: {
        grp_account_inbox: { label: '받은편지함' },
        grp_account_security: { label: '보안' },
        grp_account_developer: { label: '개발자' },
        grp_account_ai_assistant: { label: 'AI 어시스턴트' },
        nav_account_profile: { label: '프로필' },
        nav_account_notifications: { label: '알림' },
        nav_account_approvals: { label: '내 승인 대기' },
        nav_account_memberships: { label: '내 조직' },
        nav_account_linked: { label: '연결된 계정' },
        nav_account_sessions: { label: '활성 세션' },
        nav_account_api_keys: { label: 'API 키' },
        nav_account_oauth_apps: { label: 'OAuth 애플리케이션' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: 'AI 어시스턴트 연결' },
      },
    },
    setup: {
      label: '설정',
      description: '플랫폼 설정 및 관리',
      navigation: {
        group_overview: { label: '개요' },
        group_apps: { label: '앱' },
        nav_packaged_actions: { label: '패키지 액션' },
        nav_marketplace_browse: { label: '마켓플레이스 둘러보기' },
        nav_marketplace_installed: { label: '설치된 앱' },
        nav_cloud_connection: { label: '클라우드 연결' },
        group_people_org: { label: '사용자 및 조직' },
        group_access_control: { label: '액세스 제어' },
        group_approvals: { label: '승인' },
        group_configuration: { label: '구성' },
        group_integrations: { label: '통합' },
        group_diagnostics: { label: '진단' },
        group_advanced: { label: '고급' },

        nav_system_overview: { label: '시스템 개요' },
        nav_connect_agent: { label: 'AI 어시스턴트 연결' },

        nav_users: { label: '사용자' },
        nav_organization: { label: '현재 조직' },
        nav_business_units: { label: '사업부' },
        nav_teams: { label: '팀' },
        nav_organizations: { label: '전체 조직' },
        nav_invitations: { label: '초대' },
        nav_position_holders: { label: '직위 보유자' },
        nav_permission_set_assignment: { label: '권한 세트 할당' },

        nav_sharing_rules: { label: '공유 규칙' },
        nav_record_shares: { label: '레코드 공유' },
        nav_queues: { label: '대기열' },
        nav_queue_members: { label: '대기열 구성원' },
        nav_assignment_rules: { label: '배정 규칙' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'SSO 공급자' },
        // Conditionally contributed by plugin-auth (only while SCIM is wired),
        // the same case as the entry above; see `en.ts` (#31123). The short form
        // of `sys_scim_connection_credential.pluralLabel`.
        nav_scim_credentials: { label: 'SCIM 자격 증명' },
        nav_api_keys: { label: 'API 키' },

        // 승인 받은편지함 = the Approvals Inbox component (#7234) — the surface
        // with decision actions. The three below are the engine's raw tables;
        // the first and last read as plugin-approvals' ko object plural labels.
        nav_approvals_inbox: { label: '승인 받은편지함' },
        nav_approval_requests: { label: '승인 요청' },
        nav_approval_actions: { label: '작업 기록' },
        // `승인 위임` matches sys_approval_delegation's object plural label;
        // `(부재)` renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: '승인 위임(부재)' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' ko bundle (`setup-nav-hub-parity.test.ts`), so the
        // two delivery pages say 전송 here, as does the HTTP log below, which
        // reads as sys_http_delivery's ko object label.
        nav_settings_hub: { label: '전체 설정' },
        nav_settings_localization: { label: '현지화' },
        nav_exchange_rates: { label: '환율' },
        nav_settings_company: { label: '회사' },
        nav_settings_mail: { label: '메일 전송' },
        nav_settings_sms: { label: 'SMS 전송' },
        nav_settings_branding: { label: '브랜딩' },
        nav_settings_auth: { label: '인증' },
        nav_settings_access_policy: { label: '액세스 정책' },
        nav_settings_storage: { label: '파일 저장소' },
        nav_settings_ai: { label: 'AI 및 Embedder' },
        nav_settings_knowledge: { label: '지식' },
        nav_settings_lifecycle: { label: '데이터 수명 주기' },
        nav_recycle_bin: { label: '휴지통' },
        nav_notification_preferences: { label: '알림 기본 설정' },
        nav_notification_templates: { label: '알림 템플릿' },

        nav_sessions: { label: '세션' },
        nav_audit_logs: { label: '감사 로그' },
        nav_notifications: { label: '알림' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `웹훅` is sys_webhook's own ko object plural label, and this bundle is
        // where that choice is RECORDED rather than reached by falling back
        // (#5750).
        nav_webhooks: { label: '웹훅' },
        nav_http_deliveries: { label: 'HTTP 전송' },
        nav_datasources: { label: '데이터 소스' },
        nav_connector_credentials: { label: '커넥터 자격 증명' },
        nav_connector_connections: { label: '커넥터 연결' },

        nav_oauth_apps: { label: 'OAuth 애플리케이션' },
      },
    },
    studio: {
      label: 'Studio',
      description: '개발자, 분석가, 구현 담당자를 위한 메타데이터 작업대',
      navigation: {
        group_overview: { label: '개요' },
        nav_app_builder: { label: '앱 빌더' },
        nav_metadata_directory: { label: '모든 메타데이터 유형' },
        nav_packages: { label: '패키지' },
        group_data_model: { label: '데이터 모델' },
        nav_objects: { label: '객체' },
        group_ux: { label: '사용자 경험' },
        nav_apps: { label: '앱' },
        nav_views: { label: '뷰' },
        nav_pages: { label: '페이지' },
        nav_dashboards: { label: '대시보드' },
        nav_reports: { label: '보고서' },
        nav_datasets: { label: '데이터 세트' },
        group_logic: { label: '로직' },
        nav_actions: { label: '작업' },
        nav_hooks: { label: '훅' },
        group_automation: { label: '자동화' },
        nav_flows: { label: '플로우' },
        group_ai: { label: 'AI' },
        nav_agents: { label: '에이전트' },
        nav_tools: { label: '도구' },
        nav_skills: { label: '스킬' },
        group_developer: { label: '개발자' },
        nav_api_console: { label: 'API 콘솔' },
        nav_flow_runs: { label: '플로우 실행' },
        nav_public_forms: { label: '공개 양식' },
        nav_integrations: { label: '통합 및 API' },
        group_integration: { label: '통합' },
        nav_email_templates: { label: '이메일 템플릿' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: '시스템 개요',
      description: '플랫폼 상태, 보안 활동, 최근 감사 이벤트',
      widgets: {
        widget_total_users: { title: '전체 사용자', description: '시스템에 등록된 전체 사용자 수' },
        widget_organizations: { title: '조직', description: '플랫폼의 전체 조직 수' },
        widget_active_sessions: { title: '활성 세션', description: '현재 활성 상태인 사용자 세션 수' },
        widget_packages_installed: { title: '설치된 패키지', description: '모든 프로젝트의 활성 패키지 설치' },
        widget_login_events: { title: '로그인 이벤트', description: '감사 로그가 기록한 인증 이벤트' },
        widget_config_changes: { title: '구성 변경', description: '시스템 구성 변경 사항' },
        widget_events_by_type: { title: '작업별 감사 이벤트', description: '작업 유형별 감사 이벤트 분포' },
        widget_events_by_user: { title: '사용자별 이벤트', description: '사용자별 활동 분포' },
        widget_recent_events: { title: '작업별 이벤트 양', description: '작업별로 묶은 이벤트 양(로그인, 로그아웃, 구성, …)' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: '기간' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: '사용자' } } },
    sys_organization_metrics: { measures: { org_count: { label: '조직' } } },
    sys_session_metrics: { measures: { session_count: { label: '세션' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: '설치' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: '작업' }, user_id: { label: '사용자' } },
      measures: { event_count: { label: '이벤트' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: '클라우드 연결',
      subtitle: '이 런타임을 ObjectStack 컨트롤 플레인에 연결하면 조직의 비공개 패키지를 둘러보고 여기에 설치할 수 있습니다.',
    },
    connect_agent: {
      label: 'AI 어시스턴트 연결',
      subtitle:
        'Claude, Doubao 및 기타 AI 어시스턴트에서 이 시스템으로 작업하세요. '
        + '각 어시스턴트는 사용자를 대신해 동작하며, 사용자 본인의 권한이 허용하는 것만 보고 변경합니다.',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: '사용자' },
    sys_organization_detail: { label: '조직' },
  },
};
