/**
 * mermaid-render.js —— 前端渲染封装：校验 → 修复 → 渲染 → 降级
 *
 * 依赖：mermaid@11、./fixMermaid.js
 *
 *   import { renderMermaidSafe, hydrateMermaid, createStreamingMermaid } from './mermaid-render.js';
 *   await renderMermaidSafe(el, source);          // 渲染单个图
 *   await hydrateMermaid(container);              // 把 Markdown 渲染出的 ```mermaid 代码块替换成图
 *   const s = createStreamingMermaid(el);         // 流式输出场景
 *   s.update(partialSource); s.update(fullSource, { done: true });
 */
import mermaid from 'mermaid';
import { safeRepairMermaid, createMermaidParser } from './fixMermaid.js';

/* ---------------- 初始化 ---------------- */

let initialized = false;
let reporter = null;

/**
 * 全局初始化，只需调用一次（不调用则首次渲染时按默认配置初始化）
 * @param {object}   options
 * @param {'light'|'dark'|'auto'} [options.theme='auto']
 * @param {Function} [options.onReport]  每次修复/失败时回调，用于埋点上报
 */
export function setupMermaid({ theme = 'auto', onReport, mermaidConfig = {} } = {}) {
  const dark = theme === 'dark'
    || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',                 // 禁用 click 回调和 HTML 标签，防 XSS
    theme: dark ? 'dark' : 'default',
    themeVariables: {
      // 默认主题下柱状图/折线图第一个系列颜色过浅，统一配置色板
      xyChart: { plotColorPalette: '#3346B8, #E07A1F, #1F7A4D, #B42318, #7A3FB8, #0E7C86' },
    },
    ...mermaidConfig,
  });
  reporter = onReport ?? null;
  initialized = true;
}

const parse = createMermaidParser(mermaid);

/* ---------------- 核心：安全渲染 ---------------- */

// mermaid.render 并发调用可能互相干扰，这里串行化
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// 同一段源码只修复/渲染一次（聊天界面重渲染、滚动回看时很常见）
const cache = new Map();
const CACHE_LIMIT = 200;
let seq = 0;

/** 只计算结果，不碰 DOM。返回 { ok, svg?, code, fixes, error? } */
export function compileMermaid(source) {
  if (cache.has(source)) return Promise.resolve(cache.get(source));
  return serial(async () => {
    if (cache.has(source)) return cache.get(source);
    if (!initialized) setupMermaid();

    const repaired = await safeRepairMermaid(source, parse);
    let result;
    if (repaired.ok) {
      const id = `mmd-${Date.now().toString(36)}-${++seq}`;
      try {
        const { svg } = await mermaid.render(id, repaired.code);
        result = { ok: true, svg, code: repaired.code, fixes: repaired.fixes, originalError: repaired.originalError };
      } catch (e) {
        // parse 通过但 render 失败（少数布局问题），清理 mermaid 留在 body 里的临时节点
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        result = { ok: false, code: repaired.code, fixes: repaired.fixes, originalError: repaired.originalError,
                   error: String(e?.message ?? e) };
      }
    } else {
      result = { ok: false, code: source, fixes: repaired.fixes, originalError: repaired.originalError, error: repaired.error };
    }

    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(source, result);
    return result;
  });
}

/**
 * 渲染到元素上；失败时降级为展示源码（带复制按钮）
 * @param {HTMLElement} el
 * @param {string} source    LLM 输出的原始 mermaid 文本（可以带 ```mermaid 围栏）
 * @param {object} [opts]
 * @param {boolean} [opts.keepPreviousOnFail=false]  失败时保留上一次成功的图（流式场景用）
 */
export async function renderMermaidSafe(el, source, { keepPreviousOnFail = false } = {}) {
  const result = await compileMermaid(source);
  paintResult(el, source, result, { keepPreviousOnFail });
  if (!keepPreviousOnFail) report(source, result);
  return result;
}

// 同一段源码只上报一次（重渲染、回看历史消息不会重复计数）
const reported = new Set();
function report(source, result) {
  if (!reporter || reported.has(source) || (result.ok && !result.fixes.length)) return;
  reported.add(source);
  if (reported.size > 1000) reported.delete(reported.values().next().value);
  const { svg, ...rest } = result;
  reporter({ ...rest, source });                 // { ok, code, fixes, originalError, error, source }
}

