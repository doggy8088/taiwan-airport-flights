// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  stripHtmlTags,
  buildBlobUrlFromContainerSas,
  getHourMinuteInTimeZone,
  isWithinServiceHours,
  fetchFlightDataInternal,
  putBlob,
  runPollAndUpload
} from '../src/index.js';

// ────────────────────────────────────────────────────────────
// stripHtmlTags
// ────────────────────────────────────────────────────────────

describe('stripHtmlTags', () => {
  it('should strip a simple tag', () => {
    expect(stripHtmlTags('<b>hello</b>')).toBe('hello');
  });

  it('should strip multiple sibling tags', () => {
    expect(stripHtmlTags('<span>foo</span><span>bar</span>')).toBe('foobar');
  });

  it('should strip nested tags (defense against bypass)', () => {
    // Nested: inner tag reveals after outer is removed
    expect(stripHtmlTags('<b><i>text</i></b>')).toBe('text');
    // Multiple levels of nesting
    expect(stripHtmlTags('<div><span><em>deep</em></span></div>')).toBe('deep');
  });

  it('should handle tags with attributes', () => {
    expect(stripHtmlTags('<a href="https://example.com">link</a>')).toBe('link');
  });

  it('should handle self-closing tags', () => {
    expect(stripHtmlTags('before<br/>after')).toBe('beforeafter');
  });

  it('should return empty string for empty input', () => {
    expect(stripHtmlTags('')).toBe('');
  });

  it('should trim whitespace from result', () => {
    expect(stripHtmlTags('  <b> hello </b>  ')).toBe('hello');
  });

  it('should return plain text unchanged', () => {
    expect(stripHtmlTags('plain text')).toBe('plain text');
  });
});

// ────────────────────────────────────────────────────────────
// buildBlobUrlFromContainerSas
// ────────────────────────────────────────────────────────────

