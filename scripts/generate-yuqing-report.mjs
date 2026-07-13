import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺少 ANTHROPIC_API_KEY 環境變數（請在 GitHub Secrets 設定）");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

const PROMPT = `請完成以下兩項任務，並回傳單一 JSON 物件（不要有任何前言、說明文字或 markdown 的 \`\`\` 符號）：

【任務一】全球資安輿情議題
搜尋過去7天內全球資安相關議題的網路討論狀況，範圍包含新聞媒體報導，以及 PTT（site:ptt.cc）、Dcard（site:dcard.tw）、X/Twitter（site:x.com 或 site:twitter.com）等公開頁面上找得到的討論。請盡量精簡搜尋次數（3-5次廣泛搜尋即可）。挑選其中6-8個目前討論度最高、最值得關注的資安議題。

【任務二】TWCERT/CC 電子報
搜尋台灣電腦網路危機處理暨協調中心（TWCERT/CC）電子報清單頁面 https://www.twcert.org.tw/tw/lp-106-1.html 目前列出的最新一期資安情資電子報，列出最新的6-8期。

回傳格式：
{
  "topics": [
    {
      "topic": "議題名稱（繁體中文，簡潔）",
      "buzz_level": "高、中或低（根據找到的新聞/討論數量與擴散程度質化判斷）",
      "sentiment": "正面、中立、負面或兩極（網路討論整體風向）",
      "trend": "上升、持平或下降（討論熱度趨勢，若無法判斷可省略此欄位）",
      "is_zero_day": true 或 false（這個議題是否涉及零時差漏洞，也就是廠商尚未修補或剛修補不久、曾被公開揭露/利用的漏洞；若不是漏洞相關議題請填 false）,
      "cve_id": "相關的CVE編號（例如CVE-2026-50656），若非漏洞議題或找不到編號可省略此欄位",
      "summary": "50字以內的繁體中文摘要，用自己的話說明議題內容以及大家在討論/擔心/爭論什麼，不要直接引用原文",
      "sources": [
        { "name": "來源名稱（例如：某新聞媒體、PTT某板、X等）", "url": "來源網址" }
      ]
    }
  ],
  "twcert_news": [
    {
      "date": "YYYY-MM-DD",
      "title": "電子報標題（例如：TWCERT/CC 2026年6月份資安情資電子報）",
      "url": "該期電子報的線上閱覽網址，固定格式為 https://epaper.twcert.org.tw/YYYY_MM/ （YYYY是西元年、MM是月份需補零，例如2026年6月份對應 https://epaper.twcert.org.tw/2026_06/），請依標題中的年月自行組出網址"
    }
  ]
}

注意：topics 裡的 sources 最多列2個代表性來源即可，summary 請務必用自己的話改寫，不要照抄原文字句。twcert_news 請依日期新到舊排序。`;

function extractJsonObject(text) {
  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("回應內容中找不到 JSON 物件:\n" + text.slice(0, 500));
  }
  return JSON.parse(match[0]);
}

async function main() {
  console.log("正在呼叫 Claude API 搜尋資安輿情與 TWCERT/CC 最新消息...");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: PROMPT }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 7 }],
  });

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const result = extractJsonObject(textBlocks);
  const topics = result.topics;
  const twcertNews = result.twcert_news;

  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("解析出的議題清單是空的");
  }
  if (!Array.isArray(twcertNews) || twcertNews.length === 0) {
    throw new Error("解析出的 TWCERT/CC 消息清單是空的");
  }
  console.log(`取得 ${topics.length} 個資安輿情議題，${twcertNews.length} 則 TWCERT/CC 消息`);

  const templatePath = path.join(process.cwd(), "templates", "yuqing-template.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const updatedAt = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });

  html = html.replace("__TOPICS_JSON__", JSON.stringify(topics, null, 2));
  html = html.replace("__TWCERT_NEWS_JSON__", JSON.stringify(twcertNews, null, 2));
  html = html.replace("__UPDATED_AT__", updatedAt + "（台灣時間）");

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(path.join("docs", "yuqing.html"), html, "utf-8");
  console.log("已寫入 docs/yuqing.html");
}

main().catch((err) => {
  console.error("產生輿情報告失敗：", err);
  process.exit(1);
});
