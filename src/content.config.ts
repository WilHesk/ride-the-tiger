import { z, defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const interviewsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/interviews" }),
  schema: z.object({
    title: z.string(),
    interviewee: z.string(),
    role: z.string(),
    company: z.string(),
    date: z.date(),
    readTime: z.string(),
    excerpt: z.string(),
    quote: z.string(),
    tags: z.array(z.string()),
    coverImage: z.string().optional(),
  })
});

export const collections = {
  'interviews': interviewsCollection,
};
