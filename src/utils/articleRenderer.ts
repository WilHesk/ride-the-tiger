export interface InlineImageItem {
  image: string;
  alt?: string;
  caption?: string;
  percentage: number;
}

export function escapeHtml(val: unknown): string {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderInlineMarkdown(text: string): string {
  let out = escapeHtml(text);

  // Markdown links: [label](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label, rawUrl) => {
      const cleanUrl = String(rawUrl || "").trim().replace(/\.$/, "");
      const isExternal = /^https?:\/\//i.test(cleanUrl);
      const targetAttrs = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a href="${cleanUrl}"${targetAttrs} class="text-tiger-600 underline decoration-2 underline-offset-2 hover:text-tiger-500 font-semibold transition-colors">${label}</a>`;
    }
  );

  // Bold: **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");

  return out;
}

export interface ParsedArticleBlock {
  raw: string;
  plainText: string;
  html: string;
  isHeading: boolean;
  isRule: boolean;
  wordCount: number;
}

export function parseMarkdownBlocks(markdown: string): ParsedArticleBlock[] {
  const normalized = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const rawChunks = normalized
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const blocks: ParsedArticleBlock[] = [];

  for (const chunk of rawChunks) {
    // Check if chunk starts with a heading line followed by body lines
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && /^#{1,4}\s+/.test(lines[0])) {
      const headingLine = lines[0];
      const restChunk = lines.slice(1).join("\n");
      blocks.push(buildSingleBlock(headingLine));
      blocks.push(buildSingleBlock(restChunk));
    } else {
      blocks.push(buildSingleBlock(chunk));
    }
  }

  return blocks;
}

function buildSingleBlock(chunk: string): ParsedArticleBlock {
  const trimmed = chunk.trim();

  if (/^(___|---|\*\*\*)$/.test(trimmed)) {
    return {
      raw: trimmed,
      plainText: "---",
      html: `<hr class="my-12 border-t-2 border-gray-300" />`,
      isHeading: false,
      isRule: true,
      wordCount: 1,
    };
  }

  const hMatch = trimmed.match(/^(#{1,4})\s+([\s\S]+)$/);
  if (hMatch) {
    const level = hMatch[1].length;
    const content = hMatch[2].trim();
    const tag = level <= 2 ? "h2" : "h3";
    const plain = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    return {
      raw: trimmed,
      plainText: plain,
      html: `<${tag}>${renderInlineMarkdown(content)}</${tag}>`,
      isHeading: true,
      isRule: false,
      wordCount: Math.max(3, plain.split(/\s+/).filter(Boolean).length),
    };
  }

  if (trimmed.startsWith(">")) {
    const content = trimmed.replace(/^>\s*/, "").trim();
    const plain = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    return {
      raw: trimmed,
      plainText: plain,
      html: `<blockquote class="pull-quote">${renderInlineMarkdown(content)}</blockquote>`,
      isHeading: false,
      isRule: false,
      wordCount: Math.max(5, plain.split(/\s+/).filter(Boolean).length),
    };
  }

  const lines = trimmed.split("\n").map((l) => renderInlineMarkdown(l.trim()));
  const plain = trimmed.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const words = plain.split(/\s+/).filter(Boolean).length;

  return {
    raw: trimmed,
    plainText: plain,
    html: `<p>${lines.join("<br />")}</p>`,
    isHeading: false,
    isRule: false,
    wordCount: Math.max(5, words),
  };
}

/**
 * Computes which slot index (0 .. blocks.length) corresponds to a given percentage (0..100).
 * Slot 0 = before block 0; Slot k = after block k-1; Slot blocks.length = after final block.
 */
export function computeSlotForPercentage(
  blocks: ParsedArticleBlock[],
  percentage: number
): number {
  const n = blocks.length;
  if (n === 0) return 0;

  const clamped = Math.max(0, Math.min(100, Number(percentage) || 0));
  if (clamped <= 0) return 0;
  if (clamped >= 100) return n;

  const totalWords = blocks.reduce((acc, b) => acc + b.wordCount, 0);
  const targetWords = (clamped / 100) * totalWords;

  let cumulative = 0;
  let bestSlot = 1;
  let bestDiff = Infinity;

  for (let i = 0; i < n; i++) {
    cumulative += blocks[i].wordCount;
    const slotAfterBlock = i + 1;
    const diff = Math.abs(cumulative - targetWords);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSlot = slotAfterBlock;
    }
  }

  // Never place an image directly after a heading (between heading and its paragraph)
  if (bestSlot > 0 && bestSlot < n && blocks[bestSlot - 1].isHeading) {
    bestSlot = Math.min(n, bestSlot + 1);
  }

  return bestSlot;
}

export function getPercentageInsertionPreview(
  markdown: string,
  percentage: number
): {
  percentage: number;
  slotIndex: number;
  totalBlocks: number;
  contextLabel: string;
} {
  const blocks = parseMarkdownBlocks(markdown);
  const clamped = Math.max(0, Math.min(100, Math.round(Number(percentage) || 0)));
  if (blocks.length === 0) {
    return {
      percentage: clamped,
      slotIndex: 0,
      totalBlocks: 0,
      contextLabel: "Add copy above to preview exact paragraph placement.",
    };
  }

  const slot = computeSlotForPercentage(blocks, clamped);
  if (slot <= 0) {
    const firstText = blocks[0].plainText.slice(0, 85);
    return {
      percentage: clamped,
      slotIndex: 0,
      totalBlocks: blocks.length,
      contextLabel: `At top of article body — before: “${firstText}${blocks[0].plainText.length > 85 ? "…" : ""}”`,
    };
  }

  if (slot >= blocks.length) {
    const lastBlock = blocks[blocks.length - 1];
    const lastText = lastBlock.plainText.slice(0, 85);
    return {
      percentage: clamped,
      slotIndex: blocks.length,
      totalBlocks: blocks.length,
      contextLabel: `At end of article (${clamped}%) — after: “${lastText}${lastBlock.plainText.length > 85 ? "…" : ""}”`,
    };
  }

  const prevBlock = blocks[slot - 1];
  const snippet = prevBlock.plainText.slice(0, 90);
  return {
    percentage: clamped,
    slotIndex: slot,
    totalBlocks: blocks.length,
    contextLabel: `${clamped}% through article (after paragraph ${slot} of ${blocks.length}): “${snippet}${prevBlock.plainText.length > 90 ? "…" : ""}”`,
  };
}

export function renderInlineFigureHtml(item: InlineImageItem): string {
  if (!item || !item.image) return "";
  const pct = Math.max(0, Math.min(100, Math.round(Number(item.percentage) ?? 50)));
  const src = escapeHtml(item.image);
  const alt = escapeHtml(item.alt || item.caption || "Article inline photo");
  const captionHtml = item.caption
    ? `<figcaption class="px-5 py-3.5 text-sm text-gray-600 font-serif italic bg-white border-t border-gray-200">${escapeHtml(
        item.caption
      )}</figcaption>`
    : "";

  return `
    <figure class="my-12 not-prose bg-white border border-gray-200 border-b-8 border-b-tiger-500 shadow-xl overflow-hidden" data-inline-image-pct="${pct}">
      <img src="${src}" alt="${alt}" class="w-full h-auto max-h-[640px] object-cover" loading="lazy" />
      ${captionHtml}
    </figure>
  `.trim();
}

export function renderMarkdownWithInlineImages(
  markdown: string,
  inlineImages?: InlineImageItem[]
): string {
  const blocks = parseMarkdownBlocks(markdown);
  const validImages = Array.isArray(inlineImages)
    ? inlineImages
        .filter((img) => img && typeof img.image === "string" && img.image.trim().length > 0)
        .map((img) => ({
          ...img,
          percentage: Math.max(0, Math.min(100, Number(img.percentage) ?? 50)),
        }))
        .sort((a, b) => a.percentage - b.percentage)
    : [];

  if (blocks.length === 0) {
    return validImages.map(renderInlineFigureHtml).join("\n");
  }

  const slotMap = new Map<number, InlineImageItem[]>();
  for (const img of validImages) {
    const slot = computeSlotForPercentage(blocks, img.percentage);
    const list = slotMap.get(slot) || [];
    list.push(img);
    slotMap.set(slot, list);
  }

  const out: string[] = [];

  // Slot 0 (before first paragraph)
  const atStart = slotMap.get(0);
  if (atStart) {
    atStart.forEach((img) => out.push(renderInlineFigureHtml(img)));
  }

  for (let i = 0; i < blocks.length; i++) {
    out.push(blocks[i].html);
    const afterThis = slotMap.get(i + 1);
    if (afterThis) {
      afterThis.forEach((img) => out.push(renderInlineFigureHtml(img)));
    }
  }

  return out.join("\n");
}

export function resolveInterviewImage(interview: {
  interviewee?: string;
  coverImage?: string;
}): string {
  if (interview?.coverImage && interview.coverImage.trim().length > 0) {
    return interview.coverImage.trim();
  }
  if (interview?.interviewee && interview.interviewee.trim().length > 0) {
    return `/headshots/${interview.interviewee.trim()}.webp`;
  }
  return "/favicon.svg";
}
