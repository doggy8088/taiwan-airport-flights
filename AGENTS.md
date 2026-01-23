# AGENTS — Taiwan Airport Flights Development Guide

Read #file:README.md for general development instructions.

Quick context

- Static GitHub Pages front-end lives in `public/` and is built to `public/dist`.
- Node.js scripts in `scripts/` handle polling/upload automation.
- Keep edits small and readable; prefer pure helpers over large monoliths.

Local workflow

1. Install dependencies: `npm install`.
2. Edit files in `public/`, `docs/`, or `scripts/`.
3. Build minified assets: `npm run pages:build`.
4. For polling script smoke tests, set `DRY_RUN=1` and run `node scripts/poll-flight-to-azure.mjs`.

PowerShell (Windows)

- If you are developing on Windows and use PowerShell (`pwsh.exe`) as your default shell, prefer PowerShell commands when performing file operations and running local tools. Examples:
  - Use `pwsh -Command "npm run pages:build"` or run `npm run pages:build` directly inside a `pwsh` session.
  - Use `Get-ChildItem`, `Remove-Item`, `Copy-Item`, `New-Item`, etc., for file and directory operations instead of POSIX commands.
  - When referencing paths, prefer Windows-style paths, and quote them when they contain spaces: `"C:\\Path With Spaces\\file.txt"`.
  - For long-running scripts or background tasks in PowerShell, prefer `Start-Job` or `Start-Process` with proper logging.

Coding standards

- Use `const`/`let`; avoid `var`.
- Add JSDoc for public helpers; enable `// @ts-check` at the top to catch obvious issues.
- Handle external calls defensively (timeouts, retries, clear error messages).
- Keep side effects isolated; prefer small functions that can be invoked directly via Node scripts.

Secrets and configuration

- Never hardcode secrets (e.g., API keys, app passwords). Store them in environment variables or GitHub Secrets.
- Use `AZURE_CONTAINER_SAS_URL` for the polling script.
- Do not log secrets; sanitize logs before printing.

Testing and verification

- Create small, deterministic helpers and run them with Node.
- Use `DRY_RUN=1` for polling script dry runs.
- Use `console.log` for trace output.

Deployment and triggers

- GitHub Pages deploys via `.github/workflows/deploy.yml`.
- Polling automation uses `.github/workflows/flight-cache-to-azure.yml`.

## Workflow 時段分配策略

### 背景

本專案提供**即時班機資訊**，**每分鐘都需要執行** API polling 並上傳至 Azure Blob，確保資料即時性。由於 GitHub Actions 單次執行上限為 **6 小時 (360 分鐘 = 21600 秒)**，無法一次覆蓋目標時段 (台灣時間 07:00-23:00 共 16 小時)，因此需要拆分成 3 個時段執行。

**核心需求**：間隔損失必須 **≤ 1 分鐘**，以維持即時班機資訊的連續性。

### 時段設計原則

1. **即時性優先**：時段間隔 ≤ 1 分鐘，確保資料連續性
2. **最大化執行時間**：每個時段盡可能接近 6 小時上限 (保留 1 分鐘 buffer)
3. **避免 overlap**：確保前一時段結束後，下一時段才啟動，避免觸發 `cancel-in-progress`

### 當前時段分配 (UTC 時間)

```
時段 1: UTC 23:00-04:59 (5h59m = 21540 秒)
  → 台灣時間: 07:00-12:59
  → 間隔: 1 分鐘 (12:59-13:00)

時段 2: UTC 05:00-10:59 (5h59m = 21540 秒)
  → 台灣時間: 13:00-18:59
  → 間隔: 1 分鐘 (18:59-19:00)

時段 3: UTC 11:00-15:00 (4h = 14400 秒)
  → 台灣時間: 19:00-23:00
```

### 覆蓋統計

- **總執行時間**: 15h58m
- **目標時段**: 16h (07:00-23:00)
- **間隔損失**: 2 分鐘 (每個間隔 1 分鐘 × 2)
- **覆蓋率**: 99.79%
- **資料遺失**: 僅 12:59-13:00 和 18:59-19:00 兩分鐘

### Concurrency 設定

```yaml
concurrency:
  group: flight-cache-${{ github.event_name == 'schedule' && 'auto' || 'manual' }}
  cancel-in-progress: true
```

- 所有自動排程使用同一個 group `flight-cache-auto`
- 啟用 `cancel-in-progress` 確保同時只有一個時段在執行
- 1 分鐘 buffer 是最小可行間隔，考量因素：
  - GitHub Actions cron 觸發時間可能有 ±30 秒誤差
  - Workflow 啟動和初始化需要 10-20 秒
  - 腳本正常結束需要 1-2 秒清理時間

### 修改時段時的注意事項

如需調整時段分配，請遵循以下步驟：

