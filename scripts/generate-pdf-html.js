// FILE: main/scripts/generate-pdf-html.js
// Run: node main/scripts/generate-pdf-html.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

// ---------- Config iz ENV-a ----------
const CURRENT_PROJECT =
  process.env.CURRENT_PROJECT ??
  (process.env.GITHUB_REPOSITORY?.split("/")?.pop() ?? "uvod");

// Podrazumijevani host za GitHub Pages; možeš prebrisati s PUBLIC_HOST
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? "https://hjftm.github.io";

// Gdje je checkout-an gh-pages branch u jobu (vidi workflow)
const GH_PAGES_DIR = process.env.GH_PAGES_DIR ?? "gh-pages";

// Relativna putanja kataloga s generiranim stranicama
const PAGES_DIR = process.env.PAGES_DIR ?? "pages";

// Opcionalni query koji želimo dodati na sve URL-ove (npr. "?ROD=Bosna")
const APPEND_QUERY = process.env.APPEND_QUERY ?? "";

// PDF postavke
const PDF_FORMAT = process.env.PDF_FORMAT ?? "A4";
const PDF_PRINT_BACKGROUND = (process.env.PDF_PRINT_BACKGROUND ?? "true") === "true";
const PDF_MARGIN = {
  top: process.env.PDF_MARGIN_TOP ?? "10mm",
  right: process.env.PDF_MARGIN_RIGHT ?? "10mm",
  bottom: process.env.PDF_MARGIN_BOTTOM ?? "12mm",
  left: process.env.PDF_MARGIN_LEFT ?? "10mm",
};

// Timeout za page.goto
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 120000);

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

function toPublicUrl(absoluteHtmlPath) {
  // npr. absoluteHtmlPath = /.../gh-pages/pages/rodovi/bosna.html
  // rel = pages/rodovi/bosna.html
  const rel = path.relative(absoluteGhPagesDir, absoluteHtmlPath).split(path.sep).join("/"); // normalize
  let url = `${baseUrl}/${rel}`;
  if (APPEND_QUERY) {
    // Ako već postoji upitnik, dodaj s '&', inače s '?'
    url += (url.includes("?") ? "&" : "?") + APPEND_QUERY.replace(/^\?/, "");
  }
  return url;
}

function toPdfOutputPath(absoluteHtmlPath) {
  const rel = path.relative(absoluteGhPagesDir, absoluteHtmlPath); // e.g. "pages/rodovi/bosna.html"
  const relPdf = rel.replace(/\.html?$/i, ".pdf");                 // -> "pages/rodovi/bosna.pdf"
  return path.join(absoluteGhPagesDir, relPdf);
}

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
}

// ---------- Main ----------
(async () => {
  console.log("=== generate-pdf-html.js ===");
  console.log("Project           :", CURRENT_PROJECT);
  console.log("PUBLIC_HOST       :", PUBLIC_HOST);
  console.log("GH_PAGES_DIR      :", absoluteGhPagesDir);
  console.log("PAGES_DIR         :", localPagesRoot);
  console.log("APPEND_QUERY      :", APPEND_QUERY || "(none)");
  console.log("PDF format/margin :", PDF_FORMAT, PDF_MARGIN);

  // 1) Provjere
  if (!fs.existsSync(absoluteGhPagesDir)) {
    console.error(`Greška: GH_PAGES_DIR ne postoji: ${absoluteGhPagesDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(localPagesRoot)) {
    console.error(`Greška: PAGES_DIR ne postoji: ${localPagesRoot}`);
    process.exit(2);
  }

  // 2) Skupi sve .html u pages/
  const htmlFiles = [];
  for await (const fp of walk(localPagesRoot)) {
    if (isHtmlFile(fp)) htmlFiles.push(fp);
  }

  if (htmlFiles.length === 0) {
    console.warn("Upozorenje: Nema .html datoteka u 'pages/'.");
    process.exit(0);
  }

  console.log(`Nađeno HTML datoteka: ${htmlFiles.length}`);

  // 3) Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (let i = 0; i < htmlFiles.length; i++) {
      const htmlAbs = htmlFiles[i];
      const url = toPublicUrl(htmlAbs);
      const outPdf = toPdfOutputPath(htmlAbs);

      console.log(`[${i + 1}/${htmlFiles.length}] PDF ->`, url);
      const page = await browser.newPage();
      try {
        page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

        // Stabilniji network idle za dinamične stranice
        await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });

        // Po želji: kratka pauza (npr. da se stilovi/render dovrše)
        await page.waitForTimeout(500);

        await ensureDirForFile(outPdf);
        await page.pdf({
          path: outPdf,
          format: PDF_FORMAT,
          printBackground: PDF_PRINT_BACKGROUND,
          margin: PDF_MARGIN,
        });

        console.log("   ✔ Spremio:", path.relative(absoluteGhPagesDir, outPdf));
      } catch (err) {
        console.error("   ✖ Greška za URL:", url);
        console.error(err?.stack || err?.message || String(err));
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log("Gotovo.");
})().catch((e) => {
  console.error("Fatal error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
