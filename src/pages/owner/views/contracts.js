import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { getLabels } from '../../../lib/labels.js';

const WAGE_META = {
  hourly:  { label: '시급', unit: '원/시간' },
  daily:   { label: '일급', unit: '원/일' },
  monthly: { label: '월급', unit: '원/월' },
};

const CONTRACT_TYPE_LABEL = {
  regular:  '정규직 (기간 정함 없음)',
  fixed:    '계약직 (기간제)',
  parttime: '단시간 근로자',
};

export async function renderContracts({ root, profile }) {
  const labels = getLabels(profile.tenants?.industry_type);

  root.innerHTML = `
    <div class="page-head">
      <h1>전자근로계약서</h1>
      <div class="page-sub">근로기준법 제17조 기준 · 전자문서 형식으로 작성 후 직원이 앱에서 서명</div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>계약서 목록</h2>
        <button class="btn primary" id="btn-new-contract">+ 새 계약서 작성</button>
      </div>
      <div class="filter-bar" style="padding:12px 20px 0">
        <select id="filter-emp" style="min-width:140px">
          <option value="">전체 직원</option>
        </select>
        <select id="filter-status" style="min-width:120px">
          <option value="">전체 상태</option>
          <option value="draft">초안</option>
          <option value="sent">서명 대기</option>
          <option value="completed">완료</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="att-table">
          <thead>
            <tr>
              <th>직원</th><th>계약 유형</th><th>계약 기간</th>
              <th>임금</th><th>상태</th><th>작성일</th><th></th>
            </tr>
          </thead>
          <tbody id="contracts-rows"></tbody>
        </table>
      </div>
    </div>

    <!-- 계약서 작성/편집 모달 -->
    <div id="contract-modal" style="display:none;position:fixed;inset:0;background:rgba(15,27,45,.7);z-index:9000;overflow-y:auto;padding:20px;">
      <div style="background:#fff;border-radius:14px;max-width:760px;margin:0 auto;padding:0 0 40px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 28px;border-bottom:1px solid #e2e7ef;">
          <h2 style="font-size:18px;font-weight:800" id="modal-title">근로계약서 작성</h2>
          <button id="modal-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8a94a6">✕</button>
        </div>
        <div style="padding:24px 28px" id="modal-body"></div>
      </div>
    </div>

    <!-- 계약서 미리보기 모달 -->
    <div id="preview-modal" style="display:none;position:fixed;inset:0;background:rgba(15,27,45,.7);z-index:9100;overflow-y:auto;padding:20px;">
      <div style="background:#fff;border-radius:14px;max-width:760px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 28px;border-bottom:1px solid #e2e7ef;">
          <h2 style="font-size:18px;font-weight:800">근로계약서 확인</h2>
          <div style="display:flex;gap:8px">
            <button id="btn-print" class="btn ghost">🖨️ 출력</button>
            <button id="preview-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8a94a6">✕</button>
          </div>
        </div>
        <div style="padding:24px 28px" id="preview-body"></div>
      </div>
    </div>
  `;

  await loadEmployeeFilter(root, profile);
  await loadContracts(root, profile);

  root.querySelector('#btn-new-contract').addEventListener('click', () => openContractModal(root, profile, null));
  root.querySelector('#modal-close').addEventListener('click', () => closeContractModal(root));
  root.querySelector('#preview-close').addEventListener('click', () => { root.querySelector('#preview-modal').style.display = 'none'; });
  root.querySelector('#btn-print').addEventListener('click', () => window.print());

  root.querySelector('#filter-emp').addEventListener('change', () => loadContracts(root, profile));
  root.querySelector('#filter-status').addEventListener('change', () => loadContracts(root, profile));

  root.querySelector('#contract-modal').addEventListener('click', e => {
    if (e.target === root.querySelector('#contract-modal')) closeContractModal(root);
  });
}

async function loadEmployeeFilter(root, profile) {
  const { data } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['employee', 'manager'])
    .order('name');
  const sel = root.querySelector('#filter-emp');
  for (const e of (data || [])) {
    sel.innerHTML += `<option value="${e.id}">${e.name}</option>`;
  }
}

