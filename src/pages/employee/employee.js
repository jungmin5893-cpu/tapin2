import { supabase } from '../../lib/supabase.js';
import { requireRole, signOut, getMyProfile } from '../../lib/auth.js';
import { kst, fmt, fmtDate, fmtTime, minutesToHm, diffMinutes, nowKst } from '../../lib/time.js';
import { toast } from '../../lib/toast.js';
import { initOfflineBar, getGpsPosition, gpsDistance } from '../../lib/network.js';
import { subscribePush } from '../../lib/push.js';
import QrScanner from 'qr-scanner';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let profile = null;
let openAttendance = null;     // 미퇴근 row
let scanner = null;
let clockTimer = null;

init();

async function init() {
  profile = await requireRole('employee');
  if (!profile) return;

  $('#user-name').textContent = profile.name;
  $('#user-store').textContent = '직원';
  $('#profile-name').textContent = profile.name;
  $('#profile-phone').textContent = profile.phone || '-';
  $('#profile-position').textContent = profile.position || '직원';

  initOfflineBar();
  bindUI();
  await refreshAll();
  startClock();

  // attendances 실시간 갱신
  supabase.channel('emp-att')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'attendances',
      filter: `employee_id=eq.${profile.id}`,
    }, () => refreshAll())
    .subscribe();
}

function bindUI() {
  // QR 스캔 시작
  $('#qr-main-btn').addEventListener('click', startScan);

  // 스캔 종료
  $('#scan-cancel').addEventListener('click', stopScan);
  $('#scan-manual').addEventListener('click', manualEntry);

  // 성공 화면 확인
  $('#success-ok').addEventListener('click', () => {
    $('#success-view').classList.remove('active');
  });

  // 탭 전환
  $$('.tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      $$('.tab-item').forEach(b => b.classList.toggle('active', b === btn));
      $$('.page-view').forEach(p => p.classList.toggle('active', p.id === `page-${tab}`));
      if (tab === 'history') loadHistory();
      if (tab === 'salary') loadSalary();
    });
  });

  // 로그아웃
  $('#btn-logout')?.addEventListener('click', signOut);
}

function startClock() {
  const update = () => {
    $('#cur-time').textContent = nowKst().format('HH:mm:ss');
    if (openAttendance) {
      const min = diffMinutes(openAttendance.check_in_at, new Date());
      $('#work-time').textContent = `근무시간: ${minutesToHm(min)} 경과`;
    } else {
      $('#work-time').textContent = '';
    }
  };
  update();
  clockTimer = setInterval(update, 1000);
}

async function refreshAll() {
  await loadCurrentStatus();
  await loadTodayRecords();
  await loadMonthSummary();
}

async function loadCurrentStatus() {
  // 미퇴근 attendance 조회
  const { data, error } = await supabase
    .from('attendances')
    .select('id, store_id, check_in_at, check_out_at, workday, shift:shift_types(name, color), store:stores(name)')
    .eq('employee_id', profile.id)
    .is('check_out_at', null)
    .order('check_in_at', { ascending: false })
    .limit(1);
  if (error) { console.warn(error); return; }

  openAttendance = data?.[0] || null;
  const card = $('#status-card');
  const btn = $('#qr-main-btn');
  const btnLabel = $('#qr-btn-label');
  const btnSub = $('#qr-btn-sub');

  if (openAttendance) {
    card.classList.remove('checkedout');
    $('#cur-status').textContent = '🟢 근무 중';
    $('#store-name').textContent = `${openAttendance.store?.name || '매장'} · ${fmtTime(openAttendance.check_in_at)} 출근`;
    $('#status-shift').textContent = openAttendance.shift?.name || '';
    btn.classList.add('checkout');
    btnLabel.textContent = '퇴근하기';
    btnSub.textContent = 'QR 스캔으로 퇴근 처리';
  } else {
    card.classList.add('checkedout');
    $('#cur-status').textContent = '⚪ 미출근';
    $('#store-name').textContent = '오늘도 화이팅!';
    $('#status-shift').textContent = '';
    btn.classList.remove('checkout');
    btnLabel.textContent = '출근하기';
    btnSub.textContent = 'QR 스캔으로 출근 처리';
  }
}

async function loadTodayRecords() {
  // 시프트 기반 "오늘" 결정 — 마지막 attendance의 workday or 현재 시각의 workday
  const today = openAttendance?.workday || fmtDate(new Date());
  const { data, error } = await supabase
    .from('attendances')
    .select('id, check_in_at, check_out_at, store:stores(name), shift:shift_types(name)')
    .eq('employee_id', profile.id)
    .eq('workday', today)
    .order('check_in_at');
  if (error) { console.warn(error); return; }

  const list = $('#today-records');
  list.innerHTML = '';
  if (!data || !data.length) {
    list.innerHTML = '<div class="record-item" style="color:#8a94a6;font-size:13px;justify-content:center;">오늘 기록이 없습니다</div>';
    return;
  }
  for (const row of data) {
    list.appendChild(recordRow('in', '출근', fmtTime(row.check_in_at), row.store?.name, row.shift?.name));
    if (row.check_out_at) {
      list.appendChild(recordRow('out', '퇴근', fmtTime(row.check_out_at), row.store?.name, row.shift?.name));
    }
  }
}

