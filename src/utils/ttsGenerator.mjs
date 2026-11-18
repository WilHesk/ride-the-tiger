/**
 * Automatic Article Narration (TTS MP3 Generator) for Ride The Tiger
 *
 * Supports 3 Narration Quality Tiers (automatically picks the highest tier available):
 * 1. ElevenLabs Studio Narrator (`eleven_multilingual_v2`, UK Female "Alice" / "Charlotte")
 *    — Used when `elevenLabsApiKey` (or `process.env.ELEVENLABS_API_KEY`) is provided.
 * 2. OpenAI HD Neural Narrator (`gpt-4o-mini-tts` / `tts-1-hd`, UK Female editorial prompt)
 *    — Used when `openAiApiKey` (or `process.env.OPENAI_API_KEY`) is provided.
 * 3. Microsoft Edge Neural Read-Aloud (`en-GB-SoniaNeural` / `en-GB-LibbyNeural`)
 *    — Free built-in neural voice with server-clock sync (`Sec-MS-GEC` + `muid`).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

function readLocalDotEnvKey(keyName) {
  if (process.env[keyName]) return process.env[keyName];
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^\\s*${keyName}\\s*=\\s*(.+)\\s*$`, "m"));
      if (match) {
        return match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    // ignore
  }
  return "";
}

export const DEFAULT_TTS_VOICE = "en-GB-SoniaNeural";

export const AVAILABLE_TTS_VOICES = [
  {
    id: "en-GB-SoniaNeural",
    label: "UK Female — Sonia (BBC / Editorial Neural)",
    lang: "en-GB",
    tl: "en-GB",
    elevenLabsVoiceId: "Xb7hH8MSUJpSbSDYk0k2", // Alice (British Female News/Editorial)
  },
  {
    id: "en-GB-LibbyNeural",
    label: "UK Female — Libby (Warm Conversational Neural)",
    lang: "en-GB",
    tl: "en-GB",
    elevenLabsVoiceId: "XB0fDUnXU5powFXDhCwa", // Charlotte (British Female Narrative)
  },
  {
    id: "en-GB-MaisieNeural",
    label: "UK Female — Dorothy / Maisie (Storyteller)",
    lang: "en-GB",
    tl: "en-GB",
    elevenLabsVoiceId: "ThT5KcBeYPX3keUQqHPh", // Dorothy (British Female Storytelling)
  },
  {
    id: "en-GB-RyanNeural",
    label: "UK Male — Ryan (Editorial Neural)",
    lang: "en-GB",
    tl: "en-GB",
    elevenLabsVoiceId: "JBFqnCBsd6RMkjVDRZzb", // George (British Male Narrative)
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
  text = text.replace(
    /\[(?:image|photo|img)\s*(?:\d+)?\s*:?\s*(?:\d{1,3}%?)?\]/gi,
    ""
  );

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

  // Clean up editorial square brackets like [I've had thoughts like] -> I've had thoughts like
  text = text.replace(/\[([^\]]+)\]/g, "$1");

  // Normalize typography for smooth, natural pacing
  text = text
    .replace(/\bRTT\b/g, "Ride The Tiger")
    .replace(/\u2026/g, "... ")
    .replace(/\.\.\./g, "... ")
    .replace(/[\u2014\u2013]/g, " — ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * Splits cleaned article body text into natural chunks under `maxChars`.
 */
