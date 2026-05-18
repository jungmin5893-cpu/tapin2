-- 전자근로계약서 테이블 (근로기준법 제17조 기준)
CREATE TABLE IF NOT EXISTS labor_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- 계약 종류 & 기간
  contract_type    text NOT NULL DEFAULT 'regular', -- regular / fixed / parttime
  start_date       date NOT NULL,
  end_date         date,                            -- NULL = 기간 정함 없음

  -- 취업 장소 & 업무
  work_location    text NOT NULL DEFAULT '',
  job_description  text NOT NULL DEFAULT '',

  -- 소정근로시간 (근로기준법 §17①②)
  work_days        text NOT NULL DEFAULT '월,화,수,목,금',
  daily_start      text NOT NULL DEFAULT '09:00',
  daily_end        text NOT NULL DEFAULT '18:00',
  break_minutes    int  NOT NULL DEFAULT 60,
  weekly_hours     numeric(5,2) NOT NULL DEFAULT 40,

  -- 임금 (구성항목·계산방법·지급방법)
  wage_type        text    NOT NULL DEFAULT 'hourly',   -- hourly / daily / monthly
  wage_amount      numeric NOT NULL DEFAULT 0,
  pay_day          int     NOT NULL DEFAULT 10,          -- 매월 N일
  pay_method       text    NOT NULL DEFAULT '계좌이체',

  -- 공제 유형
  deduction_type   text NOT NULL DEFAULT 'insurance',  -- insurance / freelancer / none

  -- 연차유급휴가 (근로기준법 §60)
  annual_leave_days int NOT NULL DEFAULT 15,

  -- 서명 정보 (전자서명 = 이름 + 타임스탬프)
  owner_name         text,
  owner_signed_at    timestamptz,
  employee_name      text,
  employee_signed_at timestamptz,

  -- 상태: draft → sent → completed
  status           text NOT NULL DEFAULT 'draft',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lc_tenant_idx   ON labor_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS lc_employee_idx ON labor_contracts(employee_id);
CREATE INDEX IF NOT EXISTS lc_status_idx   ON labor_contracts(status);

ALTER TABLE labor_contracts ENABLE ROW LEVEL SECURITY;

-- 오너/매니저: 자기 테넌트 계약서 전체 관리
CREATE POLICY "lc_owner_all" ON labor_contracts
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','manager')
  );

-- 직원: 자기 계약서 조회 + sent/completed 상태에서 서명(UPDATE)
CREATE POLICY "lc_employee_select" ON labor_contracts
  FOR SELECT USING (employee_id = auth.uid());

CREATE POLICY "lc_employee_sign" ON labor_contracts
  FOR UPDATE USING (
    employee_id = auth.uid()
    AND status = 'sent'
  )
  WITH CHECK (employee_id = auth.uid());

-- 슈퍼어드민
CREATE POLICY "lc_super_admin" ON labor_contracts
  FOR ALL USING (is_super_admin());
