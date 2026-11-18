import { z, defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const inlineImageSchema = z.object({
  image: z.string(),
  alt: z.string().optional().default(''),
  caption: z.string().optional().default(''),
  percentage: z.number().min(0).max(100).default(50),
  afterText: z.string().optional().default(''),
});

const interviewsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/interviews" }),
  schema: z.object({
    title: z.string(),
    interviewee: z.string(),
    role: z.string(),
    company: z.string(),
    date: z.coerce.date(),
    readTime: z.string(),
    excerpt: z.string(),
    quote: z.string(),
    tags: z.array(z.string()),
    coverImage: z.string().optional(),
    coverImageAlt: z.string().optional(),
    order: z.number().optional(),
    inlineImages: z.array(inlineImageSchema).optional().default([]),
    googleDriveFolderUrl: z.string().optional(),
    audioUrl: z.string().optional(),
    audioVoice: z.string().optional(),
  })
});

export const collections = {
  'interviews': interviewsCollection,
};
