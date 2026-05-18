import { supabase } from '../../lib/supabase.js';
import { requireRole, signOut } from '../../lib/auth.js';
import { toast } from '../../lib/toast.js';
import { initOfflineBar } from '../../lib/network.js';
import { getLabels, canAccess, PAID_FEATURES } from '../../lib/labels.js';
import { renderOverview } from './views/overview.js';
import { renderAttendance } from './views/attendance.js';
import { renderEmployees } from './views/employees.js';
import { renderStores } from './views/stores.js';
import { renderShifts } from './views/shifts.js';
import { renderPayroll } from './views/payroll.js';
import { renderSettings } from './views/settings.js';
import { renderSuperAdmin } from './views/superadmin.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let profile = null;
let currentRoute = '';
let isNavigating = false;

const ROUTES = {
  overview: renderOverview,
  attendance: renderAttendance,
  employees: renderEmployees,
  stores: renderStores,
  shifts: renderShifts,
  payroll: renderPayroll,
  settings: renderSettings,
  superadmin: renderSuperAdmin,
};

init();

async function init() {
  profile = await requireRole('owner');
  if (!profile) return;

  $('#biz-name').textContent = profile.tenants?.name || '사업장';
  $('#owner-name').textContent = profile.name;

  // 아바타 이니셜
  const av = $('#owner-avatar');
  if (av && profile.name) av.textContent = profile.name.charAt(0);

  // 업종 레이블 반영
  const industryType = profile.tenants?.industry_type || '청소·시설관리';
  const labels = getLabels(industryType);
  const industryEl = $('#owner-industry');
  if (industryEl) industryEl.textContent = industryType;
  const navWorkers = $('#nav-workers');
  if (navWorkers) navWorkers.textContent = labels.workers;
  const navSites = $('#nav-sites');
  if (navSites) navSites.textContent = `${labels.site} / QR`;

  // 유료 기능 잠금 표시
  applyFeatureLock(profile.tenants);

  // 슈퍼어드민 메뉴 표시
  if (profile.is_super_admin) {
    const navSA = $('#nav-superadmin');
    if (navSA) navSA.style.display = 'flex';
  }

  initOfflineBar();
  showTrialBadge(profile.tenants);

  if (isExpired(profile.tenants)) {
    showExpiredModal();
    return;
  }

  bindNav();

  const initial = location.hash.replace('#/', '') || 'overview';
  navigate(initial);
}

function isExpired(t) {
  if (!t) return false;
  if (t.subscription_status === 'active') return false;
  if (t.subscription_status === 'trialing') {
    return t.trial_ends_at && new Date(t.trial_ends_at) < new Date();
  }
  return t.subscription_status === 'expired' || t.subscription_status === 'canceled';
}

