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
      if (tab === 'history')   loadHistory();
      if (tab === 'salary')    loadSalary();
      if (tab === 'leave')     loadLeave();
      if (tab === 'contracts') loadContracts();
    });
  });

  // 휴가 신청 모달
  $('#leave-apply-btn').addEventListener('click', openLeaveModal);
  $('#leave-modal-cancel').addEventListener('click', closeLeaveModal);
  $('#leave-modal').addEventListener('click', e => { if (e.target === $('#leave-modal')) closeLeaveModal(); });
  $('#leave-modal-submit').addEventListener('click', submitLeave);

  // 종료일 자동 설정
  $('#leave-start').addEventListener('change', () => {
    const end = $('#leave-end');
    if (!end.value || end.value < $('#leave-start').value) end.value = $('#leave-start').value;
  });

  // 계약서 모달 닫기
  $('#contract-detail-close').addEventListener('click', () => {
    $('#contract-detail-modal').classList.remove('active');
  });
  $('#contract-detail-modal').addEventListener('click', e => {
    if (e.target === $('#contract-detail-modal')) $('#contract-detail-modal').classList.remove('active');
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

  // 급여방식별 예상 세전 계산
  const wage     = profile.hourly_wage || 10030;
  const wageType = profile.wage_type   || 'hourly';
  let gross = 0;
  if      (wageType === 'monthly') gross = wage;
  else if (wageType === 'daily')   gross = wage * days.size;
  else                              gross = Math.floor((minutes / 60) * wage);

  // 공제 적용
  const RATE = { insurance: 0.094, freelancer: 0.033, none: 0 };
  const rate = RATE[profile.deduction_type] ?? 0.094;
  const net  = Math.round(gross * (1 - rate));
  $('#m-pay').textContent = net.toLocaleString();
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
        toast(
          `📍 출퇴근 불가 — 현재 위치가 매장에서 ${Math.round(dist)}m 떨어져 있습니다 (허용 ${radius}m 이내). 매장 안에서 다시 시도해주세요.`,
          'error', 6000
        );
        return;
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

// ---------- 연차·휴가 ----------
function openLeaveModal() {
  const today = new Date().toISOString().slice(0, 10);
  $('#leave-start').value = today;
  $('#leave-end').value = today;
  $('#leave-reason').value = '';
  $('#leave-type').value = '연차';
  $('#leave-modal').classList.add('active');
}

function closeLeaveModal() {
  $('#leave-modal').classList.remove('active');
}

async function submitLeave() {
  const btn = $('#leave-modal-submit');
  const leaveType = $('#leave-type').value;
  const startDate = $('#leave-start').value;
  const endDate   = $('#leave-end').value;
  const reason    = $('#leave-reason').value.trim();

  if (!startDate || !endDate) { toast('날짜를 입력해주세요', 'error'); return; }
  if (endDate < startDate)    { toast('종료일이 시작일보다 빠릅니다', 'error'); return; }

  const isHalf = leaveType.startsWith('반차');
  const ms = new Date(endDate) - new Date(startDate);
  const days = isHalf ? 0.5 : Math.round(ms / 86400000) + 1;

  btn.disabled = true;
  btn.textContent = '신청 중…';

  const { error } = await supabase.from('leave_requests').insert({
    tenant_id:   profile.tenant_id,
    employee_id: profile.id,
    leave_type:  leaveType,
    start_date:  startDate,
    end_date:    endDate,
    days,
    reason: reason || null,
  });

  btn.disabled = false;
  btn.textContent = '신청하기';

  if (error) { toast(error.message, 'error'); return; }
  toast('휴가 신청이 완료됐습니다', 'success');
  closeLeaveModal();
  await loadLeave();
}

async function loadLeave() {
  const list = $('#leave-list');
  if (!list) return;
  list.innerHTML = '<div class="record-item" style="color:#8a94a6;justify-content:center;font-size:13px;">불러오는 중…</div>';

  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) { list.innerHTML = `<div class="record-item" style="color:#f04438;font-size:13px;">${error.message}</div>`; return; }
  if (!data?.length) {
    list.innerHTML = '<div class="record-item" style="color:#8a94a6;justify-content:center;font-size:13px;">신청 내역이 없습니다</div>';
    return;
  }

  const statusLabel = { pending: '검토중', approved: '승인', rejected: '반려' };
  list.innerHTML = data.map(r => {
    const dateStr = r.start_date === r.end_date ? r.start_date : `${r.start_date} ~ ${r.end_date}`;
    const canDelete = r.status === 'pending';
    return `
      <div class="leave-item">
        <div class="leave-info">
          <div class="l-type">${r.leave_type} <span style="font-size:12px;color:#64748b;font-weight:500">(${r.days}일)</span></div>
          <div class="l-date">${dateStr}</div>
          ${r.reason ? `<div class="l-reason">${r.reason}</div>` : ''}
          ${r.reject_reason ? `<div class="l-reason" style="color:#dc2626">반려 사유: ${r.reject_reason}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="leave-badge ${r.status}">${statusLabel[r.status] || r.status}</span>
          ${canDelete ? `<button data-del="${r.id}" style="font-size:11px;color:#94a3b8;background:none;border:none;cursor:pointer">취소</button>` : ''}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('신청을 취소하시겠습니까?')) return;
      const { error: de } = await supabase.from('leave_requests').delete().eq('id', btn.dataset.del);
      if (de) { toast(de.message, 'error'); return; }
      toast('신청이 취소됐습니다', 'success');
      await loadLeave();
    });
  });
}

