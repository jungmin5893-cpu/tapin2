import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const WAGE_META = {
  hourly:  { label: '시급', unit: '원/시간' },
  daily:   { label: '일급', unit: '원/일' },
  monthly: { label: '월급', unit: '원/월' },
};

const CONTRACT_TYPES = {
  regular:      { label: '정규직 (기간 정함 없음)',          wageLock: null,    dedLock: null       },
  fixed:        { label: '계약직 (기간제)',                  wageLock: null,    dedLock: null       },
  parttime:     { label: '단시간 근로자 (알바)',              wageLock: null,    dedLock: null       },
  daily_worker: { label: '일용근로자',                       wageLock: 'daily', dedLock: null       },
  freelance:    { label: '3.3% 프리랜서 (도급계약)',          wageLock: null,    dedLock: 'freelancer'},
  construction: { label: '건설일용근로자 (안전서약 포함)',    wageLock: 'daily', dedLock: null       },
};

// 계약 유형별 폼 표시 설정
const FORM_CFG = {
  regular:      { schedule: true,  leave: true,  project: false, safety: false, endReq: false },
  fixed:        { schedule: true,  leave: true,  project: false, safety: false, endReq: true  },
  parttime:     { schedule: true,  leave: true,  project: false, safety: false, endReq: false },
  daily_worker: { schedule: false, leave: false, project: false, safety: false, endReq: false },
  freelance:    { schedule: false, leave: false, project: false, safety: false, endReq: false },
  construction: { schedule: false, leave: false, project: true,  safety: true,  endReq: false },
};

const DED_LABEL = {
  insurance:   '4대보험 (~9.4%)',
  freelancer:  '프리랜서 3.3% 원천징수',
  daily_ins:   '일용직 고용보험',
  none:        '공제 없음',
};

// ── 메인 렌더 ─────────────────────────────────────────────────────────────────
export async function renderContracts({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>전자계약서</h1>
      <div class="page-sub">근로기준법 제17조 기준 · 업종별 전용 양식 · 직원 앱에서 전자서명</div>
    </div>

    <div class="card">
      <div class="card-head" style="flex-direction:row;justify-content:space-between;align-items:center">
        <div><h2>계약서 목록</h2></div>
        <button class="btn primary" id="btn-new-contract">+ 새 계약서 작성</button>
      </div>
      <div class="filter-bar" style="padding:12px 20px 0">
        <select id="filter-emp" style="min-width:140px">
          <option value="">전체 직원</option>
        </select>
        <select id="filter-type" style="min-width:160px">
          <option value="">전체 유형</option>
          ${Object.entries(CONTRACT_TYPES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
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

    <!-- 작성/편집 모달 -->
    <div id="contract-modal" style="display:none;position:fixed;inset:0;background:rgba(15,27,45,.72);z-index:9000;overflow-y:auto;padding:20px;">
      <div style="background:#fff;border-radius:14px;max-width:780px;margin:0 auto;padding:0 0 40px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 28px;border-bottom:1px solid #e2e7ef;">
          <h2 style="font-size:18px;font-weight:800" id="modal-title">계약서 작성</h2>
          <button id="modal-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8a94a6">✕</button>
        </div>
        <div style="padding:24px 28px" id="modal-body"></div>
      </div>
    </div>

    <!-- 미리보기 모달 -->
    <div id="preview-modal" style="display:none;position:fixed;inset:0;background:rgba(15,27,45,.72);z-index:9100;overflow-y:auto;padding:20px;">
      <div style="background:#fff;border-radius:14px;max-width:780px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 28px;border-bottom:1px solid #e2e7ef;">
          <h2 style="font-size:18px;font-weight:800" id="preview-title">계약서 확인</h2>
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
  root.querySelector('#modal-close').addEventListener('click', () => closeModal(root));
  root.querySelector('#preview-close').addEventListener('click', () => { root.querySelector('#preview-modal').style.display = 'none'; });
  root.querySelector('#btn-print').addEventListener('click', () => window.print());
  root.querySelector('#filter-emp').addEventListener('change', () => loadContracts(root, profile));
  root.querySelector('#filter-type').addEventListener('change', () => loadContracts(root, profile));
  root.querySelector('#filter-status').addEventListener('change', () => loadContracts(root, profile));
  root.querySelector('#contract-modal').addEventListener('click', e => {
    if (e.target === root.querySelector('#contract-modal')) closeModal(root);
  });

  // ── 실시간 구독: 직원 서명 시 목록 자동 갱신 ─────────────
  const channel = supabase.channel('owner-contracts-realtime')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'labor_contracts',
      filter: `tenant_id=eq.${profile.tenant_id}`,
    }, () => loadContracts(root, profile))
    .subscribe();
  root._teardown = () => supabase.removeChannel(channel);
}

// ── 직원 필터 ─────────────────────────────────────────────────────────────────
async function loadEmployeeFilter(root, profile) {
  const { data } = await supabase
    .from('profiles').select('id, name')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['employee', 'manager']).order('name');
  const sel = root.querySelector('#filter-emp');
  (data || []).forEach(e => { sel.innerHTML += `<option value="${e.id}">${e.name}</option>`; });
}

