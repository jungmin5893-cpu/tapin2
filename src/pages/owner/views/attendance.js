import { supabase } from '../../../lib/supabase.js';
import { nowKst, kst, fmtDate, minutesToHm, diffMinutes } from '../../../lib/time.js';
import { toast } from '../../../lib/toast.js';
import * as XLSX from 'xlsx';
import { getLabels } from '../../../lib/labels.js';

export async function renderAttendance({ root, profile }) {
  const labels = getLabels(profile.tenants?.industry_type);
  const monthStart = nowKst().startOf('month').format('YYYY-MM-DD');
  const monthEnd = nowKst().endOf('month').format('YYYY-MM-DD');

  root.innerHTML = `
    <div class="page-head">
      <h1>근태 관리</h1>
      <div class="page-sub">월별 출퇴근 기록과 엑셀 내보내기</div>
    </div>
    <div class="filter-bar">
      <input type="month" id="att-month" value="${nowKst().format('YYYY-MM')}">
      <select id="att-employee"><option value="">전체 ${labels.worker}</option></select>
      <select id="att-store"><option value="">전체 ${labels.site}</option></select>
      <button class="btn primary" id="btn-refresh">조회</button>
      <button class="btn" id="btn-export">엑셀 다운로드</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>날짜</th><th>이름</th><th>${labels.site}</th><th>시프트</th><th>출근</th><th>퇴근</th><th>근무</th><th>메모</th></tr></thead>
          <tbody id="att-rows"><tr><td colspan="8" class="empty">조회를 눌러주세요</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  await loadFilters(root, profile);
  await loadRows(root, profile, monthStart, monthEnd);

  root.querySelector('#btn-refresh').addEventListener('click', () => {
    const m = root.querySelector('#att-month').value;
    const start = `${m}-01`;
    const end = nowKst().year(+m.split('-')[0]).month(+m.split('-')[1] - 1).endOf('month').format('YYYY-MM-DD');
    loadRows(root, profile, start, end);
  });
  root.querySelector('#btn-export').addEventListener('click', () => exportExcel(root, labels));

  // ── 실시간 구독: 직원 출퇴근 시 자동 갱신 ──────────────
  const channel = supabase.channel('owner-att-realtime')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'attendances',
      filter: `tenant_id=eq.${profile.tenant_id}`,
    }, () => {
      const m = root.querySelector('#att-month')?.value || nowKst().format('YYYY-MM');
      const start = `${m}-01`;
      const end = nowKst().year(+m.split('-')[0]).month(+m.split('-')[1] - 1).endOf('month').format('YYYY-MM-DD');
      loadRows(root, profile, start, end);
    })
    .subscribe();
  root._teardown = () => supabase.removeChannel(channel);
}

async function loadFilters(root, profile) {
  const [{ data: emps }, { data: stores }] = await Promise.all([
    supabase.from('profiles').select('id, name').eq('tenant_id', profile.tenant_id).eq('role', 'employee').order('name'),
    supabase.from('stores').select('id, name').eq('tenant_id', profile.tenant_id).order('name'),
  ]);
  const eSel = root.querySelector('#att-employee');
  for (const e of emps || []) eSel.innerHTML += `<option value="${e.id}">${e.name}</option>`;
  const sSel = root.querySelector('#att-store');
  for (const s of stores || []) sSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
}

async function loadRows(root, profile, start, end) {
  const empFilter = root.querySelector('#att-employee').value;
  const storeFilter = root.querySelector('#att-store').value;
  let q = supabase
    .from('attendances')
    .select('id, check_in_at, check_out_at, workday, note, employee:profiles!attendances_employee_id_fkey(name), store:stores(name), shift:shift_types(name, color)')
    .eq('tenant_id', profile.tenant_id)
    .gte('workday', start)
    .lte('workday', end)
    .order('workday', { ascending: false })
    .order('check_in_at', { ascending: false });
  if (empFilter) q = q.eq('employee_id', empFilter);
  if (storeFilter) q = q.eq('store_id', storeFilter);
  const { data, error } = await q;
  const tbody = root.querySelector('#att-rows');
  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="empty">에러: ${error.message}</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">기록이 없습니다</td></tr>'; return; }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${r.workday}</td>
      <td><strong>${r.employee?.name || '?'}</strong></td>
      <td>${r.store?.name || '-'}</td>
      <td>${r.shift ? `<span class="pill" style="background:${r.shift.color}20;color:${r.shift.color}">${r.shift.name}</span>` : '-'}</td>
      <td>${kst(r.check_in_at).format('HH:mm')}</td>
      <td>${r.check_out_at ? kst(r.check_out_at).format('HH:mm') : '<span class="pill green">근무중</span>'}</td>
      <td>${r.check_out_at ? minutesToHm(diffMinutes(r.check_in_at, r.check_out_at)) : '—'}</td>
      <td>${r.note || ''}</td>
    </tr>
  `).join('');
  root._attRows = data;
}

function exportExcel(root, labels = { site: '현장' }) {
  const rows = root._attRows;
  if (!rows || !rows.length) { toast('내보낼 데이터가 없습니다', 'warn'); return; }
  const aoa = [['근무일', '이름', labels.site, '시프트', '출근', '퇴근', '근무시간(분)', '메모']];
  for (const r of rows) {
    aoa.push([
      r.workday,
      r.employee?.name || '',
      r.store?.name || '',
      r.shift?.name || '',
      kst(r.check_in_at).format('YYYY-MM-DD HH:mm'),
      r.check_out_at ? kst(r.check_out_at).format('YYYY-MM-DD HH:mm') : '',
      r.check_out_at ? diffMinutes(r.check_in_at, r.check_out_at) : '',
      r.note || '',
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, '근태');
  const month = root.querySelector('#att-month').value;
  XLSX.writeFile(wb, `TAGIN_근태_${month}.xlsx`);
  toast('엑셀 다운로드 완료', 'success');
}
