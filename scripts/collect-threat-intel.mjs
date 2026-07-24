import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fetchFeed } from "./lib/rss-utils.mjs";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺少 ANTHROPIC_API_KEY 環境變數（請在 GitHub Secrets 設定）");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey });

const DAYS_BACK = 2;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function filterRecentItems(items, days = DAYS_BACK) {
  const cutoff = daysAgo(days);
  return items.filter((item) => {
    if (!item.pubDate) return true; // 沒有日期資訊時保留，避免誤刪
    const d = new Date(item.pubDate);
    if (isNaN(d.getTime())) return true; // 無法解析日期時保留
    return d >= cutoff;
  });
}

// ---------- 1. 抓取官方免費 Feed（不花 AI 錢） ----------

async function fetchCisaKev() {
  console.log("抓取 CISA KEV（已知遭實際利用漏洞）...");
  try {
    const res = await fetch("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; aurora-security-report/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cutoff = daysAgo(DAYS_BACK);
    const recent = (data.vulnerabilities || [])
      .filter((v) => new Date(v.dateAdded) >= cutoff)
      .slice(0, 10)
      .map((v) => ({
        cve_id: v.cveID,
        vendor: v.vendorProject,
        product: v.product,
        name: v.vulnerabilityName,
        date_added: v.dateAdded,
        description: v.shortDescription,
        known_ransomware_use: v.knownRansomwareCampaignUse === "Known",
      }));
    console.log(`  ✓ CISA KEV：近${DAYS_BACK}天內新增 ${recent.length} 筆`);
    return recent;
  } catch (err) {
    console.error(`  ✗ CISA KEV 抓取失敗：${err.message}`);
    return [];
  }
}

async function fetchVendorAdvisories() {
  console.log("抓取廠商安全公告 RSS...");
  const [msrc, cisco, fortinet] = await Promise.all([
    fetchFeed("https://api.msrc.microsoft.com/update-guide/rss", 10, "Microsoft MSRC"),
    fetchFeed("https://tools.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml", 10, "Cisco PSIRT"),
    fetchFeed("https://filestore.fortinet.com/fortiguard/rss/ir.xml", 10, "Fortinet PSIRT"),
  ]);
  return {
    microsoft: filterRecentItems(msrc),
    cisco: filterRecentItems(cisco),
    fortinet: filterRecentItems(fortinet),
  };
}

async function fetchIntlNews() {
  console.log("抓取國際資安新聞 RSS...");
  const [bleeping, krebs] = await Promise.all([
    fetchFeed("https://www.bleepingcomputer.com/feed/", 15, "BleepingComputer"),
    fetchFeed("https://krebsonsecurity.com/feed/", 15, "Krebs on Security"),
  ]);
  return {
    bleeping: filterRecentItems(bleeping),
    krebs: filterRecentItems(krebs),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 向 NVD 官方 API 查詢指定 CVE 的真實 CVSS 分數
 * 未申請API Key時速率限制為5次/30秒，這裡簡單延遲以避免超過限制
 */
async function fetchNvdCvss(cveId) {
  if (!cveId || !cveId.trim()) return null;
  try {
    const res = await fetch(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; aurora-security-report/1.0)" } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cve = data.vulnerabilities?.[0]?.cve;
    if (!cve) return null;

    const metrics = cve.metrics || {};
    // 優先採用最新版本的 CVSS（4.0 > 3.1 > 3.0 > 2.0）
    const source =
      metrics.cvssMetricV40?.[0] ||
      metrics.cvssMetricV31?.[0] ||
      metrics.cvssMetricV30?.[0] ||
      metrics.cvssMetricV2?.[0];
    if (!source) return null;

    return {
      score: source.cvssData.baseScore,
      version: source.cvssData.version,
      severity: source.baseSeverity || source.cvssData.baseSeverity || null,
    };
  } catch (err) {
    console.error(`  ✗ NVD查詢失敗（${cveId}）：${err.message}`);
    return null;
  }
}

/**
 * 為一批KEV漏洞查詢NVD官方CVSS分數，依序查詢並延遲以避免超過速率限制
 */
async function enrichKevWithNvdCvss(kevItems) {
  console.log("查詢 NVD 官方 CVSS 分數...");
  for (const item of kevItems) {
    const nvd = await fetchNvdCvss(item.cve_id);
    if (nvd) {
      item.nvd_cvss = nvd.score;
      item.nvd_cvss_version = nvd.version;
      item.nvd_severity = nvd.severity;
      console.log(`  ✓ ${item.cve_id}：CVSS ${nvd.score}（v${nvd.version}）`);
    } else {
      console.log(`  – ${item.cve_id}：NVD查無資料，將使用AI推估分數`);
    }
    await sleep(6500); // 避免超過NVD無金鑰時5次/30秒的速率限制
  }
  return kevItems;
}

/**
 * 依CVSS分數與利用狀態，決定建議行動（規則式判斷，不依賴AI猜測）
 */
function decideAction(cvss, isZeroDay, knownRansomwareUse) {
  if ((isZeroDay || knownRansomwareUse) && cvss >= 8) return "立即更新";
  if (cvss >= 9) return "立即更新";
  if (cvss >= 7) return "一週內更新";
  if (cvss >= 4) return "持續觀察";
  return "暫不處理";
}

/**
 * 在程式碼中直接組出CVE雷達資料（優先使用NVD官方CVSS，查無資料才退回AI推估值）
 */
function buildCveRadar(kevItems) {
  return (kevItems || [])
    .map((v) => {
      const hasOfficial = typeof v.nvd_cvss === "number";
      const cvss = hasOfficial ? v.nvd_cvss : v.cvss_estimate ?? 5.0;
      return {
        cve_id: v.cve_id,
        title: v.title,
        cvss: Math.round(cvss * 10) / 10,
        cvss_source: hasOfficial ? "NVD官方" : "AI推估",
        exploited: true, // 來自KEV清單，一律視為已知遭實際利用
        action: decideAction(cvss, v.is_zero_day, v.known_ransomware_use),
      };
    })
    .sort((a, b) => b.cvss - a.cvss);
}

// ---------- 2. JSON 解析與Claude呼叫（含重試機制） ----------

function extractJsonObject(text) {
  const cleaned = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("回應內容中找不到 JSON 物件:\n" + text.slice(0, 500));
  return JSON.parse(match[0]);
}

function extractJsonArray(text) {
  const cleaned = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("回應內容中找不到 JSON 陣列:\n" + text.slice(0, 500));
  return JSON.parse(match[0]);
}

const JSON_SAFETY_NOTE = `

【重要格式規則】回傳內容中絕對不要使用直引號雙引號（"）來標示引用語句或強調文字，一律使用中文的「」或『』符號代替，避免破壞JSON字串格式。確保整份回應是可以被JSON.parse()正確解析的合法JSON，陣列與物件的每個元素之間都要有逗號分隔，最後一個元素後面不要有多餘的逗號。`;

/**
 * 呼叫Claude並解析JSON（物件或陣列），若解析失敗會自動重試一次
 */
async function callClaudeForJson({ prompt, tools, maxTokens = 4096, label, parseAs = "object" }) {
  const parser = parseAs === "array" ? extractJsonArray : extractJsonObject;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt + JSON_SAFETY_NOTE }],
        ...(tools ? { tools } : {}),
      });
      const textBlocks = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return parser(textBlocks);
    } catch (err) {
      console.error(`  ✗ ${label} 第${attempt}次嘗試失敗：${err.message}`);
      if (attempt === 2) throw err;
      console.log(`  ↻ ${label} 重試中...`);
    }
  }
}

