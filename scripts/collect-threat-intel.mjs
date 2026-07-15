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

const DAYS_BACK = 14;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
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
    fetchFeed("https://api.msrc.microsoft.com/update-guide/rss", 5, "Microsoft MSRC"),
    fetchFeed("https://tools.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml", 5, "Cisco PSIRT"),
    fetchFeed("https://filestore.fortinet.com/fortiguard/rss/ir.xml", 5, "Fortinet PSIRT"),
  ]);
  return {
    microsoft: msrc,
    cisco: cisco,
    fortinet: fortinet,
  };
}

async function fetchIntlNews() {
  console.log("抓取國際資安新聞 RSS...");
  const [bleeping, krebs] = await Promise.all([
    fetchFeed("https://www.bleepingcomputer.com/feed/", 5, "BleepingComputer"),
    fetchFeed("https://krebsonsecurity.com/feed/", 5, "Krebs on Security"),
  ]);
  return { bleeping, krebs };
}

// ---------- 2. AI 分類與摘要（不用web_search，成本低） ----------

function extractJsonObject(text) {
  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("回應內容中找不到 JSON 物件:\n" + text.slice(0, 500));
  return JSON.parse(match[0]);
}

function extractJsonArray(text) {
  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("回應內容中找不到 JSON 陣列:\n" + text.slice(0, 500));
  return JSON.parse(match[0]);
}

const JSON_SAFETY_NOTE = `

【重要格式規則】回傳內容中絕對不要使用直引號雙引號（"）來標示引用語句或強調文字，一律使用中文的「」或『』符號代替，避免破壞JSON字串格式。確保整份回應是可以被JSON.parse()正確解析的合法JSON，陣列與物件的每個元素之間都要有逗號分隔，最後一個元素後面不要有多餘的逗號。`;

/**
 * 呼叫Claude並解析JSON（物件或陣列），若解析失敗會自動重試一次
 * （AI輸出偶爾會有引號跳脫或格式問題，重試通常就能修正）
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
- international_news 挑選最重要的6-8則，摘要必須用自己的話改寫，不要照抄原文標題字句
- 如果某類別原始資料是空的，該欄位回傳空陣列即可`;

  return await callClaudeForJson({ prompt, maxTokens: 8000, label: "分析分類" });
}

// ---------- 3. AI 搜尋（web_search，用在沒有乾淨API的類別） ----------

async function searchRemainingCategories() {
  console.log("呼叫 Claude 搜尋（國內CERT/政府公告、IOC情資、勒索軟體與APT活動）...");

  const prompt = `請完成以下三項任務，並回傳單一 JSON 物件（不要有任何前言、說明文字或 markdown 的 \`\`\` 符號）。請盡量精簡搜尋次數（6次以內廣泛搜尋）。

【任務一】國內 CERT 與政府資安公告
搜尋台灣 TWCERT/CC（https://www.twcert.org.tw）與數位發展部資安署（ACS）過去14天內發布的資安公告、預警或新聞，列出5-8則。

【任務二】IOC 情資重點
搜尋過去7天內公開報導中，資安業者/研究單位揭露的重要IOC（惡意IP、網域、檔案雜湊、URL）相關情資重點，例如新型惡意程式的C2網域、釣魚網域、勒索軟體樣本雜湊等，列出4-6則有公開來源可查證的重點（不需要列出完整IOC清單，重點是說明「哪個攻擊行動/惡意程式」關聯到什麼類型的IOC，並附來源連結）。

【任務三】勒索軟體與APT活動
搜尋過去14天內全球重大勒索軟體攻擊事件、勒索軟體集團動態、以及APT（國家級駭客組織）活動相關新聞，列出5-8則。

回傳格式：
{
  "gov_announcements": [
    { "date": "YYYY-MM-DD", "source": "TWCERT/CC 或 資安署", "title": "公告標題", "summary": "40字以內摘要", "url": "來源網址", "is_awareness_case": true或false（是否適合做員工資安宣導教育） }
  ],
  "ioc_highlights": [
    { "campaign": "攻擊行動/惡意程式名稱", "ioc_types": ["IP","Domain","Hash","URL"]（列出這則情資涉及的IOC類型即可，陣列）, "summary": "50字以內說明", "source_name": "來源名稱", "source_url": "來源網址" }
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

// ---------- 4. AI 綜合摘要 ----------

async function generateSummary(result) {
  console.log("呼叫 Claude 產生今日綜合摘要（分段版）...");

  const prompt = `你是資安分析師，以下是今天彙整好的威脅情資（JSON），請用繁體中文寫一份「今日摘要」，給IT／資安管理人員快速掌握重點，但要比一般摘要更詳細一些。

請將摘要拆成 3-5 個獨立段落，每個段落聚焦一個面向，例如（依實際資料調整，不用完全照抄）：
- 高風險漏洞與0-day動態
- 重大攻擊事件／資料外洩
- 勒索軟體與APT組織動態
- 趨勢觀察或需留意的攻擊手法
- 建議優先行動

每段請給一個簡短標題（4-8字），內文60-100字，具體點出關鍵事實（例如CVE編號、廠商、公司名稱），不要空泛。若某面向今天沒有值得寫的內容，可以省略該段落，不用硬湊。

請「只」回傳一個 JSON 陣列，不要有任何前言、說明文字或 markdown 的 \`\`\` 符號，格式如下：
[
  { "heading": "段落標題", "text": "段落內文" }
]

資料：
${JSON.stringify(result, null, 2)}`;

  return await callClaudeForJson({ prompt, maxTokens: 1500, label: "AI摘要", parseAs: "array" });
}

// ---------- 5. 主流程 ----------

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

  result.ai_summary = await generateSummary(result);
  console.log("AI摘要：", result.ai_summary);

  const templatePath = path.join(process.cwd(), "templates", "threat-intel-template.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const updatedAt = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });

  html = html.replace("__THREAT_INTEL_JSON__", JSON.stringify(result, null, 2));
  html = html.replace("__UPDATED_AT__", updatedAt + "（台灣時間）");

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(path.join("docs", "index.html"), html, "utf-8");
  console.log("已寫入 docs/index.html");
}

main().catch((err) => {
  console.error("產生威脅情資報告失敗：", err);
  process.exit(1);
});
