# 航班資料結構說明

## 資料來源

- **URL**: `https://www.mkport.gov.tw/Flight/moreArrival.aspx?1=1&MenuID=5F8C5942FDC5D1C4`
- **類型**: HTML 表格解析
- **更新頻率**: 即時

## 資料欄位

| 欄位名稱 | 英文標題 | 中文標題 | 說明 | 範例 |
| --------- | --------- | --------- | ------ | ------ |
| `Air` | Airlines | 航空公司 | 航空公司名稱及代碼 | `立榮UIA`, `華信MDA`, `德安DAC` |
| `FlightNo` | Flight No | 班次 | 航班編號 | `8675`, `361`, `7016` |
| `Origin` | Origin | 來自 | 起飛機場代碼 | `臺北TSA`, `高雄KHH`, `臺中RMQ`, `七美CMJ` |
| `Aircraft` | Aircraft | 機型 | 飛機機型 | `ATR72 600`, `ATR-600`, `DHC-6` |
| `STs` | Sched Time | 表定起飛 | 表定起飛時間 (起飛地) | `07:20`, `10:45` |
| `ATs` | Actual Time | 實際起飛 | 實際起飛時間 (起飛地),未起飛時為空字串 | `07:22`, `10:50`, `""` |
| `STe` | Sched Time | 表定到達時間 | 表定到達時間 (馬公機場) | `07:50`, `14:15` |
| `ATe` | Ext/Act Time | 預估/實際到達時間 | 預估或實際到達時間 (馬公機場) | `07:45`, `14:15` |
| `Remark` | Remark | 備註 | 航班狀態 | `已到Arrived`, `準時On Time`, `延誤Delayed` |

## 資料範例

```json
{
  "status": "success",
  "data": [
    {
      "Air": "立榮UIA",
      "FlightNo": "8675",
      "Origin": "臺南TNN",
      "Aircraft": "ATR72 600",
      "STs": "07:20",
      "ATs": "07:22",
      "STe": "07:50",
      "ATe": "07:45",
      "Remark": "已到Arrived"
    },
    {
      "Air": "華信MDA",
      "FlightNo": "787",
      "Origin": "臺中RMQ",
      "Aircraft": "ATR-600",
      "STs": "13:30",
      "ATs": "",
      "STe": "14:15",
      "ATe": "14:15",
      "Remark": "準時On Time"
    },
    {
      "Air": "德安DAC",
      "FlightNo": "7016",
      "Origin": "七美CMJ",
      "Aircraft": "DHC-6",
      "STs": "14:25",
      "ATs": "",
      "STe": "14:45",
      "ATe": "14:45",
      "Remark": "準時On Time"
    }
  ]
}
```

## 備註狀態說明

- **已到Arrived**: 航班已降落
- **準時On Time**: 航班預計準時
- **延誤Delayed**: 航班延誤

## HTML 表格結構

```html
<table class="table-one-line">
  <tbody>
    <tr>
      <th>航空公司</th>
      <th>班次</th>
      <th>來自</th>
      <th>機型</th>
      <th>表定起飛</th>
      <th>實際起飛</th>
      <th>表定到達時間</th>
      <th>預估/實際到達時間</th>
      <th>備註</th>
    </tr>
    <tr>
      <th>Airlines</th>
      <th>Flight No</th>
      <th>Origin</th>
      <th>Aircraft</th>
      <th>Sched Time</th>
      <th>Actual Time</th>
      <th>Sched Time</th>
      <th>Ext/Act Time</th>
      <th>Remark</th>
    </tr>
    <tr>
      <td>立榮UIA</td>
      <td>8675</td>
      <td>臺南TNN</td>
      <td>ATR72 600</td>
      <td>07:20</td>
      <td>07:22</td>
      <td>07:50</td>
      <td>07:45</td>
      <td>已到Arrived</td>
    </tr>
    <!-- 更多航班資料... -->
  </tbody>
</table>
```

## 實作細節

### 解析邏輯

1. 使用 `fetch()` 取得 HTML 內容
2. 使用正規表達式 `/<tr[\s\S]*?<\/tr>/g` 擷取所有 `<tr>` 標籤
3. 對每一列使用 `/<td[^>]*>(.*?)<\/td>/g` 擷取 `<td>` 內容
4. 移除 HTML 標籤並去除空白
5. 驗證欄位數量 (必須 ≥ 9 個欄位)
6. 解構賦值到對應的欄位名稱

### 錯誤處理

- HTTP 錯誤: 檢查 response code 是否為 200
- 欄位不足: 跳過欄位數量少於 9 的資料列 (通常是表頭)

### 使用方式

```javascript
// 呼叫函式取得航班資料
const result = await fetchFlightDataInternal('https://www.mkport.gov.tw/Flight/moreArrival.aspx?1=1&MenuID=5F8C5942FDC5D1C4');

// 輸出結果
console.log(result.status);  // "success"
console.log(result.data.length);  // 航班數量
console.log(result.data[0].Aircraft);  // 第一筆航班的機型
```
