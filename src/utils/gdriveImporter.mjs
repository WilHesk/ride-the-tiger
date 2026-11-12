/**
 * Shared Google Drive Folder & Google Docs Importer for Ride The Tiger (/admin)
 * Works both in Netlify Functions (production) and Vite dev server (local).
 */

export function extractGoogleDriveIds(rawInputUrl) {
  const urlStr = String(rawInputUrl || "").trim();
  if (!urlStr) return { type: null, id: null };

  // 1. Check for Google Drive Folder URL:
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const folderMatch = urlStr.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) {
    return { type: "folder", id: folderMatch[1] };
  }

  // 2. Check for Google Docs Document URL:
  // https://docs.google.com/document/d/DOC_ID/edit
  const docMatch = urlStr.match(/\/document\/d\/([a-zA-Z0-9_-]{10,})/);
  if (docMatch) {
    return { type: "doc", id: docMatch[1] };
  }

  // 3. Check for ?id= parameter
  const idParamMatch = urlStr.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch) {
    return { type: "folder", id: idParamMatch[1] };
  }

  // 4. Bare folder/doc ID
  if (/^[a-zA-Z0-9_-]{18,}$/.test(urlStr)) {
    return { type: "folder", id: urlStr };
  }

  return { type: null, id: null };
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function isImageFilename(name) {
  return /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(String(name || "").trim());
}

function isTextOrDocFilename(name) {
  return /\.(md|markdown|txt|doc|docx|rtf)$/i.test(String(name || "").trim());
}

/**
 * Parses Google Drive's public embeddedfolderview HTML for a shared folder.
 */
export function parseEmbeddedFolderHtml(html) {
  const entries = [];
  const seenIds = new Set();

  // Pattern 1: <div class="flip-entry" id="entry-FILE_ID" ...>
  const entryRegex =
    /<div[^>]*class="[^"]*flip-entry[^"]*"[^>]*id="entry-([a-zA-Z0-9_-]+)"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*flip-entry[^"]*"[^>]*id="entry-|$)/gi;

  let match;
  while ((match = entryRegex.exec(html)) !== null) {
    const fileId = match[1];
    const block = match[2];
    if (!fileId || seenIds.has(fileId)) continue;

    const hrefMatch = block.match(/href="([^"]+)"/i);
    const titleMatch = block.match(
      /<div[^>]*class="[^"]*flip-entry-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/i);

    const href = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : "";
    const title = titleMatch
      ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "").trim())
      : fileId;
    const iconSrc = imgMatch ? decodeHtmlEntities(imgMatch[1]) : "";

    let kind = "unknown";
    if (
      href.includes("docs.google.com/document") ||
      iconSrc.includes("document") ||
      iconSrc.includes("vnd.google-apps.document")
    ) {
      kind = "gdoc";
    } else if (
      isImageFilename(title) ||
      iconSrc.includes("image") ||
      iconSrc.includes("photo")
    ) {
      kind = "image";
    } else if (isTextOrDocFilename(title)) {
      kind = "textfile";
    }

    seenIds.add(fileId);
    entries.push({ id: fileId, name: title, href, kind });
  }

  // Fallback Pattern 2: If Drive returned links with /document/d/ or /file/d/ directly
  if (entries.length === 0) {
    const linkRegex =
      /<a[^>]*href="([^"]*(?:\/document\/d\/|\/file\/d\/)([a-zA-Z0-9_-]{10,})[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let lMatch;
    while ((lMatch = linkRegex.exec(html)) !== null) {
      const href = decodeHtmlEntities(lMatch[1]);
      const fileId = lMatch[2];
      if (!fileId || seenIds.has(fileId)) continue;
      const innerText = decodeHtmlEntities(
        lMatch[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      );
      const name = innerText || fileId;
      let kind = "unknown";
      if (href.includes("/document/d/")) {
        kind = "gdoc";
      } else if (isImageFilename(name)) {
        kind = "image";
      } else if (isTextOrDocFilename(name)) {
        kind = "textfile";
      } else {
        // Assume /file/d/ in an interview folder is an image unless named otherwise
        kind = "image";
      }
      seenIds.add(fileId);
      entries.push({ id: fileId, name, href, kind });
    }
  }

  return entries;
}

