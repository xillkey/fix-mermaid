# Changelog

## 0.1.0

- `fixMermaid`: rule-based repair for flowchart, sequence, class, state, ER, pie, xychart (bar/line) and mindmap diagrams.
- `safeRepairMermaid`: validate → repair → re-validate; valid input is never modified.
- Semantic check for mindmap text that parses but loses characters (e.g. `数学(微积分)`).
- `mermaid-render.js`: browser render helper with caching, serialized rendering, fallback UI, reporting and streaming support.
- No regex lookbehind — runs on iOS/Safari 13.4+.
- 24 regression cases, validated in Node (jsdom) and headless Chromium with screenshots.
