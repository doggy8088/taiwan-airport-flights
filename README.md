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
├── docs/                             # 多機場文件
│   └── airports/
│       └── penghu/
│           ├── data.json            # 航班資料範例
│           ├── flight-data-schema.md
│           └── flight-position-data-research.md
├── scripts/                          # 自動化腳本
│   ├── minify-public.cjs            # GitHub Pages 壓縮腳本
│   └── poll-flight-to-azure.mjs     # 航班輪詢上傳 Azure
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

## GitHub Actions：航班資料輪詢並上傳 Azure Blob

本專案提供一個 GitHub Actions workflow：`.github/workflows/flight-cache-to-azure.yml`，用來在指定時段內每 60 秒抓取一次航班資料，並持續覆寫更新 Azure Blob 內的 `data.json`。

- 觸發時間（台北時間）：每日 07:00 / 11:00 / 15:00 / 19:00
- 每次執行：3 小時 59 分（避免與下一次排程重疊）
- 時區注意：GitHub Actions `schedule.cron` 使用 UTC，workflow 內已換算為 UTC+8

### 需要設定的 Secrets

到 GitHub repo：`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

- `AZURE_CONTAINER_SAS_URL`（建議）：Container level 的 SAS URL，例如：`https://<account>.blob.core.windows.net/<container>?<sas>`
  - 可同時上傳 `data.json` 與錯誤 log（需要對 blob 物件具備寫入/建立權限）

### 錯誤 Log（以日期分類）

當每次輪詢發生錯誤時，workflow 不會中止，會把錯誤寫入 log 並（若有 `AZURE_CONTAINER_SAS_URL`）上傳到：

- `logs/YYYY-MM-DD/run-<timestamp>.log`

### 使用說明

腳本使用方式請參考 [docs/poll-flight-to-azure.md](docs/poll-flight-to-azure.md)。