function recordRow(kind, title, time, storeName, shiftName) {
  const div = document.createElement('div');
  div.className = 'record-item';
  div.innerHTML = `
    <div class="rec-icon ${kind}">${kind === 'in' ? '✅' : '🚪'}</div>
    <div class="rec-info">
      <div class="rec-title">${title}</div>
      <div class="rec-sub">${storeName || '매장'} · ${shiftName || ''}</div>
    </div>
    <div class="rec-time ${kind}">${time}</div>
  `;
  return div;
}

async function loadMonthSummary() {
  const monthStart = nowKst().startOf('month').format('YYYY-MM-DD');
  const monthEnd = nowKst().endOf('month').format('YYYY-MM-DD');
  const { data, error } = await supabase
    .from('attendances')
    .select('check_in_at, check_out_at, workday')
    .eq('employee_id', profile.id)
    .gte('workday', monthStart)
    .lte('workday', monthEnd);
  if (error) { console.warn(error); return; }

  const days = new Set();
  let minutes = 0;
  for (const r of data) {
    days.add(r.workday);
    if (r.check_out_at) minutes += diffMinutes(r.check_in_at, r.check_out_at);
  }
  $('#m-days').textContent = days.size;
  $('#m-hours').textContent = Math.floor(minutes / 60);
  const wage = profile.hourly_wage || 10030;
  $('#m-pay').textContent = Math.floor((minutes / 60) * wage).toLocaleString();
}

// ---------- QR 스캔 ----------
async function startScan() {
  $('#scan-view').classList.add('active');
  try {
    const video = $('#scan-video');
    scanner = new QrScanner(video, onScan, {
      highlightScanRegion: true,
      highlightCodeOutline: true,
      preferredCamera: 'environment',
    });
    await scanner.start();
  } catch (err) {
    console.error(err);
    toast('카메라 접근 권한이 필요합니다', 'error');
    stopScan();
  }
}

function stopScan() {
  $('#scan-view').classList.remove('active');
  if (scanner) {
    scanner.stop();
    scanner.destroy();
    scanner = null;
  }
}

async function onScan(result) {
  const raw = result?.data || '';
  await handleQrPayload(raw);
}

async function manualEntry() {
  const v = prompt('QR 내용을 직접 입력 (예: tagin://checkin?store=...&s=...)');
  if (v) await handleQrPayload(v);
}

