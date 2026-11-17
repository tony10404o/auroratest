document.getElementById('updatedAt').textContent = UPDATED_AT;

function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

const SHOW_LIMIT = 5;

/**
 * 通用「顯示更多」：適用一般區塊(div列表)，超過limit筆的收合，用按鈕展開/收合
 */
function withShowMore(itemHtmls){
  return itemHtmls.join('');
}

/**
 * 表格專用「顯示更多」：多出的<tr>放進獨立的<tbody id="...">並預設隱藏，
 * 按鈕放在表格外面，用id而不是相鄰元素來toggle
 */
function emptyNote(){ return `<div class="empty-note">目前沒有資料</div>`; }

// 事件是否落在指定分頁範圍：「今天」看第一次被抓到的日期（first_seen，來源發布日期常是前幾天），
// 「本月」等其他範圍仍看事件日期
function eventInRange(e, rangeDays){
  if (rangeDays === 1) {
    // 「今天」＝最近一批新抓到的事件（今天沒有新資料時，顯示最近一次更新的那批，避免空白）
    if (!e.first_seen) return isWithinCalendarDays(e.date, 1);
    const seen = (DATA.global_events || []).map(x => x.first_seen).filter(Boolean).sort();
    return e.first_seen === seen[seen.length - 1];
  }
  return isWithinCalendarDays(e.date, rangeDays);
}

// 用「日曆天數」而非精確24小時區間比對日期，避免事件日期(只有年月日、視為UTC午夜)跟目前時間比較時
// 因為時區／當下時刻差異，導致「今天」分類篩不到今天剛發布、但還不滿24小時的項目
function isWithinCalendarDays(dateStr, rangeDays){
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  const now = new Date();
  const todayMidnightUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((todayMidnightUTC - d.getTime()) / 86400000);
  return diffDays <= (rangeDays - 1);
}

function panelShell(num, icon, title, viewAllUrl, bodyHtml, extraHeaderHtml='', numColor='', count=null, badgeId=''){
  return `<div class="panel">
    <div class="panel-header">
      <span class="panel-num"${numColor ? ` style="color:${numColor}"` : ''}>${num}</span>
      <span class="panel-icon">${icon}</span>
      <span class="panel-title">${escapeHtml(title)}</span>
      ${count !== null ? `<span class="panel-count-badge"${badgeId ? ` id="${badgeId}"` : ''} style="${numColor ? `color:${numColor};background:${numColor}14;` : ''}">${count} 件</span>` : ''}
      ${badgeId === 'windowsUpdateBadge' ? '<span style="font-size:10.5px;color:var(--text-dim);white-space:nowrap;">待處理＋處理中</span>' : ''}
      ${viewAllUrl ? `<a class="panel-viewall" href="${escapeHtml(viewAllUrl)}" target="_blank" rel="noopener noreferrer">查看全部 →</a>` : ''}
    </div>
    ${extraHeaderHtml}
    <div class="panel-body">${bodyHtml}</div>
  </div>`;
}

/* ---------- Panel 1: 今日資安頭條 ---------- */
function renderHeadlines(items){
  if (!items || !items.length) return emptyNote();
  const rows = items.map((h, i) => `
    <div class="headline-row">
      <div class="headline-num">${i+1}</div>
      <div class="headline-body">
        <div class="headline-title-row">
          <div class="headline-title">${h.icon ? h.icon + ' ' : ''}${h.url ? `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.title)}</a>` : escapeHtml(h.title)}</div>
          <div class="headline-title-tags">
            ${h.impact ? `<span class="impact-badge impact-${escapeHtml(h.impact)}">${escapeHtml(h.impact)}風險</span>` : ''}
            ${h.stars ? `<span class="stars">${'★'.repeat(h.stars)}${'☆'.repeat(5-h.stars)}</span>` : ''}
          </div>
        </div>
        ${h.subtitle ? `<div class="headline-sub">${escapeHtml(h.subtitle)}</div>` : ''}
      </div>
    </div>`);
  return withShowMore(rows);
}

/* ---------- Panel 2: 全球重大事件 ---------- */
const CATEGORY_COLORS = {
  '勒索病毒': 'var(--sev-high)',
  'APT攻擊': '#D97706',
  '資料外洩': '#7C3AED',
  '零時差漏洞': '#DC2626',
  '政府公告': 'var(--accent)',
};

