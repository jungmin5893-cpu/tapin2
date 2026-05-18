import { supabase } from '../../../lib/supabase.js';
import { nowKst, fmtDate } from '../../../lib/time.js';
import { toast } from '../../../lib/toast.js';

export async function renderAgency({ root, profile }) {
  const today = fmtDate(new Date());

  root.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:22px">
      <div>
        <h1>출역 현황</h1>
        <div class="page-sub">오늘 ${nowKst().format('M월 D일 (dd)')} · 파견 인력 실시간 모니터링</div>
      </div>
      <button class="btn primary" id="btn-download-excel" style="white-space:nowrap;align-self:flex-end">
        ⬇ 출역일보 다운로드 (CSV)
      </button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">오늘 총 출역</div>
        <div class="kpi-val" id="ag-kpi-total">-</div>
        <div class="kpi-foot">현장 파견 인원</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">정상 출근</div>
        <div class="kpi-val" id="ag-kpi-ok">-</div>
        <div class="kpi-foot">QR 인증 완료</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">미출근 (펑크)</div>
        <div class="kpi-val red" id="ag-kpi-absent">-</div>
        <div class="kpi-foot">미확인 인력</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">등록 인력</div>
        <div class="kpi-val gold" id="ag-kpi-registered">-</div>
        <div class="kpi-foot">전체 활성</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>현장별 실시간 모니터링</h2>
        <div class="card-sub">파견처별 출근 현황 · 자동 갱신</div>
      </div>
      <div class="table-wrap">
        <table class="att-table">
          <thead>
            <tr>
              <th>파견 현장명</th>
              <th>근로자 이름</th>
              <th>전화번호</th>
              <th>출근 시간</th>
              <th>QR 인증 상태</th>
            </tr>
          </thead>
          <tbody id="ag-tbody">
            <tr><td colspan="5" class="empty">불러오는 중…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  await loadData(root, profile, today);

  root.querySelector('#btn-download-excel').addEventListener('click', () =>
    downloadCsv(root, profile, today)
  );

  const channel = supabase.channel('agency-att')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'attendances',
      filter: `tenant_id=eq.${profile.tenant_id}`,
    }, () => loadData(root, profile, today))
    .subscribe();
  root._teardown = () => supabase.removeChannel(channel);
}

async function loadData(root, profile, today) {
  const [{ data: employees, error: empErr }, { data: attendances, error: attErr }] = await Promise.all([
    supabase.from('profiles')
      .select('id, name, phone, store_id, stores(name)')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'employee')
      .eq('active', true)
      .order('name'),
    supabase.from('attendances')
      .select('employee_id, check_in_at, check_out_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('workday', today),
  ]);

  if (empErr) { console.error('[agency] employees:', empErr.message); }
  if (attErr) { console.error('[agency] attendances:', attErr.message); }

  const attMap = new Map((attendances || []).map(a => [a.employee_id, a]));
  const emps = employees || [];

  const totalRegistered = emps.length;
  const checkedIn = emps.filter(e => attMap.has(e.id)).length;
  const absent = totalRegistered - checkedIn;

  const kpiTotal = root.querySelector('#ag-kpi-total');
  if (!kpiTotal) return;
  kpiTotal.textContent = checkedIn;
  root.querySelector('#ag-kpi-ok').textContent = checkedIn;
  root.querySelector('#ag-kpi-absent').textContent = absent;
  root.querySelector('#ag-kpi-registered').textContent = totalRegistered;

  const tbody = root.querySelector('#ag-tbody');
  if (!tbody) return;

  if (!emps.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">등록된 인력이 없습니다. 직원 관리에서 먼저 추가하세요.</td></tr>';
    return;
  }

  tbody.innerHTML = emps.map(emp => {
    const att = attMap.get(emp.id);
    const siteName = emp.stores?.name || '파견처 미지정';
    const checkInTime = att?.check_in_at
      ? new Date(att.check_in_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '-';
    const badge = att
      ? `<span class="pill green">출근 완료</span>`
      : `<span class="pill warn">확인 필요</span>`;
    return `<tr>
      <td>${siteName}</td>
      <td>${emp.name || '-'}</td>
      <td>${emp.phone || '-'}</td>
      <td>${checkInTime}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
}

async function downloadCsv(root, profile, today) {
  const btn = root.querySelector('#btn-download-excel');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '준비 중…';

  try {
    const [{ data: employees }, { data: attendances }] = await Promise.all([
      supabase.from('profiles')
        .select('id, name, phone, store_id, stores(name)')
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'employee')
        .eq('active', true)
        .order('name'),
      supabase.from('attendances')
        .select('employee_id, check_in_at, check_out_at')
        .eq('tenant_id', profile.tenant_id)
        .eq('workday', today),
    ]);

    const attMap = new Map((attendances || []).map(a => [a.employee_id, a]));

    const header = ['날짜', '파견 현장명', '근로자 이름', '전화번호', '출근 시간', '퇴근 시간', '상태'];
    const rows = (employees || []).map(emp => {
      const att = attMap.get(emp.id);
      return [
        today,
        emp.stores?.name || '미지정',
        emp.name || '',
        emp.phone || '',
        att?.check_in_at
          ? new Date(att.check_in_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          : '-',
        att?.check_out_at
          ? new Date(att.check_out_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          : '-',
        att ? '출근 완료' : '미출근',
      ];
    });

    const bom = '﻿'; // Excel UTF-8 BOM
    const csv = bom + [header, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `출역일보_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast('출역일보가 다운로드됐습니다. Excel에서 바로 열 수 있습니다.', 'success', 4000);
  } catch (err) {
    toast('다운로드 실패: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}
