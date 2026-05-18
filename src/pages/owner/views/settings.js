import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';
import { calcMonthlyFee } from '../../../lib/labels.js';

export async function renderSettings({ root, profile }) {
  const t = profile.tenants || {};
  root.innerHTML = `
    <div class="page-head">
      <h1>설정 / 구독</h1>
      <div class="page-sub">사업장 정보와 구독 상태</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>사업장 정보</h2></div>
      <form id="form-tenant" class="form-grid">
        <label>사업장 이름<input type="text" id="t-name" value="${t.name || ''}"></label>
        <label>업종
          <select id="t-industry">
            <option value="청소·시설관리" ${(t.industry_type || '') === '청소·시설관리' ? 'selected' : ''}>청소·시설관리 업체</option>
            <option value="경비·보안" ${(t.industry_type || '') === '경비·보안' ? 'selected' : ''}>경비·보안 업체</option>
            <option value="인력사무소" ${(t.industry_type || '') === '인력사무소' ? 'selected' : ''}>인력사무소·직업소개소</option>
            <option value="건설도급사" ${(t.industry_type || '') === '건설도급사' ? 'selected' : ''}>건설 전문 도급사</option>
            <option value="기타" ${(t.industry_type || '') === '기타' ? 'selected' : ''}>기타 다현장 운영 회사</option>
          </select>
        </label>
        <div class="form-actions"><button type="submit" class="btn primary">저장</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>구독</h2></div>
      <div class="sub-info">
        <div class="sub-row"><span>상태</span><strong class="sub-status ${t.subscription_status}">${labelSub(t.subscription_status)}</strong></div>
        <div class="sub-row"><span>요금제</span><strong>${(t.plan || 'TRIAL').toUpperCase()}</strong></div>
        <div class="sub-row"><span>체험 종료</span><strong>${t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('ko-KR') : '-'}</strong></div>
        <div class="sub-row"><span>등록 직원(최대)</span><strong>${t.peak_employee_count ?? 0}명</strong></div>
        <div class="sub-row"><span>이번 달 예상 요금</span><strong>${calcMonthlyFee(t.peak_employee_count ?? 0).toLocaleString()}원</strong></div>
      </div>
      <div class="sub-pricing-note" style="background:#f4f6f9;border-radius:5px;padding:14px 16px;margin:12px 0;font-size:13px;color:#3d4a5c;line-height:1.7">
        <strong style="display:block;margin-bottom:6px;color:#0F2942">요금 산정 방식</strong>
        직원 1인당 월 5,000원 × 해당 월 최대 등록 직원 수<br>
        <span style="color:#8a94a6;font-size:12px">※ 무료체험 중에는 요금이 발생하지 않습니다. 체험 종료 후 자동 청구됩니다.</span>
      </div>
      <div class="sub-cta">
        <button class="btn primary" id="btn-subscribe" disabled title="토스페이먼츠 연동은 다음 단계에서 활성화됩니다">구독 시작하기 (준비 중)</button>
        <div class="muted" style="margin-top:8px">결제 연동은 곧 활성화됩니다.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>위험 영역</h2></div>
      <button class="btn danger" id="btn-leave">사업장 탈퇴</button>
      <div class="muted" style="margin-top:8px">모든 데이터가 삭제됩니다. 복구 불가.</div>
    </div>
  `;

  root.querySelector('#form-tenant').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
      name: root.querySelector('#t-name').value.trim(),
      industry_type: root.querySelector('#t-industry').value,
    };
    const { error } = await supabase.from('tenants').update(updates).eq('id', profile.tenant_id);
    if (error) toast(error.message, 'error');
    else toast('저장됨', 'success');
  });

  root.querySelector('#btn-leave').addEventListener('click', async () => {
    if (!confirm('정말로 사업장을 탈퇴할까요? 모든 데이터가 영구 삭제됩니다.')) return;
    if (!confirm('한 번 더 확인합니다. 정말 삭제할까요?')) return;
    const { error } = await supabase.from('tenants').delete().eq('id', profile.tenant_id);
    if (error) toast(error.message, 'error');
    else { await supabase.auth.signOut(); location.href = 'login.html'; }
  });
}

function labelSub(s) {
  return { trialing: '무료체험중', active: '활성', past_due: '결제실패', canceled: '취소됨' }[s] || s || '-';
}
