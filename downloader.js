// downloader.js
'use strict';

const fetch = require('node-fetch'); // node-fetch v2
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const { URL } = require('url');

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

/**
 * validateTargetUrl(url)
 * - 校验 scheme (http/https)
 * - 禁止明显的 hostname (localhost, 127.0.0.1, ::1)
 * - DNS 解析后检查所有地址是否为私有/回环/保留等
 * 如果不通过，会抛出带 status 属性的 Error（便于调用者直接返回 http status）
 */
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

/**
 * fetchRemote(url, options)
 * options:
 *   - maxBytes (默认 DEFAULT_MAX_BYTES)
 *   - method (默认 'GET')
 *   - headers (可选)
 *   - redirect ('follow' by default)
 *
 * 返回：
 *   如果是文本内容（按 content-type 判定）：
 *     { type: 'text', content: string, contentType, headers, status }
 *   如果是二进制内容：
 *     { type: 'stream', stream: Readable, contentType, headers, status }
 *
 * 抛出：
 *   - validateTargetUrl 抛出的错误（包含 status）
 *   - fetch 相关错误（会抛出 Error）
 *   - 如果上游返回非 200，会抛出 Error，带 status=502
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

  // 如果 content-length 明确超限，直接失败
  if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
    const err = new Error('file too large');
    err.status = 413;
    throw err;
  }

  if (isTextContentType(contentType)) {
    // 读取为文本，检查长度
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      const err = new Error('file too large');
      err.status = 413;
      throw err;
    }
    return {
      type: 'text',
      content: text,
      contentType,
      headers: headersObj,
      status: res.status
    };
  } else {
    // 二进制：返回流（调用者负责 pipe），但若 upstream 没有 body 则失败
    const body = res.body;
    if (!body) {
      const err = new Error('no body from upstream');
      err.status = 502;
      throw err;
    }
    // 注意：我们无法在此处检测整个流的最终大小（除非消费并计数），所以依赖 content-length 检查或调用方自行限制接收
    return {
      type: 'stream',
      stream: body,
      contentType,
      headers: headersObj,
      status: res.status
    };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  isTextContentType,
  validateTargetUrl,
  fetchRemote
};
