/**
 * fixMermaid —— 基于规则的 Mermaid 语法修复（纯函数，无依赖，浏览器 / Node 通用）
 *
 * 用法：
 *   const { code, changed, fixes } = fixMermaid(llmOutput);
 *
 * 建议配合 safeRepairMermaid 使用：原文能 parse 通过就不动它，修复后再 parse 一次确认。
 *
 * 兼容性：未使用正则后行断言 (?<!...)，可运行于 iOS/Safari 13.4+、Chrome 80+、Firefox 78+。
 * 注意：不要在本文件中引入 (?<= / (?<! 后行断言，旧版 Safari 会在模块加载时直接抛 SyntaxError。
 */

const DIAGRAM_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2',
  'stateDiagram-v2', 'stateDiagram', 'erDiagram', 'gantt', 'pie', 'journey',
  'gitGraph', 'mindmap', 'timeline', 'quadrantChart', 'requirementDiagram',
  'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
  'sankey-beta', 'xychart-beta', 'xychart', 'block-beta', 'packet-beta', 'architecture-beta', 'kanban',
];
const TYPE_MAP = new Map(DIAGRAM_TYPES.map((t) => [t.toLowerCase(), t]));

/** LLM 常写错的图类型名 → 正确写法 */
const HEADER_ALIASES = [
  [/^pie[\s_-]*chart\b/i, 'pie'],
  [/^(?:xy|line|bar)[\s_-]*chart(?:-beta)?\b/i, 'xychart-beta'],
  [/^mind[\s_-]*map\b/i, 'mindmap'],
];
function applyHeaderAlias(t) {
  for (const [re, rep] of HEADER_ALIASES) if (re.test(t)) return t.replace(re, rep);
  return t;
}

const isIdChar = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

/** 标签里只含这些字符时不需要加引号 */
const SAFE_LABEL = /^[\p{L}\p{N}\s_,.!?\-+*、，。！？]*$/u;

export function fixMermaid(input, options = {}) {
  const opts = { quoteAll: false, removeClick: true, ...options };
  const fixes = [];
  const note = (msg) => { if (!fixes.includes(msg)) fixes.push(msg); };

  if (typeof input !== 'string' || !input.trim()) {
    return { code: '', changed: false, fixes: ['输入为空'] };
  }

  let code = normalize(input, note);
  code = extractFromFence(code, note);

  let lines = code.split('\n');
  const header = ensureHeader(lines, note);
  lines = header.lines;
  const ctx = { opts, note, headerIdx: header.headerIdx, sgCounter: 0 };

  switch (header.type) {
    case 'flowchart': lines = fixFlowchart(lines, ctx); break;
    case 'sequence': lines = fixSequence(lines, ctx); break;
    case 'er': lines = balanceBraces(fixEr(lines, ctx), ctx); break;
    case 'state': lines = balanceBraces(fixStateColons(lines, ctx), ctx); break;
    case 'class': lines = balanceBraces(lines, ctx); break;
    case 'pie': lines = fixPie(lines, ctx); break;
    case 'xychart': lines = fixXychart(lines, ctx); break;
    case 'mindmap': lines = fixMindmap(lines, ctx); break;
    default: break;
  }

  code = lines.map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { code, changed: code !== input.trim(), fixes };
}

/* ------------------------------------------------------------------ */
/* 通用预处理                                                          */
/* ------------------------------------------------------------------ */

function normalize(s, note) {
  let out = s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const before = out;
  out = out.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  if (out !== before) note('移除零宽字符');
  const before2 = out;
  out = out.replace(/[\u00A0\u3000]/g, ' ');
  if (out !== before2) note('全角/不间断空格替换为普通空格');
  return out;
}