function timeAgoLabel(dateStr){
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  return `${diffDays}天前`;
}

function onStatusChange(select){
  select.className = 'update-status-select' + (select.value ? ' status-' + select.value : '');
  saveStatus(select.dataset.itemId, select.value);
  updatePendingCount();
  // 面板本身的「XX件」徽章也要跟著重新計算，不然只有上方統計卡會更新、下方面板數字不會變
  if (typeof window.__rerenderUpdatePanel === 'function') {
    window.__rerenderUpdatePanel();
  }
}
window.onStatusChange = onStatusChange;

// 「待處理事項」統計卡固定代表「近30天資料」，計算時直接從完整資料算，不要依賴畫面上
// 目前顯示的是「今天」還是「本月」分頁，否則切換分頁時這個數字會跟著分頁範圍跳動、對不上
function updatePendingCount(){
  const badge = document.getElementById('pendingCountNum');
  if (!badge) return;
  const remaining = (DATA.global_events || []).filter(e => {
    if (!isWithinCalendarDays(e.date, 30)) return false;
    const saved = getSavedStatus(stableIdFor(e.title));
    return saved !== '不處理' && saved !== '已完成';
  }).length;
  badge.textContent = remaining;
  renderStatusSummary();
}

function extractCve(title){
  const m = (title || '').match(/CVE-\d{4}-\d+/);
  return m ? m[0] : null;
}

const STATUS_STORAGE_PREFIX = 'aurora_update_status_';

function stableIdFor(text){
  // 用簡單雜湊把標題文字轉成穩定的短識別碼，當作儲存的key
  let hash = 0;
  const s = text || '';
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return 'id' + Math.abs(hash);
}

// ---------- Supabase 雲端同步（讓不同裝置/瀏覽器看到同一份狀態） ----------
const SUPABASE_URL = 'https://svvyygfxhxbqlhmafvjq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2dnl5Z2Z4aHhicWxobWFmdmpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MzQ5MzAsImV4cCI6MjEwNTAxMDkzMH0.9LELBFyqalM79z_u_8y2JnLYsVFOOZTJbCZdXepd2GA';
let supabaseClient = null;
try {
  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) { supabaseClient = null; }

// 本機快取格式改為 JSON {status, updatedAt(毫秒時間戳)}，才能判斷「不處理／已完成」是幾天前標記的
const AUTO_REMOVE_DAYS = 3;

function getLocalStatusMeta(id){
  try {
    const raw = localStorage.getItem(STATUS_STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.status) return parsed;
    return null;
  } catch (e) {
    return null;
  }
}
function setLocalStatus(id, value, updatedAtMs){
  try {
    if (value) {
      const meta = { status: value, updatedAt: updatedAtMs || Date.now() };
      localStorage.setItem(STATUS_STORAGE_PREFIX + id, JSON.stringify(meta));
    } else {
      localStorage.removeItem(STATUS_STORAGE_PREFIX + id);
    }
  } catch (e) { /* 忽略儲存失敗 */ }
}
function getLocalStatus(id){
  const meta = getLocalStatusMeta(id);
  return meta ? meta.status : '';
}

// 一開始先用本機快取當作立即可用的資料，Supabase抓到之後會覆蓋、並重新畫面
function getSavedStatus(id){
  return getLocalStatus(id);
}

// 判斷這筆「不處理／已完成」是否已標記超過 AUTO_REMOVE_DAYS 天，超過的話要從清單中自動消除
function isAutoRemoved(id){
  const meta = getLocalStatusMeta(id);
  if (!meta) return false;
  if (meta.status !== '不處理' && meta.status !== '已完成') return false;
  const ageDays = (Date.now() - meta.updatedAt) / 86400000;
  return ageDays >= AUTO_REMOVE_DAYS;
}

async function saveStatus(id, value){
  setLocalStatus(id, value); // 立即更新本機，畫面不用等雲端
  if (!supabaseClient) return;
  try {
    if (value) {
      await supabaseClient.from('update_status').upsert({ id, status: value, updated_at: new Date().toISOString() });
    } else {
      await supabaseClient.from('update_status').delete().eq('id', id);
    }
  } catch (e) {
    console.error('雲端同步狀態失敗（已保留在本機）：', e.message || e);
  }
}

