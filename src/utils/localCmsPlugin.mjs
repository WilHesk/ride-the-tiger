import fs from "node:fs";
import path from "node:path";
import {
  importFromGoogleDriveUrl,
  parseInterviewCopyAndAssets,
} from "./gdriveImporter.mjs";

function sanitizeFilename(raw) {
  return String(raw || "image.jpg")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function serializeInterviewToMarkdown(item) {
  const esc = (str) =>
    String(str ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, " ");

  const dateStr = String(item.date || new Date().toISOString())
    .split("T")[0]
    .trim();
  const tags = Array.isArray(item.tags) ? item.tags : ["Copywriting"];
  const inlineImages = Array.isArray(item.inlineImages)
    ? item.inlineImages.filter((img) => img && img.image)
    : [];

  const lines = [
    "---",
    `title: "${esc(item.title)}"`,
    `interviewee: "${esc(item.interviewee)}"`,
    `role: "${esc(item.role || "Copywriter")}"`,
    `company: "${esc(item.company || "Freelance")}"`,
    `date: ${dateStr}`,
    `readTime: "${esc(item.readTime || "5 min read")}"`,
    `excerpt: "${esc(item.excerpt || "")}"`,
    `quote: "${esc(item.quote || "")}"`,
    `tags: [${tags.map((t) => `"${esc(t)}"`).join(", ")}]`,
  ];

  if (item.coverImage) {
    lines.push(`coverImage: "${esc(item.coverImage)}"`);
  }
  if (item.coverImageAlt) {
    lines.push(`coverImageAlt: "${esc(item.coverImageAlt)}"`);
  }
  if (typeof item.order === "number") {
    lines.push(`order: ${item.order}`);
  }
  if (item.googleDriveFolderUrl) {
    lines.push(`googleDriveFolderUrl: "${esc(item.googleDriveFolderUrl)}"`);
  }
  if (inlineImages.length > 0) {
    lines.push("inlineImages:");
    for (const img of inlineImages) {
      lines.push(`  - image: "${esc(img.image)}"`);
      lines.push(`    alt: "${esc(img.alt || "")}"`);
      lines.push(`    caption: "${esc(img.caption || "")}"`);
      lines.push(
        `    percentage: ${Math.max(0, Math.min(100, Math.round(Number(img.percentage) ?? 50)))}`
      );
      if (img.afterText) {
        lines.push(`    afterText: "${esc(img.afterText)}"`);
      }
    }
  }

  lines.push("---", "", String(item.body || "").trim(), "");
  return lines.join("\n");
}

export function rttLocalCmsPlugin() {
  const rootDir = process.cwd();
  const uploadsDir = path.join(rootDir, "public", "uploads");
  const stateFile = path.join(uploadsDir, "_cms-state.json");
  const interviewsDir = path.join(rootDir, "src", "content", "interviews");

  function ensureUploadsDir() {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  }

  function readState() {
    try {
      if (fs.existsSync(stateFile)) {
        return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
      }
    } catch {
      // ignore
    }
    return {
      interviews: null,
      siteContent: null,
      adminAccounts: null,
      analytics: {
        ga4MeasurementId: "",
        pageviews: 0,
        pageCounts: {},
        ctaClicks: [],
      },
    };
  }

  function writeState(state) {
    ensureUploadsDir();
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
  }

  function syncInterviewsToMarkdownFiles(items) {
    try {
      if (!fs.existsSync(interviewsDir)) {
        fs.mkdirSync(interviewsDir, { recursive: true });
      }
      const validSlugs = new Set();
      for (const item of items) {
        if (!item || !item.slug) continue;
        const safeSlug = String(item.slug)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-");
        validSlugs.add(`${safeSlug}.md`);
        const mdPath = path.join(interviewsDir, `${safeSlug}.md`);
        const nextMd = serializeInterviewToMarkdown(item);
        const existingMd = fs.existsSync(mdPath)
          ? fs.readFileSync(mdPath, "utf-8")
          : null;
        if (existingMd !== nextMd) {
          fs.writeFileSync(mdPath, nextMd, "utf-8");
        }
      }
    } catch {
      // ignore fs errors
    }
  }

  function createMiddleware() {
    return async (req, res, next) => {
      if (!req.url || !req.url.startsWith("/__cms-sync")) {
        return next();
      }

      if (req.method === "GET") {
        const state = readState();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.end(
          JSON.stringify({
            ok: true,
            interviews: state.interviews,
            siteContent: state.siteContent,
            adminAccounts: state.adminAccounts,
            analytics: state.analytics,
          })
        );
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const payload = JSON.parse(body || "{}");
            const state = readState();

            if (
              payload.action === "sync-interviews" &&
              Array.isArray(payload.items)
            ) {
              state.interviews = payload.items;
              writeState(state);
              syncInterviewsToMarkdownFiles(payload.items);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({ ok: true, count: payload.items.length })
              );
              return;
            }

            if (payload.action === "sync-site-content" && payload.content) {
              state.siteContent = payload.content;
              writeState(state);
              try {
                const siteJsonPath = path.join(
                  rootDir,
                  "src",
                  "data",
                  "site-content.json"
                );
                fs.writeFileSync(
                  siteJsonPath,
                  JSON.stringify(payload.content, null, 2),
                  "utf-8"
                );
              } catch {
                // ignore
              }
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            if (
              payload.action === "sync-admin-accounts" &&
              Array.isArray(payload.accounts)
            ) {
              state.adminAccounts = payload.accounts;
              writeState(state);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({ ok: true, count: payload.accounts.length })
              );
              return;
            }

            if (
              payload.action === "upload-image" &&
              payload.dataUrl &&
              payload.filename
            ) {
              ensureUploadsDir();
              const safeName = sanitizeFilename(payload.filename);
              const match = String(payload.dataUrl).match(
                /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/
              );
              if (!match) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({ ok: false, error: "Invalid image data URL" })
                );
                return;
              }
              const buf = Buffer.from(match[2], "base64");
              fs.writeFileSync(path.join(uploadsDir, safeName), buf);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({ ok: true, url: `/uploads/${safeName}` })
              );
              return;
            }

            if (
              payload.action === "import-gdrive-folder" &&
              payload.folderUrl
            ) {
              ensureUploadsDir();
              const saveLocalImage = async (filename, arrayBuffer) => {
                const safeName = sanitizeFilename(filename);
                const buf = Buffer.from(arrayBuffer);
                fs.writeFileSync(path.join(uploadsDir, safeName), buf);
                return `/uploads/${safeName}`;
              };

              const result = await importFromGoogleDriveUrl(
                payload.folderUrl,
                saveLocalImage
              );
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, ...result }));
              return;
            }

            if (payload.action === "parse-raw-copy" && payload.rawText) {
              const interview = parseInterviewCopyAndAssets({
                rawText: payload.rawText,
                docTitle: payload.docTitle || "",
                folderTitle: payload.folderTitle || "",
                images: Array.isArray(payload.images) ? payload.images : [],
                folderUrl: payload.folderUrl || "",
              });
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, interview }));
              return;
            }

            if (payload.action === "save-ga4-id") {
              state.analytics = state.analytics || {
                ga4MeasurementId: "",
                pageviews: 0,
                pageCounts: {},
                ctaClicks: [],
              };
              state.analytics.ga4MeasurementId = String(
                payload.ga4MeasurementId || ""
              )
                .trim()
                .toUpperCase();
              writeState(state);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: true,
                  ga4MeasurementId: state.analytics.ga4MeasurementId,
                })
              );
              return;
            }

            if (payload.action === "record-analytics") {
              state.analytics = state.analytics || {
                ga4MeasurementId: "",
                pageviews: 0,
                pageCounts: {},
                ctaClicks: [],
              };
              if (payload.eventType === "page_view") {
                const page = String(payload.page || "/").split("?")[0] || "/";
                state.analytics.pageviews =
                  Number(state.analytics.pageviews || 0) + 1;
                state.analytics.pageCounts = state.analytics.pageCounts || {};
                state.analytics.pageCounts[page] =
                  Number(state.analytics.pageCounts[page] || 0) + 1;
              } else if (payload.eventType === "cta_click" && payload.event) {
                state.analytics.ctaClicks = Array.isArray(
                  state.analytics.ctaClicks
                )
                  ? state.analytics.ctaClicks
                  : [];
                state.analytics.ctaClicks.unshift(payload.event);
                state.analytics.ctaClicks = state.analytics.ctaClicks.slice(
                  0,
                  100
                );
              }
              writeState(state);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Invalid action" }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : "Server error",
              })
            );
          }
        });
        return;
      }

      next();
    };
  }

  return {
    name: "rtt-local-cms-plugin",
    configureServer(server) {
      server.middlewares.use(createMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMiddleware());
    },
  };
}
