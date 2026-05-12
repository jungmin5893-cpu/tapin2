import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import {
  listShiftTypes, upsertShiftType, deleteShiftType,
  listShiftSchedules, upsertShiftSchedule, setOffDay,
  copyScheduleRange, seedFromWeekday,
} from '../../../lib/shifts.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export async function renderShifts({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>시프트 관리</h1>
      <div class="page-sub">캘린더에서 직원별로 날짜에 시프트를 배정합니다 · "이전 주 복사"로 반복 일정 빠르게 생성</div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>시프트 타입</h2>
        <div class="card-sub">시작/종료 시각이 다음날을 넘으면 자동으로 야간조로 인식됩니다</div>
      </div>
      <div id="shift-types-list"></div>
      <form id="form-shift-type" class="form-row">
        <input type="text" id="sh-name" placeholder="이름 (예: 야간조)" required>
        <input type="time" id="sh-start" required>
        <input type="time" id="sh-end" required>
        <input type="number" id="sh-break" placeholder="휴게(분)" value="0" style="width:90px">
        <input type="color" id="sh-color" value="#00c9a7" style="width:50px">
        <button type="submit" class="btn primary">추가</button>
      </form>
    </div>

    <div class="card" id="card-store-pick" style="display:none">
      <div class="card-head">
        <h2>매장 선택</h2>
        <div class="card-sub">스케줄을 짤 매장을 선택하세요</div>
      </div>
      <div id="store-list" class="store-pick-list"></div>
    </div>

    <div class="card" id="card-calendar" style="display:none">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 id="cal-title">스케줄</h2>
          <button class="btn small ghost" id="btn-back-stores" style="display:none">← 매장 선택</button>
        </div>
        <div class="card-sub">셀 클릭 → 시프트/휴무 선택. 시프트 변경은 즉시 저장됩니다.</div>
      </div>

      <div class="filter-bar">
        <button class="btn small" id="btn-prev-month">◀</button>
        <strong id="month-label" style="min-width:120px;text-align:center;font-size:15px"></strong>
        <button class="btn small" id="btn-next-month">▶</button>
        <span style="flex:1"></span>
        <button class="btn small ghost" id="btn-copy-prev-week" title="가장 최근 완성된 한 주를 다음 주로 복사">📋 이전 주 복사</button>
        <button class="btn small ghost" id="btn-copy-prev-month" title="저번 달 패턴을 이번 달로 복사">📋 전월 복사</button>
        <button class="btn small ghost" id="btn-seed-weekday" title="요일 패턴에서 이번 달 자동 채우기">🌱 요일 패턴 시드</button>
      </div>

      <div class="cal-scroll-wrap">
        <table class="cal-grid" id="cal-grid"></table>
      </div>
    </div>
  `;

  root._shiftState = {
    shiftTypes: [],
    stores: [],
    selectedStoreId: null,
    employees: [],
    schedules: new Map(), // `${empId}|${dateStr}` → row
    cursor: new Date(),  // 보고 있는 달
  };

  root._profile = profile;

  await loadShiftTypes(root, profile);
  await loadStoresAndPick(root, profile);

  root.querySelector('#form-shift-type').addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = {
      tenant_id: profile.tenant_id,
      name: root.querySelector('#sh-name').value.trim(),
      start_time: root.querySelector('#sh-start').value + ':00',
      end_time: root.querySelector('#sh-end').value + ':00',
      break_minutes: parseInt(root.querySelector('#sh-break').value) || 0,
      color: root.querySelector('#sh-color').value,
    };
    try {
      await upsertShiftType(row);
      toast('시프트 추가됨', 'success');
      e.target.reset();
      root.querySelector('#sh-color').value = '#00c9a7';
      await loadShiftTypes(root, profile);
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelector('#btn-prev-month').addEventListener('click', () => moveMonth(root, profile, -1));
  root.querySelector('#btn-next-month').addEventListener('click', () => moveMonth(root, profile, +1));
  root.querySelector('#btn-back-stores').addEventListener('click', () => {
    root._shiftState.selectedStoreId = null;
    root.querySelector('#card-calendar').style.display = 'none';
    showStorePicker(root);
  });
  root.querySelector('#btn-copy-prev-week').addEventListener('click', () => copyPrevWeek(root, profile));
  root.querySelector('#btn-copy-prev-month').addEventListener('click', () => copyPrevMonth(root, profile));
  root.querySelector('#btn-seed-weekday').addEventListener('click', () => seedThisMonth(root, profile));
}

async function loadShiftTypes(root, profile) {
  const state = root._shiftState;
  state.shiftTypes = await listShiftTypes(profile.tenant_id);
  renderShiftTypeList(root, profile, state);
}

function renderShiftTypeList(root, profile, state) {
  const list = root.querySelector('#shift-types-list');
  if (!state.shiftTypes.length) {
    list.innerHTML = '<div class="empty-state">시프트가 없습니다. 아래에서 추가하세요.</div>';
    return;
  }
  list.innerHTML = state.shiftTypes.map(st => `
    <div class="shift-pill" style="border-color:${st.color}">
      <span class="dot" style="background:${st.color}"></span>
      <strong>${st.name}</strong>
      <span class="time">${st.start_time.slice(0,5)} ~ ${st.end_time.slice(0,5)}</span>
      ${st.is_overnight ? '<span class="pill night">야간</span>' : ''}
      ${st.break_minutes ? `<span class="muted">휴게 ${st.break_minutes}분</span>` : ''}
      <button class="btn small ghost" data-del-shift="${st.id}">삭제</button>
    </div>
  `).join('');
  list.querySelectorAll('[data-del-shift]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('시프트 타입을 삭제할까요? 이미 사용된 기록은 보존됩니다.')) return;
    try {
      await deleteShiftType(b.dataset.delShift);
      toast('삭제됨', 'success');
      await loadShiftTypes(root, profile);
      // 캘린더도 다시 그려야 색상 갱신됨
      if (root._shiftState.selectedStoreId !== null || root._shiftState.stores.length <= 1) {
        await loadCalendar(root, profile);
      }
    } catch (err) { toast(err.message, 'error'); }
  }));
}

async function loadStoresAndPick(root, profile) {
  const { data: stores } = await supabase
    .from('stores').select('id, name')
    .eq('tenant_id', profile.tenant_id).order('name');
  root._shiftState.stores = stores || [];

  if (root._shiftState.stores.length === 0) {
    root.querySelector('#card-calendar').style.display = 'block';
    root.querySelector('#cal-grid').innerHTML = '<tr><td class="empty">먼저 매장을 등록해주세요</td></tr>';
    return;
  }

  if (root._shiftState.stores.length === 1) {
    // 단일 매장: 바로 캘린더
    root._shiftState.selectedStoreId = root._shiftState.stores[0].id;
    await loadCalendar(root, profile);
    return;
  }

  // 여러 매장: 선택 화면
  showStorePicker(root);
}

function showStorePicker(root) {
  const state = root._shiftState;
  root.querySelector('#card-store-pick').style.display = 'block';
  root.querySelector('#card-calendar').style.display = 'none';

  const list = root.querySelector('#store-list');
  list.innerHTML = state.stores.map(s => `
    <button class="store-pick-card" data-id="${s.id}">
      <span class="store-icon">🏪</span>
      <strong>${s.name}</strong>
      <span class="muted">→ 캘린더 열기</span>
    </button>
  `).join('');
  list.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.selectedStoreId = btn.dataset.id;
      await loadCalendar(root, root._profile);
    });
  });
}

async function loadCalendar(root, profile) {
  const state = root._shiftState;
  root.querySelector('#card-store-pick').style.display = 'none';
  root.querySelector('#card-calendar').style.display = 'block';

  const showBack = state.stores.length > 1;
  root.querySelector('#btn-back-stores').style.display = showBack ? '' : 'none';

  const store = state.stores.find(s => s.id === state.selectedStoreId);
  root.querySelector('#cal-title').textContent = store
    ? `${store.name} 스케줄`
    : '스케줄';

  // 해당 매장의 활성 직원
  const { data: emps } = await supabase
    .from('profiles')
    .select('id, name, position, store_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'employee')
    .eq('active', true)
    .eq('store_id', state.selectedStoreId)
    .order('name');
  state.employees = emps || [];

  await reloadMonth(root, profile);
}

async function reloadMonth(root, profile) {
  const state = root._shiftState;
  const { start, end } = monthRange(state.cursor);
  root.querySelector('#month-label').textContent =
    `${state.cursor.getFullYear()}년 ${state.cursor.getMonth() + 1}월`;

  let scheds = [];
  try {
    scheds = await listShiftSchedules({
      tenantId: profile.tenant_id,
      storeId: state.selectedStoreId,
      startDate: start, endDate: end,
    });
  } catch (err) {
    if (/shift_schedules/i.test(err.message)) {
      toast('⚠️ shift_schedules 테이블이 없습니다. supabase/migrations/0006_shift_schedules.sql 을 실행해주세요.', 'warn', 8000);
    } else {
      toast(err.message, 'error');
    }
  }

  state.schedules = new Map();
  for (const s of scheds) state.schedules.set(`${s.employee_id}|${s.work_date}`, s);

  renderGrid(root, profile);
}

function renderGrid(root, profile) {
  const state = root._shiftState;
  const grid = root.querySelector('#cal-grid');
  const { days } = monthRange(state.cursor);

  if (!state.employees.length) {
    grid.innerHTML = `<thead><tr><th>이 매장에 활성 직원이 없습니다</th></tr></thead>`;
    return;
  }

  // 헤더: 이름 | 1(일) | 2(월) | ...
  let html = '<thead><tr><th class="emp-col">직원</th>';
  for (const d of days) {
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    html += `<th class="${isWeekend ? 'weekend' : ''}">
      <div class="d-num">${d.getDate()}</div>
      <div class="d-dow">${DOW[dow]}</div>
    </th>`;
  }
  html += '</tr></thead><tbody>';

  // 바디: 직원 행
  for (const emp of state.employees) {
    html += `<tr><td class="emp-col"><strong>${emp.name}</strong>${
      emp.position ? `<div class="muted">${emp.position}</div>` : ''
    }</td>`;
    for (const d of days) {
      const dateStr = d.toISOString().slice(0, 10);
      const sched = state.schedules.get(`${emp.id}|${dateStr}`);
      html += `<td class="cal-cell"
                  data-emp="${emp.id}"
                  data-date="${dateStr}">${cellHtml(sched, state.shiftTypes)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell').forEach(td => {
    td.addEventListener('click', () => openCellPicker(td, root, profile));
  });
}