// 從Supabase一次抓回所有已儲存的狀態，合併進本機快取，並重新渲染待處理事項面板
async function syncStatusFromCloud(){
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('update_status').select('id, status, updated_at');
    if (error) throw error;
    let changed = false;
    (data || []).forEach(row => {
      const cloudUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
      if (getLocalStatus(row.id) !== (row.status || '')) changed = true;
      setLocalStatus(row.id, row.status || '', cloudUpdatedAt);
    });
    if (changed && typeof window.__rerenderUpdatePanel === 'function') {
      window.__rerenderUpdatePanel();
    }
  } catch (e) {
    console.error('雲端狀態同步失敗（沿用本機資料）：', e.message || e);
  }
}

// 到期日：事件被抓到的日期（first_seen，沒有就用事件日期）＋ 依類別的處理期限（天）
const DUE_DAYS = { '零時差漏洞': 3, '勒索病毒': 3, 'APT攻擊': 7, '政府公告': 7 };
function dueInfoFor(e, saved){
  let due = null;
  if (e.due_date && /^\d{4}-\d{2}-\d{2}$/.test(e.due_date)) {
    due = new Date(e.due_date + 'T00:00:00Z');
  } else {
    const base = e.first_seen || e.date;
    if (!base) return '';
    const b = new Date(base);
    if (isNaN(b)) return '';
    due = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + (DUE_DAYS[e.category] ?? 7)));
  }
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const left = Math.round((due.getTime() - today) / 86400000);
  const mm = String(due.getUTCMonth() + 1).padStart(2, '0'), dd = String(due.getUTCDate()).padStart(2, '0');
  const label = `${due.getUTCFullYear()}/${mm}/${dd}`;
  if (saved === '已完成' || saved === '不處理') return `<div class="update-due done">到期日：${label}</div>`;
  if (left < 0) return `<div class="update-due over">到期日：${label}（已逾期 ${-left} 天）</div>`;
  if (left === 0) return `<div class="update-due soon">到期日：${label}（今天到期）</div>`;
  return `<div class="update-due${left <= 2 ? ' soon' : ''}">到期日：${label}（剩 ${left} 天）</div>`;
}

function renderGlobalEvents(items, rangeDays){
  const filtered = (items || []).filter(e => {
    if (!eventInRange(e, rangeDays)) return false;
    // 標記「不處理」或「已完成」滿3天後，從清單自動消除
    return !isAutoRemoved(stableIdFor(e.title));
  });
  if (!filtered.length) return emptyNote();
  const rows = filtered.map(e => {
    const cve = extractCve(e.title);
    const id = stableIdFor(e.title);
    const saved = getSavedStatus(id);
    return `
    <div class="update-card">
      <div class="update-card-top">
        <span class="update-vendor-icon">${vendorIconFor(e.title)}</span>
        <div class="update-title">${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</div>
        <select class="update-status-select${saved ? ' status-' + saved : ''}" data-item-id="${id}" onchange="onStatusChange(this)">
          <option value="" ${!saved ? 'selected' : ''}>待處理</option>
          <option value="不處理" ${saved === '不處理' ? 'selected' : ''}>不處理</option>
          <option value="處理中" ${saved === '處理中' ? 'selected' : ''}>處理中</option>
          <option value="已完成" ${saved === '已完成' ? 'selected' : ''}>已完成</option>
        </select>
      </div>
      ${cve ? `<div class="update-cve-line"><b>CVE：</b>${escapeHtml(cve)}</div>` : ''}
      ${dueInfoFor(e, saved)}
    </div>`;
  });
  return withShowMore(rows);
}

