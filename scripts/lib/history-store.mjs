import fs from "node:fs";

const HISTORY_PATH = "docs/data/events-history.json";
const MAX_HISTORY_DAYS = 35;
const MAX_HISTORY_ITEMS = 150;

/**
 * 讀取既有的歷史事件檔案，若不存在則回傳空陣列
 */
export function loadEventsHistory(path = HISTORY_PATH) {
  try {
    if (!fs.existsSync(path)) return [];
    const raw = fs.readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`  ✗ 讀取歷史事件檔案失敗（將視為空歷史）：${err.message}`);
    return [];
  }
}

function normalizeTitle(title) {
  return (title || "").trim().toLowerCase();
}

/**
 * 合併新事件進歷史清單：以「分類+標題」去重（保留最早出現的日期），
 * 依日期新到舊排序，並修剪超過保留天數或超過筆數上限的舊資料
 */
export function mergeEventsHistory(existing, newItems, maxDays = MAX_HISTORY_DAYS, maxItems = MAX_HISTORY_ITEMS) {
  const seen = new Map();

  for (const item of existing || []) {
    const key = `${item.category || ""}|${normalizeTitle(item.title)}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  for (const item of newItems || []) {
    const key = `${item.category || ""}|${normalizeTitle(item.title)}`;
    if (!seen.has(key)) seen.set(key, item); // 已存在的舊事件保留最早那筆，不覆蓋
  }

  const cutoff = Date.now() - maxDays * 86400000;
  const merged = Array.from(seen.values())
    .filter((item) => {
      const d = new Date(item.date);
      return isNaN(d.getTime()) ? true : d.getTime() >= cutoff;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, maxItems);

  return merged;
}

/**
 * 將合併後的歷史事件寫回檔案（會自動建立docs/data資料夾）
 */
export function saveEventsHistory(history, path = HISTORY_PATH) {
  fs.mkdirSync("docs/data", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(history, null, 2), "utf-8");
}
