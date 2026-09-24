"""
浏览器端测试：在真实 Chromium 中渲染每个用例的修复前 / 修复后，并截图到 test/browser/shots/。
用法（仓库根目录）：
    npm install
    python3 -m http.server 8765 &
    pip install playwright && playwright install chromium
    python3 test/browser/run.py
"""
import asyncio, json, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
URL =  'http://localhost:8765/test/browser/test.html'

async def main():
    os.makedirs(SHOTS, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 700, 'height': 900}, device_scale_factor=2)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('window.__done === true', timeout=120000)
        results = await page.evaluate('window.__results')
        for r in results:
            for side in ('before', 'after'):
                await page.locator(f'#{side}-{r["id"]}').screenshot(path=os.path.join(SHOTS, f'{r["id"]}_{side}.png'))
            state = 'OK' if r['after']['ok'] else ('DEGRADED' if r['after'].get('degraded') else 'FAIL')
            print(f'{r["id"]:5} before={"OK" if r["before"]["ok"] else "FAIL":4} after={state:8} counts={r["counts"]}')
        json.dump(results, open(os.path.join(HERE, 'results.json'), 'w'), ensure_ascii=False, indent=1)
        if errors: print('page errors:', errors)
        await browser.close()

asyncio.run(main())
