/**
 * Automatic Article Narration (TTS MP3 Generator) for Ride The Tiger
 * - Default Voice: UK Female (`en-GB-SoniaNeural` / `en-GB`)
 * - Mode: Jumps straight into the body of the interview (skips headline/metadata)
 * - Uses pure Node.js (`node:https`, `node:crypto`, and `fetch`) so it runs in
 *   both Netlify Functions and local Astro dev/build without native binary dependencies.
 */

import crypto from "node:crypto";
import https from "node:https";

export const DEFAULT_TTS_VOICE = "en-GB-SoniaNeural";

export const AVAILABLE_TTS_VOICES = [
  {
    id: "en-GB-SoniaNeural",
    label: "UK Female — Sonia (Default Editorial)",
    lang: "en-GB",
    tl: "en-GB",
  },
  {
    id: "en-GB-LibbyNeural",
    label: "UK Female — Libby (Warm Conversational)",
    lang: "en-GB",
    tl: "en-GB",
  },
  {
    id: "en-GB-MaisieNeural",
    label: "UK Female — Maisie (Bright)",
    lang: "en-GB",
    tl: "en-GB",
  },
  {
    id: "en-GB-RyanNeural",
    label: "UK Male — Ryan",
    lang: "en-GB",
    tl: "en-GB",
  },
  {
    id: "en-US-AvaNeural",
    label: "US Female — Ava",
    lang: "en-US",
    tl: "en-US",
  },
];

/**
 * Strips Markdown formatting, inline image markers, and links from the interview body
 * so the narrator reads the body prose naturally from the first sentence.
 */
