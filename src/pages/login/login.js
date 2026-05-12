import { supabase } from '../../lib/supabase.js';
import { signUpOwner, signInOwner, signUpEmployee, signInEmployee, getMyProfile, routeForRole } from '../../lib/auth.js';
import { toast } from '../../lib/toast.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const panels = {
  role: $('#panel-role'),
  ownerLogin: $('#panel-owner-login'),
  ownerSignup: $('#panel-owner-signup'),
  forgotPw: $('#panel-forgot-pw'),
  resetPw: $('#panel-reset-pw'),
  employeeLogin: $('#panel-emp-login'),
  employeeSignup: $('#panel-emp-signup'),
};

function showPanel(name) {
  Object.values(panels).forEach(p => p && p.classList.remove('active'));
  panels[name]?.classList.add('active');
  if (name === 'ownerSignup') setSignupCompletionMode(false);
}

function showSignupForCompletion() {
  Object.values(panels).forEach(p => p && p.classList.remove('active'));
  panels['ownerSignup']?.classList.add('active');
  setSignupCompletionMode(true);
}

function setSignupCompletionMode(isCompletion) {
  const emailGroup = $('#owner-email')?.closest('.form-group');
  const pwGroup = $('#owner-pw')?.closest('.form-group');
  const pwConfirmGroup = $('#owner-pw-confirm')?.closest('.form-group');
  if (!emailGroup || !pwGroup) return;
  if (isCompletion) {
    emailGroup.style.display = 'none';
    pwGroup.style.display = 'none';
    if (pwConfirmGroup) pwConfirmGroup.style.display = 'none';
    $('#owner-email').required = false;
    $('#owner-pw').required = false;
    $('#owner-pw-confirm').required = false;
  } else {
    emailGroup.style.display = '';
    pwGroup.style.display = '';
    if (pwConfirmGroup) pwConfirmGroup.style.display = '';
    $('#owner-email').required = true;
    $('#owner-pw').required = true;
    $('#owner-pw-confirm').required = true;
  }
}

// ── 비밀번호 강도 계산 ──────────────────────────────
function calcStrength(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 3); // 0~3
}

const STRENGTH_MAP = [
  { cls: '', label: '', color: '' },
  { cls: 'weak',   label: '취약 — 숫자·문자 조합을 권장합니다', color: '#f04438' },
  { cls: 'fair',   label: '보통',  color: '#f79009' },
  { cls: 'strong', label: '강함',  color: '#00c9a7' },
];

function bindPwStrength({ pwId, fillId, labelId, confirmId, matchId, minLen = 8 }) {
  const pw      = $(pwId);
  const fill    = $(fillId);
  const lbl     = $(labelId);
  const confirm = $(confirmId);
  const match   = $(matchId);
  if (!pw || !fill || !confirm) return;

  function updateStrength() {
    const s = pw.value.length < minLen && pw.value.length > 0
      ? 1
      : calcStrength(pw.value);
    const info = STRENGTH_MAP[s] || STRENGTH_MAP[0];
    fill.className = 'pw-strength-fill ' + info.cls;
    if (lbl) { lbl.textContent = info.label; lbl.style.color = info.color; }
    updateMatch();
  }

  function updateMatch() {
    if (!match) return;
    if (!confirm.value) { match.textContent = ''; return; }
    if (pw.value === confirm.value) {
      match.textContent = '✓';
      match.style.color = '#00c9a7';
    } else {
      match.textContent = '✗';
      match.style.color = '#f04438';
    }
  }

  pw.addEventListener('input', updateStrength);
  confirm.addEventListener('input', updateMatch);
}

// 사장 회원가입 비밀번호 강도·일치
bindPwStrength({
  pwId: '#owner-pw', fillId: '#owner-pw-strength-fill', labelId: '#owner-pw-strength-label',
  confirmId: '#owner-pw-confirm', matchId: '#owner-pw-match', minLen: 8,
});

