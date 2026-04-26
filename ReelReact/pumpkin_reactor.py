"""
pumpkin_reactor.py
Watches for new messages from Pumpkin in the DM thread and replies
with a random message from the pool. Uses Instagram's internal API
via the browser's existing login session.
"""
import time, random, json, traceback
from playwright.sync_api import sync_playwright

DM_URL     = "https://www.instagram.com/direct/t/17846556129068988/"
THREAD_ID  = "17846556129068988"
DEBUG_PORT = 9222
CHECK_INTERVAL  = 30   # seconds between checks
INITIAL_COUNT   = 10   # reply to this many past messages on first run
SEND_DELAY      = (4, 9)

MESSAGES = [
    "lmaooo this is actually hilarious 😭",
    "ok but why is this so good",
    "STOP I'm crying 💀",
    "bro this sent me 😂😂",
    "not me watching this 5 times already",
    "the accuracy hurts 😭😭",
    "I CANNOT with this reel rn",
    "ok this one goes crazy",
    "literally same energy every day lol",
    "why is this so relatable 💀",
    "screaming at this ngl",
    "this is sending me to another dimension",
    "bro I felt this in my soul",
    "ok legends only 🫡",
    "THIS IS SO FUNNY omg",
    "not the accuracy 😭😭😭",
    "I showed my friend and they said same thing lmao",
    "this is art. unironically.",
    "why did I laugh so hard at this",
    "ok ok ok this is actually it",
    "LMAO no bc why is this me",
    "this goes absolutely hard 🔥",
    "I have rewatched this too many times",
    "crying laughing rn fr",
    "this is the content I needed today",
    "bro I sent this to like 10 people 💀",
    "not me pausing to process this",
    "the way this hit different today",
    "ok you need to stop finding these 😭",
    "I'm weak rn lmaoo",
    "this is genuinely so good",
    "bro the ending got me 💀💀",
    "HAHAHAHA I'm dead",
    "why does this always come at the right time",
    "ok this is iconic fr fr",
    "I actually spat out my drink wtf",
    "not me losing it over a reel again",
    "this is too real 😭",
    "the way I immediately sent this lmao",
    "this whole thing is a masterpiece",
    "bro I felt personally attacked",
    "THE ACCURACY omg 💀",
    "ok I watched this like 8 times already",
    "this is the funniest thing I've seen today",
    "why am I like this 😭😭",
    "I'm not ok after watching this lmaooo",
    "screaming crying throwing up (affectionate)",
    "not the plot twist at the end 💀",
    "ok that was actually genius",
    "the way I said 'same' out loud",
    "this is so unhinged I love it",
    "bro I need a moment after this one",
    "ok I'm sending this to everyone I know",
    "this reel found me at the right time fr",
    "the vibes are immaculate 🔥",
    "why does this always go so hard",
    "I cannot explain why this is so funny to me but it is",
    "this is comedy gold and I will not elaborate",
    "bro the timing on this 💀💀",
    "ok I'm howling rn",
    "genuinely one of the best ones yet",
    "the way my brain just said 'same'",
    "this is unreal lmaooo",
    "ok but fr why is this so good",
    "I should not have watched this in public 😭",
    "the accuracy is actually scary",
    "bro this cured my bad mood ngl",
    "why are you like this (respectfully) 💀",
    "not the title making it 10x funnier",
    "I'm wheezing rn I can't",
    "ok that actually got me good 😂",
    "this is sending me straight to therapy 💀",
    "bro I felt seen and attacked simultaneously",
    "why is the audio perfect for this",
    "lmaooo I'm deceased",
    "the way I cackled at this",
    "this is genuinely hilarious I'm not joking",
    "ok but the execution is *chef's kiss*",
    "I need everyone I know to see this",
    "this is so chaotic and I love it 💀",
    "bro why did the ending do that to me",
    "not me giggling like an idiot at my phone",
    "this is the funniest thing this week honestly",
    "the way I physically reacted to this 😭",
    "I've watched this 3 times and it's still funny",
    "ok this is genuinely elite content",
    "bro the precision of this reel 💀💀",
    "I'm going to be thinking about this all day",
    "not the way I said 'oh no' out loud",
    "this is unhinged content and I respect it",
    "the vibes shifted and I'm here for it 🔥",
    "why does this speak to me on a spiritual level",
    "bro I'm not ok rn 😭😭",
    "this one got me actually laughing out loud",
    "I want to show this to my ancestors",
    "ok the audacity of this reel 💀",
    "this is so real it hurts lmaooo",
    "the way this made my whole day better",
    "bro this is elite tier content fr",
    "I'm not accepting any criticism of this reel",
]