function setupGlobalEventsPanel(items){
  const body = document.getElementById('globalEventsBody');
  const badge = document.getElementById('windowsUpdateBadge');
  const tabs = document.querySelectorAll('.tab-btn');
  let currentDays = 30;
  function render(days){
    currentDays = days;
    const filtered = (items || []).filter(e => {
      if (!eventInRange(e, days)) return false;
      return !isAutoRemoved(stableIdFor(e.title));
    });
    body.innerHTML = renderGlobalEvents(items, days);
    // 徽章數字跟「待處理事項」統計卡用同一套定義：排除已標記「不處理／已完成」的項目，
    // 不要單純算畫面上渲染的筆數（渲染筆數在3天緩衝期內還會包含剛標記完成的項目，數字會對不上）
    if (badge) {
      const pending = filtered.filter(e => {
        const saved = getSavedStatus(stableIdFor(e.title));
        return saved !== '不處理' && saved !== '已完成';
      }).length;
      badge.textContent = `${pending} / ${filtered.length} 件`;
    }
    updatePendingCount();
  }
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render(parseInt(btn.dataset.days, 10));
    });
  });
  render(30);
  window.__rerenderUpdatePanel = () => render(currentDays);
}

/* ---------- Panel 3: 今日漏洞雷達 ---------- */
function vendorIconFor(title){
  const t = title || '';
  if (/Microsoft|Windows|Exchange|Entra|SharePoint|Outlook/i.test(t)) return '🪟';
  if (/Cisco/i.test(t)) return '📡';
  if (/Fortinet|FortiOS|FortiGate/i.test(t)) return '🛡️';
  if (/Palo ?Alto|PAN-OS|GlobalProtect|Prisma|Cortex/i.test(t)) return '🔥';
  if (/Chrome|Google/i.test(t)) return '🌐';
  if (/SonicWall/i.test(t)) return '🔐';
  if (/PaperCut/i.test(t)) return '🖨️';
  if (/VMware|Citrix/i.test(t)) return '💻';
  if (/JFrog|Artifactory/i.test(t)) return '📦';
  if (/LiteLLM|AI/i.test(t)) return '🤖';
  return '🎯';
}
function renderCveRadar(items){
  if (!items || !items.length) return emptyNote();
  const cardHtmls = items.map(v => `
    <div class="cve-plain-card">
      <div class="cve-plain-top">
        <div class="cve-plain-title-row">
          <span class="cve-vendor-icon">${vendorIconFor(v.title)}</span>
          <div class="cve-plain-title">${escapeHtml(v.plain_title || v.title || '')}</div>
        </div>
        <span class="exploited-status-badge ${v.exploited ? 'is-exploited' : 'is-watch'}">${v.exploited ? '⚠ 已遭利用' : '觀察中'}</span>
      </div>
      <div class="cve-plain-summary">${escapeHtml(v.plain_summary || v.title || '')}</div>
      <div class="cve-plain-meta">
        <span class="cve-id-small">${escapeHtml(v.cve_id || '')}</span>
        ${v.date_added ? `<span class="cve-date-tag">新增 ${escapeHtml(String(v.date_added).replace(/-/g, '/'))}</span>` : ''}
        <span class="cve-severity-tag">嚴重度 ${v.cvss ?? '—'}／10</span>
        <span class="cve-kev-tag">KEV：是</span>
      </div>
      ${v.action ? `<div class="cve-ai-suggestion"><b>AI建議：</b>${escapeHtml(v.action)}${v.action === '立即更新' ? '，優先排入本週修補排程' : v.action === '一週內更新' ? '，建議一週內完成' : '，持續留意後續情資'}</div>` : ''}
    </div>`);
  return withShowMore(cardHtmls);
}

/* ---------- Panel 4: AI企業影響分析 ---------- */
function renderVendorImpact(items){
  if (!items || !items.length) return emptyNote();
  const cards = items.map(v => `
    <div class="vendor-card">
      <div class="vendor-icon">${v.icon || '🏢'}</div>
      <div class="vendor-body">
        <div class="vendor-top">
          <div class="vendor-title">${escapeHtml(v.title || '')}</div>
          ${v.impact ? `<span class="impact-badge impact-${escapeHtml(v.impact)}">${escapeHtml(v.impact)}</span>` : ''}
        </div>
        <div class="vendor-asset">
          ${v.category ? `<span class="tag-chip category-chip">${escapeHtml(v.category)}</span>` : ''}
          ${v.key_asset ? `<span class="tag-chip">${escapeHtml(v.key_asset)}</span>` : ''}
        </div>
        ${v.ai_suggestion ? `<div class="vendor-suggestion"><b>AI建議：</b>${escapeHtml(v.ai_suggestion)}</div>` : ''}
      </div>
    </div>`);
  return withShowMore(cards);
}