async function classifyRawData({ kev, vendorAdvisories, intlNews }) {
  console.log("呼叫 Claude 分析分類（CVE/廠商公告/國際新聞）...");

  const prompt = `你是資安分析師，以下是自動抓取的原始資料（JSON），請幫我整理分類成繁體中文報告。

【CISA KEV 已知遭實際利用漏洞】
${JSON.stringify(kev, null, 2)}

【廠商安全公告標題（RSS，未經處理）】
Microsoft: ${JSON.stringify(vendorAdvisories.microsoft, null, 2)}
Cisco: ${JSON.stringify(vendorAdvisories.cisco, null, 2)}
Fortinet: ${JSON.stringify(vendorAdvisories.fortinet, null, 2)}

【國際資安新聞標題（RSS，未經處理）】
BleepingComputer: ${JSON.stringify(intlNews.bleeping, null, 2)}
Krebs on Security: ${JSON.stringify(intlNews.krebs, null, 2)}

請「只」回傳一個 JSON 物件，不要有任何前言、說明文字或 markdown 的 \`\`\` 符號，格式如下：

{
  "kev_vulnerabilities": [
    {
      "cve_id": "CVE編號",
      "vendor_product": "廠商/產品名稱",
      "title": "用繁體中文簡潔說明這個漏洞（可根據name/description改寫）",
      "date_added": "YYYY-MM-DD",
      "known_ransomware_use": true或false,
      "is_zero_day": true或false（若description或name中提到這是在廠商發布修補之前就已經被利用的0-day漏洞，填true；不確定則填false）,
      "summary": "40字以內繁體中文摘要"
    }
  ],
  "vendor_advisories": [
    {
      "vendor": "Microsoft、Cisco 或 Fortinet",
      "title": "繁體中文標題（可保留原文品名/CVE編號，其餘翻譯）",
      "severity_guess": "高、中或低（根據標題內容合理推測，例如RCE/認證繞過等關鍵字通常較高）",
      "url": "原始連結網址（若RSS項目沒有網址可留空字串）"
    }
  ],
  "international_news": [
    {
      "title": "繁體中文標題（改寫，不要直接翻譯逐字對照）",
      "source": "BleepingComputer 或 Krebs on Security",
      "summary": "40字以內繁體中文摘要，用自己的話說明重點",
      "url": "原始連結網址",
      "is_awareness_case": true或false（這則新聞是否適合用來做員工資安宣導/教育訓練，例如常見詐騙手法、釣魚郵件、社交工程等一般員工容易遇到的情境；純技術性漏洞公告通常填false）
    }
  ]
}

注意事項：
- kev_vulnerabilities 最多列出前10筆，依date_added新到舊排序
- vendor_advisories 每家廠商最多列出前5則，優先列出看起來較嚴重（RCE、權限提升、認證繞過等）的項目
- international_news 挑選最重要的3-6則（原始資料已限縮為當天與昨天），摘要必須用自己的話改寫，不要照抄原文標題字句
- 如果某類別原始資料是空的，該欄位回傳空陣列即可`;

  return await callClaudeForJson({ prompt, maxTokens: 8000, label: "分析分類" });
}

