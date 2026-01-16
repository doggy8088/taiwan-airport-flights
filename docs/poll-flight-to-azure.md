# poll-flight-to-azure.mjs 使用說明

## 概述

`scripts/poll-flight-to-azure.mjs` 會定期抓取航班資料，並將 JSONP 結果上傳到 Azure Blob。可用於 GitHub Actions 或本機測試。目前資料檔名固定為 `data-penghu.jsonp`。

## 需求

- Node.js 18+（使用內建 `fetch`）
- Azure Blob SAS URL（擇一）

## 快速開始（PowerShell）

```powershell
$env:AZURE_CONTAINER_SAS_URL = "https://<account>.blob.core.windows.net/<container>?<sas>"
node scripts/poll-flight-to-azure.mjs
```

## 環境變數

| 變數 | 說明 | 預設值 |
| --- | --- | --- |
| `FETCH_URL` | 航班資料來源 URL | 澎湖馬公機場航班頁 |
| `RUN_SECONDS` | 執行總秒數 | `3h59m` |
| `INTERVAL_SECONDS` | 輪詢間隔秒數 | `60` |
| `TIME_ZONE` | log 檔名時區 | `Asia/Taipei` |
| `DRY_RUN` | `1` 時只抓資料不寫入 | `""` |
| `AZURE_CONTAINER_SAS_URL` | Container SAS（必要，支援 log） | `""` |

> 未設定 `AZURE_CONTAINER_SAS_URL` 會導致上傳失敗（除非使用 `DRY_RUN=1`）。

## 產出

- 資料檔：`<container>/data-penghu.jsonp`
- 錯誤 log（需 `AZURE_CONTAINER_SAS_URL`）：`logs/YYYY-MM-DD/run-<timestamp>.log`

## 範例

### Dry run（不寫入）

```powershell
$env:DRY_RUN = "1"
node scripts/poll-flight-to-azure.mjs
```

### 自訂輪詢時間

```powershell
$env:RUN_SECONDS = "900"
$env:INTERVAL_SECONDS = "30"
node scripts/poll-flight-to-azure.mjs
```
