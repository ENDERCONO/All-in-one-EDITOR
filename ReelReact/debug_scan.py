import time, traceback
from playwright.sync_api import sync_playwright

DM_URL     = "https://www.instagram.com/direct/t/17846556129068988/"
DEBUG_PORT = 9222
OUTPUT_FILE = "debug_output.txt"

lines = []
def log(msg): print(str(msg), flush=True); lines.append(str(msg))
def save():
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f: f.write("\n".join(lines))
    print(f"\n>>> Saved to {OUTPUT_FILE} <<<", flush=True)

try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://localhost:{DEBUG_PORT}")
        context = browser.contexts[0]
        page = next((pg for pg in context.pages if "instagram.com" in pg.url), None)
        if page is None: page = context.new_page()
        page.bring_to_front()
        page.goto(DM_URL, timeout=30000)
        log("Waiting 8s for thread to fully render...")
        time.sleep(8)

        # --- scroll the thread container ---
        log("\n=== TRYING TO SCROLL THREAD ===")
        result = page.evaluate("""() => {
            let scrolled = [];
            document.querySelectorAll('*').forEach(el => {
                try {
                    const s = window.getComputedStyle(el);
                    if ((s.overflow+s.overflowY).match(/scroll|auto/) && el.scrollHeight > el.clientHeight+100) {
                        el.scrollTop = 0;
                        scrolled.push(el.tagName + ' role=' + el.getAttribute('role') + ' scrollH=' + el.scrollHeight);
                    }
                } catch(e){}
            });
            return scrolled;
        }""")
        for r in result: log(f"  Scrolled: {r}")
        time.sleep(3)

        # --- video elements ---
        log("\n=== VIDEO ELEMENTS ===")
        videos = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('video')).map(v => ({
                src: v.src || v.currentSrc || '',
                poster: v.poster || '',
                parent: v.parentElement ? v.parentElement.tagName + ' ' + v.parentElement.className.toString().slice(0,80) : ''
            }));
        }""")
        for v in videos: log(f"  VIDEO src={v['src'][:80]} poster={v['poster'][:60]}")

        # --- aria-labels on everything ---
        log("\n=== ARIA-LABELS ===")
        arias = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('[aria-label]'))
                .map(el => el.tagName + ': ' + el.getAttribute('aria-label'))
                .filter(s => s.length < 200);
        }""")
        for a in arias: log(f"  {a}")

        # --- data-testid attributes ---
        log("\n=== DATA-TESTID ===")
        testids = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('[data-testid]'))
                .map(el => el.tagName + ': ' + el.getAttribute('data-testid'));
        }""")
        for t in testids: log(f"  {t}")

        # --- all imgs and their src ---
        log("\n=== IMAGES (first 30) ===")
        imgs = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('img')).map(i => i.src || i.getAttribute('src') || '').filter(Boolean);
        }""")
        for img in imgs[:30]: log(f"  IMG: {img[:120]}")

        # --- elements that contain text matching reel/video ---
        log("\n=== ELEMENTS WITH TEXT 'reel' or 'video' ===")
        reel_text = page.evaluate("""() => {
            const r = [];
            document.querySelectorAll('*').forEach(el => {
                try {
                    if (el.children.length === 0) {
                        const t = el.textContent || '';
                        if (t.toLowerCase().includes('reel') || t.toLowerCase().includes('video')) {
                            r.push(el.tagName + ': ' + t.slice(0,100));
                        }
                    }
                } catch(e) {}
            });
            return r.slice(0, 30);
        }""")
        for r in reel_text: log(f"  {r}")

        # --- dump all hrefs again after scroll ---
        log("\n=== ALL HREFS AFTER SCROLL ===")
        hrefs = page.evaluate("()=>Array.from(document.querySelectorAll('[href]')).map(a=>a.getAttribute('href')).filter(Boolean)")
        for h in hrefs: log(f"  {h}")

        # --- dump all src attributes ---
        log("\n=== ALL SRC ATTRIBUTES ===")
        srcs = page.evaluate("()=>Array.from(document.querySelectorAll('[src]')).map(a=>a.getAttribute('src')).filter(s=>s&&!s.startsWith('data:'))")
        for s in srcs[:40]: log(f"  {s[:120]}")

        log("\nDONE.")
        save()

except Exception as e:
    log(f"\nCRASHED: {e}")
    log(traceback.format_exc())
    save()

input("\nPress Enter to exit...")
