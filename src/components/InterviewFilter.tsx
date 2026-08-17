import React, { useState } from 'react';

type Interview = {
  slug: string;
  data: {
    title: string;
    interviewee: string;
    role: string;
    company: string;
    date: Date;
    readTime: string;
    excerpt: string;
    quote: string;
    tags: string[];
    coverImage?: string;
  };
};

export default function InterviewFilter({ interviews }: { interviews: Interview[] }) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Extract all unique tags
  const allTags = Array.from(new Set(interviews.flatMap(i => i.data.tags))).sort();

  const filteredInterviews = activeFilter
    ? interviews.filter(i => i.data.tags.includes(activeFilter))
    : interviews;

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-10">
        <button
          onClick={() => setActiveFilter(null)}
          className={`px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border ${
            activeFilter === null
              ? 'bg-[var(--color-charcoal)] text-[var(--color-offwhite)] border-[var(--color-charcoal)]'
              : 'bg-white text-[var(--color-charcoal)] border-gray-300 hover:border-[var(--color-charcoal)]'
          }`}
        >
          All
        </button>
        {allTags.map(tag => (
          <button
            key={tag}
            onClick={() => setActiveFilter(tag)}
            className={`px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border ${
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
        {filteredInterviews.map((interview) => (
          <a
            key={interview.slug}
            href={`/interviews/${interview.slug}`}
            className="group block bg-white border border-gray-200 hover:border-tiger-500 transition-colors flex flex-col h-full overflow-hidden shadow-sm hover:shadow-xl"
          >
            <div className="w-full h-48 md:h-56 bg-gray-200 border-b border-gray-200 overflow-hidden shrink-0">
              <img src={`/headshots/${interview.data.interviewee}.png`} alt={interview.data.interviewee} className="w-full h-full object-cover group-hover:scale-110 group-hover:brightness-110 transition-all duration-500" />
            </div>
            <div className="p-8 flex flex-col flex-grow">
              <div className="flex gap-2 mb-4 flex-wrap">
                {interview.data.tags.map(tag => (
                  <span key={tag} className="text-xs font-bold uppercase tracking-widest text-tiger-600">
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
                  <p className="font-bold text-[var(--color-charcoal)]">{interview.data.interviewee}</p>
                  <p className="text-gray-500">{interview.data.role}</p>
                </div>
                <span className="text-gray-400 font-medium">
                  {interview.data.readTime}
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>
      {filteredInterviews.length === 0 && (
        <div className="text-center py-12 text-gray-500 italic font-serif">
          No interviews found for this category.
        </div>
      )}
    </div>
  );
}