async function fetchGoogleDocText(docId) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  // Try Markdown export first (preserves links, bold, headings)
  try {
    const mdUrl = `https://docs.google.com/document/d/${docId}/export?format=md`;
    const res = await fetch(mdUrl, { headers, redirect: "follow" });
    if (res.ok) {
      const text = await res.text();
      if (text && !text.trim().startsWith("<!DOCTYPE html")) {
        return text;
      }
    }
  } catch {
    // fallback to txt
  }

  // Fallback to plain text export
  const txtUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const resTxt = await fetch(txtUrl, { headers, redirect: "follow" });
  if (resTxt.ok) {
    const text = await resTxt.text();
    if (text && !text.trim().startsWith("<!DOCTYPE html")) {
      return text;
    }
  }

  throw new Error(
    "Could not download Google Doc text. Make sure the folder/doc sharing is set to 'Anyone with the link can view'."
  );
}

async function fetchDriveImageBinary(fileId) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  const candidates = [
    `https://drive.google.com/uc?export=download&id=${fileId}`,
    `https://lh3.googleusercontent.com/d/${fileId}=w1600`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/html")) continue;
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength > 200) {
        return {
          arrayBuffer,
          contentType: contentType.startsWith("image/")
            ? contentType
            : "image/jpeg",
        };
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

function cleanPersonOrFolderName(raw) {
  return String(raw || "")
    .replace(/\s*-\s*Google\s+Drive$/i, "")
    .replace(/\s*-\s*Google\s+Docs$/i, "")
    .replace(/\.(md|txt|docx?|jpe?g|png|webp|avif)$/i, "")
    .replace(/\b(interview|copy|final|draft|article|post|rtt|ride the tiger)\b/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function filenameToAlt(filename, interviewee) {
  const base = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/\b\d{1,3}%?\b/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return interviewee ? `Photo of ${interviewee}` : "Interview photo";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function detectPercentageFromFilename(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  // Match explicit "50%" or "50pct" or "50percent"
  const pctMatch = base.match(/(?:^|[_-\s])(\d{1,3})\s*(?:%|pct|percent)(?:$|[_-\s])/i);
  if (pctMatch) {
    const val = parseInt(pctMatch[1], 10);
    if (val >= 0 && val <= 100) return val;
  }
  // Match trailing or leading number like "inline-40" or "65_photo"
  const numMatch = base.match(/(?:inline|pos|at)[_-\s]*(\d{1,3})$/i);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (val >= 0 && val <= 100) return val;
  }
  return null;
}

function inferTagsFromText(text) {
  const lower = String(text || "").toLowerCase();
  const catalog = [
    { tag: "Copywriting", keywords: ["copywriter", "copywriting", "writer", "writing", "words"] },
    { tag: "LinkedIn", keywords: ["linkedin", "algorithm", "feed", "post", "followers"] },
    { tag: "AI Ethics", keywords: ["slop", "fraud", "crook", "ethics", "ban", "declare", "human"] },
    { tag: "Agency Life", keywords: ["agency", "agencies", "client", "junior", "team", "studio"] },
    { tag: "Workflow", keywords: ["workflow", "research", "claude", "perplexity", "chatgpt", "process", "tool"] },
    { tag: "Brand Development", keywords: ["brand", "branding", "tone of voice", "storytelling"] },
    { tag: "Business Strategy", keywords: ["rate", "pricing", "business", "retainer", "mentoring", "revenue"] },
    { tag: "Career Survival", keywords: ["redundanc", "job hunt", "freelance", "surviving", "career", "market"] },
    { tag: "Mental Health", keywords: ["mental health", "anxiety", "depression", "burnout", "vulnerable", "vulnerability"] },
  ];

  const matched = [];
  for (const item of catalog) {
    let score = 0;
    for (const kw of item.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > 0) matched.push({ tag: item.tag, score });
  }

  matched.sort((a, b) => b.score - a.score);
  const top = matched.slice(0, 3).map((m) => m.tag);
  return top.length > 0 ? top : ["Copywriting", "Career Survival"];
}

/**
 * Parses raw Google Doc text + discovered images into a structured Ride The Tiger interview object.
 */
export function parseInterviewCopyAndAssets({
  rawText,
  docTitle = "",
  folderTitle = "",
  images = [],
  folderUrl = "",
}) {
  let text = String(rawText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();

  // Google Docs Markdown export sometimes escapes apostrophes/quotes as \' or \"
  text = text
    .replace(/\\(['"’“”‘’—–-])/g, "$1")
    .replace(/\\\./g, ".");

  const meta = {
    title: "",
    interviewee: "",
    role: "",
    company: "",
    date: new Date().toISOString().split("T")[0],
    readTime: "",
    excerpt: "",
    quote: "",
    tags: [],
  };

  // 1. Check for optional YAML frontmatter or Key: Value metadata header lines at the top
  if (text.startsWith("---")) {
    const endIdx = text.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const fmBlock = text.slice(3, endIdx).trim();
      text = text.slice(endIdx + 4).trim();
      for (const line of fmBlock.split("\n")) {
        const m = line.match(/^([a-zA-Z]+)\s*:\s*(.+)$/);
        if (m) {
          const k = m[1].toLowerCase().trim();
          const v = m[2].trim().replace(/^["']|["']$/g, "");
          if (k === "title") meta.title = v;
          else if (k === "interviewee" || k === "name") meta.interviewee = v;
          else if (k === "role") meta.role = v;
          else if (k === "company") meta.company = v;
          else if (k === "quote") meta.quote = v;
          else if (k === "excerpt") meta.excerpt = v;
          else if (k === "date") meta.date = v;
          else if (k === "tags") {
            meta.tags = v
              .replace(/^\[|\]$/g, "")
              .split(",")
              .map((s) => s.trim().replace(/^["']|["']$/g, ""))
              .filter(Boolean);
          }
        }
      }
    }
  }

  // Also check if top lines are "Key: Value" pairs (e.g. Interviewee: Jane Doe)
  const rawLines = text.split("\n");
  let bodyStartIdx = 0;
  while (bodyStartIdx < Math.min(10, rawLines.length)) {
    const line = rawLines[bodyStartIdx].trim();
    if (!line) {
      bodyStartIdx++;
      continue;
    }
    const kvMatch = line.match(
      /^(?:\*\*)?(Title|Headline|Interviewee|Name|Role|Job Title|Company|Organisation|Organization|Quote|Pull Quote|Excerpt|Summary|Tags|Date)(?:\*\*)?\s*:\s*(.+)$/i
    );
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase();
      const val = kvMatch[2].replace(/\*\*/g, "").trim();
      if (key === "title" || key === "headline") meta.title = val;
      else if (key === "interviewee" || key === "name") meta.interviewee = val;
      else if (key === "role" || key === "job title") meta.role = val;
      else if (key === "company" || key.startsWith("organi")) meta.company = val;
      else if (key === "quote" || key === "pull quote") meta.quote = val.replace(/^[“"‘']|[”"’']$/g, "");
      else if (key === "excerpt" || key === "summary") meta.excerpt = val;
      else if (key === "date") meta.date = val;
      else if (key === "tags") {
        meta.tags = val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      bodyStartIdx++;
    } else {
      break;
    }
  }
  text = rawLines.slice(bodyStartIdx).join("\n").trim();

  // Split into paragraphs
  let paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // If the whole doc had single newlines instead of blank lines between paragraphs
  if (paragraphs.length <= 2 && text.split("\n").length > 6) {
    paragraphs = text
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  // 2. Detect Interviewee if not explicitly set
  if (!meta.interviewee && paragraphs.length > 0) {
    const firstPara = paragraphs[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    // If first line is a short person name (2-4 words, < 35 chars, no sentence punctuation)
    if (
      firstPara.length >= 4 &&
      firstPara.length <= 35 &&
      /^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'-]+){1,3}$/.test(firstPara)
    ) {
      meta.interviewee = firstPara;
      paragraphs.shift();
    }
  }

  if (!meta.interviewee) {
    const fromFolder = cleanPersonOrFolderName(folderTitle);
    const fromDoc = cleanPersonOrFolderName(docTitle);
    if (fromFolder && fromFolder.length >= 3 && fromFolder.length <= 40) {
      meta.interviewee = fromFolder;
    } else if (fromDoc && fromDoc.length >= 3 && fromDoc.length <= 40) {
      meta.interviewee = fromDoc;
    }
  }

  // Check if first line is "# Headline"
  if (!meta.title && paragraphs.length > 0 && /^#{1,2}\s+/.test(paragraphs[0])) {
    meta.title = paragraphs[0]
      .replace(/^#{1,2}\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/^[“"‘']|[”"’']$/g, "")
      .trim();
    paragraphs.shift();
  }

  // 3. Format standalone short subheadings as ### Subheading and look for inline percentage or sentence markers
  const inlineMarkers = [];
  const inlineAfterTexts = [];
  const formattedParagraphs = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    // Check if paragraph is an explicit inline image marker like [image: 40%], [photo: 65%], or bare [image]
    const markerMatch = p.match(/^\[(?:image|photo|img)\s*(?:\d+)?\s*:?\s*(?:(\d{1,3})%?)?\]$/i);
    if (markerMatch) {
      if (markerMatch[1]) {
        inlineMarkers.push(Math.max(0, Math.min(100, parseInt(markerMatch[1], 10))));
        inlineAfterTexts.push("");
      } else {
        const prevPara = formattedParagraphs[formattedParagraphs.length - 1] || "";
        inlineMarkers.push(null);
        inlineAfterTexts.push(prevPara.replace(/^#+\s*/, "").trim());
      }
      continue;
    }

    // Already a markdown heading or horizontal rule
    if (/^#{1,4}\s+/.test(p) || /^(___|---|\*\*\*)$/.test(p)) {
      formattedParagraphs.push(p);
      continue;
    }

    // Detect standalone short subheadings (like 'We’re forgetting it’s ok not to be creative')
    const cleanLine = p.replace(/^\*\*|\*\*$/g, "").trim();
    const isSingleLine = !cleanLine.includes("\n");
    const isShortSubhead =
      isSingleLine &&
      i > 1 &&
      i < paragraphs.length - 1 &&
      cleanLine.length >= 12 &&
      cleanLine.length <= 85 &&
      ((/^[‘'“"][^”"’']+[’'”"]$/.test(cleanLine) && !cleanLine.endsWith(".”") && !cleanLine.endsWith(".\"")) ||
        (/^\*\*[^*]+\*\*$/.test(p) && !cleanLine.endsWith(".")));

    if (isShortSubhead) {
      formattedParagraphs.push(`### ${cleanLine}`);
    } else {
      formattedParagraphs.push(p);
    }
  }

  const bodyMarkdown = formattedParagraphs.join("\n\n");

  // 4. Auto-derive Quote, Title, Excerpt, Role, Company, ReadTime, Tags if not already set
  const allQuotes = [];
  const quoteRegex = /[“"]([^”"]{25,160})[”"]/g;
  let qMatch;
  while ((qMatch = quoteRegex.exec(bodyMarkdown)) !== null) {
    const candidate = qMatch[1].trim();
    if (candidate.split(/\s+/).length >= 5) {
      allQuotes.push(candidate);
    }
  }

  if (!meta.quote) {
    meta.quote =
      allQuotes[0] ||
      "Documenting human creativity and survival in the age of algorithms.";
  }

  if (!meta.title) {
    // Check if there is a ### subheading we can promote, or use a punchy quote
    const subheadMatch = bodyMarkdown.match(/^###\s+(.+)$/m);
    if (subheadMatch) {
      meta.title = subheadMatch[1].replace(/^[‘'“"]|[’'”"]$/g, "").trim();
    } else if (allQuotes.length > 0) {
      const shortQuote = allQuotes.find((q) => q.length >= 20 && q.length <= 80) || allQuotes[0];
      meta.title = shortQuote.replace(/[.,;!?]+$/, "");
    } else if (meta.interviewee) {
      meta.title = `Riding the Tiger with ${meta.interviewee}`;
    } else {
      meta.title = "Creative Survival in the Age of AI";
    }
  }

  if (!meta.excerpt) {
    const firstBodyParas = formattedParagraphs
      .filter((p) => !p.startsWith("#") && !/^(___|---|\*\*\*)$/.test(p))
      .slice(0, 2)
      .join(" ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    meta.excerpt =
      firstBodyParas.length > 180
        ? firstBodyParas.slice(0, 177).trim() + "..."
        : firstBodyParas || meta.quote;
  }

  if (!meta.interviewee) {
    // Check if images have a person's name
    if (images.length > 0) {
      const candidateName = cleanPersonOrFolderName(images[0].name);
      if (candidateName) meta.interviewee = candidateName;
    }
    if (!meta.interviewee) meta.interviewee = "Featured Creative";
  }

  if (!meta.role) {
    meta.role = "Copywriter";
  }
  if (!meta.company) {
    meta.company = "Freelance";
  }

  const wordCount = bodyMarkdown.split(/\s+/).filter(Boolean).length;
  meta.readTime = `${Math.max(1, Math.round(wordCount / 200))} min read`;

  if (!Array.isArray(meta.tags) || meta.tags.length === 0) {
    meta.tags = inferTagsFromText(bodyMarkdown);
  }

  // 5. Classify Main Cover Image vs Inline Images (with percentages!)
  let coverImage = "";
  let coverImageAlt = `Cover image for ${meta.interviewee}`;
  const inlineImages = [];

  if (images.length > 0) {
    const intervieweeLower = meta.interviewee.toLowerCase();
    // Look for an explicit main/cover/hero/interviewee image first
    let mainIdx = images.findIndex((img) => {
      const lower = String(img.name || "").toLowerCase();
      return (
        lower.includes("main") ||
        lower.includes("cover") ||
        lower.includes("hero") ||
        lower.includes("headshot") ||
        (intervieweeLower.length > 3 && lower.includes(intervieweeLower))
      );
    });
    if (mainIdx === -1) mainIdx = 0;

    const mainImg = images[mainIdx];
    coverImage = mainImg.url;
    coverImageAlt = `Cover image for ${meta.interviewee}`;

    const remaining = images.filter((_, idx) => idx !== mainIdx);
    remaining.forEach((img, idx) => {
      const explicitPct =
        detectPercentageFromFilename(img.name) ??
        inlineMarkers[idx] ??
        Math.round(((idx + 1) / (remaining.length + 1)) * 100);

      inlineImages.push({
        image: img.url,
        alt: filenameToAlt(img.name, meta.interviewee),
        caption: "",
        percentage: explicitPct,
        afterText: inlineAfterTexts[idx] || "",
      });
    });
  } else {
    coverImage = `/headshots/${meta.interviewee}.webp`;
  }

  const slug = slugify(meta.interviewee || meta.title) || `interview-${Date.now()}`;

  return {
    slug,
    title: meta.title,
    interviewee: meta.interviewee,
    role: meta.role,
    company: meta.company,
    date: meta.date,
    readTime: meta.readTime,
    excerpt: meta.excerpt,
    quote: meta.quote,
    tags: meta.tags,
    coverImage,
    coverImageAlt,
    inlineImages,
    body: bodyMarkdown,
    googleDriveFolderUrl: folderUrl,
  };
}

/**
 * Fetches a Google Drive folder (or single Google Doc) by URL, downloads the copy and images,
 * stores the images via `saveImageCallback(filename, arrayBuffer, contentType)`,
 * and returns the parsed interview post + discovered files.
 */
export async function importFromGoogleDriveUrl(rawUrl, saveImageCallback) {
  const { type, id } = extractGoogleDriveIds(rawUrl);
  if (!type || !id) {
    throw new Error(
      "Please paste a valid Google Drive folder link (https://drive.google.com/drive/folders/...) or Google Doc link (https://docs.google.com/document/d/...)."
    );
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  if (type === "doc") {
    const rawText = await fetchGoogleDocText(id);
    const interview = parseInterviewCopyAndAssets({
      rawText,
      docTitle: "",
      folderTitle: "",
      images: [],
      folderUrl: rawUrl,
    });
    return {
      interview,
      filesFound: [{ id, name: "Google Doc Copy", kind: "gdoc" }],
    };
  }

  // Type === "folder"
  let folderTitle = "";
  try {
    const folderPageRes = await fetch(
      `https://drive.google.com/drive/folders/${id}`,
      { headers, redirect: "follow" }
    );
    if (folderPageRes.ok) {
      const folderPageHtml = await folderPageRes.text();
      const titleMatch = folderPageHtml.match(/<title>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        folderTitle = decodeHtmlEntities(titleMatch[1].trim());
      }
    }
  } catch {
    // ignore folder title error
  }

  const embedUrl = `https://drive.google.com/embeddedfolderview?id=${id}#list`;
  const embedRes = await fetch(embedUrl, { headers, redirect: "follow" });
  if (!embedRes.ok) {
    throw new Error(
      `Could not access Google Drive folder (HTTP ${embedRes.status}). Make sure the folder is shared with 'Anyone with the link'.`
    );
  }

  const embedHtml = await embedRes.text();
  if (!folderTitle) {
    const tMatch = embedHtml.match(/<title>([\s\S]*?)<\/title>/i);
    if (tMatch) folderTitle = decodeHtmlEntities(tMatch[1].trim());
  }

  const entries = parseEmbeddedFolderHtml(embedHtml);
  if (entries.length === 0) {
    throw new Error(
      "No files were found inside this Google Drive folder, or the folder is restricted. Please ensure the folder sharing is set to 'Anyone with the link can view'."
    );
  }

  const docEntries = entries.filter(
    (e) => e.kind === "gdoc" || e.kind === "textfile"
  );
  const imageEntries = entries.filter((e) => e.kind === "image");

  // If no explicit doc entry was classified, check if any unknown entry is actually a Google Doc
  if (docEntries.length === 0) {
    const unknownEntries = entries.filter((e) => e.kind === "unknown");
    for (const u of unknownEntries) {
      if (!isImageFilename(u.name)) {
        docEntries.push(u);
      } else {
        imageEntries.push(u);
      }
    }
  }

  let combinedDocText = "";
  let docTitle = "";

  for (const docEntry of docEntries) {
    try {
      if (docEntry.kind === "gdoc" || docEntry.href.includes("/document/d/")) {
        const text = await fetchGoogleDocText(docEntry.id);
        if (text && text.trim()) {
          combinedDocText += (combinedDocText ? "\n\n" : "") + text.trim();
          if (!docTitle) docTitle = docEntry.name;
        }
      } else {
        const dlRes = await fetch(
          `https://drive.google.com/uc?export=download&id=${docEntry.id}`,
          { headers, redirect: "follow" }
        );
        if (dlRes.ok) {
          const text = await dlRes.text();
          if (text && !text.trim().startsWith("<!DOCTYPE html")) {
            combinedDocText += (combinedDocText ? "\n\n" : "") + text.trim();
            if (!docTitle) docTitle = docEntry.name;
          }
        }
      }
    } catch {
      // continue trying other doc entries
    }
  }

  if (!combinedDocText) {
    // Try fetching the first entry as a Google Doc just in case
    for (const entry of entries) {
      if (imageEntries.includes(entry)) continue;
      try {
        const text = await fetchGoogleDocText(entry.id);
        if (text && text.trim()) {
          combinedDocText = text.trim();
          docTitle = entry.name;
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!combinedDocText) {
    throw new Error(
      "Found the Google Drive folder, but could not read a Google Doc or text file inside it. Make sure the folder contains a Google Doc with the interview copy."
    );
  }

  // Download and save all images in the folder
  const savedImages = [];
  for (const imgEntry of imageEntries) {
    const binaryData = await fetchDriveImageBinary(imgEntry.id);
    if (binaryData && saveImageCallback) {
      const ext =
        imgEntry.name.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[0] || ".jpg";
      const baseSafe = String(imgEntry.name || imgEntry.id)
        .replace(/\.[^.]+$/, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-");
      const finalFilename = `${baseSafe}${ext.toLowerCase()}`;

      const hostedUrl = await saveImageCallback(
        finalFilename,
        binaryData.arrayBuffer,
        binaryData.contentType
      );
      savedImages.push({
        id: imgEntry.id,
        name: imgEntry.name,
        url: hostedUrl,
      });
    }
  }

  const interview = parseInterviewCopyAndAssets({
    rawText: combinedDocText,
    docTitle,
    folderTitle,
    images: savedImages,
    folderUrl: rawUrl,
  });

  return {
    interview,
    filesFound: entries,
    savedImages,
  };
}
