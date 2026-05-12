-- 급여 방식(시급/일급/월급) + 공제 유형 컬럼 추가
-- Supabase SQL Editor에서 실행하세요

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wage_type text NOT NULL DEFAULT 'hourly'
    CHECK (wage_type IN ('hourly','daily','monthly'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deduction_type text NOT NULL DEFAULT 'insurance'
    CHECK (deduction_type IN ('insurance','freelancer','none'));
