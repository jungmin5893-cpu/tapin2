-- 푸시 알림 구독 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text,
  auth        text,
  user_agent  text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 본인 구독만 접근 가능
CREATE POLICY "push_subscriptions_self" ON push_subscriptions
  FOR ALL USING (user_id = auth.uid());

-- 사장님 조회 정책 (같은 테넌트 사장이 직원 구독 조회 가능)
-- Edge Function은 service_role로 접근하므로 RLS 우회
