import React, { useState, useEffect } from 'react';

type InlineImage = {
  image: string;
  alt?: string;
  caption?: string;
  percentage: number;
};

type Interview = {
  slug: string;
  data: {
    title: string;
    interviewee: string;
    role: string;
    company: string;
    date: Date | string;
    readTime: string;
    excerpt: string;
    quote: string;
    tags: string[];
    coverImage?: string;
    coverImageAlt?: string;
    order?: number;
    inlineImages?: InlineImage[];
  };
};

const INTERVIEWS_STORAGE_KEY = 'rtt_cms_interviews_v1';

function normalizeCloudInterviews(rawList: any[]): Interview[] {
  return rawList
    .filter((item) => item && item.slug && item.title)
    .sort((a, b) => (Number(a.order) || 10) - (Number(b.order) || 10))
    .map((item) => ({
      slug: item.slug,
      data: {
        title: item.title,
        interviewee: item.interviewee || 'Featured Creative',
        role: item.role || 'Copywriter',
        company: item.company || 'Freelance',
        date: item.date || new Date().toISOString(),
        readTime: item.readTime || '5 min read',
        excerpt: item.excerpt || item.quote || '',
        quote: item.quote || '',
        tags: Array.isArray(item.tags) ? item.tags : ['Copywriting'],
        coverImage: item.coverImage || `/headshots/${item.interviewee}.webp`,
        coverImageAlt: item.coverImageAlt || item.interviewee || item.title,
        order: item.order,
        inlineImages: Array.isArray(item.inlineImages) ? item.inlineImages : [],
      },
    }));
}

export default function InterviewFilter({ interviews: initialInterviews }: { interviews: Interview[] }) {
  const [interviewList, setInterviewList] = useState<Interview[]>(initialInterviews);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  useEffect(() => {
    let localRaw: any[] | null = null;
    try {
      const saved = localStorage.getItem(INTERVIEWS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localRaw = parsed;
          setInterviewList(normalizeCloudInterviews(parsed));
        }
      }
    } catch {
      // ignore local storage error
    }

    fetch('/__cms-sync', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cloud) => {
        if (!cloud || !cloud.ok) return;
        if (Array.isArray(cloud.interviews) && cloud.interviews.length > 0) {
          localStorage.setItem(INTERVIEWS_STORAGE_KEY, JSON.stringify(cloud.interviews));
          setInterviewList(normalizeCloudInterviews(cloud.interviews));
        } else if (localRaw && localRaw.length > 0) {
          fetch('/__cms-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync-interviews', items: localRaw }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Extract all unique tags
  const allTags = Array.from(new Set(interviewList.flatMap((i) => i.data.tags || []))).sort();

  const filteredInterviews = activeFilter
    ? interviewList.filter((i) => (i.data.tags || []).includes(activeFilter))
    : interviewList;

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-10">
        <button
          onClick={() => setActiveFilter(null)}
          className={`px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border cursor-pointer ${
            activeFilter === null
              ? 'bg-[var(--color-charcoal)] text-[var(--color-offwhite)] border-[var(--color-charcoal)]'
              : 'bg-white text-[var(--color-charcoal)] border-gray-300 hover:border-[var(--color-charcoal)]'
          }`}
        >
          All
        </button>
        {allTags.map((tag) => (
          <button
            key={tag}
            onClick={() => setActiveFilter(tag)}
            className={`px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border cursor-pointer ${
              activeFilter === tag
                ? 'bg-tiger-500 text-[var(--color-charcoal)] border-tiger-500'
                : 'bg-white text-[var(--color-charcoal)] border-gray-300 hover:border-tiger-500 hover:text-tiger-600'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {filteredInterviews.map((interview) => {
          const imgSrc =
            interview.data.coverImage ||
            `/headshots/${interview.data.interviewee}.webp`;
          return (
            <a
              key={interview.slug}
              href={`/interviews/${interview.slug}`}
              className="group block bg-white border border-gray-200 hover:border-tiger-500 transition-colors flex flex-col h-full overflow-hidden shadow-sm hover:shadow-xl"
            >
              <div className="w-full h-48 md:h-56 bg-gray-200 border-b border-gray-200 overflow-hidden shrink-0">
                <img
                  src={imgSrc}
                  alt={interview.data.coverImageAlt || interview.data.interviewee}
                  className="w-full h-full object-cover group-hover:scale-110 group-hover:brightness-110 transition-all duration-500"
                  loading="lazy"
                  width="800"
                  height="450"
                />
              </div>
              <div className="p-8 flex flex-col flex-grow">
                <div className="flex gap-2 mb-4 flex-wrap">
                  {(interview.data.tags || []).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs font-bold uppercase tracking-widest text-tiger-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h3 className="text-2xl font-bold uppercase tracking-tight mb-4 group-hover:text-tiger-600 transition-colors">
                  {interview.data.title}
                </h3>
                <p className="text-gray-600 leading-relaxed mb-6 flex-grow">
                  {interview.data.excerpt}
                </p>
                <div className="mt-auto pt-6 border-t border-gray-100 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-bold text-[var(--color-charcoal)]">
                      {interview.data.interviewee}
                    </p>
                    <p className="text-gray-500">{interview.data.role}</p>
                  </div>
                  <span className="text-gray-400 font-medium">
                    {interview.data.readTime}
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
      {filteredInterviews.length === 0 && (
        <div className="text-center py-12 text-gray-500 italic font-serif">
          No interviews found for this category.
        </div>
      )}
    </div>
  );
}
