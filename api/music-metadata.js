const ALLOWED_HOSTS = new Set([
    'music.apple.com',
    'embed.music.apple.com',
    'open.spotify.com',
    'audiomack.com',
    'www.audiomack.com',
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'music.youtube.com',
    'soundcloud.com',
    'www.soundcloud.com'
]);

function decodeHtmlEntities(str) {
    return String(str || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

function extractMetaTag(html, attrName, attrValue) {
    const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex1 = new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i');
    const regex2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escaped}["']`, 'i');
    const match = html.match(regex1) || html.match(regex2);
    return match ? decodeHtmlEntities(match[1]) : '';
}

function extractAppleMusicJsonLd(html) {
    const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of matches) {
        const inner = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
        try {
            const parsed = JSON.parse(inner);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                if (item && (item['@type'] === 'MusicPlaylist' || item['@type'] === 'MusicAlbum' || item.track)) {
                    const tracks = Array.isArray(item.track)
                        ? item.track.slice(0, 12).map(t => ({
                            title: t?.name || '',
                            artist: t?.byArtist?.name || (Array.isArray(t?.byArtist) ? t.byArtist[0]?.name : '') || ''
                        })).filter(t => t.title)
                        : [];
                    return {
                        title: item.name || '',
                        image: typeof item.image === 'string' ? item.image : (item.image?.url || ''),
                        curator: item.creator?.name || item.author?.name || '',
                        description: item.description || '',
                        tracks
                    };
                }
            }
        } catch {
            // ignore malformed JSON-LD blocks
        }
    }
    return null;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return res.status(400).json({ error: 'Unsupported protocol' });
    }

    const host = parsedUrl.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
        return res.status(400).json({ error: 'Unsupported music platform URL' });
    }

    try {
        // Spotify oEmbed is reliable and fast
        if (host === 'open.spotify.com') {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(parsedUrl.toString())}`);
            if (oembedRes.ok) {
                const data = await oembedRes.json();
                return res.status(200).json({
                    title: data.title || '',
                    image: data.thumbnail_url || '',
                    curator: data.provider_name || 'Spotify',
                    description: '',
                    tracks: []
                });
            }
        }

        const pageRes = await fetch(parsedUrl.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AccordBot/1.0; +https://www.accordarchives.com)',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!pageRes.ok) {
            return res.status(200).json({ title: '', image: '', curator: '', description: '', tracks: [] });
        }

        const html = await pageRes.text();
        const jsonLd = host.includes('music.apple.com') ? extractAppleMusicJsonLd(html) : null;

        let ogTitle = extractMetaTag(html, 'property', 'og:title') || extractMetaTag(html, 'name', 'twitter:title');
        const ogImage = extractMetaTag(html, 'property', 'og:image') || extractMetaTag(html, 'name', 'twitter:image');
        const ogDesc = extractMetaTag(html, 'property', 'og:description') || extractMetaTag(html, 'name', 'description');

        // Clean Apple Music suffix like " - Apple Music"
        ogTitle = ogTitle.replace(/\s*[-–|]\s*Apple Music$/i, '').replace(/\s*on Apple Music$/i, '').trim();

        return res.status(200).json({
            title: jsonLd?.title || ogTitle || '',
            image: jsonLd?.image || ogImage || '',
            curator: jsonLd?.curator || '',
            description: jsonLd?.description || ogDesc || '',
            tracks: jsonLd?.tracks || []
        });
    } catch (err) {
        return res.status(200).json({
            title: '',
            image: '',
            curator: '',
            description: '',
            tracks: []
        });
    }
}
