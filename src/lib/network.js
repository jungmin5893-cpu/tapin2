// 오프라인 감지 + 재시도 유틸

export function initOfflineBar() {
  let bar = document.getElementById('offline-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offline-bar';
    bar.style.cssText = [
      'display:none;position:fixed;top:0;left:0;right:0;z-index:99999',
      'background:#f79009;color:#fff;text-align:center',
      'padding:8px 16px;font-size:13px;font-weight:700',
      'box-shadow:0 2px 8px rgba(0,0,0,.2)',
    ].join(';');
    bar.textContent = '📶 인터넷 연결이 끊겼습니다. 네트워크를 확인해주세요.';
    document.body.prepend(bar);
  }

  const update = () => {
    bar.style.display = navigator.onLine ? 'none' : 'block';
    if (navigator.onLine && bar._wasOffline) {
      bar.style.background = '#00c9a7';
      bar.textContent = '✅ 연결이 복구됐습니다.';
      setTimeout(() => {
        bar.style.display = 'none';
        bar.style.background = '#f79009';
        bar.textContent = '📶 인터넷 연결이 끊겼습니다. 네트워크를 확인해주세요.';
      }, 2000);
    }
    bar._wasOffline = !navigator.onLine;
  };

  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// GPS 유틸: 두 좌표 간 거리(m) 계산 (Haversine)
export function gpsDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GPS 위치 취득 (Promise, timeout 가능)
export function getGpsPosition(timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS_NOT_SUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(err),
      { timeout: timeoutMs, enableHighAccuracy: true, maximumAge: 30000 }
    );
  });
}

// with 재시도 래퍼 — fn 이 Error 던지면 retries 번 재시도
export async function withRetry(fn, retries = 2, delayMs = 800) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}
