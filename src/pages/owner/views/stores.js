import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { getLabels } from '../../../lib/labels.js';
import { kst, minutesToHm, diffMinutes } from '../../../lib/time.js';

// ─────────────────────────────────────────────────────────────
// 메인 렌더
// ─────────────────────────────────────────────────────────────
export async function renderStores({ root, profile }) {
  const labels  = getLabels(profile.tenants?.industry_type);
  const siteLbl = labels.site;
  const wLbl    = labels.worker;

  root.innerHTML = `
    <div class="page-head">
      <h1>${siteLbl} 관리</h1>
      <div class="page-sub">${siteLbl}별 QR · 직원 목록 · 출근일지</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>${labels.siteAdd}</h2></div>
      <form id="form-store" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px">
          <input type="text"   id="st-name"   placeholder="${siteLbl} 이름" required style="flex:1">
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
        <button type="submit" class="btn primary" style="align-self:flex-start">추가</button>
      </form>
    </div>

    <div id="stores-list"></div>

    <!-- ── 출근일지 캘린더 모달 ─────────────────── -->
    <div id="cal-modal" style="display:none;position:fixed;inset:0;z-index:9999;
         background:rgba(10,20,40,.75);backdrop-filter:blur(6px);
         align-items:center;justify-content:center;padding:16px">
      <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,.1);border-radius:20px;
           width:100%;max-width:480px;max-height:92vh;overflow-y:auto;
           box-shadow:0 32px 80px rgba(0,0,0,.6)">

        <!-- 헤더 -->
        <div style="display:flex;align-items:center;justify-content:space-between;
             padding:20px 20px 16px;border-bottom:1px solid rgba(255,255,255,.07)">
          <div style="display:flex;align-items:center;gap:12px">
            <div id="cal-avatar" style="width:42px;height:42px;border-radius:50%;
                 background:linear-gradient(135deg,#00c9a7,#7c3aed);
                 color:#fff;font-weight:800;font-size:18px;
                 display:flex;align-items:center;justify-content:center;flex-shrink:0"></div>
            <div>
              <div id="cal-emp-name" style="font-size:15px;font-weight:700;color:#f1f5f9"></div>
              <div id="cal-emp-sub"  style="font-size:12px;color:#64748b;margin-top:2px"></div>
            </div>
          </div>
          <button id="btn-cal-close"
            style="background:rgba(255,255,255,.08);border:none;cursor:pointer;
                   width:32px;height:32px;border-radius:50%;color:#94a3b8;
                   font-size:16px;display:flex;align-items:center;justify-content:center;
                   transition:background .15s">✕</button>
        </div>

        <!-- 월 네비 -->
        <div style="display:flex;align-items:center;justify-content:space-between;
             padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.07)">
          <button id="btn-cal-prev"
            style="background:rgba(255,255,255,.06);border:none;cursor:pointer;
                   width:36px;height:36px;border-radius:10px;color:#cbd5e1;
                   font-size:20px;display:flex;align-items:center;justify-content:center;
                   transition:background .15s">‹</button>
          <span id="cal-month-label"
            style="font-size:18px;font-weight:800;color:#f1f5f9;letter-spacing:-.3px"></span>
          <button id="btn-cal-next"
            style="background:rgba(255,255,255,.06);border:none;cursor:pointer;
                   width:36px;height:36px;border-radius:10px;color:#cbd5e1;
                   font-size:20px;display:flex;align-items:center;justify-content:center;
                   transition:background .15s">›</button>
        </div>

        <!-- 달력 그리드 -->
        <div id="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);
             gap:2px;padding:12px 12px 4px"></div>

        <!-- 범례 + 통계 -->
        <div style="padding:8px 16px 20px">
          <div style="display:flex;gap:14px;justify-content:center;margin-bottom:14px">
            <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b">
              <span style="width:10px;height:10px;border-radius:3px;background:#22c55e;display:inline-block"></span>정상출근
            </span>
            <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b">
              <span style="width:10px;height:10px;border-radius:3px;background:#f59e0b;display:inline-block"></span>지각
            </span>
            <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b">
              <span style="width:10px;height:10px;border-radius:3px;background:#f97316;display:inline-block"></span>미퇴근
            </span>
          </div>
          <div id="cal-summary" style="display:flex;justify-content:space-around;
               padding:14px 0 0;border-top:1px solid rgba(255,255,255,.07)"></div>
        </div>
      </div>
    </div>
  `;

  injectStoreStyle();
  await loadStores(root, profile, siteLbl, wLbl);

  root.querySelector('#btn-addr-search').addEventListener('click', () => openPostcode(root));
  root.querySelector('#st-addr').addEventListener('click',         () => openPostcode(root));
  root.querySelector('#form-store').addEventListener('submit', e => submitStore(e, root, profile, siteLbl, wLbl));

  root.querySelector('#btn-cal-close').addEventListener('click', () => closeCalModal(root));
  root.querySelector('#cal-modal').addEventListener('click', e => {
    if (e.target === root.querySelector('#cal-modal')) closeCalModal(root);
  });
}