function parseQr(raw) {
  // tagin://checkin?store=<uuid>&s=<secret>
  try {
    const u = new URL(raw.replace(/^tagin:\/\//, 'https://tagin.local/'));
    const store = u.searchParams.get('store');
    const s = u.searchParams.get('s');
    if (store && s) return { store, s };
  } catch {}
  // JSON 형식 폴백
  try {
    const j = JSON.parse(raw);
    if (j.store && j.s) return j;
  } catch {}
  return null;
}

async function handleQrPayload(raw) {
  const parsed = parseQr(raw);
  if (!parsed) {
    toast('올바른 QR이 아닙니다', 'error');
    return;
  }
  stopScan();

  // GPS 취득 + 매장 반경 검증
  let lat = null, lng = null;
  try {
    const pos = await getGpsPosition(5000);
    lat = pos.lat; lng = pos.lng;

    // 매장 GPS 설정 조회 후 반경 체크
    const { data: storeData } = await supabase
      .from('stores')
      .select('gps_lat, gps_lng, gps_radius_m, name')
      .eq('id', parsed.store)
      .maybeSingle();

    if (storeData?.gps_lat && storeData?.gps_lng) {
      const dist = gpsDistance(lat, lng, storeData.gps_lat, storeData.gps_lng);
      const radius = storeData.gps_radius_m || 100;
      if (dist > radius) {
        const ok = confirm(
          `📍 현재 위치가 매장(${storeData.name || ''})에서 약 ${Math.round(dist)}m 떨어져 있습니다.\n` +
          `허용 반경: ${radius}m\n\n그래도 출퇴근 처리할까요?`
        );
        if (!ok) return;
      }
    }
  } catch (gpsErr) {
    // GPS 권한 거부나 타임아웃 — 경고만 표시하고 계속 진행
    if (gpsErr.code === 1 /* PERMISSION_DENIED */) {
      toast('GPS 권한이 없어 위치 인증을 건너뜁니다', 'warn', 3000);
    }
  }

  const { data, error } = await supabase.rpc('check_in_or_out', {
    p_store: parsed.store,
    p_qr_secret: parsed.s,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) {
    const map = {
      INVALID_QR: 'QR이 만료되었거나 잘못되었습니다',
      TENANT_MISMATCH: '소속 매장의 QR이 아닙니다',
      EMPLOYEE_INACTIVE: '비활성 직원입니다',
      AUTH_REQUIRED: '로그인이 필요합니다',
      GPS_OUT_OF_RANGE: '매장 반경 밖입니다. 매장 안에서 다시 시도해주세요',
    };
    const code = error.message.match(/[A-Z_]+/g)?.[0];
    toast(map[code] || error.message, 'error');
    return;
  }

  showSuccess(data);
  await refreshAll();

  // 첫 체크인 시 푸시 구독 요청 (한 번만)
  if (data.action === 'check_in' && !sessionStorage.getItem('push_asked')) {
    sessionStorage.setItem('push_asked', '1');
    if ('Notification' in window && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await subscribePush(profile.id, profile.tenant_id);
      }
    } else if (Notification.permission === 'granted') {
      await subscribePush(profile.id, profile.tenant_id);
    }
  }

  // 사장님에게 푸시 알림 전송
  await notifyOwner(data);
}

async function notifyOwner(data) {
  try {
    const action = data.action === 'check_in' ? '출근' : '퇴근';
    const time = new Date(data.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    await supabase.functions.invoke('send-push', {
      body: {
        employee_id: profile.id,
        title: `${profile.name} ${action} 완료`,
        message: `${time} ${action} 처리됐습니다`,
        data: { action: data.action, employee_id: profile.id },
      },
    });
  } catch { /* 푸시 실패는 무시 */ }
}

function showSuccess(data) {
  const action = data.action;
  $('#success-icon').textContent = action === 'check_in' ? '✅' : '👋';
  $('#success-title').textContent = action === 'check_in' ? '출근 완료!' : '퇴근 완료!';
  $('#success-time').textContent = fmtTime(data.at);
  if (action === 'check_out') {
    $('#success-extra').textContent = `근무시간 ${minutesToHm(data.duration_minutes)}`;
  } else {
    $('#success-extra').textContent = `${fmtDate(data.workday)} 근무일`;
  }
  $('#success-view').classList.add('active');
}

// ---------- 내역/급여 (간단 버전) ----------
async function loadHistory() {
  const list = $('#history-list');
  list.innerHTML = '<div class="record-item" style="color:#8a94a6;">불러오는 중…</div>';
  const since = nowKst().subtract(30, 'day').format('YYYY-MM-DD');
  const { data, error } = await supabase
    .from('attendances')
    .select('id, check_in_at, check_out_at, workday, store:stores(name), shift:shift_types(name)')
    .eq('employee_id', profile.id)
    .gte('workday', since)
    .order('workday', { ascending: false })
    .order('check_in_at', { ascending: false });
  if (error) {
    list.innerHTML = `<div class="record-item" style="color:#f04438;">${error.message}</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = '<div class="record-item" style="color:#8a94a6;">최근 기록이 없습니다</div>';
    return;
  }
  list.innerHTML = '';
  let lastWorkday = '';
  for (const r of data) {
    if (r.workday !== lastWorkday) {
      const h = document.createElement('div');
      h.className = 'history-month';
      h.textContent = kst(r.workday).format('M월 D일 (dd)');
      list.appendChild(h);
      lastWorkday = r.workday;
    }
    const min = r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : 0;
    const div = document.createElement('div');
    div.className = 'record-item';
    div.innerHTML = `
      <div class="rec-icon in">⏱</div>
      <div class="rec-info">
        <div class="rec-title">${fmtTime(r.check_in_at)} ~ ${r.check_out_at ? fmtTime(r.check_out_at) : '진행 중'}</div>
        <div class="rec-sub">${r.store?.name || '매장'} · ${r.shift?.name || ''}</div>
      </div>
      <div class="rec-time in">${min ? minutesToHm(min) : '-'}</div>
    `;
    list.appendChild(div);
  }
}

async function loadSalary() {
  const period = nowKst().startOf('month').format('YYYY-MM-DD');
  const { data, error } = await supabase
    .from('payrolls')
    .select('*')
    .eq('employee_id', profile.id)
    .eq('period', period)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') console.warn(error);

  if (!data) {
    $('#sal-amount').textContent = '계산 전';
    $('#sal-date').textContent = '월말 정산 시 자동 계산';
    $('#sal-rows').innerHTML = '<div class="sal-row"><span>아직 명세가 없습니다</span><span></span></div>';
    return;
  }
  $('#sal-amount').textContent = `${data.net_pay.toLocaleString()}원`;
  $('#sal-date').textContent = `${fmtDate(period)} 기준`;
  $('#sal-rows').innerHTML = `
    <div class="sal-row"><span>기본급</span><span>${data.base_pay.toLocaleString()}원</span></div>
    <div class="sal-row"><span>야간수당</span><span>${data.night_pay.toLocaleString()}원</span></div>
    <div class="sal-row"><span>연장근무</span><span>${data.overtime_pay.toLocaleString()}원</span></div>
    <div class="sal-row deduct"><span>공제</span><span>-${data.deductions.toLocaleString()}원</span></div>
    <div class="sal-row"><span>실수령</span><span>${data.net_pay.toLocaleString()}원</span></div>
  `;
}
