import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺少 ANTHROPIC_API_KEY 環境變數（請在 GitHub Secrets 設定）");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

const PROMPT = `請搜尋過去14天內全球發生的重大資安事件（例如：資料外洩、勒索軟體攻擊、重大漏洞、DDoS攻擊、供應鏈攻擊、國家級駭客攻擊等），挑選其中10則最重要、最新的事件。

請「只」回傳一個 JSON 陣列，不要有任何前言、說明文字或 markdown 的 \`\`\` 符號。每個元素格式如下：
{
  "date": "YYYY-MM-DD",
  "title": "事件標題（繁體中文，簡潔）",
  "category": "類別（例如：資料外洩、勒索軟體、漏洞、DDoS、供應鏈攻擊、國家級攻擊、其他）",
  "affected_org": "受影響的組織或廠商名稱",
  "region": "主要地區（例如：美國、歐洲、亞太、台灣、全球）",
  "severity": "高、中或低",
  "summary": "40字以內的繁體中文摘要，說明發生什麼事及影響",
  "source_name": "新聞來源名稱",
  "source_url": "新聞來源網址"
}`;

function extractJsonArray(text) {
  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("回應內容中找不到 JSON 陣列:\n" + text.slice(0, 500));
  }
  return JSON.parse(match[0]);
}

async function main() {
  console.log("正在呼叫 Claude API 搜尋最新資安事件...");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: PROMPT }],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  });

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const incidents = extractJsonArray(textBlocks);
  if (!Array.isArray(incidents) || incidents.length === 0) {
    throw new Error("解析出的事件清單是空的");
  }
  console.log(`取得 ${incidents.length} 筆資安事件`);

  const templatePath = path.join(process.cwd(), "templates", "report-template.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const updatedAt = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });

  html = html.replace("__INCIDENTS_JSON__", JSON.stringify(incidents, null, 2));
  html = html.replace("__UPDATED_AT__", updatedAt + "（台灣時間）");

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(path.join("docs", "index.html"), html, "utf-8");
  console.log("已寫入 docs/index.html");
}

main().catch((err) => {
  console.error("產生報告失敗：", err);
  process.exit(1);
});