export function splitTextIntoSentenceChunks(text, maxChars = 185) {
  const paragraphs = String(text || "")
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks = [];

  for (const para of paragraphs) {
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

// ============================================================================
// TIER 1: ELEVENLABS STUDIO NARRATOR (Human-Grade British Female Narrator)
// ============================================================================
async function synthesizeElevenLabsMp3(
  cleanedText,
  voice = DEFAULT_TTS_VOICE,
  apiKey = ""
) {
  const voiceMeta =
    AVAILABLE_TTS_VOICES.find((v) => v.id === voice) || AVAILABLE_TTS_VOICES[0];
  const elevenVoiceId = voiceMeta.elevenLabsVoiceId || "Xb7hH8MSUJpSbSDYk0k2"; // Alice (British Female)

  // ElevenLabs supports up to 4500 chars per request; chunk at ~3200 chars at paragraph boundaries
  const chunks = splitTextIntoSentenceChunks(cleanedText, 3200);
  const buffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const previousText = i > 0 ? chunks[i - 1].slice(-300) : undefined;
    const nextText = i < chunks.length - 1 ? chunks[i + 1].slice(0, 300) : undefined;

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey.trim(),
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: chunk,
          model_id: "eleven_flash_v2_5",
          ...(previousText ? { previous_text: previousText } : {}),
          ...(nextText ? { next_text: nextText } : {}),
          voice_settings: {
            stability: 0.52,
            similarity_boost: 0.78,
            style: 0.22,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ElevenLabs error (${res.status}): ${errText.slice(0, 120)}`);
    }
    const ab = await res.arrayBuffer();
    buffers.push(Buffer.from(ab));
  }

  return Buffer.concat(buffers);
}

// ============================================================================
// TIER 2: OPENAI STUDIO NARRATOR (`gpt-4o-mini-tts` / `tts-1-hd`)
// ============================================================================
async function synthesizeOpenAiMp3(cleanedText, apiKey = "") {
  const chunks = splitTextIntoSentenceChunks(cleanedText, 3500);
  const buffers = [];

  for (const chunk of chunks) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "fable", // British-inflected warm storytelling voice
        input: chunk,
        instructions:
          "Speak in a warm, natural, professional British female editorial journalist voice, like a BBC Radio 4 or Substack long-form magazine narrator. Maintain a conversational, engaging pace with natural pauses between quotes and paragraphs.",
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI TTS error (${res.status}): ${errText.slice(0, 120)}`);
    }
    const ab = await res.arrayBuffer();
    buffers.push(Buffer.from(ab));
  }

  return Buffer.concat(buffers);
}

// ============================================================================
// TIER 3: MICROSOFT EDGE NEURAL TTS (`en-GB-SoniaNeural` / `en-GB-LibbyNeural`)
// With automatic server-clock synchronization so clock skew never causes 403
// ============================================================================
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "131.0.2903.112";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

let cachedClockOffsetMs = null;

async function getServerSyncedUnixSeconds() {
  if (cachedClockOffsetMs === null) {
    try {
      const res = await fetch("https://www.bing.com/", { method: "HEAD" });
      const dateHeader = res.headers.get("date");
      if (dateHeader) {
        const serverMs = new Date(dateHeader).getTime();
        if (!isNaN(serverMs)) {
          cachedClockOffsetMs = serverMs - Date.now();
        }
      }
    } catch {
      // ignore
    }
    if (cachedClockOffsetMs === null) {
      cachedClockOffsetMs = 0;
    }
  }
  return Math.floor((Date.now() + cachedClockOffsetMs) / 1000);
}