export function cleanMarkdownForNarration(markdownBody) {
  let text = String(markdownBody || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  // Remove YAML frontmatter if accidentally passed
  text = text.replace(/^---\n[\s\S]*?\n---\n*/, "");

  // Remove inline image markers like [image: 50%] or [photo]
  text = text.replace(/\[(?:image|photo|img)\s*(?:\d+)?\s*:?\s*(?:\d{1,3}%?)?\]/gi, "");

  // Replace Markdown links [label](url) with just label
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove horizontal rule lines
  text = text.replace(/^\s*(?:___|---|\*\*\*)\s*$/gm, "");

  // Format headings so there is a natural sentence pause after them
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_m, headingText) => {
    const cleaned = headingText
      .replace(/\*\*/g, "")
      .replace(/^[‘'“"]+|[’'”"]+$/g, "")
      .trim();
    if (!cleaned) return "";
    return /[.!?]$/.test(cleaned) ? `${cleaned}\n` : `${cleaned}.\n`;
  });

  // Remove bold/italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1$2");

  // Clean up parenthetical brackets like [I've had thoughts like] -> I've had thoughts like
  text = text.replace(/\[([^\]]+)\]/g, "$1");

  // Normalize typography for smooth TTS pronunciation
  text = text
    .replace(/\u2026/g, "...")
    .replace(/[\u2014\u2013]/g, ", ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * Splits cleaned article body text into natural sentence chunks under `maxChars`.
 */
export function splitTextIntoSentenceChunks(text, maxChars = 185) {
  const paragraphs = String(text || "")
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks = [];

  for (const para of paragraphs) {
    // Split on sentence boundaries (. ! ? followed by space or quote)
    const sentences = para
      .split(/(?<=[.!?]['"”’)]*)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    let current = "";
    for (const sentence of sentences) {
      if (sentence.length > maxChars) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        // Further split long sentences on commas/semicolons or word boundaries
        const clauses = sentence
          .split(/(?<=[,;:])\s+/)
          .map((c) => c.trim())
          .filter(Boolean);

        let subCurrent = "";
        for (const clause of clauses) {
          if (clause.length > maxChars) {
            if (subCurrent) {
              chunks.push(subCurrent);
              subCurrent = "";
            }
            const words = clause.split(/\s+/);
            let wordChunk = "";
            for (const w of words) {
              if ((wordChunk + " " + w).trim().length > maxChars) {
                if (wordChunk) chunks.push(wordChunk);
                wordChunk = w;
              } else {
                wordChunk = (wordChunk + " " + w).trim();
              }
            }
            if (wordChunk) subCurrent = wordChunk;
          } else if ((subCurrent + " " + clause).trim().length > maxChars) {
            if (subCurrent) chunks.push(subCurrent);
            subCurrent = clause;
          } else {
            subCurrent = (subCurrent + " " + clause).trim();
          }
        }
        if (subCurrent) chunks.push(subCurrent);
      } else if ((current + " " + sentence).trim().length > maxChars) {
        if (current) chunks.push(current);
        current = sentence;
      } else {
        current = (current + " " + sentence).trim();
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "130.0.2849.68";

function generateSecMsGec() {
  const WIN_EPOCH = 11644473600;
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  const ticks100ns = BigInt(ticks) * 10000000n;
  const strToHash = `${ticks100ns.toString()}${TRUSTED_CLIENT_TOKEN}`;
  return crypto
    .createHash("sha256")
    .update(strToHash, "ascii")
    .digest("hex")
    .toUpperCase();
}

function escapeXml(unsafe) {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createWsClientFrame(payloadString) {
  const payload = Buffer.from(payloadString, "utf-8");
  const len = payload.length;
  let headerLen = 2;
  if (len >= 126 && len <= 65535) headerLen += 2;
  else if (len > 65535) headerLen += 8;

  const maskKey = crypto.randomBytes(4);
  const frame = Buffer.alloc(headerLen + 4 + len);
  frame[0] = 0x81; // FIN + Text opcode

  let offset = 2;
  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len <= 65535) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }

  maskKey.copy(frame, offset);
  offset += 4;

  for (let i = 0; i < len; i++) {
    frame[offset + i] = payload[i] ^ maskKey[i % 4];
  }
  return frame;
}

/**
 * Synthesizes a single text chunk via Microsoft Edge Neural TTS WebSocket (`en-GB-SoniaNeural`).
 */
function synthesizeEdgeChunk(textChunk, voice = DEFAULT_TTS_VOICE, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID().replace(/-/g, "");
    const gec = generateSecMsGec();
    const path = `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}&ConnectionId=${connId}`;

    const wsKey = crypto.randomBytes(16).toString("base64");
    const req = https.request({
      host: "speech.platform.bing.com",
      port: 443,
      path,
      method: "GET",
      headers: {
        Host: "speech.platform.bing.com",
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": wsKey,
        "Sec-WebSocket-Version": "13",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
      },
    });

    let settled = false;
    const audioBuffers = [];
    let rxBuffer = Buffer.alloc(0);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error("Edge Neural TTS timeout"));
      }
    }, timeoutMs);

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result);
    }

    req.on("error", (err) => finish(err));
    req.on("response", (res) => {
      finish(new Error(`Edge TTS unexpected HTTP ${res.statusCode}`));
    });

    req.on("upgrade", (_res, socket, head) => {
      if (head && head.length > 0) {
        rxBuffer = Buffer.concat([rxBuffer, head]);
      }

      const configMsg =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false",
                },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });

      const langMatch = String(voice).match(/^([a-z]{2}-[A-Z]{2})/);
      const xmlLang = langMatch ? langMatch[1] : "en-GB";
      const reqId = crypto.randomUUID().replace(/-/g, "");
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${xmlLang}'>` +
        `<voice name='${escapeXml(voice)}'>` +
        `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(textChunk)}</prosody>` +
        `</voice></speak>`;

      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      socket.write(createWsClientFrame(configMsg));
      socket.write(createWsClientFrame(ssmlMsg));

      socket.on("data", (chunk) => {
        rxBuffer = Buffer.concat([rxBuffer, chunk]);

        while (rxBuffer.length >= 2) {
          const byte0 = rxBuffer[0];
          const byte1 = rxBuffer[1];
          const opcode = byte0 & 0x0f;
          const isMasked = (byte1 & 0x80) !== 0;
          let payloadLen = byte1 & 0x7f;
          let offset = 2;

          if (payloadLen === 126) {
            if (rxBuffer.length < 4) break;
            payloadLen = rxBuffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (rxBuffer.length < 10) break;
            payloadLen = Number(rxBuffer.readBigUInt64BE(2));
            offset = 10;
          }

          if (isMasked) offset += 4;
          if (rxBuffer.length < offset + payloadLen) break;

          const frameData = rxBuffer.subarray(offset, offset + payloadLen);
          rxBuffer = rxBuffer.subarray(offset + payloadLen);

          if (opcode === 0x01) {
            // Text frame
            const textStr = frameData.toString("utf-8");
            if (textStr.includes("Path:turn.end")) {
              socket.end();
              finish(null, Buffer.concat(audioBuffers));
              return;
            }
          } else if (opcode === 0x02) {
            // Binary frame: first 2 bytes are header length (UInt16BE)
            if (frameData.length > 2) {
              const headerByteLen = frameData.readUInt16BE(0);
              const headerText = frameData
                .subarray(2, 2 + headerByteLen)
                .toString("utf-8");
              if (headerText.includes("Path:audio")) {
                const mp3Slice = frameData.subarray(2 + headerByteLen);
                if (mp3Slice.length > 0) {
                  audioBuffers.push(Buffer.from(mp3Slice));
                }
              }
            }
          } else if (opcode === 0x08) {
            // Close frame
            socket.end();
            if (audioBuffers.length > 0) {
              finish(null, Buffer.concat(audioBuffers));
            } else {
              finish(new Error("Edge TTS closed before sending audio"));
            }
            return;
          }
        }
      });

      socket.on("error", (err) => finish(err));
      socket.on("end", () => {
        if (audioBuffers.length > 0) {
          finish(null, Buffer.concat(audioBuffers));
        } else {
          finish(new Error("Edge TTS socket ended without audio"));
        }
      });
    });

    req.end();
  });
}

