// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PlatformTranslationData } from '@objectstack/spec/system';
import { countryOptionLabels } from '../manifests/company.manifest.js';

/**
 * 한국어 (ko) — built-in settings manifest translations.
 */
export const ko: PlatformTranslationData = {
  settingsCommon: {
    sourceLabels: { env: '환경 변수', global: '전역', tenant: '조직', user: '사용자', default: '기본값' },
  },
  settings: {
    mail: {
      title: '메일 전송',
      description: 'SMTP 및 트랜잭션 이메일 공급자 설정입니다.',
      groups: {
        provider: { title: '공급자', description: '이 시스템이 발신 이메일을 보내는 방식을 선택합니다.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'API 키' },
        from_address: { title: '보내는 주소' },
        delivery: { title: '전송 방식', description: '발신 메일을 공급자에게 넘기는 방식입니다.' },
      },
      keys: {
        provider: {
          label: '공급자',
          help: '이 서버가 실제로 전송할 수 있는 공급자만 표시됩니다. SendGrid와 Amazon SES는 SMTP로 설정합니다.',
          options: { smtp: 'SMTP', resend: 'Resend', postmark: 'Postmark', log: '없음(로그만 기록 — 실제 전송 안 함)' },
        },
        smtp_host: { label: '호스트', help: '예: smtp.example.com' },
        smtp_port: { label: '포트' },
        smtp_secure: { label: 'TLS 사용' },
        smtp_user: { label: '사용자 이름' },
        smtp_password: { label: '비밀번호' },
        api_key: { label: 'API 키' },
        from_email: { label: '보내는 이메일', help: '예: no-reply@example.com' },
        from_name: { label: '보내는 사람 이름', help: '비워 두면 제품 이름(브랜딩) 또는 이 배포를 설정할 때 지정한 이름을 사용합니다.' },
        queue_delivery: {
          label: '영구 대기열 전송',
          help: '각 메일을 바로 보내지 않고 작업 대기열에 넘깁니다. 전송에 실패하면 worker가 백오프로 재시도하며, 재시작 후에도 유지됩니다. 영구 어댑터를 갖춘 대기열 기능이 필요합니다. "테스트 이메일 보내기"는 항상 바로 보냅니다.',
        },
      },
      actions: {
        test: { label: '테스트 이메일 보내기' },
      },
    },
    sms: {
      title: 'SMS 전송',
      description: 'OTP 로그인, 초대, 알림에 쓰는 SMS 공급자 설정입니다.',
      groups: {
        provider: { title: '공급자', description: '이 시스템이 발신 SMS를 보내는 방식을 선택합니다.' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: { title: '지출 한도', description: '배포의 발신 SMS 양을 제한합니다. SMS는 유료 채널이며 발송할 때마다 실제 비용이 듭니다.' },
      },
      keys: {
        provider: {
          label: '공급자',
          options: { log: '없음(로그만 기록 — 실제 전송 안 함)', aliyun: 'Aliyun SMS (阿里云短信)', twilio: 'Twilio' },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: '서명 이름(短信签名)' },
        aliyun_template_code: {
          label: '기본 템플릿 코드(短信模板)',
          help: '발송에 템플릿이 지정되지 않았을 때 사용합니다. ${content} 변수 하나만 있는 범용 템플릿을 쓰면 일반 알림 SMS를 보낼 수 있습니다.',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: '인증 토큰' },
        twilio_from_number: {
          label: '발신 번호',
          help: 'E.164 형식의 발신자(예: +15005550006). 이 항목과 Messaging Service SID 중 하나를 사용합니다.',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: '일일 발송 한도',
          help: '이 배포가 UTC 기준 하루에 보낼 수 있는 최대 SMS 수로, OTP 로그인·초대·알림을 모두 포함합니다. 0은 제한 없음입니다. 한도를 넘는 발송은 00:00 UTC까지 거부됩니다.',
        },
      },
      actions: {
        test: { label: '테스트 SMS 보내기' },
      },
    },
    branding: {
      title: '브랜딩',
      description: '콘솔과 로그인 페이지에 표시되는 이름, 로고, 색상입니다. 설정하지 않은 값은 배포 자체의 브랜딩을 따릅니다.',
      groups: {
        identity: { title: 'ID 정보' },
        appearance: { title: '모양' },
      },
      keys: {
        workspace_name: {
          label: '제품 이름',
          help: '콘솔, 로그인 페이지, 브라우저 제목에 표시되는 제품 이름이며 로그인 이메일, 인증 앱, MCP 로그인에도 쓰입니다. 비워 두면 이 배포를 설정할 때 지정한 이름을 사용합니다. 조직 자체의 이름이 아니며, 그 이름은 조직 레코드의 "이름"입니다.',
        },
        accent_color: { label: '강조 색상', help: '브라우저와 설치된 앱의 테마 색상입니다. 각 앱은 자체 색상을 유지합니다.' },
        logo_url: { label: '로고 URL', help: '로그인 페이지, 로딩 화면, 홈 헤더에 표시됩니다. 예: https://…/logo.svg' },
      },
    },
    company: {
      title: '회사',
      description: '법인 정보 — 등록 상호, 주소, 세금 ID, 주요 연락처입니다.',
      groups: {
        identity: { title: '법인 정보' },
        address: { title: '등록 주소' },
        contact: { title: '연락처' },
      },
      keys: {
        legal_name: { label: '법적 상호', help: '계약서와 청구서에 기재되는 조직의 등록 법적 상호입니다.' },
        registration_number: { label: '등록 번호', help: '회사 등록/설립 번호(예: EIN)입니다.' },
        tax_id: { label: '세금 ID / VAT', help: '청구서에 표시됩니다(예: VAT, GST, ABN).' },
        address_line1: { label: '주소 1' },
        address_line2: { label: '주소 2' },
        city: { label: '도시' },
        state: { label: '주/도' },
        postal_code: { label: '우편번호' },
        country: {
          label: '국가',
          help: '등록 주소의 국가입니다. 국가 이름을 입력한 뒤 목록에서 선택하세요.',
          options: countryOptionLabels('ko'),
        },
        phone: { label: '전화', help: 'E.164 형식을 권장합니다(예: +82 2 5555 0100).' },
        website: { label: '웹사이트', help: '예: https://example.com' },
        primary_contact_name: { label: '주요 연락처 이름' },
        primary_contact_email: { label: '주요 연락처 이메일', help: '예: ops@example.com' },
      },
    },
    localization: {
      title: '현지화',
      description: '기본 시간대, 언어, 국가, 통화, 회계연도입니다.',
      groups: {
        region: { title: '지역' },
        finance: { title: '재무' },
      },
      keys: {
        timezone: {
          label: '기본 시간대',
          help: '수식에서 "오늘"이 언제인지, 보고서가 날짜를 어떻게 묶는지, 날짜와 시간을 어떻게 표시하는지를 정합니다. 모든 IANA 시간대 이름(예: Asia/Seoul)을 사용할 수 있습니다. 조직에 실제로 적용되는 시간대이며, 조직 레코드의 "시간대" 필드는 이를 바꾸지 않습니다.',
          options: {
            UTC: 'UTC',
            'America/Los_Angeles': '(UTC−08/−07) 로스앤젤레스',
            'America/Denver': '(UTC−07/−06) 덴버',
            'America/Chicago': '(UTC−06/−05) 시카고',
            'America/New_York': '(UTC−05/−04) 뉴욕',
            'America/Sao_Paulo': '(UTC−03) 상파울루',
            'Europe/London': '(UTC±00/+01) 런던',
            'Europe/Paris': '(UTC+01/+02) 파리',
            'Europe/Berlin': '(UTC+01/+02) 베를린',
            'Europe/Moscow': '(UTC+03) 모스크바',
            'Asia/Dubai': '(UTC+04) 두바이',
            'Asia/Kolkata': '(UTC+05:30) 콜카타',
            'Asia/Singapore': '(UTC+08) 싱가포르',
            'Asia/Shanghai': '(UTC+08) 상하이',
            'Asia/Tokyo': '(UTC+09) 도쿄',
            'Australia/Sydney': '(UTC+10/+11) 시드니',
            'Pacific/Auckland': '(UTC+12/+13) 오클랜드',
          },
        },
        locale: { label: '기본 언어', help: '메시지 카탈로그와 숫자/날짜 형식에 쓰는 BCP-47 언어입니다.' },
        default_country: {
          label: '기본 국가',
          help: '주소와 전화번호의 기본값으로 쓰입니다. 국가 이름을 입력한 뒤 목록에서 선택하세요.',
          options: countryOptionLabels('ko'),
        },
        currency: {
          label: '기본 통화',
          help: '통화 필드에 자체 코드가 없을 때 적용되는 ISO 4217 코드입니다. 비워 두면 코드 없는 금액을 일반 숫자로 표시합니다.',
          options: {
            USD: 'USD — 미국 달러',
            EUR: 'EUR — 유로',
            GBP: 'GBP — 영국 파운드',
            JPY: 'JPY — 일본 엔',
            CNY: 'CNY — 중국 위안',
            INR: 'INR — 인도 루피',
            AUD: 'AUD — 호주 달러',
            CAD: 'CAD — 캐나다 달러',
            BRL: 'BRL — 브라질 헤알',
          },
        },
        fiscal_year_start: {
          label: '회계연도 시작',
          help: '회계연도의 첫 달입니다. 보고서의 "이번 분기 / 회계연도"를 결정합니다.',
          options: {
            january: '1월',
            february: '2월',
            march: '3월',
            april: '4월',
            may: '5월',
            june: '6월',
            july: '7월',
            august: '8월',
            september: '9월',
            october: '10월',
            november: '11월',
            december: '12월',
          },
        },
      },
    },
    auth: {
      title: '인증',
      description: '로그인, 가입, 기본 제공 인증 기능을 제어합니다.',
      groups: {
        email_password: { title: '이메일 및 비밀번호', description: '로컬 이메일/비밀번호 로그인과 셀프 가입을 제어합니다.' },
        membership: { title: '멤버십', description: '새로 만든 사용자가 무엇에 가입되는지 정합니다. 위의 셀프 가입과 함께 설정합니다.' },
        audience: {
          title: '가입 대상',
          description: '이 시스템의 앱 사용자가 될 수 있는 사람을 정합니다. 허용 목록 이메일 도메인은 항상 이메일 인증을 강제합니다. "개방"도 배포에서 끄지 않는 한 이를 강제하며, 이 콘솔에 저장한 값으로는 끌 수 없습니다. 초대, 관리자가 만든 사용자, SCIM 프로비저닝, 엔터프라이즈 SSO는 모든 모드에서 허용됩니다.',
        },
        password_policy: { title: '비밀번호 정책', description: '가입 및 비밀번호 재설정 시 인증 공급자가 적용하는 길이 제한입니다.' },
        anti_abuse: { title: '악용 방지', description: '무차별 대입 방지: ID별 계정 잠금과 인증 엔드포인트에 대한 IP별 속도 제한입니다.' },
        multi_factor: { title: '다단계', description: '구성원이 인증 앱(TOTP)으로 계정을 보호하도록 요구합니다.' },
        sessions: { title: '세션', description: '로그인 세션이 유효한 기간입니다.' },
        network: { title: '네트워크', description: '사용자가 인증할 수 있는 위치를 제한합니다.' },
        api_keys: {
          title: 'API 키',
          description: '개인 API 키의 유효 기간입니다. 만료되었거나, 비활성 기간을 넘겨 사용되지 않았거나, 취소된 키는 각각의 오류 코드로 거부되며, 해결 방법은 항상 새 키를 만드는 것입니다.',
        },
        social: { title: '소셜 로그인', description: '기본 제공 Google 로그인 공급자를 설정합니다. 서버 설정에 지정된 자격 증명이 여전히 우선합니다.' },
      },
      keys: {
        email_password_enabled: { label: '이메일/비밀번호 로그인 사용', confirmOffText: '비밀번호로 로그인하는 사람은 다른 로그인 방법이 필요합니다.' },
        signup_enabled: {
          label: '이메일 가입 허용',
          help: '이메일·비밀번호 가입 양식을 엽니다. 누구를 받아들일지는 아래의 "셀프 가입 대상"이 정합니다. "초대 전용"에서는 대기 중인 초대가 있는 주소만, "허용 목록 이메일 도메인"에서는 허용된 도메인과 초대된 주소를, "개방"에서는 누구나 받아들입니다. 끄면 대상과 관계없이 양식이 닫히며 초대받은 사람도 예외가 아닙니다.',
        },
        require_email_verification: { label: '이메일 인증 요구' },
        membership_policy: {
          label: '새 사용자 멤버십',
          help: '"자동"은 모든 새 사용자를 기본 조직에 연결합니다. "초대 전용"은 명시적인 행동이 있을 때만 멤버십을 부여합니다. 조직 생성, 초대 수락, 관리자의 추가, SSO 적시 프로비저닝이 그런 행동입니다.',
          options: { auto: '기본 조직에 자동 가입', 'invite-only': '초대 전용 — 자동 가입 안 함' },
        },
        audience_posture: {
          label: '셀프 가입 대상',
          help: '"초대 전용"은 셀프 가입을 닫습니다. 관리자가 초대·생성·가져오기를 하거나 디렉터리 프로비저닝(SCIM) 또는 엔터프라이즈 SSO를 통해서만 사용자가 됩니다. "허용 목록 이메일 도메인"은 아래에 나열한 도메인에 가입을 엽니다. "개방"은 누구나 받아들입니다. "허용 목록 이메일 도메인"과 "개방" 모두 아래의 셀프 가입 권한 세트가 필요합니다. "허용 목록 이메일 도메인"은 항상 이메일 인증을 요구합니다. "개방"도 서버 설정에서 끄지 않는 한 요구하며, "개방"에서 이 콘솔로 끄려고 하면 거부됩니다.',
          options: { invite_only: '초대 전용 — 셀프 가입 없음(기본값)', email_domain: '허용 목록 이메일 도메인만', open: '개방 — 누구나 셀프 가입 가능' },
        },
        audience_allowed_email_domains: {
          label: '허용된 이메일 도메인',
          help: '도메인만 한 줄에 하나씩 또는 쉼표로 구분해 입력합니다(예: acme.com). 대소문자를 구분하지 않고 정확히 일치해야 하며, 하위 도메인은 따로 입력해야 하고, 와일드카드는 지원하지 않습니다.',
        },
        audience_self_registration_permission_set: {
          label: '셀프 가입 권한 세트',
          help: '셀프 가입한 각 사용자가 받는 권한 세트의 이름입니다. 표준 구성원 세트면 충분하며, 전체 관리자 세트는 거부됩니다. 가입 대상이 셀프 가입을 허용하면 필수입니다.',
        },
        password_min_length: { label: '최소 비밀번호 길이' },
        password_max_length: { label: '최대 비밀번호 길이', help: '매우 긴 비밀번호 해싱으로 인한 서비스 거부를 막습니다.' },
        password_reject_breached: {
          label: '유출된 비밀번호 거부',
          help: 'Have I Been Pwned를 통해 공개 유출 자료에 있는 비밀번호를 차단합니다(k-익명성 범위 검사, 비밀번호 전체는 절대 전송하지 않음).',
        },
        password_require_complexity: {
          label: '복잡한 비밀번호 요구',
          help: '가입 및 비밀번호 변경/재설정 시 비밀번호에 여러 문자 종류(대문자, 소문자, 숫자, 기호)를 섞도록 요구합니다.',
        },
        password_min_classes: { label: '최소 문자 종류 수', help: '비밀번호에 포함해야 하는 네 가지 종류(대문자/소문자/숫자/기호)의 개수입니다.' },
        password_history_count: {
          label: '비밀번호 기록(재사용 금지)',
          help: '변경/재설정 시 이 개수만큼의 이전 비밀번호를 재사용하지 못하게 합니다. 0이면 검사를 끕니다.',
        },
        password_expiry_days: {
          label: '비밀번호 만료(일)',
          help: '이 일수가 지나면 비밀번호 변경을 강제합니다. 0이면 만료되지 않습니다. 만료된 동안 사용자는 비밀번호를 바꿀 때까지 데이터에 접근할 수 없습니다.',
        },
        lockout_threshold: {
          label: '계정 잠금 임계값',
          help: '연속 로그인 실패가 이 횟수에 이르면 계정을 잠급니다. 잘못된 비밀번호와 잘못된 2단계 인증 코드가 모두 포함됩니다. 잠긴 동안에는 올바른 자격 증명으로도 로그인이 거부됩니다. 0이면 비밀번호 단계의 잠금을 끕니다. 이때 2단계 인증은 세션 발급 전 마지막 검사이므로 15분당 10회라는 기본 제한을 유지합니다.',
        },
        lockout_duration_minutes: { label: '잠금 시간(분)', help: '임계값을 넘은 뒤 계정이 잠긴 상태로 유지되는 시간이며, 두 로그인 단계 모두에 적용됩니다.' },
        rate_limit_max: { label: '인증 속도 제한: 최대 요청 수', help: '창당 IP별로 로그인/가입/비밀번호 재설정 엔드포인트에 보낼 수 있는 최대 요청 수입니다.' },
        rate_limit_window_seconds: { label: '인증 속도 제한: 창(초)', help: '위의 요청 상한을 세는 슬라이딩 창입니다.' },
        mfa_required: {
          label: '다단계 인증 요구',
          help: '인증 앱을 등록하지 않은 사용자는 유예 기간이 끝나면 데이터에 접근할 수 없습니다. 이 항목을 켜면 사용자가 등록할 수 있도록 2단계 인증 기능도 켜집니다.',
        },
        mfa_grace_period_days: { label: 'MFA 유예 기간(일)', help: '강제 차단 전까지 사용자가 등록을 미룰 수 있는 기간입니다. 0이면 즉시 차단합니다.' },
        session_expiry_days: { label: '세션 유효 기간(일)', help: '세션은 로그인 후 이 일수가 지나면 만료됩니다.' },
        session_refresh_days: { label: '갱신 임계값(일)', help: '활성 세션이 이 기간보다 오래되면 연장됩니다.' },
        session_idle_timeout_minutes: { label: '유휴 시간 제한(분)', help: '이 시간(분) 동안 활동이 없으면 사용자를 로그아웃합니다. 0이면 끕니다.' },
        session_absolute_max_hours: {
          label: '세션 절대 유효 기간(시간)',
          help: '활동 여부와 관계없이 로그인 후 이 시간이 지나면 다시 인증하도록 합니다. 0이면 끕니다.',
        },
        max_concurrent_sessions_per_user: {
          label: '사용자당 최대 동시 세션 수',
          help: '사용자당 동시에 로그인한 세션 수를 제한하며, 상한을 넘으면 가장 오래된 세션부터 로그아웃됩니다. 0 = 무제한.',
        },
        allowed_ip_ranges: {
          label: '허용된 IP 범위',
          help: 'CIDR 범위 또는 정확한 IP(한 줄에 하나 또는 쉼표로 구분)입니다(예: 203.0.113.0/24). 설정하면 이 범위 밖에서의 로그인이 거부되며, 서버가 클라이언트 주소를 확인할 수 없는 요청도 거부됩니다. 비워 두면 제한이 없습니다. 판단 대상은 연결이 들어온 주소이며, 리버스 프록시 뒤에 있다면 서버가 해당 프록시를 신뢰하도록 설정해야 원래 클라이언트 주소로 판단합니다.',
        },
        api_key_default_expiry_days: {
          label: '기본 키 유효 기간(일)',
          help: '만료일 없이 만든 키는 생성 후 이 일수가 지나면 만료됩니다. 아래의 최대 유효 기간을 넘지 않습니다.',
        },
        api_key_max_expiry_days: {
          label: '최대 키 유효 기간(일)',
          help: '새 키가 요청할 수 있는 가장 먼 만료일로, 생성 시점부터 계산합니다. 더 길면 거부되고, 정확히 이 일수는 허용됩니다.',
        },
        api_key_inactivity_days: {
          label: '비활성 만료(일)',
          help: '이 일수 동안 사용 기록이 없는 키는 거부됩니다. 키가 취소되지는 않으니 새 키를 만드세요. 한 번도 쓰지 않은 키는 생성 시점부터, 그보다 오래된 키는 아래의 정책 시작 시점부터 계산합니다. 0이면 비활성 만료를 끕니다.',
        },
        api_key_policy_started_at: {
          label: '키 정책 시작 시각',
          help: '서버가 이 정책으로 처음 실행될 때 자동으로 기록됩니다(UTC, ISO 8601). 그 전에 만료일 없이 만든 키는 이 시점으로부터 1년 뒤에 만료되고, 사용 기록이 없는 키는 이 시점부터 비활성 기간을 셉니다. 이 값을 바꾸면 아직 날짜가 정해지지 않은 키의 두 날짜가 함께 바뀝니다.',
        },
        google_enabled: {
          label: 'Google 로그인 사용',
          help: '클라이언트 ID와 클라이언트 보안 비밀이 모두 있을 때 Google 로그인을 제공합니다. 아래에 저장한 값이나 서버 설정(저장한 값보다 우선)에서 가져옵니다. 둘 다 있기 전까지는 이 항목이 켜져 있어도 로그인 페이지에 Google 버튼이 나타나지 않습니다. 끄면 서버가 둘 다 설정했더라도 Google 로그인을 철회합니다. OAuth 클라이언트는 Google Cloud Console에서 만드세요.',
        },
        google_client_id: {
          label: 'Google 클라이언트 ID',
          help: 'Google Cloud Console에서 발급한 OAuth 클라이언트 ID입니다. 서버 설정에서도 지정할 수 있습니다.',
        },
        google_client_secret: { label: 'Google 클라이언트 보안 비밀', help: '암호화해 저장합니다. 서버 설정에서도 지정할 수 있습니다.' },
      },
    },
    storage: {
      title: '파일 저장소',
      description: '첨부 파일, 내보내기, 사용자 업로드에 쓰는 백엔드입니다.',
      groups: {
        adapter: { title: '백엔드', description: '업로드한 파일을 저장할 위치를 선택합니다.' },
        local: { title: '로컬' },
        s3: { title: 'S3' },
        limits: { title: '제한' },
      },
      keys: {
        adapter: {
          label: '어댑터',
          options: { local: '로컬 파일 시스템', s3: 'S3 / S3 호환' },
        },
        local_root: { label: '루트 디렉터리', help: '파일을 저장할 파일 시스템 경로입니다. 상대 경로는 서버의 CWD를 기준으로 해석됩니다.' },
        s3_bucket: { label: '버킷', help: '공유 호스트 버킷입니다. 환경별 파일은 projects/<environmentId>/ 접두사로 구분됩니다.' },
        s3_region: { label: '리전', help: '예: us-east-1' },
        s3_endpoint: { label: '엔드포인트', help: 'S3 호환 공급자(R2, MinIO, Wasabi)용 사용자 지정 엔드포인트입니다. AWS S3는 비워 두세요.' },
        s3_access_key_id: { label: '액세스 키 ID' },
        s3_secret_access_key: { label: '보안 액세스 키' },
        s3_force_path_style: { label: '경로 스타일 URL 강제', help: 'MinIO와 대부분의 S3 호환 공급자는 켜고, AWS S3는 끄세요.' },
        presigned_ttl: { label: '미리 서명된 URL 유효 시간(초)' },
        session_ttl: { label: '업로드 세션 유효 시간(초)', help: '분할 업로드 세션을 이어서 진행할 수 있는 시간입니다.' },
        max_upload_mb: { label: '최대 업로드 크기(MB)' },
      },
      actions: {
        test: { label: '연결 테스트' },
      },
      banners: {
        adapter_switch_warning: {
          title: '기존 파일은 이전되지 않습니다',
          text: '어댑터를 바꿔도 기존 파일은 이전되지 않습니다. 이전 어댑터로 업로드한 파일은 새 어댑터로 접근할 수 없게 됩니다.',
        },
      },
    },
    ai: {
      title: 'AI 및 Embedder',
      description: '플랫폼 AI 및 지식 서비스가 쓰는 LLM 공급자, 모델, 자격 증명, Embedder 설정입니다.',
      groups: {
        provider: {
          title: '공급자',
          description: 'LLM 백엔드를 선택합니다. Memory 모드는 입력을 그대로 돌려주므로 테스트에는 유용하지만 운영 환경에는 절대 쓰지 마세요.',
        },
        gateway: {
          title: 'Vercel AI Gateway',
          description: '여러 공급자를 잇는 라우터입니다. 모델은 provider/model 형식으로 씁니다(예: openai/gpt-4o).',
        },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: {
          title: 'DeepSeek',
          description: 'https://api.deepseek.com의 OpenAI 호환 API입니다. Base URL은 자동으로 채워집니다.',
        },
        dashscope: {
          title: '阿里通义 DashScope',
          description: 'dashscope.aliyuncs.com/compatible-mode/v1의 OpenAI 호환 엔드포인트입니다. Base URL은 자동으로 채워집니다.',
        },
        cloudflare: {
          title: 'Cloudflare AI Gateway',
          description: '/compat 엔드포인트를 사용하므로 모델은 provider/model 형식으로 씁니다(예: openai/gpt-4o-mini, anthropic/claude-3-5-sonnet, deepseek/deepseek-chat). 참고: Cloudflare /compat는 alibaba/qwen*을 지원하지 않으니 Qwen에는 DashScope 공급자를 쓰세요.',
        },
        siliconflow: {
          title: '硅基流动 SiliconFlow',
          description: 'api.siliconflow.cn/v1의 OpenAI 호환 엔드포인트입니다. Base URL은 자동으로 채워집니다.',
        },
        openrouter: { title: 'OpenRouter', description: 'openrouter.ai/api/v1의 다중 공급자 라우터입니다. Base URL은 자동으로 채워집니다.' },
        titles: { title: '대화 제목', description: '새 대화에 짧은 요약 제목을 자동으로 만듭니다.' },
        defaults: { title: '생성 기본값', description: '에이전트나 채팅 요청이 자체 값을 지정하지 않을 때 적용됩니다.' },
        observability: { title: '관측성' },
        embedder: { title: 'Embedder', description: '지식 소스와 RAG에 쓰는 텍스트→벡터 공급자입니다. 위의 채팅 공급자와는 별개입니다.' },
      },
      keys: {
        provider: {
          label: '공급자',
          options: {
            memory: 'Memory(에코 — 테스트 전용)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek(OpenAI 호환)',
            dashscope: '阿里通义 DashScope(OpenAI 호환)',
            cloudflare: 'Cloudflare AI Gateway(OpenAI 호환)',
            siliconflow: '硅基流动 SiliconFlow(OpenAI 호환)',
            openrouter: 'OpenRouter(OpenAI 호환)',
          },
        },
        gateway_model: { label: 'Gateway 모델', help: '서버 설정의 모델 대신 사용합니다. 예: openai/gpt-4o' },
        gateway_api_key: { label: 'Gateway API 키', help: '선택 사항 — 게이트웨이가 인증을 요구할 때만 필요합니다.' },
        openai_api_key: { label: 'OpenAI API 키', help: '서버 설정의 키 대신 사용합니다. 암호화해 저장합니다.' },
        openai_model: { label: '모델', help: '기본 모델 ID입니다. 에이전트별 재정의가 우선합니다.' },
        openai_base_url: {
          label: 'Base URL',
          help: 'Azure OpenAI나 자체 호스팅 게이트웨이용 재정의 값입니다. api.openai.com을 쓰려면 비워 두세요.',
        },
        anthropic_api_key: { label: 'Anthropic API 키', help: '서버 설정의 키 대신 사용합니다. 암호화해 저장합니다.' },
        anthropic_model: { label: '모델' },
        google_api_key: { label: 'Google API 키', help: '서버 설정의 키 대신 사용합니다. 암호화해 저장합니다.' },
        google_model: { label: '모델' },
        deepseek_api_key: { label: 'DeepSeek API 키', help: 'sk-... — platform.deepseek.com에서 발급합니다.' },
        deepseek_model: { label: '모델', help: '예: deepseek-chat(V3), deepseek-reasoner(R1 추론).' },
        dashscope_api_key: { label: 'DashScope API 키', help: 'sk-... — dashscope.console.aliyun.com에서 발급합니다.' },
        dashscope_model: { label: '모델' },
        cloudflare_account_id: { label: 'Cloudflare 계정 ID', help: 'Cloudflare 대시보드 URL에 있는 32자 16진수 ID입니다.' },
        cloudflare_gateway_id: {
          label: 'Gateway ID',
          help: 'Cloudflare → AI Gateway에서 설정한 게이트웨이 이름입니다. 기본값은 "default"입니다.',
        },
        cloudflare_api_key: {
          label: 'Cloudflare AI Gateway 토큰',
          help: 'AI Gateway → "API tokens" 탭에서 발급합니다(cfut_… 또는 sk_…).',
        },
        cloudflare_model: { label: '모델' },
        siliconflow_api_key: { label: 'SiliconFlow API 키' },
        siliconflow_model: {
          label: '모델',
          help: '예: Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3, meta-llama/Meta-Llama-3.1-8B-Instruct.',
        },
        openrouter_api_key: { label: 'OpenRouter API 키', help: 'sk-or-...' },
        openrouter_model: {
          label: '모델',
          help: '형식: provider/model(예: anthropic/claude-3.5-sonnet, deepseek/deepseek-chat).',
        },
        title_generation_enabled: { label: '대화 제목 자동 요약' },
        title_max_length: { label: '제목 최대 길이(자)', help: '생성된 제목의 하드 상한입니다. 더 긴 부분은 서버에서 잘립니다.' },
        temperature: { label: '온도', help: '0 = 결정적, 2 = 매우 창의적.' },
        max_tokens: { label: '최대 출력 토큰', help: '응답 하나당 생성되는 토큰의 하드 상한입니다.' },
        request_timeout_ms: { label: '요청 시간 제한(ms)' },
        trace_enabled: { label: '추적 기록', help: '각 AI 요청과 응답을 기록해 두어, 문제가 생기면 대화를 살펴보고 다시 재생할 수 있게 합니다.' },
        log_prompts: { label: '전체 프롬프트 기록', help: '추적 행에 메타데이터뿐 아니라 렌더링된 프롬프트도 포함합니다.' },
        embedder_provider: {
          label: '공급자',
          options: {
            none: '사용 안 함(임베딩 없음)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama(로컬)',
            custom: '사용자 지정(OpenAI 호환)',
          },
        },
        embedder_api_key: {
          label: 'Embedder API 키',
          help: 'Authorization 헤더로 보내는 Bearer 토큰입니다. Ollama는 비어 있지 않은 아무 값이나 됩니다.',
        },
        embedder_model: {
          label: '모델',
          help: '예 — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3',
        },
        embedder_base_url: {
          label: 'Base URL',
          help: '엔드포인트 루트(/embeddings 제외)입니다. 프리셋에서 자동으로 채워지며, 프록시나 자체 호스팅 게이트웨이를 쓰면 재정의하세요.',
        },
        embedder_dimensions: { label: '차원', help: '출력 차원을 재정의합니다(Matryoshka 모델만). 비워 두면 모델 기본값을 씁니다.' },
        embedder_batch_size: { label: '배치 크기', help: '한 번의 요청으로 임베딩 공급자에게 보내는 청크 수입니다. 공급자의 속도/크기 제한에 걸리면 줄이세요.' },
      },
      actions: {
        test: { label: '연결 테스트' },
        test_embedder: { label: 'Embedder 테스트' },
        reset: { label: '환경 기본값으로 재설정' },
      },
      banners: {
        log_prompts_warning: { title: '프롬프트에 개인 정보가 포함될 수 있습니다', text: '개인 정보가 유출될 수 있으니 규제 환경에서는 끄세요.' },
      },
    },
    knowledge: {
      title: '지식',
      description: 'RAG / 지식 소스용 벡터 저장소 백엔드입니다.',
      groups: {
        adapter: { title: '백엔드', description: '문서 청크와 그 벡터를 저장할 위치를 선택합니다.' },
        turso: { title: 'Turso / libSQL', description: '관리형 Turso, 로컬 파일, 인메모리 모두에서 동작합니다.' },
        ragflow: { title: 'RAGFlow', description: '외부 RAGFlow 배포입니다. 자체 호스팅 방법은 https://ragflow.io를 참고하세요.' },
        indexing: { title: '인덱싱 기본값', description: '지식 소스 자체에 설정한 값이 이 기본값보다 우선합니다.' },
        permissions: { title: '권한' },
      },
      keys: {
        adapter: {
          label: '어댑터',
          options: { memory: '인메모리(개발/테스트 전용)', turso: 'Turso / libSQL(클라우드 또는 로컬)', ragflow: 'RAGFlow(외부)' },
        },
        turso_url: {
          label: '연결 URL',
          help: '예: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:',
        },
        turso_auth_token: { label: '인증 토큰', help: '관리형 Turso URL에만 필요합니다.' },
        ragflow_base_url: { label: 'Base URL', help: '예: http://localhost:9380' },
        ragflow_api_key: { label: 'API 키' },
        ragflow_default_dataset: { label: '기본 데이터 세트 ID', help: '지식 소스가 자체 RAGFlow 데이터 세트를 지정하지 않을 때 사용합니다.' },
        chunk_target: { label: '목표 청크 크기(자)', help: '토큰 기준 분할이 시작되기 전의 청크 크기 소프트 상한입니다.' },
        chunk_overlap: { label: '청크 겹침(자)', help: '경계를 넘어 문맥이 이어지도록 이전 청크에서 유지하는 문자 수입니다.' },
        over_fetch: { label: '초과 조회 배수', help: '요청한 결과 수의 이 배수만큼 검색해, 문서 정보로 필터링한 뒤에도 돌려줄 결과가 충분히 남게 합니다.' },
        enforce_rls: { label: '검색 시 RLS 적용', help: '호출자의 레코드 수준 권한으로 모든 결과를 다시 확인합니다.' },
      },
      actions: {
        test: { label: '연결 테스트' },
      },
      banners: {
        adapter_switch_warning: {
          title: '기존 인덱스는 이전되지 않습니다',
          text: '어댑터를 바꿔도 기존 인덱스는 이전되지 않습니다. 이전 어댑터로 인덱싱한 문서는 다시 인덱싱할 때까지 접근할 수 없습니다.',
        },
        enforce_rls_warning: {
          title: '운영 환경에서는 RLS를 켜 두세요',
          text: '끄면 벡터 저장소 데이터 유출을 막는 플랫폼 고유의 보호 장치를 건너뜁니다. 운영 환경에서는 켜 두세요.',
        },
      },
    },
    lifecycle: {
      title: '데이터 수명 주기',
      description: '시스템 데이터를 얼마나 보관할지 정합니다. 보존 기간을 재정의하고, 테이블별 행 수를 제한하며, 테이블이 예상 밖으로 커지면 알림을 받습니다. 플랫폼은 주기적인 정리 작업 때 이를 적용합니다.',
      keys: {
        enabled: {
          label: '수명 주기 정책 적용',
          help: '주기적 정리 작업의 마스터 스위치입니다. 끄면 선언된 보존/TTL/교체 정책이 더 이상 적용되지 않습니다(데이터가 다시 무제한으로 늘어남).',
        },
        retention_overrides: {
          label: '보존 기간 재정의',
          help: '객체별 보존 기간 재정의입니다: { "<object>": { "maxAge": "1y", "expireAfter": "30d" } }. 기간 단위는 h/d/w/y입니다. 조직별로 설정하므로 규제 대상 조직은 수년, 개발용 조직은 며칠만 보관할 수 있습니다. 플랫폼 기능에 필요한 최소 기간(예: 작업 대기열의 중복 감지 기간)보다 짧은 재정의는 무시되고 오류로 기록되며, 기본 기간이 계속 적용됩니다.',
        },
        quotas: {
          label: '행 할당량',
          help: '객체별 최대 행 수입니다: { "<object>": 1000000 }. 초과하면 거버넌스 알림이 발생하며, 할당량은 선언된 정책을 넘어 데이터를 삭제하지 않습니다.',
        },
        quota_defaults: {
          label: '클래스별 기본 할당량',
          help: '수명 주기 클래스별 대체 할당량입니다: { "telemetry": 1000000, "transient": 500000, "event": 100000, "audit": 5000000 }.',
        },
        growth_alert_rows: {
          label: '증가 알림 임계값(정리당 행 수)',
          help: '수명 주기가 선언된 테이블이 두 번의 정리 사이에 이 행 수보다 많이 늘어나면 알립니다. 0이면 증가 알림을 끕니다.',
        },
      },
    },
  },
};