function generateSecMsGecFromUnixSeconds(unixSeconds) {
  const WIN_EPOCH = 11644473600;
  let ticks = unixSeconds + WIN_EPOCH;
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

function createWsClientFrame(payloadString, opcode = 0x01) {
  const payload = Buffer.from(payloadString, "utf-8");
  const len = payload.length;
  let headerLen = 2;
  if (len >= 126 && len <= 65535) headerLen += 2;
  else if (len > 65535) headerLen += 8;

  const maskKey = crypto.randomBytes(4);
  const frame = Buffer.alloc(headerLen + 4 + len);
  frame[0] = 0x80 | opcode;

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

async function synthesizeEdgeChunk(
  textChunk,
  voice = DEFAULT_TTS_VOICE,
  timeoutMs = 10000
) {
  const unixSeconds = await getServerSyncedUnixSeconds();
  const gec = generateSecMsGecFromUnixSeconds(unixSeconds);
  const connId = crypto.randomUUID().replace(/-/g, "");
  const muid = crypto.randomBytes(16).toString("hex").toUpperCase();

  return new Promise((resolve, reject) => {
    const path = `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connId}`;

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
        Cookie: `muid=${muid};`,
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
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
      // If server returned a Date header on error, update cachedClockOffsetMs
      if (res.headers?.date) {
        const srvMs = new Date(res.headers.date).getTime();
        if (!isNaN(srvMs)) cachedClockOffsetMs = srvMs - Date.now();
      }
      finish(new Error(`Edge TTS HTTP ${res.statusCode}`));
    });

    req.on("upgrade", (_res, socket, head) => {
      if (head && head.length > 0) {
        rxBuffer = Buffer.concat([rxBuffer, head]);
      }

      const configMsg =
        `X-Timestamp:${new Date().toString()}\r\n` +
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
        `<prosody pitch='-2Hz' rate='-3%' volume='+0%'>${escapeXml(textChunk)}</prosody>` +
        `</voice></speak>`;

      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toString()}Z\r\n` +
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
            const textStr = frameData.toString("utf-8");
            if (textStr.includes("Path:turn.end")) {
              socket.end();
              finish(null, Buffer.concat(audioBuffers));
              return;
            }
          } else if (opcode === 0x02) {
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
          } else if (opcode === 0x09) {
            // Ping -> send Pong
            socket.write(createWsClientFrame(frameData.toString("utf-8"), 0x0a));
          } else if (opcode === 0x08) {
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
  voice = DEFAULT_TTS_VOICE,
  options = {}
) {
  const cleanedText = cleanMarkdownForNarration(markdownBody);
  if (!cleanedText) {
    throw new Error("Interview body is empty — cannot generate narration.");
  }

  const chosenVoice = voice || DEFAULT_TTS_VOICE;
  const elevenLabsKey =
    options?.elevenLabsApiKey || readLocalDotEnvKey("ELEVENLABS_API_KEY") || "";
  const openAiKey =
    options?.openAiApiKey || readLocalDotEnvKey("OPENAI_API_KEY") || "";

  // Tier 1: ElevenLabs Studio Narrator (if API key provided)
  if (elevenLabsKey.trim()) {
    try {
      const buf = await synthesizeElevenLabsMp3(
        cleanedText,
        chosenVoice,
        elevenLabsKey
      );
      return {
        buffer: buf,
        engine: "elevenlabs-studio",
        voice: chosenVoice,
      };
    } catch (err) {
      console.warn(
        `[TTS] ElevenLabs studio warning (${err instanceof Error ? err.message : err}) — falling back to built-in voice.`
      );
    }
  }

  // Tier 2: OpenAI HD Studio Narrator (if API key provided)
  if (openAiKey.trim()) {
    try {
      const buf = await synthesizeOpenAiMp3(cleanedText, openAiKey);
      return {
        buffer: buf,
        engine: "openai-hd-studio",
        voice: chosenVoice,
      };
    } catch (err) {
      console.warn(
        `[TTS] OpenAI TTS warning (${err instanceof Error ? err.message : err}) — falling back to built-in voice.`
      );
    }
  }

  // Tier 3: Microsoft Edge Neural Read-Aloud (`en-GB-SoniaNeural` / `en-GB-LibbyNeural`)
  try {
    const paragraphs = splitTextIntoSentenceChunks(cleanedText, 2000);
    const edgeBuffers = [];
    for (const paraChunk of paragraphs) {
      const buf = await synthesizeEdgeChunk(paraChunk, chosenVoice, 10000);
      if (!buf || buf.length < 256) {
        throw new Error("Edge Neural TTS returned empty buffer");
      }
      edgeBuffers.push(buf);
    }
    const combined = Buffer.concat(edgeBuffers);
    if (combined.length > 1000) {
      return {
        buffer: combined,
        engine: "edge-neural-studio",
        voice: chosenVoice,
      };
    }
  } catch {
    // Fall through to HTTPS fallback if Edge WebSocket is blocked
  }

  // Tier 4: Fallback HTTPS UK Female (`en-GB`)
  const voiceMeta = AVAILABLE_TTS_VOICES.find((v) => v.id === chosenVoice);
  const tl =
    voiceMeta?.tl ||
    (String(chosenVoice).startsWith("en-US") ? "en-US" : "en-GB");
  const httpsBuffer = await synthesizeGoogleUkMp3(cleanedText, tl);

  return {
    buffer: httpsBuffer,
    engine: "uk-female-https-fallback",
    voice: chosenVoice,
  };
}
