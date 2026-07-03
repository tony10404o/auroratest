# 資安事件監控台（每日自動更新版）

每天由 GitHub Actions 自動呼叫 Claude API 搜尋全球最新資安事件，產生成靜態網頁並發布到 GitHub Pages。不需要瀏覽器呼叫 API，也不受公司網路限制（因為呼叫是在 GitHub 的伺服器上執行）。

## 架構

```
.
├── docs/index.html              ← 實際發布給 GitHub Pages 的網頁（自動產生，不用手動改）
├── templates/report-template.html  ← 網頁樣板（含 __INCIDENTS_JSON__ / __UPDATED_AT__ 佔位字串）
├── scripts/generate-report.mjs  ← 呼叫 Claude API + 產生 docs/index.html 的腳本
├── .github/workflows/daily-report.yml  ← 排程：每天台灣時間早上 7 點自動跑一次
└── package.json
```

## 設定步驟

1. **建立 GitHub repo**（例如 `aurora-security-report`），把這整個資料夾內容 push 上去。

2. **申請 Anthropic API Key**
   到 https://console.anthropic.com/ → API Keys → 建立一把新的 key。
   （用量計費，一天呼叫一次網路搜尋+文字生成，成本很低）

3. **在 repo 設定 Secret**
   repo → Settings → Secrets and variables → Actions → New repository secret
   - Name: `ANTHROPIC_API_KEY`
   - Value: 貼上你申請的 API key

4. **啟用 GitHub Pages**
   repo → Settings → Pages
   - Source 選 `Deploy from a branch`
   - Branch 選 `main`，資料夾選 `/docs`
   - 存檔後幾分鐘，網址會是 `https://<你的帳號>.github.io/<repo名稱>/`

5. **手動觸發第一次執行（可選）**
   repo → Actions → Daily Security Report → Run workflow
   跑完後 `docs/index.html` 會被自動 commit，網頁內容就會更新。

6. **之後就不用管了**
   每天台灣時間早上 7 點會自動重新搜尋、重新產生網頁。也可以隨時到 Actions 手動點 "Run workflow" 立即更新一次。

## 本機測試（可選）

```bash
npm install
ANTHROPIC_API_KEY=你的key npm run generate
```

會在本機產生 `docs/index.html`，直接用瀏覽器打開就能看。

## 調整範圍

想改成「台灣為主」或鎖定特定廠商，修改 `scripts/generate-report.mjs` 裡的 `PROMPT` 變數即可。
