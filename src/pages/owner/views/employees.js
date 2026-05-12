import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

const MIN_HOURLY  = 10030;               // 2025년 최저시급 (원)
const MIN_DAILY   = MIN_HOURLY * 8;      // 최저일급 (8h 기준)
const MIN_MONTHLY = MIN_HOURLY * 209;    // 최저월급 (209h 기준)

const WAGE_META = {
  hourly:  { label: '시급', unit: '원/시간', min: MIN_HOURLY  },
  daily:   { label: '일급', unit: '원/일',   min: MIN_DAILY   },
  monthly: { label: '월급', unit: '원/월',   min: MIN_MONTHLY },
};

export async function renderEmployees({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>직원 관리</h1>
      <div class="page-sub">전화번호와 6자리 가입 코드를 발급해 직원이 자기 폰으로 가입하게 합니다</div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>직원 초대</h2>
        <div class="card-sub">신규 직원의 전화번호를 등록하면 가입 코드가 자동 생성됩니다</div>
      </div>
      <form id="form-invite" class="form-row">
        <input type="text" id="inv-name" placeholder="이름 (선택)" />
        <input type="tel" id="inv-phone" placeholder="010-1234-5678" required />
        <select id="inv-store"></select>
        <button type="submit" id="btn-invite" class="btn primary">가입 코드 발급</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>미사용 가입 코드</h2><div class="card-sub">7일 후 자동 만료</div></div>
      <div class="table-wrap">
        <table class="att-table">
          <thead><tr><th>이름</th><th>전화번호</th><th>매장</th><th>코드</th><th>만료</th><th></th></tr></thead>
          <tbody id="invites-rows"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>활성 직원</h2>
        <div class="card-sub">급여 방식(시급·일급·월급)·금액·공제 유형 수정 가능 · ⚠️ 최저임금 미만 경고</div>
      </div>
      <div class="table-wrap">
        <table class="att-table">
          <thead>
            <tr>
              <th>이름</th><th>전화번호</th><th>매장</th>
              <th>급여 방식</th><th>금액</th>
              <th>직책</th><th>공제</th><th>활성</th><th></th>
            </tr>
          </thead>
          <tbody id="emp-rows"></tbody>
        </table>
      </div>
    </div>
  `;

  await loadStores(root, profile);
  await loadInvites(root, profile);
  await loadEmployees(root, profile);

  root.querySelector('#form-invite').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#btn-invite');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '발급 중…';

    const name    = root.querySelector('#inv-name').value.trim();
    const phone   = root.querySelector('#inv-phone').value.trim();
    const storeId = root.querySelector('#inv-store').value || null;

    if (!phone) { btn.disabled = false; btn.textContent = '가입 코드 발급'; return; }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { error } = await supabase.from('employee_invites').insert({
      tenant_id: profile.tenant_id, store_id: storeId, phone, name, code,
    });
    btn.disabled = false;
    btn.textContent = '가입 코드 발급';
    if (error) { toast(error.message, 'error'); return; }
    toast(`가입 코드: ${code}\n${phone}로 전달해주세요`, 'success', 5000);
    e.target.reset();
    await loadInvites(root, profile);
  });
}

async function loadStores(root, profile) {
  const { data } = await supabase.from('stores').select('id, name')
    .eq('tenant_id', profile.tenant_id).order('name');
  const sel = root.querySelector('#inv-store');
  if (!sel) return;
  sel.innerHTML = '<option value="">매장 미지정</option>';
  for (const s of data || []) sel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
}

async function loadInvites(root, profile) {
  const { data } = await supabase
    .from('employee_invites')
    .select('id, name, phone, code, expires_at, store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  const tbody = root.querySelector('#invites-rows');
  if (!tbody) return;
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">대기 중인 초대 없음</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${r.name || '-'}</td>
      <td>${r.phone}</td>
      <td>${r.store?.name || '미지정'}</td>
      <td><strong class="code">${r.code}</strong></td>
      <td>${new Date(r.expires_at).toLocaleDateString('ko-KR')}</td>
      <td><button class="btn small ghost" data-cancel="${r.id}">취소</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-cancel]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('이 초대를 취소할까요?')) return;
      await supabase.from('employee_invites').delete().eq('id', b.dataset.cancel);
      await loadInvites(root, profile);
    });
  });
}

async function loadEmployees(root, profile) {
  // wage_type / deduction_type 컬럼이 없는 구 DB 대비 fallback
  let { data, error } = await supabase
    .from('profiles')
    .select('id, name, phone, hourly_wage, wage_type, deduction_type, position, active, store:stores(name)')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'employee')
    .order('name');

  if (error && /wage_type|deduction_type/i.test(error.message)) {
    toast('⚠️ DB 컬럼이 부족합니다. supabase/migrations/0005_wage_type.sql 을 Supabase SQL Editor에서 실행해주세요.', 'warn', 8000);
    const fb = await supabase
      .from('profiles')
      .select('id, name, phone, hourly_wage, position, active, store:stores(name)')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'employee')
      .order('name');
    data = fb.data; error = fb.error;
  }

  const tbody = root.querySelector('#emp-rows');
  if (!tbody) return;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">에러: ${error.message}</td></tr>`;
    return;
  }
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">아직 등록된 직원이 없습니다</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(r => {
    const wt  = r.wage_type || 'hourly';
    const amt = r.hourly_wage || 0;
    const meta = WAGE_META[wt] || WAGE_META.hourly;
    const warnHtml = amt > 0 && amt < meta.min
      ? `<span class="wage-warn" title="최저임금 미만 (${meta.min.toLocaleString()}${meta.unit})">⚠️</span>`
      : '';
    const ded = r.deduction_type || 'insurance';

    return `
    <tr data-id="${r.id}">
      <td><strong>${r.name}</strong></td>
      <td>${r.phone || '-'}</td>
      <td>${r.store?.name || '-'}</td>
      <td>
        <select class="cell-edit" data-field="wage_type" style="width:72px;font-size:12px">
          <option value="hourly"  ${wt === 'hourly'  ? 'selected' : ''}>시급</option>
          <option value="daily"   ${wt === 'daily'   ? 'selected' : ''}>일급</option>
          <option value="monthly" ${wt === 'monthly' ? 'selected' : ''}>월급</option>
        </select>
      </td>
      <td>
        <div class="wage-wrap" style="display:flex;align-items:center;gap:4px">
          <input type="number" class="cell-edit" data-field="hourly_wage"
            value="${amt}" min="0" style="width:96px">
          <span class="wage-unit" style="font-size:11px;color:#8a94a6;white-space:nowrap">${meta.unit}</span>
          ${warnHtml}
        </div>
      </td>
      <td><input type="text" class="cell-edit" data-field="position"
        value="${r.position || ''}" style="width:80px"></td>
      <td>
        <select class="cell-edit" data-field="deduction_type" style="width:118px;font-size:12px">
          <option value="insurance"  ${ded === 'insurance'  ? 'selected' : ''}>4대보험 (~9.4%)</option>
          <option value="freelancer" ${ded === 'freelancer' ? 'selected' : ''}>프리랜서 3.3%</option>
          <option value="none"       ${ded === 'none'       ? 'selected' : ''}>공제 없음</option>
        </select>
      </td>
      <td>
        <label class="switch">
          <input type="checkbox" class="cell-edit" data-field="active" ${r.active ? 'checked' : ''}>
          <span></span>
        </label>
      </td>
      <td><button class="btn small primary" data-save="${r.id}">저장</button></td>
    </tr>`;
  }).join('');

  // wage_type 변경 시 unit 라벨 + 최저임금 경고 즉시 갱신
  tbody.querySelectorAll('[data-field="wage_type"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const tr    = sel.closest('tr');
      const amtEl = tr.querySelector('[data-field="hourly_wage"]');
      const unitEl = tr.querySelector('.wage-unit');
      const wt     = sel.value;
      const meta   = WAGE_META[wt] || WAGE_META.hourly;
      unitEl.textContent = meta.unit;
      updateWageWarn(tr, +amtEl.value, wt);
    });
  });

  // 금액 입력 시 실시간 최저임금 경고
  tbody.querySelectorAll('[data-field="hourly_wage"]').forEach(input => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      const wt = tr.querySelector('[data-field="wage_type"]').value;
      updateWageWarn(tr, +input.value, wt);
    });
  });

  // 저장
  tbody.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const updates = {};
      tr.querySelectorAll('.cell-edit').forEach(el => {
        const f = el.dataset.field;
        if (el.type === 'checkbox') updates[f] = el.checked;
        else if (el.type === 'number') updates[f] = +el.value;
        else updates[f] = el.value;
      });
      // 최저임금 미만 경고 확인
      const meta = WAGE_META[updates.wage_type] || WAGE_META.hourly;
      if (updates.hourly_wage > 0 && updates.hourly_wage < meta.min) {
        const label = meta.label;
        if (!confirm(
          `${label} ${Number(updates.hourly_wage).toLocaleString()}원은 최저${label}(${meta.min.toLocaleString()}원)보다 낮습니다.\n그래도 저장할까요?`
        )) return;
      }
      btn.disabled = true;
      const { error } = await supabase.from('profiles').update(updates).eq('id', btn.dataset.save);
      btn.disabled = false;
      if (error) toast(error.message, 'error');
      else toast('저장됨', 'success');
    });
  });
}

function updateWageWarn(tr, amt, wt) {
  const wrap = tr.querySelector('.wage-wrap');
  let warn = wrap.querySelector('.wage-warn');
  const meta = WAGE_META[wt] || WAGE_META.hourly;
  if (amt > 0 && amt < meta.min) {
    if (!warn) {
      warn = document.createElement('span');
      warn.className = 'wage-warn';
      warn.style.cssText = 'color:#f04438;cursor:help;font-size:14px';
      wrap.appendChild(warn);
    }
    warn.textContent = '⚠️';
    warn.title = `최저임금 미만 (${meta.min.toLocaleString()}${meta.unit})`;
  } else {
    warn?.remove();
  }
}