/* ---------- Panel 5: AI風險熱度儀表板 ---------- */
function gaugeColor(score){
  if (score >= 70) return 'var(--sev-high)';
  if (score >= 40) return 'var(--sev-medium)';
  return 'var(--sev-low)';
}
function gaugeLevel(score){
  if (score >= 70) return '高風險';
  if (score >= 40) return '中風險';
  return '低風險';
}

function renderGaugeSvg(score){
  const cx = 62, cy = 60, r = 48;
  const needleAngle = Math.PI - (score/100) * Math.PI;
  const nxF = cx + (r-8) * Math.cos(needleAngle);
  const nyF = cy - (r-8) * Math.sin(needleAngle);
  const color = gaugeColor(score);
  return `<svg width="124" height="72" viewBox="0 0 124 72">
    <path d="M 14 60 A 48 48 0 0 1 110 60" fill="none" stroke="var(--panel-alt)" stroke-width="9" stroke-linecap="round"/>
    <path d="M 14 60 A 48 48 0 0 1 110 60" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${Math.PI*48}" stroke-dashoffset="${Math.PI*48*(1-score/100)}"/>
    <circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>
    <line x1="${cx}" y1="${cy}" x2="${nxF}" y2="${nyF}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

function renderRiskGauge(risk){
  if (!risk) return emptyNote();
  const score = risk.total ?? 0;
  const breakdown = risk.breakdown || [];
  const bars = breakdown.map(b => `
    <div class="risk-bar-row">
      <div class="risk-bar-label">${escapeHtml(b.label)}</div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${b.score}%;background:${gaugeColor(b.score)}"></div></div>
      <div class="risk-bar-val">${b.score}/100</div>
    </div>`).join('');
  return `
    <div class="gauge-wrap">
      ${renderGaugeSvg(score)}
      <div class="gauge-score" style="color:${gaugeColor(score)}">${score}<span style="font-size:14px;color:var(--text-dim);">/100</span></div>
      <div class="gauge-level" style="color:${gaugeColor(score)}">${gaugeLevel(score)}</div>
    </div>
    <div class="risk-bars">${bars}</div>`;
}

/* ---------- Panel 6: 今日建議行動 ---------- */
function renderActionItems(items){
  if (!items || !items.length) return emptyNote();
  window.__ACTION_ITEMS__ = items;
  const rows = items.map((a, i) => `
    <div class="action-row">
      <div class="action-num">${i + 1}</div>
      <div class="action-body">
        <div class="action-title">${escapeHtml(a.title || '')}</div>
        ${a.detail ? `<div class="action-detail">${escapeHtml(a.detail)}</div>` : ''}
        <div class="action-meta">
          <span class="action-cat-tag">${escapeHtml(a.category || '')}</span>
          <span class="action-priority action-priority-${escapeHtml(a.priority || '中')}">${escapeHtml(a.priority || '中')}優先</span>
        </div>
      </div>
    </div>`);
  return withShowMore(rows);
}

/* ---------- 組裝 6 宮格 ---------- */
/* ---------- 主管一眼摘要橫幅（純前端組裝，不額外花AI費用） ---------- */
function riskLevel(total){
  if (total >= 70) return '高';
  if (total >= 40) return '中';
  return '低';
}

function renderGlanceBanner(data){
  const el = document.getElementById('glanceBanner');
  const total = data.risk_score?.total ?? 0;
  const level = riskLevel(total);
  const levelLabel = level === '高' ? '高風險' : level === '中' ? '中度留意' : '平穩';
  const topHeadline = (data.headlines && data.headlines[0]) ? data.headlines[0].title : '今天暫無特別重大訊號';

  const actionItems = data.action_items || [];
  const highPriorityCount = actionItems.filter(a => a.priority === '高').length;
  const urgentCve = (data.cve_radar || []).filter(v => v.action === '立即更新');

  // 今日重大事件：只算今天(24小時內)的，而不是全部累積歷史
  const todayCutoff = Date.now() - 86400000;
  const todayEvents = (data.global_events || []).filter(e => {
    const d = new Date(e.date);
    return isNaN(d.getTime()) ? true : d.getTime() >= todayCutoff;
  });

  el.className = `glance-banner level-${level}`;
  el.innerHTML = `
    <div class="glance-left">
      <span class="glance-badge level-${level}">${level === '高' ? '🔴' : level === '中' ? '🟡' : '🟢'} ${levelLabel}</span>
    </div>
    <div class="glance-stats">
      <div class="glance-stat clickable" onclick="openStatModal('risk')"><div class="glance-stat-num risk-${level}">${total}</div><div class="glance-stat-label">風險分數/100</div></div>
      <div class="glance-stat clickable" onclick="openStatModal('actions')"><div class="glance-stat-num">${actionItems.length}</div><div class="glance-stat-label">建議行動（高${highPriorityCount}）</div></div>
      <div class="glance-stat clickable" onclick="openStatModal('urgentCve')"><div class="glance-stat-num">${urgentCve.length}</div><div class="glance-stat-label">需立即更新漏洞</div></div>
      <div class="glance-stat clickable" onclick="openStatModal('events')"><div class="glance-stat-num">${todayEvents.length}</div><div class="glance-stat-label">今日重大事件</div></div>
    </div>`;
}

/* ---------- 統計數字點擊彈跳視窗 ---------- */
function statModalBody(type){
  const d = DATA;
  if (type === 'risk'){
    const bd = d.risk_score?.breakdown || [];
    const rows = bd.map(item => `
      <div class="stat-modal-row">
        <span class="stat-modal-row-label">${escapeHtml(item.label || '')}</span>
        <span class="stat-modal-row-value">${escapeHtml(String(item.score ?? '—'))}</span>
      </div>`).join('');
    return { title: '風險分數細項', body: rows || emptyNote() };
  }
  if (type === 'actions'){
    const items = d.action_items || [];
    const rows = items.map(a => `
      <div class="stat-modal-row">
        <span class="stat-modal-row-label">[${escapeHtml(a.category||'')}] ${escapeHtml(a.title||'')}</span>
        <span class="action-priority action-priority-${escapeHtml(a.priority||'中')}">${escapeHtml(a.priority||'中')}</span>
      </div>`).join('');
    return { title: '建議行動', body: rows || emptyNote() };
  }
  if (type === 'urgentCve'){
    const items = (d.cve_radar || []).filter(v => v.action === '立即更新');
    const rows = items.map(v => `
      <div class="stat-modal-row">
        <span class="stat-modal-row-label">${escapeHtml(v.cve_id||'')}：${escapeHtml(v.title||'')}</span>
        <span class="stat-modal-row-value">CVSS ${v.cvss ?? '—'}</span>
      </div>`).join('');
    return { title: '需立即更新的漏洞', body: rows || emptyNote() };
  }
  if (type === 'events'){
    const todayCutoff = Date.now() - 86400000;
    const items = (d.global_events || []).filter(e => {
      const dt = new Date(e.date);
      return isNaN(dt.getTime()) ? true : dt.getTime() >= todayCutoff;
    });
    const rows = items.map(e => `
      <div class="stat-modal-row">
        <span class="stat-modal-row-label">[${escapeHtml(e.category||'')}] ${escapeHtml(e.title||'')}</span>
        <span class="stat-modal-row-value">${escapeHtml(e.date||'')}</span>
      </div>`).join('');
    return { title: '今日重大事件', body: rows || emptyNote() };
  }
  if (type === 'ransomApt'){
    const items = d.ransomware_apt_list || [];
    const rows = items.map(r => `
      <div class="stat-modal-row">
        <span class="stat-modal-row-label">[${escapeHtml(r.type||'')}] ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title||'')}</a>` : escapeHtml(r.title||'')}</span>
        <span class="stat-modal-row-value">${escapeHtml(r.date||'')}</span>
      </div>`).join('');
    return { title: '勒索軟體／APT事件', body: rows || emptyNote() };
  }
  return { title: '', body: emptyNote() };
}

