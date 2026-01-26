// @ts-check

const DEFAULT_FETCH_URL =
  'https://www.mkport.gov.tw/Flight/moreArrival.aspx?1=1&MenuID=5F8C5942FDC5D1C4';

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {string|undefined} value
 * @param {number} fallback
 */
function parsePositiveInt(value, fallback) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param {number} n
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * @param {Date} d
 * @param {string} timeZone
 */
function formatDatePrefixInTimeZone(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);

  const y = parts.find(p => p.type === 'year')?.value ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '00';
  const day = parts.find(p => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${day}`;
}

/**
 * @param {Date} d
 * @param {string} timeZone
 */
function formatTimestampForNameInTimeZone(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const y = parts.find(p => p.type === 'year')?.value ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '00';
  const day = parts.find(p => p.type === 'day')?.value ?? '00';
  const hh = parts.find(p => p.type === 'hour')?.value ?? '00';
  const mm = parts.find(p => p.type === 'minute')?.value ?? '00';
  const ss = parts.find(p => p.type === 'second')?.value ?? '00';
  return `${y}-${m}-${day}T${hh}${mm}${ss}`;
}

/**
 * @param {string} input
 */
function stripHtmlTags(input) {
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * Port of `src/FlightFetcher.gs` -> `fetchFlightDataInternal`.
 * @param {string} url
 */
async function fetchFlightDataInternal(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'github-actions-flight-cache/1.0'
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
 * @param {string|Uint8Array} body
 * @param {string} contentType
 */
async function putBlob(url, body, contentType) {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
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

async function main() {
  const fetchUrl = process.env.FETCH_URL || DEFAULT_FETCH_URL;
  const durationSeconds = parsePositiveInt(process.env.RUN_SECONDS, 3 * 60 * 60 + 59 * 60);
  const intervalSeconds = parsePositiveInt(process.env.INTERVAL_SECONDS, 60);
  const dryRun = process.env.DRY_RUN === '1';
  const timeZone = process.env.TIME_ZONE || 'Asia/Taipei';

  const containerSasUrl = process.env.AZURE_CONTAINER_SAS_URL || '';
  const airportName = process.env.AIRPORT_NAME || '';

  if (!airportName) {
    throw new Error('FATAL: Environment variable "AIRPORT_NAME" is required but not defined.');
  }

  const safeAirportName = airportName
  .replace(/[\\/:*?"<>|]/g, '')
  .replace(/\s+/g, '')
  .trim();

  const jsonpCallBackName = `__${safeAirportName}FlightDataCallback`;
  const dataBlobName = `data-${safeAirportName}.jsonp`;

  const hasContainerUpload = Boolean(containerSasUrl);

  if (!dryRun && !hasContainerUpload) {
    throw new Error('Missing Azure SAS URL. Set AZURE_CONTAINER_SAS_URL.');
  }

  const startedAt = new Date();
  const endAtMs = Date.now() + durationSeconds * 1000;
  const runId = formatTimestampForNameInTimeZone(startedAt, timeZone);
  const logPrefixDate = formatDatePrefixInTimeZone(startedAt, timeZone);
  const logBlobName = `logs/${logPrefixDate}/run-${runId}.log`;

  /** @type {string[]} */
  const logLines = [];
  let errorCount = 0;

  /**
   * @param {'INFO'|'WARN'|'ERROR'} level
   * @param {string} message
   * @param {unknown=} error
   */
  function log(level, message, error) {
    const ts = new Date().toISOString();
    const line =
      error === undefined ? `[${ts}] ${level} ${message}` : `[${ts}] ${level} ${message} ${String(error)}`;
    logLines.push(line);
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }

  async function uploadLogBestEffort() {
    if (!hasContainerUpload) return;
    if (dryRun) return;

    try {
      const url = buildBlobUrlFromContainerSas(containerSasUrl, logBlobName);
      await putBlob(url, logLines.join('\n') + '\n', 'text/plain; charset=utf-8');
    } catch (e) {
      console.error('Failed to upload log blob:', e);
    }
  }

  log(
    'INFO',
    `Start polling. duration=${durationSeconds}s interval=${intervalSeconds}s url=${fetchUrl} runId=${runId}`
  );

  while (Date.now() < endAtMs) {
    const iterationStartedAt = Date.now();
    try {
      const result = await fetchFlightDataInternal(fetchUrl);
      const payload = {
        timestamp: new Date().toISOString(),
        data: result
      };

      const json = JSON.stringify(payload);
      const jsonp = `window.${jsonpCallBackName}(${json});`;
      if (dryRun) {
        log('INFO', `Fetched ${result.data.length} rows (dry-run; skip upload).`);
      } else {
        const url = buildBlobUrlFromContainerSas(containerSasUrl, dataBlobName);
        await putBlob(url, jsonp, 'application/javascript; charset=utf-8');
        log('INFO', `Uploaded ${dataBlobName} (${result.data.length} rows).`);
      }
    } catch (e) {
      errorCount += 1;
      log('ERROR', 'Iteration failed; continue.', e);
      await uploadLogBestEffort();
    }

    const elapsedMs = Date.now() - iterationStartedAt;
    const sleepMs = Math.max(0, intervalSeconds * 1000 - elapsedMs);
    await sleep(sleepMs);
  }

  if (errorCount > 0) {
    log('WARN', `Run completed with errors: ${errorCount}. Upload final log.`);
    await uploadLogBestEffort();
  } else {
    log('INFO', 'Run completed without errors.');
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
