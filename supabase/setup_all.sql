-- ============================================================
-- TAGIN — 완전 초기화 + 셋업 (한 번에 실행)
-- 기존 테이블이 있어도 모두 지우고 새로 만듭니다
-- Supabase SQL Editor에 전체 복사 후 RUN 클릭
-- ============================================================

-- ① 기존 오브젝트 정리 (역순 삭제) ----------------------------
drop table if exists requests cascade;
drop table if exists push_subscriptions cascade;
drop table if exists subscriptions cascade;
drop table if exists payrolls cascade;
drop table if exists employee_invites cascade;
drop table if exists attendances cascade;
drop table if exists employee_shifts cascade;
drop table if exists shift_types cascade;
drop table if exists profiles cascade;
drop table if exists stores cascade;
drop table if exists tenants cascade;

drop function if exists set_jwt_claims(jsonb) cascade;
drop function if exists bootstrap_owner(text,text,text) cascade;
drop function if exists claim_employee_invite(text,text,text) cascade;
drop function if exists check_in_or_out(uuid,text,numeric,numeric) cascade;
drop function if exists attendances_set_workday() cascade;
drop function if exists resolve_shift(uuid,timestamptz) cascade;
drop function if exists current_role_name() cascade;
drop function if exists current_tenant_id() cascade;
drop view if exists monthly_attendance_summary cascade;

-- ② Extensions -------------------------------------------------
create extension if not exists "pgcrypto";

-- ③ 테이블 생성 -----------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type text,
  plan text not null default 'trial',
  subscription_status text not null default 'trialing',
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  qr_secret text not null default replace(gen_random_uuid()::text, '-', ''),
  gps_lat numeric,
  gps_lng numeric,
  gps_radius_m int not null default 100,
  gps_required boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_stores_tenant on stores(tenant_id);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null check (role in ('owner','employee')),
  store_id uuid references stores(id),
  name text not null,
  phone text,
  email text,
  hourly_wage int default 10030,
  wage_type text not null default 'hourly' check (wage_type in ('hourly','daily','monthly')),
  deduction_type text not null default 'insurance' check (deduction_type in ('insurance','freelancer','none')),
  position text,
  hire_date date default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_profiles_tenant on profiles(tenant_id);
create index idx_profiles_store on profiles(store_id);
create index idx_profiles_phone on profiles(phone);

create table shift_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  is_overnight boolean generated always as (end_time <= start_time) stored,
  color text not null default '#00c9a7',
  break_minutes int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_shift_types_tenant on shift_types(tenant_id);

create table employee_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  shift_type_id uuid references shift_types(id),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now()
);
create index idx_emp_shifts_employee on employee_shifts(employee_id, weekday);

create table attendances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  shift_type_id uuid references shift_types(id),
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  workday date not null,
  source text not null default 'qr',
  gps_lat numeric,
  gps_lng numeric,
  note text,
  created_at timestamptz not null default now()
);
create index idx_att_tenant_workday on attendances(tenant_id, workday desc);
create index idx_att_employee_workday on attendances(employee_id, workday desc);
create unique index attendance_open_unique
  on attendances(employee_id, workday) where check_out_at is null;

create table employee_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  phone text not null,
  name text,
  code text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_invites_phone_code on employee_invites(phone, code);

create table payrolls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  period date not null,
  total_minutes int not null default 0,
  regular_minutes int not null default 0,
  overtime_minutes int not null default 0,
  night_minutes int not null default 0,
  base_pay int not null default 0,
  overtime_pay int not null default 0,
  night_pay int not null default 0,
  deductions int not null default 0,
  net_pay int not null default 0,
  pdf_url text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique(employee_id, period)
);
create index idx_payrolls_tenant_period on payrolls(tenant_id, period desc);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  toss_billing_key text,
  toss_customer_key text,
  plan text not null,
  amount int not null,
  status text not null default 'pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_requests_tenant_status on requests(tenant_id, status);

-- ④ RLS 헬퍼 함수 ---------------------------------------------
create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), ''),
    nullif((auth.jwt() ->> 'tenant_id'), '')
  )::uuid
$$;

create or replace function current_role_name() returns text
language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata') ->> 'role',
    auth.jwt() ->> 'role'
  )
$$;

-- ⑤ RLS 활성화 + 정책 -----------------------------------------
alter table profiles enable row level security;
create policy "profiles_select" on profiles for select
  using (tenant_id = current_tenant_id());
create policy "profiles_owner_write" on profiles for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "profiles_self_update" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and tenant_id = current_tenant_id());

alter table tenants enable row level security;
create policy "tenants_select" on tenants for select
  using (id = current_tenant_id());
create policy "tenants_owner_update" on tenants for update
  using (id = current_tenant_id() and current_role_name() = 'owner');

alter table stores enable row level security;
create policy "stores_select" on stores for select
  using (tenant_id = current_tenant_id());
create policy "stores_owner_all" on stores for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

alter table shift_types enable row level security;
create policy "shift_types_select" on shift_types for select
  using (tenant_id = current_tenant_id());
