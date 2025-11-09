/**
 * Pretvori ugniježđeni menu.json u ravnu listu pathova
 * @param {Object} menuJson - objekt iz menu.json (već parsiran iz datoteke)
 * @returns {string[]} lista pathova (npr. ["/pages/ROD/prezime/Bosna", "/pages/ROD/generacije/Bosna", ...])
 */
export function extractPathsFromMenu(menuJson) {
  const paths = [];

  function traverse(pages) {
    if (!Array.isArray(pages)) return;
    for (const item of pages) {
      if (item.path) paths.push(item.path);
      if (item.pages) traverse(item.pages);
    }
  }

  // podrška za strukturu: { project: "...", pages: [...] }
  if (menuJson.pages) traverse(menuJson.pages);
  return paths;
}
