"""
debug_api.py - tests the Instagram API call and saves raw response
"""
import time, json
from playwright.sync_api import sync_playwright

DM_URL    = "https://www.instagram.com/direct/t/17846556129068988/"
THREAD_ID = "17846556129068988"
DEBUG_PORT = 9222
OUT = "api_debug.txt"

lines = []
def log(msg): print(str(msg), flush=True); lines.append(str(msg))
def save(): open(OUT,"w",encoding="utf-8").write("\n".join(lines)); print(f">>> Saved to {OUT}")

try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://localhost:{DEBUG_PORT}", timeout=10000)
        context = browser.contexts[0]
        page = next((pg for pg in context.pages if "instagram.com" in pg.url), None)
        if not page:
            page = context.new_page()

        page.bring_to_front()
        page.goto(DM_URL, wait_until="networkidle", timeout=30000)
        time.sleep(8)
        log(f"Page URL: {page.url}")

        # Get all cookies
        log("\n=== COOKIES ===")
        cookies = context.cookies()
        for c in cookies:
            if "instagram" in c.get("domain",""):
                log(f"  {c['name']} = {str(c['value'])[:60]}")

        # Try to get CSRF token
        csrf = page.evaluate("""() => {
            for (const c of document.cookie.split(';')) {
                if (c.trim().startsWith('csrftoken=')) return c.trim().split('=')[1];
            }
            return null;
        }""")
        log(f"\nCSRF token: {csrf}")

        # Try API call WITH csrf token
        log("\n=== API CALL WITH CSRF ===")
        result = page.evaluate(f"""async () => {{
            const csrf = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('csrftoken='));
            const token = csrf ? csrf.split('=')[1] : '';
            const r = await fetch("https://www.instagram.com/api/v1/direct_v2/threads/{THREAD_ID}/?limit=5", {{
                headers: {{
                    "x-ig-app-id": "936619743392459",
                    "x-csrftoken": token,
                    "accept": "*/*",
                }}
            }});
            return {{status: r.status, body: await r.text()}};
        }}""")
        log(f"Status: {result.get('status')}")
        log(f"Body (first 500): {result.get('body','')[:500]}")

        # Also try the graphql endpoint
        log("\n=== TRYING GRAPHQL THREAD QUERY ===")
        result2 = page.evaluate(f"""async () => {{
            const r = await fetch("https://www.instagram.com/api/v1/direct_v2/inbox/?limit=5", {{
                headers: {{"x-ig-app-id": "936619743392459"}}
            }});
            return {{status: r.status, body: (await r.text()).slice(0,500)}};
        }}""")
        log(f"Inbox status: {result2.get('status')}")
        log(f"Inbox body: {result2.get('body','')[:500]}")

        save()

except Exception as e:
    import traceback
    log(f"CRASH: {e}\n{traceback.format_exc()}")
    save()

input("\nPress Enter to exit...")