/** 从 ```mermaid 代码块中取出内容（兼容流式输出中未闭合的代码块），并去掉图前面的说明文字 */
function extractFromFence(s, note) {
  let out = s;
  const m = s.match(/```[ ]*(?:mermaid|mmd)[^\n]*\n([\s\S]*?)(?:\n[ ]*```|$)/i)
    || s.match(/```[^\n]*\n([\s\S]*?)(?:\n[ ]*```|$)/);
  if (m) { out = m[1]; note('去除代码块围栏'); }

  const lines = out.split('\n');
  const idx = lines.findIndex((l) => {
    const t = l.trim();
    return t.startsWith('%%') || t === '---' || TYPE_MAP.has(firstToken(applyHeaderAlias(t)).toLowerCase());
  });
  if (idx > 0 && lines.slice(0, idx).some((l) => l.trim())) {
    note('去除图表前的说明文字');
    return lines.slice(idx).join('\n');
  }
  return out;
}

function firstToken(t) { return (t.match(/^[^\s;]+/) || [''])[0]; }

/** 找到/补全图类型声明，修正大小写与方向 */
function ensureHeader(lines, note) {
  let i = 0;
  if (lines[0]?.trim() === '---') { // frontmatter
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    i = end > 0 ? end + 1 : 0;
  }
  while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith('%%'))) i++;

  const line = lines[i] ?? '';
  const base = applyHeaderAlias(line.trim());
  const tok = firstToken(base);
  const canonical = TYPE_MAP.get(tok.toLowerCase());

  if (!canonical) {
    const body = lines.join('\n');
    let guess = null;
    if (/->>|-->>|^\s*participant\s/m.test(body)) guess = 'sequenceDiagram';
    else if (/-->|---|==>|-\.->/.test(body)) guess = 'flowchart TD';
    if (guess) {
      note(`补全缺失的图类型声明：${guess}`);
      const out = [...lines.slice(0, i), guess, ...lines.slice(i)];
      return { lines: out, headerIdx: i, type: typeOf(guess) };
    }
    return { lines, headerIdx: i, type: 'other' };
  }

  let fixed = base.replace(tok, canonical);
  if (canonical === 'graph' || canonical === 'flowchart') {
    const m = fixed.match(/^(graph|flowchart)\s*([^\s;]*)(.*)$/);
    const dir = normalizeDirection(m[2]);
    fixed = `${m[1]} ${dir}${m[3]}`;
  }
  if (fixed !== line.trim()) note('修正图类型声明/方向');
  const out = [...lines];
  out[i] = fixed;
  return { lines: out, headerIdx: i, type: typeOf(canonical) };
}

function normalizeDirection(d) {
  const u = (d || '').toUpperCase();
  if (['TB', 'TD', 'BT', 'RL', 'LR'].includes(u)) return u;
  if (/LEFT|HORIZ|LR/.test(u)) return 'LR';
  return 'TD';
}

function typeOf(header) {
  const t = header.split(/\s/)[0];
  if (t === 'graph' || t === 'flowchart') return 'flowchart';
  if (t === 'sequenceDiagram') return 'sequence';
  if (t === 'erDiagram') return 'er';
  if (t.startsWith('stateDiagram')) return 'state';
  if (t.startsWith('classDiagram')) return 'class';
  if (t === 'pie') return 'pie';
  if (t.startsWith('xychart')) return 'xychart';
  if (t === 'mindmap') return 'mindmap';
  return 'other';
}

