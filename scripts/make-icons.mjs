// Renders the toolbar icons: Sharh's eight-point star on an ink tile. Run after changing the mark.
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const STAR = 'M12 2 14.2 7.6 19.8 5.4 17.6 10 22 12 17.6 14 19.8 18.6 14.2 16.4 12 22 9.8 16.4 4.2 18.6 6.4 14 2 12 6.4 10 4.2 5.4 9.8 7.6Z';
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#151f2a"/><g transform="translate(4.8 4.8) scale(.9)"><path d="${STAR}" fill="#e7c27a"/></g></svg>`;
const browser = await chromium.launch({executablePath: process.env.SHARH_CHROME_EXECUTABLE, args: ['--no-sandbox']});
await mkdir('extension/icons', {recursive: true});
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({viewport: {width: size, height: size}});
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size)}`);
  await writeFile(`extension/icons/icon-${size}.png`, await page.screenshot({omitBackground: true, clip: {x: 0, y: 0, width: size, height: size}}));
  await page.close();
}
await browser.close();
