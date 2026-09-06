import { getCollection } from 'astro:content';

export async function GET(context) {
  const interviews = await getCollection('interviews');
  const siteUrl = context.site || context.url.origin;

  let text = `# Ride The Tiger

> An Editorial Series on Creative Survival

This site contains candid, unfiltered conversations with copywriters, designers, and agency leaders navigating the real impact of AI on craft, commerce, and the creative psyche.

## Interviews

`;

  const tags = new Set();

  for (const interview of interviews) {
    text += `- [${interview.data.title}](${new URL(`/interviews/${interview.id}`, siteUrl).toString()}): ${interview.data.excerpt || interview.data.quote}\n`;
    for (const tag of interview.data.tags || []) {
      tags.add(tag);
    }
  }

  text += `\n## Categories\n\n`;
  for (const tag of Array.from(tags).sort()) {
    text += `- ${tag}\n`;
  }

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
