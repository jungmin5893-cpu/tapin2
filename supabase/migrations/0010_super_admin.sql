-- ============================================================
-- 슈퍼 어드민 지원
-- ============================================================

-- 1. profiles 테이블에 is_super_admin 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 2. JWT에서 super admin 여부 확인하는 헬퍼 함수
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
  SELECT COALESCE(
    ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
    false
  )
$$ LANGUAGE sql STABLE;

-- 3. RLS: 슈퍼어드민은 모든 테넌트 조회 가능
CREATE POLICY "tenants_super_admin_select" ON tenants
  FOR SELECT USING (is_super_admin());

-- 4. RLS: 슈퍼어드민은 모든 테넌트 수정 가능 (트라이얼 연장 등)
CREATE POLICY "tenants_super_admin_update" ON tenants
  FOR UPDATE USING (is_super_admin());

-- 5. RLS: 슈퍼어드민은 모든 프로필 조회 가능 (가입자 이메일 확인용)
CREATE POLICY "profiles_super_admin_select" ON profiles
  FOR SELECT USING (is_super_admin());

-- 6. JWT claims 함수 업데이트 — is_super_admin 포함
CREATE OR REPLACE FUNCTION set_jwt_claims(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_uid        uuid    := (event ->> 'user_id')::uuid;
  v_tenant     uuid;
  v_role       text;
  v_is_super   boolean;
  v_claims     jsonb   := COALESCE(event -> 'claims', '{}'::jsonb);
BEGIN
  SELECT tenant_id, role, is_super_admin
    INTO v_tenant, v_role, v_is_super
    FROM profiles WHERE id = v_uid;

  IF v_tenant IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant::text));
    v_claims := jsonb_set(v_claims, '{role}',      to_jsonb(v_role));
  END IF;

  IF v_is_super THEN
    v_claims := jsonb_set(v_claims, '{is_super_admin}', 'true'::jsonb);
  END IF;

  RETURN jsonb_build_object('claims', v_claims);
END $$;
GRANT EXECUTE ON FUNCTION set_jwt_claims(jsonb) TO supabase_auth_admin;

-- ── 적용 후 할 일 ─────────────────────────────────────────────
-- Supabase Dashboard > Table Editor > profiles 에서
-- 본인(대표 계정) 행의 is_super_admin 을 true 로 변경 후
-- 재로그인하면 슈퍼어드민 패널 탭이 나타납니다.
