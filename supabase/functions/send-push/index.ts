import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Web Push 전송 (Deno Web Push)
// deno-lint-ignore no-explicit-any
async function webPush(sub: any, payload: string, vapidPrivate: string, vapidPublic: string) {
  const { sendNotification, setVapidDetails } = await import('https://esm.sh/web-push@3.6.7');
  setVapidDetails('mailto:jungmin5893@gmail.com', vapidPublic, vapidPrivate);
  await sendNotification(sub, payload);
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json();
  const { owner_id, employee_id, title, message, data } = body;

  if (!title) {
    return new Response(JSON.stringify({ error: 'Missing title' }), { status: 400 });
  }

  // owner_id 직접 지정 or employee_id를 통해 테넌트 owner 조회
  let targetOwnerId = owner_id;
  if (!targetOwnerId && employee_id) {
    const { data: emp } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', employee_id)
      .maybeSingle();
    if (emp?.tenant_id) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('id')
        .eq('tenant_id', emp.tenant_id)
        .eq('role', 'owner')
        .maybeSingle();
      targetOwnerId = owner?.id;
    }
  }

  if (!targetOwnerId) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  // 사장님의 모든 푸시 구독 조회
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', targetOwnerId);

  if (error || !subs?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')!;

  const payload = JSON.stringify({
    title,
    body: message || '',
    data: data || {},
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  });

  let sent = 0;
  const expired: string[] = [];

  for (const sub of subs) {
    try {
      await webPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload, vapidPrivate, vapidPublic
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        expired.push(sub.endpoint);
      }
    }
  }

  // 만료된 구독 삭제
  if (expired.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expired);
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
