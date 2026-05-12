import { supabase } from '../../lib/supabase.js';
import { requireRole, signOut } from '../../lib/auth.js';
import { toast } from '../../lib/toast.js';
import { initOfflineBar } from '../../lib/network.js';
import { renderOverview } from './views/overview.js';
import { renderAttendance } from './views/attendance.js';
import { renderEmployees } from './views/employees.js';
import { renderStores } from './views/stores.js';
import { renderShifts } from './views/shifts.js';
import { renderPayroll } from './views/payroll.js';
import { renderSettings } from './views/settings.js';

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
};

init();

async function init() {
  profile = await requireRole('owner');
  if (!profile) return;

  $('#biz-name').textContent = profile.tenants?.name || '사업장';
  $('#owner-name').textContent = profile.name;

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

async function navigate(route, fromHash = false) {
  if (!ROUTES[route]) route = 'overview';
  if (route === currentRoute && !fromHash) return; // 같은 페이지 중복 방지
  if (isNavigating) return; // 로딩 중 중복 방지

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