// 직원 가입 비밀번호 강도·일치
bindPwStrength({
  pwId: '#emp-pw', fillId: '#emp-pw-strength-fill', labelId: '#emp-pw-strength-label',
  confirmId: '#emp-pw-confirm', matchId: '#emp-pw-match', minLen: 6,
});

// ── 이메일 재설정 링크 클릭 후 복귀 처리 ──────────
async function checkAuthCallback() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const type = hash.get('type');
  if (type === 'recovery') {
    // 비밀번호 재설정 링크로 접속한 경우
    showPanel('resetPw');
    return true;
  }
  if (type === 'signup') {
    toast('이메일 인증이 완료됐습니다. 로그인해주세요.', 'success', 4000);
    showPanel('ownerLogin');
    return true;
  }
  return false;
}

// 비밀번호 재설정 강도
bindPwStrength({
  pwId: '#reset-pw', fillId: '#reset-pw-strength-fill', labelId: '#reset-pw-strength-label',
  confirmId: '#reset-pw-confirm', matchId: '#reset-pw-match', minLen: 8,
});

// ── 이미 로그인된 경우 역할 페이지로 보내기 ──────────
async function redirectIfLoggedIn() {
  const handled = await checkAuthCallback();
  if (handled) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const profile = await getMyProfile();
  if (profile?.role) location.href = routeForRole(profile.role);
}
redirectIfLoggedIn();

// ── 비밀번호 찾기 링크 ────────────────────────────
$('#link-forgot-pw')?.addEventListener('click', (e) => {
  e.preventDefault();
  showPanel('forgotPw');
});