/**
 * Fallback UK English (`en-GB`) Female MP3 synthesizer over standard HTTPS.
 */
async function synthesizeGoogleUkMp3(cleanedText, tl = "en-GB") {
  const chunks = splitTextIntoSentenceChunks(cleanedText, 185);
  const buffers = [];
  const batchSize = 8;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const slice = chunks.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      slice.map(async (chunk) => {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
          tl
        )}&q=${encodeURIComponent(chunk)}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          },
        });
        if (!res.ok) {
          throw new Error(`TTS HTTPS request failed (${res.status})`);
        }
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
      })
    );
    buffers.push(...batchResults);
  }

  return Buffer.concat(buffers);
}

/**
 * Generates a complete MP3 Buffer for an interview's body markdown.
 * Jumps straight into the body of the interview using a UK Female voice by default.
 */
export async function generateArticleNarrationMp3(
  markdownBody,
  voice = DEFAULT_TTS_VOICE
) {
  const cleanedText = cleanMarkdownForNarration(markdownBody);
  if (!cleanedText) {
    throw new Error("Interview body is empty — cannot generate narration.");
  }

  const chosenVoice = voice || DEFAULT_TTS_VOICE;

  // 1. Fast HTTPS UK Female (`en-GB`) MP3 synthesizer (completes in ~2-3s, serverless-safe)
  try {
    const voiceMeta = AVAILABLE_TTS_VOICES.find((v) => v.id === chosenVoice);
    const tl =
      voiceMeta?.tl ||
      (String(chosenVoice).startsWith("en-US") ? "en-US" : "en-GB");
    const httpsBuffer = await synthesizeGoogleUkMp3(cleanedText, tl);
    if (httpsBuffer && httpsBuffer.length > 1000) {
      return {
        buffer: httpsBuffer,
        engine: "uk-female-neural-https",
        voice: chosenVoice,
      };
    }
  } catch {
    // Fall through to Edge WebSocket fallback
  }

  // 2. Fallback to Edge Neural TTS WebSocket
  const paragraphs = splitTextIntoSentenceChunks(cleanedText, 1800);
  const edgeBuffers = [];
  for (const paraChunk of paragraphs) {
    const buf = await synthesizeEdgeChunk(paraChunk, chosenVoice, 3500);
    if (!buf || buf.length < 256) {
      throw new Error("TTS returned empty buffer");
    }
    edgeBuffers.push(buf);
  }
  return {
    buffer: Buffer.concat(edgeBuffers),
    engine: "edge-neural",
    voice: chosenVoice,
  };
}
