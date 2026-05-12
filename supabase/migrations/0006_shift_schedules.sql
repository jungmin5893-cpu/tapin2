-- ============================================================
-- 0006. 날짜별 시프트 스케줄 (캘린더형 시프트 관리)
-- ============================================================
-- 기존 employee_shifts(요일 패턴)은 폴백/시드용으로 유지
-- shift_schedules가 우선 적용됨
-- ============================================================

-- ① 테이블 ----------------------------------------------------
create table if not exists shift_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  work_date date not null,
  shift_type_id uuid references shift_types(id) on delete set null,  -- NULL = 휴무
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists idx_shift_schedules_tenant_date
  on shift_schedules(tenant_id, work_date);
create index if not exists idx_shift_schedules_store_date
  on shift_schedules(store_id, work_date);
create index if not exists idx_shift_schedules_emp_date
  on shift_schedules(employee_id, work_date);

-- ② RLS -------------------------------------------------------
alter table shift_schedules enable row level security;

drop policy if exists shift_schedules_sel on shift_schedules;
create policy shift_schedules_sel on shift_schedules
  for select using (tenant_id = current_tenant_id());

drop policy if exists shift_schedules_ins on shift_schedules;
create policy shift_schedules_ins on shift_schedules
  for insert with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'owner'
  );

drop policy if exists shift_schedules_upd on shift_schedules;
create policy shift_schedules_upd on shift_schedules
  for update using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'owner'
  );

drop policy if exists shift_schedules_del on shift_schedules;
create policy shift_schedules_del on shift_schedules
  for delete using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'owner'
  );

-- ③ updated_at 자동 갱신 트리거 ---------------------------------
create or replace function shift_schedules_touch_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end $$;

drop trigger if exists trg_shift_schedules_touch on shift_schedules;
create trigger trg_shift_schedules_touch
  before update on shift_schedules
  for each row execute function shift_schedules_touch_updated_at();

-- ④ resolve_shift 함수 재정의 ----------------------------------
-- 우선순위: shift_schedules(날짜별) > employee_shifts(요일 폴백)
create or replace function resolve_shift(p_emp uuid, p_ts timestamptz)
returns table(shift_type_id uuid, workday date)
language plpgsql stable as $$
declare
  v_local timestamp := (p_ts at time zone 'Asia/Seoul');
  v_today date := v_local::date;
  v_yday  date := v_today - 1;
  v_time  time := v_local::time;
begin
  -- (1A) 어제 날짜 배정의 야간 시프트 (날짜별 우선)
  return query
  select st.id, v_yday
    from shift_schedules ss
    join shift_types st on st.id = ss.shift_type_id
   where ss.employee_id = p_emp
     and ss.work_date = v_yday
     and st.is_overnight
     and v_local >= ((v_yday::timestamp) + st.start_time)
     and v_local <  ((v_today::timestamp) + st.end_time)
   limit 1;
  if found then return; end if;

  -- (1B) 오늘 날짜 배정의 시프트 (날짜별 우선)
  return query
  select st.id, v_today
    from shift_schedules ss
    join shift_types st on st.id = ss.shift_type_id
   where ss.employee_id = p_emp
     and ss.work_date = v_today
     and (
       (not st.is_overnight and v_time >= st.start_time and v_time < st.end_time)
       or (st.is_overnight and v_time >= st.start_time)
     )
   limit 1;
  if found then return; end if;

  -- (2A) 폴백: 어제 요일의 야간 시프트 (employee_shifts)
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

  -- (2B) 폴백: 오늘 요일 시프트 (employee_shifts)
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

comment on function resolve_shift is '날짜별 shift_schedules 우선, 요일 employee_shifts 폴백';

-- ⑤ 한 주의 스케줄을 다음 주로 복사 (오프셋: 일 단위) -----------
create or replace function copy_schedules_range(
  p_tenant uuid,
  p_store uuid,
  p_src_start date,
  p_src_end date,
  p_dst_start date,
  p_replace boolean default true
) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_offset int := p_dst_start - p_src_start;
  v_count int;
begin
  if v_offset = 0 then return 0; end if;

  if p_replace then
    delete from shift_schedules
     where tenant_id = p_tenant
       and (p_store is null or store_id = p_store)
       and work_date between p_dst_start
                         and (p_src_end + v_offset);
  end if;

  insert into shift_schedules
    (tenant_id, store_id, employee_id, work_date, shift_type_id, note)
  select tenant_id, store_id, employee_id, work_date + v_offset, shift_type_id, note
    from shift_schedules
   where tenant_id = p_tenant
     and (p_store is null or store_id = p_store)
     and work_date between p_src_start and p_src_end
  on conflict (employee_id, work_date) do update
    set shift_type_id = excluded.shift_type_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function copy_schedules_range(uuid, uuid, date, date, date, boolean) to authenticated;

comment on function copy_schedules_range is '기간 단위로 시프트 스케줄을 복사 (이전 주 → 다음 주 등)';
