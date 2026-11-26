import fs from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const SITE_URL = 'https://www.accordarchives.com';
const DEFAULT_IMAGE = `${SITE_URL}/og-cover.png`;

const PAGE_DEFAULTS = {
    index: {
        file: 'index.html',
        title: 'Accord — Christian Media House & Historical Archive',
        description: 'Explore free and published historical Christian manuscripts, biographies, and chronicles.',
        url: `${SITE_URL}/`,
        type: 'website'
    },
    book: {
        file: 'book.html',
        title: 'Publication — Accord Archive & Library',
        description: 'Read and explore historical Christian manuscripts, biographies, and published works on Accord Archive.',
        url: `${SITE_URL}/book.html`,
        type: 'article'
    },
    post: {
        file: 'post.html',
        title: 'Post — Accord Fellowship Feed',
        description: 'Watch sermons, read testimonies, and engage with Christian fellowship posts on Accord.',
        url: `${SITE_URL}/post.html`,
        type: 'article'
    },
    ministry: {
        file: 'ministry.html',
        title: 'Ministry Profile — Accord Archive & Library',
        description: 'Explore verified ministries, teachings, and fellowship posts on Accord Archive.',
        url: `${SITE_URL}/ministry.html`,
        type: 'profile'
    }
};

function escapeAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function cleanDescription(str, fallback) {
    const normalized = String(str || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return fallback;
    return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function extractYouTubeThumbnail(url) {
    if (!url) return null;
    let videoId = '';
    if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1]?.split(/[?&#]/)[0];
    else if (url.includes('v=')) videoId = url.split('v=')[1]?.split(/[?&#]/)[0];
    else if (url.includes('embed/')) videoId = url.split('embed/')[1]?.split(/[?&#]/)[0];
    else if (url.includes('shorts/')) videoId = url.split('shorts/')[1]?.split(/[?&#]/)[0];
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
}

function normalizeImageUrl(rawUrl) {
    const val = String(rawUrl || '').trim();
    if (!val || val.startsWith('data:')) return null;
    const driveMatch = val.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (driveMatch?.[1]) {
        return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
    }
    if (val.startsWith('http://') || val.startsWith('https://')) {
        return val;
    }
    if (val.startsWith('/')) {
        return `${SITE_URL}${val}`;
    }
    return `${SITE_URL}/${val}`;
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
    const defaults = PAGE_DEFAULTS[page] || PAGE_DEFAULTS.index;
    const bookId = page === 'book' ? (id || book) : book;

    let title = defaults.title;
    let description = defaults.description;
    let imageUrl = DEFAULT_IMAGE;
    let canonicalUrl = defaults.url;
    let ogType = defaults.type;

    try {
        if (bookId && /^\d+$/.test(String(bookId)) && (page === 'index' || page === 'book')) {
            const item = await fetchFromSupabase('books', `id=eq.${encodeURIComponent(bookId)}&is_visible=eq.true&select=id,title,author,description,cover_url`);
            if (item) {
                title = `${item.title} — by ${item.author}`;
                description = cleanDescription(item.description, defaults.description);
                canonicalUrl = page === 'book'
                    ? `${SITE_URL}/book.html?id=${item.id}`
                    : `${SITE_URL}/?book=${item.id}`;
                ogType = 'article';
                const normalizedCover = normalizeImageUrl(item.cover_url);
                if (normalizedCover) {
                    imageUrl = normalizedCover;
                }
            }
        } else if (page === 'post' && id && /^[a-zA-Z0-9-]+$/.test(String(id))) {
            const item = await fetchFromSupabase('feed_posts', `id=eq.${encodeURIComponent(id)}&is_approved=eq.true&select=id,title,body,post_type,media_url,author_name,is_anonymous`);
            if (item) {
                const author = item.is_anonymous ? 'Anonymous' : (item.author_name || 'Accord Fellowship');
                const snippet = (item.body || '').trim();
                title = snippet
                    ? `${snippet.slice(0, 60)}${snippet.length > 60 ? '...' : ''} — ${author}`
                    : `${author} — Accord Fellowship Feed`;
                description = cleanDescription(item.body, defaults.description);
                canonicalUrl = `${SITE_URL}/post.html?id=${item.id}`;
                ogType = 'article';
                if (item.post_type === 'video' && item.media_url) {
                    const ytThumb = extractYouTubeThumbnail(item.media_url);
                    if (ytThumb) imageUrl = ytThumb;
                }
            }
        } else if (page === 'ministry' && id && /^[a-zA-Z0-9-]+$/.test(String(id))) {
            const item = await fetchFromSupabase('profiles', `id=eq.${encodeURIComponent(id)}&select=id,full_name,account_type,upgrade_status`);
            if (item && item.full_name) {
                title = `${item.full_name} — Verified Ministry on Accord`;
                description = `Explore teachings, sermons, and fellowship posts from ${item.full_name} on Accord Archive & Library.`;
                canonicalUrl = `${SITE_URL}/ministry.html?id=${item.id}`;
                ogType = 'profile';
            }
        }
    } catch (e) {
        // Fall back to default metadata on error
    }

    const imageDimensions = imageUrl === DEFAULT_IMAGE
        ? `\n    <meta property="og:image:type" content="image/png" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />`
        : '';

    const ogTags = `
    <title>${escapeAttr(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta property="og:type" content="${escapeAttr(ogType)}" />
    <meta property="og:site_name" content="Accord Archive & Library" />
    <meta property="og:url" content="${escapeAttr(canonicalUrl)}" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:image" content="${escapeAttr(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeAttr(imageUrl)}" />${imageDimensions}
    <meta property="og:image:alt" content="${escapeAttr(title)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${escapeAttr(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeAttr(title)}" />`;

    let html = '';
    try {
        const filePath = path.join(process.cwd(), defaults.file);
        html = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head><body><script>window.location.replace(${JSON.stringify(canonicalUrl)});</script></body></html>`;
    }

    html = html
        .replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace(/<meta[^>]+name=["']description["'][^>]*>/gi, '')
        .replace(/<meta[^>]+property=["']og:[^"']+["'][^>]*>/gi, '')
        .replace(/<meta[^>]+name=["']twitter:[^"']+["'][^>]*>/gi, '');

    if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(html)) {
        html = html.replace(/(<meta[^>]+name=["']viewport["'][^>]*>)/i, `$1${ogTags}`);
    } else {
        html = html.replace(/<head>/i, `<head>${ogTags}`);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(html);
}
