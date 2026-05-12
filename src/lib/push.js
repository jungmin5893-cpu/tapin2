import { supabase } from './supabase.js';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// 브라우저 푸시 구독 생성 + DB 저장
export async function subscribePush(userId, tenantId = null) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (!VAPID_PUBLIC) { console.warn('[push] VITE_VAPID_PUBLIC_KEY 없음'); return null; }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }

    const subJson = sub.toJSON();
    const row = {
      user_id: userId,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys?.p256dh || '',
      auth: subJson.keys?.auth || '',
      user_agent: navigator.userAgent.slice(0, 200),
    };
    if (tenantId) row.tenant_id = tenantId;

    await supabase.from('push_subscriptions').upsert(row, { onConflict: 'user_id,endpoint' });

    return sub;
  } catch (err) {
    console.warn('[push] 구독 실패:', err.message);
    return null;
  }
}

// 푸시 구독 해제
export async function unsubscribePush(userId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await supabase.from('push_subscriptions').delete()
        .eq('user_id', userId).eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (err) {
    console.warn('[push] 해제 실패:', err.message);
  }
}

// 구독 여부 확인
export async function isPushSubscribed() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