// ── 목록 로드 ─────────────────────────────────────────────────────────────────
async function loadContracts(root, profile) {
  const empId   = root.querySelector('#filter-emp').value;
  const typeV   = root.querySelector('#filter-type').value;
  const statusV = root.querySelector('#filter-status').value;

  let q = supabase
    .from('labor_contracts')
    .select('id,contract_type,start_date,end_date,wage_type,wage_amount,status,created_at,employee:profiles!labor_contracts_employee_id_fkey(id,name)')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (empId)   q = q.eq('employee_id', empId);
  if (typeV)   q = q.eq('contract_type', typeV);
  if (statusV) q = q.eq('status', statusV);

  const { data, error } = await q;
  const tbody = root.querySelector('#contracts-rows');
  if (!tbody) return;
  if (error)      { tbody.innerHTML = `<tr><td colspan="7" class="empty">에러: ${error.message}</td></tr>`; return; }
  if (!data?.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">작성된 계약서가 없습니다</td></tr>'; return; }

  const statusBadge = s => ({
    draft:     '<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">초안</span>',
    sent:      '<span style="background:#fef3c7;color:#d97706;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">서명 대기</span>',
    completed: '<span style="background:#d1fae5;color:#059669;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">완료</span>',
  }[s] || s);

  tbody.innerHTML = data.map(r => {
    const wm = WAGE_META[r.wage_type] || WAGE_META.hourly;
    const period = r.end_date ? `${r.start_date} ~ ${r.end_date}` : `${r.start_date} ~`;
    return `<tr>
      <td><strong>${r.employee?.name || '-'}</strong></td>
      <td style="font-size:12px">${CONTRACT_TYPES[r.contract_type]?.label || r.contract_type}</td>
      <td style="font-size:12px">${period}</td>
      <td style="font-size:12px">${Number(r.wage_amount).toLocaleString()}원 (${wm.label})</td>
      <td>${statusBadge(r.status)}</td>
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

  tbody.querySelectorAll('[data-preview]').forEach(b =>
    b.addEventListener('click', () => previewContract(root, profile, b.dataset.preview)));
  tbody.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', async () => {
      const { data: c } = await supabase.from('labor_contracts').select('*').eq('id', b.dataset.edit).single();
      if (c) openContractModal(root, profile, c);
    }));
  tbody.querySelectorAll('[data-send]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('직원 앱에 서명 요청이 표시됩니다. 발송하시겠습니까?')) return;
      const { error } = await supabase.from('labor_contracts')
        .update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', b.dataset.send);
      if (error) toast(error.message, 'error');
      else { toast('계약서가 발송됐습니다.', 'success', 4000); await loadContracts(root, profile); }
    }));
  tbody.querySelectorAll('[data-recall]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('계약서를 회수하면 직원이 서명할 수 없게 됩니다.')) return;
      const { error } = await supabase.from('labor_contracts')
        .update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', b.dataset.recall);
      if (error) toast(error.message, 'error');
      else { toast('계약서를 회수했습니다.', 'success'); await loadContracts(root, profile); }
    }));
}

// ── 모달 열기 ─────────────────────────────────────────────────────────────────
async function openContractModal(root, profile, contract) {
  const { data: emps } = await supabase
    .from('profiles')
    .select('id,name,phone,hourly_wage,wage_type,deduction_type,store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['employee', 'manager']).order('name');

  const c = contract || {};
  root.querySelector('#modal-title').textContent = c.id ? '계약서 수정' : '계약서 작성';

  const empOpts = (emps || []).map(e =>
    `<option value="${e.id}"
      data-wage="${e.hourly_wage||0}"
      data-wtype="${e.wage_type||'hourly'}"
      data-ded="${e.deduction_type||'insurance'}"
      data-store="${e.store?.name||''}"
      ${c.employee_id === e.id ? 'selected' : ''}>${e.name}</option>`
  ).join('');

  const inp = (id, type, val, extra='') =>
    `<input type="${type}" id="${id}" value="${val||''}" ${extra}
      style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">`;
  const sel = (id, opts, extra='') =>
    `<select id="${id}" ${extra}
      style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">${opts}</select>`;
  const lbl = (text, sub='') =>
    `<label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:6px">${text}${sub?`<span style="font-weight:400;color:#94a3b8"> ${sub}</span>`:''}</label>`;
  const grp = (labelHtml, inputHtml, col='') =>
    `<div${col ? ` style="grid-column:${col}"` : ''}>${labelHtml}${inputHtml}</div>`;

  const typeOpts = Object.entries(CONTRACT_TYPES)
    .map(([k,v]) => `<option value="${k}" ${(c.contract_type||'regular')===k?'selected':''}>${v.label}</option>`).join('');

  root.querySelector('#modal-body').innerHTML = `
    <form id="contract-form">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

        ${grp(lbl('직원 선택 *'), sel('cf-emp', `<option value="">직원을 선택하세요</option>${empOpts}`, 'required'), '1/-1')}
        ${grp(lbl('계약 유형 *'), sel('cf-type', typeOpts), '1/-1')}

        <div>
          ${lbl('계약 시작일 *')}
          ${inp('cf-start', 'date', c.start_date, 'required')}
        </div>
        <div>
          ${lbl('계약 종료일', '(기간제·일용·프리랜서·건설)')}
          ${inp('cf-end', 'date', c.end_date||'')}
        </div>

        <!-- 건설: 공사명 -->
        <div id="sec-project" style="grid-column:1/-1;display:none">
          ${lbl('공사명 / 현장명 *')}
          ${inp('cf-project', 'text', c.project_name||'', 'placeholder="예: ○○아파트 신축공사"')}
        </div>

        ${grp(lbl('취업 장소 / 근무지 *'), inp('cf-location', 'text', c.work_location||'', 'placeholder="예: 경기도 수원시 영통구 ○○현장" required'), '1/-1')}
        ${grp(lbl('담당 업무 *'), inp('cf-job', 'text', c.job_description||'', 'placeholder="예: 청소 및 시설 관리" required'), '1/-1')}

        <!-- 근무 일정 (정규/계약/단시간) -->
        <div id="sec-schedule" style="display:contents">
          <div>
            ${lbl('소정근로일 *')}
            ${inp('cf-days', 'text', c.work_days||'월,화,수,목,금', 'placeholder="월,화,수,목,금"')}
          </div>
          <div>
            ${lbl('주 소정근로시간')}
            ${inp('cf-weekly', 'number', c.weekly_hours||40, 'min="1" max="52"')}
          </div>
          <div>
            ${lbl('출근 시간')}
            ${inp('cf-dstart', 'time', c.daily_start||'09:00')}
          </div>
          <div>
            ${lbl('퇴근 시간')}
            ${inp('cf-dend', 'time', c.daily_end||'18:00')}
          </div>
          <div>
            ${lbl('휴게시간 (분)')}
            ${inp('cf-break', 'number', c.break_minutes||60, 'min="0"')}
          </div>
        </div>

        <!-- 일용/건설: 출퇴근 시간만 -->
        <div id="sec-time-only" style="display:none;grid-column:1/-1;display:none">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
            <div>${lbl('출근 시간')}${inp('cf-dstart2', 'time', c.daily_start||'08:00')}</div>
            <div>${lbl('퇴근 시간')}${inp('cf-dend2', 'time', c.daily_end||'17:00')}</div>
            <div>${lbl('휴게시간 (분)')}${inp('cf-break2', 'number', c.break_minutes||60, 'min="0"')}</div>
          </div>
        </div>

        <!-- 임금 -->
        <div>
          ${lbl('임금 종류')}
          ${sel('cf-wtype', `
            <option value="hourly"  ${(c.wage_type||'hourly')==='hourly'?'selected':''}>시급</option>
            <option value="daily"   ${c.wage_type==='daily'?'selected':''}>일급</option>
            <option value="monthly" ${c.wage_type==='monthly'?'selected':''}>월급</option>
          `)}
        </div>
        <div>
          ${lbl('임금 금액 (원) *')}
          ${inp('cf-wage', 'number', c.wage_amount||0, 'min="0" required')}
        </div>
        <div>
          ${lbl('지급일')}
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;color:#64748b">매월</span>
            ${inp('cf-payday', 'number', c.pay_day||10, 'min="1" max="31" style="width:80px"')}
            <span style="font-size:13px;color:#64748b">일</span>
          </div>
        </div>
        <div>
          ${lbl('지급 방법')}
          ${sel('cf-paymethod', `
            <option value="계좌이체" ${(c.pay_method||'계좌이체')==='계좌이체'?'selected':''}>계좌이체</option>
            <option value="현금" ${c.pay_method==='현금'?'selected':''}>현금 지급</option>
          `)}
        </div>
        <div>
          ${lbl('공제 유형')}
          ${sel('cf-ded', `
            <option value="insurance"  ${(c.deduction_type||'insurance')==='insurance'?'selected':''}>4대보험 (~9.4%)</option>
            <option value="freelancer" ${c.deduction_type==='freelancer'?'selected':''}>프리랜서 3.3%</option>
            <option value="daily_ins"  ${c.deduction_type==='daily_ins'?'selected':''}>일용직 고용보험</option>
            <option value="none"       ${c.deduction_type==='none'?'selected':''}>공제 없음</option>
          `)}
        </div>

        <!-- 연차 (정규/계약/단시간) -->
        <div id="sec-leave">
          ${lbl('연차유급휴가 (일)')}
          ${inp('cf-leave', 'number', c.annual_leave_days||15, 'min="0"')}
        </div>

        <!-- 건설: 안전보건 서약 -->
        <div id="sec-safety" style="grid-column:1/-1;display:none;padding:14px 18px;background:#fff8f0;border:1.5px solid #fed7aa;border-radius:10px">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;font-weight:700;color:#92400e">
            <input type="checkbox" id="cf-safety" ${c.safety_agreed?'checked':''} style="width:18px;height:18px;cursor:pointer">
            ⚠️ 안전보건 서약 확인 (산업안전보건법 기준)
          </label>
          <p style="font-size:12px;color:#78350f;margin-top:8px;line-height:1.7">
            근로자는 사업주가 시행하는 안전보건 조치를 준수하고, 작업 전 안전점검에 참여하며,
            보호구를 착용하고, 위험 상황 발견 시 즉시 작업을 중지하고 신고할 것을 서약합니다.
          </p>
        </div>

        <!-- 특약 사항 (공통) -->
        <div style="grid-column:1/-1">
          ${lbl('특약 사항', '(선택)')}
          <textarea id="cf-special" rows="3"
            placeholder="예: 수습기간 3개월 / 교통비 월 10만원 별도 지급 / 기타 협의 사항"
            style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"
          >${c.special_terms||''}</textarea>
        </div>

      </div>

      <div style="border-top:1px solid #e2e7ef;margin-top:24px;padding-top:20px;display:flex;justify-content:space-between;align-items:center">
        <p style="font-size:12px;color:#94a3b8">
          ※ 저장 후 "발송" 버튼을 누르면 직원 앱에 서명 요청이 전달됩니다.
        </p>
        <div style="display:flex;gap:10px">
          <button type="button" id="btn-modal-cancel" class="btn ghost">취소</button>
          <button type="submit" class="btn primary" id="btn-modal-save">저장</button>
        </div>
      </div>
    </form>
  `;

  // 초기 유형 적용
  applyTypeConfig(root, c.contract_type || 'regular');

  // 유형 변경 시 폼 업데이트
  root.querySelector('#cf-type').addEventListener('change', e => {
    applyTypeConfig(root, e.target.value);
  });

  // 직원 선택 → 임금 자동 채우기
  root.querySelector('#cf-emp').addEventListener('change', () => {
    const opt = root.querySelector('#cf-emp').selectedOptions[0];
    if (!opt?.value) return;
    root.querySelector('#cf-wage').value = opt.dataset.wage || 0;
    root.querySelector('#cf-wtype').value = opt.dataset.wtype || 'hourly';
    const cfg = FORM_CFG[root.querySelector('#cf-type').value] || FORM_CFG.regular;
    const meta = CONTRACT_TYPES[root.querySelector('#cf-type').value];
    if (!meta?.dedLock) root.querySelector('#cf-ded').value = opt.dataset.ded || 'insurance';
    if (opt.dataset.store) root.querySelector('#cf-location').value = opt.dataset.store;
  });

  root.querySelector('#btn-modal-cancel').addEventListener('click', () => closeModal(root));
  root.querySelector('#contract-form').addEventListener('submit', async e => {
    e.preventDefault();
    await saveContract(root, profile, c.id || null);
  });

  root.querySelector('#contract-modal').style.display = 'block';
}

// ── 유형별 폼 제어 ────────────────────────────────────────────────────────────
function applyTypeConfig(root, type) {
  const cfg  = FORM_CFG[type] || FORM_CFG.regular;
  const meta = CONTRACT_TYPES[type] || CONTRACT_TYPES.regular;

  // 근무일정 섹션 (정규/계약/단시간)
  const secSched = root.querySelector('#sec-schedule');
  if (secSched) secSched.style.display = cfg.schedule ? 'contents' : 'none';

  // 출퇴근시간 전용 (일용/건설)
  const secTime = root.querySelector('#sec-time-only');
  if (secTime) secTime.style.display = (!cfg.schedule && type !== 'freelance') ? 'block' : 'none';

  // 공사명 (건설)
  const secProject = root.querySelector('#sec-project');
  if (secProject) secProject.style.display = cfg.project ? 'block' : 'none';

  // 안전서약 (건설)
  const secSafety = root.querySelector('#sec-safety');
  if (secSafety) secSafety.style.display = cfg.safety ? 'block' : 'none';

  // 연차 (비근로 유형은 숨김)
  const secLeave = root.querySelector('#sec-leave');
  if (secLeave) secLeave.style.display = cfg.leave ? 'block' : 'none';

  // 임금 종류 잠금
  const wtypeEl = root.querySelector('#cf-wtype');
  if (wtypeEl) {
    if (meta.wageLock) { wtypeEl.value = meta.wageLock; wtypeEl.disabled = true; }
    else wtypeEl.disabled = false;
  }

  // 공제 유형 잠금 (프리랜서 → 3.3% 고정)
  const dedEl = root.querySelector('#cf-ded');
  if (dedEl) {
    if (meta.dedLock) { dedEl.value = meta.dedLock; dedEl.disabled = true; }
    else dedEl.disabled = false;
  }
}

function closeModal(root) {
  root.querySelector('#contract-modal').style.display = 'none';
}

// ── 저장 ─────────────────────────────────────────────────────────────────────
async function saveContract(root, profile, id) {
  const btn = root.querySelector('#btn-modal-save');
  btn.disabled = true; btn.textContent = '저장 중…';

  const empId = root.querySelector('#cf-emp').value;
  if (!empId) { toast('직원을 선택해주세요', 'error'); btn.disabled = false; btn.textContent = '저장'; return; }

  const type = root.querySelector('#cf-type').value;
  const cfg  = FORM_CFG[type] || FORM_CFG.regular;

  // 일용/건설 전용 출퇴근 시간
  const useSec2 = !cfg.schedule && type !== 'freelance';
  const dstart = useSec2
    ? (root.querySelector('#cf-dstart2')?.value || '09:00')
    : (root.querySelector('#cf-dstart')?.value || '09:00');
  const dend = useSec2
    ? (root.querySelector('#cf-dend2')?.value || '18:00')
    : (root.querySelector('#cf-dend')?.value || '18:00');
  const brk = useSec2
    ? +(root.querySelector('#cf-break2')?.value || 60)
    : +(root.querySelector('#cf-break')?.value || 60);

  const payload = {
    tenant_id:         profile.tenant_id,
    employee_id:       empId,
    contract_type:     type,
    start_date:        root.querySelector('#cf-start').value,
    end_date:          root.querySelector('#cf-end').value || null,
    work_location:     root.querySelector('#cf-location').value,
    job_description:   root.querySelector('#cf-job').value,
    project_name:      root.querySelector('#cf-project')?.value || null,
    work_days:         cfg.schedule ? (root.querySelector('#cf-days')?.value || 'mon-fri') : '-',
    weekly_hours:      cfg.schedule ? +(root.querySelector('#cf-weekly')?.value || 40) : 0,
    daily_start:       dstart,
    daily_end:         dend,
    break_minutes:     brk,
    wage_type:         root.querySelector('#cf-wtype').value,
    wage_amount:       +(root.querySelector('#cf-wage').value || 0),
    pay_day:           +(root.querySelector('#cf-payday').value || 10),
    pay_method:        root.querySelector('#cf-paymethod').value,
    deduction_type:    root.querySelector('#cf-ded').value,
    annual_leave_days: cfg.leave ? +(root.querySelector('#cf-leave')?.value || 15) : 0,
    safety_agreed:     !!(root.querySelector('#cf-safety')?.checked),
    special_terms:     root.querySelector('#cf-special').value || null,
    owner_name:        profile.name,
    updated_at:        new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from('labor_contracts').update(payload).eq('id', id)
    : await supabase.from('labor_contracts').insert(payload);

  btn.disabled = false; btn.textContent = '저장';
  if (error) { toast(error.message, 'error'); return; }
  toast('계약서가 저장됐습니다', 'success');
  closeModal(root);
  await loadContracts(root, profile);
}

// ── 미리보기 ─────────────────────────────────────────────────────────────────
async function previewContract(root, profile, id) {
  const { data: c, error } = await supabase
    .from('labor_contracts')
    .select('*, employee:profiles!labor_contracts_employee_id_fkey(name, phone)')
    .eq('id', id).single();
  if (error || !c) { toast('계약서를 불러올 수 없습니다', 'error'); return; }

  const type = c.contract_type || 'regular';
  let html;
  if (type === 'freelance')    html = previewFreelance(c, profile);
  else if (type === 'construction') html = previewConstruction(c, profile);
  else if (type === 'daily_worker') html = previewDailyWorker(c, profile);
  else html = previewLabor(c, profile);

  root.querySelector('#preview-title').textContent =
    CONTRACT_TYPES[type]?.label.replace(' (기간 정함 없음)','').replace(' (기간제)','').replace(' (알바)','').replace(' (도급계약)','').replace(' (안전서약 포함)','')
    + ' 확인';
  root.querySelector('#preview-body').innerHTML = html;
  root.querySelector('#preview-modal').style.display = 'block';

  const signBtn = root.querySelector('#btn-owner-sign');
  if (signBtn) {
    signBtn.addEventListener('click', async () => {
      signBtn.disabled = true;
      const now = new Date().toISOString();
      const { error } = await supabase.from('labor_contracts')
        .update({ owner_signed_at: now, owner_name: profile.name, updated_at: now })
        .eq('id', signBtn.dataset.id);
      if (error) { toast(error.message, 'error'); signBtn.disabled = false; return; }
      toast('서명 완료. "발송" 버튼으로 직원에게 전송하세요.', 'success', 4000);
      root.querySelector('#preview-modal').style.display = 'none';
      await loadContracts(root, profile);
    });
  }
}

// ── 미리보기 템플릿: 표준 근로계약서 (regular/fixed/parttime) ─────────────────
function previewLabor(c, profile) {
  const biz  = profile.tenants?.name || '사업장';
  const wm   = WAGE_META[c.wage_type] || WAGE_META.hourly;
  const ded  = DED_LABEL[c.deduction_type] || c.deduction_type;
  const period = c.end_date ? `${c.start_date} ~ ${c.end_date}` : `${c.start_date}부터 (기간 정함 없음)`;
  const typeLabel = CONTRACT_TYPES[c.contract_type]?.label || c.contract_type;
  return `
  <div id="printable-contract" style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;color:#0f1b2d">
    <h2 style="text-align:center;font-size:22px;font-weight:900;margin-bottom:4px;letter-spacing:3px">근 로 계 약 서</h2>
    <p style="text-align:center;font-size:12px;color:#64748b;margin-bottom:24px">(근로기준법 제17조)</p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
      ${r2('사업장명', biz, '대표자', profile.name||'-')}
      ${r2('근로자명', c.employee?.name||'-', '연락처', c.employee?.phone||'-')}
      ${r2('계약 유형', typeLabel, '계약 기간', period)}
      ${r2('취업 장소', c.work_location, '담당 업무', c.job_description)}
      ${r2('소정근로일', c.work_days, '주 소정근로시간', `${c.weekly_hours}시간`)}
      ${r2('출퇴근 시간', `${c.daily_start} ~ ${c.daily_end}`, '휴게시간', `${c.break_minutes}분`)}
      ${r2('임금 종류', wm.label, '임금 금액', `${Number(c.wage_amount).toLocaleString()}원 (${wm.unit})`)}
      ${r2('지급일', `매월 ${c.pay_day}일`, '지급 방법', c.pay_method)}
      ${r2('공제 방식', ded, '연차유급휴가', `${c.annual_leave_days}일`)}
    </table>

    ${c.special_terms ? `
    <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:16px;font-size:13px">
      <strong style="font-size:11px;color:#64748b;display:block;margin-bottom:6px">특약 사항</strong>
      ${c.special_terms}
    </div>` : ''}

    <p style="font-size:13px;color:#374151;line-height:1.9;padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:24px">
      사용자와 근로자는 위와 같은 근로조건을 확인하며 성실히 이행할 것에 동의합니다.<br>
      본 계약서는 전자문서 및 전자거래 기본법에 따라 법적 효력을 가집니다.
    </p>
    ${signatureBlock(c, profile)}
  </div>`;
}

// ── 미리보기 템플릿: 일용근로자 ───────────────────────────────────────────────
function previewDailyWorker(c, profile) {
  const biz = profile.tenants?.name || '사업장';
  const ded = DED_LABEL[c.deduction_type] || c.deduction_type;
  const period = c.end_date ? `${c.start_date} ~ ${c.end_date}` : `${c.start_date}부터`;
  return `
  <div id="printable-contract" style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;color:#0f1b2d">
    <h2 style="text-align:center;font-size:22px;font-weight:900;margin-bottom:4px;letter-spacing:2px">일용근로자 근로계약서</h2>
    <p style="text-align:center;font-size:12px;color:#64748b;margin-bottom:24px">(근로기준법 제17조 · 일용근로 기준)</p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
      ${r2('사업장명', biz, '대표자', profile.name||'-')}
      ${r2('근로자명', c.employee?.name||'-', '연락처', c.employee?.phone||'-')}
      ${r2('근무 기간', period, '취업 장소', c.work_location)}
      ${r2('담당 업무', c.job_description, '출퇴근', `${c.daily_start} ~ ${c.daily_end}`)}
      ${r2('휴게시간', `${c.break_minutes}분`, '일급', `${Number(c.wage_amount).toLocaleString()}원/일`)}
      ${r2('지급일', `매월 ${c.pay_day}일`, '지급 방법', c.pay_method)}
      ${r2('공제 방식', ded, '', '')}
    </table>

    <div style="padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;margin-bottom:16px;font-size:12px;color:#78350f">
      ※ 일용근로자는 1일 단위로 근로계약을 체결하며, 주휴수당은 1주 소정근로일을 개근한 경우에 한해 지급됩니다.
    </div>

    ${c.special_terms ? `
    <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:16px;font-size:13px">
      <strong style="font-size:11px;color:#64748b;display:block;margin-bottom:6px">특약 사항</strong>
      ${c.special_terms}
    </div>` : ''}

    <p style="font-size:13px;color:#374151;line-height:1.9;padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:24px">
      사용자와 일용근로자는 위 근로조건을 확인하며 이를 성실히 이행할 것에 동의합니다.
    </p>
    ${signatureBlock(c, profile)}
  </div>`;
}

// ── 미리보기 템플릿: 3.3% 프리랜서 도급계약서 ───────────────────────────────
function previewFreelance(c, profile) {
  const biz  = profile.tenants?.name || '사업장';
  const period = c.end_date ? `${c.start_date} ~ ${c.end_date}` : `${c.start_date}부터`;
  const fee  = Number(c.wage_amount).toLocaleString();
  const wm   = WAGE_META[c.wage_type] || WAGE_META.monthly;
  const net  = Math.round(c.wage_amount * 0.967).toLocaleString();
  return `
  <div id="printable-contract" style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;color:#0f1b2d">
    <h2 style="text-align:center;font-size:22px;font-weight:900;margin-bottom:4px;letter-spacing:2px">용 역 (도 급) 계 약 서</h2>
    <p style="text-align:center;font-size:12px;color:#64748b;margin-bottom:24px">(소득세법 제127조 · 사업소득 3.3% 원천징수)</p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
      <tr>
        <td style="padding:10px 14px;background:#0F2942;color:#fff;font-weight:700;font-size:12px;width:60px">갑 (발주자)</td>
        <td style="padding:10px 14px;border:1px solid #e2e7ef">${biz}</td>
        <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;width:70px">대표자</td>
        <td style="padding:10px 14px;border:1px solid #e2e7ef">${profile.name||'-'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:#0F2942;color:#fff;font-weight:700;font-size:12px">을 (수급인)</td>
        <td style="padding:10px 14px;border:1px solid #e2e7ef">${c.employee?.name||'-'}</td>
        <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b">연락처</td>
        <td style="padding:10px 14px;border:1px solid #e2e7ef">${c.employee?.phone||'-'}</td>
      </tr>
    </table>

    <div style="margin-bottom:14px">
      <p style="font-size:13px;font-weight:700;color:#0F2942;margin-bottom:8px">계약 내용</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${r2('제1조 용역 기간', period, '업무 장소', c.work_location)}
        ${r2('제2조 용역 내용', c.job_description, '', '')}
        ${r2('제3조 용역 대가', `${fee}원 (${wm.unit})`, '지급 방법', `매월 ${c.pay_day}일 ${c.pay_method}`)}
        ${r2('제4조 원천징수', `사업소득세 3% + 지방세 0.3% = 3.3%<br>실수령액 약 <strong>${net}원</strong>`, '', '')}
        ${r2('제5조 4대보험', '해당 없음 (도급 관계)', '고용 형태', '독립 사업자 (비근로자)')}
      </table>
    </div>

    ${c.special_terms ? `
    <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:16px;font-size:13px">
      <strong style="font-size:11px;color:#64748b;display:block;margin-bottom:6px">제6조 특약 사항</strong>
      ${c.special_terms}
    </div>` : ''}

    <p style="font-size:13px;color:#374151;line-height:1.9;padding:12px 16px;background:#fff8f0;border:1px solid #fed7aa;border-radius:8px;margin-bottom:24px">
      갑과 을은 위 계약 내용에 동의하며, 을은 독립 사업자로서 스스로의 책임 하에 용역을 수행합니다.<br>
      본 계약은 근로기준법상 근로계약이 아닌 민법상 도급계약입니다.
    </p>
    ${signatureBlock(c, profile, '갑 (발주자)', '을 (수급인)')}
  </div>`;
}

// ── 미리보기 템플릿: 건설일용근로자 표준계약서 ───────────────────────────────
function previewConstruction(c, profile) {
  const biz  = profile.tenants?.name || '사업장';
  const ded  = DED_LABEL[c.deduction_type] || c.deduction_type;
  const period = c.end_date ? `${c.start_date} ~ ${c.end_date}` : `${c.start_date}부터`;
  return `
  <div id="printable-contract" style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;color:#0f1b2d">
    <h2 style="text-align:center;font-size:21px;font-weight:900;margin-bottom:4px;letter-spacing:2px">건설일용근로자 표준근로계약서</h2>
    <p style="text-align:center;font-size:12px;color:#64748b;margin-bottom:24px">(건설근로자의 고용개선 등에 관한 법률 · 근로기준법 제17조)</p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
      ${r2('시공사(사업장)', biz, '현장 대표', profile.name||'-')}
      ${r2('근로자명', c.employee?.name||'-', '연락처', c.employee?.phone||'-')}
      ${r2('공사명 / 현장', c.project_name||'-', '현장 주소', c.work_location)}
      ${r2('직종 / 업무', c.job_description, '근무 기간', period)}
      ${r2('출퇴근 시간', `${c.daily_start} ~ ${c.daily_end}`, '휴게시간', `${c.break_minutes}분`)}
      ${r2('일급', `${Number(c.wage_amount).toLocaleString()}원/일`, '지급 방법', `매월 ${c.pay_day}일 ${c.pay_method}`)}
      ${r2('공제 방식', ded, '퇴직공제', '건설근로자 퇴직공제 적용')}
    </table>

    ${c.safety_agreed ? `
    <div style="padding:14px 18px;background:#fff8f0;border:1.5px solid #f97316;border-radius:10px;margin-bottom:16px">
      <p style="font-size:13px;font-weight:800;color:#c2410c;margin-bottom:8px">⚠️ 안전보건 서약 (산업안전보건법 기준)</p>
      <p style="font-size:12px;color:#7c2d12;line-height:1.8">
        본 근로자는 아래 사항을 준수할 것을 서약합니다.<br>
        ① 사업주가 시행하는 안전보건 교육 및 조치를 준수한다.<br>
        ② 작업 전 안전점검(TBM)에 반드시 참여한다.<br>
        ③ 지급된 개인보호구(안전모, 안전화, 안전대 등)를 착용한다.<br>
        ④ 위험 상황 발견 시 즉시 작업을 중지하고 관리감독자에게 신고한다.<br>
        ⑤ 음주·약물 복용 상태로 작업장에 출입하지 않는다.
      </p>
      <p style="font-size:11px;color:#92400e;margin-top:8px">✅ 근로자가 위 안전보건 서약에 동의하였음</p>
    </div>` : ''}

    ${c.special_terms ? `
    <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:16px;font-size:13px">
      <strong style="font-size:11px;color:#64748b;display:block;margin-bottom:6px">특약 사항</strong>
      ${c.special_terms}
    </div>` : ''}

    <p style="font-size:13px;color:#374151;line-height:1.9;padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:24px">
      사용자와 건설일용근로자는 위 근로조건을 확인하며 이를 성실히 이행할 것에 동의합니다.
    </p>
    ${signatureBlock(c, profile)}
  </div>`;
}

// ── 서명 블록 ─────────────────────────────────────────────────────────────────
function signatureBlock(c, profile, ownerTitle='사용자 서명', empTitle='근로자 서명') {
  return `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">
    <div style="border:1.5px solid #e2e7ef;border-radius:10px;padding:16px 18px">
      <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">${ownerTitle}</div>
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">${profile.name||'-'} (인)</div>
      <div style="font-size:12px;color:#64748b">서명일: ${c.owner_signed_at ? new Date(c.owner_signed_at).toLocaleDateString('ko-KR') : '미서명'}</div>
      ${c.status === 'draft' ? `<div style="margin-top:10px"><button class="btn small primary" id="btn-owner-sign" data-id="${c.id}">서명 완료</button></div>` : ''}
    </div>
    <div style="border:1.5px solid #e2e7ef;border-radius:10px;padding:16px 18px">
      <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">${empTitle}</div>
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">${c.employee?.name||'-'} (인)</div>
      <div style="font-size:12px;color:#64748b">서명일: ${c.employee_signed_at ? new Date(c.employee_signed_at).toLocaleDateString('ko-KR') : '미서명'}</div>
    </div>
  </div>
  <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:20px">작성일: ${c.created_at?.slice(0,10)} · TAGIN 전자계약서</p>`;
}

// ── row2 헬퍼 ─────────────────────────────────────────────────────────────────
function r2(l1, v1, l2, v2) {
  const cell = (l, v) => `
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e7ef;font-size:11px;font-weight:700;color:#64748b;white-space:nowrap;width:90px">${l}</td>
    <td style="padding:9px 12px;border:1px solid #e2e7ef;font-size:13px">${v}</td>`;
  return `<tr>${cell(l1,v1)}${l2!==undefined ? cell(l2,v2) : ''}</tr>`;
}
