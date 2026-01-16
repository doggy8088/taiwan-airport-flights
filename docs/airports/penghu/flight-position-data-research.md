# 即時航班座標資料來源研究報告

日期：2026-01-02

## 目標與範圍

- 以 OpenStreetMap（Leaflet）作為底圖，顯示「澎湖馬公機場航班」的即時座標。
- 資料來源必須為免費（或明確的免費方案）。
- 本階段只做研究與評估，不實作。

## 可行的免費資料來源

### 1) OpenSky Network（官方 REST API）

OpenSky 提供即時「State Vectors」資料，包含經緯度、速度、航向、垂直速度等欄位，可用於即時地圖標記。API 明確標示為研究/非商業用途，且不提供商業航班時刻、延誤等資訊。  
重點能力：

- `GET /states/all`：可使用經緯度 bounding box 拉回特定區域的即時座標。
- 回應欄位包含 longitude / latitude / velocity / true_track / baro_altitude 等。
- API 有速率/額度限制與 OAuth2 認證要求（新帳號需用 OAuth2）。

適用性：
- 優點：資料結構完整、全球覆蓋、官方文件清楚。
- 風險：非商業用途限制、API 額度/速率限制、訊號覆蓋與 ADS-B 可視性限制。

來源：  
- OpenSky API 文件（非商業用途/State Vectors）  
  https://openskynetwork.github.io/opensky-api/  
- OpenSky REST API 端點與欄位說明  
  https://openskynetwork.github.io/opensky-api/rest.html  

### 2) Airplanes.live（社群 REST API）

Airplanes.live 提供公開 REST API，支持依 callsign / ICAO hex / 註冊號 / 半徑查詢等方式獲取即時座標。文件標示「Non-Commercial Use」「No SLA」，並有每秒 1 次的速率限制。  
重點能力：

- `/callsign/{callsign}`、`/hex/{hex}`、`/point/{lat}/{lon}/{radius}` 等。
- 速率限制 1 req/sec，無 SLA。

適用性：
- 優點：端點設計彈性、callsign 查詢直覺。
- 風險：非商業用途、無 SLA、服務穩定性與覆蓋度取決於社群。

來源：  
- Airplanes.live REST API Guide  
  https://airplanes.live/api-guide/  

### 3) 其他來源（不符合免費或需額外授權）

部分商業服務（例如 ADS-B Exchange 等）提供訂閱或付費方案，若需要更高可靠性或商用授權，需另行評估。  
來源：  
- ADSBexchange 訂閱頁  
  https://store.adsbexchange.com/products/annual-ad-free-adsbexchange-subscription  

## 航班清單與即時座標的對應方式

目前航班資料來源為「機場航班資訊」，通常提供「航空公司名稱 + 航班號（IATA）」；即時 ADS-B / Mode S 系統則多用 callsign 或 ICAO 代碼。常見差異：

- IATA 航班號 ≠ ADS-B callsign（常見為「ICAO 航空公司代碼 + 航班數字」）。
- 同一航班可能有代碼共享、呼號省略/補 0 等情況。

可行策略：

1. 建立「航空公司 IATA → ICAO callsign」對照表。  
2. 由航班號推導 callsign（例如：ICAO + flight number）。  
3. 以地理範圍 + callsign 前綴雙重篩選，降低誤配。  
4. 若對照不穩定，可改用「機場周邊半徑」查詢，再進行條件過濾。

## 技術與營運限制

- 覆蓋度問題：ADS-B 訊號在海上、低空、特定區域可能不足。
- 時效性：OpenSky 的 State Vectors 可能有 5~10 秒解析度與延遲限制。
- 額度/速率限制：必須做快取與節流，避免前端直接打 API。
- 服務條款：多數免費來源僅限非商業用途，需遵守使用限制。

## 建議方向（不實作）

1. **優先評估 OpenSky**  
   - 可用 bounding box 直接取得區域內即時座標。  
   - 需建立 callsign 對照邏輯與節流。  

2. **備援方案：Airplanes.live**  
   - 速率限制較嚴格，但 callsign/半徑查詢簡單。  

3. **後端集中拉取 + 快取**  
   - 後端服務定期抓取座標，前端只讀快取。  
   - 將 API 凭證放於環境變數或 GitHub Secrets。  

## 下一步建議（實作前）

- 確認使用目的是否符合非商業用途條款。
- 建立航空公司對照表（IATA → ICAO callsign）。
- 以「馬公機場周邊半徑」測試 callsign 對應成功率。
- 評估 OpenSky 與 Airplanes.live 的資料完整度與延遲。
