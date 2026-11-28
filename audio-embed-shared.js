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

    function appendQueryParam(rawUrl, key, value) {
        const parsed = parseUrlSafe(rawUrl);
        if (parsed) {
            parsed.searchParams.set(key, String(value));
            return parsed.toString();
        }
        const sep = String(rawUrl || '').includes('?') ? '&' : '?';
        return `${rawUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    }

    function extractSpotifyUri(rawUrl) {
        const match = String(rawUrl || '').match(/open\.spotify\.com\/(?:intl-[a-z0-9-]+\/)?(?:embed\/)?(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/i);
        return match ? `spotify:${match[1].toLowerCase()}:${match[2]}` : '';
    }

    function withAutoplayEmbedUrl(target) {
        if (!target || !target.embedUrl) return '';
        if (target.platform === 'youtube' || target.platform === 'audiomack') {
            return appendQueryParam(target.embedUrl, 'autoplay', '1');
        }
        if (target.platform === 'soundcloud') {
            if (/([?&])auto_play=(?:false|0)\b/i.test(target.embedUrl)) {
                return target.embedUrl.replace(/([?&])auto_play=(?:false|0)\b/i, '$1auto_play=true');
            }
            return appendQueryParam(target.embedUrl, 'auto_play', 'true');
        }
        return target.embedUrl;
    }

    let _spotifyApiPromise = null;
    function loadSpotifyIframeApi() {
        if (window._accordSpotifyIFrameAPI) {
            return Promise.resolve(window._accordSpotifyIFrameAPI);
        }
        if (_spotifyApiPromise) return _spotifyApiPromise;

        _spotifyApiPromise = new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, val) => {
                if (settled) return;
                settled = true;
                fn(val);
            };

            const prevReady = window.onSpotifyIframeApiReady;
            window.onSpotifyIframeApiReady = (IFrameAPI) => {
                window._accordSpotifyIFrameAPI = IFrameAPI;
                if (typeof prevReady === 'function') {
                    try { prevReady(IFrameAPI); } catch {}
                }
                finish(resolve, IFrameAPI);
            };

            if (!document.querySelector('script[src*="open.spotify.com/embed/iframe-api"]')) {
                const script = document.createElement('script');
                script.src = 'https://open.spotify.com/embed/iframe-api/v1';
                script.async = true;
                script.onerror = () => {
                    _spotifyApiPromise = null;
                    finish(reject, new Error('Failed to load Spotify IFrame API'));
                };
                document.head.appendChild(script);
            }

            setTimeout(() => {
                if (!settled) {
                    _spotifyApiPromise = null;
                    finish(reject, new Error('Spotify IFrame API timeout'));
                }
            }, 6000);
        });

        return _spotifyApiPromise;
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
        const iframeSrc = (opts && opts.autoplay) ? withAutoplayEmbedUrl(target) : target.embedUrl;
        return `<iframe src="${escapeHTML(iframeSrc)}" allow="${IFRAME_ALLOW}" frameborder="0" height="${escapeHTML(String(height))}" style="display:block;width:100%;height:${escapeHTML(String(height))}px;overflow:hidden;border-radius:12px;background:transparent;" sandbox="${IFRAME_SANDBOX}"></iframe>`;
    }

    function mountEmbeddedPlayer(containerEl, targetOrUrl, opts = {}) {
        if (!containerEl) return;
        const target = typeof targetOrUrl === 'string'
            ? resolveInAppAudioTarget(targetOrUrl)
            : targetOrUrl;

        if (!target || target.kind === 'external' || !target.embedUrl) {
            containerEl.innerHTML = '';
            return;
        }

        if (target.kind === 'audio') {
            containerEl.innerHTML = renderEmbeddedPlayerHtml(target, opts);
            if (opts && opts.autoplay) {
                const audioEl = containerEl.querySelector('audio');
                if (audioEl && typeof audioEl.play === 'function') {
                    audioEl.play().catch(() => {});
                }
            }
            return;
        }

        if (target.platform === 'spotify' && opts && opts.autoplay) {
            const spotifyUri = extractSpotifyUri(target.rawUrl || target.embedUrl);
            if (spotifyUri) {
                const height = Number((opts && opts.height) || target.height || 152);
                containerEl.innerHTML = `<div data-spotify-embed-host style="width:100%;height:${height}px;border-radius:12px;overflow:hidden;"></div>`;
                const hostEl = containerEl.querySelector('[data-spotify-embed-host]');
                loadSpotifyIframeApi()
                    .then((IFrameAPI) => {
                        if (!containerEl.isConnected || !hostEl || !hostEl.isConnected) return;
                        IFrameAPI.createController(hostEl, {
                            uri: spotifyUri,
                            width: '100%',
                            height
                        }, (controller) => {
                            let started = false;
                            const startPlayback = () => {
                                if (started || !containerEl.isConnected) return;
                                started = true;
                                try { controller.play(); } catch {}
                            };
                            if (typeof controller.addListener === 'function') {
                                controller.addListener('ready', startPlayback);
                            }
                            startPlayback();
                        });
                    })
                    .catch(() => {
                        if (containerEl.isConnected) {
                            containerEl.innerHTML = renderEmbeddedPlayerHtml(target, opts);
                        }
                    });
                return;
            }
        }

        containerEl.innerHTML = renderEmbeddedPlayerHtml(target, opts);
    }

    window.AccordAudioEmbed = {
        resolveInAppAudioTarget,
        getPlaybackPreference,
        setPlaybackPreference,
        renderEmbeddedPlayerHtml,
        mountEmbeddedPlayer
    };
})();