function showUpgradePrompt(route) {
  const featureName = PAID_FEATURES[route] || route;
  const empCount = profile.tenants?.peak_employee_count || 0;
  const fee = empCount > 0
    ? `직원 ${empCount}명 기준 월 ${(empCount * 5000).toLocaleString()}원`
    : '직원 수 × 월 5,000원';

  const existing = document.getElementById('upgrade-prompt');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'upgrade-prompt';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,41,66,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:6px;padding:36px 32px;max-width:400px;width:100%;border-left:5px solid var(--gold,#B8935A)">
      <div style="font-size:12px;font-weight:700;color:#B8935A;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px">유료 전용 기능</div>
      <h2 style="font-size:19px;font-weight:900;color:#0F2942;margin-bottom:10px">${featureName}</h2>
      <p style="font-size:14px;color:#8a94a6;line-height:1.7;margin-bottom:6px">체험 기간이 만료되어 이 기능을 사용하려면 구독이 필요합니다.</p>
      <p style="font-size:14px;color:#0F2942;font-weight:700;margin-bottom:24px">${fee}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button id="up-go-pay" style="padding:12px;background:#0F2942;color:#fff;border:none;border-radius:4px;font-size:14px;font-weight:700;cursor:pointer">구독 시작</button>
        <button id="up-cancel" style="padding:12px;background:#f4f6f9;color:#3d4a5c;border:1px solid #e2e7ef;border-radius:4px;font-size:14px;cursor:pointer">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#up-go-pay').addEventListener('click', () => { overlay.remove(); navigate('settings'); });
  overlay.querySelector('#up-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showExpiredModal() {
  const remain = profile.tenants?.trial_ends_at
    ? Math.ceil((new Date(profile.tenants.trial_ends_at) - Date.now()) / 86400000)
    : null;
  const msg = remain !== null && remain < 0
    ? `무료체험이 ${Math.abs(remain)}일 전에 만료됐습니다.`
    : '구독이 만료됐습니다.';

  const overlay = document.createElement('div');
  overlay.id = 'expired-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,27,45,.92);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:36px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="font-size:48px;margin-bottom:16px">⏰</div>
      <h2 style="font-size:20px;font-weight:900;color:#0f1b2d;margin-bottom:8px">서비스 이용 기간이 만료됐습니다</h2>
      <p style="font-size:14px;color:#8a94a6;margin-bottom:24px;line-height:1.7">${msg}<br>계속 이용하시려면 구독을 시작해주세요.<br><span style="font-size:12px">직원들의 출퇴근 기록은 안전하게 보존되고 있습니다.</span></p>
      <button id="btn-go-billing" style="width:100%;padding:14px;background:linear-gradient(135deg,#00c9a7,#00b096);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:10px">구독 시작하기 →</button>
      <button id="btn-expired-logout" style="width:100%;padding:12px;background:#f4f6f9;color:#8a94a6;border:none;border-radius:12px;font-size:13px;cursor:pointer">로그아웃</button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('btn-go-billing').addEventListener('click', () => {
    overlay.remove();
    bindNav();
    navigate('settings');
  });
  document.getElementById('btn-expired-logout').addEventListener('click', signOut);
}

function showTrialBadge(t) {
  if (!t) return;
  if (t.subscription_status === 'trialing') {
    const remain = Math.max(0, Math.ceil((new Date(t.trial_ends_at) - Date.now()) / 86400000));
    $('#trial-badge').textContent = `무료체험 D-${remain}`;
    $('#trial-badge').classList.add('active');
  } else if (t.subscription_status === 'active') {
    $('#trial-badge').textContent = `${t.plan?.toUpperCase() || 'PRO'} 구독중`;
    $('#trial-badge').classList.add('active', 'paid');
  } else {
    $('#trial-badge').textContent = '구독 만료';
    $('#trial-badge').classList.add('active', 'expired');
  }
}

function bindNav() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const route = item.dataset.route;
      navigate(route);
    });
  });

  // hashchange는 외부에서 뒤로가기/북마크로 이동할 때만 처리
  window.addEventListener('hashchange', () => {
    const r = location.hash.replace('#/', '') || 'overview';
    if (r !== currentRoute) navigate(r, true);
  });

  $('#btn-logout').addEventListener('click', signOut);

  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  $('#mobile-menu').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('active');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
  });
}

function applyFeatureLock(tenant) {
  $$('[data-feature]').forEach(item => {
    const feature = item.dataset.feature;
    const ok = canAccess(tenant, feature);
    item.classList.toggle('locked', !ok);
    if (!ok) {
      item.title = `유료 기능 — 구독 후 사용 가능`;
    }
  });
}

async function navigate(route, fromHash = false) {
  if (!ROUTES[route]) route = 'overview';

  // 무료/만료 상태에서 유료 기능 접근 차단 (슈퍼어드민 패널은 제외)
  if (route !== 'superadmin' && !canAccess(profile.tenants, route) && route !== 'overview') {
    showUpgradePrompt(route);
    return;
  }

  if (route === currentRoute && !fromHash) return;
  if (isNavigating) return;

  isNavigating = true;
  currentRoute = route;

  if (!fromHash) location.hash = `#/${route}`;
  $$('.nav-item').forEach(it => it.classList.toggle('active', it.dataset.route === route));
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.remove('active');

  const root = $('#view-root');
  // 이전 뷰 실시간 구독 정리
  if (root._teardown) { root._teardown(); root._teardown = null; }

  root.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    await ROUTES[route]({ root, profile });
  } catch (err) {
    console.error('[navigate]', err);
    root.innerHTML = `<div class="error-box">화면 로드 실패: ${err.message}</div>`;
    toast(err.message, 'error');
  } finally {
    isNavigating = false;
  }
}