async function loadContracts(root, profile) {
  const empId    = root.querySelector('#filter-emp').value;
  const statusV  = root.querySelector('#filter-status').value;

  let q = supabase
    .from('labor_contracts')
    .select('id, contract_type, start_date, end_date, wage_type, wage_amount, status, created_at, employee:profiles!labor_contracts_employee_id_fkey(id,name)')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (empId)   q = q.eq('employee_id', empId);
  if (statusV) q = q.eq('status', statusV);

  const { data, error } = await q;
  const tbody = root.querySelector('#contracts-rows');
  if (!tbody) return;

  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="empty">에러: ${error.message}</td></tr>`; return; }
  if (!data?.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">작성된 계약서가 없습니다</td></tr>'; return; }

  tbody.innerHTML = data.map(r => {
    const wm = WAGE_META[r.wage_type] || WAGE_META.hourly;
    const period = r.end_date
      ? `${r.start_date} ~ ${r.end_date}`
      : `${r.start_date} ~ 기간 정함 없음`;
    const statusBadge = {
      draft:     '<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">초안</span>',
      sent:      '<span style="background:#fef3c7;color:#d97706;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">서명 대기</span>',
      completed: '<span style="background:#d1fae5;color:#059669;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">완료</span>',
    }[r.status] || r.status;

    return `<tr>
      <td><strong>${r.employee?.name || '-'}</strong></td>
      <td style="font-size:12px">${CONTRACT_TYPE_LABEL[r.contract_type] || r.contract_type}</td>
      <td style="font-size:12px">${period}</td>
      <td style="font-size:12px">${Number(r.wage_amount).toLocaleString()}원 (${wm.label})</td>
      <td>${statusBadge}</td>
      <td style="font-size:12px">${r.created_at.slice(0,10)}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn small ghost" data-preview="${r.id}">보기</button>
          ${r.status === 'draft' ? `<button class="btn small ghost" data-edit="${r.id}">수정</button>` : ''}
          ${r.status === 'draft' ? `<button class="btn small primary" data-send="${r.id}">발송</button>` : ''}
          ${r.status === 'sent'  ? `<button class="btn small ghost" data-recall="${r.id}">회수</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  // 이벤트 바인딩
  tbody.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => previewContract(root, profile, b.dataset.preview)));
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const { data: c } = await supabase.from('labor_contracts').select('*').eq('id', b.dataset.edit).single();
    if (c) openContractModal(root, profile, c);
  }));
  tbody.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('계약서를 직원에게 발송하면 직원 앱에 서명 요청이 표시됩니다.\n발송하시겠습니까?')) return;
    const { error } = await supabase.from('labor_contracts').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', b.dataset.send);
    if (error) toast(error.message, 'error');
    else { toast('계약서가 발송됐습니다. 직원이 앱에서 서명할 수 있습니다.', 'success', 4000); await loadContracts(root, profile); }
  }));
  tbody.querySelectorAll('[data-recall]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('계약서를 회수하면 직원이 서명할 수 없게 됩니다.')) return;
    const { error } = await supabase.from('labor_contracts').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', b.dataset.recall);
    if (error) toast(error.message, 'error');
    else { toast('계약서를 회수했습니다.', 'success'); await loadContracts(root, profile); }
  }));
}

async function openContractModal(root, profile, contract) {
  // 직원 목록 로드
  const { data: emps } = await supabase
    .from('profiles')
    .select('id, name, phone, hourly_wage, wage_type, deduction_type, store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['employee', 'manager'])
    .order('name');

  const empOpts = (emps || []).map(e =>
    `<option value="${e.id}" data-wage="${e.hourly_wage||0}" data-wtype="${e.wage_type||'hourly'}" data-ded="${e.deduction_type||'insurance'}" data-store="${e.store?.name||''}"
      ${contract?.employee_id === e.id ? 'selected' : ''}>${e.name}</option>`
  ).join('');

  const c = contract || {};
  const title = c.id ? '근로계약서 수정' : '근로계약서 작성';
  root.querySelector('#modal-title').textContent = title;

  root.querySelector('#modal-body').innerHTML = `
    <form id="contract-form">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

        <div class="form-group" style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">직원 선택 *</label>
          <select id="cf-emp" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit" required>
            <option value="">직원을 선택하세요</option>
            ${empOpts}
          </select>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">계약 유형 *</label>
          <select id="cf-type" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
            <option value="regular"  ${(c.contract_type||'regular')==='regular'  ?'selected':''}>정규직 (기간 정함 없음)</option>
            <option value="fixed"    ${c.contract_type==='fixed'    ?'selected':''}>계약직 (기간제)</option>
            <option value="parttime" ${c.contract_type==='parttime' ?'selected':''}>단시간 근로자</option>
          </select>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">계약 시작일 *</label>
          <input type="date" id="cf-start" value="${c.start_date||''}" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit" required>
        </div>

        <div id="cf-end-wrap">
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">계약 종료일 <span style="color:#8a94a6;font-weight:400">(계약직만)</span></label>
          <input type="date" id="cf-end" value="${c.end_date||''}" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">취업 장소 *</label>
          <input type="text" id="cf-location" value="${c.work_location||''}" placeholder="예: 서울시 강남구 ○○빌딩 3층" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit" required>
        </div>

        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">담당 업무 *</label>
          <input type="text" id="cf-job" value="${c.job_description||''}" placeholder="예: 청소·시설 관리 업무" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit" required>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">소정근로일 *</label>
          <input type="text" id="cf-days" value="${c.work_days||'월,화,수,목,금'}" placeholder="월,화,수,목,금" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">주간 소정근로시간</label>
          <input type="number" id="cf-weekly" value="${c.weekly_hours||40}" min="1" max="52" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">출근 시간</label>
          <input type="time" id="cf-dstart" value="${c.daily_start||'09:00'}" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">퇴근 시간</label>
          <input type="time" id="cf-dend" value="${c.daily_end||'18:00'}" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">휴게시간 (분)</label>
          <input type="number" id="cf-break" value="${c.break_minutes||60}" min="0" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">임금 종류</label>
          <select id="cf-wtype" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
            <option value="hourly"  ${(c.wage_type||'hourly')==='hourly'  ?'selected':''}>시급</option>
            <option value="daily"   ${c.wage_type==='daily'   ?'selected':''}>일급</option>
            <option value="monthly" ${c.wage_type==='monthly' ?'selected':''}>월급</option>
          </select>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">임금 금액 (원)</label>
          <input type="number" id="cf-wage" value="${c.wage_amount||0}" min="0" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">임금 지급일</label>
          <input type="number" id="cf-payday" value="${c.pay_day||10}" min="1" max="31" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
          <span style="font-size:11px;color:#8a94a6">매월 N일</span>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">임금 지급 방법</label>
          <select id="cf-paymethod" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
            <option value="계좌이체" ${(c.pay_method||'계좌이체')==='계좌이체'?'selected':''}>계좌이체</option>
            <option value="현금" ${c.pay_method==='현금'?'selected':''}>현금</option>
          </select>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">공제 유형</label>
          <select id="cf-ded" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
            <option value="insurance"  ${(c.deduction_type||'insurance')==='insurance'  ?'selected':''}>4대보험 (~9.4%)</option>
            <option value="freelancer" ${c.deduction_type==='freelancer' ?'selected':''}>프리랜서 3.3%</option>
            <option value="none"       ${c.deduction_type==='none'       ?'selected':''}>공제 없음</option>
          </select>
        </div>

        <div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">연차유급휴가 (일)</label>
          <input type="number" id="cf-leave" value="${c.annual_leave_days||15}" min="0" style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>

      </div>

      <div style="border-top:1px solid #e2e7ef;margin-top:24px;padding-top:20px">
        <p style="font-size:12px;color:#8a94a6;margin-bottom:16px">
          ※ 사장 서명란: 저장 후 "발송" 버튼을 누르면 사장님 서명이 완료된 것으로 처리됩니다.<br>
          ※ 직원 서명: 직원이 앱에서 계약서를 확인하고 서명합니다.
        </p>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button type="button" id="btn-modal-cancel" class="btn ghost">취소</button>
          <button type="submit" class="btn primary" id="btn-modal-save">저장</button>
        </div>
      </div>
    </form>
  `;

  // 직원 선택 시 임금 자동 채우기
  const cfEmp = root.querySelector('#cf-emp');
  cfEmp.addEventListener('change', () => {
    const opt = cfEmp.selectedOptions[0];
    if (!opt || !opt.value) return;
    const wage  = opt.dataset.wage;
    const wtype = opt.dataset.wtype;
    const ded   = opt.dataset.ded;
    const store = opt.dataset.store;
    if (wage)  root.querySelector('#cf-wage').value  = wage;
    if (wtype) root.querySelector('#cf-wtype').value = wtype;
    if (ded)   root.querySelector('#cf-ded').value   = ded;
    if (store) root.querySelector('#cf-location').value = store;
  });

  root.querySelector('#btn-modal-cancel').addEventListener('click', () => closeContractModal(root));
  root.querySelector('#contract-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveContract(root, profile, c.id || null);
  });

  root.querySelector('#contract-modal').style.display = 'block';
}

function closeContractModal(root) {
  root.querySelector('#contract-modal').style.display = 'none';
}

async function saveContract(root, profile, id) {
  const btn = root.querySelector('#btn-modal-save');
  btn.disabled = true;
  btn.textContent = '저장 중…';

  const empId = root.querySelector('#cf-emp').value;
  if (!empId) { toast('직원을 선택해주세요', 'error'); btn.disabled = false; btn.textContent = '저장'; return; }

  const payload = {
    tenant_id:        profile.tenant_id,
    employee_id:      empId,
    contract_type:    root.querySelector('#cf-type').value,
    start_date:       root.querySelector('#cf-start').value,
    end_date:         root.querySelector('#cf-end').value || null,
    work_location:    root.querySelector('#cf-location').value,
    job_description:  root.querySelector('#cf-job').value,
    work_days:        root.querySelector('#cf-days').value,
    weekly_hours:     +root.querySelector('#cf-weekly').value,
    daily_start:      root.querySelector('#cf-dstart').value,
    daily_end:        root.querySelector('#cf-dend').value,
    break_minutes:    +root.querySelector('#cf-break').value,
    wage_type:        root.querySelector('#cf-wtype').value,
    wage_amount:      +root.querySelector('#cf-wage').value,
    pay_day:          +root.querySelector('#cf-payday').value,
    pay_method:       root.querySelector('#cf-paymethod').value,
    deduction_type:   root.querySelector('#cf-ded').value,
    annual_leave_days:+root.querySelector('#cf-leave').value,
    owner_name:       profile.name,
    updated_at:       new Date().toISOString(),
  };

  let error;
  if (id) {
    ({ error } = await supabase.from('labor_contracts').update(payload).eq('id', id));
  } else {
    ({ error } = await supabase.from('labor_contracts').insert(payload));
  }

  btn.disabled = false;
  btn.textContent = '저장';

  if (error) { toast(error.message, 'error'); return; }
  toast('계약서가 저장됐습니다', 'success');
  closeContractModal(root);
  await loadContracts(root, profile);
}

async function previewContract(root, profile, id) {
  const { data: c, error } = await supabase
    .from('labor_contracts')
    .select('*, employee:profiles!labor_contracts_employee_id_fkey(name, phone)')
    .eq('id', id)
    .single();
  if (error || !c) { toast('계약서를 불러올 수 없습니다', 'error'); return; }

  const biz = profile.tenants?.name || '사업장';
  const wm = WAGE_META[c.wage_type] || WAGE_META.hourly;
  const dedLabel = { insurance: '4대보험 (~9.4%)', freelancer: '프리랜서 3.3%', none: '공제 없음' }[c.deduction_type] || c.deduction_type;
  const periodText = c.end_date ? `${c.start_date} ~ ${c.end_date}` : `${c.start_date}부터 (기간 정함 없음)`;

  root.querySelector('#preview-body').innerHTML = `
    <div id="printable-contract" style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;color:#0f1b2d">
      <h2 style="text-align:center;font-size:22px;font-weight:900;margin-bottom:6px;letter-spacing:2px">근 로 계 약 서</h2>
      <p style="text-align:center;font-size:13px;color:#64748b;margin-bottom:28px">(근로기준법 제17조)</p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
        ${row2('사업장명', biz, '사용자(대표)', profile.name || '-')}
        ${row2('근로자명', c.employee?.name || '-', '전화번호', c.employee?.phone || '-')}
        ${row2('계약 기간', periodText, '계약 유형', CONTRACT_TYPE_LABEL[c.contract_type] || c.contract_type)}
        ${row2('취업 장소', c.work_location, '담당 업무', c.job_description)}
        ${row2('소정근로일', c.work_days, '소정근로시간', `주 ${c.weekly_hours}시간`)}
        ${row2('출퇴근 시간', `${c.daily_start} ~ ${c.daily_end}`, '휴게시간', `${c.break_minutes}분`)}
        ${row2('임금 종류', wm.label, '임금 금액', `${Number(c.wage_amount).toLocaleString()}원 (${wm.unit})`)}
        ${row2('임금 지급일', `매월 ${c.pay_day}일`, '지급 방법', c.pay_method)}
        ${row2('공제 방식', dedLabel, '연차유급휴가', `${c.annual_leave_days}일`)}
      </table>

      <p style="font-size:13px;color:#374151;line-height:1.9;padding:14px;background:#f8fafc;border-radius:8px;margin-bottom:24px">
        사용자와 근로자는 위와 같은 근로조건을 확인하며, 이를 성실히 이행할 것에 동의합니다.<br>
        본 계약서는 근로기준법 제17조에 의거 전자문서 형식으로 작성되었으며, 전자문서 및 전자거래 기본법에 따라 법적 효력을 가집니다.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px">
        <div style="border:1.5px solid #e2e7ef;border-radius:10px;padding:16px 20px">
          <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:10px">사용자 서명</div>
          <div style="font-size:15px;font-weight:800;margin-bottom:6px">${profile.name || '-'} (인)</div>
          <div style="font-size:12px;color:#64748b">서명일: ${c.owner_signed_at ? new Date(c.owner_signed_at).toLocaleDateString('ko-KR') : '미서명'}</div>
          ${c.status === 'draft' ? `<div style="margin-top:10px"><button class="btn small primary" id="btn-owner-sign" data-id="${c.id}">서명 완료</button></div>` : ''}
        </div>
        <div style="border:1.5px solid #e2e7ef;border-radius:10px;padding:16px 20px">
          <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:10px">근로자 서명</div>
          <div style="font-size:15px;font-weight:800;margin-bottom:6px">${c.employee?.name || '-'} (인)</div>
          <div style="font-size:12px;color:#64748b">서명일: ${c.employee_signed_at ? new Date(c.employee_signed_at).toLocaleDateString('ko-KR') : '미서명'}</div>
        </div>
      </div>

      <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:24px">작성일: ${c.created_at.slice(0,10)} · TAGIN 전자근로계약서</p>
    </div>
  `;

  root.querySelector('#preview-modal').style.display = 'block';

  // 사장 서명 버튼
  const signBtn = root.querySelector('#btn-owner-sign');
  if (signBtn) {
    signBtn.addEventListener('click', async () => {
      signBtn.disabled = true;
      const now = new Date().toISOString();
      const { error } = await supabase.from('labor_contracts')
        .update({ owner_signed_at: now, owner_name: profile.name, updated_at: now })
        .eq('id', signBtn.dataset.id);
      if (error) { toast(error.message, 'error'); signBtn.disabled = false; return; }
      toast('서명이 완료됐습니다. 이제 "발송" 버튼으로 직원에게 전송하세요.', 'success', 4000);
      root.querySelector('#preview-modal').style.display = 'none';
      await loadContracts(root, profile);
    });
  }
}

function row2(l1, v1, l2, v2) {
  const cell = (l, v) => `
    <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e7ef;font-size:12px;font-weight:700;color:#64748b;white-space:nowrap;width:100px">${l}</td>
    <td style="padding:10px 12px;border:1px solid #e2e7ef;font-size:13px">${v}</td>`;
  return `<tr>${cell(l1,v1)}${cell(l2,v2)}</tr>`;
}
