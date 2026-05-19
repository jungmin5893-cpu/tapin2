import { supabase } from '../../../lib/supabase.js';
import { toast } from '../../../lib/toast.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];


export async function renderMessages({ root, profile }) {
  root.innerHTML = `
    <div class="page-head">
      <h1>📢 공지 메시지</h1>
      <div class="page-sub">직원이 출근 QR 스캔 시 확인해야 할 메시지를 보냅니다</div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>새 메시지 작성</h2></div>
      <form id="form-msg" style="display:flex;flex-direction:column;gap:12px;padding:16px">
        <div>
          <label style="font-size:12px;font-weight:700;color:#3d4a5c;display:block;margin-bottom:5px">제목</label>
          <input id="msg-title" type="text" placeholder="메시지 제목" required
            style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#3d4a5c;display:block;margin-bottom:5px">내용</label>
          <textarea id="msg-body" rows="4" placeholder="직원에게 전달할 내용을 입력하세요" required
            style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit;resize:vertical"></textarea>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#3d4a5c;display:block;margin-bottom:8px">발송 대상</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="target-type-btns">
            <button type="button" class="target-btn active" data-type="all"
              style="padding:8px 16px;border-radius:20px;border:1.5px solid #00c9a7;background:rgba(0,201,167,.1);color:#00c9a7;font-weight:700;font-size:13px;cursor:pointer">전체 직원</button>
            <button type="button" class="target-btn" data-type="store"
              style="padding:8px 16px;border-radius:20px;border:1.5px solid #e2e7ef;background:#fff;color:#3d4a5c;font-weight:700;font-size:13px;cursor:pointer">현장별</button>
            <button type="button" class="target-btn" data-type="employee"
              style="padding:8px 16px;border-radius:20px;border:1.5px solid #e2e7ef;background:#fff;color:#3d4a5c;font-weight:700;font-size:13px;cursor:pointer">직원 개별</button>
          </div>
          <div id="target-select-wrap" style="margin-top:10px;display:none">
            <select id="target-select"
              style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
              <option value="">— 선택 —</option>
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#3d4a5c;display:block;margin-bottom:5px">
            발송 예약일 <span style="font-weight:400;color:#8a94a6">(선택 안 하면 즉시 발송)</span>
          </label>
          <input id="msg-date" type="date"
            style="width:100%;padding:10px 12px;border:1.5px solid #e2e7ef;border-radius:8px;font-size:14px;font-family:inherit">
        </div>
        <button type="submit" class="btn"
          style="background:linear-gradient(135deg,#00c9a7,#00b096);color:#fff;border:none;padding:12px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">
          📤 메시지 발송
        </button>
      </form>
    </div>

    <div class="card">
      <div class="card-head" style="display:flex;justify-content:space-between;align-items:center">
        <h2>발송된 메시지</h2>
        <button id="btn-refresh-msgs" class="btn small"
          style="padding:6px 12px;border-radius:6px;border:1px solid #e2e7ef;background:#fff;font-size:12px;cursor:pointer">↻ 새로고침</button>
      </div>
      <div id="msg-list" style="padding:8px 0">
        <div style="text-align:center;padding:32px;color:#8a94a6">불러오는 중…</div>
      </div>
    </div>
  `;

  let targetType = 'all';

  // 대상 타입 버튼
  $$('.target-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      targetType = btn.dataset.type;
      $$('.target-btn', root).forEach(b => {
        const active = b === btn;
        b.style.borderColor  = active ? '#00c9a7' : '#e2e7ef';
        b.style.background   = active ? 'rgba(0,201,167,.1)' : '#fff';
        b.style.color        = active ? '#00c9a7' : '#3d4a5c';
      });
      const wrap = $('#target-select-wrap', root);
      wrap.style.display = targetType === 'all' ? 'none' : 'block';
      if (targetType !== 'all') loadTargetOptions(targetType);
    });
  });

  async function loadTargetOptions(type) {
    const sel = $('#target-select', root);
    sel.innerHTML = '<option value="">불러오는 중…</option>';
    if (type === 'store') {
      const { data } = await supabase.from('stores')
        .select('id, name')
        .eq('tenant_id', profile.tenant_id)
        .order('name');
      sel.innerHTML = '<option value="">— 현장 선택 —</option>' +
        (data || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    } else {
      const { data } = await supabase.from('profiles')
        .select('id, name')
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'employee')
        .eq('active', true)
        .order('name');
      sel.innerHTML = '<option value="">— 직원 선택 —</option>' +
        (data || []).map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    }
  }

  // 폼 제출
  $('#form-msg', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '발송 중…';

    const title = $('#msg-title', root).value.trim();
    const body  = $('#msg-body', root).value.trim();
    const scheduledDate = $('#msg-date', root).value || null;
    const targetId = $('#target-select', root).value;

    if (targetType !== 'all' && !targetId) {
      toast('대상을 선택해주세요', 'error');
      btn.disabled = false; btn.textContent = '📤 메시지 발송';
      return;
    }

    const payload = {
      tenant_id: profile.tenant_id,
      title,
      body,
      target_type: targetType,
      target_store_id:    targetType === 'store'    ? targetId : null,
      target_employee_id: targetType === 'employee' ? targetId : null,
      scheduled_date: scheduledDate,
      active: true,
      created_by: profile.id,
    };

    const { error } = await supabase.from('messages').insert(payload);
    if (error) {
      toast('발송 실패: ' + error.message, 'error');
    } else {
      toast('메시지가 발송됐습니다', 'success');
      e.target.reset();
      $$('.target-btn', root).forEach((b, i) => {
        b.style.borderColor = i === 0 ? '#00c9a7' : '#e2e7ef';
        b.style.background  = i === 0 ? 'rgba(0,201,167,.1)' : '#fff';
        b.style.color       = i === 0 ? '#00c9a7' : '#3d4a5c';
      });
      targetType = 'all';
      $('#target-select-wrap', root).style.display = 'none';
      await loadMsgList();
    }
    btn.disabled = false; btn.textContent = '📤 메시지 발송';
  });

  $('#btn-refresh-msgs', root).addEventListener('click', loadMsgList);

  async function loadMsgList() {
    const list = $('#msg-list', root);
    list.innerHTML = '<div style="text-align:center;padding:32px;color:#8a94a6">불러오는 중…</div>';

    const { data: msgs, error } = await supabase
      .from('messages')
      .select('*, message_reads(count)')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });

    if (error || !msgs?.length) {
      list.innerHTML = '<div style="text-align:center;padding:32px;color:#8a94a6">발송된 메시지가 없습니다</div>';
      return;
    }

    list.innerHTML = msgs.map(m => {
      const readCount = m.message_reads?.[0]?.count ?? 0;
      const targetLabel =
        m.target_type === 'all'      ? '전체 직원' :
        m.target_type === 'store'    ? '현장별' : '개별 직원';
      const daysLabel = m.scheduled_date
        ? `${m.scheduled_date} 발송예약`
        : '즉시 발송';
      const statusColor = m.active ? '#00c9a7' : '#8a94a6';
      const statusLabel = m.active ? '활성' : '비활성';

      return `
        <div style="padding:14px 16px;border-bottom:1px solid #f0f3f7" data-msgid="${m.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:14px;color:#0f2942;margin-bottom:4px">${m.title}</div>
              <div style="font-size:13px;color:#3d4a5c;white-space:pre-wrap;margin-bottom:8px">${m.body}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px">
                <span style="background:#e0faf6;color:#00a88a;padding:2px 8px;border-radius:10px;font-weight:700">${targetLabel}</span>
                <span style="background:#f4f6f9;color:#3d4a5c;padding:2px 8px;border-radius:10px">${daysLabel}</span>
                <span style="background:#f4f6f9;color:#3d4a5c;padding:2px 8px;border-radius:10px">확인 ${readCount}명</span>
                <span style="color:${statusColor};font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid ${statusColor}">${statusLabel}</span>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
              <button class="btn-toggle-msg" data-id="${m.id}" data-active="${m.active}"
                style="padding:5px 10px;border-radius:6px;border:1px solid #e2e7ef;background:#fff;font-size:12px;cursor:pointer">
                ${m.active ? '비활성화' : '활성화'}
              </button>
              <button class="btn-del-msg" data-id="${m.id}"
                style="padding:5px 10px;border-radius:6px;border:1px solid #f04438;background:#fff;color:#f04438;font-size:12px;cursor:pointer">
                삭제
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 활성/비활성 토글
    $$('.btn-toggle-msg', root).forEach(btn => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active === 'true';
        const { error } = await supabase.from('messages')
          .update({ active: !active })
          .eq('id', btn.dataset.id);
        if (error) { toast('오류: ' + error.message, 'error'); return; }
        toast(active ? '비활성화됐습니다' : '활성화됐습니다', 'success');
        await loadMsgList();
      });
    });

    // 삭제
    $$('.btn-del-msg', root).forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('메시지를 삭제할까요? 확인 기록도 함께 삭제됩니다.')) return;
        const { error } = await supabase.from('messages').delete().eq('id', btn.dataset.id);
        if (error) { toast('삭제 실패: ' + error.message, 'error'); return; }
        toast('삭제됐습니다', 'success');
        await loadMsgList();
      });
    });
  }

  await loadMsgList();
}
