// downloader.js
'use strict';

const fetch = require('node-fetch'); // node-fetch v2
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const { URL } = require('url');
const path = require('path');
const zlib = require('zlib');
let iconv = null;
try { iconv = require('iconv-lite'); } catch (e) { /* optional dependency */ }

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
  // 尝试解析 filename* 按 RFC5987: filename*=charset'lang'encoded
  // 例如: filename*=UTF-8''%E8%B5%94%E9%92%B1%E6%9C%BA%E5%9C%BA
  const filenameStarMatch = headerValue.match(/filename\*\s*=\s*([^']*)'([^']*)'([^;\r\n]*)/i);
  if (filenameStarMatch) {
    const encoded = (filenameStarMatch[3] || '').trim();
    if (encoded) {
      // 去掉可能的外层引号
      const raw = encoded.replace(/^['"]|['"]$/g, '');
      try {
        return decodeURIComponent(raw);
      } catch (e) {
        // 如果 decode 失败，返回未解码的 raw
        return raw;
      }
    }
  }

  // 回退到普通的 filename="..." 或 filename=token
  const filenameMatch = headerValue.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
  if (filenameMatch) {
    const name = filenameMatch[1] || filenameMatch[2] || filenameMatch[3];
    return name ? name.trim() : null;
  }
  return null;
}

/**
 * 尝试根据 content-encoding 解压给定的 Buffer。
 * 如果 header 与实际数据不符或解压失败，函数会记录警告并返回原始或部分解压后的 buf（不会抛出）。
 * 返回解压后的 Buffer。
 */
function tryDecompressBuffer(buf, contentEncodingHeader) {
  if (!buf || !contentEncodingHeader) return buf;
  const header = (contentEncodingHeader || '').toLowerCase();
  try {
    const isGzipBuf = buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    const isZlibBuf = buf && buf.length >= 2 && buf[0] === 0x78;
    const isBrotliPossible = buf && buf.length >= 3;

    if (header.includes('gzip')) {
      if (isGzipBuf) {
        return zlib.gunzipSync(buf);
      } else {
        console.warn('content-encoding indicates gzip but buffer does not have gzip magic; skipping decompression');
        return buf;
      }
    }

    if (header.includes('deflate')) {
      if (isZlibBuf) {
        return zlib.inflateSync(buf);
      } else {
        console.warn('content-encoding indicates deflate but buffer does not have zlib header; skipping decompression');
        return buf;
      }
    }

    if (header.includes('br') && typeof zlib.brotliDecompressSync === 'function') {
      if (isBrotliPossible) {
        try {
          return zlib.brotliDecompressSync(buf);
        } catch (e) {
          console.warn('brotli decompression failed, skipping:', e && e.message ? e.message : e);
          return buf;
        }
      } else {
        console.warn('content-encoding indicates brotli but buffer too small or not suitable; skipping decompression');
        return buf;
      }
    }
  } catch (e) {
    console.warn('decompress warning (ignored):', e && e.message ? e.message : e);
    return buf;
  }
  return buf;
}

/**
 * fetchRemote(target, options)
 * options:
 *   - maxBytes (默认 DEFAULT_MAX_BYTES)
 *   - method (默认 'GET')
 *   - headers (可选)
 *   - redirect ('follow' by default)
 *   - forceText (boolean) - 当为 true 时即使 content-type 不是文本也尝试按 utf8 解码并以文本返回；
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
    // 合并传入 headers，并确保存在默认的 User-Agent（若调用方未提供）
    const requestHeaders = Object.assign({}, headers);
    // case-insensitive 检查是否已有 user-agent
    const hasUA = Object.keys(requestHeaders).some(k => k.toLowerCase() === 'user-agent');
    if (!hasUA) {
      requestHeaders['user-agent'] = 'clash-verge/v2.4.3';
    }
    res = await fetch(target, { method, headers: requestHeaders, redirect });
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

  // 如果 filename 存在但没有后缀，则默认添加 .yaml
  if (filename) {
    try {
      const ext = path.extname(filename);
      if (!ext) {
        filename = filename + '.yaml';
      }
    } catch (e) {
      // 忽略任何异常，保留原始 filename
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

  // 处理 Content-Encoding（gzip/deflate/br）: 解压缩（封装为独立函数）
  const contentEncodingHeader = res.headers.get('content-encoding') || '';
  buf = tryDecompressBuffer(buf, contentEncodingHeader);

  // 解压后大小检查
  const decodedSize = buf.length;
  if (decodedSize > maxBytes) {
    const err = new Error('file too large after decompression');
    err.status = 413;
    throw err;
  }

  // 当 contentType 表示文本，或调用者显式要求强制按文本解析时，按 charset/utf8 返回文本。
  const forceText = !!options.forceText;
  // 尝试从 content-type 中提取 charset
  let charset = null;
  const m = (contentType || '').match(/charset=\s*([^;\s]+)/i);
  if (m && m[1]) charset = m[1].replace(/^['"]|['"]$/g, '').toLowerCase();

  if (isTextContentType(contentType) || forceText) {
    // 按 charset 解码（若提供），否则使用 utf8。若安装了 iconv-lite 会用它来支持更多编码。
    let content;
    try {
      if (charset && iconv) {
        content = iconv.decode(buf, charset);
      } else if (charset && (charset === 'utf-8' || charset === 'utf8' || charset === 'ascii' || charset === 'latin1')) {
        content = buf.toString(charset === 'latin1' ? 'latin1' : charset);
      } else {
        content = buf.toString('utf8');
      }
    } catch (e) {
      content = buf.toString('utf8');
    }
    return {
      content,
      contentEncoding: 'utf8',
      contentType,
      headers: headersObj,
      status: res.status,
      size: decodedSize,
      filename,
      charset,
      contentEncodingHeader
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
      size: decodedSize,
      filename,
      charset,
      contentEncodingHeader
    };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  isTextContentType,
  validateTargetUrl,
  fetchRemote
};
