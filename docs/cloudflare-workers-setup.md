# Cloudflare Workers 航班輪詢部署 SOP

> 本文件說明如何將航班資料輪詢作業從 GitHub Actions 長時間執行架構，遷移至 **Cloudflare Workers + Cron Trigger** 的方案。Worker 每分鐘觸發一次，抓取澎湖馬公機場最新航班資訊後，上傳至 Azure Blob Storage。

---

## 目錄

1. [架構說明](#架構說明)
2. [前置需求](#前置需求)
3. [安裝 Wrangler CLI](#安裝-wrangler-cli)
4. [登入 Cloudflare](#登入-cloudflare)
5. [設定 Secrets](#設定-secrets)
6. [部署 Worker](#部署-worker)
   - [自動部署（GitHub Actions，建議）](#自動部署github-actions建議)
   - [手動部署（Wrangler CLI）](#手動部署wrangler-cli)
7. [驗證 Cron Trigger](#驗證-cron-trigger)
8. [本機測試](#本機測試)
9. [日常維護](#日常維護)
10. [移除 Worker](#移除-worker)
11. [疑難排解](#疑難排解)

---

## 架構說明

| 比較項目 | 舊架構（GitHub Actions） | 新架構（Cloudflare Workers） |
|---|---|---|
| 執行方式 | 長時間執行（最長 6 小時/時段，共 3 時段） | 每分鐘短時間觸發（< 30 秒） |
| 觸發機制 | GitHub Actions `schedule` cron（每日 3 次） | Cloudflare Cron Trigger（每分鐘 1 次） |
| 資源消耗 | GitHub Actions 分鐘數（付費方案影響） | Cloudflare Workers 免費方案（每日 10 萬次免費請求） |
| 維護複雜度 | 需管理 3 個時段、duration 計算 | 單一 Worker，無需時段切割 |
| 間隔損失 | 時段切換空隙約 1–2 分鐘 | 無間隔損失 |
| 可觀測性 | GitHub Actions 日誌 | Cloudflare Workers 即時日誌 |

**資料流：**

```
Cloudflare Cron Trigger（每分鐘）
  → Cloudflare Worker（workers/flight-poller/src/index.js）
    → 抓取澎湖機場 HTML 頁面
    → 解析航班資料
    → 上傳 JSONP 至 Azure Blob Storage
```

---

## 前置需求

- **Cloudflare 帳號**：[https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
- **Node.js 18+**（用於執行 Wrangler）
- **Azure Blob Storage Container SAS URL**（與現有 GitHub Actions 相同的 Secret）

> **Cloudflare Workers 免費方案限制：**
> - 每日 100,000 次 Worker 請求（每分鐘觸發 = 每日約 960 次，遠低於限制）
> - 每次執行上限 10 ms CPU 時間（實際為 30 秒總時長）
> - 無需信用卡即可使用免費方案

---

## 安裝 Wrangler CLI

```bash
npm install -g wrangler
```

確認安裝成功：

```bash
wrangler --version
```

---

## 登入 Cloudflare

```bash
wrangler login
```

執行後會開啟瀏覽器，使用 Cloudflare 帳號授權。授權完成後終端機會顯示登入成功訊息。

若在無頭伺服器（headless）環境執行，可改用 API Token：

```bash
export CLOUDFLARE_API_TOKEN="<your-api-token>"
```

> API Token 需具備 **Workers Scripts:Edit**、**Workers Routes:Edit** 及 **Account Settings:Read** 權限。
> 建立方式：Cloudflare Dashboard → My Profile → API Tokens → Create Token。

---

## 設定 Secrets

進入 worker 目錄：

```bash
cd workers/flight-poller
```

設定 Azure Blob Container SAS URL（互動式輸入，不會出現在終端機歷史記錄）：

```bash
wrangler secret put AZURE_CONTAINER_SAS_URL
```

系統提示輸入值時，貼上 SAS URL，格式範例：

```
https://<storage-account>.blob.core.windows.net/<container>?sv=...&sp=rcw&...
```

> **注意事項：**
> - 請勿將 SAS URL 寫入 `wrangler.toml` 或任何版本控制的檔案
> - SAS URL 需具備 **Read（r）**、**Create（c）**、**Write（w）** 權限
> - 建議設定適當的過期時間，並在過期前更新

確認 Secret 已設定：

```bash
wrangler secret list
```

---

## 部署 Worker

### 自動部署（GitHub Actions，建議）

本專案提供 `.github/workflows/deploy-worker.yml`，當 `workers/flight-poller/` 目錄有任何變更推送至 `main` 分支時，會自動：

1. 使用 `cloudflare/wrangler-action` 部署 Worker
2. 建立 GitHub Release，Release Notes 包含部署網址

**所需 GitHub Secrets（一次性設定）：**

到 GitHub Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：

| Secret 名稱 | 說明 |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare 帳號 ID（Dashboard 右側欄） |
| `CF_ACCOUNT_KEY` | Cloudflare API Token（需具備 Workers Scripts:Edit 及 Account Settings:Read 權限） |
| `AZURE_CONTAINER_SAS_URL` | Azure Blob Container 層級 SAS URL |

**設定 Cloudflare API Token：**

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 右上角頭像 → **My Profile** → **API Tokens**
3. **Create Token** → 選擇 **Edit Cloudflare Workers** 範本
4. 在權限清單中確認包含以下兩項：
   - `Workers Scripts:Edit`（部署 Worker 腳本）
   - `Account Settings:Read`（讀取 workers.dev 子網域以產生部署網址）
5. 複製產生的 Token，填入 GitHub Secret `CF_ACCOUNT_KEY`

設定完成後，只需推送變更至 `main`，Worker 即自動部署並產生 Release。也可至 GitHub Actions 頁面手動觸發 **workflow_dispatch**。

---

### 手動部署（Wrangler CLI）

在 `workers/flight-poller/` 目錄下執行：

```bash
wrangler deploy
```

成功部署後會看到類似輸出：

```
⛅️ wrangler x.x.x
──────────────────────────────────────────────────────
Total Upload: xx.xx KiB / gzip: x.xx KiB
Worker Startup Time: x ms
Your worker has access to the following bindings:
- Secrets:
  - AZURE_CONTAINER_SAS_URL
Uploaded taiwan-airport-flights (x.xx sec)
Deployed taiwan-airport-flights triggers (x.xx sec)
  schedule: * * * * *
Current Version ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

## 驗證 Cron Trigger

### 方法一：Dashboard 查看

1. 前往 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 選擇帳號 → **Workers & Pages**
3. 點選 `taiwan-airport-flights`
4. 點選 **Triggers** 分頁，確認 **Cron Triggers** 顯示 `* * * * *`

### 方法二：手動觸發測試（Dashboard）

1. Dashboard → Workers & Pages → `taiwan-airport-flights`
2. 點選 **Triggers** → **Test**
3. 在 **Scheduled Event** 欄位輸入測試時間（可使用當前時間）
4. 按下 **Test Trigger**，觀察右側 **Output** 是否顯示成功日誌

### 方法三：確認 Azure Blob 有更新

等待下一分鐘觸發後，確認 Azure Blob 中 `data-penghu.jsonp` 的最後修改時間有更新：

```bash
# 使用 Azure CLI 確認
az storage blob show \
  --account-name <storage-account> \
  --container-name <container> \
  --name data-penghu.jsonp \
  --query "properties.lastModified"
```

---

## 本機測試

### 使用 wrangler dev 模擬 Cron

```bash
cd workers/flight-poller
wrangler dev --test-scheduled
```

啟動後，在另一個終端機呼叫模擬端點（預設 port 8787）：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

> **注意：** 本機測試時 `AZURE_CONTAINER_SAS_URL` 需透過 `.dev.vars` 檔案設定（此檔不應提交至版本控制）：
>
> ```bash
> # workers/flight-poller/.dev.vars（勿提交至 git）
> AZURE_CONTAINER_SAS_URL=https://<account>.blob.core.windows.net/<container>?<sas>
> ```

### Dry Run（不上傳，僅列印）

如需在本機測試時不上傳到 Azure，可暫時移除 `.dev.vars` 中的 `AZURE_CONTAINER_SAS_URL`，Worker 會在缺少該 Secret 時提前結束並印出錯誤訊息。

---

## 日常維護

### 查看即時日誌

```bash
cd workers/flight-poller
wrangler tail
```

每分鐘觸發時，終端機會顯示類似：

```
[2026-04-26T01:20:00.000Z] INFO Starting fetch and upload. {"cron":"* * * * *","scheduledTime":"2026-04-25T17:20:00.000Z","sourceUrl":"https://www.mkport.gov.tw/Flight/moreArrival.aspx?1=1&MenuID=5F8C5942FDC5D1C4","blobUrl":"https://<account>.blob.core.windows.net/flight-data/data-penghu.jsonp","sasPermissions":"rcw","sasExpiresAt":"2026-06-30T23:59:59.000Z"}
[2026-04-26T01:20:02.000Z] INFO Uploaded blob successfully. {"rows":57,"azureStatus":201,"azureRequestId":"...","azureLastModified":"Sat, 26 Apr 2026 01:20:02 GMT"}
```

若 `AZURE_CONTAINER_SAS_URL` 已過期或缺少寫入權限，Worker 會先記錄警告並直接讓此次 Cron 顯示失敗，方便在 Cloudflare Dashboard 與 `wrangler tail` 追查。

### 更新程式碼後重新部署

```bash
cd workers/flight-poller
wrangler deploy
```

### 更新 SAS URL

```bash
cd workers/flight-poller
wrangler secret put AZURE_CONTAINER_SAS_URL
```

### 暫停 Cron Trigger

1. Cloudflare Dashboard → Workers & Pages → `taiwan-airport-flights`
2. **Triggers** 分頁 → **Cron Triggers** → 點選刪除圖示

或修改 `wrangler.toml`，將 `crons` 設為空陣列後重新部署：

```toml
[triggers]
crons = []
```

```bash
wrangler deploy
```

---

## 移除 Worker

```bash
cd workers/flight-poller
wrangler delete
```

確認提示後，Worker 及其 Cron Trigger 將被永久刪除。

---

## 疑難排解

### Worker 沒有在預期時間執行

**原因：** Cloudflare Cron Trigger 最多有 ±30 秒的觸發誤差。

**解決方式：** 屬正常現象，無需處理。

---

### 上傳失敗：`Azure PUT failed: 403`

**原因：** SAS URL 已過期或權限不足。

**解決方式：**
1. 至 Azure Portal 重新產生具有 `r`、`c`、`w` 權限的 Container SAS URL
2. 更新 Cloudflare Secret：
   ```bash
   wrangler secret put AZURE_CONTAINER_SAS_URL
   ```
3. 使用 `wrangler tail` 檢查 log 中的 `sasPermissions`、`sasExpiresAt` 與 `azureRequestId`

---

### 航班資料解析結果為空（0 rows）

**原因：** 澎湖機場網站 HTML 結構可能已更新。

**解決方式：**
1. 開啟 [澎湖機場航班頁](https://www.mkport.gov.tw/Flight/moreArrival.aspx?1=1&MenuID=5F8C5942FDC5D1C4) 確認頁面是否正常
2. 若 HTML 結構已改變，需更新 `src/index.js` 中 `fetchFlightDataInternal` 的解析邏輯

---

### `wrangler login` 無法開啟瀏覽器

**原因：** 在 SSH 或 CI 環境執行。

**解決方式：** 改用 API Token：

```bash
export CLOUDFLARE_API_TOKEN="<your-api-token>"
```

API Token 建立方式：

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 右上角頭像 → **My Profile** → **API Tokens**
3. **Create Token** → 選擇 **Edit Cloudflare Workers** 範本
4. 填寫 Token 名稱，確認帳號與 Zone 範圍
5. 建立後複製 Token（僅顯示一次）

---

### 免費方案請求次數用盡

**現況評估：** 每分鐘 1 次 × 60 分鐘 × 16 小時 = 每日最多 960 次，遠低於免費方案的每日 100,000 次上限，正常使用不會超額。

若有特殊需求（如縮短觸發間隔），請參考 [Cloudflare Workers 付費方案](https://developers.cloudflare.com/workers/platform/pricing/)。
