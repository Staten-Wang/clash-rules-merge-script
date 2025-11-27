#!/usr/bin/env node

// test-downloader.js (保存并执行前确认 downloader.js 可用)
'use strict';

const fs = require('fs');
const path = require('path');
const downloader = require('./downloader');

function getFilenameFromContentDisposition(cd) {
  if (!cd) return null;
  // 先尝试 filename* (RFC 5987) 形式： filename*=UTF-8''%E4...
  const filenameStarMatch = cd.match(/filename\*\s*=\s*([^;]+)/i);
  if (filenameStarMatch) {
    let val = filenameStarMatch[1].trim();
    // 去掉外层引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // 形如 UTF-8''...
    const m = val.match(/^(?:[A-Za-z0-9\-]+)?''(.+)$/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { /* ignore */ }
    }
    try { return decodeURIComponent(val); } catch (e) { /* ignore */ }
  }
  // 然后尝试普通 filename="..."
  const filenameMatch = cd.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  if (filenameMatch) {
    return (filenameMatch[1] || filenameMatch[2] || '').trim();
  }
  return null;
}

function sanitizeFilename(name) {
  if (!name) return null;
  // 取 basename 防止目录穿越
  let b = path.basename(name);
  // 替换常见的非法字符
  b = b.replace(/[\r\n<>:"/\\|?*\x00-\x1F]/g, '_');
  // 如果为空则返回 null
  if (!b) return null;
  return b;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: node test-downloader.js <url> [outfile] [maxBytes]');
    process.exit(2);
  }
  const url = argv[0];
  const outFileArg = argv[1] || null;
  const maxBytes = argv[2] ? parseInt(argv[2], 10) : (process.env.MAX_BYTES ? parseInt(process.env.MAX_BYTES, 10) : undefined);
  const forceText = (() => {
    // 支持第4个位置参数为 '1' 或 'true' 来强制按文本解码，或通过环境变量 FORCE_TEXT=1/true
    if (argv[3]) return argv[3] === '1' || argv[3].toLowerCase() === 'true';
    const v = process.env.FORCE_TEXT;
    return v === '1' || (typeof v === 'string' && v.toLowerCase() === 'true');
  })();

  console.log('validateTargetUrl ->', url);
  try {
    await downloader.validateTargetUrl(url);
    console.log('validateTargetUrl: OK');
  } catch (e) {
    console.error('validateTargetUrl: FAILED', e.message || e);
    if (e.status) console.error('status:', e.status);
    process.exit(1);
  }

  console.log('fetchRemote ->', url, ' maxBytes=', maxBytes || '(default)');

  try {
    const remote = await downloader.fetchRemote(url, { maxBytes: maxBytes, forceText });
    console.log('fetchRemote: contentEncoding=', remote.contentEncoding, ' contentType=', remote.contentType, ' forceText=', !!forceText);

    // 优先使用 fetchRemote 返回的 filename（如果提供），否则回退到 URL 推断
    const inferredNameRaw = remote.filename || null;
    let inferredName = sanitizeFilename(inferredNameRaw) || null;
    if (!inferredName) {
      try {
        const u = new URL(url);
        inferredName = sanitizeFilename(path.basename(u.pathname)) || null;
      } catch (e) {
        inferredName = null;
      }
    }

    if (remote.contentEncoding === 'utf8') {
      const content = remote.content;
      const outfile = outFileArg || inferredName || 'out.yaml';
      fs.writeFileSync(outfile, content, 'utf8');
      console.log(`Wrote text ${Buffer.byteLength(content, 'utf8')} bytes to ${outfile}`);
      console.log('Upstream headers:', remote.headers);
    } else if (remote.contentEncoding === 'base64') {
      const content = remote.content || '';
      const outfile = outFileArg || inferredName || 'out.yaml';
      const buf = Buffer.from(content, 'base64');
      fs.writeFileSync(outfile, buf);
      console.log(`Wrote binary ${buf.length} bytes to ${outfile}`);
      console.log('Upstream headers:', remote.headers);
    } else {
      console.error('Unknown contentEncoding:', remote.contentEncoding, ' full remote object:', remote);
    }
  } catch (err) {
    console.error('fetchRemote error:', err && err.message ? err.message : err);
    if (err.status) console.error('status:', err.status);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