create policy "shift_types_owner_all" on shift_types for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

alter table employee_shifts enable row level security;
create policy "emp_shifts_select" on employee_shifts for select
  using (tenant_id = current_tenant_id());
create policy "emp_shifts_owner_all" on employee_shifts for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

alter table attendances enable row level security;
create policy "att_owner_all" on attendances for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "att_employee_own" on attendances for select
  using (tenant_id = current_tenant_id() and employee_id = auth.uid());

alter table employee_invites enable row level security;
create policy "invites_owner_all" on employee_invites for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

alter table payrolls enable row level security;
create policy "payrolls_owner_all" on payrolls for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "payrolls_employee_own" on payrolls for select
  using (tenant_id = current_tenant_id() and employee_id = auth.uid());

alter table subscriptions enable row level security;
create policy "subs_owner_all" on subscriptions for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');

alter table push_subscriptions enable row level security;
create policy "push_self" on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and tenant_id = current_tenant_id());

alter table requests enable row level security;
create policy "requests_owner_all" on requests for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'owner')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'owner');
create policy "requests_employee_own" on requests for all
  using (tenant_id = current_tenant_id() and employee_id = auth.uid())
  with check (tenant_id = current_tenant_id() and employee_id = auth.uid());

-- ⑥ 핵심 함수 -------------------------------------------------

-- 시프트 해상도
create or replace function resolve_shift(p_emp uuid, p_ts timestamptz)
returns table(shift_type_id uuid, workday date)
language plpgsql stable as $$
declare
  v_local timestamp := (p_ts at time zone 'Asia/Seoul');
  v_today date := v_local::date;
  v_yday date  := v_today - 1;
  v_time time  := v_local::time;
begin
  return query
  select st.id, v_yday
    from employee_shifts es
    join shift_types st on st.id = es.shift_type_id
   where es.employee_id = p_emp
     and es.weekday = extract(dow from v_yday)::smallint
     and st.is_overnight
     and v_local >= ((v_yday::timestamp) + st.start_time)
     and v_local <  ((v_today::timestamp) + st.end_time)
     and v_yday >= es.effective_from
     and (es.effective_to is null or v_yday <= es.effective_to)
   order by es.effective_from desc
   limit 1;
  if found then return; end if;

  return query
  select st.id, v_today
    from employee_shifts es
    join shift_types st on st.id = es.shift_type_id
   where es.employee_id = p_emp
     and es.weekday = extract(dow from v_today)::smallint
     and (
       (not st.is_overnight and v_time >= st.start_time and v_time < st.end_time)
       or (st.is_overnight and v_time >= st.start_time)
     )
     and v_today >= es.effective_from
     and (es.effective_to is null or v_today <= es.effective_to)
   order by es.effective_from desc
   limit 1;
end $$;

-- workday 자동 채움 트리거
create or replace function attendances_set_workday()
returns trigger language plpgsql as $$
declare v_shift uuid; v_workday date;
begin
  if NEW.workday is null or NEW.shift_type_id is null then
    select shift_type_id, workday into v_shift, v_workday
      from resolve_shift(NEW.employee_id, NEW.check_in_at);
    if v_workday is null then
      v_workday := (NEW.check_in_at at time zone 'Asia/Seoul')::date;
    end if;
    if NEW.workday is null then NEW.workday := v_workday; end if;
    if NEW.shift_type_id is null then NEW.shift_type_id := v_shift; end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_att_set_workday on attendances;
create trigger trg_att_set_workday
  before insert on attendances
  for each row execute function attendances_set_workday();

-- QR 자동 출/퇴근 판정
create or replace function check_in_or_out(
  p_store uuid,
  p_qr_secret text,
  p_lat numeric default null,
  p_lng numeric default null
) returns jsonb
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_emp uuid := auth.uid();
  v_tenant uuid; v_workday date; v_shift uuid;
  v_row attendances; v_profile profiles;
begin
  if v_emp is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_profile from profiles where id = v_emp;
  if v_profile.id is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if not v_profile.active then raise exception 'EMPLOYEE_INACTIVE'; end if;

  select tenant_id into v_tenant from stores
   where id = p_store and qr_secret = p_qr_secret;
  if v_tenant is null then raise exception 'INVALID_QR'; end if;
  if v_tenant <> v_profile.tenant_id then raise exception 'TENANT_MISMATCH'; end if;

  select shift_type_id, workday into v_shift, v_workday
    from resolve_shift(v_emp, now());
  if v_workday is null then
    v_workday := (now() at time zone 'Asia/Seoul')::date;
  end if;

  select * into v_row from attendances
   where employee_id = v_emp and workday = v_workday and check_out_at is null
   order by check_in_at desc limit 1;

  if v_row.id is null then
    insert into attendances(tenant_id,store_id,employee_id,shift_type_id,check_in_at,workday,gps_lat,gps_lng,source)
    values (v_tenant,p_store,v_emp,v_shift,now(),v_workday,p_lat,p_lng,'qr')
    returning * into v_row;
    return jsonb_build_object('action','check_in','at',v_row.check_in_at,'workday',v_row.workday,'shift_type_id',v_row.shift_type_id);
  else
    update attendances set check_out_at=now() where id=v_row.id returning * into v_row;
    return jsonb_build_object('action','check_out','at',v_row.check_out_at,'in_at',v_row.check_in_at,'workday',v_row.workday,
      'duration_minutes', extract(epoch from (v_row.check_out_at - v_row.check_in_at))/60);
  end if;