function openStatModal(type){
  const { title, body } = statModalBody(type);
  document.getElementById('statModalTitle').textContent = title;
  document.getElementById('statModalBody').innerHTML = body;
  document.getElementById('statModal').style.display = 'flex';
}
function closeStatModal(){
  document.getElementById('statModal').style.display = 'none';
}
window.openStatModal = openStatModal;
window.closeStatModal = closeStatModal;

function renderAiAnalysis(){
  const body = document.getElementById('aiAnalysisBody');
  const raw = DATA.ai_analysis;
  let inner;
  if (Array.isArray(raw) && raw.length) {
    inner = `<ol class="ai-analysis-list">${raw.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`;
  } else if (typeof raw === 'string' && raw.trim()) {
    inner = `<div class="ai-analysis-text">${escapeHtml(raw)}</div>`; // 相容舊格式（整段文字）
  } else {
    inner = `<div class="ai-analysis-text">今日資料暫無AI綜合分析。</div>`;
  }
  body.innerHTML = inner + `<div class="ai-analysis-meta">此分析由AI於資料產生當下彙整撰寫，非即時分析，僅供參考</div>`;
}
renderAiAnalysis();


function renderStatStrip(counts, pendingCount){
  const el = document.getElementById('statStrip');
  if (!counts) { el.style.display = 'none'; return; }
  const cards = [
    { color:'red', label:'今日新聞事件', number: (DATA.headlines || []).length, desc:'國內/全球新聞', range:'近2天資料' },
    { color:'blue', label:'漏洞雷達', number: (DATA.cve_radar || []).length, desc:'KEV累積筆數', range:'近15天資料' },
    { color:'green', label:'公司關注廠商情報', number: counts.vendor ?? 0, desc:'Microsoft／Cisco／Fortinet／Palo Alto', range:'近2天資料' },
  ];
  el.innerHTML = cards.map(c => `
    <div class="strip-card c-${c.color}"${c.clickable ? ` style="cursor:pointer;" onclick="openStatModal('ransomApt')"` : ''}>
      <div class="strip-label">${escapeHtml(c.label)} <span class="strip-label-sub">${escapeHtml(c.desc)}</span></div>
      <div class="strip-number"${c.id ? ` id="${c.id}"` : ''}>${c.number}</div>
      <div class="strip-range">${escapeHtml(c.range)}</div>
    </div>`).join('');
}
const monthPendingCount = (DATA.global_events || []).filter(e => {
  if (!isWithinCalendarDays(e.date, 30)) return false;
  const saved = getSavedStatus(stableIdFor(e.title));
  return saved !== '不處理' && saved !== '已完成';
}).length;
renderStatStrip(DATA.category_counts, monthPendingCount);

