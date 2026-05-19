-- ============================================================
-- SCAN&GO — 공지 메시지 (이전 버전 정리 + 날짜 예약으로 재생성)
-- 이전에 0005를 실행했든 안 했든 이것만 실행하면 됩니다
-- ============================================================

-- 기존 정리
DROP FUNCTION IF EXISTS get_unread_messages(UUID);
DROP FUNCTION IF EXISTS mark_message_read(UUID);
DROP TABLE IF EXISTS message_reads CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

-- 메시지 테이블
CREATE TABLE messages (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title               TEXT        NOT NULL,
  body                TEXT        NOT NULL,
  target_type         TEXT        NOT NULL CHECK (target_type IN ('all','store','employee')),
  target_store_id     UUID        REFERENCES stores(id) ON DELETE CASCADE,
  target_employee_id  UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  scheduled_date      DATE        DEFAULT NULL,  -- null=즉시, 날짜 지정 시 해당 날짜부터 활성
  active              BOOLEAN     DEFAULT TRUE,
  created_by          UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 메시지 확인 기록 테이블
CREATE TABLE message_reads (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id  UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, employee_id)
);

-- RLS
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads  ENABLE ROW LEVEL SECURITY;

-- 사장/매니저: 자기 테넌트 메시지 전체 관리
CREATE POLICY "msg_owner_all" ON messages
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','manager')
  ));
CREATE POLICY "msg_owner_insert" ON messages FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','manager')
  ));
CREATE POLICY "msg_owner_update" ON messages FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','manager')
  ));
CREATE POLICY "msg_owner_delete" ON messages FOR DELETE
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','manager')
  ));

-- 직원: 자기 테넌트 메시지 조회
CREATE POLICY "msg_employee_select" ON messages FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

-- 직원: 자신의 확인 기록만 관리
CREATE POLICY "msg_reads_self" ON message_reads
  USING (employee_id = auth.uid());
CREATE POLICY "msg_reads_insert" ON message_reads FOR INSERT
  WITH CHECK (employee_id = auth.uid());

-- 사장/매니저: 확인 현황 조회
CREATE POLICY "msg_reads_owner_select" ON message_reads FOR SELECT
  USING (message_id IN (
    SELECT id FROM messages WHERE tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','manager')
    )
  ));

-- ── 직원 미확인 메시지 조회 RPC ─────────────────────────────
CREATE OR REPLACE FUNCTION get_unread_messages(p_store_id UUID)
RETURNS TABLE(id UUID, title TEXT, body TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_today     DATE;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_uid;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  v_today := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;

  RETURN QUERY
  SELECT m.id, m.title, m.body
  FROM messages m
  WHERE m.tenant_id = v_tenant_id
    AND m.active = TRUE
    AND (m.scheduled_date IS NULL OR m.scheduled_date <= v_today)
    AND (
      m.target_type = 'all'
      OR (m.target_type = 'store'    AND m.target_store_id    = p_store_id)
      OR (m.target_type = 'employee' AND m.target_employee_id = v_uid)
    )
    AND NOT EXISTS (
      SELECT 1 FROM message_reads mr
      WHERE mr.message_id = m.id AND mr.employee_id = v_uid
    )
  ORDER BY m.created_at ASC;
END;
$$;

-- ── 메시지 확인 처리 RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_message_read(p_message_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO message_reads (message_id, employee_id)
  VALUES (p_message_id, auth.uid())
  ON CONFLICT (message_id, employee_id) DO NOTHING;
END;
$$;

SELECT 'SCAN&GO 메시지 기능 설치 완료 ✓' AS result;
