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

  const files = fs
    .readdirSync(interviewsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const fullPath = path.join(interviewsDir, file);
    const raw = fs.readFileSync(fullPath, "utf-8");

    // Extract body after frontmatter (--- ... ---)
    const bodyMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1].trim() : raw.trim();

    console.log(`Generating UK Female narration for ${slug}...`);
    const { buffer, engine, voice } = await generateArticleNarrationMp3(
      body,
      DEFAULT_TTS_VOICE
    );
    const outPath = path.join(audioOutDir, `${slug}.mp3`);
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
