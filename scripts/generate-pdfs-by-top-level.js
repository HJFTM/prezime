// FILE: main/scripts/generate-pdfs-by-top-level.js
// Run: node main/scripts/generate-pdfs-by-top-level.js
// Opis: Za svaki L1 folder unutar 'pages/' (npr. pages/ENTITET, pages/ROD, ...)
//       generira jedan objedinjeni PDF koji sadrži sve njegove stranice.
//       URL-ove poziva BEZ .html ekstenzije (clean URLs), uz .html fallback.

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

// (Opcionalno) gdje spremati rezultate unutar gh-pages ("" = root, "pdf" = gh-pages/pdf)
const PDF_OUTPUT_DIR = process.env.PDF_OUTPUT_DIR ?? "";

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

// (Opcionalno) filtriranje grupa: "ENTITET,ROD,KONCEPT"
const INCLUDED_GROUPS = (process.env.INCLUDED_GROUPS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);
const EXCLUDED_GROUPS = (process.env.EXCLUDED_GROUPS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ---------- Helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const absoluteGhPagesDir = path.resolve(__dirname, "..", "..", GH_PAGES_DIR);
const localPagesRoot = path.join(absoluteGhPagesDir, PAGES_DIR);
const baseUrl = `${PUBLIC_HOST}/${CURRENT_PROJECT}`;
const outRootDir = path.join(absoluteGhPagesDir, PDF_OUTPUT_DIR || ".");

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

function getTopLevelGroup(absoluteHtmlPath) {
  // npr. absoluteHtmlPath: /.../gh-pages/pages/ENTITET/something/file.html
  // relFromPages: ENTITET/something/file.html
  const relFromPages = path.relative(localPagesRoot, absoluteHtmlPath).split(path.sep).join("/");
  const parts = relFromPages.split("/");
  return parts.length > 1 ? parts[0] : "_root"; // html datoteke direktno u pages/ idu u "_root"
}

function sanitizeName(name) {
  // Siguran naziv datoteke (zadrži slova/brojeve/_/-; ostalo zamijeni s '_')
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "_");
}

function toExtensionlessPublicUrl(absoluteHtmlPath) {
  // rel npr. "pages/ENTITET/foo/bar.html" ili "pages/ROD/x/index.html"
  const rel = path.relative(absoluteGhPagesDir, absoluteHtmlPath).split(path.sep).join("/");
  let extlessPath;
  if (rel.toLowerCase().endsWith("/index.html")) {
    extlessPath = rel.slice(0, -("index.html".length));  // "pages/ROD/x/"
  } else {
    extlessPath = rel.replace(/\.html?$/i, "");          // "pages/ENTITET/foo/bar"
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
  console.log("=== generate-pdfs-by-top-level.js ===");
  console.log("Project           :", CURRENT_PROJECT);
  console.log("PUBLIC_HOST       :", PUBLIC_HOST);
  console.log("GH_PAGES_DIR      :", absoluteGhPagesDir);
  console.log("PAGES_DIR         :", localPagesRoot);
  console.log("PDF_OUTPUT_DIR    :", outRootDir);
  console.log("PDF format/margin :", PDF_FORMAT, PDF_MARGIN);
  console.log("NAV_TIMEOUT_MS    :", NAV_TIMEOUT_MS);
  console.log("POST_GOTO_DELAY   :", POST_GOTO_DELAY_MS, "ms");
  if (INCLUDED_GROUPS.length) console.log("INCLUDED_GROUPS   :", INCLUDED_GROUPS.join(","));
  if (EXCLUDED_GROUPS.length) console.log("EXCLUDED_GROUPS   :", EXCLUDED_GROUPS.join(","));

  if (!fs.existsSync(absoluteGhPagesDir)) {
    console.error(`Greška: GH_PAGES_DIR ne postoji: ${absoluteGhPagesDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(localPagesRoot)) {
    console.error(`Greška: PAGES_DIR ne postoji: ${localPagesRoot}`);
    process.exit(2);
  }
  await fsp.mkdir(outRootDir, { recursive: true });

  // Skupi sve .html
  const allHtml = [];
  for await (const fp of walk(localPagesRoot)) {
    if (isHtmlFile(fp)) allHtml.push(fp);
  }
  if (allHtml.length === 0) {
    console.warn("Upozorenje: Nema .html datoteka u 'pages/'.");
    process.exit(0);
  }
  if (SORT_INPUT) allHtml.sort((a, b) => a.localeCompare(b));

  // Grupiraj po L1 folderu
  const groups = new Map(); // groupName -> array of absolute paths
  for (const file of allHtml) {
    const g = getTopLevelGroup(file);
    if (INCLUDED_GROUPS.length && !INCLUDED_GROUPS.includes(g)) continue;
    if (EXCLUDED_GROUPS.length && EXCLUDED_GROUPS.includes(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(file);
  }

  if (groups.size === 0) {
    console.warn("Upozorenje: Nakon filtriranja nema stranica za obradu.");
    process.exit(0);
  }

  console.log("Grupe za obradu:", Array.from(groups.keys()).join(", "));

  // Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  try {
    // Obradi svaku grupu -> jedan PDF
    for (const [groupNameRaw, files] of groups) {
      const groupName = sanitizeName(groupNameRaw);
      const outFile = path.join(outRootDir, `${CURRENT_PROJECT}__${groupName}.pdf`);
      console.log(`\n=== Grupa: ${groupNameRaw} (${files.length} stranica) → ${outFile}`);

      const finalDoc = await PDFDocument.create();

      for (let i = 0; i < files.length; i++) {
        // Recikliraj tab periodički radi stabilnosti
        if (i > 0 && i % PAGES_PER_TAB === 0) {
          try { await page.close(); } catch {}
          page = await browser.newPage();
          page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
        }

        const htmlAbs = files[i];
        const urlPrimary = toExtensionlessPublicUrl(htmlAbs);
        const urlFallback = toHtmlPublicUrl(htmlAbs);

        console.log(`  [${i + 1}/${files.length}] ${urlPrimary}`);

        let loaded = false;
        try {
          const resp = await page.goto(urlPrimary, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
          if (!resp || !resp.ok()) throw new Error(`HTTP status ${resp?.status?.() ?? "unknown"} on clean URL`);
          loaded = true;
        } catch (e1) {
          console.warn(`     ⚠ Clean URL nije uspio, probam .html: ${e1?.message || e1}`);
          try {
            const resp2 = await page.goto(urlFallback, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
            if (!resp2 || !resp2.ok()) throw new Error(`HTTP status ${resp2?.status?.() ?? "unknown"} on .html URL`);
            loaded = true;
          } catch (e2) {
            console.error("     ✖ Greška (oba URL-a):", e2?.stack || e2?.message || String(e2));
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
          console.error("     ✖ Greška tijekom render/merge:", err?.stack || err?.message || String(err));
        }
      }

      const finalBytes = await finalDoc.save();
      await fsp.writeFile(outFile, finalBytes);
      console.log(`   ✔ Spremio PDF grupe: ${outFile}`);
    }
  } finally {
    try { await page.close(); } catch {}
    await browser.close().catch(() => {});
  }

  console.log("\nGotovo — svi L1 PDF-ovi generirani.");
})().catch((e) => {
  console.error("Fatal error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
