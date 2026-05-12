import { supabase } from './supabase.js';

export async function listShiftTypes(tenantId) {
  const { data, error } = await supabase
    .from('shift_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('start_time');
  if (error) throw error;
  return data;
}

export async function upsertShiftType(row) {
  const { data, error } = await supabase
    .from('shift_types')
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteShiftType(id) {
  const { error } = await supabase.from('shift_types').delete().eq('id', id);
  if (error) throw error;
}

// 직원의 요일별 시프트 할당 조회 (현재 유효한 것만)
export async function getEmployeeShiftAssignments(employeeId, asOf = new Date()) {
  const date = asOf.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('employee_shifts')
    .select('id, weekday, effective_from, effective_to, shift:shift_types(id, name, start_time, end_time, is_overnight, color, break_minutes)')
    .eq('employee_id', employeeId)
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  // 같은 요일에 여러 행이면 가장 최근 effective_from만 사용
  const seen = new Set();
  const result = [];
  for (const row of data) {
    if (seen.has(row.weekday)) continue;
    seen.add(row.weekday);
    result.push(row);
  }
  return result;
}

// 매장의 모든 직원 + 요일별 시프트 그리드 (사장 대시보드용)
export async function getStoreShiftGrid(storeId, asOf = new Date()) {
  const date = asOf.toISOString().slice(0, 10);
  const { data: employees, error: e1 } = await supabase
    .from('profiles')
    .select('id, name, position')
    .eq('store_id', storeId)
    .eq('role', 'employee')
    .eq('active', true)
    .order('name');
  if (e1) throw e1;

  if (!employees.length) return { employees: [], grid: {} };

  const { data: shifts, error: e2 } = await supabase
    .from('employee_shifts')
    .select('id, employee_id, weekday, shift:shift_types(id, name, start_time, end_time, color, is_overnight)')
    .in('employee_id', employees.map(e => e.id))
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`);
  if (e2) throw e2;

  const grid = {};
  for (const emp of employees) grid[emp.id] = {};
  for (const row of shifts) {
    // 같은 직원·요일에 여러 행이면 최신 effective_from 우선 (이미 위에서 정렬되지 않았으니 그대로 덮어쓰기)
    grid[row.employee_id][row.weekday] = row;
  }
  return { employees, grid };
}

// 시프트 할당 변경: effective_from/to 트랜잭션
// 단순화 — 같은 (employee, weekday)의 기존 무기한 row의 effective_to를 어제로 닫고 새 row insert
export async function setShiftAssignment({ tenantId, employeeId, weekday, shiftTypeId }) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // 1. 기존 유효 행 닫기
  await supabase
    .from('employee_shifts')
    .update({ effective_to: yesterday })
    .eq('employee_id', employeeId)
    .eq('weekday', weekday)
    .is('effective_to', null);

  // 2. 새 행 insert
  const { data, error } = await supabase
    .from('employee_shifts')
    .insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      weekday,
      shift_type_id: shiftTypeId || null,
      effective_from: today,
    })
    .select('id, weekday, shift:shift_types(id, name, start_time, end_time, color, is_overnight)')
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// 📅 날짜별 시프트 스케줄 (캘린더형) — shift_schedules 테이블
// ============================================================

// 매장(또는 전체)의 기간 스케줄 조회
export async function listShiftSchedules({ tenantId, storeId, startDate, endDate }) {
  let q = supabase
    .from('shift_schedules')
    .select('id, employee_id, work_date, shift_type_id, store_id, note')
    .eq('tenant_id', tenantId)
    .gte('work_date', startDate)
    .lte('work_date', endDate);
  if (storeId) q = q.eq('store_id', storeId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// 단일 직원의 기간 스케줄 조회 (급여 모달용)
export async function listEmployeeSchedules({ employeeId, startDate, endDate }) {
  const { data, error } = await supabase
    .from('shift_schedules')
    .select('id, work_date, shift_type_id, shift:shift_types(id, name, start_time, end_time, color, is_overnight)')
    .eq('employee_id', employeeId)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .order('work_date');
  if (error) throw error;
  return data || [];
}

// 셀 한 칸 저장 (upsert by employee_id+work_date)
// shiftTypeId=null이면 휴무 표시 (휴무 row를 명시 저장해서 요일 폴백을 무시)
export async function upsertShiftSchedule({ tenantId, storeId, employeeId, workDate, shiftTypeId, note = null }) {
  // shift_type_id=null이면서 note도 없으면 row 삭제 (= 폴백으로 돌아감)
  if (shiftTypeId === null && !note) {
    const { error } = await supabase
      .from('shift_schedules')
      .delete()
      .eq('employee_id', employeeId)
      .eq('work_date', workDate);
    if (error) throw error;
    return null;
  }
  const row = {
    tenant_id: tenantId,
    store_id: storeId || null,
    employee_id: employeeId,
    work_date: workDate,
    shift_type_id: shiftTypeId,
    note,
  };
  const { data, error } = await supabase
    .from('shift_schedules')
    .upsert(row, { onConflict: 'employee_id,work_date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// "휴무"를 명시 (shiftTypeId=null + note='OFF')
export async function setOffDay({ tenantId, storeId, employeeId, workDate }) {
  return upsertShiftSchedule({
    tenantId, storeId, employeeId, workDate,
    shiftTypeId: null, note: 'OFF',
  });
}

// 기간 복사 RPC (이전 주 → 다음 주, 전월 → 이번 달 등)
export async function copyScheduleRange({ tenantId, storeId, srcStart, srcEnd, dstStart, replace = true }) {
  const { data, error } = await supabase.rpc('copy_schedules_range', {
    p_tenant: tenantId,
    p_store: storeId || null,
    p_src_start: srcStart,
    p_src_end: srcEnd,
    p_dst_start: dstStart,
    p_replace: replace,
  });
  if (error) throw error;
  return data; // 복사된 row 수
}

// 기존 요일 패턴(employee_shifts)을 특정 월의 shift_schedules로 시드
// 해당 월에 스케줄이 전혀 없는 직원에 한해서만 채워넣음
export async function seedFromWeekday({ tenantId, storeId, employees, monthStart, monthEnd }) {
  if (!employees?.length) return 0;
  const empIds = employees.map(e => e.id);

  // 기존 요일 패턴
  const { data: wkPatterns, error: e1 } = await supabase
    .from('employee_shifts')
    .select('employee_id, weekday, shift_type_id, effective_from, effective_to')
    .in('employee_id', empIds);
  if (e1) throw e1;
  if (!wkPatterns?.length) return 0;

  // 이미 해당 기간에 스케줄이 있는 직원은 스킵
  const { data: existing, error: e2 } = await supabase
    .from('shift_schedules')
    .select('employee_id')
    .eq('tenant_id', tenantId)
    .gte('work_date', monthStart)
    .lte('work_date', monthEnd);
  if (e2) throw e2;
  const skipSet = new Set((existing || []).map(r => r.employee_id));

  // 직원→매장 매핑
  const empStore = new Map(employees.map(e => [e.id, e.store_id]));

  const rows = [];
  const start = new Date(monthStart);
  const end = new Date(monthEnd);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const dateStr = d.toISOString().slice(0, 10);
    for (const p of wkPatterns) {
      if (skipSet.has(p.employee_id)) continue;
      if (p.weekday !== dow) continue;
      if (p.effective_from && dateStr < p.effective_from) continue;
      if (p.effective_to && dateStr > p.effective_to) continue;
      if (!p.shift_type_id) continue;
      rows.push({
        tenant_id: tenantId,
        store_id: empStore.get(p.employee_id) || storeId || null,
        employee_id: p.employee_id,
        work_date: dateStr,
        shift_type_id: p.shift_type_id,
      });
    }
  }
  if (!rows.length) return 0;
  const { error } = await supabase
    .from('shift_schedules')
    .upsert(rows, { onConflict: 'employee_id,work_date' });
  if (error) throw error;
  return rows.length;
}

