import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { slugify } from "@/lib/docs";

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return "";
}

/** A docs chapter: GitHub-flavoured Markdown in NoX's type and colours. Internal /docs links stay in the app. */
export function DocMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="font-display text-[40px] leading-[1.08] text-ink sm:text-[52px]">{children}</h1>,
        h2: ({ children }) => {
          const id = slugify(text(children));
          return (
            <h2 id={id} className="group mt-14 scroll-mt-24 border-t border-hairline pt-8 font-display text-[28px] leading-tight text-ink sm:text-[32px]">
              <a href={`#${id}`} className="no-underline">
                {children}
                <span aria-hidden className="ml-2 text-[20px] text-ink-dim opacity-0 transition-opacity group-hover:opacity-100">#</span>
              </a>
            </h2>
          );
        },
        h3: ({ children }) => <h3 className="mt-9 text-[17px] font-semibold text-ink">{children}</h3>,
        p: ({ children }) => <p className="mt-4 text-[15.5px] leading-[1.75] text-ink-muted">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
        a: ({ href = "", children }) =>
          href.startsWith("/") || href.startsWith("#") ? (
            <Link href={href} className="text-[#8FC4F2] underline decoration-[rgba(143,196,242,.35)] underline-offset-[3px] hover:decoration-[#8FC4F2]">
              {children}
            </Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer" className="text-[#8FC4F2] underline decoration-[rgba(143,196,242,.35)] underline-offset-[3px] hover:decoration-[#8FC4F2]">
              {children}
            </a>
          ),
        ul: ({ children }) => <ul className="mt-4 space-y-2 pl-5 text-[15.5px] leading-[1.7] text-ink-muted marker:text-nox">{children}</ul>,
        ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15.5px] leading-[1.7] text-ink-muted marker:font-mono marker:text-[13px] marker:text-nox">{children}</ol>,
        li: ({ children, className }) => (
          <li className={className?.includes("task-list-item") ? "list-none" : "list-[inherit] pl-1 [&>p]:mt-2 [&>ul]:mt-2 [&>pre]:mt-3"}>{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mt-6 rounded-md border border-[rgba(247,181,66,.28)] bg-[linear-gradient(135deg,rgba(247,181,66,.09),rgba(247,181,66,.02))] px-5 py-1 pb-4 [&>p]:text-ink">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-10 border-hairline" />,
        code: ({ children, className }) =>
          className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="rounded-[4px] border border-hairline bg-[rgba(143,160,204,.08)] px-1.5 py-[1px] font-mono text-[0.86em] text-[#E7D3A6]">{children}</code>
          ),
        pre: ({ children }) => {
          const child = Children.toArray(children)[0];
          const lang = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "").replace("language-", "") : "";
          return (
            <div className="mt-5 overflow-hidden rounded-md border border-[rgba(143,160,204,.2)] bg-[linear-gradient(180deg,rgba(21,26,42,.9),rgba(9,11,19,.95))]">
              {lang && lang !== "text" && (
                <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">{lang}</div>
              )}
              <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.65] text-[#C9D2EA]">{children}</pre>
            </div>
          );
        },
        table: ({ children }) => (
          <div className="mt-6 overflow-x-auto rounded-md border border-[rgba(143,160,204,.2)]">
            <table className="w-full min-w-[560px] border-collapse text-left text-[13.5px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[rgba(143,160,204,.07)]">{children}</thead>,
        th: ({ children, style }) => (
          <th style={style} className="border-b border-hairline px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-faint">
            {children}
          </th>
        ),
        td: ({ children, style }) => (
          <td style={style} className="border-b border-hairline px-4 py-2.5 align-top leading-[1.6] text-ink-muted">
            {children}
          </td>
        ),
        input: ({ checked }) => (
          <input type="checkbox" checked={checked} readOnly disabled className="mr-2 translate-y-[1px] accent-[#5FD29F]" />
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