/** 只对引号外的内容执行 fn */
function mapOutsideQuotes(s, fn) {
  return s.split(/("[^"\n]*")/).map((part, i) => (i % 2 ? part : fn(part))).join('');
}

/* ------------------------------------------------------------------ */
/* Flowchart                                                           */
/* ------------------------------------------------------------------ */

// [开符号, [可接受的闭符号...], 输出用开符号(可选，用于全角转半角), 输出用闭符号]
const SHAPES = [
  ['(((', [')))']], ['((', ['))']], ['([', ['])']], ['[[', [']]']], ['[(', [')]']],
  ['{{', ['}}']], ['[/', ['/]', '\\]']], ['[\\', ['\\]', '/]']],
  ['>', [']']], ['[', [']']], ['(', [')']], ['{', ['}']],
  ['【', ['】'], '[', ']'], ['［', ['］'], '[', ']'], ['（', ['）'], '(', ')'], ['｛', ['｝'], '{', '}'],
];
const OPEN_CH = '([{（【［｛';
const CLOSE_CH = ')]}）】］｝';

function fixFlowchart(lines, ctx) {
  const { note, opts } = ctx;
  const out = [];
  let opens = 0;

  lines.forEach((line, idx) => {
    if (idx <= ctx.headerIdx) { out.push(line); return; }
    const t = line.trim();
    const indent = line.match(/^\s*/)[0];
    if (!t || t.startsWith('%%')) { out.push(line); return; }

    const kw = firstToken(t);
    if (/^(classDef|class|style|linkStyle|direction)$/.test(kw)) { out.push(line); return; }
    if (kw === 'click') {
      if (opts.removeClick) { note('删除 click 交互指令'); return; }
      out.push(line); return;
    }
    if (/^end\s*;?$/.test(t)) {
      if (opens === 0) { note('删除多余的 end'); return; }
      opens--; out.push(line); return;
    }
    if (kw === 'subgraph') { opens++; out.push(indent + fixSubgraph(t, ctx)); return; }

    let s = t;
    // 1) "-- 文本 -->" 形式的边文本统一转成 "-->|文本|"，避免文本里的括号被当成节点形状
    s = mapOutsideQuotes(s, (seg) => seg
      .replace(/(^|[^-=.<])--(?![->])(?![ox]\s)\s*([^|\n]+?)\s*-->/g, (_, pre, txt) => `${pre}-->|${txt}|`)
      .replace(/(^|[^=])==(?![=>])\s*([^|\n]+?)\s*==>/g, (_, pre, txt) => `${pre}==>|${txt}|`)
      .replace(/-\.(?![.-])\s*([^|\n]+?)\s*\.->/g, (_, txt) => `-.->|${txt}|`));
    // 2) 扫描节点定义与边标签
    const fixed = scanFlowLine(s, ctx);
    if (fixed !== t) note('修正节点标签/箭头/边文本');
    out.push(indent + fixed);
  });

  for (; opens > 0; opens--) { out.push('end'); note('补全缺失的 end'); }
  return out;
}

function fixSubgraph(t, ctx) {
  const rest = t.slice('subgraph'.length).trim();
  const newId = () => `sg_${++ctx.sgCounter}`;
  if (!rest) { ctx.note('subgraph 补 ID'); return `subgraph ${newId()}[" "]`; }
  if (/^[A-Za-z0-9_]+$/.test(rest)) return t;
  const m = rest.match(/^([\p{L}\p{N}_]+)\s*\[(.*)\]$/u);
  if (m) {
    const id = /^[A-Za-z0-9_]+$/.test(m[1]) ? m[1] : newId();
    return `subgraph ${id}[${quoteText(m[2], true)}]`;
  }
  ctx.note('subgraph 标题含特殊字符，改为 id["标题"] 形式');
  return `subgraph ${newId()}[${quoteText(rest, true)}]`;
}

function fixFlowArrows(seg) {
  return seg
    .replace(/[—–－―]+>/g, '-->')
    .replace(/[→⟶➔➜⇒]/g, '-->')
    .replace(/(^|[^=<])=>/g, '$1==>')
    .replace(/(^|[^-=.<])->(?!>)/g, '$1-->');
}

function scanFlowLine(s, ctx) {
  let out = '';
  let buf = ''; // 结构性文本（箭头、空格、&、:::等），flush 时统一修箭头
  const flush = () => { out += fixFlowArrows(buf); buf = ''; };
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '"') {                       // 已加引号的内容原样保留
      const j = s.indexOf('"', i + 1);
      if (j === -1) { buf += s.slice(i); break; }
      flush(); out += s.slice(i, j + 1); i = j + 1; continue;
    }

    if (ch === '|' || ch === '｜') {        // 边标签 |文本|
      let j = i + 1;
      while (j < s.length && s[j] !== '|' && s[j] !== '｜') j++;
      if (j >= s.length) { buf += '|'; i++; continue; }
      flush();
      out += `|${quoteText(s.slice(i + 1, j), ctx.opts.quoteAll)}|`;
      i = j + 1; continue;
    }

    if (isIdChar(ch) && !isIdChar(s[i - 1])) { // 节点 ID
      let j = i;
      while (j < s.length && isIdChar(s[j])) j++;
      let id = s.slice(i, j);
      if (id === 'end') { id = 'end_'; ctx.note('节点 ID 与保留字 end 冲突，已重命名'); }
      // "A---oB" 会被解析成圆头箭头，补空格
      if (/^[ox]./.test(id) && /[-=]$/.test(buf)) buf += ' ';
      flush();

      const node = matchNode(s, j);
      if (node) {
        out += id + node.open + quoteText(node.label, ctx.opts.quoteAll || node.forceQuote) + node.close;
        i = node.end;
      } else {
        out += id;
        i = j;
      }
      continue;
    }

    buf += ch; i++;
  }
  flush();
  return out;
}

