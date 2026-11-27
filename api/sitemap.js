const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const SITE_URL = 'https://www.accordarchives.com';

function escapeXml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function fetchList(table, query) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

export default async function handler(req, res) {
    const staticPages = [
        { loc: `${SITE_URL}/`, changefreq: 'daily', priority: '1.0' },
        { loc: `${SITE_URL}/feed.html`, changefreq: 'daily', priority: '0.9' },
        { loc: `${SITE_URL}/music.html`, changefreq: 'daily', priority: '0.9' },
        { loc: `${SITE_URL}/polls.html`, changefreq: 'weekly', priority: '0.8' },
        { loc: `${SITE_URL}/artist-blog.html`, changefreq: 'weekly', priority: '0.8' },
        { loc: `${SITE_URL}/verify.html`, changefreq: 'monthly', priority: '0.5' },
        { loc: `${SITE_URL}/privacy.html`, changefreq: 'yearly', priority: '0.3' },
        { loc: `${SITE_URL}/terms.html`, changefreq: 'yearly', priority: '0.3' }
    ];

    const [books, posts, ministries] = await Promise.all([
        fetchList('books', 'is_visible=eq.true&select=id,created_at&order=id.desc&limit=500'),
        fetchList('feed_posts', 'is_approved=eq.true&select=id,created_at&order=created_at.desc&limit=500'),
        fetchList('profiles', 'upgrade_status=eq.approved&select=id&limit=300')
    ]);

    const urls = [...staticPages];

    for (const book of books) {
        urls.push({
            loc: `${SITE_URL}/book.html?id=${encodeURIComponent(book.id)}`,
            lastmod: book.created_at ? String(book.created_at).slice(0, 10) : undefined,
            changefreq: 'weekly',
            priority: '0.8'
        });
    }

    for (const post of posts) {
        urls.push({
            loc: `${SITE_URL}/post.html?id=${encodeURIComponent(post.id)}`,
            lastmod: post.created_at ? String(post.created_at).slice(0, 10) : undefined,
            changefreq: 'weekly',
            priority: '0.7'
        });
    }

    for (const ministry of ministries) {
        urls.push({
            loc: `${SITE_URL}/ministry.html?id=${encodeURIComponent(ministry.id)}`,
            changefreq: 'weekly',
            priority: '0.7'
        });
    }

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((u) => {
            const parts = [`    <loc>${escapeXml(u.loc)}</loc>`];
            if (u.lastmod) parts.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`);
            if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
            if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
            return `  <url>\n${parts.join('\n')}\n  </url>`;
        }),
        '</urlset>'
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
}