def log(msg): print(f"[bot] {msg}", flush=True)

def get_messages(page, cursor=None):
    """Fetch thread messages via Instagram's internal API using browser cookies."""
    url = f"https://www.instagram.com/api/v1/direct_v2/threads/{THREAD_ID}/?limit=20"
    if cursor:
        url += f"&cursor={cursor}"
    raw = page.evaluate(f"""async () => {{
        try {{
            const r = await fetch("{url}", {{headers: {{"x-ig-app-id": "936619743392459"}}}});
            return await r.text();
        }} catch(e) {{ return "ERR:" + e; }}
    }}""")
    if not raw or raw.startswith("ERR:"):
        log(f"  API error: {raw}")
        return [], None
    try:
        data = json.loads(raw)
        thread = data.get("thread", {})
        return thread.get("items", []), thread.get("oldest_cursor")
    except:
        log(f"  Parse error. Raw: {raw[:200]}")
        return [], None

def get_pumpkin_message_ids(page, limit=20):
    """Get the last `limit` message IDs sent by pumpkin in the thread."""
    all_ids = []
    seen = set()
    cursor = None
    for _ in range(15):
        items, cursor = get_messages(page, cursor)
        if not items:
            break
        for item in items:
            sender = item.get("user_id") or (item.get("user", {}) or {}).get("pk", "")
            iid = item.get("item_id", "")
            itype = item.get("item_type", "")
            # Include any message from pumpkin that's a reel/media/share
            # Also accept ALL message types so user can see what comes through
            if str(sender) and iid and iid not in seen:
                seen.add(iid)
                all_ids.append({
                    "id": iid,
                    "sender": str(sender),
                    "type": itype,
                    "timestamp": item.get("timestamp", 0),
                })
        if len(all_ids) >= limit:
            break
        if not cursor:
            break
        time.sleep(0.8)
    return all_ids

def send_message(page, text):
    """Send a text message in the DM thread."""
    try:
        for sel in ['div[aria-label="Message"]', 'div[role="textbox"]', 'p[data-lexical-editor="true"]']:
            els = page.locator(sel)
            if els.count() > 0:
                box = els.last
                box.click()
                time.sleep(0.3)
                box.fill(text)
                time.sleep(0.5)
                page.keyboard.press("Enter")
                log(f"  ✓ Sent: {text[:70]}...")
                time.sleep(random.uniform(*SEND_DELAY))
                return True
        log("  ✗ Message box not found")
        return False
    except Exception as e:
        log(f"  ✗ Send error: {e}")
        return False

def connect_with_retry(p, retries=5, wait=4):
    for attempt in range(1, retries + 1):
        try:
            log(f"  Connection attempt {attempt}/{retries}...")
            browser = p.chromium.connect_over_cdp(
                f"http://localhost:{DEBUG_PORT}",
                timeout=15000
            )
            return browser
        except Exception as e:
            log(f"  Failed: {e}")
            if attempt < retries:
                log(f"  Waiting {wait}s before retry...")
                time.sleep(wait)
    return None