/* ---------- 待處理事項處理狀況（不處理／處理中／已完成 各幾筆） ---------- */
function renderStatusSummary(){
  const el = document.getElementById('statusSummaryCard');
  if (!el) return;
  const counts = { '待處理':0, '不處理':0, '處理中':0, '已完成':0 };
  (DATA.global_events || []).forEach(e => {
    if (!isWithinCalendarDays(e.date, 30)) return;
    const id = stableIdFor(e.title);
    if (isAutoRemoved(id)) return; // 已從清單自動消除的不算，數字才會跟下方面板一致
    const saved = getSavedStatus(id);
    const key = saved || '待處理';
    if (counts[key] !== undefined) counts[key]++;
  });
  const colors = { '待處理':'var(--text)', '不處理':'var(--sev-high)', '處理中':'var(--sev-medium)', '已完成':'var(--sev-low)' };
  const itemHtml = k => `
    <div class="trend-item">
      <div class="trend-item-label">${k}</div>
      <div class="trend-item-value"><span class="trend-item-pct" style="color:${colors[k]}">${counts[k]} 筆</span></div>
    </div>`;
  const rows = [['待處理','處理中'],['不處理','已完成']]
    .map(g => `<div class="trend-group">${g.map(itemHtml).join('')}</div>`).join('');
  el.innerHTML = `
    <div class="status-total">
      <div class="status-total-label">待處理事項 <span>待處理＋處理中</span></div>
      <div class="status-total-num" id="pendingCountNum">${counts['待處理'] + counts['處理中']}</div>
      <div class="status-total-range">近30天資料</div>
    </div>
    <div class="trend-items">${rows}</div>`;
}
renderStatusSummary();

