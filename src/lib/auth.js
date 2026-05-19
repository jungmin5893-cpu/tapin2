import { supabase, decodeJwt } from './supabase.js';

const ROUTE = {
  owner:   'dashboard.html',
  manager: 'dashboard.html',
  employee: 'employee.html',
  none: 'login.html',
};

export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // 먼저 profiles + tenants 조인 시도
  const { data, error } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, store_id, name, phone, email, hourly_wage, wage_type, deduction_type, position, active, is_super_admin, tenants(name, business_type, industry_type, plan, subscription_status, trial_ends_at, peak_employee_count)')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[auth.getMyProfile] join error, retrying without tenants:', error.message);
    // 조인 실패 시 profiles만 조회
    const { data: d2, error: e2 } = await supabase
      .from('profiles')
      .select('id, tenant_id, role, store_id, name, phone, email, hourly_wage, wage_type, deduction_type, position, active, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (e2) {
      console.warn('[auth.getMyProfile]', e2.message);
      return null;
    }
    return d2;
  }

  return data; // tenants가 null이어도 profile 자체는 반환
}

export async function getClaims() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return decodeJwt(data.session.access_token);
}

export function routeForRole(role) {
  return ROUTE[role] || ROUTE.none;
}

export async function requireRole(allowed) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.href = 'login.html';
    return null;
  }
  const profile = await getMyProfile();
  if (!profile) {
    location.href = 'login.html';
    return null;
  }
  if (!profile.role) {
    location.href = 'login.html';
    return null;
  }
  if (Array.isArray(allowed) ? !allowed.includes(profile.role) : profile.role !== allowed) {
    location.href = routeForRole(profile.role);
    return null;
  }
  return profile;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.href = 'login.html';
}

// 사장 회원가입
export async function signUpOwner({ email, password, businessName, businessType, ownerName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: ownerName } },
  });
  if (error) throw error;
  if (!data.session) {
    return { needsEmailConfirm: true };
  }
  const { error: rpcErr } = await supabase.rpc('bootstrap_owner', {
    p_business_name:  businessName,
    p_business_type:  businessType,
    p_owner_name:     ownerName,
    p_industry_type:  businessType,   // 0009 migration: industry_type 직접 저장
  });
  if (rpcErr && rpcErr.message !== 'ALREADY_BOOTSTRAPPED') throw rpcErr;
  await supabase.auth.refreshSession();
  return { ok: true };
}

// 사장 로그인
export async function signInOwner({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// 직원 가입
export async function signUpEmployee({ phone, code, name, password }) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const email = `emp_${cleanPhone}@tagin.local`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: name, phone } },
  });
  if (error) throw error;
  if (!data.session) {
    return { needsEmailConfirm: true };
  }
  const { data: claim, error: cErr } = await supabase.rpc('claim_employee_invite', {
    p_phone: phone, p_code: code, p_name: name,
  });
  if (cErr) throw cErr;
  await supabase.auth.refreshSession();
  return { ok: true, claim };
}

export async function signInEmployee({ phone, password }) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const email = `emp_${cleanPhone}@tagin.local`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
