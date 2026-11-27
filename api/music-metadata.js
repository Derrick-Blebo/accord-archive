const ALLOWED_HOSTS = new Set([
    'music.apple.com',
    'embed.music.apple.com',
    'podcasts.apple.com',
    'embed.podcasts.apple.com',
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

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function findTrackLockupItems(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.itemKind === 'trackLockup' && Array.isArray(obj.items)) {
        return obj.items;
    }
    for (const key of Object.keys(obj)) {
        const found = findTrackLockupItems(obj[key]);
        if (found) return found;
    }
    return null;
}

function extractAppleMusicServerDataTracks(html) {
    const match = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return [];
    try {
        const parsed = JSON.parse(match[1]);
        const items = findTrackLockupItems(parsed);
        if (!Array.isArray(items)) return [];
        return items.slice(0, 15).map(item => {
            const artist = item.artistName
                || (Array.isArray(item.subtitleLinks) ? item.subtitleLinks.map(l => l?.title).filter(Boolean).join(', ') : '');
            let image = item.artwork?.dictionary?.url || '';
            if (image) {
                image = image.replace('{w}', '100').replace('{h}', '100').replace('{f}', 'jpg');
            }
            return {
                title: item.title || '',
                artist,
                image
            };
        }).filter(t => t.title);
    } catch {
        return [];
    }
}

function extractAppleMusicJsonLd(html) {
    const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of matches) {
        const inner = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
        try {
            const parsed = JSON.parse(inner);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                if (item && (item['@type'] === 'MusicPlaylist' || item['@type'] === 'MusicAlbum' || item['@type'] === 'PodcastSeries' || item['@type'] === 'PodcastEpisode' || item.track)) {
                    const tracks = Array.isArray(item.track)
                        ? item.track.slice(0, 15).map(t => ({
                            title: t?.name || '',
                            artist: t?.byArtist?.name || (Array.isArray(t?.byArtist) ? t.byArtist[0]?.name : '') || '',
                            image: t?.audio?.thumbnailUrl || ''
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

async function fetchSpotifyMetadata(parsedUrl) {
    const cleanUrl = parsedUrl.toString();
    const embedUrl = cleanUrl.includes('/embed/')
        ? cleanUrl
        : cleanUrl.replace('open.spotify.com/', 'open.spotify.com/embed/');

    const [oembedRes, embedRes] = await Promise.all([
        fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`).catch(() => null),
        fetch(embedUrl, { headers: { 'User-Agent': BROWSER_UA } }).catch(() => null)
    ]);

    let title = '';
    let image = '';
    let curator = 'Spotify';
    let tracks = [];

    if (oembedRes?.ok) {
        try {
            const oembed = await oembedRes.json();
            title = oembed.title || '';
            image = oembed.thumbnail_url || '';
        } catch {}
    }

    if (embedRes?.ok) {
        try {
            const html = await embedRes.text();
            const nextMatch = html.match(/<script id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
            if (nextMatch) {
                const nextData = JSON.parse(nextMatch[1]);
                const entity = nextData?.props?.pageProps?.state?.data?.entity;
                if (entity) {
                    if (!title && entity.name) title = entity.name;
                    if (!image && Array.isArray(entity.coverArt?.sources) && entity.coverArt.sources.length > 0) {
                        const sortedSources = [...entity.coverArt.sources].sort((a, b) => (b.width || 0) - (a.width || 0));
                        image = sortedSources[0]?.url || '';
                    }
                    if (!image && entity.visualIdentity?.image?.[0]?.url) {
                        image = entity.visualIdentity.image[0].url;
                    }
                    if (entity.subtitle) curator = entity.subtitle;
                    if (Array.isArray(entity.trackList)) {
                        tracks = entity.trackList.slice(0, 15).map(t => ({
                            title: t?.title || '',
                            artist: t?.subtitle || '',
                            image: ''
                        })).filter(t => t.title);
                    }
                }
            }
            if (!image) {
                image = extractMetaTag(html, 'property', 'og:image') || extractMetaTag(html, 'name', 'twitter:image');
            }
        } catch {}
    }

    return { title, image, curator, description: '', tracks };
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
        if (host === 'open.spotify.com') {
            const spotifyMeta = await fetchSpotifyMetadata(parsedUrl);
            return res.status(200).json(spotifyMeta);
        }

        const pageRes = await fetch(parsedUrl.toString(), {
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!pageRes.ok) {
            return res.status(200).json({ title: '', image: '', curator: '', description: '', tracks: [] });
        }

        const html = await pageRes.text();
        const isApple = host.includes('music.apple.com') || host.includes('podcasts.apple.com');
        const jsonLd = isApple ? extractAppleMusicJsonLd(html) : null;
        const serverTracks = host.includes('music.apple.com') ? extractAppleMusicServerDataTracks(html) : [];

        let ogTitle = extractMetaTag(html, 'property', 'og:title') || extractMetaTag(html, 'name', 'twitter:title');
        const ogImage = extractMetaTag(html, 'property', 'og:image') || extractMetaTag(html, 'name', 'twitter:image');
        const ogDesc = extractMetaTag(html, 'property', 'og:description') || extractMetaTag(html, 'name', 'description');

        ogTitle = ogTitle
            .replace(/\s*[-–|]\s*Apple Music$/i, '')
            .replace(/\s*on Apple Music$/i, '')
            .replace(/\s*[-–|]\s*Apple Podcasts?$/i, '')
            .replace(/\s*on Apple Podcasts?$/i, '')
            .trim();

        const tracks = serverTracks.length > 0 ? serverTracks : (jsonLd?.tracks || []);

        return res.status(200).json({
            title: jsonLd?.title || ogTitle || '',
            image: jsonLd?.image || ogImage || '',
            curator: jsonLd?.curator || '',
            description: jsonLd?.description || ogDesc || '',
            tracks
        });
    } catch {
        return res.status(200).json({
            title: '',
            image: '',
            curator: '',
            description: '',
            tracks: []
        });
    }
}
