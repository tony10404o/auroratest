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