/** 从 pos 开始尝试匹配节点形状，返回 { open, close, label, end } */
function matchNode(s, pos) {
  for (const [open, closes, outOpen, outClose] of SHAPES) {
    if (!s.startsWith(open, pos)) continue;
    const start = pos + open.length;
    const res = findLabelEnd(s, start, closes);
    if (!res) continue;
    return {
      open: outOpen ?? open,
      close: outClose ?? res.close,
      label: s.slice(start, res.labelEnd),
      end: res.end,
      forceQuote: !!outOpen,
    };
  }
  return null;
}

function findLabelEnd(s, start, closes) {
  const matchCloseAt = (k) => {
    for (const cl of closes) {
      if (CLOSE_CH.includes(cl[0])) {
        if (s.startsWith(cl, k)) return { labelEnd: k, end: k + cl.length, close: cl };
      } else { // 形如 "/]" "\]"
        const st = k - cl.length + 1;
        if (st >= start && s.slice(st, k + 1) === cl) return { labelEnd: st, end: k + 1, close: cl };
      }
    }
    return null;
  };

  // 快速路径：标签已被引号包裹
  let k = start;
  while (s[k] === ' ') k++;
  if (s[k] === '"') {
    const q = s.indexOf('"', k + 1);
    if (q !== -1) {
      let e = q + 1;
      while (s[e] === ' ') e++;
      for (const cl of closes) if (s.startsWith(cl, e)) return { labelEnd: e, end: e + cl.length, close: cl };
    }
  }

  // 括号深度扫描：允许标签里出现成对的括号，如 A[数组[0]]、A(调用(x))
  let depth = 0;
  for (k = start; k < s.length; k++) {
    const c = s[k];
    if (OPEN_CH.includes(c)) depth++;
    else if (CLOSE_CH.includes(c)) {
      if (depth === 0) return matchCloseAt(k);
      depth--;
    }
  }
  return null;
}

