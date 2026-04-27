"""
pumpkin_reactor.py - sends a random comment message whenever Pumpkin sends something
"""
import time, random, json
from playwright.sync_api import sync_playwright

DM_URL     = "https://www.instagram.com/direct/t/17846556129068988/"
THREAD_ID  = "17846556129068988"
DEBUG_PORT = 9222
CHECK_INTERVAL = 30
INITIAL_COUNT  = 10
SEND_DELAY     = (4, 9)

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

def api_get_items(page, cursor=None):
    url = f"https://www.instagram.com/api/v1/direct_v2/threads/{THREAD_ID}/?limit=20"
    if cursor:
        url += f"&cursor={cursor}"
    raw = page.evaluate(f"""async () => {{
        try {{
            const r = await fetch("{url}", {{headers:{{"x-ig-app-id":"936619743392459"}}}});
            return await r.text();
        }} catch(e) {{ return "ERR:"+e; }}
    }}""")
    if not raw or raw.startswith("ERR:"):
        return [], None
    try:
        d = json.loads(raw)
        t = d.get("thread", {})
        return t.get("items", []), t.get("oldest_cursor")
    except:
        return [], None

def my_user_id(page):
    uid = page.evaluate("""() => {
        for (const c of document.cookie.split(';')) {
            const t = c.trim();
            if (t.startsWith('ds_user_id=')) return t.split('=')[1];
        }
        return null;
    }""")
    return str(uid).strip() if uid else None

def type_and_send(page, text):
    """Click the message box, type, and hit Enter."""
    try:
        for sel in ['div[aria-label="Message"]', 'div[role="textbox"]']:
            if page.locator(sel).count() > 0:
                box = page.locator(sel).last
                box.click()
                time.sleep(0.3)
                # Use keyboard typing so emojis work
                page.keyboard.type(text)
                time.sleep(0.4)
                page.keyboard.press("Enter")
                log(f"  ✓ {text[:70]}")
                time.sleep(random.uniform(*SEND_DELAY))
                return True
        log("  ✗ Message box not found")
        return False
    except Exception as e:
        log(f"  ✗ {e}")
        return False

def main():
    log("🎃 Starting...")
    with sync_playwright() as p:
        # Retry connection a few times
        browser = None
        for attempt in range(6):
            try:
                log(f"Connecting to Opera GX (attempt {attempt+1}/6)...")
                browser = p.chromium.connect_over_cdp(f"http://localhost:{DEBUG_PORT}", timeout=10000)
                break
            except Exception as e:
                log(f"  Failed: {e}")
                if attempt < 5: time.sleep(3)

        if not browser:
            log("✗ Could not connect. Run launch_opera.bat first and wait for 'SUCCESS'.")
            input("Press Enter to exit..."); return

        log("✓ Connected!")
        context = browser.contexts[0]

        page = next((pg for pg in context.pages if "instagram.com" in pg.url), None)
        if not page:
            page = context.new_page()

        page.bring_to_front()
        page.goto(DM_URL, wait_until="domcontentloaded")
        time.sleep(5)

        # Get my ID so we only reply to Pumpkin's messages, not our own
        me = my_user_id(page)
        log(f"My user ID: {me}")

        # Load recent messages
        items, _ = api_get_items(page)
        if not items:
            log("✗ Could not load messages. Make sure you're logged in to Instagram in Opera GX.")
            input("Press Enter to exit..."); return

        log(f"Loaded {len(items)} recent messages.")

        # Collect last INITIAL_COUNT messages NOT from me
        reacted = set()
        to_reply = []
        cursor = None
        all_items = list(items)

        # Page back until we have enough
        while len([x for x in all_items if str(x.get("user_id","")) != me]) < INITIAL_COUNT:
            _, cursor = api_get_items(page, cursor)  # get cursor from first call
            break  # one page is enough for now

        for item in all_items:
            if str(item.get("user_id", "")) != me:
                to_reply.append(item.get("item_id"))

        to_reply = [x for x in to_reply if x][:INITIAL_COUNT]
        log(f"Replying to last {len(to_reply)} message(s) from Pumpkin...")

        for iid in to_reply:
            log(f"  → message {iid}")
            if type_and_send(page, random.choice(MESSAGES)):
                reacted.add(iid)

        log(f"✓ Done. Sent {len(reacted)} replies.")
        log(f"Watching for new messages every {CHECK_INTERVAL}s... (Ctrl+C to stop)")

        while True:
            time.sleep(CHECK_INTERVAL)
            try:
                new_items, _ = api_get_items(page)
                sent = 0
                for item in new_items:
                    iid = item.get("item_id", "")
                    if not iid or iid in reacted:
                        continue
                    if str(item.get("user_id", "")) == me:
                        reacted.add(iid)  # skip our own messages silently
                        continue
                    log(f"🆕 New message from Pumpkin!")
                    if type_and_send(page, random.choice(MESSAGES)):
                        reacted.add(iid)
                        sent += 1
                if sent == 0:
                    log("No new messages. Watching...")
            except KeyboardInterrupt:
                log("Stopped. Bye! 🎃"); break
            except Exception as e:
                log(f"Error: {e}")

if __name__ == "__main__":
    main()
