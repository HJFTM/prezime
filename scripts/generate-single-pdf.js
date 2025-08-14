// FILE: main/scripts/generate-single-pdf.js
// Run: node main/scripts/generate-single-pdf.js
// Opis: Renderira sve pages/**/*.html, URL-ove poziva BEZ .html (clean URLs) uz .html fallback,
//       i spaja sve u JEDAN PDF: <CURRENT_PROJECT>.pdf u gh-pages rootu.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { setTimeout as delay } from "timers/promises";
import { PDFDocument } from "pdf-lib";

// ---------- Config ----------
const CURRENT_PROJECT =
  process.env.CURRENT_PROJECT ??
  (process.env.GITHUB_REPOSITORY?.split("/")?.pop() ?? "uvod");

const PUBLIC_HOST = process.env.PUBLIC_HOST ?? "https://hjftm.github.io";
const GH_PAGES_DIR = process.env.GH_PAGES_DIR ?? "gh-pages";
const PAGES_DIR = process.env.PAGES_DIR ?? "pages";

// PDF render postavke
const PDF_FORMAT = process.env.PDF_FORMAT ?? "A4";
const PDF_PRINT_BACKGROUND = (process.env.PDF_PRINT_BACKGROUND ?? "true") === "true";
const PDF_MARGIN = {
  top: process.env.PDF_MARGIN_TOP ?? "10mm",
  right: process.env.PDF_MARGIN_RIGHT ?? "10mm",
  bottom: process.env.PDF_MARGIN_BOTTOM ?? "12mm",
  left: process.env.PDF_MARGIN_LEFT ?? "10mm",
};

// Timeout & delay
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 120000);
const POST_GOTO_DELAY_MS = Number(process.env.POST_GOTO_DELAY_MS ?? 500);

// Ostalo
const SORT_INPUT = (process.env.SORT_INPUT ?? "true") === "true";
const PAGES_PER_TAB = Number(process.env.PAGES_PER_TAB ?? 120);

// ---------- Helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const absoluteGhPagesDir = path.resolve(__dirname, "..", "..", GH_PAGES_DIR);
const localPagesRoot = path.join(absoluteGhPagesDir, PAGES_DIR);
const baseUrl = `${PUBLIC_HOST}/${CURRENT_PROJECT}`;
const outSinglePdf = path.join(absoluteGhPagesDir, `${CURRENT_PROJECT}.pdf`);

function isHtmlFile(filePath) {
  return filePath.toLowerCase().endsWith(".html");
}

async function* walk(dir) {
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* walk(res);
    } else {
      yield res;
    }
  }
}

function toExtensionlessPublicUrl(absoluteHtmlPath) {
  const rel = path.relative(absoluteGhPagesDir, absoluteHtmlPath).split(path.sep).join("/");
  let extlessPath;
  if (rel.toLowerCase().endsWith("/index.html")) {
    extlessPath = rel.slice(0, -("index.html".length));  // "pages/foo/"
  } else {
    extlessPath = rel.replace(/\.html?$/i, "");          // "pages/abc/def"
  }
  const url = `${baseUrl}/${extlessPath}`.replace(/\/{2,}/g, "/");
  return encodeURI(url);
}

function toHtmlPublicUrl(absoluteHtmlPath) {
  const rel = path.relative(absoluteGhPagesDir, absoluteHtmlPath).split(path.sep).join("/");
  const url = `${baseUrl}/${rel}`.replace(/\/{2,}/g, "/");
  return encodeURI(url);
}

// ---------- Main ----------
(async () => {
  console.log("=== generate-single-pdf.js ===");
  console.log("Project           :", CURRENT_PROJECT);
  console.log("PUBLIC_HOST       :", PUBLIC_HOST);
  console.log("GH_PAGES_DIR      :", absoluteGhPagesDir);
  console.log("PAGES_DIR         :", localPagesRoot);
  console.log("PDF format/margin :", PDF_FORMAT, PDF_MARGIN);
  console.log("NAV_TIMEOUT_MS    :", NAV_TIMEOUT_MS);
  console.log("POST_GOTO_DELAY   :", POST_GOTO_DELAY_MS, "ms");

  if (!fs.existsSync(absoluteGhPagesDir)) {
    console.error(`Greška: GH_PAGES_DIR ne postoji: ${absoluteGhPagesDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(localPagesRoot)) {
    console.error(`Greška: PAGES_DIR ne postoji: ${localPagesRoot}`);
    process.exit(2);
  }

  // Skupi sve .html
  const htmlFiles = [];
  for await (const fp of walk(localPagesRoot)) {
    if (isHtmlFile(fp)) htmlFiles.push(fp);
  }
  if (htmlFiles.length === 0) {
    console.warn("Upozorenje: Nema .html datoteka u 'pages/'.");
    process.exit(0);
  }
  if (SORT_INPUT) htmlFiles.sort((a, b) => a.localeCompare(b));

  console.log(`Nađeno HTML datoteka: ${htmlFiles.length}`);
  console.log(`Izlazni PDF         : ${outSinglePdf}`);

  // Finalni PDF
  const finalDoc = await PDFDocument.create();

  // Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  try {
    for (let i = 0; i < htmlFiles.length; i++) {
      if (i > 0 && i % PAGES_PER_TAB === 0) {
        try { await page.close(); } catch {}
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
      }

      const htmlAbs = htmlFiles[i];
      const urlPrimary = toExtensionlessPublicUrl(htmlAbs);
      const urlFallback = toHtmlPublicUrl(htmlAbs);

      console.log(`[${i + 1}/${htmlFiles.length}] Render (clean URL) -> ${urlPrimary}`);

      let loaded = false;
      try {
        const resp = await page.goto(urlPrimary, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
        if (!resp || !resp.ok()) throw new Error(`HTTP status ${resp?.status?.() ?? "unknown"} on clean URL`);
        loaded = true;
      } catch (e1) {
        console.warn(`   ⚠ Clean URL nije uspio, probam .html: ${e1?.message || e1}`);
        try {
          console.log(`   → Fallback (.html) -> ${urlFallback}`);
          const resp2 = await page.goto(urlFallback, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
          if (!resp2 || !resp2.ok()) throw new Error(`HTTP status ${resp2?.status?.() ?? "unknown"} on .html URL`);
          loaded = true;
        } catch (e2) {
          console.error("   ✖ Greška (oba URL-a):", e2?.stack || e2?.message || String(e2));
        }
      }

      if (!loaded) continue;

      try {
        await delay(POST_GOTO_DELAY_MS);
        await page.evaluate(() => new Promise((resolve) => {
          if (document.readyState === "complete") return resolve();
          window.addEventListener("load", () => resolve(), { once: true });
        }));

        const pdfBytes = await page.pdf({
          path: undefined,
          format: PDF_FORMAT,
          printBackground: PDF_PRINT_BACKGROUND,
          margin: PDF_MARGIN,
        });

        const srcDoc = await PDFDocument.load(pdfBytes);
        const srcPages = await finalDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        srcPages.forEach((p) => finalDoc.addPage(p));

      } catch (err) {
        console.error("   ✖ Greška tijekom render/merge:", err?.stack || err?.message || String(err));
      }
    }
  } finally {
    try { await page.close(); } catch {}
    await browser.close().catch(() => {});
  }

  const finalBytes = await finalDoc.save();
  await fsp.writeFile(outSinglePdf, finalBytes);
  console.log("✔ Gotov jedinstveni PDF:", outSinglePdf);
})().catch((e) => {
  console.error("Fatal error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
