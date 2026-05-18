import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

// ─────────────────────────────────────────────────────────────
// 슈퍼어드민 패널 — 전체 가입자 트라이얼 관리
// ─────────────────────────────────────────────────────────────
export async function renderSuperAdmin({ root }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>⚙ 슈퍼 어드민</h1>
      <div class="page-sub">전체 가입자의 구독 상태를 관리합니다</div>
    </div>
    <div id="sa-list"><div class="loading">불러오는 중…</div></div>
  `;

  await loadTenants(root);
}

async function loadTenants(root) {
  const [{ data: tenants, error: te }, { data: owners }] = await Promise.all([
    supabase.from('tenants')
      .select('id, name, industry_type, subscription_status, trial_ends_at, peak_employee_count, created_at, plan')
      .order('created_at', { ascending: false }),
    supabase.from('profiles')
      .select('tenant_id, name, email')
      .eq('role', 'owner'),
  ]);

  if (te) {
    root.querySelector('#sa-list').innerHTML = `<div class="error-box">조회 실패: ${te.message}</div>`;
    return;
  }

  const ownerMap = {};
  for (const o of owners || []) ownerMap[o.tenant_id] = o;

  const list = root.querySelector('#sa-list');
  if (!tenants?.length) {
    list.innerHTML = '<div class="card"><div class="empty-state">가입자가 없습니다</div></div>';
    return;
  }

  list.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>전체 가입자 (${tenants.length}개 사업장)</h2>
        <div class="card-sub">트라이얼 연장 / 상태 변경</div>
      </div>
      <div class="table-wrap">
        <table class="att-table" id="sa-table">
          <thead>
            <tr>
              <th>사업장명</th>
              <th>대표자</th>
              <th>업종</th>
              <th>상태</th>
              <th>트라이얼 만료일</th>
              <th>직원수</th>
              <th>가입일</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            ${tenants.map(t => renderRow(t, ownerMap[t.id])).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  list.querySelectorAll('[data-extend]').forEach(btn => {
    btn.addEventListener('click', () => handleExtend(root, btn.dataset.extend, btn.dataset.endDate));
  });
  list.querySelectorAll('[data-expire]').forEach(btn => {
    btn.addEventListener('click', () => handleExpire(root, btn.dataset.expire));
  });
}

function renderRow(t, owner) {
  const endDate = t.trial_ends_at ? new Date(t.trial_ends_at) : null;
  const daysLeft = endDate ? Math.ceil((endDate - Date.now()) / 86400000) : null;
  const statusLabel = { trialing: '트라이얼', active: '구독중', past_due: '결제실패', canceled: '해지', expired: '만료' };
  const statusClass = { trialing: 'trialing', active: 'active', past_due: 'past_due', canceled: 'canceled', expired: 'past_due' };

  const endDateStr = endDate
    ? endDate.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' })
    : '—';
  const daysTag = daysLeft !== null
    ? `<span style="font-size:11px;margin-left:4px;color:${daysLeft < 0 ? '#f04438' : daysLeft <= 7 ? '#f59e0b' : '#64748b'}">(${daysLeft > 0 ? `D-${daysLeft}` : daysLeft === 0 ? 'D-Day' : `${Math.abs(daysLeft)}일 초과'})</span>`
    : '';

  const createdStr = new Date(t.created_at).toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });

  return `
    <tr>
      <td style="font-weight:700">${t.name || '(미설정)'}</td>
      <td>
        <div style="font-size:13px">${owner?.name || '—'}</div>
        <div style="font-size:11px;color:#64748b">${owner?.email || '—'}</div>
      </td>
      <td style="font-size:12px;color:#8a94a6">${t.industry_type || '—'}</td>
      <td><span class="sub-status ${statusClass[t.subscription_status] || ''}" style="font-weight:700;font-size:13px">${statusLabel[t.subscription_status] || t.subscription_status}</span></td>
      <td>${endDateStr}${daysTag}</td>
      <td style="text-align:center;font-weight:700">${t.peak_employee_count ?? 0}명</td>
      <td style="font-size:12px;color:#8a94a6">${createdStr}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small primary" data-extend="${t.id}" data-end-date="${t.trial_ends_at || ''}">+30일</button>
          <button class="btn small danger" data-expire="${t.id}" style="font-size:11px">만료</button>
        </div>
      </td>
    </tr>
  `;
}

async function handleExtend(root, tenantId, currentEndDate) {
  const base = currentEndDate
    ? new Date(Math.max(new Date(currentEndDate).getTime(), Date.now()))
    : new Date();
  base.setDate(base.getDate() + 30);

  const { error } = await supabase.from('tenants')
    .update({ trial_ends_at: base.toISOString(), subscription_status: 'trialing' })
    .eq('id', tenantId);

  if (error) { toast(error.message, 'error'); return; }
  toast('트라이얼 30일 연장 완료', 'success');
  await loadTenants(root);
}

async function handleExpire(root, tenantId) {
  if (!confirm('해당 가입자의 트라이얼을 즉시 만료시키겠습니까?')) return;
  const { error } = await supabase.from('tenants')
    .update({ trial_ends_at: new Date().toISOString() })
    .eq('id', tenantId);

  if (error) { toast(error.message, 'error'); return; }
  toast('만료 처리 완료', 'success');
  await loadTenants(root);
}