def main():
    log("🎃 Pumpkin Reactor starting...")
    log(f"Connecting to Opera GX on localhost:{DEBUG_PORT}...")
    log("(Make sure you ran launch_opera.bat first and saw 'DEBUG PORT IS OPEN')")

    with sync_playwright() as p:
        browser = connect_with_retry(p)
        if not browser:
            log("✗ Could not connect after all retries.")
            log("  Steps to fix:")
            log("  1. Close Opera GX completely (check system tray)")
            log("  2. Run launch_opera.bat")
            log("  3. Wait until you see 'SUCCESS: Debug port is open!'")
            log("  4. Run this exe")
            input("\nPress Enter to exit..."); return

        log("✓ Connected to Opera GX!")
        context = browser.contexts[0]

        page = next((pg for pg in context.pages if "instagram.com" in pg.url), None)
        if page is None:
            page = context.new_page()

        page.bring_to_front()
        log("Opening DM thread...")
        page.goto(DM_URL, wait_until="domcontentloaded")
        time.sleep(5)

        if "login" in page.url or page.locator('input[name="username"]').count() > 0:
            log("⚠  Please log in to Instagram in the browser (2 min)...")
            try:
                page.wait_for_url("https://www.instagram.com/**", timeout=120_000)
                time.sleep(3)
                page.goto(DM_URL, wait_until="domcontentloaded")
                time.sleep(4)
            except:
                log("✗ Login timed out."); return

        # ── Figure out who Pumpkin is (get her user ID) ───────────────────
        log("Loading thread info to identify Pumpkin's user ID...")
        items, _ = get_messages(page)
        if not items:
            log("⚠  Could not load messages. Are you logged in to Instagram in Opera GX?")
            input("Press Enter to exit..."); return

        # Find pumpkin's user_id (anyone who isn't us — the last sender)
        sender_ids = set()
        for item in items:
            uid = str(item.get("user_id", ""))
            if uid:
                sender_ids.add(uid)
        log(f"Sender IDs in thread: {sender_ids}")

        # Get my own user ID (the one that sent the most recent message or from whoami)
        my_id_raw = page.evaluate("""() => {
            try {
                const cookies = document.cookie.split(';');
                for (const c of cookies) {
                    if (c.trim().startsWith('ds_user_id=')) return c.trim().split('=')[1];
                }
            } catch(e) {}
            return null;
        }""")
        my_id = str(my_id_raw).strip() if my_id_raw else None
        log(f"My user ID from cookie: {my_id}")

        pumpkin_id = None
        for uid in sender_ids:
            if uid != my_id:
                pumpkin_id = uid
                break

        if not pumpkin_id:
            log("⚠  Could not detect Pumpkin's user ID. Will react to ALL messages.")
        else:
            log(f"✓ Pumpkin's user ID: {pumpkin_id}")

        # ── Initial pass: react to last N messages ────────────────────────
        log(f"\nLoading last {INITIAL_COUNT} messages to react to...")
        all_msgs = get_pumpkin_message_ids(page, limit=50)

        # Filter to only pumpkin's messages if we know her ID
        if pumpkin_id:
            pumpkin_msgs = [m for m in all_msgs if m["sender"] == pumpkin_id]
        else:
            pumpkin_msgs = all_msgs

        log(f"Found {len(pumpkin_msgs)} message(s) from Pumpkin.")
        log(f"Message types: {set(m['type'] for m in pumpkin_msgs)}")

        reacted_ids = set()
        targets = pumpkin_msgs[:INITIAL_COUNT]

        for msg in targets:
            log(f"Reacting to message {msg['id']} (type: {msg['type']})")
            if send_message(page, random.choice(MESSAGES)):
                reacted_ids.add(msg["id"])

        log(f"\n✓ Done — reacted to {len(reacted_ids)} message(s).")
        log(f"Watching for new messages every {CHECK_INTERVAL}s... (Ctrl+C to stop)\n")

        # ── Watch loop ─────────────────────────────────────────────────────
        while True:
            time.sleep(CHECK_INTERVAL)
            try:
                items, _ = get_messages(page)
                new_count = 0
                for item in items:
                    uid = str(item.get("user_id", ""))
                    iid = item.get("item_id", "")
                    if not iid or iid in reacted_ids:
                        continue
                    if pumpkin_id and uid != pumpkin_id:
                        continue
                    log(f"🆕 New message from Pumpkin! (type={item.get('item_type')}) Reacting...")
                    if send_message(page, random.choice(MESSAGES)):
                        reacted_ids.add(iid)
                        new_count += 1
                if new_count == 0:
                    log("No new messages. Still watching...")
            except KeyboardInterrupt:
                log("Stopped. Bye! 🎃"); break
            except Exception as e:
                log(f"Watch error: {e}")

if __name__ == "__main__":
    main()
