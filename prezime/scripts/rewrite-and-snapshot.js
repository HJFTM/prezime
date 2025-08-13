name: Build prezime from existing gh-pages (clean run)

on:
  workflow_dispatch:
  schedule:
    - cron: "10 3 * * *"   # svaki dan u 03:10 UTC

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      # 1) Checkout default branch (npr. main) s cijelom poviješću
      - name: Checkout default branch
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # 2) Ako gh-pages ne postoji, kreiraj je (s praznim index.html)
      - name: Ensure gh-pages branch exists
        run: |
          if ! git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
            echo "gh-pages not found; creating…"
            git switch --orphan gh-pages
            git rm -rf . || true
            echo "<!doctype html><meta charset=utf-8><title>prezime</title>" > index.html
            git -c user.name="GitHub Action" -c user.email="action@github.com" add -A
            git -c user.name="GitHub Action" -c user.email="action@github.com" commit -m "Initialize gh-pages"
            git push origin gh-pages
            git switch -
          else
            echo "gh-pages exists."
          fi

      # 3) Prebaci se na gh-pages granu
      - name: Checkout gh-pages
        uses: actions/checkout@v4
        with:
          ref: gh-pages

      # 4) POTPUNO OČISTI gh-pages (svaki run kreće od nule)
      - name: Clean gh-pages working tree
        run: |
          shopt -s dotglob
          for p in *; do
            if [ "$p" != ".git" ]; then
              rm -rf "$p"
            fi
          done
          mkdir -p raw site

      # 5) Kloniraj izvorne gh-pages grane u raw/
      #    Ako su privatni repoji, zamijeni URL s PAT: https://x-access-token:${{ secrets.SOURCE_PAT }}@github.com/HJFTM/uvod.git
      - name: Fetch source gh-pages
        run: |
          git clone --depth=1 --branch gh-pages https://github.com/HJFTM/uvod.git      raw/Uvod
          git clone --depth=1 --branch gh-pages https://github.com/HJFTM/bosna.git     raw/Bosna
          git clone --depth=1 --branch gh-pages https://github.com/HJFTM/stupnik.git   raw/Stupnik
          git clone --depth=1 --branch gh-pages https://github.com/HJFTM/dubrovnik.git raw/Dubrovnik

      # 6) Node okruženje
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      # 7) Ovisnosti za snapshot
      - name: Install deps
        run: |
          npm install puppeteer fs-extra

      # 8) Pokreni render + rewrite linkova
      - name: Run rewrite + snapshot
        run: node scripts/rewrite-and-snapshot.js

      # 9) Objavi site/ u root gh-pages (čisti publish)
      - name: Publish site to gh-pages root
        run: |
          rsync -av --delete site/ ./

      # 10) Commit & push
      - name: Commit & push
        run: |
          git config user.name "GitHub Action"
          git config user.email "action@github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "No changes."
          else
            git commit -m "Rebuild prezime snapshots $(date -u +%F_%T)"
            git push origin gh-pages
          fi
