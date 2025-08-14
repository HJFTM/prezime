// FILE: generate-pdf.js

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { uvodPages } from '../observablehq.uvod.js';
import { getRodEntitetiIzvoriPages } from '../observablehq.rodovi.js';
import { obiteljiPages } from "../observablehq.obitelji.js";

import {
  CURRENT_PROJECT,
  data
} from "../observablehq.base.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isUvod = CURRENT_PROJECT === "Uvod";
let pages = isUvod ? uvodPages : getRodEntitetiIzvoriPages(CURRENT_PROJECT, data);
const BASE_URL = isUvod
  ? 'https://hjftm.github.io/uvod'
  : `https://hjftm.github.io/${CURRENT_PROJECT.toLowerCase()}`;

if (CURRENT_PROJECT === "Uvod") {
  pages = uvodPages;
} else if (CURRENT_PROJECT === "Obitelji") {
  pages = obiteljiPages;
} else {
  pages = getRodEntitetiIzvoriPages(CURRENT_PROJECT, data);
}

const outputDir = process.env.OUTPUT_DIR
  ? path.resolve(__dirname, '..', '..', process.env.OUTPUT_DIR)
  : path.join(__dirname, '..', 'public');

const pdfFileName = `${CURRENT_PROJECT}.pdf`;
const pdfPath = path.join(outputDir, pdfFileName);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

let flattenPages; 

if (CURRENT_PROJECT === "Uvod") {
  flattenPages = pages.flatMap(group =>
    group.pages.map(page => `${BASE_URL}${page.path}`)
  );
} else if (CURRENT_PROJECT === "Obitelji") {
  flattenPages = pages.flatMap(group =>
    group.pages.map(page => `${BASE_URL}${page.pathEncoded2}`)
  );
} else {
  flattenPages = pages.flatMap(group =>
    group.pages.map(page => `${BASE_URL}${page.path}?ROD=${CURRENT_PROJECT}`)
  );
}

const extraPages = isUvod
  ? [
      '/pages/alati',
      '/pages/autor',
      '/pages/KONCEPT/Navigacija'
    ].map(path => `${BASE_URL}${path}`)
  : [];

const urls = [...flattenPages, ...extraPages];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  let html = '<html><head><style>body { font-family: sans-serif; }</style></head><body>';

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });
      const main = await page.$eval('main', el => el.innerHTML);
      html += `<div style="page-break-after: always;">${main}</div>`;
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
    headerTemplate: `<div style="font-size:10px; width:100%; padding-right:10px; text-align:right;">${new Date().toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb' })}</div>`,
    footerTemplate: `<div style="font-size:10px; width:100%; text-align:center;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
  });

  const targetDir = path.resolve(__dirname, '..', '..', 'gh-pages', 'pdf');
  const targetPath = path.join(targetDir, pdfFileName);

  // ✅ Kreiraj ciljnu mapu ako ne postoji
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`📁 Kreiran ciljni direktorij: ${targetDir}`);
  }

  fs.copyFileSync(pdfPath, targetPath);
  console.log(`📄 PDF kopiran u: ${targetPath}`);

  await browser.close();
  console.log(`✅ PDF generiran: ${pdfPath}`);
})();