// ─────────────────────────────────────────────────────────────
// 현장 추가 폼
// ─────────────────────────────────────────────────────────────
async function submitStore(e, root, profile, siteLbl, wLbl) {
  e.preventDefault();
  const row = {
    tenant_id:   profile.tenant_id,
    name:        root.querySelector('#st-name').value.trim(),
    gps_lat:     parseFloat(root.querySelector('#st-lat').value)    || null,
    gps_lng:     parseFloat(root.querySelector('#st-lng').value)    || null,
    gps_radius_m: parseInt(root.querySelector('#st-radius').value)  || 100,
  };
  const { error } = await supabase.from('stores').insert(row);
  if (error) { toast(error.message, 'error'); return; }
  toast(`${siteLbl} 추가 완료`, 'success');
  e.target.reset();
  root.querySelector('#st-map-preview').style.display = 'none';
  await loadStores(root, profile, siteLbl, wLbl);
}

// ─────────────────────────────────────────────────────────────
// 현장 목록
// ─────────────────────────────────────────────────────────────
async function loadStores(root, profile, siteLbl, wLbl) {
  const { data } = await supabase.from('stores').select('*')
    .eq('tenant_id', profile.tenant_id).order('name');
  const list = root.querySelector('#stores-list');

  if (!data?.length) {
    list.innerHTML = `<div class="card"><div class="empty-state">아직 등록된 ${siteLbl}이 없습니다</div></div>`;
    return;
  }

  list.innerHTML = data.map(s => `
    <div class="card store-card" data-id="${s.id}">
      <div class="store-toggle-head" data-sid="${s.id}">
        <div style="display:flex;align-items:center;gap:10px">
          <h3 style="margin:0;font-size:15px">${s.name}</h3>
          <span class="store-emp-badge" id="badge-${s.id}"></span>
        </div>
        <span class="store-chevron" id="chev-${s.id}">▼</span>
      </div>

      <div class="store-qr-wrap">
        <div class="qr-block">
          <div id="qr-${s.id}" class="qr-canvas"></div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="btn small" data-download="${s.id}" data-name="${s.name}">⬇ QR 저장</button>
            <button class="btn small" data-print="${s.id}" data-name="${s.name}">🖨 프린트</button>
          </div>
        </div>
        <div class="store-info">
          <div style="font-size:12px;color:#8a94a6"><b>위치:</b> ${s.gps_lat ? `${s.gps_lat.toFixed(4)}, ${s.gps_lng.toFixed(4)}` : '미설정'}</div>
          <div style="font-size:12px;color:#8a94a6;margin-top:4px"><b>반경:</b> ${s.gps_radius_m}m</div>
          <div style="font-size:11px;color:#64748b;margin-top:6px;word-break:break-all">
            <code style="font-size:10px">tagin://checkin?store=${s.id}&s=${s.qr_secret.slice(0,8)}…</code>
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
            <button class="btn small ghost" data-regen="${s.id}">QR 재발급</button>
            <button class="btn small danger" data-del="${s.id}">삭제</button>
          </div>
        </div>
      </div>

      <!-- 직원 섹션 -->
      <div class="store-emp-panel" id="emp-${s.id}" style="display:none"></div>
    </div>
  `).join('');

  for (const s of data) {
    renderQr(root, s.id, `tagin://checkin?store=${s.id}&s=${s.qr_secret}`);
    loadBadge(root, s.id, profile, wLbl);
  }

  list.querySelectorAll('.store-toggle-head').forEach(h =>
    h.addEventListener('click', () => togglePanel(root, h.dataset.sid, profile, wLbl))
  );
  list.querySelectorAll('[data-regen]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    regenQr(root, b.dataset.regen, profile, siteLbl, wLbl);
  }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    deleteStore(root, b.dataset.del, profile, siteLbl, wLbl);
  }));
  list.querySelectorAll('[data-download]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    downloadQr(root, b.dataset.download, b.dataset.name);
  }));
  list.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    printQr(root, b.dataset.print, b.dataset.name);
  }));
}

