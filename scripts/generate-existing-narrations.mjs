import fs from "node:fs";
import path from "node:path";
import {
  generateArticleNarrationMp3,
  DEFAULT_TTS_VOICE,
} from "../src/utils/ttsGenerator.mjs";

const rootDir = process.cwd();
const interviewsDir = path.join(rootDir, "src", "content", "interviews");
const audioOutDir = path.join(rootDir, "public", "audio");

async function run() {
  if (!fs.existsSync(audioOutDir)) {
    fs.mkdirSync(audioOutDir, { recursive: true });
  }

  const entries = fs
    .readdirSync(interviewsDir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const fullPath = path.join(interviewsDir, file);
      const raw = fs.readFileSync(fullPath, "utf-8");
      const bodyMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : raw.trim();
      return { file, slug, body };
    })
    .sort((a, b) => a.body.length - b.body.length);

  for (const { slug, body } of entries) {
    const outPath = path.join(audioOutDir, `${slug}.mp3`);
    // Skip cecilie-conradsen if already generated with ElevenLabs (>6 MB)
    if (slug === "cecilie-conradsen" && fs.existsSync(outPath) && fs.statSync(outPath).size > 6000000) {
      console.log(`✓ Keeping existing ElevenLabs studio narration for ${slug}`);
      continue;
    }

    console.log(`Generating UK Female narration for ${slug} (${body.length} chars)...`);
    const { buffer, engine, voice } = await generateArticleNarrationMp3(
      body,
      DEFAULT_TTS_VOICE
    );
    fs.writeFileSync(outPath, buffer);
    console.log(
      `✓ Saved ${outPath} (${(buffer.length / 1024).toFixed(1)} KB, engine: ${engine}, voice: ${voice})`
    );
  }
}

run().catch((err) => {
  console.error("Failed to generate narrations:", err);
  process.exit(1);
});
