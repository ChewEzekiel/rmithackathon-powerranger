// Drive the debug Chrome tab like a person would: navigate, click by visible text, type, wait.
// usage (module): import { tab } from "./drive.mjs"; const t = await tab(9222, "http://localhost:3000");
export async function tab(port, prefix) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  let t = list.find((x) => x.type === "page" && x.url.startsWith(prefix));
  if (!t) t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(prefix)}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  // A call can go unanswered when its page context dies mid-navigation: give up after 8 s instead of hanging.
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.delete(i)) res({}); }, 8000);
  });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const api = {
    id: t.id, send, evaluate, sleep,
    async goto(url, settle = 1500) { await send("Page.navigate", { url }); await sleep(settle); await api.waitFor("document.readyState === 'complete'"); },
    async waitFor(cond, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(`!!(${cond})`)) return true; await sleep(200); } throw new Error(`timeout: ${cond}`); },
    async waitText(text, timeout = 20000) { return api.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, timeout); },
    // Smooth-scroll the element into view, pause like a human, then click it.
    async click(text, { exact = false, pause = 700, timeout = 15000 } = {}) {
      const end = Date.now() + timeout;
      let found = false;
      while (!found && Date.now() < end) { found = await api._mark(text, exact); if (!found) await sleep(250); }
      if (!found) throw new Error(`no clickable "${text}"`);
      await sleep(pause);
      await evaluate(`(() => { const e = window.__clickTarget; e.style.outline = ''; e.click(); })()`);
    },
    async _mark(text, exact) {
      return evaluate(`(() => { const els = [...document.querySelectorAll('button, a')].filter(e => !e.disabled && e.offsetParent !== null);
        const e = els.find(e => ${exact ? "e.innerText.trim() === " + JSON.stringify(text) : "e.innerText.trim().includes(" + JSON.stringify(text) + ")"});
        if (!e) return false; e.scrollIntoView({ behavior: 'smooth', block: 'center' }); window.__clickTarget = e; e.style.outline = '3px solid #43c29a'; e.style.outlineOffset = '3px'; return true; })()`);
    },
    // Type into the n-th visible input/textarea/select (React-safe value setter), letter by letter.
    async type(selector, text, { perChar = 18 } = {}) {
      for (let i = 1; i <= text.length; i++) {
        await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(text)}.slice(0, ${i})); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(perChar);
      }
    },
    async scroll(y, pause = 900) { await evaluate(`window.scrollTo({ top: ${y}, behavior: 'smooth' })`); await sleep(pause); },
    async shot(file) { const { result } = await send("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(file, Buffer.from(result.data, "base64")); },
    close() { ws.close(); },
  };
  return api;
}
