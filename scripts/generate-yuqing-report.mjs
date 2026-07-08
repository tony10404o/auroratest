import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺少 ANTHROPIC_API_KEY 環境變數（請在 GitHub Secrets 設定）");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

const PROMPT = `請搜尋過去7天內全球資安相關議題的網路討論狀況，範圍包含新聞媒體報導，以及 PTT（site:ptt.cc）、Dcard（site:dcard.tw）、X/Twitter（site:x.com 或 site:twitter.com）等公開頁面上找得到的討論。請盡量精簡搜尋次數（3-5次廣泛搜尋即可）。

挑選其中6-8個目前討論度最高、最值得關注的資安議題（可以是重大資安事件、新型態攻擊手法、資安政策法規、知名資安研究/揭露、資安產業重大新聞等）。

請「只」回傳一個 JSON 陣列，不要有任何前言、說明文字或 markdown 的 \`\`\` 符號。每個元素格式如下：
{
  "topic": "議題名稱（繁體中文，簡潔）",
  "buzz_level": "高、中或低（根據找到的新聞/討論數量與擴散程度質化判斷）",
  "sentiment": "正面、中立、負面或兩極（網路討論整體風向）",
  "trend": "上升、持平或下降（討論熱度趨勢，若無法判斷可省略此欄位）",
  "summary": "50字以內的繁體中文摘要，用自己的話說明議題內容以及大家在討論/擔心/爭論什麼，不要直接引用原文",
  "sources": [
    { "name": "來源名稱（例如：某新聞媒體、PTT某板、X等）", "url": "來源網址" }
  ]
}

注意：sources 裡最多列2個代表性來源即可，summary 請務必用自己的話改寫，不要照抄原文字句。`;

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
  console.log("正在呼叫 Claude API 搜尋資安輿情...");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: PROMPT }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  });

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const topics = extractJsonArray(textBlocks);
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("解析出的議題清單是空的");
  }
  console.log(`取得 ${topics.length} 個資安輿情議題`);

  const templatePath = path.join(process.cwd(), "templates", "yuqing-template.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const updatedAt = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });

  html = html.replace("__TOPICS_JSON__", JSON.stringify(topics, null, 2));
  html = html.replace("__UPDATED_AT__", updatedAt + "（台灣時間）");

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(path.join("docs", "yuqing.html"), html, "utf-8");
  console.log("已寫入 docs/yuqing.html");
}

main().catch((err) => {
  console.error("產生輿情報告失敗：", err);
  process.exit(1);
});
