import { getStore } from "@netlify/blobs";
import {
  importFromGoogleDriveUrl,
  parseInterviewCopyAndAssets,
} from "../../src/utils/gdriveImporter.mjs";
import {
  generateArticleNarrationMp3,
  DEFAULT_TTS_VOICE,
} from "../../src/utils/ttsGenerator.mjs";

const STORE_NAME = "rtt-cms";

function sanitizeFilename(raw) {
  return String(raw || "image.jpg")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

export default async (req, context) => {
  const url = new URL(req.url);
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  // 1. Serve uploaded / Google-Drive-imported photos from Netlify Blobs at /uploads/:filename
  if (url.pathname.startsWith("/uploads/") && req.method === "GET") {
    const rawFilename =
      context?.params?.filename || url.pathname.replace(/^\/uploads\//, "");
    const safeName = sanitizeFilename(decodeURIComponent(rawFilename));

    const entry = await store.getWithMetadata(`upload:${safeName}`, {
      type: "arrayBuffer",
      consistency: "strong",
    });

    if (entry === null || !entry.data) {
      return new Response("Image not found", { status: 404 });
    }

    const contentType =
      (entry.metadata && entry.metadata.contentType) ||
      (safeName.endsWith(".mp3") ? "audio/mpeg" : "image/jpeg");

    const bytes = new Uint8Array(entry.data);
    const totalLength = bytes.byteLength;
    const rangeHeader = req.headers.get("range");

    if (rangeHeader && String(contentType).startsWith("audio/")) {
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? Math.min(totalLength - 1, parseInt(m[2], 10)) : totalLength - 1;
        if (start >= 0 && start <= end && end < totalLength) {
          const slice = bytes.slice(start, end + 1);
          return new Response(slice, {
            status: 206,
            headers: {
              "Content-Type": String(contentType),
              "Content-Range": `bytes ${start}-${end}/${totalLength}`,
              "Content-Length": String(slice.byteLength),
              "Accept-Ranges": "bytes",
              "Cache-Control": "public, max-age=3600",
            },
          });
        }
      }
    }

    return new Response(entry.data, {
      status: 200,
      headers: {
        "Content-Type": String(contentType),
        "Content-Length": String(totalLength),
        "Accept-Ranges": "bytes",
        "Cache-Control": safeName.endsWith(".mp3")
          ? "public, max-age=3600"
          : "public, max-age=31536000, immutable",
      },
    });
  }

  // 2. GET /__cms-sync — Return live CMS state to any visitor browser
  if (req.method === "GET") {
    try {
      const [interviews, siteContent, adminAccounts, analytics] =
        await Promise.all([
          store.get("state:interviews", {
            type: "json",
            consistency: "strong",
          }),
          store.get("state:site-content", {
            type: "json",
            consistency: "strong",
          }),
          store.get("state:admin-accounts", {
            type: "json",
            consistency: "strong",
          }),
          store.get("state:analytics", {
            type: "json",
            consistency: "strong",
          }),
        ]);

      return Response.json(
        {
          ok: true,
          interviews: Array.isArray(interviews) ? interviews : null,
          siteContent: siteContent || null,
          adminAccounts: Array.isArray(adminAccounts) ? adminAccounts : null,
          analytics: analytics || {
            ga4MeasurementId: "",
            pageviews: 0,
            pageCounts: {},
            ctaClicks: [],
          },
        },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    } catch (err) {
      return Response.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Read error",
        },
        { status: 500 }
      );
    }
  }

  // 3. POST /__cms-sync — Persist CMS edits, uploaded photos, & Google Drive folder imports
  if (req.method === "POST") {
    try {
      const payload = await req.json();

      if (payload.action === "sync-interviews" && Array.isArray(payload.items)) {
        await store.setJSON("state:interviews", payload.items);
        return Response.json({ ok: true, count: payload.items.length });
      }

      if (payload.action === "sync-site-content" && payload.content) {
        await store.setJSON("state:site-content", payload.content);
        return Response.json({ ok: true });
      }

      if (
        payload.action === "sync-admin-accounts" &&
        Array.isArray(payload.accounts)
      ) {
        const sanitized = payload.accounts.map((acc) => ({
          email: String(acc.email || "").trim().toLowerCase(),
          name: String(acc.name || "Wil Hesketh").trim(),
          passwordHash: String(acc.passwordHash || ""),
          salt: String(acc.salt || ""),
          verified: Boolean(acc.verified),
          updatedAt: String(acc.updatedAt || new Date().toISOString()),
        }));
        await store.setJSON("state:admin-accounts", sanitized);
        return Response.json({ ok: true, count: sanitized.length });
      }

      if (
        payload.action === "upload-image" &&
        payload.dataUrl &&
        payload.filename
      ) {
        const safeName = sanitizeFilename(payload.filename);
        const match = String(payload.dataUrl).match(
          /^data:((?:image|audio)\/[a-zA-Z0-9+.-]+);base64,(.+)$/
        );
        if (!match) {
          return Response.json(
            { ok: false, error: "Invalid image or audio data URL" },
            { status: 400 }
          );
        }

        const contentType = match[1];
        const binary = Buffer.from(match[2], "base64");
        const arrayBuf = binary.buffer.slice(
          binary.byteOffset,
          binary.byteOffset + binary.byteLength
        );

        await store.set(`upload:${safeName}`, arrayBuf, {
          metadata: { contentType, filename: safeName },
        });

        return Response.json({ ok: true, url: `/uploads/${safeName}` });
      }

      if (payload.action === "generate-audio" && payload.body) {
        const voice = payload.voice || DEFAULT_TTS_VOICE;
        const rawSlug = sanitizeFilename(payload.slug || `interview-${Date.now()}`).replace(
          /\.mp3$/i,
          ""
        );
        const safeAudioName = `${rawSlug}-narration.mp3`;

        const savedTtsKeys =
          (await store.get("state:tts-keys", {
            type: "json",
            consistency: "strong",
          })) || {};
        const elevenLabsApiKey =
          payload.elevenLabsApiKey || savedTtsKeys.elevenLabsApiKey || "";
        const openAiApiKey =
          payload.openAiApiKey || savedTtsKeys.openAiApiKey || "";

        if (payload.elevenLabsApiKey || payload.openAiApiKey) {
          await store.setJSON("state:tts-keys", {
            elevenLabsApiKey,
            openAiApiKey,
          });
        }

        const { buffer, engine } = await generateArticleNarrationMp3(
          payload.body,
          voice,
          {
            elevenLabsApiKey,
            openAiApiKey,
          }
        );
        const arrayBuf = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        await store.set(`upload:${safeAudioName}`, arrayBuf, {
          metadata: { contentType: "audio/mpeg", filename: safeAudioName },
        });

        return Response.json({
          ok: true,
          audioUrl: `/uploads/${safeAudioName}`,
          audioVoice: voice,
          engine,
        });
      }

      if (payload.action === "import-gdrive-folder" && payload.folderUrl) {
        const saveImageToBlobs = async (filename, arrayBuffer, contentType) => {
          const safeName = sanitizeFilename(filename);
          await store.set(`upload:${safeName}`, arrayBuffer, {
            metadata: { contentType, filename: safeName },
          });
          return `/uploads/${safeName}`;
        };

        const result = await importFromGoogleDriveUrl(
          payload.folderUrl,
          saveImageToBlobs
        );

        if (result?.interview?.body) {
          try {
            const savedTtsKeys =
              (await store.get("state:tts-keys", {
                type: "json",
                consistency: "strong",
              })) || {};
            const voice = DEFAULT_TTS_VOICE;
            const rawSlug = sanitizeFilename(result.interview.slug || "interview").replace(
              /\.mp3$/i,
              ""
            );
            const safeAudioName = `${rawSlug}-narration.mp3`;
            const { buffer } = await generateArticleNarrationMp3(
              result.interview.body,
              voice,
              {
                elevenLabsApiKey:
                  payload.elevenLabsApiKey || savedTtsKeys.elevenLabsApiKey || "",
                openAiApiKey:
                  payload.openAiApiKey || savedTtsKeys.openAiApiKey || "",
              }
            );
            const arrayBuf = buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength
            );
            await store.set(`upload:${safeAudioName}`, arrayBuf, {
              metadata: { contentType: "audio/mpeg", filename: safeAudioName },
            });
            result.interview.audioUrl = `/uploads/${safeAudioName}`;
            result.interview.audioVoice = voice;
          } catch {
            // Audio can still be generated on demand or via browser Web Speech fallback
          }
        }

        return Response.json({
          ok: true,
          ...result,
        });
      }

      if (payload.action === "parse-raw-copy" && payload.rawText) {
        const interview = parseInterviewCopyAndAssets({
          rawText: payload.rawText,
          docTitle: payload.docTitle || "",
          folderTitle: payload.folderTitle || "",
          images: Array.isArray(payload.images) ? payload.images : [],
          folderUrl: payload.folderUrl || "",
        });

        if (interview?.body) {
          try {
            const voice = DEFAULT_TTS_VOICE;
            const rawSlug = sanitizeFilename(interview.slug || "interview").replace(
              /\.mp3$/i,
              ""
            );
            const safeAudioName = `${rawSlug}-narration.mp3`;
            const { buffer } = await generateArticleNarrationMp3(
              interview.body,
              voice
            );
            const arrayBuf = buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength
            );
            await store.set(`upload:${safeAudioName}`, arrayBuf, {
              metadata: { contentType: "audio/mpeg", filename: safeAudioName },
            });
            interview.audioUrl = `/uploads/${safeAudioName}`;
            interview.audioVoice = voice;
          } catch {
            // fallback
          }
        }

        return Response.json({ ok: true, interview });
      }

      if (payload.action === "save-ga4-id") {
        const current = (await store.get("state:analytics", {
          type: "json",
          consistency: "strong",
        })) || {
          ga4MeasurementId: "",
          pageviews: 0,
          pageCounts: {},
          ctaClicks: [],
        };
        current.ga4MeasurementId = String(payload.ga4MeasurementId || "")
          .trim()
          .toUpperCase();
        await store.setJSON("state:analytics", current);
        return Response.json({
          ok: true,
          ga4MeasurementId: current.ga4MeasurementId,
        });
      }

      if (payload.action === "record-analytics") {
        const current = (await store.get("state:analytics", {
          type: "json",
          consistency: "strong",
        })) || {
          ga4MeasurementId: "",
          pageviews: 0,
          pageCounts: {},
          ctaClicks: [],
        };

        if (payload.eventType === "page_view") {
          const page = String(payload.page || "/").split("?")[0] || "/";
          current.pageviews = Number(current.pageviews || 0) + 1;
          current.pageCounts = current.pageCounts || {};
          current.pageCounts[page] = Number(current.pageCounts[page] || 0) + 1;
        } else if (payload.eventType === "cta_click" && payload.event) {
          current.ctaClicks = Array.isArray(current.ctaClicks)
            ? current.ctaClicks
            : [];
          current.ctaClicks.unshift({
            page: String(payload.event.page || "/"),
            source: String(payload.event.source || "unknown"),
            destination: String(payload.event.destination || "/interviews"),
            timestamp: String(
              payload.event.timestamp || new Date().toISOString()
            ),
          });
          current.ctaClicks = current.ctaClicks.slice(0, 100);
        }

        await store.setJSON("state:analytics", current);
        return Response.json({ ok: true });
      }

      return Response.json(
        { ok: false, error: "Invalid action" },
        { status: 400 }
      );
    } catch (err) {
      return Response.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Sync error",
        },
        { status: 500 }
      );
    }
  }

  return Response.json(
    { ok: false, error: "Method not allowed" },
    { status: 405 }
  );
};

export const config = {
  path: ["/__cms-sync", "/uploads/:filename"],
  preferStatic: true,
};
