# 台灣國內航班即時監控

## 專案簡介

本專案目標是整合台灣國內多個機場的航班資訊，目前已完成澎湖馬公機場整合。前端採 GitHub Pages 靜態部署，並提供輪詢腳本將資料同步到外部儲存。

## 主要功能

- **GitHub Pages 靜態網頁** - 前端原始碼放在 `public/`，部署前會壓縮 HTML/CSS/JS 並輸出至 `public/dist`
- **多機場導覽頁** - `public/index.html` 提供機場入口導覽
- **航班輪詢腳本** - `scripts/poll-flight-to-azure.mjs` 會抓取航班資料並上傳儲存
- **多機場文件管理** - `docs/airports/<airport>/` 分別管理不同機場的資料來源與規格

## 檔案結構

```text
taiwan-airport-flights/
├── public/                           # GitHub Pages 前端原始碼
│   ├── index.html                   # 機場導覽頁
│   └── airports/
│       └── penghu/
│           └── index.html           # 澎湖機場航班頁
├── workers/                          # Cloudflare Workers
│   └── flight-poller/
│       ├── src/
│       │   └── index.js             # Worker 主程式（每分鐘抓取並上傳）
│       └── wrangler.toml            # Wrangler 設定（Cron Trigger）
├── docs/                             # 多機場文件
│   ├── cloudflare-workers-setup.md  # Cloudflare Workers 安裝設定 SOP
│   └── airports/
│       └── penghu/
│           ├── data.json            # 航班資料範例
│           ├── flight-data-schema.md
│           └── flight-position-data-research.md
├── scripts/                          # 自動化腳本
│   ├── minify-public.cjs            # GitHub Pages 壓縮腳本
│   └── poll-flight-to-azure.mjs     # 航班輪詢上傳 Azure（GitHub Actions 用）
├── .github/workflows/               # GitHub Actions
│   └── deploy.yml                   # 自動部署到 GitHub Pages
├── package.json                      # Node.js 專案設定
└── README.md                         # 本說明文件
```

## 文件架構（多機場）

每個機場的資料來源、欄位定義與研究筆記都放在 `docs/airports/<airport>/`。新增機場時請建立對應資料夾，以便分開管理不同介接方式。

## 本機開發

1. 安裝依賴：`npm install`
2. 編輯 `public/` 內的頁面與資源
3. 本機以 HTTP 方式啟動（避免 `file://` 造成的 CORS 問題）：`npm start`
   - 會先執行 `pages:build`，並監看 `public/` 變更後自動重建到 `public/dist`
4. 只想手動產出壓縮版靜態檔：`npm run pages:build`

## 部署說明

### GitHub Pages 部署

本專案包含獨立的靜態網頁，可部署至 GitHub Pages 供公開存取：

1. 前往 GitHub repository 的 **Settings** > **Pages**
2. 在 **Source** 下選擇 **GitHub Actions**
3. 推送變更到 `gas-penghu-flight-monitor` 分支後，GitHub Actions 會先執行 `npm run pages:build`，再部署 `public/dist`
4. 部署完成後即可透過 GitHub Pages 網址存取

## 航班資料輪詢並上傳 Azure Blob

本專案提供兩種輪詢架構，可依需求擇一使用：

### 方案一：Cloudflare Workers（建議）

利用 **Cloudflare Workers + Cron Trigger** 每分鐘觸發一次 Worker，抓取最新航班資訊後上傳至 Azure Blob Storage。

- 無需長時間佔用 GitHub Actions 分鐘數
- 每分鐘觸發，無時段切換間隔損失
- Cloudflare Workers 免費方案每日 10 萬次請求，日常使用（約 960 次/日）遠低於上限

**完整安裝設定 SOP** 請參閱 [docs/cloudflare-workers-setup.md](docs/cloudflare-workers-setup.md)。

Worker 程式碼位於 `workers/flight-poller/`：

```text
workers/
└── flight-poller/
    ├── src/
    │   └── index.js       # Worker 主程式（每次觸發執行一次抓取與上傳）
    └── wrangler.toml      # Wrangler 設定（含 Cron Trigger）
```

需要設定的 Cloudflare Secret：

- `AZURE_CONTAINER_SAS_URL`：Azure Blob Container 層級 SAS URL

Worker 會在 Cloudflare Logs 記錄：

- Cron 時間與是否落在服務時段
- 來源網址與目標 blob URL（已移除 SAS query）
- SAS 權限（`sp`）與到期時間（`se`）
- Azure PUT 成功狀態、request ID，或失敗錯誤摘要

若 Azure 寫入失敗，排程會直接回報失敗，不再只有 Cron 事件顯示成功。

---

### 方案二：GitHub Actions（長時間執行）

本專案同時保留 `.github/workflows/flight-cache-to-azure.yml`，在指定時段內每 60 秒抓取一次航班資料，並持續覆寫更新 Azure Blob 內的 `data.json`。

- 觸發時間（台北時間）：每日 07:00 / 13:00 / 19:00
- 每次執行：最長 5 小時 59 分（三時段覆蓋 07:00–23:00）
- 時區注意：GitHub Actions `schedule.cron` 使用 UTC，workflow 內已換算為 UTC+8

需要設定的 GitHub Secrets（`Settings` → `Secrets and variables` → `Actions`）：

- `AZURE_CONTAINER_SAS_URL`：Container level 的 SAS URL，例如：`https://<account>.blob.core.windows.net/<container>?<sas>`

#### 錯誤 Log（以日期分類）

當每次輪詢發生錯誤時，workflow 不會中止，會把錯誤寫入 log 並（若有 `AZURE_CONTAINER_SAS_URL`）上傳到：

- `logs/YYYY-MM-DD/run-<timestamp>.log`

腳本使用方式請參考 [docs/poll-flight-to-azure.md](docs/poll-flight-to-azure.md)。
