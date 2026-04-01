#!/usr/bin/env node
/**
 * Markdown Preview Server for cmux
 * - Serves markdown as interactive dark-themed HTML
 * - Checkbox toggle syncs back to original .md file
 * - Directory listing API for picker UI
 */

import { createServer } from 'http';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { execSync } from 'child_process';
import { basename, join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { URL } from 'url';

const PORT = parseInt(process.env.PREVIEW_PORT || '19542');
const HOST = '127.0.0.1';

// --- Dark theme CSS (shared with md-to-html.sh) ---
const CSS = `
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background: #0d1117; color: #e6edf3;
  padding: 32px 40px; margin: 0; line-height: 1.6; max-width: 900px;
}
h1, h2, h3, h4 { color: #7aa2f7; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; }
a { color: #7dcfff; }
code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; color: #f0883e; }
pre { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; overflow-x: auto; }
pre code { background: none; color: #e6edf3; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #30363d; padding: 8px 12px; text-align: left; }
th { background: #161b22; color: #7aa2f7; font-weight: 600; }
tr:nth-child(even) { background: #0d1117; }
tr:nth-child(odd) { background: #161b22; }
blockquote { border-left: 4px solid #7aa2f7; margin: 16px 0; padding: 8px 16px; color: #8b949e; background: #161b22; border-radius: 0 8px 8px 0; }
ul, ol { padding-left: 24px; }
li { margin: 4px 0; }
hr { border: none; border-top: 1px solid #21262d; margin: 24px 0; }
img { max-width: 100%; border-radius: 8px; }

/* Interactive checkbox styling */
input[type="checkbox"] {
  width: 18px; height: 18px; cursor: pointer; accent-color: #7aa2f7;
  vertical-align: middle; margin-right: 6px;
}
input[type="checkbox"]:hover { transform: scale(1.1); }
li:has(input[type="checkbox"]) { list-style: none; margin-left: -20px; }

/* Notification toast */
.toast {
  position: fixed; bottom: 20px; right: 20px;
  background: #238636; color: #fff; padding: 8px 16px;
  border-radius: 8px; font-size: 14px; opacity: 0;
  transition: opacity 0.3s; pointer-events: none; z-index: 1000;
}
.toast.show { opacity: 1; }
.toast.error { background: #da3633; }

/* File path header */
.file-header {
  color: #8b949e; font-size: 12px; margin-bottom: 16px;
  padding: 8px 12px; background: #161b22; border-radius: 6px;
  border: 1px solid #21262d; display: flex; justify-content: space-between; align-items: center;
}
.file-header .refresh-btn {
  background: none; border: 1px solid #30363d; color: #8b949e;
  padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.file-header .refresh-btn:hover { color: #e6edf3; border-color: #7aa2f7; }
`;

// --- Interactive checkbox JS ---
const CLIENT_JS = `
<script>
const FILE_PATH = document.body.dataset.filePath;

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 1500);
}

document.addEventListener('change', async (e) => {
  if (e.target.tagName !== 'INPUT' || e.target.type !== 'checkbox') return;
  const idx = parseInt(e.target.dataset.cbIndex);
  if (isNaN(idx)) return;
  const checked = e.target.checked;
  try {
    const res = await fetch('/api/checkbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: FILE_PATH, index: idx, checked })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed');
    showToast('Saved');
  } catch (err) {
    e.target.checked = !checked; // rollback
    showToast('Error: ' + err.message, true);
  }
});

// Auto-refresh via polling (every 2s check file mtime)
let lastMtime = document.body.dataset.mtime;
setInterval(async () => {
  try {
    const res = await fetch('/api/mtime?file=' + encodeURIComponent(FILE_PATH));
    const data = await res.json();
    if (data.mtime && data.mtime !== lastMtime) {
      // File changed externally, but only reload if no checkbox was just clicked
      lastMtime = data.mtime;
      location.reload();
    }
  } catch {}
}, 2000);

function refreshNow() { location.reload(); }
</script>
`;

// --- Markdown rendering ---
function renderMarkdown(mdContent) {
  try {
    return execSync('marked', { input: mdContent, encoding: 'utf-8', timeout: 5000 });
  } catch {
    // Fallback: return escaped content
    return '<pre>' + mdContent.replace(/</g, '&lt;') + '</pre>';
  }
}

function makeCheckboxesInteractive(html, mdContent) {
  // Find all checkboxes in the original markdown to get line mapping
  const lines = mdContent.split('\n');
  const checkboxLines = [];
  lines.forEach((line, i) => {
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) {
      checkboxLines.push(i);
    }
  });

  // Replace disabled checkboxes with interactive ones, adding data-cb-index
  let cbIdx = 0;
  html = html.replace(/<input (checked=""[ ])?disabled=""[ ]type="checkbox">/g, (match, checked) => {
    const idx = cbIdx++;
    const isChecked = checked ? 'checked' : '';
    return `<input type="checkbox" ${isChecked} data-cb-index="${idx}">`;
  });

  return html;
}

