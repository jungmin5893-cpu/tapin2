import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { getLabels } from '../../../lib/labels.js';

export async function renderStores({ root, profile }) {
  const labels = getLabels(profile.tenants?.industry_type);
  const siteLbl = labels.site;       // 현장 / 파견처 / 매장 등
  const siteAddLbl = labels.siteAdd; // 현장 추가 / 파견처 추가 등

  root.innerHTML = `
    <div class="page-head">
      <h1>${siteLbl} 관리</h1>
      <div class="page-sub">${siteLbl}별 QR 코드, 위치, 출퇴근 규칙</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>${siteAddLbl}</h2></div>
      <form id="form-store" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px">
          <input type="text" id="st-name" placeholder="${siteLbl} 이름" required style="flex:1">
          <input type="number" id="st-radius" placeholder="반경(m)" value="100" style="width:100px">
        </div>
        <div style="display:flex;gap:8px">
          <input type="text" id="st-addr" placeholder="주소 검색 버튼을 눌러주세요"
            readonly style="flex:1;cursor:pointer;background:#f8fafc">
          <button type="button" id="btn-addr-search" class="btn">🔍 주소 검색</button>
        </div>
        <input type="hidden" id="st-lat">
        <input type="hidden" id="st-lng">
        <div id="st-map-preview" style="display:none;height:220px;border-radius:8px;overflow:hidden;border:1px solid #e9edf2"></div>
        <div>
          <button type="submit" class="btn primary">추가</button>
        </div>
      </form>
    </div>
    <div id="stores-list"></div>
  `;

  await loadStores(root, profile, siteLbl);

  root.querySelector('#btn-addr-search').addEventListener('click', () => openPostcode(root));
  root.querySelector('#st-addr').addEventListener('click', () => openPostcode(root));

  root.querySelector('#form-store').addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = {
      tenant_id: profile.tenant_id,
      name: root.querySelector('#st-name').value.trim(),
      gps_lat: parseFloat(root.querySelector('#st-lat').value) || null,
      gps_lng: parseFloat(root.querySelector('#st-lng').value) || null,
      gps_radius_m: parseInt(root.querySelector('#st-radius').value) || 100,
    };
    const { error } = await supabase.from('stores').insert(row);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${siteLbl} 추가 완료`, 'success');
    e.target.reset();
    root.querySelector('#st-map-preview').style.display = 'none';
    await loadStores(root, profile, siteLbl);
  });
}

async function openPostcode(root) {
  if (!window.daum?.Postcode) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('주소 검색 스크립트 로드 실패'));
      document.head.appendChild(s);
    });
  }

  new window.daum.Postcode({
    oncomplete: async (data) => {
      const addr = data.roadAddress || data.jibunAddress || data.address;
      root.querySelector('#st-addr').value = addr;

      // Nominatim으로 좌표 변환 (OpenStreetMap, 무료·키 불필요)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr + ', 대한민국')}&limit=1`,
          { headers: { 'Accept-Language': 'ko' } }
        );
        const json = await res.json();
        if (json.length) {
          const lat = parseFloat(json[0].lat);
          const lng = parseFloat(json[0].lon);
          root.querySelector('#st-lat').value = lat;
          root.querySelector('#st-lng').value = lng;
          await showMapPreview(root, lat, lng, addr);
        } else {
          toast('좌표를 찾지 못했습니다. 주소는 저장되지만 GPS 기능은 제한됩니다.', 'warn', 4000);
        }
      } catch {
        toast('좌표 조회 중 오류가 발생했습니다.', 'warn');
      }
    },
  }).open();
}

async function showMapPreview(root, lat, lng, label) {
  const mapDiv = root.querySelector('#st-map-preview');
  mapDiv.style.display = 'block';
  mapDiv.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a94a6;font-size:13px">지도 로딩 중…</div>';

  if (!window.L) {
    await Promise.all([
      loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
      loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
    ]);
  }

  mapDiv.innerHTML = '';
  // 기존 Leaflet 인스턴스가 있으면 제거
  if (mapDiv._leaflet_id) {
    window.L.DomUtil.get(mapDiv)._leaflet_id = null;
  }
  const map = window.L.map(mapDiv).setView([lat, lng], 16);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
  window.L.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.onload = resolve;
    document.head.appendChild(l);
  });
}