async function searchRemainingCategories() {
  console.log("呼叫 Claude 搜尋（國內CERT/政府公告、IOC情資、勒索軟體與APT活動）...");

  const prompt = `請完成以下三項任務，並回傳單一 JSON 物件（不要有任何前言、說明文字或 markdown 的 \`\`\` 符號）。請盡量精簡搜尋次數（6次以內廣泛搜尋）。

【任務一】國內 CERT 與政府資安公告
搜尋台灣 TWCERT/CC（https://www.twcert.org.tw）與數位發展部資安署（ACS）當天與昨天發布的資安公告、預警或新聞，列出最多5則（若沒有那麼多則資料就列出實際找到的數量，不用湊）。

【任務二】IOC 情資重點
搜尋當天與昨天公開報導中，資安業者/研究單位揭露的重要IOC（惡意IP、網域、檔案雜湊、URL）相關情資重點，列出最多4則有公開來源可查證的重點。

【任務三】勒索軟體與APT活動
搜尋當天與昨天全球重大勒索軟體攻擊事件、勒索軟體集團動態、以及APT（國家級駭客組織）活動相關新聞，列出最多5則。

回傳格式：
{
  "gov_announcements": [
    { "date": "YYYY-MM-DD", "source": "TWCERT/CC 或 資安署", "title": "公告標題", "summary": "40字以內摘要", "url": "來源網址", "is_awareness_case": true或false（是否適合做員工資安宣導教育） }
  ],
  "ioc_highlights": [
    { "campaign": "攻擊行動/惡意程式名稱", "ioc_types": ["IP","Domain","Hash","URL"], "summary": "50字以內說明", "source_name": "來源名稱", "source_url": "來源網址" }
  ],
  "ransomware_apt": [
    { "date": "YYYY-MM-DD", "type": "勒索軟體 或 APT", "title": "事件/組織名稱", "summary": "50字以內摘要", "source_name": "來源名稱", "source_url": "來源網址", "is_awareness_case": true或false（是否適合做員工資安宣導教育） }
  ]
}

注意：summary務必用自己的話改寫，不要照抄原文字句。若某類別找不到足夠資料，回傳較少筆數也沒關係，但陣列格式要維持。`;

  return await callClaudeForJson({
    prompt,
    maxTokens: 8000,
    label: "搜尋分類",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
  });
}

