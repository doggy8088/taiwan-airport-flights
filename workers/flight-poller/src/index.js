// @ts-check

const DEFAULT_FETCH_URL =
  'https://www.mkport.gov.tw/Flight/moreArrival.aspx?1=1&MenuID=5F8C5942FDC5D1C4';
const JSONP_CALLBACK_NAME = '__penghuFlightDataCallback';
const DATA_BLOB_NAME = 'data-penghu.jsonp';
const TIME_ZONE = 'Asia/Taipei';

/**
 * @param {string} input
 */
function stripHtmlTags(input) {
  let result = input;
  let prev;
  do {
    prev = result;
    result = prev.replace(/<[^>]*>/g, '');
  } while (result !== prev);
  return result.trim();
}

/**
 * Port of `scripts/poll-flight-to-azure.mjs` -> `fetchFlightDataInternal`.
 * @param {string} url
 */
async function fetchFlightDataInternal(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'cloudflare-workers-flight-cache/1.0'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];

  /** @type {Array<Record<string, string>>} */
  const results = [];

  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<td[^>]*>(.*?)<\/td>/g)).map(m =>
      stripHtmlTags(m[1] ?? '')
    );

    if (cells.length < 9) continue;

    const [Air, FlightNo, Origin, Aircraft, STs, ATs, STe, ATe, Remark] = cells;
    results.push({ Air, FlightNo, Origin, Aircraft, STs, ATs, STe, ATe, Remark });
  }

  return { status: 'success', data: results };
}

/**
 * @param {string} containerSasUrl
 * @param {string} blobName
 */
function buildBlobUrlFromContainerSas(containerSasUrl, blobName) {
  const url = new URL(containerSasUrl);
  const basePath = url.pathname.replace(/\/+$/, '');
  const encodedBlobName = blobName
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  url.pathname = `${basePath}/${encodedBlobName}`;
  return url.toString();
}

/**
 * @param {string} url
 * @param {string} body
 * @param {string} contentType
 */
async function putBlob(url, body, contentType) {
  const bytes = new TextEncoder().encode(body);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2020-10-02',
      'content-type': contentType,
      'content-length': String(bytes.byteLength)
    },
    body: bytes
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Azure PUT failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);
  }
}

/**
 * @param {Date} d
 * @param {string} timeZone
 * @returns {{ hour: number, minute: number }}
 */
function getHourMinuteInTimeZone(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return { hour, minute };
}

/**
 * 判斷目前是否在台灣航班服務時段 (07:00–23:00)
 * @returns {boolean}
 */
function isWithinServiceHours() {
  const { hour } = getHourMinuteInTimeZone(new Date(), TIME_ZONE);
  return hour >= 7 && hour < 23;
}

/**
 * 執行一次航班資料抓取並上傳至 Azure Blob
 * @param {string} containerSasUrl
 */
async function runPollAndUpload(containerSasUrl) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fetchFlightDataInternal(DEFAULT_FETCH_URL);
    const payload = {
      timestamp: new Date().toISOString(),
      data: result
    };

    const jsonp = `window.${JSONP_CALLBACK_NAME}(${JSON.stringify(payload)});`;
    const blobUrl = buildBlobUrlFromContainerSas(containerSasUrl, DATA_BLOB_NAME);
    await putBlob(blobUrl, jsonp, 'application/javascript; charset=utf-8');
    console.log(`[${startedAt}] INFO Uploaded ${DATA_BLOB_NAME} (${result.data.length} rows).`);
  } catch (e) {
    console.error(`[${startedAt}] ERROR Poll and upload failed:`, e);
  }
}

export default {
  /**
   * Cron Trigger 入口點：每分鐘觸發一次
   * @param {ScheduledEvent} _event
   * @param {{ AZURE_CONTAINER_SAS_URL: string }} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(_event, env, ctx) {
    if (!isWithinServiceHours()) {
      console.log('Outside service hours (07:00-23:00 Taipei time). Skipping.');
      return;
    }

    if (!env.AZURE_CONTAINER_SAS_URL) {
      console.error('Missing AZURE_CONTAINER_SAS_URL secret. Aborting.');
      return;
    }

    ctx.waitUntil(runPollAndUpload(env.AZURE_CONTAINER_SAS_URL));
  }
};
