/**
 * MermaidBlock.jsx —— React 调用示例
 *
 * 1) 单独使用：
 *    <MermaidBlock code={llmMermaidText} />
 *
 * 2) 流式输出（聊天场景）：
 *    <MermaidBlock code={partialText} streaming={!messageDone} />
 *
 * 3) 配合 react-markdown：
 *    <ReactMarkdown components={{ code: MarkdownCode }}>{markdown}</ReactMarkdown>
 */
import { useEffect, useRef } from 'react';
import { renderMermaidSafe, createStreamingMermaid, setupMermaid } from '../src/mermaid-render.js';

// 应用启动时调用一次即可（例如在 main.jsx 里）
setupMermaid({
  theme: 'auto',
  onReport: (r) => {
    // 埋点：统计修复命中规则与失败原因，用于持续优化 prompt 和规则
    // fetch('/api/metrics/mermaid', { method: 'POST', body: JSON.stringify(r), keepalive: true });
    console.info('[mermaid]', r.ok ? '修复成功' : '修复失败', r.fixes, r.error ?? '');
  },
});

export default function MermaidBlock({ code, streaming = false, className = '' }) {
  const ref = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (streaming) {
      streamRef.current ??= createStreamingMermaid(el);
      streamRef.current.update(code);
      return;
    }
    if (streamRef.current) {                     // 流式结束：最终渲染一次
      streamRef.current.update(code, { done: true });
      streamRef.current = null;
      return;
    }
    renderMermaidSafe(el, code);
  }, [code, streaming]);

  // 卸载时停止流式渲染；置空是为了兼容 React StrictMode 的"卸载-重新挂载"检查
  useEffect(() => () => { streamRef.current?.cancel(); streamRef.current = null; }, []);

  return <div ref={ref} className={`mermaid-block ${className}`} />;
}

/** react-markdown 的 code 渲染器：mermaid 代码块画成图，其余照常 */
export function MarkdownCode({ className, children, ...props }) {
  if (/language-mermaid/.test(className || '')) {
    return <MermaidBlock code={String(children).replace(/\n$/, '')} />;
  }
  return <code className={className} {...props}>{children}</code>;
}
