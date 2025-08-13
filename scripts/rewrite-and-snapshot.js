
// Node 20+
// npm i puppeteer fs-extra
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";

const RAW_DIR  = "raw";   // ovdje rsync-amo gh-pages iz izvornika
const OUT_DIR  = "site";  // finalni statički izlaz

const PROJECTS = [
  { repo: "uvod",      name: "Uvod",      base: "https://hjftm.github.io/uvod" },
  { repo: "bosna",     name: "Bosna",     base: "https://hjftm.github.io/bosna" },
  { repo: "stupnik",   name: "Stupnik",   base: "https://hjftm.github.io/stupnik" },
  { repo: "dubrovnik", name: "Dubrovnik", base: "https://hjftm.github.io/dubrovnik" },
];

const ROOTS = ["pages", "ENTITET", ""]; // "" pokriva i /index.html na rootu
const NAV_TIMEOUT = 90_000;
const SETTLE_MS = 600;

function listIndexDirs(rootDir) {
  const res = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let hasIndex = false;
    for (const e of entries) if (e.isFile() && e.name.toLowerCase() === "index.html") hasIndex = true;
    if (hasIndex) res.push(dir);
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name));
  };
  if (fs.existsSync(rootDir)) walk(rootDir);
  return res;
}

function relPath(dirAbs, siteRootAbs) {
  let rel = path.relative(siteRootAbs, dirAbs).split(path.sep).join("/");
  if (!rel.startsWith("/")) rel = "/" + rel;
  if (rel === "/") rel = "/";
  return rel; // npr. /pages/ENTITET/obitelj/Ilarić
}

function publicUrl(base, rel) {
  const u = new URL(base);
  const joined = (u.pathname.replace(/\/$/, "") + rel).replace(/\/{2,}/g, "/");
  u.pathname = joined.endsWith("/") ? joined : joined + "/";
  u.search = ""; u.hash = "";
  return u.toString();
}

async function singlefile(page) {
  await page.addScriptTag({ url: "https://unpkg.com/single-file-core@1.2.42/single-file-core.bundle.js" });
  const { content } = await page.evaluate(async () => {
    const r = await window.singlefile.getPageData({
      loadDeferredImages: true,
      loadDeferredImagesMaxIdleTime: 1500,
      removeHiddenElements: false,
      removeUnusedStyles: false,
      compressHTML: false,
      maxResourceSizeEnabled: true,
      maxResourceSize: 80 * 1024 * 1024,
    });
    return { content: r.content };
  });
  return content;
}

// prepiši linkove na /prezime/<Projekt>/...
function rewriteLinks(html, projectName) {
  const reps = [
    { from: /https?:\/\/hjftm\.github\.io\/uvod/gi,      to: "/prezime/Uvod" },
    { from: /https?:\/\/hjftm\.github\.io\/bosna/gi,     to: "/prezime/Bosna" },
    { from: /https?:\/\/hjftm\.github\.io\/stupnik/gi,   to: "/prezime/Stupnik" },
    { from: /https?:\/\/hjftm\.github\.io\/dubrovnik/gi, to: "/prezime/Dubrovnik" },
    { from: /href="\/pages/gi, to: `href="/prezime/${projectName}/pages` },
    { from: /src="\/pages/gi,  to: `src="/prezime/${projectName}/pages`  },
  ];
  return reps.reduce((acc, r) => acc.replace(r.from, r.to), html);
}

async function outFile(projectName, rel) {
  const out = path.join(OUT_DIR, projectName, rel.replace(/^\//, ""), "index.html");
  await fs.ensureDir(path.dirname(out));
  return out;
}

async function snapshotProject(browser, { repo, name, base }) {
  const siteRoot = path.resolve(RAW_DIR, name);
  const scanRoots = ROOTS.map(r => path.join(siteRoot, r)).filter(fs.existsSync);

  const dirs = scanRoots.flatMap(d => listIndexDirs(d));
  const targets = dirs.map(d => {
    const rel = relPath(d, siteRoot);
    const url = publicUrl(base, rel);
    return { rel, url };
  });

  console.log(`→ ${name}: ${targets.length} stranica`);

  const page = await browser.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  for (const { rel, url } of targets) {
    try {
      await page.goto(url, { waitUntil: "networkidle0" });
      await page.waitForTimeout(SETTLE_MS);
      let html = await singlefile(page);
      html = rewriteLinks(html, name);
      const of = await outFile(name, rel);
      await fs.writeFile(of, html, "utf8");
      console.log("✔", name, rel);
    } catch (e) {
      console.warn("⚠️", name, rel, url, e?.message || e);
    }
  }

  await page.close();
}

(async () => {
  await fs.emptyDir(OUT_DIR);
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox","--disable-setuid-sandbox"] });
  try {
    for (const p of PROJECTS) await snapshotProject(browser, p);
  } finally { await browser.close(); }
  console.log("Done →", OUT_DIR);
})();
