import { supabase } from '../../../lib/supabase.js';
import { nowKst, kst, diffMinutes, minutesToHm } from '../../../lib/time.js';
import { toast } from '../../../lib/toast.js';
import * as XLSX from 'xlsx';

const NIGHT_EXTRA    = 0.5;   // 야간(22~06) 추가 50%
const OT_MULTIPLIER  = 1.5;   // 연장 150%
const DAILY_REG_MIN  = 8 * 60;
const WEEKLY_HOL_MIN = 15 * 60; // 주 15시간 이상 → 주휴수당

const DEDUCTION_RATE = {
  insurance:  0.094,  // 국민4.5+건강3.545+장기0.454+고용0.9
  freelancer: 0.033,
  none:       0,
};
const DEDUCTION_LABEL = {
  insurance:  '4대보험 9.4%',
  freelancer: '프리랜서 3.3%',
  none:       '없음',
};
const WAGE_LABEL = { hourly: '시급', daily: '일급', monthly: '월급' };

export async function renderPayroll({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>급여 정산</h1>
      <div class="page-sub">
        시급: 야간(22~06) +50% · 일 8h 초과 연장 · 주 15h 이상 주휴수당 자동 산입<br>
        일급: 근무일 × 일급 + 주휴수당 / 월급: 고정 월급 + 공제
      </div>
    </div>
    <div class="filter-bar">
      <input type="month" id="pay-month" value="${nowKst().format('YYYY-MM')}">
      <button class="btn primary" id="btn-calc">집계 다시 계산</button>
      <button class="btn" id="btn-export">📥 엑셀</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="att-table">
          <thead>
            <tr>
              <th>직원</th><th>급여방식</th><th>근무일</th><th>총 근무</th>
              <th>기본급</th><th>야간+연장</th><th>주휴수당</th>
              <th>공제</th><th>실수령</th><th></th>
            </tr>
          </thead>
          <tbody id="pay-rows">
            <tr><td colspan="10" class="empty">월을 선택하고 "집계 다시 계산"을 눌러주세요</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  root.querySelector('#btn-calc').addEventListener('click', () => calculate(root, profile));
  root.querySelector('#btn-export').addEventListener('click', () => exportExcel(root));
  await calculate(root, profile);
}

// 월요일 기준 주차 키
function weekKey(dateStr) {
  const d = new Date(dateStr);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

async function calculate(root, profile) {
  const m     = root.querySelector('#pay-month').value;
  const start = `${m}-01`;
  const [yy, mm] = m.split('-').map(Number);
  const end   = nowKst().year(yy).month(mm - 1).endOf('month').format('YYYY-MM-DD');

  // wage_type / deduction_type fallback
  let { data: rows, error } = await supabase
    .from('attendances')
    .select(`id, employee_id, check_in_at, check_out_at, workday,
      employee:profiles!attendances_employee_id_fkey(name, hourly_wage, wage_type, deduction_type)`)
    .eq('tenant_id', profile.tenant_id)
    .gte('workday', start)
    .lte('workday', end)
    .not('check_out_at', 'is', null);

  if (error && /wage_type|deduction_type/i.test(error.message)) {
    const fb = await supabase
      .from('attendances')
      .select(`id, employee_id, check_in_at, check_out_at, workday,
        employee:profiles!attendances_employee_id_fkey(name, hourly_wage)`)
      .eq('tenant_id', profile.tenant_id)
      .gte('workday', start)
      .lte('workday', end)
      .not('check_out_at', 'is', null);
    rows = fb.data; error = fb.error;
  }
  if (error) { toast(error.message, 'error'); return; }

  // 직원별 집계
  const byEmp = new Map();
  for (const r of rows || []) {
    const emp  = r.employee || {};
    const wt   = emp.wage_type || 'hourly';
    const wage = emp.hourly_wage || 10030;

    if (!byEmp.has(r.employee_id)) {
      byEmp.set(r.employee_id, {
        id: r.employee_id,
        name: emp.name || '(이름 없음)',
        wageType: wt,
        wage,
        deductionType: emp.deduction_type || 'insurance',
        days: new Set(),
        totalMin: 0, nightMin: 0, otMin: 0,
        byDay: {}, byWeek: {},
      });
    }
    const e   = byEmp.get(r.employee_id);
    const inT = kst(r.check_in_at), outT = kst(r.check_out_at);
    const min = diffMinutes(r.check_in_at, r.check_out_at);

    e.days.add(r.workday);
    e.totalMin += min;
    e.nightMin += calcNightMinutes(inT, outT);
    e.byDay[r.workday]  = (e.byDay[r.workday]  || 0) + min;
    const wk = weekKey(r.workday);
    e.byWeek[wk] = (e.byWeek[wk] || 0) + min;
  }

  // 연장·주휴수당 산정 (시급·일급 공통, 월급은 스킵)
  for (const e of byEmp.values()) {
    e.otMin = 0;
    for (const dayMin of Object.values(e.byDay)) {
      if (dayMin > DAILY_REG_MIN) e.otMin += dayMin - DAILY_REG_MIN;
    }
    e.holidayPay = 0;
    if (e.wageType !== 'monthly') {
      for (const weekMin of Object.values(e.byWeek)) {
        if (weekMin >= WEEKLY_HOL_MIN) {
          // 주휴수당 = (주간근무시간 / 40h) × 8h × 시급환산
          const hourlyEquiv = e.wageType === 'daily' ? (e.wage / 8) : e.wage;
          e.holidayPay += Math.round((weekMin / 60 / 40) * 8 * hourlyEquiv);
        }
      }
    }
  }

  const tbody = root.querySelector('#pay-rows');
  if (!byEmp.size) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">집계할 기록이 없습니다</td></tr>';
    return;
  }

  const period = start;
  const upsertRows = [];
  const tableHtml  = [];

  for (const e of byEmp.values()) {
    let basePay = 0, nightPay = 0, otPay = 0;

    if (e.wageType === 'monthly') {
      // 월급: 고정 금액
      basePay  = e.wage;
      nightPay = 0;
      otPay    = 0;
    } else if (e.wageType === 'daily') {
      // 일급: 근무일 × 일급
      basePay  = e.days.size * e.wage;
      nightPay = 0;
      otPay    = 0;
    } else {
      // 시급: 시간 기반 + 야간 + 연장
      const regularMin = e.totalMin - e.otMin;
      basePay  = Math.round((regularMin / 60) * e.wage);
      nightPay = Math.round((e.nightMin / 60) * e.wage * NIGHT_EXTRA);
      otPay    = Math.round((e.otMin    / 60) * e.wage * OT_MULTIPLIER);
    }

    const grossPay   = basePay + nightPay + otPay + e.holidayPay;
    const rate       = DEDUCTION_RATE[e.deductionType] || 0;
    const deductions = Math.round(grossPay * rate);
    const net        = grossPay - deductions;
    const addPay     = nightPay + otPay;

    upsertRows.push({
      tenant_id: profile.tenant_id, employee_id: e.id, period,
      total_minutes: e.totalMin,
      regular_minutes: e.wageType === 'hourly' ? e.totalMin - e.otMin : e.totalMin,
      overtime_minutes: e.otMin,
      night_minutes: e.nightMin,
      base_pay: basePay, overtime_pay: otPay, night_pay: nightPay,
      deductions, net_pay: net, status: 'draft',
    });

    tableHtml.push(`
      <tr>
        <td><strong>${e.name}</strong></td>
        <td><span class="badge-wage wage-${e.wageType}">${WAGE_LABEL[e.wageType] || '시급'}</span></td>
        <td>${e.days.size}일</td>
        <td>${minutesToHm(e.totalMin)}</td>
        <td>${basePay.toLocaleString()}원</td>
        <td>${addPay > 0
          ? `<span style="color:#f79009">+${addPay.toLocaleString()}원</span>`
          : e.wageType === 'hourly'
            ? '<span class="muted">-</span>'
            : '<span class="muted" title="일급·월급은 별도 협의">-</span>'}</td>
        <td>${e.holidayPay > 0
          ? `<span style="color:#00c9a7">+${e.holidayPay.toLocaleString()}원</span>`
          : '<span class="muted">-</span>'}</td>
        <td title="${DEDUCTION_LABEL[e.deductionType] || ''}">${deductions > 0
          ? `-${deductions.toLocaleString()}원`
          : '<span class="muted">없음</span>'}</td>
        <td><strong>${net.toLocaleString()}원</strong></td>
        <td><button class="btn small ghost" disabled title="PDF 명세서는 곧 추가됩니다">PDF</button></td>
      </tr>
    `);
  }

  tbody.innerHTML = tableHtml.join('');
  root._payRows = upsertRows;

  const { error: upErr } = await supabase
    .from('payrolls')
    .upsert(upsertRows, { onConflict: 'employee_id,period' });
  if (upErr) toast(`저장 실패: ${upErr.message}`, 'error');
}

function calcNightMinutes(inT, outT) {
  let total = 0;
  let cursor = inT.clone();
  while (cursor.isBefore(outT)) {
    const dayStart = cursor.clone().startOf('day');
    for (const seg of [
      { start: dayStart.clone().hour(22), end: dayStart.clone().hour(24) },
      { start: dayStart.clone(),           end: dayStart.clone().hour(6)  },
    ]) {
      const s = cursor.isAfter(seg.start)  ? cursor   : seg.start;
      const e = outT.isBefore(seg.end)     ? outT     : seg.end;
      if (e.isAfter(s)) total += e.diff(s, 'minute');
    }
    cursor = dayStart.add(1, 'day');
    if (cursor.isAfter(outT)) break;
  }
  return Math.max(0, total);
}

function exportExcel(root) {
  const rows = root._payRows;
  if (!rows?.length) { toast('내보낼 데이터가 없습니다', 'warn'); return; }
  const aoa = [[
    '직원ID', '기간', '급여방식', '총분', '기본급',
    '야간수당', '연장수당', '주휴수당', '공제', '실수령',
  ]];
  for (const r of rows) {
    aoa.push([
      r.employee_id, r.period, r.wage_type || '-',
      r.total_minutes, r.base_pay,
      r.night_pay, r.overtime_pay,
      r.holiday_pay || 0, r.deductions, r.net_pay,
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '급여');
  XLSX.writeFile(wb, `TAGIN_급여_${rows[0].period.slice(0, 7)}.xlsx`);
  toast('엑셀 다운로드 완료', 'success');
}
