import { getStore } from "@netlify/blobs";

const STORE_NAME = "rtt-cms";

function escapeAttr(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDynamicLlmsTxt(siteContent, interviews) {
  const seo = siteContent?.seo || {};
  const siteName = seo.siteName || "Ride The Tiger";
  const aeoSummary =
    seo.aeoSummary ||
    "Documenting human creativity in the age of algorithms. An editorial interview series on creative survival — unfiltered conversations with copywriters, agency owners, and creative professionals navigating AI, platform algorithms, and the future of creative work.";
  const aeoDetail =
    seo.aeoDetail ||
    "Ride The Tiger publishes long-form peer interviews (5–8 min reads) with working creatives — copywriters, agency founders, freelancers — discussing how they're adapting their careers, craft, and business strategy in response to AI and algorithmic platforms like LinkedIn.";

  const lines = [
    `# ${siteName}`,
    "",
    `> ${aeoSummary}`,
    "",
    aeoDetail,
    "",
    "## Interviews",
    "",
  ];

  const categories = new Set();
  const list = Array.isArray(interviews) ? interviews : [];
  for (const item of list) {
    if (!item || !item.slug || !item.title) continue;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    tags.forEach((t) => categories.add(t));
    const url = `https://ride-the-tiger.netlify.app/interviews/${item.slug}`;
    const rolePart = item.role ? `, ${item.role}` : "";
    const summaryPart = item.excerpt || item.quote || "";
    const topicsPart = tags.length > 0 ? ` Topics: ${tags.join(", ")}.` : "";
    lines.push(
      `- [${item.title}](${url}): ${item.interviewee || ""}${rolePart} — ${summaryPart}${topicsPart}`
    );
  }

  lines.push("", "## Categories", "");
  lines.push(Array.from(categories).sort().join(", "));
  lines.push(
    "",
    "## About",
    "",
    "- [About Ride The Tiger](https://ride-the-tiger.netlify.app/about): background on the publication and its mission."
  );

  return lines.join("\n");
}

export default async (request, context) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return;
  }

  const url = new URL(request.url);
  const cleanPath = url.pathname.replace(/\/+$/, "") || "/";

  let siteContent = null;
  let interviews = null;
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const [rawSite, rawInterviews] = await Promise.all([
      store.get("state:site-content", { type: "json", consistency: "strong" }),
      store.get("state:interviews", { type: "json", consistency: "strong" }),
    ]);
    siteContent = rawSite || null;
    interviews = Array.isArray(rawInterviews) ? rawInterviews : null;
  } catch {
    siteContent = null;
    interviews = null;
  }

  if (cleanPath === "/llms.txt") {
    if (!siteContent && !interviews) return;
    return new Response(buildDynamicLlmsTxt(siteContent, interviews), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  if (!siteContent && !interviews) {
    return response;
  }

  const seo = siteContent?.seo || {};
  let pageTitle = "";
  let pageDesc = "";
  let shareImg = seo.shareImage || "/headshots/Joe Emery.webp";
  let keywords = seo.keywords || "";
  let customSchema = null;

  if (cleanPath.startsWith("/interviews/") && Array.isArray(interviews)) {
    const slug = decodeURIComponent(cleanPath.replace(/^\/interviews\//, ""));
    const match = interviews.find((i) => i && i.slug === slug);
    if (match) {
      pageTitle = `${match.title} | ${seo.siteName || "Ride The Tiger"}`;
      const rawDesc = match.excerpt || match.quote || "";
      pageDesc =
        rawDesc.length > 155 ? rawDesc.substring(0, 152) + "..." : rawDesc;
      shareImg =
        match.coverImage ||
        (match.interviewee ? `/headshots/${match.interviewee}.webp` : shareImg);
      if (Array.isArray(match.tags) && match.tags.length > 0) {
        keywords = match.tags.join(", ");
      }
      customSchema = {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Article",
            headline: match.title,
            description: pageDesc,
            image: new URL(shareImg, url.origin).href,
            datePublished: match.date || new Date().toISOString(),
            author: {
              "@type": "Person",
              name: siteContent?.global?.authorName || "William Hesketh",
            },
          },
          {
            "@type": "Person",
            name: match.interviewee,
            jobTitle: match.role || "Copywriter",
            worksFor: {
              "@type": "Organization",
              name: match.company || "Freelance",
            },
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: url.origin,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Interviews",
                item: new URL("/interviews", url.origin).href,
              },
              {
                "@type": "ListItem",
                position: 3,
                name: match.title,
                item: new URL(cleanPath, url.origin).href,
              },
            ],
          },
        ],
      };
    }
  } else {
    const pageTitles = {
      "/": seo.homeTitle,
      "/interviews": seo.interviewsTitle,
      "/about": seo.aboutTitle,
    };
    const pageDescs = {
      "/": seo.homeDescription,
      "/interviews": seo.interviewsDescription,
      "/about": seo.aboutDescription,
    };
    pageTitle = pageTitles[cleanPath] || "";
    pageDesc = pageDescs[cleanPath] || "";
  }

  let html = await response.text();

  if (pageTitle) {
    html = html.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escapeAttr(pageTitle)}</title>`
    );
  }

  const replaceMeta = (attrName, attrVal, newContent) => {
    if (!newContent) return;
    const escaped = escapeAttr(newContent);
    const re = new RegExp(
      `(<meta\\s+[^>]*${attrName}=["']${attrVal}["'][^>]*content=["'])([^"']*)(["'][^>]*>)`,
      "i"
    );
    if (re.test(html)) {
      html = html.replace(re, `$1${escaped}$3`);
    }
  };

  if (pageDesc) {
    replaceMeta("name", "description", pageDesc);
    replaceMeta("property", "og:description", pageDesc);
    replaceMeta("property", "twitter:description", pageDesc);
  }
  if (pageTitle) {
    replaceMeta("property", "og:title", pageTitle);
    replaceMeta("property", "twitter:title", pageTitle);
  }
  if (keywords) {
    replaceMeta("name", "keywords", keywords);
  }
  if (shareImg) {
    const absShareImg = new URL(shareImg, url.origin).href;
    replaceMeta("property", "og:image", absShareImg);
    replaceMeta("property", "twitter:image", absShareImg);
  }

  if (customSchema) {
    html = html.replace(
      /<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/i,
      `<script type="application/ld+json">${JSON.stringify(customSchema)}</script>`
    );
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");

  return new Response(html, {
    status: response.status,
    headers,
  });
};

export const config = {
  path: [
    "/",
    "/interviews",
    "/interviews/*",
    "/about",
    "/about/",
    "/llms.txt",
  ],
};
