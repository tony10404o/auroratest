# 威脅情資彙整（每日自動更新）

每天由 GitHub Actions 自動彙整全球威脅情資，產生成靜態網頁並發布到 GitHub Pages。

## 架構

```
.
├── docs/index.html                      ← 實際發布給 GitHub Pages 的網頁（自動產生，不用手動改）
├── templates/threat-intel-template.html ← 網頁樣板
├── scripts/collect-threat-intel.mjs     ← 彙整資料 + 呼叫 Claude API 分析/摘要的腳本
├── scripts/lib/rss-utils.mjs            ← 簡易RSS解析工具
├── .github/workflows/daily-report.yml   ← 排程：每天台灣時間早上 7 點自動跑一次
└── package.json
```

## 設定步驟

1. 建立 GitHub repo，把這整個資料夾內容 push 上去
2. 到 https://console.anthropic.com/settings/keys 申請一把 API Key
3. repo → Settings → Secrets and variables → Actions → New repository secret
   - Name: `ANTHROPIC_API_KEY`
   - Value: 貼上申請的 key
4. repo → Settings → Pages → Source 選 `main` 分支、資料夾選 `/docs`
5. repo → Actions → Daily Security Report → Run workflow 手動測試一次

## 本機測試

```bash
npm install
ANTHROPIC_API_KEY=你的key npm run generate:threat-intel
```
