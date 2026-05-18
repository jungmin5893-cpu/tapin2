-- 업종 구분 컬럼 추가
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS industry_type text NOT NULL DEFAULT '청소·시설관리'
  CHECK (industry_type IN (
    '청소·시설관리',
    '경비·보안',
    '인력사무소',
    '건설도급사',
    '기타'
  ));

-- 기존 business_type → industry_type 매핑 (기존 row 처리)
UPDATE tenants SET industry_type = CASE
  WHEN business_type = 'field' THEN '경비·보안'
  WHEN business_type = 'office' THEN '기타'
  ELSE '청소·시설관리'
END WHERE industry_type = '청소·시설관리';

-- 최고 등록 직원 수 기록 (월 최대 기준 결제용)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS peak_employee_count int NOT NULL DEFAULT 0;