function cellHtml(sched, shiftTypes) {
  if (!sched) return '<span class="cal-empty">·</span>';
  if (sched.note === 'OFF' && !sched.shift_type_id) {
    return '<span class="cal-off">휴</span>';
  }
  const st = shiftTypes.find(s => s.id === sched.shift_type_id);
  if (!st) return '<span class="cal-empty">?</span>';
  return `<span class="cal-shift" style="background:${st.color}22;color:${st.color};border-color:${st.color}66" title="${st.name} ${st.start_time.slice(0,5)}~${st.end_time.slice(0,5)}">
    ${st.name.slice(0, 2)}
  </span>`;
}

function openCellPicker(td, root, profile) {
  // 기존 팝업 제거
  document.querySelectorAll('.cell-picker').forEach(p => p.remove());

  const state = root._shiftState;
  const empId = td.dataset.emp;
  const dateStr = td.dataset.date;
  const popup = document.createElement('div');
  popup.className = 'cell-picker cal-picker';
  popup.innerHTML = `
    <div class="picker-row" data-action="clear"><span class="muted">기본(요일 패턴)</span></div>
    <div class="picker-row" data-action="off"><span class="cal-off-pill">휴무</span></div>
    ${state.shiftTypes.map(st => `
      <div class="picker-row" data-id="${st.id}">
        <span class="dot" style="background:${st.color}"></span>
        <strong>${st.name}</strong>
        <span class="muted">${st.start_time.slice(0,5)}~${st.end_time.slice(0,5)}</span>
      </div>
    `).join('')}
  `;
  td.appendChild(popup);

  popup.addEventListener('click', async (e) => {
    const row = e.target.closest('.picker-row');
    if (!row) return;
    e.stopPropagation();
    try {
      let saved;
      if (row.dataset.action === 'clear') {
        saved = await upsertShiftSchedule({
          tenantId: profile.tenant_id,
          storeId: state.selectedStoreId,
          employeeId: empId, workDate: dateStr,
          shiftTypeId: null, note: null,
        });
        state.schedules.delete(`${empId}|${dateStr}`);
      } else if (row.dataset.action === 'off') {
        saved = await setOffDay({
          tenantId: profile.tenant_id,
          storeId: state.selectedStoreId,
          employeeId: empId, workDate: dateStr,
        });
        state.schedules.set(`${empId}|${dateStr}`, saved);
      } else {
        saved = await upsertShiftSchedule({
          tenantId: profile.tenant_id,
          storeId: state.selectedStoreId,
          employeeId: empId, workDate: dateStr,
          shiftTypeId: row.dataset.id, note: null,
        });
        state.schedules.set(`${empId}|${dateStr}`, saved);
      }
      td.innerHTML = cellHtml(state.schedules.get(`${empId}|${dateStr}`), state.shiftTypes);
      popup.remove();
    } catch (err) {
      toast(err.message, 'error');
      popup.remove();
    }
  });

  const closeOnOutside = (e) => {
    if (!popup.contains(e.target) && e.target !== td) {
      popup.remove();
      document.removeEventListener('click', closeOnOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside, true), 50);
}

async function moveMonth(root, profile, delta) {
  const state = root._shiftState;
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  await reloadMonth(root, profile);
}

async function copyPrevWeek(root, profile) {
  // 이번 달에서 마지막으로 한 주(7일)가 모두 채워진 주를 찾아 그 다음 주로 복사
  const state = root._shiftState;
  if (!state.schedules.size) {
    toast('복사할 스케줄이 없습니다. 한 주 먼저 채워주세요.', 'warn');
    return;
  }
  const { days } = monthRange(state.cursor);
  // 가장 최근에 1개 이상 배정된 주의 월요일 찾기
  const datesWithData = days.filter(d => {
    const ds = d.toISOString().slice(0, 10);
    return state.employees.some(e => state.schedules.has(`${e.id}|${ds}`));
  });
  if (!datesWithData.length) { toast('이번 달에 스케줄이 없습니다.', 'warn'); return; }
  const lastDate = datesWithData[datesWithData.length - 1];
  const monday = mondayOf(lastDate);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const dstMonday = new Date(monday); dstMonday.setDate(monday.getDate() + 7);

  if (!confirm(`${fmt(monday)} ~ ${fmt(sunday)} 의 스케줄을 ${fmt(dstMonday)} ~ ${fmt(new Date(dstMonday.getFullYear(),dstMonday.getMonth(),dstMonday.getDate()+6))} 로 복사할까요?`)) return;

  try {
    const n = await copyScheduleRange({
      tenantId: profile.tenant_id, storeId: state.selectedStoreId,
      srcStart: fmt(monday), srcEnd: fmt(sunday), dstStart: fmt(dstMonday),
    });
    toast(`${n}건 복사됨`, 'success');
    await reloadMonth(root, profile);
  } catch (err) { toast(err.message, 'error'); }
}

async function copyPrevMonth(root, profile) {
  const state = root._shiftState;
  const prev = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
  const { start: ps, end: pe } = monthRange(prev);
  const { start: cs } = monthRange(state.cursor);
  if (!confirm(`${prev.getFullYear()}년 ${prev.getMonth() + 1}월 스케줄을 이번 달로 복사할까요? (기존 이번 달 스케줄은 덮어쓰여집니다)`)) return;
  try {
    const n = await copyScheduleRange({
      tenantId: profile.tenant_id, storeId: state.selectedStoreId,
      srcStart: ps, srcEnd: pe, dstStart: cs,
    });
    toast(`${n}건 복사됨`, 'success');
    await reloadMonth(root, profile);
  } catch (err) { toast(err.message, 'error'); }
}

async function seedThisMonth(root, profile) {
  const state = root._shiftState;
  if (!confirm('기존 요일 패턴(시프트 관리 구버전)을 이번 달 캘린더에 자동 채울까요?\n(이미 캘린더에 데이터가 있는 직원은 건너뜁니다)')) return;
  try {
    const { start, end } = monthRange(state.cursor);
    const n = await seedFromWeekday({
      tenantId: profile.tenant_id,
      storeId: state.selectedStoreId,
      employees: state.employees,
      monthStart: start, monthEnd: end,
    });
    toast(`${n}건 시드됨`, n > 0 ? 'success' : 'warn');
    await reloadMonth(root, profile);
  } catch (err) { toast(err.message, 'error'); }
}

// ── 유틸 ─────────────────────────────────────────────
function monthRange(cursor) {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const days = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  return { start: fmt(first), end: fmt(last), days };
}

function fmt(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function mondayOf(d) {
  const x = new Date(d);
  const dow = x.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  return x;
}
