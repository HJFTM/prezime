// FILE: main/scripts/generate-single-pdf.js
// Run: node main/scripts/generate-single-pdf.js
// Opis: Rendere više PDF-ova prema zadanim zadacima (name + patterns),
//       svaki PDF se snimi posebno, a zatim se svi spoje u jedan
//       konačni (npr. "prezime.pdf") i po potrebi komprimiraju.
//       Header: lijevo URL, desno "Page X / Y".

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { setTimeout as delay } from "timers/promises";
import { PDFDocument } from "pdf-lib";
import { exec as _exec } from "child_process";
import { promisify } from "util";

const exec = promisify(_exec);

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
  top: process.env.PDF_MARGIN_TOP ?? "15mm", // veći gornji margin zbog headera
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

// Finalni spojeni PDF + kompresija
const FINAL_PDF_NAME = process.env.FINAL_PDF_NAME ?? "prezime.pdf";
const FINAL_COMPRESS = (process.env.FINAL_COMPRESS ?? "true") === "true";
const GS_QUALITY = process.env.GS_QUALITY ?? "/ebook"; // /screen, /ebook, /printer, /prepress

// Zadaci – po potrebi izmijeni ili postavi preko PDF_TASKS_JSON
const PDF_TASKS = (() => {
  if (process.env.PDF_TASKS_JSON) {
    try {
      return JSON.parse(process.env.PDF_TASKS_JSON);
    } catch (e) {
      console.warn("⚠ Nevažeći PDF_TASKS_JSON, koristim lokalnu konstantu. Greška:", e?.message || e);
    }
  }
  return [
    { name: "koncept.pdf",  pages: ["pages/KONCEPT*"] },
    { name: "rod.pdf",      pages: ["pages/ROD*"] },
    //{ name: "matice.pdf",   pages: ["pages/ENTITET/matica*"] },
    //{ name: "mjesto.pdf",   pages: ["pages/ENTITET/mjesto*"] },
    //{ name: "obitelj.pdf",  pages: ["pages/ENTITET/obitelj*"] },
    //{ name: "zupa.pdf",     pages: ["pages/ENTITET/zupa*"] },
  ];
})();

// ---------- Helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const absoluteGhPagesDir = path.resolve(__dirname, "..", "..", GH_PAGES_DIR);
const localPagesRoot = path.join(absoluteGhPagesDir, PAGES_DIR);
const baseUrl = `${PUBLIC_HOST}/${CURRENT_PROJECT}`;

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
  const rel = path
    .relative(absoluteGhPagesDir, absoluteHtmlPath)
    .split(path.sep)
    .join("/");
  let extlessPath;
  if (rel.toLowerCase().endsWith("/index.html")) {
    extlessPath = rel.slice(0, -("index.html".length)); // "pages/foo/"
  } else {
    extlessPath = rel.replace(/\.html?$/i, ""); // "pages/abc/def"
  }
  const url = `${baseUrl}/${extlessPath}`.replace(/\/{2,}/g, "/");
  return encodeURI(url);
}

function toHtmlPublicUrl(absoluteHtmlPath) {
  const rel = path
    .relative(absoluteGhPagesDir, absoluteHtmlPath)
    .split(path.sep)
    .join("/");
  const url = `${baseUrl}/${rel}`.replace(/\/{2,}/g, "/");
  return encodeURI(url);
}

// Jednostavni "prefix" matcher: pattern s '*' znači "počinje s <prefix>"
function matchesAnyPattern(relPath, patterns = []) {
  if (!patterns.length) return false;
  for (const raw of patterns) {
    if (!raw) continue;
    const pat = raw.replace(/\\/g, "/"); // normaliziraj
    if (pat.endsWith("*")) {
      const prefix = pat.slice(0, -1);
      if (relPath.startsWith(prefix)) return true;
    } else {
      // točno ovaj prefix
      if (relPath.startsWith(pat)) return true;
    }
  }
  return false;
}

