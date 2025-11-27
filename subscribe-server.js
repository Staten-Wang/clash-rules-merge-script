#!/usr/bin/env node
"use strict";

// subscribe-server.js
// 启动一个简单的 HTTP/HTTPS 服务：通过路径形式传入订阅 URL
// 例如：GET /https://www.ccsub.org/link/Y368wNPX
// 服务会使用 ./downloader.fetchRemote 下载订阅内容，使用指定的 config.js 的 main 转换并返回 YAML

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const vm = require('vm');
const yaml = require('js-yaml');
const downloader = require('./downloader');

function sanitizeFilename(name) {
  if (!name) return null;
  let s = String(name).trim();
  // remove surrounding quotes
  s = s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  // try decode if percent-encoded
  try { s = decodeURIComponent(s); } catch (e) {}
  // take basename to avoid paths
  s = path.basename(s);
  // remove control and illegal filename chars
  s = s.replace(/[\x00-\x1f<>:"/\\|?*]/g, '');
  // replace whitespace with underscore
  s = s.replace(/\s+/g, '_');
  // collapse multiple dots
  s = s.replace(/\.{2,}/g, '.');
  // trim dots or spaces from ends
  s = s.replace(/^[. ]+|[. ]+$/g, '');
  if (!s) return null;
  return s;
}

function loadMainFromConfig(filePath) {
  const absPath = path.resolve(filePath);
  const code = fs.readFileSync(absPath, 'utf8');
  const sandbox = {
    console: console,
    require: require,
    process: process,
    __dirname: path.dirname(absPath),
    __filename: absPath,
    module: {},
    exports: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (typeof sandbox.main !== 'function') {
    throw new Error(`在 ${filePath} 中未找到名为 main 的函数`);
  }
  return sandbox.main;
}

function tryParseYamlFromString(str) {
  try {
    const obj = yaml.load(str);
    return obj;
  } catch (e) {
    return null;
  }
}

function isProbableBase64(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.replace(/\s+/g, '');
  if (s.length < 100) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

async function handleConvert(targetUrl, configPath, maxBytes) {
  const remote = await downloader.fetchRemote(targetUrl, { maxBytes: maxBytes, forceText: true });

  let yamlStr = null;
  if (remote.contentEncoding === 'utf8') {
    const text = (remote.content || '').trim();
    if (tryParseYamlFromString(text)) {
      yamlStr = text;
    } else if (isProbableBase64(text)) {
      try {
        const buf = Buffer.from(text.replace(/\s+/g, ''), 'base64');
        const s = buf.toString('utf8');
        if (tryParseYamlFromString(s)) yamlStr = s;
      } catch (e) {}
    }
  }

  if (!yamlStr && remote.contentEncoding === 'base64') {
    try {
      const buf = Buffer.from(remote.content || '', 'base64');
      const s = buf.toString('utf8');
      if (tryParseYamlFromString(s)) yamlStr = s;
    } catch (e) {}
  }

  if (!yamlStr) {
    const err = new Error('无法从订阅内容中识别出 YAML 格式（尝试了直接解析与 base64 解码）');
    err.debugContent = remote.contentEncoding === 'base64' ? remote.content : (remote.content || '');
    throw err;
  }

  const cfgObj = yaml.load(yamlStr);
  const mainFn = loadMainFromConfig(configPath);
  const newCfg = mainFn(cfgObj);
  const outYaml = yaml.dump(newCfg, { sortKeys: false, noRefs: true, lineWidth: 120 });

  // Determine a filename to suggest to the client. Prefer the downloader-provided filename.
  let outFilename = null;
  if (remote && remote.filename) {
    outFilename = sanitizeFilename(remote.filename) || null;
  }
  if (!outFilename) {
    try {
      const u = new URL(targetUrl);
      outFilename = sanitizeFilename(path.basename(u.pathname)) || 'subscription';
    } catch (e) {
      outFilename = 'subscription';
    }
  }
  if (!path.extname(outFilename)) outFilename += '.yaml';

  return { outYaml, filename: outFilename };
}

function makeHandler(configPath, maxBytes) {
  return async function (req, res) {
    try {
      const raw = req.url || '';
      // 路径以斜杠开头，去掉首个 '/'
      const trimmed = raw.replace(/^\//, '');
      const decoded = decodeURIComponent(trimmed);
      if (!/^https?:\/\//i.test(decoded)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('请求路径必须为完整的目标 URL，例如 /https://example.com/sub');
        return;
      }
      console.log('Requested convert for:', decoded);

      let outYaml, suggestedName;
      try {
        const result = await handleConvert(decoded, configPath, maxBytes);
        outYaml = result.outYaml;
        suggestedName = result.filename;
      } catch (e) {
        console.error('convert error:', e && e.message ? e.message : e);
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('转换失败: ' + (e.message || String(e)));
        return;
      }

      // Prepare Content-Disposition header using RFC5987 for non-ascii names
      // Add a 'Convert-' prefix to suggested filename to mark it's converted
      if (suggestedName && !/^Convert(?:-|_|\s)/i.test(suggestedName)) {
        suggestedName = 'Convert-' + suggestedName;
      }

      function contentDispositionHeader(filename) {
        if (!filename) return 'attachment';
        // ascii printable check
        if (/^[\x20-\x7E]*$/.test(filename)) {
          return `attachment; filename=${filename.replace(/"/g, '\\"')}`;
        }
        return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
      }

      const cd = contentDispositionHeader(suggestedName);

      // Expose original target URL so clients can show original subscription info
      const extraHeaders = {
        'Content-Type': 'application/x-yaml; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': cd,
        'Content-Location': decoded,
        'X-Original-Url': decoded,
        'X-Source-Url': decoded
      };
      // Expose headers for clients that require CORS header exposure
      extraHeaders['Access-Control-Expose-Headers'] = 'Content-Disposition,Content-Location,X-Original-Url,X-Source-Url';

      res.writeHead(200, extraHeaders);
      res.end(outYaml, 'utf8');
    } catch (e) {
      console.error('handler fatal:', e);
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('服务器错误');
      } catch (e2) {}
    }
  };
}

function startServer(opts) {
  const configPath = opts.configPath || './config.js';
  const maxBytes = opts.maxBytes;
  const host = opts.host || '0.0.0.0';
  const port = opts.port || (opts.https ? 443 : 8080);

  const handler = makeHandler(configPath, maxBytes);

  if (opts.https && opts.key && opts.cert) {
    const key = fs.readFileSync(opts.key);
    const cert = fs.readFileSync(opts.cert);
    const server = https.createServer({ key, cert }, handler);
    server.listen(port, host, () => {
      console.log(`HTTPS server listening on https://${host}:${port}/`);
      console.log('Usage example: https://<host>/' + encodeURIComponent('https://www.ccsub.org/link/Y368wNPX'));
    });
    return server;
  }

  // fallback to HTTP if no cert/key provided
  const server = http.createServer(handler);
  server.listen(port, host, () => {
    console.log(`HTTP server listening on http://${host}:${port}/`);
    console.log('Usage example: http://' + host + ':' + port + '/' + encodeURIComponent('https://www.ccsub.org/link/Y368wNPX'));
  });
  return server;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  // CLI: [port] [config.js] [certPath] [keyPath] [maxBytes]
  const port = argv[0] ? parseInt(argv[0], 10) : undefined;
  const configPath = argv[1] || './config.js';
  const certPath = argv[2] || process.env.SSL_CERT;
  const keyPath = argv[3] || process.env.SSL_KEY;
  const maxBytes = process.env.MAX_BYTES ? parseInt(process.env.MAX_BYTES, 10) : (argv[4] ? parseInt(argv[4], 10) : undefined);

  const opts = {
    port: port,
    configPath: configPath,
    https: !!(certPath && keyPath),
    cert: certPath,
    key: keyPath,
    maxBytes: maxBytes,
    host: '0.0.0.0'
  };

  startServer(opts);
}

module.exports = { startServer };