/** 视需要给标签加引号，并转义内部的双引号 */
function quoteText(raw, force = false) {
  let t = raw.trim();
  if (/^"[^"]*"$/.test(t)) return t;                    // 已正确加引号
  if (/^"`[\s\S]*`"$/.test(t)) return t;                // markdown 字符串
  if (/^[“”"][\s\S]*[“”"]$/.test(t) && t.length >= 2) { t = t.slice(1, -1); force = true; }
  if (!t) return '" "';
  if (!force && SAFE_LABEL.test(t)) return t;
  t = t.replace(/"/g, '#quot;').replace(/\\n/g, '<br/>');
  return `"${t}"`;
}

/* ------------------------------------------------------------------ */
/* Sequence diagram                                                    */
/* ------------------------------------------------------------------ */

const SEQ_ARROW_SRC = '<<-->>|<<->>|-->>|->>|--x|-x|--\\)|-\\)|-->|->';
const SEQ_ARROW = new RegExp(`(${SEQ_ARROW_SRC})`);
const BAD_SEQ_ARROW = /(==>|=>|→|⇒|[—–－]+>)/;
const SEQ_BLOCK = /^(loop|alt|opt|par|critical|break|rect|box)\b/i;

function fixSequence(lines, ctx) {
  const { note } = ctx;
  const out = [];
  const active = Object.create(null);
  let depth = 0;

  lines.forEach((line, idx) => {
    if (idx <= ctx.headerIdx) { out.push(line); return; }
    const t = line.trim();
    if (!t || t.startsWith('%%')) { out.push(line); return; }

    if (SEQ_BLOCK.test(t)) { depth++; out.push(line); return; }
    if (/^end\s*;?$/.test(t)) {
      if (depth === 0) { note('删除多余的 end'); return; }
      depth--; out.push(line); return;
    }

    const act = t.match(/^(activate|deactivate)\s+(.+?)\s*;?$/);
    if (act) {
      const who = act[2];
      if (act[1] === 'activate') active[who] = (active[who] || 0) + 1;
      else if (!active[who]) { note('删除没有对应 activate 的 deactivate'); return; }
      else active[who]--;
      out.push(line); return;
    }

    if (/^note\s/i.test(t)) { out.push(fixFirstColon(line, note)); return; }

    // 消息行
    const ci = line.search(/[:：]/);
    let head = ci >= 0 ? line.slice(0, ci) : line;
    let tail = ci >= 0 ? line.slice(ci + 1) : null;

    if (!SEQ_ARROW.test(head) && BAD_SEQ_ARROW.test(head)) {
      head = head.replace(BAD_SEQ_ARROW, '->>'); note('修正非法的时序箭头');
    }
    const m = head.match(new RegExp(`^\\s*(.+?)\\s*(${SEQ_ARROW_SRC})\\s*([+-]?)\\s*(\\S+)(.*)$`));
    if (!m) { out.push(line); return; }
    const [, from, , flag, to, extra] = m;

    if (tail === null && extra.trim()) {           // "A->>B 消息" 缺冒号
      head = head.slice(0, head.length - extra.length);
      tail = ' ' + extra.trim();
      note('消息缺少冒号，已补全');
    }
    if (flag === '+') active[to] = (active[to] || 0) + 1;
    if (flag === '-') {
      if (!active[from]) { head = head.replace(/([>x)])\s*-\s*/, '$1'); note('删除无效的 - 去激活标记'); }
      else active[from]--;
    }
    if (ci >= 0 && line[ci] === '：') note('全角冒号替换为半角');
    if (tail !== null) {
      if (tail.includes(';')) { tail = tail.replace(/;/g, '#59;'); note('消息中的分号已转义'); }
      out.push(`${head}:${tail}`);
    } else {
      out.push(head);
    }
  });

  for (; depth > 0; depth--) { out.push('end'); note('补全缺失的 end'); }
  return out;
}

function fixFirstColon(line, note) {
  const ci = line.search(/[:：]/);
  if (ci >= 0 && line[ci] === '：') {
    note('全角冒号替换为半角');
    return line.slice(0, ci) + ':' + line.slice(ci + 1);
  }
  return line;
}

/* ------------------------------------------------------------------ */
/* ER / State / Class                                                  */
/* ------------------------------------------------------------------ */

function fixEr(lines, ctx) {
  const rel = /^(\s*[^\s:：{}]+\s+[|}o]{2}(?:--|\.\.)[|{o]{2}\s+[^\s:：{}]+)\s*(?:([:：])\s*(.*))?$/;
  return lines.map((line, idx) => {
    if (idx <= ctx.headerIdx) return line;
    const m = line.match(rel);
    if (!m) return line;
    const [, left, colon, label] = m;
    let lab = (label ?? '').trim();
    if (!colon || !lab) { ctx.note('ER 关系缺少标签，已补空标签'); return `${left} : ""`; }
    if (colon === '：') ctx.note('全角冒号替换为半角');
    if (!/^"[^"]*"$/.test(lab) && !/^[A-Za-z0-9_-]+$/.test(lab)) {
      lab = `"${lab.replace(/^[“"]|[”"]$/g, '').replace(/"/g, "'")}"`;
      ctx.note('ER 关系标签加引号');
    }
    return `${left} : ${lab}`;
  });
}

