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
    const remote = await downloader.fetchRemote(url, { maxBytes: maxBytes });
    console.log('fetchRemote: type=', remote.type, ' contentType=', remote.contentType);

    // 尝试从 headers 中获取 content-disposition 提示的文件名
    const cdHeader = remote.headers && (remote.headers['content-disposition'] || remote.headers['Content-Disposition'] || remote.headers['content-disposition'.toLowerCase()]);
    let inferredName = null;
    if (cdHeader) {
      inferredName = getFilenameFromContentDisposition(cdHeader);
    }
    if (!inferredName) {
      try {
        const u = new URL(url);
        inferredName = path.basename(u.pathname) || null;
      } catch (e) {
        inferredName = null;
      }
    }
    inferredName = sanitizeFilename(inferredName) || null;

    if (remote.type === 'text') {
      const content = remote.content;
      const outfile = outFileArg || inferredName || 'out.txt';
      fs.writeFileSync(outfile, content, 'utf8');
      console.log(`Wrote text ${Buffer.byteLength(content, 'utf8')} bytes to ${outfile}`);
      console.log('Upstream headers:', remote.headers);
    } else if (remote.type === 'stream') {
      const outfile = outFileArg || inferredName || 'out.yaml';
      const tmpFile = outfile + '.part';
      const ws = fs.createWriteStream(tmpFile);
      let bytes = 0;
      let aborted = false;

      remote.stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (maxBytes && bytes > maxBytes) {
          aborted = true;
          console.error('Exceeded maxBytes, destroying stream');
          try { remote.stream.destroy(); } catch (e) {}
          try { ws.destroy(new Error('exceeded maxBytes')); } catch (e) {}
        }
      });

      remote.stream.on('error', (err) => {
        console.error('upstream stream error:', err && err.message ? err.message : err);
      });

      ws.on('error', (err) => {
        console.error('write stream error:', err && err.message ? err.message : err);
      });

      ws.on('close', () => {
        if (aborted) {
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          console.error('Download aborted and partial file removed');
        } else {
          try {
            fs.renameSync(tmpFile, outfile);
            console.log(`Wrote binary ${bytes} bytes to ${outfile}`);
          } catch (e) {
            console.error('Failed to rename tmp file:', e);
          }
        }
      });

      // pipe（node-fetch v2 的 body 为 Node Readable stream） 
      if (typeof remote.stream.pipe === 'function') {
        remote.stream.pipe(ws);
      } else if (remote.stream.getReader) {
        // WHATWG 流 fallback（不常见）
        (async () => {
          const reader = remote.stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              ws.write(Buffer.from(value));
            }
            ws.end();
          } catch (e) {
            ws.destroy(e);
          }
        })();
      } else {
        throw new Error('unsupported stream type from fetchRemote');
      }

      console.log('Upstream headers:', remote.headers);
    } else {
      console.error('Unknown remote.type:', remote.type);
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