// ── 비밀번호 재설정 요청 ──────────────────────────
$('#form-forgot-pw')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '전송 중…';
  try {
    const email = $('#forgot-email').value.trim();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}login.html`,
    });
    if (error) throw error;
    toast('재설정 링크를 이메일로 보냈습니다. 메일함을 확인해주세요.', 'success', 5000);
    showPanel('ownerLogin');
  } catch (err) {
    toast(humanError(err), 'error');
    btn.disabled = false; btn.textContent = orig;
  }
});

// ── 비밀번호 재설정 (링크 클릭 후) ──────────────
$('#form-reset-pw')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '변경 중…';
  try {
    const pw = $('#reset-pw').value;
    const confirm = $('#reset-pw-confirm').value;
    if (pw.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다');
    if (pw !== confirm) throw new Error('비밀번호가 일치하지 않습니다');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw error;
    toast('비밀번호가 변경됐습니다. 로그인해주세요.', 'success', 4000);
    await supabase.auth.signOut();
    showPanel('ownerLogin');
  } catch (err) {
    toast(humanError(err), 'error');
    btn.disabled = false; btn.textContent = orig;
  }
});

// ── 역할 선택 ──────────────────────────────────────
$$('#panel-role .role-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const role = btn.dataset.role;
    if (role === 'owner') showPanel('ownerLogin');
    else showPanel('employeeLogin');
  });
});

// ── 패널 간 이동 ────────────────────────────────────
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (!target) return;
  e.preventDefault();
  showPanel(target.dataset.go);
});

// ── 비밀번호 토글 ───────────────────────────────────
document.addEventListener('click', (e) => {
  const eye = e.target.closest('.pw-eye');
  if (!eye) return;
  const input = eye.parentElement.querySelector('input');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  eye.textContent = input.type === 'password' ? '👁' : '🙈';
});

// ── 사장 로그인 ─────────────────────────────────────
$('#form-owner-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '로그인 중…';
  try {
    const email    = $('#owner-login-email').value.trim();
    const password = $('#owner-login-pw').value;
    await signInOwner({ email, password });
    const p = await getMyProfile();
    if (!p) {
      toast('사업장 정보를 마저 입력해주세요', 'info');
      showSignupForCompletion();
      return;
    }
    location.href = routeForRole(p.role);
  } catch (err) {
    toast(humanError(err), 'error');
    btn.disabled = false; btn.textContent = orig;
  }
});

// ── 사장 회원가입 ───────────────────────────────────
$('#form-owner-signup')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '계정 생성 중…';
  try {
    const ownerName    = $('#owner-name').value.trim();
    const businessName = $('#biz-name').value.trim();
    const businessType = $('#biz-type').value;

    // 이미 로그인된 상태(프로필 미완성)이면 bootstrap만
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { error } = await supabase.rpc('bootstrap_owner', {
        p_business_name: businessName,
        p_business_type: businessType,
        p_owner_name: ownerName,
      });
      if (error && error.message !== 'ALREADY_BOOTSTRAPPED') throw error;
      await supabase.auth.refreshSession();
      toast('가입 완료! 무료체험 7일이 시작됩니다.', 'success');
      location.href = 'dashboard.html';
      return;
    }

    // 신규 가입
    const email    = $('#owner-email').value.trim();
    const password = $('#owner-pw').value;
    const confirm  = $('#owner-pw-confirm').value;
    if (password.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다');
    if (password !== confirm) throw new Error('비밀번호가 일치하지 않습니다');

    const res = await signUpOwner({ email, password, businessName, businessType, ownerName });
    if (res.needsEmailConfirm) {
      toast('이메일로 확인 링크를 보냈습니다. 확인 후 로그인해주세요.', 'info', 4500);
      showPanel('ownerLogin');
      return;
    }
    toast('가입 완료! 무료체험 7일이 시작됩니다.', 'success');
    location.href = 'dashboard.html';
  } catch (err) {
    toast(humanError(err), 'error');
    btn.disabled = false; btn.textContent = orig;
  }
});

// ── 직원 로그인 ─────────────────────────────────────
$('#form-emp-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '로그인 중…';
  try {
    const phone    = $('#emp-login-phone').value.trim();
    const password = $('#emp-login-pw').value;
    await signInEmployee({ phone, password });
    const p = await getMyProfile();
    if (!p) throw new Error('직원 정보를 찾을 수 없습니다');
    location.href = routeForRole(p.role);
  } catch (err) {
    toast(humanError(err), 'error');
    btn.disabled = false; btn.textContent = orig;
  }
});

// ── 직원 가입 ───────────────────────────────────────
$('#form-emp-signup')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '확인 중…';
  try {
    const phone    = $('#emp-phone').value.trim();
    const code     = $('#emp-code').value.trim();
    const name     = $('#emp-name').value.trim();
    const password = $('#emp-pw').value;
    const confirm  = $('#emp-pw-confirm').value;
    if (password.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다');
    if (password !== confirm) throw new Error('비밀번호가 일치하지 않습니다');
    if (code.length !== 6)   throw new Error('가입 코드 6자리를 확인해주세요');
    const res = await signUpEmployee({ phone, code, name, password });
    if (res.needsEmailConfirm) {
      toast('관리자에게 이메일 확인 비활성을 요청해주세요', 'warn', 4500);
      return;
    }
    toast('가입 완료!', 'success');
    location.href = 'employee.html';
  } catch (err) {
    toast(humanError(err), 'error');
    btn.disabled = false; btn.textContent = orig;
  }
});

function humanError(err) {
  const msg = err?.message || String(err);
  const map = {
    'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다',
    'User already registered': '이미 가입된 이메일입니다',
    'INVALID_INVITE': '가입 코드가 만료되었거나 잘못되었습니다. 사장님께 확인해주세요',
    'PROFILE_NOT_FOUND': '직원 정보가 없습니다',
    'AUTH_REQUIRED': '로그인이 필요합니다',
    'ALREADY_BOOTSTRAPPED': '이미 가입된 계정입니다. 로그인해주세요',
  };
  return map[msg] || msg;
}