function fixStateColons(lines, ctx) {
  return lines.map((line, idx) => (idx > ctx.headerIdx && line.includes('-->') ? fixFirstColon(line, ctx.note) : line));
}

function balanceBraces(lines, ctx) {
  const isOpen = (t) => /\{\s*$/.test(t);
  const isClose = (t) => /^\}\s*;?$/.test(t);
  const opens = lines.filter((l) => isOpen(l.trim())).length;
  const closes = lines.filter((l) => isClose(l.trim())).length;
  // 只有在 { } 不平衡时才启用"按缩进推断块结束"，避免误伤本来正确的图
  const unbalanced = opens > closes;
  // 看起来像顶层语句的行：关系/转移箭头、新的 class/state 声明、新的块
  const looksTopLevel = (t) => /(<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.\||--|\.\.)/.test(t)
    || /^(class|state|note)\b/.test(t) || isOpen(t);
  const indentOf = (l) => l.match(/^\s*/)[0].length;

  const out = [];
  const stack = []; // 每个未闭合块的开头缩进
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (idx > ctx.headerIdx && t && unbalanced) {
      while (stack.length && !isClose(t) && indentOf(line) <= stack[stack.length - 1] && looksTopLevel(t)) {
        out.push(' '.repeat(stack.pop()) + '}');
        ctx.note('按缩进推断块结束位置，补全缺失的 }');
      }
    }
    if (isClose(t)) {
      if (!stack.length) { ctx.note('删除多余的 }'); return; }
      stack.pop();
    }
    if (idx > ctx.headerIdx && isOpen(t)) stack.push(indentOf(line));
    out.push(line);
  });
  while (stack.length) { out.push(' '.repeat(stack.pop()) + '}'); ctx.note('补全缺失的 }'); }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pie / XY chart (柱状图、折线图) / Mindmap                          */
/* ------------------------------------------------------------------ */

