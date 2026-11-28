/**
 * Accord Shared Audio & Media Embed Resolver
 * Normalizes audio/podcast/music links into in-app embeddable targets and manages playback preference.
 */
(function () {
    const PLAYBACK_PREF_KEY = 'accord_audio_playback_pref';
    const DIRECT_AUDIO_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus)(?:[?#]|$)/i;
    const IFRAME_ALLOW = 'autoplay *; encrypted-media *; fullscreen *; clipboard-write';
    const IFRAME_SANDBOX = 'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation';

    function escapeHTML(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseUrlSafe(rawUrl) {
        try {
            return new URL(rawUrl);
        } catch {
            return null;
        }
    }

    function resolveYouTubeEmbedUrl(rawUrl) {
        const parsed = parseUrlSafe(rawUrl);
        if (!parsed) return '';

        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname;

        if (host === 'youtu.be') {
            const id = path.replace(/^\/+/, '').split('/')[0];
            return id ? `https://www.youtube.com/embed/${id}` : '';
        }

        if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
            if (path.startsWith('/embed/')) {
                return `https://www.youtube.com${path}${parsed.search}`;
            }
            if (path.startsWith('/shorts/') || path.startsWith('/live/')) {
                const id = path.split('/')[2];
                return id ? `https://www.youtube.com/embed/${id}` : '';
            }
            if (path === '/playlist') {
                const listId = parsed.searchParams.get('list');
                return listId ? `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}` : '';
            }
            if (path === '/watch') {
                const v = parsed.searchParams.get('v');
                if (v) return `https://www.youtube.com/embed/${encodeURIComponent(v)}`;
                const listId = parsed.searchParams.get('list');
                if (listId) return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}`;
            }
        }

        return '';
    }

    function resolveInAppAudioTarget(url) {
        const rawUrl = String(url || '').trim();
        if (!rawUrl) {
            return {
                kind: 'external',
                embedUrl: '',
                rawUrl: '',
                platform: 'other',
                label: 'External Link',
                icon: 'fa-solid fa-arrow-up-right-from-square',
                height: 380
            };
        }

        if (DIRECT_AUDIO_RE.test(rawUrl)) {
            return {
                kind: 'audio',
                embedUrl: rawUrl,
                rawUrl,
                platform: 'audio',
                label: 'Audio',
                icon: 'fa-solid fa-volume-high',
                height: 72
            };
        }

        const lower = rawUrl.toLowerCase();

        if (lower.includes('podcasts.apple.com')) {
            const parsed = parseUrlSafe(rawUrl);
            const isEpisode = Boolean(parsed && (parsed.searchParams.has('i') || /\/episode\//i.test(parsed.pathname)));
            const embedUrl = lower.includes('embed.podcasts.apple.com')
                ? rawUrl.replace(/^http:\/\//i, 'https://')
                : rawUrl.replace(/^https?:\/\/podcasts\.apple\.com/i, 'https://embed.podcasts.apple.com');
            return {
                kind: 'iframe',
                embedUrl,
                rawUrl,
                platform: 'apple_podcasts',
                label: 'Apple Podcasts',
                icon: 'fa-solid fa-podcast',
                height: isEpisode ? 175 : 380
            };
        }

        if (lower.includes('music.apple.com')) {
            const parsed = parseUrlSafe(rawUrl);
            const isSong = Boolean(parsed && parsed.searchParams.has('i'));
            const embedUrl = lower.includes('embed.music.apple.com')
                ? rawUrl.replace(/^http:\/\//i, 'https://')
                : rawUrl.replace(/^https?:\/\/music\.apple\.com/i, 'https://embed.music.apple.com');
            return {
                kind: 'iframe',
                embedUrl,
                rawUrl,
                platform: 'apple_music',
                label: 'Apple Music',
                icon: 'fa-brands fa-apple',
                height: isSong ? 175 : 420
            };
        }

        if (lower.includes('open.spotify.com/')) {
            const embedUrl = lower.includes('open.spotify.com/embed/')
                ? rawUrl.replace(/^http:\/\//i, 'https://')
                : rawUrl
                    .replace(/^http:\/\//i, 'https://')
                    .replace(/open\.spotify\.com\/(?:intl-[a-z0-9-]+\/)?/i, 'open.spotify.com/embed/');
            const isCompactSpotify = /\/(track|episode)\//i.test(embedUrl);
            return {
                kind: 'iframe',
                embedUrl,
                rawUrl,
                platform: 'spotify',
                label: 'Spotify',
                icon: 'fa-brands fa-spotify',
                height: isCompactSpotify ? 152 : 352
            };
        }

        if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) {
            const embedUrl = resolveYouTubeEmbedUrl(rawUrl);
            if (embedUrl) {
                return {
                    kind: 'iframe',
                    embedUrl,
                    rawUrl,
                    platform: 'youtube',
                    label: 'YouTube',
                    icon: 'fa-brands fa-youtube',
                    height: 360
                };
            }
        }

        if (lower.includes('audiomack.com/')) {
            const embedUrl = lower.includes('/embed/')
                ? rawUrl.replace(/^http:\/\//i, 'https://')
                : rawUrl
                    .replace(/^http:\/\//i, 'https://')
                    .replace(/audiomack\.com\//i, 'audiomack.com/embed/');
            const isSong = /\/song\//i.test(embedUrl);
            return {
                kind: 'iframe',
                embedUrl,
                rawUrl,
                platform: 'audiomack',
                label: 'Audiomack',
                icon: 'fa-solid fa-headphones',
                height: isSong ? 252 : 352
            };
        }

        if (lower.includes('soundcloud.com/')) {
            const embedUrl = lower.includes('w.soundcloud.com/player/')
                ? rawUrl.replace(/^http:\/\//i, 'https://')
                : `https://w.soundcloud.com/player/?url=${encodeURIComponent(rawUrl)}&color=%232563eb&auto_play=false&show_teaser=true`;
            const isSet = /\/sets\//i.test(rawUrl);
            return {
                kind: 'iframe',
                embedUrl,
                rawUrl,
                platform: 'soundcloud',
                label: 'SoundCloud',
                icon: 'fa-brands fa-soundcloud',
                height: isSet ? 300 : 166
            };
        }

        return {
            kind: 'external',
            embedUrl: '',
            rawUrl,
            platform: 'other',
            label: 'External Link',
            icon: 'fa-solid fa-arrow-up-right-from-square',
            height: 380
        };
    }

    function getPlaybackPreference() {
        try {
            const val = localStorage.getItem(PLAYBACK_PREF_KEY);
            return val === 'external' ? 'external' : 'in_app';
        } catch {
            return 'in_app';
        }
    }

    function setPlaybackPreference(pref) {
        const normalized = pref === 'external' ? 'external' : 'in_app';
        try {
            localStorage.setItem(PLAYBACK_PREF_KEY, normalized);
        } catch {}
        return normalized;
    }

    function renderEmbeddedPlayerHtml(targetOrUrl, opts = {}) {
        const target = typeof targetOrUrl === 'string'
            ? resolveInAppAudioTarget(targetOrUrl)
            : targetOrUrl;

        if (!target || target.kind === 'external' || !target.embedUrl) {
            return '';
        }

        if (target.kind === 'audio') {
            const autoplayAttr = opts && opts.autoplay ? ' autoplay' : '';
            return `
                <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                    <audio controls preload="none"${autoplayAttr} src="${escapeHTML(target.embedUrl)}" class="w-full"></audio>
                </div>
            `.trim();
        }

        const height = (opts && opts.height) || target.height || 380;
        return `<iframe src="${escapeHTML(target.embedUrl)}" allow="${IFRAME_ALLOW}" frameborder="0" height="${escapeHTML(String(height))}" style="display:block;width:100%;height:${escapeHTML(String(height))}px;overflow:hidden;border-radius:12px;background:transparent;" sandbox="${IFRAME_SANDBOX}"></iframe>`;
    }

    window.AccordAudioEmbed = {
        resolveInAppAudioTarget,
        getPlaybackPreference,
        setPlaybackPreference,
        renderEmbeddedPlayerHtml
    };
})();