// Render jedne HTML stranice u PDF bytes (s headerom)
async function renderHtmlToPdfBytes(page, urlPrimary, urlFallback) {
  let loaded = false;
  let activeUrl = "";

  try {
    const resp = await page.goto(urlPrimary, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });
    if (!resp || !resp.ok()) throw new Error(`HTTP status ${resp?.status?.() ?? "unknown"} on clean URL`);
    loaded = true;
    activeUrl = urlPrimary;
  } catch (e1) {
    console.warn(`   ⚠ Clean URL nije uspio, probam .html: ${e1?.message || e1}`);
    try {
      const resp2 = await page.goto(urlFallback, {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });
      if (!resp2 || !resp2.ok()) throw new Error(`HTTP status ${resp2?.status?.() ?? "unknown"} on .html URL`);
      loaded = true;
      activeUrl = urlFallback;
    } catch (e2) {
      console.error("   ✖ Greška (oba URL-a):", e2?.stack || e2?.message || String(e2));
    }
  }

  if (!loaded) return null;

  await delay(POST_GOTO_DELAY_MS);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        if (document.readyState === "complete") return resolve();
        window.addEventListener("load", () => resolve(), { once: true });
      })
  );

  const headerHtml = `
    <div style="font-size:8px;
                width:100%;
                padding:0 5mm;
                display:flex;
                justify-content:space-between;
                color:#555;
                font-family:sans-serif;">
      <span>${activeUrl}</span>
      <span class="pageNumber"></span> / <span class="totalPages"></span>
    </div>`;

  const pdfBytes = await page.pdf({
    path: undefined,
    format: PDF_FORMAT,
    printBackground: PDF_PRINT_BACKGROUND,
    margin: PDF_MARGIN,
    displayHeaderFooter: true,
    headerTemplate: headerHtml,
    footerTemplate: "<div></div>",
  });

  return pdfBytes;
}

// Pokušaj kompresije GhostScriptom (ako postoji); inače samo kopira
async function maybeCompressPdf(inputPath, outputPath, quality = "/ebook") {
  if (!FINAL_COMPRESS) {
    await fsp.copyFile(inputPath, outputPath);
    return { method: "copy", ok: true };
  }

  try {
    // je li gs dostupan?
    await exec("command -v gs");
  } catch {
    console.warn("⚠ Ghostscript nije pronađen; preskačem kompresiju.");
    await fsp.copyFile(inputPath, outputPath);
    return { method: "copy-no-gs", ok: true };
  }

  const args = [
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.6",
    `-dPDFSETTINGS=${quality}`, // /screen /ebook /printer /prepress
    "-dDetectDuplicateImages=true",
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dNOPAUSE",
    "-dQUIET",
    "-dBATCH",
    `-sOutputFile=${JSON.stringify(outputPath)}`,
    JSON.stringify(inputPath),
  ].join(" ");

  try {
    await exec(`gs ${args}`);
    return { method: "ghostscript", ok: true };
  } catch (e) {
    console.warn("⚠ Ghostscript kompresija nije uspjela; vraćam nekopresirani PDF. Greška:", e?.message || e);
    await fsp.copyFile(inputPath, outputPath);
    return { method: "copy-fallback", ok: false };
  }
}

