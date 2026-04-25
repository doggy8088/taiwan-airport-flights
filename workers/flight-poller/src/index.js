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
 * @param {string} input
 * @param {number} maxLength
 */
function truncateText(input, maxLength = 400) {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}...`;
}

/**
 * @param {unknown} error
 */
function toErrorDetails(error) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack ? truncateText(error.stack, 2000) : undefined
    };
  }

  return {
    errorMessage: String(error)
  };
}

/**
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} message
 * @param {Record<string, unknown>=} fields
 */
function logEvent(level, message, fields = {}) {
  const payload = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')
  );
  const suffix = Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : '';
  const line = `[${new Date().toISOString()}] ${level} ${message}${suffix}`;

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * @param {string} urlString
 */
function sanitizeUrlForLog(urlString) {
  const url = new URL(urlString);
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * @param {string} containerSasUrl
 * @param {string} blobName
 */
function getSasDiagnostics(containerSasUrl, blobName) {
  const blobUrl = buildBlobUrlFromContainerSas(containerSasUrl, blobName);
  const url = new URL(containerSasUrl);
  const permissions = url.searchParams.get('sp') ?? '';
  const expiresAtRaw = url.searchParams.get('se') ?? '';
  const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : Number.NaN;
  const expiresAt =
    expiresAtRaw && Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : expiresAtRaw;
  const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
  /** @type {string[]} */
  const warnings = [];

  if (permissions && !permissions.includes('w')) warnings.push('missing-write-permission');
  if (permissions && !permissions.includes('c')) warnings.push('missing-create-permission');
  if (isExpired) warnings.push('expired-sas');

  return {
    accountHost: url.host,
    containerPath: url.pathname.replace(/\/+$/, ''),
    blobUrl: sanitizeUrlForLog(blobUrl),
    permissions,
    expiresAt,
    isExpired,
    warnings
  };
}

/**
 * @param {ReturnType<typeof getSasDiagnostics>} sas
 */
function assertSasIsWritable(sas) {
  if (sas.isExpired) {
    throw new Error(
      `Azure container SAS URL expired at ${sas.expiresAt}. Update AZURE_CONTAINER_SAS_URL.`
    );
  }

  if (sas.permissions && !sas.permissions.includes('w')) {
    throw new Error(
      `Azure container SAS URL is missing write permission (sp=${sas.permissions}). Update AZURE_CONTAINER_SAS_URL.`
    );
  }
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

  return {
    status: 'success',
    data: results,
    meta: {
      sourceUrl: res.url || url,
      httpStatus: res.status,
      htmlLength: html.length,
      matchedRowCount: rows.length,
      parsedRowCount: results.length
    }
  };
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
    const requestId = res.headers.get('x-ms-request-id') ?? '';
    const text = await res.text().catch(() => '');
    const detail = text ? ` - ${truncateText(text, 600)}` : '';
    const requestIdText = requestId ? ` (requestId=${requestId})` : '';
    throw new Error(`Azure PUT failed: ${res.status} ${res.statusText}${requestIdText}${detail}`);
  }

  return {
    status: res.status,
    statusText: res.statusText,
    contentLength: bytes.byteLength,
    etag: res.headers.get('etag') ?? '',
    lastModified: res.headers.get('last-modified') ?? '',
    requestId: res.headers.get('x-ms-request-id') ?? ''
  };
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

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24;
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return { hour, minute };
}

/**
 * 判斷指定時間（預設 now）是否在台灣航班服務時段 (07:00–23:00)
 * @param {Date} [date]
 * @returns {boolean}
 */
function isWithinServiceHours(date = new Date()) {
  const { hour } = getHourMinuteInTimeZone(date, TIME_ZONE);
  return hour >= 7 && hour < 23;
}

/**
 * 執行一次航班資料抓取並上傳至 Azure Blob
 * @param {string} containerSasUrl
 * @param {Record<string, unknown>=} context
 */
async function runPollAndUpload(containerSasUrl, context = {}) {
  let sas;
  try {
    sas = getSasDiagnostics(containerSasUrl, DATA_BLOB_NAME);
  } catch (error) {
    logEvent('ERROR', 'Invalid Azure container SAS URL.', {
      ...context,
      ...toErrorDetails(error)
    });
    throw error;
  }

  logEvent('INFO', 'Starting fetch and upload.', {
    ...context,
    sourceUrl: DEFAULT_FETCH_URL,
    blobUrl: sas.blobUrl,
    sasPermissions: sas.permissions,
    sasExpiresAt: sas.expiresAt
  });

  if (sas.warnings.length > 0) {
    logEvent('WARN', 'Azure SAS configuration requires attention.', {
      ...context,
      blobUrl: sas.blobUrl,
      sasWarnings: sas.warnings,
      sasPermissions: sas.permissions,
      sasExpiresAt: sas.expiresAt
    });
  }

  assertSasIsWritable(sas);

  try {
    const result = await fetchFlightDataInternal(DEFAULT_FETCH_URL);

    if (result.data.length === 0) {
      logEvent('WARN', 'Source page returned zero parsed flight rows.', {
        ...context,
        sourceUrl: result.meta.sourceUrl,
        matchedRowCount: result.meta.matchedRowCount,
        htmlLength: result.meta.htmlLength
      });
    }

    const payload = {
      timestamp: new Date().toISOString(),
      data: result
    };

    const jsonp = `window.${JSONP_CALLBACK_NAME}(${JSON.stringify(payload)});`;
    const upload = await putBlob(
      buildBlobUrlFromContainerSas(containerSasUrl, DATA_BLOB_NAME),
      jsonp,
      'application/javascript; charset=utf-8'
    );

    logEvent('INFO', 'Uploaded blob successfully.', {
      ...context,
      blobUrl: sas.blobUrl,
      rows: result.data.length,
      sourceUrl: result.meta.sourceUrl,
      sourceStatus: result.meta.httpStatus,
      matchedRowCount: result.meta.matchedRowCount,
      contentLength: upload.contentLength,
      azureStatus: upload.status,
      azureRequestId: upload.requestId,
      azureEtag: upload.etag,
      azureLastModified: upload.lastModified
    });

    return {
      rows: result.data.length,
      blobUrl: sas.blobUrl,
      source: result.meta,
      upload
    };
  } catch (error) {
    logEvent('ERROR', 'Poll and upload failed.', {
      ...context,
      blobUrl: sas.blobUrl,
      ...toErrorDetails(error)
    });
    throw error;
  }
}

export default {
  /**
   * Cron Trigger 入口點：每分鐘觸發一次
   * @param {ScheduledEvent} event
   * @param {{ AZURE_CONTAINER_SAS_URL: string }} env
   * @param {ExecutionContext} _ctx
   */
  async scheduled(event, env, _ctx) {
    const scheduledTime = new Date(event.scheduledTime ?? Date.now());
    const context = {
      cron: event.cron ?? '',
      scheduledTime: scheduledTime.toISOString()
    };

    if (!isWithinServiceHours(scheduledTime)) {
      logEvent('INFO', 'Outside service hours (07:00-23:00 Taipei time). Skipping.', context);
      return;
    }

    if (!env.AZURE_CONTAINER_SAS_URL) {
      const error = new Error('Missing AZURE_CONTAINER_SAS_URL secret.');
      logEvent('ERROR', error.message, context);
      throw error;
    }

    await runPollAndUpload(env.AZURE_CONTAINER_SAS_URL, context);
  }
};

// Named exports for unit testing
export {
  stripHtmlTags,
  truncateText,
  toErrorDetails,
  logEvent,
  sanitizeUrlForLog,
  getSasDiagnostics,
  assertSasIsWritable,
  buildBlobUrlFromContainerSas,
  getHourMinuteInTimeZone,
  isWithinServiceHours,
  fetchFlightDataInternal,
  putBlob,
  runPollAndUpload
};
