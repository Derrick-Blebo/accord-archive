import fs from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const SITE_URL = 'https://www.accordarchives.com';
const DEFAULT_IMAGE = `${SITE_URL}/og-cover.png`;

function escapeAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function fetchFromSupabase(table, filterQuery) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filterQuery}&limit=1`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
}

export default async function handler(req, res) {
    const { page = 'index', id, book, testimony, event } = req.query;
    const bookId = page === 'book' ? (id || book) : book;

    let title = page === 'forum'
        ? 'Testimonies & Church Events Forum — Accord'
        : 'Accord — Christian Media House & Historical Archive';
    let description = page === 'forum'
        ? 'Read and share testimonies of what God has done, and contribute to Accord’s upcoming testimony book compilations.'
        : 'Explore free and published historical Christian manuscripts, biographies, and chronicles.';
    let imageUrl = DEFAULT_IMAGE;
    let canonicalUrl = page === 'forum'
        ? `${SITE_URL}/forum.html`
        : (page === 'book' ? `${SITE_URL}/book.html` : `${SITE_URL}/`);

    try {
        if (bookId) {
            const item = await fetchFromSupabase('books', `id=eq.${encodeURIComponent(bookId)}&select=id,title,author,description,cover_url`);
            if (item) {
                title = `${item.title} — by ${item.author}`;
                description = (item.description || description).slice(0, 180);
                canonicalUrl = `${SITE_URL}/book.html?id=${item.id}`;
                if (item.cover_url && item.cover_url.startsWith('http')) {
                    imageUrl = item.cover_url;
                }
            }
        } else if (testimony) {
            const item = await fetchFromSupabase('testimonies', `id=eq.${encodeURIComponent(testimony)}&select=id,title,author_name,location,body`);
            if (item) {
                title = `"${item.title}" — Testimony by ${item.author_name}`;
                description = (item.body || description).slice(0, 180);
                canonicalUrl = `${SITE_URL}/forum.html?testimony=${item.id}`;
            }
        } else if (event) {
            const item = await fetchFromSupabase('forum_events', `id=eq.${encodeURIComponent(event)}&select=id,title,organizer_name,description,flyer_url`);
            if (item) {
                title = `${item.title} — ${item.organizer_name}`;
                description = (item.description || description).slice(0, 180);
                canonicalUrl = `${SITE_URL}/forum.html?event=${item.id}`;
                if (item.flyer_url && item.flyer_url.startsWith('http')) {
                    imageUrl = item.flyer_url;
                }
            }
        }
    } catch (e) {
        // Fall back to default metadata on error
    }

    const htmlFile = page === 'forum' ? 'forum.html' : (page === 'book' ? 'book.html' : 'index.html');
    const filePath = path.join(process.cwd(), htmlFile);
    let html = fs.readFileSync(filePath, 'utf8');

    const ogTags = `
    <title>${escapeAttr(title)}</title>
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Accord Archive & Library" />
    <meta property="og:url" content="${escapeAttr(canonicalUrl)}" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:image" content="${escapeAttr(imageUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${escapeAttr(imageUrl)}" />
    `;

    html = html
        .replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace(/<meta[^>]+property=["']og:[^"']+["'][^>]*>/gi, '')
        .replace(/<meta[^>]+name=["']twitter:[^"']+["'][^>]*>/gi, '')
        .replace('</head>', `${ogTags}\n</head>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(html);
}