async function loadStores(root, profile, siteLbl = '현장') {
  const { data } = await supabase.from('stores').select('*').eq('tenant_id', profile.tenant_id).order('name');
  const list = root.querySelector('#stores-list');
  if (!data?.length) { list.innerHTML = `<div class="card"><div class="empty-state">아직 등록된 ${siteLbl}이 없습니다</div></div>`; return; }
  list.innerHTML = data.map(s => `
    <div class="card store-card" data-id="${s.id}">
      <div class="store-head">
        <h3>${s.name}</h3>
        <div class="store-actions">
          <button class="btn small ghost" data-regen="${s.id}">QR 재발급</button>
          <button class="btn small danger" data-del="${s.id}">삭제</button>
        </div>
      </div>
      <div class="store-body">
        <div class="qr-block">
          <div id="qr-${s.id}" class="qr-canvas"></div>
          <div class="qr-caption">QR 시크릿: <code>${s.qr_secret.slice(0, 8)}…</code></div>
          <button class="btn small" data-download="${s.id}">QR PNG 저장</button>
        </div>
        <div class="store-info">
          <div><b>위치:</b> ${s.gps_lat ? `${s.gps_lat.toFixed(5)}, ${s.gps_lng.toFixed(5)}` : '미설정'}</div>
          <div><b>반경:</b> ${s.gps_radius_m}m</div>
          <div class="qr-content"><b>QR 내용:</b><br><code>tagin://checkin?store=${s.id}&s=${s.qr_secret}</code></div>
        </div>
      </div>
    </div>
  `).join('');

  for (const s of data) {
    renderQrInto(root, `qr-${s.id}`, `tagin://checkin?store=${s.id}&s=${s.qr_secret}`);
  }

  list.querySelectorAll('[data-regen]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('기존 QR이 무효화됩니다. 계속할까요?')) return;
    const newSecret = crypto.randomUUID().replace(/-/g, '');
    const { error } = await supabase.from('stores').update({ qr_secret: newSecret }).eq('id', b.dataset.regen);
    if (error) toast(error.message, 'error');
    else { toast('QR 재발급 완료', 'success'); await loadStores(root, profile, siteLbl); }
  }));

  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`이 ${siteLbl}을 삭제하면 관련 출퇴근 기록도 함께 삭제됩니다. 계속할까요?`)) return;
    const { error } = await supabase.from('stores').delete().eq('id', b.dataset.del);
    if (error) toast(error.message, 'error');
    else { toast('삭제됨', 'success'); await loadStores(root, profile, siteLbl); }
  }));

  list.querySelectorAll('[data-download]').forEach(b => b.addEventListener('click', () => downloadQr(root, b.dataset.download)));
}

async function renderQrInto(root, id, text) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.innerHTML = '<div style="color:#8a94a6;font-size:12px;">QR 생성 중…</div>';
  try {
    if (!window._QRCode) {
      const { default: QRCode } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
      window._QRCode = QRCode;
    }
    const canvas = document.createElement('canvas');
    await window._QRCode.toCanvas(canvas, text, { width: 200, margin: 1, color: { dark: '#0f1b2d', light: '#ffffff' } });
    el.innerHTML = '';
    el.appendChild(canvas);
    el._canvas = canvas;
  } catch (err) {
    el.innerHTML = `<div style="color:#f04438;font-size:12px;">QR 로드 실패: ${err.message}</div>`;
  }
}

function downloadQr(root, storeId) {
  const el = root.querySelector(`#qr-${storeId}`);
  const canvas = el?._canvas;
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `TAGIN_QR_${storeId.slice(0, 8)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