async function loadContracts() {
  const list = $('#contracts-list');
  if (!list) return;
  list.innerHTML = '<div class="record-item" style="color:#8a94a6;justify-content:center;font-size:13px;">불러오는 중…</div>';

  const { data, error } = await supabase
    .from('labor_contracts')
    .select('id, contract_type, start_date, end_date, wage_type, wage_amount, status, owner_signed_at, employee_signed_at, created_at')
    .eq('employee_id', profile.id)
    .in('status', ['sent', 'completed'])
    .order('created_at', { ascending: false });

  if (error) { list.innerHTML = `<div class="record-item" style="color:#f04438;font-size:13px;">${error.message}</div>`; return; }
  if (!data?.length) {
    list.innerHTML = '<div class="record-item" style="color:#8a94a6;justify-content:center;font-size:13px;">발급된 계약서가 없습니다</div>';
    return;
  }

  const typeLabel = { regular: '정규직', fixed: '계약직', parttime: '단시간' };
  const wageLabel = { hourly: '시급', daily: '일급', monthly: '월급' };
  list.innerHTML = data.map(r => {
    const period = r.end_date ? `${r.start_date} ~ ${r.end_date}` : `${r.start_date}~`;
    const badgeClass = r.status === 'completed' ? 'completed' : 'sent';
    const badgeText  = r.status === 'completed' ? '서명 완료' : '서명 필요';
    return `
      <div class="contract-item" data-id="${r.id}" style="cursor:pointer">
        <div class="contract-info">
          <div class="c-title">${typeLabel[r.contract_type] || r.contract_type} 근로계약서</div>
          <div class="c-sub">${period} · ${wageLabel[r.wage_type] || ''} ${Number(r.wage_amount).toLocaleString()}원</div>
          <div class="c-sub" style="margin-top:4px;font-size:11px">
            사장 서명: ${r.owner_signed_at ? '✅' : '⏳'} &nbsp;|&nbsp;
            직원 서명: ${r.employee_signed_at ? '✅' : '⏳'}
          </div>
        </div>
        <span class="contract-badge ${badgeClass}">${badgeText}</span>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => openContractDetail(el.dataset.id));
  });
}

async function openContractDetail(id) {
  const { data: c, error } = await supabase
    .from('labor_contracts')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !c) { toast('계약서를 불러올 수 없습니다', 'error'); return; }

  const wageLabel = { hourly: '시급', daily: '일급', monthly: '월급' };
  const wageUnit  = { hourly: '원/시간', daily: '원/일', monthly: '원/월' };
  const dedLabel  = { insurance: '4대보험 (~9.4%)', freelancer: '프리랜서 3.3%', none: '공제 없음' };
  const typeLabel = { regular: '정규직 (기간 정함 없음)', fixed: '계약직 (기간제)', parttime: '단시간 근로자' };
  const period    = c.end_date ? `${c.start_date} ~ ${c.end_date}` : `${c.start_date}부터 (기간 정함 없음)`;

  const row = (label, value) =>
    `<div class="contract-row"><span>${label}</span><span>${value}</span></div>`;

  const canSign = c.status === 'sent' && !c.employee_signed_at;

  $('#contract-detail-body').innerHTML = `
    <div class="contract-section">
      <h4>계약 정보</h4>
      ${row('계약 유형', typeLabel[c.contract_type] || c.contract_type)}
      ${row('계약 기간', period)}
      ${row('취업 장소', c.work_location || '-')}
      ${row('담당 업무', c.job_description || '-')}
    </div>
    <div class="contract-section">
      <h4>근로시간</h4>
      ${row('소정근로일', c.work_days)}
      ${row('근무시간', `${c.daily_start} ~ ${c.daily_end}`)}
      ${row('휴게시간', `${c.break_minutes}분`)}
      ${row('주간 소정근로', `${c.weekly_hours}시간`)}
    </div>
    <div class="contract-section">
      <h4>임금</h4>
      ${row('임금 종류', wageLabel[c.wage_type] || c.wage_type)}
      ${row('금액', `${Number(c.wage_amount).toLocaleString()}${wageUnit[c.wage_type] || '원'}`)}
      ${row('지급일', `매월 ${c.pay_day}일`)}
      ${row('지급 방법', c.pay_method)}
      ${row('공제 방식', dedLabel[c.deduction_type] || c.deduction_type)}
    </div>
    <div class="contract-section">
      <h4>휴가</h4>
      ${row('연차유급휴가', `${c.annual_leave_days}일`)}
    </div>
    <div class="sign-section">
      <div class="sign-box">
        <div class="s-label">사용자 서명</div>
        <div class="s-name">${c.owner_name || '-'} (인)</div>
        <div class="s-date">${c.owner_signed_at ? new Date(c.owner_signed_at).toLocaleDateString('ko-KR') : '미서명'}</div>
      </div>
      <div class="sign-box">
        <div class="s-label">근로자 서명</div>
        <div class="s-name">${profile.name} (인)</div>
        <div class="s-date">${c.employee_signed_at ? new Date(c.employee_signed_at).toLocaleDateString('ko-KR') + ' 서명 완료' : '아직 서명하지 않았습니다'}</div>
      </div>
      ${canSign ? `
        <p style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:12px">
          위 근로계약서 내용을 충분히 확인하였으며, 이에 동의하고 서명합니다.<br>
          본 전자서명은 전자문서 및 전자거래 기본법에 따라 법적 효력을 가집니다.
        </p>
        <button class="btn-sign" id="btn-employee-sign" data-id="${c.id}">✍️ 서명하기</button>
      ` : ''}
    </div>
  `;

  $('#contract-detail-modal').classList.add('active');

  const signBtn = $('#btn-employee-sign');
  if (signBtn) {
    signBtn.addEventListener('click', async () => {
      if (!confirm(`"${profile.name}"(으)로 전자서명하시겠습니까?\n서명 후에는 취소할 수 없습니다.`)) return;
      signBtn.disabled = true;
      signBtn.textContent = '서명 중…';
      const now = new Date().toISOString();
      const { error: se } = await supabase.from('labor_contracts').update({
        employee_name:      profile.name,
        employee_signed_at: now,
        status:             'completed',
        updated_at:         now,
      }).eq('id', signBtn.dataset.id);
      if (se) { toast(se.message, 'error'); signBtn.disabled = false; signBtn.textContent = '✍️ 서명하기'; return; }
      toast('서명이 완료됐습니다! 계약서가 효력을 발생합니다.', 'success', 4000);
      $('#contract-detail-modal').classList.remove('active');
      await loadContracts();
    });
  }
}

async function loadSalary() {
  const monthStart = nowKst().startOf('month').format('YYYY-MM-DD');
  const monthEnd   = nowKst().endOf('month').format('YYYY-MM-DD');
  const period     = monthStart;

  const RATE  = { insurance: 0.094, freelancer: 0.033, none: 0 };
  const RLBL  = { insurance: '4대보험 공제 (9.4%)', freelancer: '원천징수 (3.3%)', none: '공제 없음' };
  const WLBL  = { hourly: '시급제', daily: '일급제', monthly: '월급제' };

  const wage         = profile.hourly_wage    || 10030;
  const wageType     = profile.wage_type      || 'hourly';
  const deductionType= profile.deduction_type || 'insurance';
  const rate         = RATE[deductionType] ?? 0.094;

  // 사장님이 정산을 이미 완료한 경우 — payrolls 우선
  const { data: payroll } = await supabase
    .from('payrolls')
    .select('*')
    .eq('employee_id', profile.id)
    .eq('period', period)
    .maybeSingle();

  if (payroll) {
    $('#sal-amount').textContent = `${payroll.net_pay.toLocaleString()}원`;
    $('#sal-date').textContent   = '이번 달 정산 완료';
    $('#sal-rows').innerHTML = `
      <div class="sal-row"><span>기본급</span><span>${payroll.base_pay.toLocaleString()}원</span></div>
      ${payroll.night_pay    > 0 ? `<div class="sal-row"><span>야간수당</span><span>+${payroll.night_pay.toLocaleString()}원</span></div>` : ''}
      ${payroll.overtime_pay > 0 ? `<div class="sal-row"><span>연장수당</span><span>+${payroll.overtime_pay.toLocaleString()}원</span></div>` : ''}
      ${payroll.deductions   > 0 ? `<div class="sal-row deduct"><span>${RLBL[deductionType]}</span><span>-${payroll.deductions.toLocaleString()}원</span></div>` : ''}
      <div class="sal-row total"><span>실수령</span><span><strong>${payroll.net_pay.toLocaleString()}원</strong></span></div>
    `;
    return;
  }

  // 정산 전 — 실시간 근무 데이터로 예상액 계산
  const { data: atts } = await supabase
    .from('attendances')
    .select('check_in_at, check_out_at, workday')
    .eq('employee_id', profile.id)
    .gte('workday', monthStart)
    .lte('workday', monthEnd);

  const days = new Set((atts || []).map(a => a.workday));
  let minutes = 0;
  for (const r of atts || []) {
    if (r.check_out_at) minutes += diffMinutes(r.check_in_at, r.check_out_at);
  }

  let gross = 0;
  let breakdown = '';

  if (wageType === 'monthly') {
    gross = wage;
    breakdown = `
      <div class="sal-row"><span>월급 (고정)</span><span>${wage.toLocaleString()}원</span></div>`;
  } else if (wageType === 'daily') {
    gross = wage * days.size;
    breakdown = `
      <div class="sal-row"><span>일급</span><span>${wage.toLocaleString()}원</span></div>
      <div class="sal-row"><span>근무일수</span><span>${days.size}일</span></div>
      <div class="sal-row"><span>소계</span><span>${gross.toLocaleString()}원</span></div>`;
  } else {
    gross = Math.floor((minutes / 60) * wage);
    const h = Math.floor(minutes / 60), m = minutes % 60;
    breakdown = `
      <div class="sal-row"><span>시급</span><span>${wage.toLocaleString()}원/h</span></div>
      <div class="sal-row"><span>총 근무</span><span>${h}시간 ${m}분</span></div>
      <div class="sal-row"><span>소계</span><span>${gross.toLocaleString()}원</span></div>`;
  }

  const deductions = Math.round(gross * rate);
  const net        = gross - deductions;

  $('#sal-amount').textContent = `${net.toLocaleString()}원`;
  $('#sal-date').textContent   = `예상 실수령 · ${WLBL[wageType]} (정산 전)`;
  $('#sal-rows').innerHTML = `
    ${breakdown}
    ${deductions > 0
      ? `<div class="sal-row deduct"><span>${RLBL[deductionType]}</span><span>-${deductions.toLocaleString()}원</span></div>`
      : `<div class="sal-row"><span>${RLBL[deductionType]}</span><span>없음</span></div>`}
    <div class="sal-row total"><span>예상 실수령</span><span><strong>${net.toLocaleString()}원</strong></span></div>
  `;
}