/** 把 compileMermaid 的结果画到元素上。data-mermaid-state：ok / repaired / fallback / pending */
export function paintResult(el, source, result, { keepPreviousOnFail = false } = {}) {
  if (result.ok) {
    el.innerHTML = result.svg;                   // svg 由 mermaid 在 securityLevel: 'strict' 下生成并经过 DOMPurify
    el.dataset.mermaidState = result.fixes.length ? 'repaired' : 'ok';
  } else if (!keepPreviousOnFail) {
    renderFallback(el, source);
    el.dataset.mermaidState = 'fallback';
  }
  // keepPreviousOnFail：什么都不做，保留上一次成功的图或占位
}

function renderFallback(el, source) {
  el.replaceChildren();
  const tip = document.createElement('div');
  tip.className = 'mermaid-fallback-tip';
  tip.textContent = '图表暂时无法显示，以下是原始代码';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mermaid-fallback-copy';
  btn.textContent = '复制代码';
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(source); btn.textContent = '已复制'; }
    catch { btn.textContent = '复制失败，请手动选择'; }
  };
  const pre = document.createElement('pre');
  pre.className = 'mermaid-fallback-code';
  pre.textContent = source;                      // textContent，不会执行任何 HTML
  el.append(tip, btn, pre);
}

/* ---------------- 调试：不修复，直接渲染原文 ---------------- */

/**
 * 原样渲染（不校验、不修复、不缓存），失败时显示 Mermaid 的报错。
 * 用于调试页面做"修复前 / 修复后"对比；与 renderMermaidSafe 共用串行队列，互不干扰。
 */
export function renderMermaidRaw(el, source) {
  return serial(async () => {
    if (!initialized) setupMermaid();
    const id = `mmd-raw-${Date.now().toString(36)}-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, source);
      el.innerHTML = svg;
      return { ok: true };
    } catch (e) {
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      const error = String(e?.message ?? e);
      const pre = document.createElement('pre');
      pre.className = 'mermaid-raw-error';
      pre.textContent = error.split('\n').slice(0, 6).join('\n');
      el.replaceChildren(pre);
      return { ok: false, error };
    }
  });
}

/* ---------------- Markdown 场景：批量替换代码块 ---------------- */

/**
 * 把容器里 Markdown 渲染出的 <pre><code class="language-mermaid"> 替换为图
 * 适用于 marked / markdown-it / react-markdown 等渲染完成之后调用
 */
export async function hydrateMermaid(root = document) {
  const blocks = root.querySelectorAll('pre > code.language-mermaid, pre > code.lang-mermaid');
  for (const code of blocks) {
    const holder = document.createElement('div');
    holder.className = 'mermaid-block';
    const source = code.textContent;
    code.parentElement.replaceWith(holder);
    await renderMermaidSafe(holder, source);
  }
}

/* ---------------- 流式输出场景 ---------------- */

/**
 * LLM 边生成边展示时使用：
 * - 生成中：防抖尝试渲染，失败不闪烁，保留上一次成功的图；还没有成功过时显示占位
 * - 生成结束（done: true）：做最终渲染，失败则降级展示源码
 */
export function createStreamingMermaid(el, { delay = 400 } = {}) {
  let timer = null;
  let finished = false;
  let version = 0;                               // 只让最新一次结果落到 DOM 上，防止旧结果覆盖新结果
  if (!el.dataset.mermaidState) {
    el.innerHTML = '<div class="mermaid-placeholder">图表生成中…</div>';
    el.dataset.mermaidState = 'pending';
  }
  return {
    update(source, { done = false } = {}) {
      if (finished) return;
      clearTimeout(timer);
      const v = ++version;
      if (done) {
        finished = true;
        compileMermaid(source).then((r) => {
          if (v === version) paintResult(el, source, r);
          report(source, r);
        });
        return;
      }
      // 生成中的半截代码失败是常态：不上报、不降级、不闪烁
      timer = setTimeout(() => compileMermaid(source)
        .then((r) => { if (v === version) paintResult(el, source, r, { keepPreviousOnFail: true }); }), delay);
    },
    cancel() { clearTimeout(timer); finished = true; },
  };
}