1. **確認間隔要求**：每個時段間隔必須 ≤ 1 分鐘，以維持即時性
2. **計算執行時間**：
   - 單時段上限 = 21600 秒 (6 小時)
   - 實際執行時間 = 21600 - (buffer 秒數)
   - 當前設定: 21540 秒 (6h - 1min)
3. **同步更新檔案**：
   - `.github/workflows/flight-cache-to-azure.yml` 註解 (第 4-8 行)
   - `.github/workflows/flight-cache-to-azure.yml` duration 邏輯 (第 54-64 行)
   - 本文件 (`AGENTS.md`) 的當前時段分配和覆蓋統計
4. **驗證覆蓋率**：確保總覆蓋率 ≥ 99%，間隔損失最小化
5. **提交說明**：清楚說明修改原因、新時段分配和覆蓋率變化

Operational hygiene

- Document any required environment variables (names and expected values) in README or comments near usage.
- Watch quotas: batch external calls where possible and sleep between requests to respect limits.
- Keep the repo ASCII; avoid committing generated files or personal configuration.

品質檢查 (必跑)

- 每次 AI 完成任務後、提交前必須執行:
  - `npm run pages:build`
- 指令需通過後才能進行 commit 或推送。

## 版本控制原則

請在每個重要階段提交變更，自動使用 Git 進行版本控制，並撰寫詳細的正體中文 (zh-tw) 訊息。

## Git 日誌樣式 — Conventional Commits v1.0.0

說明：
遵循 Conventional Commits v1.0.0 風格，提交訊息請以正體中文 (zh-tw)。每個重要階段請依照 版本控制原則 使用 Git 自動版本控制並撰寫詳細變更訊息。

格式：

```text
type[optional scope]: description

body

footer
```

規則：

- header 最多 72 個字元；body 每行建議不超過 72 個字元。
- type 為必要，scope 為可選；description 應簡潔說明變更目的。
- scope 若為腳本檔，請填寫檔案名稱 (不含副檔名)；若為模組，請填寫模組名稱。
- 若為重大不相容變更，footer 使用 `BREAKING CHANGE: <說明>`。
- commit 訊息皆請使用正體中文 (zh-tw)。

常用 type (說明)：

- feat: 新功能 (建立新功能)
- fix: 修正 (修補 bug)
- docs: 文件 (更新文件)
- style: 格式 (不影響執行之程式碼格式或排版)
- refactor: 重構 (既有程式碼重構，無功能改變)
- perf: 效能 (效能改善)
- test: 測試 (新增或修正測試)
- build: 建構 (建置或相依套件變更)
- ci: CI/CD (持續整合或部署設定)
- chore: 雜務 (非產品功能、測試、文件或建構之雜務)
- revert: 回復 (還原先前提交)

範例：

- feat (auth): 建立使用者登入流程
- fix (Create-ADOPipeline): 修正 token 續期錯誤
- docs (readme): 更新 README 文件
- chore (deps): 更新相依套件
- refactor (ui): 重構主頁介面以提升可讀性
- perf (db): 優化查詢提升效能
- test: 新增會員登入單元測試
- BREAKING CHANGE: 移除舊版 API v1，請改用 v2

## Git commit 命令列工具 — 使用規則 (bash /pwsh)

生成 git commit 命令時，第一行用一個 -m 參數，第三行之後請用一個 -m 參數，而且換行符號不能用 `\n` 字串，一定要用 \n 真正的換行字元。

請遵守下列要點以確保 commit message 符合本專案約定：

- 第一行 (commit header) 請使用第一個 -m 參數，僅包含單行標頭：`type [optional scope]: description`
- 從第三行 (body 起) 請使用單一的第二個 -m 參數來包含剩餘內容 (body 與 footer)。Git 會在多個 -m 參數之間自動插入一個空行作為段落分隔。
- 第二個 -m 參數內的換行必須為真正的換行字元 (LF)，不要以字面 `\n` (兩個字元) 表示換行。

bash 範例：

1. 直接在引號中輸入多行字串 (互動式 shell 可直接換行)

   ```bash
   git commit -m "feat(core): 新增自動化腳本" -m "為改善 CI，加入自動化腳本。
   修正 Y 的 edge case。
   BREAKING CHANGE: API v1 移除，改用 v2"
   ```

2. 使用 ANSI-C quoting (讓 \n 被轉成真正的換行字元)

   ```bash
   git commit -m "feat(core): 新增自動化腳本" -m $'為改善 CI，加入自動化腳本。\n修正 Y 的 edge case。\nBREAKING CHANGE: API v1 移除，改用 v2'
   ```

   PowerShell (pwsh) 範例：

   - 使用 here-string (多行字串) 產生真正的換行，示範使用單引號型 here-string 以避免展開：

     ```powershell
     git commit -m 'feat(core): 新增自動化腳本' -m @'
     為改善 CI，加入自動化腳本。
     修正 Y 的 edge case。
     BREAKING CHANGE: API v1 移除，改用 v2
     '@
     ```