/** 去掉外层引号（含中文引号、单引号），内部双引号改为单引号，再用双引号包起来 */
function dq(text) {
  let t = String(text).trim();
  const m = t.match(/^["'“”‘’「『](.*)["'“”‘’」』]$/);
  if (m) t = m[1].trim();
  return `"${t.replace(/"/g, "'")}"`;
}

/** 从 "30%"、"¥1,200元"、"1.5万" 这类文本里取出数字；取不到返回 null */
function toNumber(raw) {
  const cleaned = String(raw).replace(/[,，\s]/g, '');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 全角括号/逗号/冒号转半角（只用于图表的结构部分） */
function halfWidthPunct(s) {
  return s.replace(/[［【]/g, '[').replace(/[］】]/g, ']').replace(/，/g, ',');
}

function fixPie(lines, ctx) {
  const { note } = ctx;
  const out = [];
  lines.forEach((line, idx) => {
    const t = line.trim();
    const indent = line.match(/^\s*/)[0];
    if (idx < ctx.headerIdx || !t || t.startsWith('%%')) { out.push(line); return; }
    if (idx === ctx.headerIdx) {                     // pie title: xxx → pie title xxx
      const fixed = line.replace(/\btitle\s*[:：]\s*/, 'title ');
      if (fixed !== line) note('pie：title 后多余的冒号已删除');
      out.push(fixed); return;
    }
    if (/^(showData|accTitle|accDescr)\b/.test(t)) { out.push(line); return; }
    const title = t.match(/^title\s*[:：]?\s*(.*)$/i);
    if (title) {
      if (!/^title\s/.test(t) || /^title\s*[:：]/.test(t)) note('pie：title 后多余的冒号已删除');
      out.push(`${indent}title ${title[1]}`); return;
    }
    const m = t.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (!m) { note('pie：删除无法识别的行'); return; }
    const value = toNumber(m[2]);
    if (value === null) { note('pie：删除没有数值的数据行'); return; }
    if (value < 0) { note('pie：删除负数数据行（饼图不支持负值）'); return; }
    const fixed = `${indent}${dq(m[1])} : ${value}`;
    if (fixed.trim() !== t) note('pie：数据行规范化（标签加引号、全角冒号、去掉 %/单位/千分位）');
    out.push(fixed);
  });
  return out;
}

function fixXychart(lines, ctx) {
  const { note } = ctx;
  const RANGE = /(-?\d+(?:\.\d+)?)\s*(?:-->|->|—+>|~|～|–|—|-|to|至|到)\s*(-?\d+(?:\.\d+)?)\s*$/i;
  const splitList = (s) => {
    const items = []; let cur = ''; let q = null;
    for (const ch of s) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === ',') { items.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) items.push(cur);
    return items.map((x) => x.trim()).filter(Boolean);
  };
  const axis = (kw, rest) => {
    rest = halfWidthPunct(rest).trim();
    const lb = rest.indexOf('[');
    if (lb !== -1) {                                   // 类别轴：[a, b, c]
      const rb = rest.lastIndexOf(']');
      const pre = rest.slice(0, lb).trim();
      const items = splitList(rest.slice(lb + 1, rb === -1 ? undefined : rb)).map(dq);
      return `${kw} ${pre ? dq(pre) + ' ' : ''}[${items.join(', ')}]`;
    }
    const r = rest.match(RANGE);                       // 数值轴：min --> max
    if (r) {
      const pre = rest.slice(0, r.index).trim();
      return `${kw} ${pre ? dq(pre) + ' ' : ''}${r[1]} --> ${r[2]}`;
    }
    return rest ? `${kw} ${dq(rest)}` : kw;
  };

  return lines.map((line, idx) => {
    const t = line.trim();
    const indent = line.match(/^\s*/)[0];
    if (idx <= ctx.headerIdx || !t || t.startsWith('%%')) return line;
    let fixed = null;
    let m;
    if ((m = t.match(/^title\s*[:：]?\s*(.+)$/i))) fixed = `title ${dq(m[1])}`;
    else if ((m = t.match(/^([xy])[-_\s]?axis\s*[:：]?\s*(.*)$/i))) fixed = axis(`${m[1].toLowerCase()}-axis`, m[2]);
    else if ((m = t.match(/^(bar|line)\s*[:：]?\s*(.*)$/i))) {
      const rest = halfWidthPunct(m[2]);
      const lb = rest.indexOf('[');
      if (lb === -1) return line;
      const rb = rest.lastIndexOf(']');
      const name = rest.slice(0, lb).trim();
      const nums = splitList(rest.slice(lb + 1, rb === -1 ? undefined : rb)).map((v) => {
        const n = toNumber(v);
        if (n === null) note('xychart：无法识别的数值已按 0 处理');
        return n ?? 0;
      });
      fixed = `${m[1].toLowerCase()} ${name ? dq(name) + ' ' : ''}[${nums.join(', ')}]`;
    } else return line;
    if (fixed !== t) note('xychart：标题/坐标轴/数据行规范化（中文加引号、全角符号、范围写法、去掉 %/单位）');
    return indent + fixed;
  });
}

function fixMindmap(lines, ctx) {
  const { note } = ctx;
  const head = lines.slice(0, ctx.headerIdx + 1);
  let body = lines.slice(ctx.headerIdx + 1);
  let idCounter = 0;
  let headingIndent = null;

  // 1) Markdown 标题 / 列表符号 → 缩进
  body = body.map((line) => {
    if (!line.trim() || line.trim().startsWith('%%')) return line;
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      headingIndent = h[1].length * 2;
      note('mindmap：Markdown 标题转为缩进层级');
      return ' '.repeat(headingIndent) + h[2];
    }
    const b = line.match(/^(\s*)(?:[-*+•]|\d+[.)、])\s+(.*)$/);
    if (b) {
      note('mindmap：去掉列表符号（- * 1.）');
      const base = headingIndent === null ? b[1].length : headingIndent + 2 + b[1].length;
      return ' '.repeat(base) + b[2];
    }
    if (headingIndent !== null && !line.startsWith(' ')) return ' '.repeat(headingIndent + 2) + line.trim();
    return line;
  });

  // 2) 节点文本里的括号：只有 "ASCII id + 形状" 才当作形状，其余整体加引号
  const SHAPE = /^[A-Za-z0-9_-]*(\(\([^()]*\)\)|\([^()]*\)|\[[^\[\]]*\]|\)\)[^()]*\(\(|\)[^()]*\(|\{\{[^{}]*\}\})$/;
  body = body.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('%%') || t.startsWith('::')) return line;
    if (!/[()[\]{}"]/.test(t) || SHAPE.test(t)) return line;
    note('mindmap：含括号的节点文本加引号，避免被当成形状或报错');
    return line.match(/^\s*/)[0] + `mm_${++idCounter}[${dq(t)}]`;
  });

  // 3) 多个根节点：把根之后的所有行整体右移，使其成为根的子节点
  const nodeIdx = body.map((l, i) => (l.trim() && !l.trim().startsWith('%%') && !l.trim().startsWith('::') ? i : -1)).filter((i) => i >= 0);
  if (nodeIdx.length > 1) {
    const indentOf = (l) => l.match(/^\s*/)[0].length;
    const rootIndent = indentOf(body[nodeIdx[0]]);
    const minAfter = Math.min(...nodeIdx.slice(1).map((i) => indentOf(body[i])));
    if (minAfter <= rootIndent) {
      const shift = rootIndent + 2 - minAfter;
      note('mindmap：存在多个根节点，已把其余节点挂到第一个根节点下');
      body = body.map((l, i) => (i > nodeIdx[0] && l.trim() ? ' '.repeat(shift) + l : l));
    }
  }
  return [...head, ...body];
}