describe('buildBlobUrlFromContainerSas', () => {
  const BASE_SAS =
    'https://myaccount.blob.core.windows.net/mycontainer?sv=2021-06-08&sp=rcw&sig=abc';

  it('should append blob name to the container path', () => {
    const result = buildBlobUrlFromContainerSas(BASE_SAS, 'data-penghu.jsonp');
    const url = new URL(result);
    expect(url.pathname).toBe('/mycontainer/data-penghu.jsonp');
  });

  it('should preserve the SAS query string', () => {
    const result = buildBlobUrlFromContainerSas(BASE_SAS, 'data-penghu.jsonp');
    expect(result).toContain('sv=2021-06-08');
    expect(result).toContain('sp=rcw');
    expect(result).toContain('sig=abc');
  });

  it('should handle a container URL with a trailing slash', () => {
    const sasWithSlash =
      'https://myaccount.blob.core.windows.net/mycontainer/?sv=2021-06-08&sp=rcw&sig=abc';
    const result = buildBlobUrlFromContainerSas(sasWithSlash, 'data.jsonp');
    const url = new URL(result);
    expect(url.pathname).toBe('/mycontainer/data.jsonp');
    expect(url.pathname).not.toMatch(/\/\//);
  });

  it('should URL-encode special characters in the blob name', () => {
    const result = buildBlobUrlFromContainerSas(BASE_SAS, 'my file (1).jsonp');
    const url = new URL(result);
    expect(url.pathname).toBe('/mycontainer/my%20file%20(1).jsonp');
  });

  it('should handle a nested blob path', () => {
    const result = buildBlobUrlFromContainerSas(BASE_SAS, 'folder/data.json');
    const url = new URL(result);
    expect(url.pathname).toBe('/mycontainer/folder/data.json');
  });
});

// ────────────────────────────────────────────────────────────
// getHourMinuteInTimeZone
// ────────────────────────────────────────────────────────────

describe('getHourMinuteInTimeZone', () => {
  it('should return the correct hour and minute in Asia/Taipei (UTC+8)', () => {
    // UTC 00:30 -> Taipei 08:30
    const utcDate = new Date('2024-01-15T00:30:00Z');
    const { hour, minute } = getHourMinuteInTimeZone(utcDate, 'Asia/Taipei');
    expect(hour).toBe(8);
    expect(minute).toBe(30);
  });

  it('should handle midnight UTC (Taipei = 08:00)', () => {
    const utcDate = new Date('2024-06-01T00:00:00Z');
    const { hour, minute } = getHourMinuteInTimeZone(utcDate, 'Asia/Taipei');
    expect(hour).toBe(8);
    expect(minute).toBe(0);
  });

  it('should handle UTC time that crosses midnight in Taipei', () => {
    // UTC 16:00 -> Taipei 00:00 next day
    const utcDate = new Date('2024-06-01T16:00:00Z');
    const { hour, minute } = getHourMinuteInTimeZone(utcDate, 'Asia/Taipei');
    expect(hour).toBe(0);
    expect(minute).toBe(0);
  });

  it('should work for UTC timezone itself', () => {
    const utcDate = new Date('2024-01-15T14:45:00Z');
    const { hour, minute } = getHourMinuteInTimeZone(utcDate, 'UTC');
    expect(hour).toBe(14);
    expect(minute).toBe(45);
  });
});

// ────────────────────────────────────────────────────────────
// isWithinServiceHours
// ────────────────────────────────────────────────────────────

describe('isWithinServiceHours', () => {
  // Taipei = UTC+8. Service hours: 07:00–22:59 Taipei.

  it('should return true at 07:00 Taipei (UTC 23:00 previous day)', () => {
    // UTC 23:00 -> Taipei 07:00
    const date = new Date('2024-06-01T23:00:00Z');
    expect(isWithinServiceHours(date)).toBe(true);
  });

  it('should return true at 12:00 Taipei (UTC 04:00)', () => {
    const date = new Date('2024-06-02T04:00:00Z');
    expect(isWithinServiceHours(date)).toBe(true);
  });

  it('should return true at 22:59 Taipei (UTC 14:59)', () => {
    const date = new Date('2024-06-02T14:59:00Z');
    expect(isWithinServiceHours(date)).toBe(true);
  });

  it('should return false at 23:00 Taipei (UTC 15:00)', () => {
    // Taipei 23:00 -> outside service hours
    const date = new Date('2024-06-02T15:00:00Z');
    expect(isWithinServiceHours(date)).toBe(false);
  });

  it('should return false at 00:00 Taipei (UTC 16:00)', () => {
    const date = new Date('2024-06-02T16:00:00Z');
    expect(isWithinServiceHours(date)).toBe(false);
  });

  it('should return false at 06:59 Taipei (UTC 22:59)', () => {
    const date = new Date('2024-06-01T22:59:00Z');
    expect(isWithinServiceHours(date)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// fetchFlightDataInternal
// ────────────────────────────────────────────────────────────

describe('fetchFlightDataInternal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** @param {string} html */
  function mockFetch(html) {
    vi.mocked(fetch).mockResolvedValue(
      new Response(html, { status: 200, statusText: 'OK' })
    );
  }

  it('should parse a single valid table row', async () => {
    const html = `
      <table>
        <tr>
          <td>中華航空</td><td>CI123</td><td>台北</td><td>A320</td>
          <td>09:00</td><td>09:05</td><td>10:00</td><td>10:10</td><td>準時</td>
        </tr>
      </table>`;
    mockFetch(html);

    const result = await fetchFlightDataInternal('https://example.com');
    expect(result.status).toBe('success');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].FlightNo).toBe('CI123');
    expect(result.data[0].Origin).toBe('台北');
    expect(result.data[0].Remark).toBe('準時');
  });

  it('should strip HTML tags inside table cells', async () => {
    const html = `
      <tr>
        <td><b>長榮</b></td><td>BR456</td><td>高雄</td><td>A321</td>
        <td>11:00</td><td>11:02</td><td>12:00</td><td>12:05</td><td><span>延誤</span></td>
      </tr>`;
    mockFetch(html);

    const result = await fetchFlightDataInternal('https://example.com');
    expect(result.data[0].Air).toBe('長榮');
    expect(result.data[0].Remark).toBe('延誤');
  });

  it('should skip rows with fewer than 9 cells', async () => {
    const html = `
      <table>
        <tr><th>航空公司</th><th>班次</th><th>出發地</th></tr>
        <tr>
          <td>中華航空</td><td>CI100</td><td>台北</td><td>A320</td>
          <td>08:00</td><td>08:00</td><td>09:00</td><td>09:00</td><td>準時</td>
        </tr>
      </table>`;
    mockFetch(html);

    const result = await fetchFlightDataInternal('https://example.com');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].FlightNo).toBe('CI100');
  });

  it('should return empty data for a page with no valid rows', async () => {
    mockFetch('<html><body>No flights found</body></html>');

    const result = await fetchFlightDataInternal('https://example.com');
    expect(result.status).toBe('success');
    expect(result.data).toHaveLength(0);
  });

  it('should throw on non-ok HTTP response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );

    await expect(fetchFlightDataInternal('https://example.com')).rejects.toThrow(
      'HTTP Error: 404 Not Found'
    );
  });

  it('should throw on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchFlightDataInternal('https://example.com')).rejects.toThrow(
      'Failed to fetch'
    );
  });

  it('should parse multiple rows', async () => {
    const row = (n) =>
      `<tr><td>航空${n}</td><td>FN${n}</td><td>城市${n}</td><td>A32${n}</td>` +
      `<td>0${n}:00</td><td>0${n}:00</td><td>0${n}:30</td><td>0${n}:30</td><td>準時</td></tr>`;
    const html = `<table>${row(1)}${row(2)}${row(3)}</table>`;
    mockFetch(html);

    const result = await fetchFlightDataInternal('https://example.com');
    expect(result.data).toHaveLength(3);
    expect(result.data[1].FlightNo).toBe('FN2');
  });
});