// --- Checkbox toggle in source file ---
async function toggleCheckbox(filePath, cbIndex, checked) {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  let idx = 0;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(lines[i])) {
      if (idx === cbIndex) {
        if (checked) {
          lines[i] = lines[i].replace(/\[[ ]\]/, '[x]');
        } else {
          lines[i] = lines[i].replace(/\[[xX]\]/, '[ ]');
        }
        found = true;
        break;
      }
      idx++;
    }
  }

  if (!found) throw new Error(`Checkbox #${cbIndex} not found`);
  await writeFile(filePath, lines.join('\n'), 'utf-8');
}

// --- Directory listing ---
async function listDir(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    result.push({
      name: entry.name,
      path: join(dirPath, entry.name),
      isDir: entry.isDirectory(),
    });
  }
  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

// --- HTTP Server ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    // --- Preview route ---
    if (url.pathname === '/preview') {
      const filePath = url.searchParams.get('file');
      if (!filePath || !existsSync(filePath)) {
        res.writeHead(404); res.end('File not found');
        return;
      }
      const mdContent = await readFile(filePath, 'utf-8');
      const fileStat = await stat(filePath);
      let html = renderMarkdown(mdContent);
      html = makeCheckboxesInteractive(html, mdContent);

      const page = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${basename(filePath)}</title>
<style>${CSS}</style></head>
<body data-file-path="${filePath}" data-mtime="${fileStat.mtimeMs}">
<div class="file-header">
  <span>${filePath}</span>
  <button class="refresh-btn" onclick="refreshNow()">Refresh</button>
</div>
${html}
<div id="toast" class="toast"></div>
${CLIENT_JS}
</body></html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }

    // --- Checkbox toggle API ---
    if (url.pathname === '/api/checkbox' && req.method === 'POST') {
      const body = await readBody(req);
      const { file, index, checked } = JSON.parse(body);
      await toggleCheckbox(file, index, checked);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // --- File mtime API (for auto-refresh) ---
    if (url.pathname === '/api/mtime') {
      const filePath = url.searchParams.get('file');
      if (!filePath || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const fileStat = await stat(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mtime: String(fileStat.mtimeMs) }));
      return;
    }

    // --- Directory listing API ---
    if (url.pathname === '/api/list-dir') {
      const dirPath = url.searchParams.get('path') || process.cwd();
      const entries = await listDir(resolve(dirPath));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries));
      return;
    }

    // --- Health check ---
    if (url.pathname === '/health') {
      res.writeHead(200); res.end('ok');
      return;
    }

    res.writeHead(404); res.end('Not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Preview server running at http://${HOST}:${PORT}`);
  // Write PID for management
  const pidFile = '/tmp/cmux-preview-server.pid';
  import('fs').then(fs => fs.writeFileSync(pidFile, String(process.pid)));
});