/* ------------------------------------------------------------------ */
/* 带校验的安全封装                                                    */
/* ------------------------------------------------------------------ */

/**
 * 能通过 parse、但渲染结果大概率和作者意图不符的写法。
 * mindmap：中文文本后紧跟括号（如 "数学(微积分)"）会被解析成 "id + 形状"，只显示括号里的字，括号前的文字丢失。
 */
function looksSemanticallyWrong(code) {
  const body = code.replace(/^[\s\S]*?```[^\n]*\n/, '');
  if (/^\s*mindmap\b/m.test(body) && /^[ \t]+[^\s\x00-\x7F][^\s()[\]{}]*[([{]/m.test(body)) {
    return 'mindmap 中文节点文本后接括号，会被当成形状而丢字';
  }
  return null;
}

/** 把 mermaid 实例包装成 parse 函数：通过返回 null，失败返回错误信息 */
export function createMermaidParser(mermaid) {
  return async (code) => {
    try { await mermaid.parse(code); return null; } catch (e) { return String(e?.message ?? e); }
  };
}

/**
 * 原文能过就不动；否则规则修复后再校验。
 * 返回 ok=false 时，调用方可以走 LLM 修复或降级展示源码。
 */
export async function safeRepairMermaid(input, parse, options) {
  const originalError = await parse(input);
  if (!originalError) {
    const untouched = { ok: true, code: input, fixes: [], originalError: null, error: null };
    // 语法合法但大概率画错的写法：修复后仍能解析才采用
    const suspicion = looksSemanticallyWrong(input);
    if (!suspicion) return untouched;
    const { code, fixes } = fixMermaid(input, options);
    if (code === input.trim() || await parse(code)) return untouched;
    return { ok: true, code, fixes: [`语义检查：${suspicion}`, ...fixes], originalError: null, error: null };
  }
  const { code, fixes } = fixMermaid(input, options);
  const error = await parse(code);
  return { ok: !error, code, fixes, originalError, error };
}