// ─────────────────────────────────────────────────────────────
// 직원 수 뱃지
// ─────────────────────────────────────────────────────────────
async function loadBadge(root, storeId, profile, wLbl) {
  const { count } = await supabase.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId).eq('role', 'employee').eq('active', true);
  const el = root.querySelector(`#badge-${storeId}`);
  if (!el) return;
  el.textContent = `${wLbl} ${count ?? 0}명`;
  el.style.cssText = `font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;
    background:${count ? 'rgba(0,201,167,.15)' : 'rgba(138,148,166,.12)'};
    color:${count ? '#00c9a7' : '#8a94a6'}`;
}

// ─────────────────────────────────────────────────────────────
// 직원 패널 토글
// ─────────────────────────────────────────────────────────────
async function togglePanel(root, storeId, profile, wLbl) {
  const panel = root.querySelector(`#emp-${storeId}`);
  const chev  = root.querySelector(`#chev-${storeId}`);
  if (!panel) return;

  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▼' : '▲';
  if (open || panel.dataset.loaded) return;

  panel.innerHTML = '<div style="padding:12px 0;text-align:center;color:#8a94a6;font-size:13px">불러오는 중…</div>';

  const { data: emps, error } = await supabase
    .from('profiles')
    .select('id, name, phone, position, active')
    .eq('store_id', storeId).eq('role', 'employee').order('name');

  if (error) { panel.innerHTML = `<div style="color:#f04438;padding:10px;font-size:13px">${error.message}</div>`; return; }

  if (!emps?.length) {
    panel.innerHTML = `<div style="padding:12px 0 4px;text-align:center;color:#8a94a6;font-size:13px">배정된 ${wLbl}이 없습니다</div>`;
    panel.dataset.loaded = '1'; return;
  }

  // 이번 달 출근일 수
  const now  = new Date();
  const ms   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const me   = fmt(new Date(now.getFullYear(), now.getMonth()+1, 0));
  const { data: atts } = await supabase.from('attendances')
    .select('employee_id')
    .in('employee_id', emps.map(e => e.id))
    .gte('workday', ms).lte('workday', me);
  const cntMap = {};
  for (const a of atts || []) cntMap[a.employee_id] = (cntMap[a.employee_id] || 0) + 1;

  panel.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:#8a94a6;margin-bottom:8px">이번 달 출근 현황</div>
    ${emps.map(emp => `
      <div class="emp-row" data-eid="${emp.id}" data-ename="${emp.name}"
           data-sid="${storeId}" style="cursor:pointer">
        <div style="width:34px;height:34px;border-radius:50%;flex-shrink:0;
             background:linear-gradient(135deg,#00c9a7,#7c3aed);
             color:#fff;font-weight:700;font-size:14px;
             display:flex;align-items:center;justify-content:center">
          ${emp.name.slice(0,1)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${emp.name}</div>
          <div style="font-size:11px;color:#8a94a6;margin-top:1px">
            ${emp.position || wLbl} &middot;
            ${emp.active ? '<span style="color:#00c9a7">활성</span>' : '<span style="color:#8a94a6">비활성</span>'}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:800;color:#00c9a7">${cntMap[emp.id]||0}일</div>
          <div style="font-size:10px;color:#8a94a6">이번달</div>
        </div>
        <div style="color:#8a94a6;font-size:18px;padding-left:4px">›</div>
      </div>
    `).join('')}
  `;
  panel.dataset.loaded = '1';

  panel.querySelectorAll('.emp-row').forEach(row => row.addEventListener('click', () => {
    const storeName = root.querySelector(`[data-id="${row.dataset.sid}"] h3`)?.textContent || '';
    openCal(root, row.dataset.eid, row.dataset.ename, storeName);
  }));
}

// ─────────────────────────────────────────────────────────────
// 캘린더 모달
// ─────────────────────────────────────────────────────────────
function openCal(root, empId, empName, storeName) {
  const modal = root.querySelector('#cal-modal');
  root.querySelector('#cal-avatar').textContent    = empName.slice(0,1);
  root.querySelector('#cal-emp-name').textContent  = empName;
  root.querySelector('#cal-emp-sub').textContent   = storeName || '';

  modal._empId  = empId;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const now = new Date();
  modal._y = now.getFullYear();
  modal._m = now.getMonth();

  drawCal(root);

  root.querySelector('#btn-cal-prev').onclick = () => {
    if (modal._m === 0) { modal._y--; modal._m = 11; } else modal._m--;
    drawCal(root);
  };
  root.querySelector('#btn-cal-next').onclick = () => {
    if (modal._m === 11) { modal._y++; modal._m = 0; } else modal._m++;
    drawCal(root);
  };
}

function closeCalModal(root) {
  root.querySelector('#cal-modal').style.display = 'none';
  document.body.style.overflow = '';
}

async function drawCal(root) {
  const modal = root.querySelector('#cal-modal');
  const { _empId: empId, _y: year, _m: month } = modal;

  root.querySelector('#cal-month-label').textContent = `${year}년 ${month+1}월`;

  const grid = root.querySelector('#cal-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:#64748b;font-size:13px">불러오는 중…</div>';
  root.querySelector('#cal-summary').innerHTML = '';

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  const { data: rows, error } = await supabase
    .from('attendances')
    .select('workday, check_in_at, check_out_at, shift_types(start_time)')
    .eq('employee_id', empId)
    .gte('workday', fmt(firstDay)).lte('workday', fmt(lastDay))
    .order('workday');

  if (error) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:16px;color:#f04438;font-size:13px">${error.message}</div>`;
    return;
  }

  const byDay = {};
  for (const r of rows || []) byDay[r.workday] = r;

  // 통계
  let totalMins = 0, late = 0, noOut = 0;
  for (const r of rows || []) {
    if (r.check_in_at && r.check_out_at) totalMins += diffMinutes(r.check_in_at, r.check_out_at);
    if (!r.check_out_at) noOut++;
    if (r.check_in_at && r.shift_types?.start_time) {
      const st = new Date(`${r.workday}T${r.shift_types.start_time}+09:00`);
      if (new Date(r.check_in_at) - st > 30 * 60000) late++;
    }
  }

  // DOW 헤더
  const DOW = ['일','월','화','수','목','금','토'];
  const today = fmt(new Date());
  let html = DOW.map((d,i) => `
    <div style="text-align:center;font-size:11px;font-weight:700;padding:4px 0 8px;
         color:${i===0?'#f87171':i===6?'#60a5fa':'#64748b'}">${d}</div>
  `).join('');

  // 빈 칸
  for (let i = 0; i < firstDay.getDay(); i++)
    html += '<div></div>';

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const ds   = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const att  = byDay[ds];
    const dow  = new Date(year, month, d).getDay();
    const isWE = dow === 0 || dow === 6;
    const isTd = ds === today;

    let bg = 'transparent', textColor = isWE ? (dow===0?'#f87171':'#60a5fa') : '#cbd5e1';
    let badge = '';

    if (att) {
      if (!att.check_out_at) {
        bg = 'rgba(249,115,22,.22)'; badge = `<div style="font-size:8px;color:#fb923c;font-weight:700;margin-top:1px">미퇴근</div>`;
      } else {
        let isLate = false;
        if (att.shift_types?.start_time) {
          const st = new Date(`${ds}T${att.shift_types.start_time}+09:00`);
          isLate = new Date(att.check_in_at) - st > 30 * 60000;
        }
        bg = isLate ? 'rgba(245,158,11,.22)' : 'rgba(34,197,94,.22)';
        badge = isLate ? `<div style="font-size:8px;color:#fbbf24;font-weight:700;margin-top:1px">지각</div>` : '';
      }
      const inT  = att.check_in_at  ? kst(att.check_in_at).format('HH:mm')  : '';
      const outT = att.check_out_at ? kst(att.check_out_at).format('HH:mm') : '';
      badge += `<div style="font-size:8px;color:#94a3b8;line-height:1.4;margin-top:1px">${inT}${outT?`<br>${outT}`:''}</div>`;
    }

    html += `
      <div style="
        min-height:52px;border-radius:8px;padding:5px 4px 3px;
        background:${bg};
        ${isTd ? 'box-shadow:inset 0 0 0 2px #00c9a7' : ''};
        display:flex;flex-direction:column;align-items:center;
        font-size:12px;font-weight:600;color:${textColor};
        transition:background .15s">
        ${d}
        ${badge}
      </div>`;
  }
  grid.innerHTML = html;

  root.querySelector('#cal-summary').innerHTML = `
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:800;color:#00c9a7">${rows?.length||0}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">출근일</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:800;color:#00c9a7">${minutesToHm(totalMins)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">총 근무</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:800;color:${late?'#f59e0b':'#00c9a7'}">${late}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">지각</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:800;color:${noOut?'#f97316':'#00c9a7'}">${noOut}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">미퇴근</div>
    </div>
  `;
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─────────────────────────────────────────────────────────────
// 인라인 스타일 (현장 카드용만)
// ─────────────────────────────────────────────────────────────
function injectStoreStyle() {
  if (document.getElementById('store-style')) return;
  const s = document.createElement('style');
  s.id = 'store-style';
  s.textContent = `
    .store-toggle-head {
      display:flex;align-items:center;justify-content:space-between;
      cursor:pointer;user-select:none;padding:2px 4px;border-radius:8px;
      transition:background .15s;margin-bottom:12px;
    }
    .store-toggle-head:hover { background:rgba(0,201,167,.06); }
    .store-chevron { font-size:12px;color:#8a94a6;transition:transform .2s; }

    .store-qr-wrap { display:flex;gap:20px;flex-wrap:wrap; }

    .store-emp-panel {
      border-top:1px solid rgba(0,0,0,.07);margin-top:12px;padding-top:14px;
    }
    .emp-row {
      display:flex;align-items:center;gap:10px;padding:10px;
      border-radius:10px;transition:background .15s;
    }
    .emp-row:hover { background:rgba(0,201,167,.07); }
  `;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────
// QR
// ─────────────────────────────────────────────────────────────
async function renderQr(root, id, text) {
  const el = root.querySelector(`#qr-${id}`);
  if (!el) return;
  el.innerHTML = '<div style="color:#8a94a6;font-size:12px">QR 생성 중…</div>';
  try {
    if (!window._QRCode) {
      const { default: QRCode } = await import(/* @vite-ignore */'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
      window._QRCode = QRCode;
    }
    const canvas = document.createElement('canvas');
    await window._QRCode.toCanvas(canvas, text, { width:512, margin:2, color:{dark:'#0f1b2d',light:'#ffffff'} });
    canvas.style.cssText = 'width:200px;height:200px;display:block';
    el.innerHTML = ''; el.appendChild(canvas); el._canvas = canvas;
  } catch(err) {
    el.innerHTML = `<div style="color:#f04438;font-size:12px">QR 실패: ${err.message}</div>`;
  }
}

function downloadQr(root, sid, storeName) {
  const canvas = root.querySelector(`#qr-${sid}`)._canvas;
  if (!canvas) return;
  const safeName = (storeName || sid.slice(0,8)).replace(/[^\w가-힣]/g, '_');
  const a = document.createElement('a');
  a.download = `TAGIN_QR_${safeName}.png`;
  a.href = canvas.toDataURL('image/png'); a.click();
}

function printQr(root, sid, storeName) {
  const canvas = root.querySelector(`#qr-${sid}`)._canvas;
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/png');
  const win = window.open('', '_blank', 'width=520,height=720');
  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>QR 코드 — ${storeName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Malgun Gothic', sans-serif; background: #fff; color: #0f1b2d; }
    .page { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 48px 32px; }
    .brand { font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #94a3b8; margin-bottom: 20px; }
    .store-name { font-size: 26px; font-weight: 800; text-align: center; margin-bottom: 28px; line-height: 1.3; }
    .qr-wrap { border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; background: #fafbfc; }
    .qr-wrap img { width: 260px; height: 260px; display: block; image-rendering: pixelated; }
    .guide { margin-top: 24px; font-size: 13px; color: #64748b; text-align: center; line-height: 1.8; }
    .guide strong { color: #0f1b2d; }
    .print-btn { margin-top: 32px; padding: 13px 40px; background: #0f1b2d; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; letter-spacing: .3px; }
    .print-btn:hover { background: #1e3a5f; }
    @media print {
      .print-btn { display: none; }
      .page { padding: 32px; min-height: unset; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand">TAGIN 출퇴근 시스템</div>
    <div class="store-name">${storeName}</div>
    <div class="qr-wrap">
      <img src="${dataUrl}" alt="QR 코드">
    </div>
    <div class="guide">
      <strong>출퇴근 QR 코드</strong><br>
      직원 앱에서 이 QR 코드를 스캔하면<br>
      자동으로 출근 / 퇴근이 기록됩니다
    </div>
    <button class="print-btn" onclick="window.print()">🖨&nbsp; 프린트</button>
  </div>
</body>
</html>`);
  win.document.close();
  win.focus();
}

async function regenQr(root, sid, profile, siteLbl, wLbl) {
  if (!confirm('기존 QR이 무효화됩니다. 계속할까요?')) return;
  const { error } = await supabase.from('stores')
    .update({ qr_secret: crypto.randomUUID().replace(/-/g,'') }).eq('id', sid);
  if (error) toast(error.message, 'error');
  else { toast('QR 재발급 완료', 'success'); await loadStores(root, profile, siteLbl, wLbl); }
}

async function deleteStore(root, sid, profile, siteLbl, wLbl) {
  if (!confirm(`이 ${siteLbl}을 삭제하면 관련 기록도 함께 삭제됩니다. 계속할까요?`)) return;
  const { error } = await supabase.from('stores').delete().eq('id', sid);
  if (error) toast(error.message, 'error');
  else { toast('삭제됨', 'success'); await loadStores(root, profile, siteLbl, wLbl); }
}

// ─────────────────────────────────────────────────────────────
// 주소/지도
// ─────────────────────────────────────────────────────────────
async function openPostcode(root) {
  if (!window.daum?.Postcode) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = res; s.onerror = () => rej(new Error('주소 검색 로드 실패'));
      document.head.appendChild(s);
    });
  }
  new window.daum.Postcode({
    oncomplete: async data => {
      const addr = data.roadAddress || data.jibunAddress || data.address;
      root.querySelector('#st-addr').value = addr;
      try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr+', 대한민국')}&limit=1`,{ headers:{'Accept-Language':'ko'} });
        const json = await res.json();
        if (json.length) {
          const lat = parseFloat(json[0].lat), lng = parseFloat(json[0].lon);
          root.querySelector('#st-lat').value = lat;
          root.querySelector('#st-lng').value = lng;
          await showMap(root, lat, lng, addr);
        } else toast('좌표를 찾지 못했습니다.','warn',4000);
      } catch { toast('좌표 조회 오류','warn'); }
    },
  }).open();
}

async function showMap(root, lat, lng, label) {
  const d = root.querySelector('#st-map-preview');
  d.style.display = 'block';
  d.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a94a6;font-size:13px">지도 로딩 중…</div>';
  if (!window.L) await Promise.all([loadJs('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'), loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')]);
  d.innerHTML = '';
  if (d._leaflet_id) window.L.DomUtil.get(d)._leaflet_id = null;
  const map = window.L.map(d).setView([lat,lng],16);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxZoom:19}).addTo(map);
  window.L.marker([lat,lng]).addTo(map).bindPopup(label).openPopup();
}

function loadJs(src) {
  return new Promise((res,rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
}
function loadCss(href) {
  return new Promise(res => {
    if (document.querySelector(`link[href="${href}"]`)) { res(); return; }
    const l = document.createElement('link'); l.rel='stylesheet'; l.href=href; l.onload=res; document.head.appendChild(l);
  });
}
