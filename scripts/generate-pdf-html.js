// FILE: generate-pdf.js
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { CURRENT_PROJECT } from '../observablehq.base.js'; // zadržavamo, koristi se za BASE_URL

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1) Odredi BASE_URL projekta (hostano na GH Pages)
const BASE_URL =
  CURRENT_PROJECT === 'Uvod'
    ? 'https://hjftm.github.io/uvod'
    : `https://hjftm.github.io/${CURRENT_PROJECT.toLowerCase()}`;

// 2) Gdje je lokalno COPY objavljenog sajta (gh-pages branch)?
//    Možeš promijeniti putem SOURCE_DIR env var (apsolutna ili relativna putanja)
const sourceDir = process.env.SOURCE_DIR
  ? path.resolve(process.env.SOURCE_DIR)
  : path.resolve(__dirname, '..', '..', 'gh-pages');

// 3) Tražimo SAMO unutar "pages/" pod stabla objave
const pagesDir = path.join(sourceDir, 'pages');

// 4) Rekurzivno pokupi sve .html datoteke
function walkHtmlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkHtmlFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// 5) Pretvori lokalnu putanju datoteke u javni URL
function filePathToUrl(filePath) {
  // relativno prema ROOT-u (sourceDir), ne prema pagesDir — treba nam prefiks '/pages/...'
  const relFromRoot = path.relative(sourceDir, filePath).split(path.sep).join('/');

  // Ako je .../pages/foo/index.html → /pages/foo/
  if (relFromRoot.endsWith('/index.html')) {
    const withoutIndex = relFromRoot.slice(0, -'/index.html'.length);
    return `${BASE_URL}/${withoutIndex}/`;
  }

  // Inače zadrži .html
  return `${BASE_URL}/${relFromRoot}`;
}

// 6) Pripremi izlaz
const outputDir = process.env.OUTPUT_DIR
  ? path.resolve(__dirname, '..', '..', process.env.OUTPUT_DIR)
  : path.join(__dirname, '..', 'public');

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const pdfFileName = `${CURRENT_PROJECT}.pdf`;
const pdfPath = path.join(outputDir, pdfFileName);

// 7) Sastavi listu URL‑ova iz filesystema
const htmlFiles = walkHtmlFiles(pagesDir);

// (Opcionalno) Filtriraj duplikate i sortiraj (index stranice prije dubokih, čisto radi konzistentnosti)
const urls = Array.from(new Set(htmlFiles.map(filePathToUrl))).sort((a, b) => a.localeCompare(b));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  let html = '<html><head><style>body{font-family:sans-serif}</style></head><body>';

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

      // Preferiraj <main>, ali ako ga nema, uzmi cijeli <body>
      const hasMain = await page.$('main');
      let chunk;
      if (hasMain) {
        chunk = await page.$eval('main', el => el.innerHTML);
      } else {
        chunk = await page.$eval('body', el => el.innerHTML);
      }

      html += `<div style="page-break-after: always;">${chunk}</div>`;
      console.log(`✔ Dodano: ${url}`);
    } catch (e) {
      console.error(`❌ Greška pri ${url}: ${e.message}`);
      html += `<div style="page-break-after: always;"><p>⚠️ Neuspješno dohvaćeno: ${url}</p></div>`;
    }
  }

  html += '</body></html>';
  await page.setContent(html, { waitUntil: 'networkidle0' });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:10px;width:100%;padding-right:10px;text-align:right;">${new Date().toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb' })}</div>`,
    footerTemplate: `<div style="font-size:10px;width:100%;text-align:center;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
  });

  // 8) Kopiraj u gh-pages/pdf
  const targetDir = path.resolve(__dirname, '..', '..', 'gh-pages', 'pdf');
  const targetPath = path.join(targetDir, pdfFileName);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  fs.copyFileSync(pdfPath, targetPath);
  console.log(`📄 PDF kopiran u: ${targetPath}`);

  await browser.close();
  console.log(`✅ PDF generiran: ${pdfPath}`);
})();