const grid = document.getElementById('dashboardGrid');

const todayWinCount = (DATA.global_events || []).filter(e => eventInRange(e, 1)).length;

grid.innerHTML =
  panelShell('①', '📰', '今日新聞事件', null, renderHeadlines(DATA.headlines), '', '#D97706', (DATA.headlines||[]).length) +
  panelShell('②', '🎯', '漏洞雷達 (CVE)', null, renderCveRadar(DATA.cve_radar), '', '#2563EB', (DATA.cve_radar||[]).length) +
  panelShell('③', '🏢', '公司關注廠商情報', null, `<div id="vendorImpactBody"></div>`, `<div id="vendorPillRow"></div>`, '#059669', (DATA.vendor_impact||[]).length) +
  panelShell('④', '🪟', '待處理事項', null,
    `<div id="globalEventsBody"></div>`,
    `<div class="tab-row">
      <button class="tab-btn" data-days="1">今天</button>
      <button class="tab-btn active" data-days="30">本月</button>
    </div>`, '', todayWinCount, 'windowsUpdateBadge') +
  panelShell('⑤', '🚨', '安全宣導', null, `<div id="twScamBody"></div>`, '', '#DC2626', (DATA.tw_scam_events||[]).length);

setupGlobalEventsPanel(DATA.global_events);
setupVendorPillFilter(DATA.vendor_impact);
syncStatusFromCloud();

function setupVendorPillFilter(items){
  const pillRow = document.getElementById('vendorPillRow');
  const body = document.getElementById('vendorImpactBody');
  if (!pillRow || !body) return;

  const vendorNames = [...new Set((items || []).map(v => v.vendor).filter(Boolean))];
  let activeVendor = null;

  function render(){
    const filtered = activeVendor ? items.filter(v => v.vendor === activeVendor) : items;
    body.innerHTML = renderVendorImpact(filtered);
  }

  pillRow.innerHTML = `
    <div class="vendor-pill-row">
      <button class="vendor-pill active" data-vendor="">全部</button>
      ${vendorNames.map(v => `<button class="vendor-pill" data-vendor="${escapeHtml(v)}">${vendorIconFor(v)} ${escapeHtml(v)}</button>`).join('')}
    </div>`;

  pillRow.querySelectorAll('.vendor-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      pillRow.querySelectorAll('.vendor-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeVendor = btn.dataset.vendor || null;
      render();
    });
  });

  render();
}

/* ---------- 安全宣導面板 ---------- */
(function(){
  const items = Array.isArray(DATA.tw_scam_events) ? DATA.tw_scam_events : [];
  const body = document.getElementById('twScamBody');
  if (!body) return;
  const wrap = body.closest('.panel'); if (wrap) wrap.classList.add('panel-wide');
  const safe = u => /^https?:\/\//i.test(u || '') ? u : '';
  body.innerHTML = (items.length ? items.map(e => {
    const u = safe(e.source_url);
    const title = escapeHtml(e.title || '');
    return `<div class="tw-item">
      <div class="tw-main">
      <div class="tw-item-top"><span class="tw-tag">${escapeHtml(e.type || '詐騙')}</span><span>${escapeHtml(e.date || '')}</span><span>${escapeHtml(e.source_name || '')}</span></div>
      <div class="tw-item-title">${u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</div>
      <div class="tw-item-sum">${escapeHtml(e.summary || '')}</div>
      </div>
      <div class="tw-cols">
      ${e.risk ? `<div class="tw-row tw-risk"><b>⚠️ 可能風險</b>${escapeHtml(String(e.risk).replace(/^可能風險[:：]\s*/, ''))}</div>` : ''}
      ${e.advice ? `<div class="tw-row tw-advice"><b>✅ 正確做法</b>${escapeHtml(String(e.advice).replace(/^正確做法[:：]\s*/, ''))}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="tw-empty">目前沒有資料，下次自動更新後會顯示</div>')
  + '<div class="tw-note">由AI於資料產生當下搜尋彙整，非即時資訊，僅供參考</div>';
})();