end $$;
revoke all on function check_in_or_out(uuid,text,numeric,numeric) from public;
grant execute on function check_in_or_out(uuid,text,numeric,numeric) to authenticated;

-- 직원 초대 코드 검증 + 프로필 생성
create or replace function claim_employee_invite(p_phone text, p_code text, p_name text)
returns jsonb language plpgsql security definer
set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_inv employee_invites;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_inv from employee_invites
   where phone=p_phone and code=p_code and used_at is null and expires_at>now()
   order by created_at desc limit 1;
  if v_inv.id is null then raise exception 'INVALID_INVITE'; end if;

  insert into profiles(id,tenant_id,role,store_id,name,phone,active)
  values (v_uid,v_inv.tenant_id,'employee',v_inv.store_id,p_name,p_phone,true)
  on conflict (id) do update
    set tenant_id=excluded.tenant_id, store_id=excluded.store_id,
        name=excluded.name, phone=excluded.phone, active=true;

  update employee_invites set used_at=now() where id=v_inv.id;
  return jsonb_build_object('tenant_id',v_inv.tenant_id,'store_id',v_inv.store_id,'name',p_name);
end $$;
grant execute on function claim_employee_invite(text,text,text) to authenticated;

-- 사장 초기 부트스트랩 (가입 직후 1회 호출)
create or replace function bootstrap_owner(p_business_name text, p_business_type text, p_owner_name text)
returns jsonb language plpgsql security definer
set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_tenant_id uuid; v_email text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if exists (select 1 from profiles where id=v_uid) then
    raise exception 'ALREADY_BOOTSTRAPPED';
  end if;
  select email into v_email from auth.users where id=v_uid;
  insert into tenants(name,business_type) values (p_business_name,p_business_type) returning id into v_tenant_id;
  insert into profiles(id,tenant_id,role,name,email) values (v_uid,v_tenant_id,'owner',p_owner_name,v_email);

  if p_business_type = 'office' then
    insert into shift_types(tenant_id,name,start_time,end_time,color,break_minutes) values
      (v_tenant_id,'주간조','09:00','18:00','#00c9a7',60);
  elsif p_business_type = 'retail' then
    insert into shift_types(tenant_id,name,start_time,end_time,color,break_minutes) values
      (v_tenant_id,'오전조','08:00','14:00','#00c9a7',0),
      (v_tenant_id,'오후조','14:00','22:00','#7c3aed',0);
  elsif p_business_type = 'field' then
    insert into shift_types(tenant_id,name,start_time,end_time,color,break_minutes) values
      (v_tenant_id,'주간조','08:00','17:00','#00c9a7',60),
      (v_tenant_id,'야간조','22:00','07:00','#1565c0',30);
  else
    insert into shift_types(tenant_id,name,start_time,end_time,color,break_minutes) values
      (v_tenant_id,'주간','09:00','18:00','#00c9a7',0);
  end if;

  return jsonb_build_object('tenant_id',v_tenant_id);
end $$;
grant execute on function bootstrap_owner(text,text,text) to authenticated;

-- JWT custom claims (Auth Hook 등록용)
create or replace function set_jwt_claims(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  v_uid uuid := (event->>'user_id')::uuid;
  v_tenant uuid; v_role text;
  v_claims jsonb := coalesce(event->'claims','{}');
begin
  select tenant_id, role into v_tenant, v_role from profiles where id=v_uid;
  if v_tenant is not null then
    v_claims := jsonb_set(v_claims,'{tenant_id}',to_jsonb(v_tenant::text));
    v_claims := jsonb_set(v_claims,'{role}',to_jsonb(v_role));
  end if;
  return jsonb_build_object('claims',v_claims);
end $$;
grant execute on function set_jwt_claims(jsonb) to supabase_auth_admin;

-- ⑦ 집계 뷰 --------------------------------------------------
create or replace view monthly_attendance_summary as
select
  a.tenant_id, a.employee_id,
  date_trunc('month',a.workday)::date as period,
  count(*) filter (where a.check_out_at is not null) as days_worked,
  sum(extract(epoch from (a.check_out_at-a.check_in_at))/60)::int
    filter (where a.check_out_at is not null) as total_minutes
from attendances a
group by a.tenant_id, a.employee_id, date_trunc('month',a.workday);

-- ⑧ Realtime --------------------------------------------------
alter publication supabase_realtime add table attendances;
alter publication supabase_realtime add table requests;

-- 완료! -------------------------------------------------------
select 'TAGIN 셋업 완료 ✓' as result;
