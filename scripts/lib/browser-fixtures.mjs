import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {chromium} from 'playwright';
export async function serveRepository() {
  const root = await realpath('.');
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const mapped = pathname === '/pdf.worker.mjs' || pathname.startsWith('/standard_fonts/') ? `/dist${pathname}` : pathname;
      const target = await realpath(resolve(root, `.${mapped}`));
      if (!target.startsWith(root + sep)) throw new Error('OUTSIDE_REPOSITORY');
      const types = {'.mjs':'text/javascript', '.html':'text/html; charset=utf-8', '.json':'application/json', '.pdf':'application/pdf'};
      res.setHeader('Content-Type', types[extname(target)] ?? 'application/octet-stream');
      res.end(await readFile(target));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))};
}
export function browserOptions() {
  return {headless: true, args: ['--no-sandbox'], ...(process.env.SHARH_CHROME_EXECUTABLE ? {executablePath: process.env.SHARH_CHROME_EXECUTABLE} : {})};
}
export async function fixtureBrowser() {
  const server = await serveRepository(); let browser;
  try { browser = await chromium.launch(browserOptions()); }
  catch (error) { await server.close(); throw error; }
  const page = await browser.newPage();
  async function extract(item) {
    if (item.format === 'html') {
      await page.goto(`${server.url}/${item.path}`);
      return page.evaluate(async () => (await import('/dist/prototype.mjs')).extractHTML(document));
    }
    await page.goto(`${server.url}/dist/index.html`);
    return page.evaluate(async path => {
      const p = await import('/dist/prototype.mjs'), pdf = await p.openPDF(await (await fetch('/' + path)).arrayBuffer());
      try { return await p.extractPDF(pdf, path); } finally { await pdf.destroy(); }
    }, item.path);
  }
  return {browser, page, server, extract, close: async () => { await browser.close(); await server.close(); }};
}