// ---------- 3. AI 綜合摘要（事件/建議兩欄格式） ----------

async function buildDashboard(result) {
  console.log("呼叫 Claude 產生儀表板六大面板資料...");

  const prompt = `你是資安分析師，以下是今天彙整好的原始威脅情資（JSON）。請根據這些資料，產生一份給IT／資安管理人員看的儀表板資料。

原始資料：
${JSON.stringify(result, null, 2)}

請「只」回傳一個 JSON 物件，不要有任何前言、說明文字或 markdown 的 \`\`\` 符號，格式如下：

{
  "headlines": [
    {
      "icon": "一個表情符號，代表這則的類型（例如🦠勒索病毒、🎯漏洞、🕵️APT、📰新聞）",
      "title": "簡潔標題（可参考原始資料的title/topic欄位）",
      "subtitle": "10-20字補充說明",
      "impact": "高、中或低（對一般企業的潛在影響程度）",
      "stars": 1到5的整數（重要程度評分，5最重要）,
      "url": "來源網址（從原始資料對應項目取得，若無可省略）"
    }
  ],
  "vendor_impact": [
    {
      "icon": "廠商對應表情符號，例如Microsoft用🪟、Cisco用🔀、Fortinet用🛡️，其餘用🏢",
      "title": "廠商公告標題（可参考原始資料）",
      "impact": "高、中或低",
      "key_asset": "這則公告主要涉及的關鍵設備/軟體名稱（例如：FortiGate防火牆、Windows Server、SharePoint等），15字以內",
      "ai_suggestion": "20-40字的具體建議行動"
    }
  ],
  "daily_learning": {
    "icon": "一個表情符號",
    "title": "今天的資安知識小主題標題（8-15字，可從今天資料中挑一個值得員工認識的名詞或攻擊手法，例如MFA Fatigue、釣魚郵件辨識等）",
    "description": "60-100字的淺顯說明，用一般員工看得懂的語言解釋這個主題是什麼、為什麼要注意",
    "reading_time": "1到5之間的數字（預估閱讀分鐘數）",
    "url": "若這個主題有對應的今日新聞來源網址可放，沒有則省略"
  },
  "global_events": [
    {
      "category": "勒索病毒、APT攻擊、資料外洩、零時差漏洞 或 政府公告 其中一個",
      "title": "事件標題",
      "date": "YYYY-MM-DD（依原始資料的date/date_added欄位）",
      "url": "來源網址"
    }
  ]
}

規則：
- headlines 從所有原始資料中，挑選今天最重要的5則（跨類別挑選，不限單一類別）
- vendor_impact 從 vendor_advisories 轉換，保留原本筆數
- global_events 從 kev_vulnerabilities（挑is_zero_day或known_ransomware_use的）、ransomware_apt、gov_announcements 轉換彙整，最多12則，依日期新到舊排序
- 所有評分（impact、stars）都是AI研判的參考值，請根據資料內容合理判斷，不要每個都給一樣的分數
- 不需要回傳cve_radar欄位，這部分會用官方NVD資料另外處理`;

  return await callClaudeForJson({ prompt, maxTokens: 8000, label: "儀表板資料" });
}

