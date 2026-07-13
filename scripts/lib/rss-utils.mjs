// 簡易 RSS/Atom 解析工具（不依賴外部套件，用正規表示式抓標準欄位即可）

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? decodeEntities(match[1]) : "";
}

function extractAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, "i");
  const match = block.match(re);
  return match ? match[1] : "";
}

/**
 * 解析 RSS 2.0 / Atom feed 文字，回傳 [{ title, link, pubDate }]
 */
export function parseFeed(xmlText, limit = 10) {
  const items = [];

  // RSS 2.0: <item>...</item>
  const rssItems = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of rssItems) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) link = extractAttr(block, "link", "href");
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated");
    if (title) items.push({ title, link, pubDate });
    if (items.length >= limit) break;
  }

  if (items.length > 0) return items;

  // Atom: <entry>...</entry>
  const atomItems = xmlText.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of atomItems) {
    const title = extractTag(block, "title");
    let link = extractAttr(block, "link", "href") || extractTag(block, "link");
    const pubDate = extractTag(block, "published") || extractTag(block, "updated");
    if (title) items.push({ title, link, pubDate });
    if (items.length >= limit) break;
  }

  return items;
}

export async function fetchFeed(url, limit = 10, label = url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; aurora-security-report/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const items = parseFeed(text, limit);
    console.log(`  ✓ ${label}：取得 ${items.length} 筆`);
    return items;
  } catch (err) {
    console.error(`  ✗ ${label} 抓取失敗：${err.message}`);
    return [];
  }
}