// ---------- Main ----------
(async () => {
  console.log("=== generate-single-pdf.js (multi-output + final merge) ===");
  console.log("Project           :", CURRENT_PROJECT);
  console.log("PUBLIC_HOST       :", PUBLIC_HOST);
  console.log("GH_PAGES_DIR      :", path.resolve(absoluteGhPagesDir));
  console.log("PAGES_DIR         :", path.resolve(localPagesRoot));
  console.log("PDF format/margin :", PDF_FORMAT, PDF_MARGIN);
  console.log("NAV_TIMEOUT_MS    :", NAV_TIMEOUT_MS);
  console.log("POST_GOTO_DELAY   :", POST_GOTO_DELAY_MS, "ms");
  console.log("TASKS             :", JSON.stringify(PDF_TASKS, null, 2));
  console.log("FINAL_PDF_NAME    :", FINAL_PDF_NAME);
  console.log("FINAL_COMPRESS    :", FINAL_COMPRESS);
  console.log("GS_QUALITY        :", GS_QUALITY);

  if (!fs.existsSync(absoluteGhPagesDir)) {
    console.error(`Greška: GH_PAGES_DIR ne postoji: ${absoluteGhPagesDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(localPagesRoot)) {
    console.error(`Greška: PAGES_DIR ne postoji: ${localPagesRoot}`);
    process.exit(2);
  }

  // 1) Skupi sve .html (apsolutne putanje) + pripremi relPath
  const allHtmlAbs = [];
  for await (const fp of walk(localPagesRoot)) {
    if (isHtmlFile(fp)) allHtmlAbs.push(fp);
  }
  if (allHtmlAbs.length === 0) {
    console.warn("Upozorenje: Nema .html datoteka u 'pages/'.");
    process.exit(0);
  }
  if (SORT_INPUT) allHtmlAbs.sort((a, b) => a.localeCompare(b));

  // 2) Pupeteer browser
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  // Za finalni merge: tu ćemo skupljati sve stranice iz svih taskova,
  // po redoslijedu definiranom u PDF_TASKS.
  const finalMergedDoc = await PDFDocument.create();

  try {
    // 3) Obradi svaki zadatak -> snimi posebni PDF + dodaj u finalMergedDoc
    for (const task of PDF_TASKS) {
      const outPdfPath = path.join(absoluteGhPagesDir, task.name);
      const patterns = Array.isArray(task.pages) ? task.pages.map(p => p.replace(/\\/g, "/")) : [];

      // Filtriraj fajlove po patternima
      const taskFiles = allHtmlAbs.filter(abs => {
        const rel = path.relative(absoluteGhPagesDir, abs).split(path.sep).join("/");
        return matchesAnyPattern(rel, patterns);
      });

      if (!taskFiles.length) {
        console.warn(`⚠ Zadatak "${task.name}": nema pogodaka za patterns = ${JSON.stringify(patterns)}`);
        continue;
      }

      console.log(`\n— ZADATAK: ${task.name}`);
      console.log(`   • Broj ulaznih HTML-ova: ${taskFiles.length}`);
      console.log(`   • Patterni: ${JSON.stringify(patterns)}`);
      console.log(`   • Output: ${outPdfPath}`);

      const taskDoc = await PDFDocument.create();

      for (let i = 0; i < taskFiles.length; i++) {
        if (i > 0 && i % PAGES_PER_TAB === 0) {
          try { await page.close(); } catch {}
          page = await browser.newPage();
          page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
        }

        const htmlAbs = taskFiles[i];
        const urlPrimary = toExtensionlessPublicUrl(htmlAbs);
        const urlFallback = toHtmlPublicUrl(htmlAbs);

        console.log(`   [${i + 1}/${taskFiles.length}] Render -> ${urlPrimary}`);

        try {
          const pdfBytes = await renderHtmlToPdfBytes(page, urlPrimary, urlFallback);
          if (!pdfBytes) {
            console.error("      ✖ Preskačem zbog greške pri učitavanju.");
            continue;
          }
          const srcDoc = await PDFDocument.load(pdfBytes);
          const srcPages = await taskDoc.copyPages(srcDoc, srcDoc.getPageIndices());
          srcPages.forEach(p => taskDoc.addPage(p));
        } catch (err) {
          console.error("      ✖ Greška tijekom render/merge:", err?.stack || err?.message || String(err));
        }
      }

      // Snimi task PDF
      const taskBytes = await taskDoc.save({ useObjectStreams: true });
      await fsp.writeFile(outPdfPath, taskBytes);
      console.log(`   ✔ Završeno: ${outPdfPath}`);

      // Dodaj njegove stranice i u finalMergedDoc (zadržavamo redoslijed zadataka)
      try {
        const again = await PDFDocument.load(taskBytes);
        const pages = await finalMergedDoc.copyPages(again, again.getPageIndices());
        pages.forEach(p => finalMergedDoc.addPage(p));
      } catch (e) {
        console.warn(`   ⚠ Ne mogu dodati stranice iz ${task.name} u finalni PDF:`, e?.message || e);
      }
    }
  } finally {
    try { await page.close(); } catch {}
    await browser.close().catch(() => {});
  }

  // 4) Snimi finalni spojeni PDF, pa ga (ako je uključeno) komprimiraj
  const finalTempPath = path.join(absoluteGhPagesDir, `__final_merged_tmp.pdf`);
  const finalOutPath  = path.join(absoluteGhPagesDir, FINAL_PDF_NAME);

  const finalBytes = await finalMergedDoc.save({ useObjectStreams: true });
  await fsp.writeFile(finalTempPath, finalBytes);
  console.log(`\n⏳ Spajanje gotovo, privremeni PDF: ${finalTempPath}`);

  const { method } = await maybeCompressPdf(finalTempPath, finalOutPath, GS_QUALITY);
  try { await fsp.unlink(finalTempPath); } catch {}

  console.log(`✔ Finalni PDF (${method}): ${finalOutPath}`);
  console.log("✔ Svi zadaci obrađeni.");
})().catch((e) => {
  console.error("Fatal error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
