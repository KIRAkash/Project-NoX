"use client";

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (React.isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function extractLanguage(node: ReactNode): string {
  const childArray = React.Children.toArray(node);
  for (const child of childArray) {
    if (React.isValidElement<{ className?: string }>(child)) {
      const className = child.props.className ?? "";
      const match = /language-(\S+)/.exec(className);
      if (match) {
        return match[1];
      }
    }
  }
  return "";
}

export function CodeBlock({ children, className = "", ...props }: React.ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lang = extractLanguage(children);
  const showLang = Boolean(lang && lang.toLowerCase() !== "text");

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const rawText = extractText(children);
    const textToCopy = rawText.replace(/\r?\n$/, "");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, 2000);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch (err) {
      console.error("Failed to copy code block:", err);
    }
  };

  return (
    <div className="group relative mt-5 overflow-hidden rounded-md border border-[rgb(var(--line)/.2)] bg-[linear-gradient(180deg,rgb(var(--raise)/.9),rgb(var(--deck-rgb)/.95))]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">
        <span>{showLang ? lang : ""}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="flex items-center gap-1.5 text-[10.5px] font-mono text-ink-muted transition-colors hover:text-ink"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400 normal-case tracking-normal">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="normal-case tracking-normal">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className={`overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.65] text-[color:var(--prose)] ${className}`} {...props}>
        {children}
      </pre>
    </div>
  );
}
