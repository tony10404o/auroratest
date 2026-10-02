import fs from "node:fs";

const TREND_PATH = "docs/data/trend-history.json";
const MAX_TREND_DAYS = 60;

/**
 * 威脅類型分類規則（關鍵字比對，規則式判斷不額外花AI費用）
 * 一則資料可以同時符合多個分類
 */
const CATEGORY_KEYWORDS = {
  釣魚攻擊: ["釣魚", "phishing", "假冒網站", "假冒登入", "釣魚郵件", "釣魚網站"],
  勒索軟體: ["勒索軟體", "勒索病毒", "ransomware", "勒索集團", "加密勒索", "贖金"],
  BEC商業郵件詐騙: ["bec", "商業郵件詐騙", "假冒高層", "匯款詐騙", "發票詐騙", "business email compromise"],
  帳密竊取: ["帳密", "憑證竊取", "credential", "密碼竊取", "api金鑰", "api key", "帳號外洩", "token竊取"],
  AI詐騙: ["ai詐騙", "深偽", "deepfake", "ai生成", "ai agent", "ai自主", "ai代理"],
};

/**
 * 掃描一段文字，回傳符合的威脅類型分類清單
 */
function classifyText(text) {
  const t = (text || "").toLowerCase();
  const matched = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => t.includes(kw.toLowerCase()))) matched.push(category);
  }
  return matched;
}

/**
 * 掃描今天彙整的所有原始資料（result物件），依關鍵字統計出每個威脅類型今天出現的則數
 */
export function computeTodayThreatCounts(result) {
  const counts = { 釣魚攻擊: 0, 勒索軟體: 0, BEC商業郵件詐騙: 0, 帳密竊取: 0, AI詐騙: 0 };

  const allTexts = [
    ...(result.kev_vulnerabilities || []).map((v) => `${v.title} ${v.summary || ""}`),
    ...(result.vendor_advisories || []).map((v) => v.title),
    ...(result.international_news || []).map((v) => `${v.title} ${v.summary || ""}`),
    ...(result.gov_announcements || []).map((v) => `${v.title} ${v.summary || ""}`),
    ...(result.ioc_highlights || []).map((v) => `${v.campaign} ${v.summary || ""}`),
    ...(result.ransomware_apt || []).map((v) => `${v.title} ${v.summary || ""}`),
  ];

  for (const text of allTexts) {
    for (const category of classifyText(text)) {
      counts[category]++;
    }
  }
  return counts;
}

/**
 * 讀取既有的趨勢歷史檔案，若不存在則回傳空陣列
 */
export function loadTrendHistory(path = TREND_PATH) {
  try {
    if (!fs.existsSync(path)) return [];
    const raw = fs.readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`  ✗ 讀取威脅趨勢歷史檔案失敗（將視為空歷史）：${err.message}`);
    return [];
  }
}

/**
 * 把今天的分類統計加進歷史清單：同一天重跑會覆蓋掉當天舊紀錄（不會重複累加），
 * 並修剪超過保留天數的舊資料
 */
export function appendTodayTrend(existing, todayCounts, todayDate, maxDays = MAX_TREND_DAYS) {
  const withoutToday = (existing || []).filter((entry) => entry.date !== todayDate);
  const merged = [...withoutToday, { date: todayDate, counts: todayCounts }];

  const cutoff = Date.now() - maxDays * 86400000;
  return merged
    .filter((entry) => {
      const d = new Date(entry.date);
      return isNaN(d.getTime()) ? true : d.getTime() >= cutoff;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * 將趨勢歷史寫回檔案（會自動建立docs/data資料夾）
 */
export function saveTrendHistory(history, path = TREND_PATH) {
  fs.mkdirSync("docs/data", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(history, null, 2), "utf-8");
}

const TREND_CATEGORIES = ["釣魚攻擊", "勒索軟體", "BEC商業郵件詐騙", "帳密竊取", "AI詐騙"];

/**
 * 把累積的歷史資料整理成前端「近期威脅趨勢」卡片要的格式：
 * 每個分類給近7天的每日筆數（當作走勢圖的點）、以及近7天總數相較於再前7天總數的漲跌百分比。
 * 歷史天數不夠7天的部分用0補齊，漲跌幅分母為0時（前7天完全沒出現過）：
 * 這7天只要有出現就算「新增趨勢」顯示+100%，兩邊都是0則顯示0%。
 */
export function computeTrendSummary(history, todayDate) {
  const sorted = [...(history || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const today = todayDate ? new Date(todayDate) : new Date();

  function countsOnOffset(daysAgo) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = sorted.find((e) => e.date === dateStr);
    return entry ? entry.counts : null;
  }

  // 近7天（含今天，offset 0~6）與再前7天（offset 7~13），由舊到新排序方便畫走勢圖
  const last7Offsets = [6, 5, 4, 3, 2, 1, 0];
  const prev7Offsets = [13, 12, 11, 10, 9, 8, 7];

  return TREND_CATEGORIES.map((category) => {
    const points = last7Offsets.map((offset) => {
      const counts = countsOnOffset(offset);
      return counts ? counts[category] || 0 : 0;
    });
    const last7Sum = points.reduce((a, b) => a + b, 0);
    const prev7Sum = prev7Offsets.reduce((sum, offset) => {
      const counts = countsOnOffset(offset);
      return sum + (counts ? counts[category] || 0 : 0);
    }, 0);

    let pct;
    if (prev7Sum === 0) {
      pct = last7Sum === 0 ? 0 : 100;
    } else {
      pct = Math.round(((last7Sum - prev7Sum) / prev7Sum) * 100);
    }

    return { label: category, pct, points };
  });
}