// ────────────────────────────────────────────────────────────
// putBlob
// ────────────────────────────────────────────────────────────

describe('putBlob', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call fetch with PUT method and required headers', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 201 }));

    const url = 'https://myaccount.blob.core.windows.net/container/blob.jsonp?sig=abc';
    const body = 'window.__cb({"data":[]});';
    await putBlob(url, body, 'application/javascript; charset=utf-8');

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const [calledUrl, options] = vi.mocked(fetch).mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(options?.method).toBe('PUT');
    expect(options?.headers?.['x-ms-blob-type']).toBe('BlockBlob');
    expect(options?.headers?.['content-type']).toBe(
      'application/javascript; charset=utf-8'
    );
    const expectedLength = new TextEncoder().encode(body).byteLength;
    expect(options?.headers?.['content-length']).toBe(String(expectedLength));
  });

  it('should encode body as UTF-8 bytes', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 201 }));

    const body = '中文內容';
    await putBlob('https://example.blob.core.windows.net/c/b?sig=x', body, 'text/plain');

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const expectedBytes = new TextEncoder().encode(body);
    expect(options?.headers?.['content-length']).toBe(String(expectedBytes.byteLength));
  });

  it('should throw with status code on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('AuthenticationFailed', { status: 403, statusText: 'Forbidden' })
    );

    await expect(
      putBlob('https://example.blob.core.windows.net/c/b?sig=x', 'data', 'text/plain')
    ).rejects.toThrow('Azure PUT failed: 403 Forbidden');
  });
});

// ────────────────────────────────────────────────────────────
// runPollAndUpload (integration)
// ────────────────────────────────────────────────────────────

describe('runPollAndUpload', () => {
  const SAS_URL =
    'https://myaccount.blob.core.windows.net/container?sv=2021-06-08&sp=rcw&sig=abc';

  const FLIGHT_HTML = `
    <tr>
      <td>遠東航空</td><td>FE701</td><td>台北</td><td>ATR72</td>
      <td>07:10</td><td>07:10</td><td>08:10</td><td>08:15</td><td>準時</td>
    </tr>`;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should fetch flight data, build JSONP payload, and upload to Azure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(FLIGHT_HTML, { status: 200 })) // flight page
      .mockResolvedValueOnce(new Response('', { status: 201 }));          // azure PUT

    await runPollAndUpload(SAS_URL);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);

    // Second call is the Azure PUT
    const [putUrl, putOptions] = vi.mocked(fetch).mock.calls[1];
    expect(putUrl.toString()).toContain('data-penghu.jsonp');
    expect(putOptions?.method).toBe('PUT');

    const body = new TextDecoder().decode(putOptions?.body);
    expect(body).toContain('__penghuFlightDataCallback');
    expect(body).toContain('FE701');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Uploaded data-penghu.jsonp (1 rows).')
    );
  });

  it('should log an error and not throw when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network error'));

    await expect(runPollAndUpload(SAS_URL)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('ERROR Poll and upload failed:'),
      expect.any(TypeError)
    );
  });

  it('should log an error and not throw when Azure PUT fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(FLIGHT_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 403, statusText: 'Forbidden' }));

    await expect(runPollAndUpload(SAS_URL)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('ERROR Poll and upload failed:'),
      expect.any(Error)
    );
  });
});