function computeRiskScore(result) {
  const kev = result.kev_vulnerabilities || [];
  const vendor = result.vendor_advisories || [];
  const ransomwareApt = result.ransomware_apt || [];

  const zeroDayCount = kev.filter((v) => v.is_zero_day).length;
  const kevRansomwareCount = kev.filter((v) => v.known_ransomware_use).length;
  const vendorHighCount = vendor.filter((v) => v.severity_guess === "高").length;
  const ransomwareCount = ransomwareApt.filter((r) => r.type === "勒索軟體").length;
  const aptCount = ransomwareApt.filter((r) => r.type === "APT").length;
  const aiRelatedCount = [...(result.international_news || []), ...ransomwareApt].filter(
    (i) => (i.title || "").toLowerCase().includes("ai") || (i.summary || "").toLowerCase().includes("ai")
  ).length;

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

  const vulnRisk = clamp(kev.length * 12 + zeroDayCount * 15 + vendorHighCount * 8);
  const aptRisk = clamp(aptCount * 30);
  const ransomwareRisk = clamp(ransomwareCount * 22 + kevRansomwareCount * 15);
  const identityRisk = clamp(
    kev.filter((v) => /AD FS|Active Directory|身分|認證|授權/.test(v.title || "")).length * 25
  );
  const aiRisk = clamp(aiRelatedCount * 20);

  const breakdown = [
    { label: "漏洞風險", score: vulnRisk },
    { label: "APT攻擊", score: aptRisk },
    { label: "勒索病毒", score: ransomwareRisk },
    { label: "身份風險", score: identityRisk },
    { label: "AI風險", score: aiRisk },
  ];

  const total = clamp(breakdown.reduce((sum, b) => sum + b.score, 0) / breakdown.length);

  return { total, breakdown };
}

// ---------- 4. 主流程 ----------

async function main() {
  const [kev, vendorAdvisories, intlNews] = await Promise.all([
    fetchCisaKev(),
    fetchVendorAdvisories(),
    fetchIntlNews(),
  ]);

  const classified = await classifyRawData({ kev, vendorAdvisories, intlNews });
  const searched = await searchRemainingCategories();

  const result = {
    kev_vulnerabilities: classified.kev_vulnerabilities || [],
    vendor_advisories: classified.vendor_advisories || [],
    international_news: classified.international_news || [],
    gov_announcements: searched.gov_announcements || [],
    ioc_highlights: searched.ioc_highlights || [],
    ransomware_apt: searched.ransomware_apt || [],
  };

  console.log(
    `彙整完成：KEV ${result.kev_vulnerabilities.length} / 廠商公告 ${result.vendor_advisories.length} / 國際新聞 ${result.international_news.length} / 政府公告 ${result.gov_announcements.length} / IOC ${result.ioc_highlights.length} / 勒索軟體APT ${result.ransomware_apt.length}`
  );

  await enrichKevWithNvdCvss(result.kev_vulnerabilities);

  const dashboard = await buildDashboard(result);
  dashboard.cve_radar = buildCveRadar(result.kev_vulnerabilities);
  dashboard.risk_score = computeRiskScore(result);
  console.log(
    `儀表板產生完成：頭條${(dashboard.headlines||[]).length} / 全球事件${(dashboard.global_events||[]).length} / CVE雷達${(dashboard.cve_radar||[]).length} / 廠商影響${(dashboard.vendor_impact||[]).length} / 風險分數${dashboard.risk_score.total}`
  );

  const templatePath = path.join(process.cwd(), "templates", "threat-intel-template.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const updatedAt = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });

  html = html.replace("__DASHBOARD_JSON__", JSON.stringify(dashboard, null, 2));
  html = html.replace("__UPDATED_AT__", updatedAt + "（台灣時間）");

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(path.join("docs", "index.html"), html, "utf-8");
  console.log("已寫入 docs/index.html");
}

main().catch((err) => {
  console.error("產生威脅情資報告失敗：", err);
  process.exit(1);
});
