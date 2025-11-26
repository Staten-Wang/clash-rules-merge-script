// downloader.js
'use strict';

const fetch = require('node-fetch'); // node-fetch v2
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const { URL } = require('url');
const path = require('path');

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50MB

function isTextContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith('text/') ||
    ct.includes('application/json') ||
    ct.includes('application/javascript') ||
    ct.includes('application/xml') ||
    ct.includes('application/rss+xml') ||
    ct.includes('application/atom+xml') ||
    ct.includes('yaml') ||
    ct.includes('application/x-yaml')
  );
}

function isPrivateByIpaddr(parsed) {
  try {
    const r = parsed.range ? parsed.range() : null;
    if (!r) return false;
    return ['private', 'loopback', 'linkLocal', 'multicast', 'reserved'].includes(r);
  } catch (e) {
    return true;
  }
}

async function validateTargetUrl(target) {
  let u;
  try {
    u = new URL(target);
  } catch (e) {
    const err = new Error('invalid url');
    err.status = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    const err = new Error('only http/https allowed');
    err.status = 400;
    throw err;
  }
  const hostname = u.hostname;
  if (!hostname) {
    const err = new Error('invalid host');
    err.status = 400;
    throw err;
  }
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    const err = new Error('disallowed host');
    err.status = 400;
    throw err;
  }
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch (e) {
    const err = new Error('dns lookup failed');
    err.status = 502;
    throw err;
  }
  for (const a of addrs) {
    try {
      const parsed = ipaddr.parse(a.address);
      if (isPrivateByIpaddr(parsed)) {
        const err = new Error('disallowed host (private/reserved)');
        err.status = 400;
        throw err;
      }
    } catch (e) {
      const err = new Error('disallowed host (ip parse failed)');
      err.status = 400;
      throw err;
    }
  }
  return true;
}

function parseContentDispositionFilename(headerValue) {
  if (!headerValue) return null;
  // filename* (RFC5987)
  const filenameStarMatch = headerValue.match(/filename\*\s*=\s*(?:[^\s;]+)?'[^']*'([^;]+)/i);
  if (filenameStarMatch && filenameStarMatch[1]) {
    try {
      const val = filenameStarMatch[1].trim();
      return decodeURIComponent(val.replace(/^["']|["']$/g, ''));
    } catch (e) {}
  }
  const filenameMatch = headerValue.match(/filename\s*=\s*("([^"]+)"|([^;\s]+))/i);
  if (filenameMatch) {
    const name = filenameMatch[2] || filenameMatch[3];
    return name ? name.trim().replace(/^["']|["']$/g, '') : null;
  }
  return null;
}

/**
 * fetchRemote(target, options)
 * options:
 *   - maxBytes (默认 DEFAULT_MAX_BYTES)
 *   - method (默认 'GET')
 *   - headers (可选)
 *   - redirect ('follow' by default)
 *
 * 返回 (成功)：
 *   {
 *     content: string,           // 文本 -> utf8, 二进制 -> base64
 *     contentEncoding: 'utf8'|'base64',
 *     contentType: string,
 *     headers: Object,
 *     status: number,
 *     size: number,              // 字节数
 *     filename: string|null      // 若能从 Content-Disposition 或 URL 推断则返回
 *   }
 *
 * 抛出：
 *   - validateTargetUrl 抛出的错误（包含 status）
 *   - fetch 相关错误（status = 502）
 *   - content-length 超过 maxBytes -> Error status = 413
 *   - 若下载完成后大小超出 maxBytes -> Error status = 413
 */
async function fetchRemote(target, options = {}) {
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    method = 'GET',
    headers = {},
    redirect = 'follow'
  } = options;

  await validateTargetUrl(target);

  let res;
  try {
    res = await fetch(target, { method, headers, redirect });
  } catch (e) {
    const err = new Error(`fetch error: ${e.message}`);
    err.status = 502;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`upstream returned ${res.status}`);
    err.status = 502;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  const headersObj = Object.fromEntries(res.headers.entries());
  const contentLengthHeader = res.headers.get('content-length');
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : NaN;
  const cdHeader = res.headers.get('content-disposition') || '';

  // 如果 content-length 明确超限，直接失败
  if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
    const err = new Error('file too large');
    err.status = 413;
    throw err;
  }

  // 推断 filename（可选）
  let filename = parseContentDispositionFilename(cdHeader) || null;
  if (!filename) {
    try {
      const urlObj = new URL(target);
      const base = path.basename(urlObj.pathname || '') || null;
      filename = base || null;
    } catch (e) {
      filename = null;
    }
  }

  // 读取完整 body 为 Buffer（node-fetch v2 支持 res.buffer()）
  let buf;
  try {
    buf = await res.buffer();
  } catch (e) {
    const err = new Error(`upstream read error: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const size = buf.length;
  if (size > maxBytes) {
    const err = new Error('file too large');
    err.status = 413;
    throw err;
  }

  if (isTextContentType(contentType)) {
    // 尝试以 utf8 解码并返回字符串
    const content = buf.toString('utf8');
    return {
      content,
      contentEncoding: 'utf8',
      contentType,
      headers: headersObj,
      status: res.status,
      size,
      filename
    };
  } else {
    // 二进制：以 base64 返回
    const content = buf.toString('base64');
    return {
      content,
      contentEncoding: 'base64',
      contentType,
      headers: headersObj,
      status: res.status,
      size,
      filename
    };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  isTextContentType,
  validateTargetUrl,
  fetchRemote
};
