/**
 * 업종별 UI 레이블 유틸리티
 * industry_type 값에 따라 "매장" → "현장"/"파견처" 등 동적으로 변환
 */

const LABEL_MAP = {
  '청소·시설관리': {
    site: '현장',       // 매장 → 현장
    sites: '현장 목록',
    siteAdd: '현장 추가',
    worker: '직원',
    workers: '직원 관리',
    assign: '현장 배정',
    biz: '업체',
  },
  '경비·보안': {
    site: '현장',
    sites: '현장 목록',
    siteAdd: '현장 추가',
    worker: '직원',
    workers: '직원 관리',
    assign: '현장 배정',
    biz: '업체',
  },
  '인력사무소': {
    site: '파견처',
    sites: '파견처 목록',
    siteAdd: '파견처 추가',
    worker: '인력',
    workers: '인력 관리',
    assign: '파견 배정',
    biz: '사무소',
  },
  '건설도급사': {
    site: '현장',
    sites: '현장 목록',
    siteAdd: '현장 추가',
    worker: '근로자',
    workers: '근로자 관리',
    assign: '현장 배정',
    biz: '도급사',
  },
  '기타': {
    site: '현장',
    sites: '현장 목록',
    siteAdd: '현장 추가',
    worker: '직원',
    workers: '직원 관리',
    assign: '현장 배정',
    biz: '사업장',
  },
};

const DEFAULTS = LABEL_MAP['청소·시설관리'];

export function getLabels(industryType) {
  return LABEL_MAP[industryType] || DEFAULTS;
}

export function siteLabel(industryType) {
  return (LABEL_MAP[industryType] || DEFAULTS).site;
}

export function workerLabel(industryType) {
  return (LABEL_MAP[industryType] || DEFAULTS).worker;
}

/**
 * 가격 계산: 직원 1인당 5,000원, 해당 월 최대 등록 직원 수 기준
 */
export function calcMonthlyFee(employeeCount) {
  return employeeCount * 5000;
}

/**
 * 기능 접근 권한 체크
 * - active: 모든 기능 오픈
 * - trialing (유효): 모든 기능 오픈
 * - 5인 이하: 무료 플랜 — 모든 기능 오픈
 * - 만료/초과: 출퇴근 관리만
 */
export function canAccess(tenant, feature) {
  if (!tenant) return feature === 'attendance';
  // 5인 이하: 무료 플랜 전 기능 제공
  if ((tenant.peak_employee_count || 0) <= 5) return true;
  const { subscription_status, trial_ends_at } = tenant;
  if (subscription_status === 'active') return true;
  if (subscription_status === 'trialing') {
    if (!trial_ends_at) return true;
    return new Date(trial_ends_at) > new Date();
  }
  return feature === 'attendance';
}

export function isFreePlan(tenant) {
  if (!tenant) return false;
  if (tenant.subscription_status === 'active') return false;
  return (tenant.peak_employee_count || 0) <= 5;
}

// 유료 전용 기능 목록
export const PAID_FEATURES = {
  employees: '직원 관리',
  stores: '현장 / QR',
  shifts: '시프트 관리',
  payroll: '급여 정산',
  settings: '설정',
};

export const FREE_FEATURES = ['attendance', 'overview'];
