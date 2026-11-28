/**
 * Accord Archive — Centralized Ad Banner & Paid Promotions Renderer
 * Dynamically places approved ad banners across every main page of the site
 * and renders sponsored post/book cards in feeds.
 */

(function () {
    let _activePromotionsCache = null;
    let _adPageConfigCache = null;
    let _adImpressionObserver = null;
    let _lastMidPromoId = null;
    const _trackedImpressions = new Set();

    const ADS_CONFIG_RECORD_NAME = '__ACCORD_ADS_CONFIG__';

    const MAIN_PAGE_PLACEMENTS = {
        library: ['index.html', ''],
        feed: ['feed.html'],
        music: ['music.html', 'playlists.html'],
        sermons: ['sermons.html'],
        book: ['book.html'],
        post: ['post.html'],
        author: ['author.html'],
        artist: ['artist.html', 'artist-blog.html'],
        ministry: ['ministry.html'],
        polls: ['polls.html', 'poll.html'],
        saved: ['saved.html'],
        user: ['user.html']
    };

    const EXCLUDED_PAGES = new Set([
        'admin.html',
        'superadmin.html',
        'feed-admin.html',
        'library-admin.html',
        'music-admin.html',
        'signin.html',
        'promote.html',
        'verify.html',
        'messages.html',
        'profile.html',
        'privacy.html',
        'terms.html'
    ]);

    function escapeAdHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getCurrentFileName() {
        let file = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
        if (file && !file.includes('.')) file += '.html';
        return file;
    }

    function isMainSitePage() {
        const file = getCurrentFileName();
        if (EXCLUDED_PAGES.has(file)) return false;
        return Object.values(MAIN_PAGE_PLACEMENTS).some(files => files.includes(file));
    }

    function getCurrentPagePlacement() {
        const file = getCurrentFileName();
        for (const [placement, files] of Object.entries(MAIN_PAGE_PLACEMENTS)) {
            if (files.includes(file)) return placement;
        }
        return 'all';
    }

    function getPromoSlotPosition(promo) {
        const raw = String(promo?.slot_position || '').trim().toLowerCase();
        // Never allow 'top' right below the header bar; remap 'top' to 'mid'
        if (raw === 'top' || raw === 'mid') return 'mid';
        if (raw === 'bottom' || raw === 'dynamic') return raw;
        const notes = String(promo?.admin_notes || '');
        const match = notes.match(/\[slot:(top|mid|bottom|dynamic)\]/i);
        if (match) {
            const matched = match[1].toLowerCase();
            return matched === 'top' ? 'mid' : matched;
        }
        return 'dynamic';
    }

    function getUserGeoCountry() {
        try {
            if (window.accordUserGeo?.country) return String(window.accordUserGeo.country).toUpperCase();
            const cached = sessionStorage.getItem('accord_geo');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed?.country) return String(parsed.country).toUpperCase();
            }
        } catch (_) {}
        return 'GLOBAL';
    }

    async function fetchAdPageConfig(forceRefresh = false) {
        if (_adPageConfigCache && !forceRefresh) return _adPageConfigCache;
        const client = window.supabaseClient;
        if (!client) return { disabledPages: [] };
        try {
            const { data, error } = await client
                .from('books')
                .select('description')
                .eq('title', ADS_CONFIG_RECORD_NAME)
                .limit(1)
                .maybeSingle();
            if (!error && data?.description) {
                const parsed = JSON.parse(data.description);
                _adPageConfigCache = {
                    disabledPages: Array.isArray(parsed?.disabledPages)
                        ? parsed.disabledPages.map(p => String(p).trim().toLowerCase()).filter(Boolean)
                        : []
                };
                return _adPageConfigCache;
            }
        } catch (_) {}
        _adPageConfigCache = { disabledPages: [] };
        return _adPageConfigCache;
    }

    function isPagePlacementAllowed(config, placement) {
        const disabled = Array.isArray(config?.disabledPages) ? config.disabledPages : [];
        return !disabled.includes(String(placement || '').toLowerCase());
    }

    window.isAccordAdsEnabledForPage = async function (placement, forceRefresh = false) {
        if (!placement && !isMainSitePage()) return false;
        const cfg = await fetchAdPageConfig(forceRefresh);
        const targetPlacement = placement ? String(placement).toLowerCase() : getCurrentPagePlacement();
        return isPagePlacementAllowed(cfg, targetPlacement);
    };

    function normalizeCallingCategory(role) {
        const raw = String(role || '').trim();
        const map = {
            'Church / Local Assembly': 'Church / Ministry',
            'Christian Ministry / Fellowship': 'Church / Ministry',
            'Pastor / Ordained Minister': 'Preacher',
            'Evangelist / Missionary': 'Preacher',
            'Christian Educator / Author': 'Christian Creative'
        };
        return map[raw] || raw;
    }

    async function getCurrentUserCallingCategory() {
        const client = window.supabaseClient;
        if (!client) return '';
        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session?.user?.id) return '';
            const { data } = await client
                .from('profiles')
                .select('ministry_role')
                .eq('id', session.user.id)
                .maybeSingle();
            return normalizeCallingCategory(data?.ministry_role);
        } catch (_) {
            return '';
        }
    }

    async function fetchActivePromotions(forceRefresh = false) {
        if (_activePromotionsCache && !forceRefresh) return _activePromotionsCache;
        const client = window.supabaseClient;
        if (!client) return [];

        const adConfig = await fetchAdPageConfig(forceRefresh);
        if (!isMainSitePage() || !isPagePlacementAllowed(adConfig, getCurrentPagePlacement())) {
            _activePromotionsCache = [];
            return [];
        }

        const nowIso = new Date().toISOString();
        const [{ data, error }, userCategory] = await Promise.all([
            client
                .from('promotions')
                .select('*')
                .eq('status', 'approved')
                .order('created_at', { ascending: false })
                .limit(60),
            getCurrentUserCallingCategory()
        ]);

        if (error || !Array.isArray(data)) {
            _activePromotionsCache = [];
            return [];
        }

        const nowMs = Date.now();
        const placement = getCurrentPagePlacement();
        const userCountry = getUserGeoCountry();
        const userCategoryLower = String(userCategory || '').toLowerCase();

        _activePromotionsCache = data.filter(p => {
            if (p.starts_at && Date.parse(p.starts_at) > nowMs) return false;
            if (p.ends_at && Date.parse(p.ends_at) < nowMs) return false;

            const placements = Array.isArray(p.placements) && p.placements.length > 0
                ? p.placements.map(pl => String(pl).toLowerCase())
                : ['all'];
            if (!placements.includes('all') && !placements.includes(placement)) return false;

            const countries = Array.isArray(p.target_countries)
                ? p.target_countries.map(c => String(c).toUpperCase())
                : [];
            if (countries.length > 0 && !countries.includes('ALL') && !countries.includes('GLOBAL') && userCountry !== 'GLOBAL') {
                if (!countries.includes(userCountry)) return false;
            }

            const categories = Array.isArray(p.target_categories)
                ? p.target_categories.map(c => String(c).trim().toLowerCase()).filter(Boolean)
                : [];
            if (categories.length > 0 && !categories.includes('all')) {
                if (!userCategoryLower || !categories.includes(userCategoryLower)) return false;
            }
            return true;
        });

        await enrichSponsoredPosts(_activePromotionsCache);

        return _activePromotionsCache;
    }

    async function enrichSponsoredPosts(promos) {
        const client = window.supabaseClient;
        if (!client || !Array.isArray(promos) || promos.length === 0) return;

        const postIds = [...new Set(
            promos
                .filter(p => p.promo_type === 'post' && p.target_post_id)
                .map(p => String(p.target_post_id))
        )];
        if (postIds.length === 0) return;

        try {
            const [postsRes, commentsRes] = await Promise.all([
                client.from('feed_posts').select('*').in('id', postIds),
                client.from('post_comments').select('post_id').in('post_id', postIds)
            ]);

            const postRows = Array.isArray(postsRes?.data) ? postsRes.data : [];
            const postById = new Map(postRows.map(post => [String(post.id), post]));

            const commentCounts = new Map();
            (commentsRes?.data || []).forEach(c => {
                const key = String(c.post_id);
                commentCounts.set(key, (commentCounts.get(key) || 0) + 1);
            });

            const authorIds = [...new Set(
                postRows
                    .filter(post => !post.is_anonymous && post.author_id)
                    .map(post => String(post.author_id))
            )];

            const profileById = new Map();
            if (authorIds.length > 0) {
                const { data: profileRows } = await client
                    .from('profiles')
                    .select('id, handle, avatar_url, full_name, account_type, upgrade_status')
                    .in('id', authorIds);
                (profileRows || []).forEach(prof => {
                    profileById.set(String(prof.id), prof);
                });
            }

            promos.forEach(promo => {
                if (promo.promo_type !== 'post' || !promo.target_post_id) return;
                const post = postById.get(String(promo.target_post_id)) || null;
                promo._targetPost = post;
                promo._commentsCount = commentCounts.get(String(promo.target_post_id)) || 0;
                promo._authorProfile = (post && !post.is_anonymous && post.author_id)
                    ? (profileById.get(String(post.author_id)) || null)
                    : null;
            });
        } catch (_) {}
    }

    function setupAdImpressionObserver() {
        if (typeof IntersectionObserver === 'undefined') return;
        if (!_adImpressionObserver) {
            _adImpressionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const promoId = entry.target.getAttribute('data-promo-id');
                    if (!promoId || _trackedImpressions.has(promoId)) return;
                    _trackedImpressions.add(promoId);
                    _adImpressionObserver.unobserve(entry.target);
                    window.supabaseClient?.rpc('record_promotion_impression', { promo_id: promoId }).then(() => {});
                });
            }, { threshold: 0.4 });
        }

        document.querySelectorAll('[data-promo-id]').forEach(el => {
            const id = el.getAttribute('data-promo-id');
            if (id && !_trackedImpressions.has(id)) {
                _adImpressionObserver.observe(el);
            }
        });
    }

    window.trackAccordAdClick = function (promoId) {
        if (!promoId || !window.supabaseClient) return;
        window.supabaseClient.rpc('record_promotion_click', { promo_id: promoId }).then(() => {});
    };

    function buildBannerSlideHtml(promo) {
        const href = (promo.cta_url || '').trim() || (promo.ad_goal !== 'views'
            ? (promo.target_book_id ? `book.html?id=${promo.target_book_id}` : promo.target_post_id ? `post.html?id=${promo.target_post_id}` : '')
            : '');
        const isExternal = /^https?:\/\//i.test(href);
        const targetAttr = isExternal ? 'target="_blank" rel="noopener noreferrer"' : '';
        const desktopImg = promo.desktop_image_url || promo.mobile_image_url || '';
        const mobileImg = promo.mobile_image_url || promo.desktop_image_url || '';

        if (desktopImg || mobileImg) {
            const innerImgs = `
                <span class="absolute top-2.5 left-2.5 z-10 px-2.5 py-0.5 rounded-full bg-accord-slate/80 text-white text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm">Sponsored</span>
                ${desktopImg ? `<img src="${escapeAdHtml(desktopImg)}" alt="Sponsored banner" class="hidden sm:block w-full max-h-72 md:max-h-80 object-cover ${href ? 'group-hover:scale-[1.01] transition-transform duration-300' : ''}">` : ''}
                ${mobileImg ? `<img src="${escapeAdHtml(mobileImg)}" alt="Sponsored banner" class="sm:hidden w-full max-h-80 object-cover">` : ''}
            `;
            if (href) {
                return `<a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" data-promo-id="${promo.id}" class="block relative rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/90 shadow-md group bg-white">${innerImgs}</a>`;
            }
            return `<div data-promo-id="${promo.id}" class="block relative rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/90 shadow-md bg-white">${innerImgs}</div>`;
        }

        return `
            <div data-promo-id="${promo.id}" class="rounded-2xl sm:rounded-3xl bg-gradient-to-r from-accord-slate via-slate-900 to-accord-darkBlue text-white p-5 sm:p-7 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div class="space-y-1.5 min-w-0">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accord-gold/20 text-accord-gold text-[10px] font-extrabold uppercase tracking-wider">
                        <i class="fa-solid fa-bullhorn text-[9px]"></i> Sponsored
                    </span>
                    ${promo.body ? `<p class="text-xs sm:text-sm text-slate-200 line-clamp-2">${escapeAdHtml(promo.body)}</p>` : ''}
                </div>
                ${href ? `
                <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="px-5 py-2.5 rounded-xl bg-accord-gold hover:bg-amber-500 text-accord-slate text-xs font-extrabold shrink-0 transition-all shadow">
                    ${escapeAdHtml(promo.cta_text || 'Learn More')}
                </a>
                ` : ''}
            </div>
        `;
    }

    function getDynamicBannerContainer() {
        const bookGridTop = document.getElementById('book-grid-top');
        if (bookGridTop && bookGridTop.parentElement) {
            return bookGridTop.parentElement;
        }
        return document.querySelector('main');
    }

    function isNonContentLeadingElement(el) {
        if (!el) return true;
        if (el.id && /(?:^|-)loading$/i.test(el.id)) return true;
        if (el.classList.contains('animate-pulse')) return true;
        const hasHeadingOrContent = Boolean(
            el.querySelector('h1, h2, h3, h4, article, section, input, select, textarea, table, form')
        );
        if (!hasHeadingOrContent) {
            const visibleButtons = Array.from(el.querySelectorAll('button')).filter(
                btn => !btn.classList.contains('hidden')
            );
            if (visibleButtons.length === 0 && el.textContent.trim().length < 120) {
                return true;
            }
        }
        return false;
    }

    function getContentAnchorChildren(container) {
        return Array.from(container.children).filter(el => {
            if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
            if (el.id === 'accord-ad-banner-slot' || el.id === 'mid-grid-banner') return false;
            if (el.classList.contains('accord-dynamic-banner-slot')) return false;
            if (el.classList.contains('hidden')) return false;
            if (isNonContentLeadingElement(el)) return false;
            return true;
        });
    }

    function renderPromoSlotHtml(promo) {
        if (promo.promo_type === 'banner') {
            return buildBannerSlideHtml(promo);
        }
        return window.createAccordSponsoredCardElement(promo).outerHTML;
    }

    function insertBannerAtZone(container, zone, promo) {
        const safeZone = zone === 'top' ? 'mid' : zone;
        const anchors = getContentAnchorChildren(container);
        const hasAnyPageContent = anchors.length > 0 || Array.from(container.children).some(el => {
            if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
            if (el.id === 'accord-ad-banner-slot' || el.id === 'mid-grid-banner') return false;
            if (el.classList.contains('accord-dynamic-banner-slot')) return false;
            return !isNonContentLeadingElement(el);
        });
        if (!hasAnyPageContent) return;

        const existing = container.querySelector(`.accord-dynamic-banner-slot[data-accord-slot-zone="${safeZone}"]`);
        if (existing) {
            existing.innerHTML = renderPromoSlotHtml(promo);
            existing.classList.remove('hidden');
            return;
        }

        const slot = document.createElement('div');
        slot.className = 'accord-dynamic-banner-slot my-5 w-full';
        slot.setAttribute('data-accord-slot-zone', safeZone);
        slot.innerHTML = renderPromoSlotHtml(promo);

        if (safeZone === 'mid') {
            const bookGridBottom = document.getElementById('book-grid-bottom');
            if (bookGridBottom && bookGridBottom.parentElement === container) {
                container.insertBefore(slot, bookGridBottom);
                return;
            }
            if (anchors.length >= 4) {
                const midIdx = Math.max(2, Math.floor(anchors.length / 2));
                container.insertBefore(slot, anchors[midIdx]);
            } else {
                container.appendChild(slot);
            }
            return;
        }

        container.appendChild(slot);
    }

    function getPromoDailyUsd(promo) {
        const explicitDaily = Number(promo?.daily_budget_usd || 0);
        if (explicitDaily > 0) return explicitDaily;
        const totalBudget = Number(promo?.budget_amount || 0);
        if (totalBudget > 0) {
            const days = Math.max(1, Number(promo?.duration_days || 1));
            return totalBudget / days;
        }
        return 1;
    }

    function shufflePromos(list) {
        if (!Array.isArray(list) || list.length <= 1) return [...(list || [])];
        // Weighted random sampling (Efraimidis-Spirakis): higher daily spenders get higher priority
        return list
            .map(item => {
                const weight = Math.max(0.25, getPromoDailyUsd(item));
                const r = Math.max(1e-9, Math.random());
                return { item, score: Math.pow(r, 1 / weight) };
            })
            .sort((a, b) => b.score - a.score)
            .map(entry => entry.item);
    }

    window.createAccordInlineAdElement = function (promo) {
        if (promo && promo.promo_type === 'banner') {
            const wrapper = document.createElement('div');
            wrapper.className = 'accord-inline-banner-ad w-full';
            wrapper.innerHTML = buildBannerSlideHtml(promo);
            return wrapper;
        }
        return window.createAccordSponsoredCardElement(promo);
    };

    window.populateAccordLibraryInlineAds = async function () {
        if (getCurrentPagePlacement() !== 'library') return;
        const slots = Array.from(document.querySelectorAll('.accord-library-inline-ad'));
        if (slots.length === 0) return;

        const promos = await fetchActivePromotions();
        if (!promos || promos.length === 0) {
            slots.forEach(slot => slot.remove());
            return;
        }

        // Prefer non-top/non-bottom promos for inline chunks, falling back to all promos if needed
        let pool = promos.filter(p => {
            const pos = getPromoSlotPosition(p);
            return pos === 'dynamic' || pos === 'mid';
        });
        if (pool.length === 0) {
            pool = [...promos];
        }

        let ordered = shufflePromos(pool);
        // Avoid repeating the mid-zone banner right in the first inline chunk if alternatives exist
        if (_lastMidPromoId && ordered.length > 1 && String(ordered[0].id) === String(_lastMidPromoId)) {
            ordered.push(ordered.shift());
        }

        slots.forEach((slot, idx) => {
            const promo = ordered[idx % ordered.length];
            slot.innerHTML = '';
            slot.appendChild(window.createAccordInlineAdElement(promo));
            slot.classList.remove('hidden');
        });

        setupAdImpressionObserver();
        window.hydrateSharedBookLinkPreviews?.();
    };

    window.renderAccordCentralAdBanners = async function (containerId) {
        if (!isMainSitePage() && !containerId) return;

        // Hide the legacy hardcoded slot so dynamic placement takes over cleanly
        const legacySlot = document.getElementById('accord-ad-banner-slot');
        if (legacySlot) {
            legacySlot.classList.add('hidden');
            legacySlot.innerHTML = '';
        }

        const adConfig = await fetchAdPageConfig();
        const currentPlacement = getCurrentPagePlacement();
        if (!isPagePlacementAllowed(adConfig, currentPlacement)) {
            document.querySelectorAll('.accord-dynamic-banner-slot').forEach(el => el.remove());
            document.querySelectorAll('.accord-library-inline-ad').forEach(el => el.remove());
            const midGridBanner = document.getElementById('mid-grid-banner');
            if (midGridBanner) {
                midGridBanner.classList.add('hidden');
                midGridBanner.innerHTML = '';
            }
            return;
        }

        const promos = await fetchActivePromotions();
        // On feed.html, feed.js renders inline ads (including banners) directly between posts in #feed-stream;
        // only render explicitly bottom-pinned banners as page-level zones on feed.html (never at the very top).
        const banners = currentPlacement === 'feed'
            ? promos.filter(p => {
                if (p.promo_type !== 'banner') return false;
                const pos = getPromoSlotPosition(p);
                return pos === 'bottom';
            })
            : promos;

        document.querySelectorAll('.accord-dynamic-banner-slot').forEach(el => el.remove());
        _lastMidPromoId = null;

        if (banners.length === 0) {
            if (currentPlacement === 'library') {
                await window.populateAccordLibraryInlineAds();
            }
            return;
        }

        const container = getDynamicBannerContainer();
        if (!container) return;

        // Group or assign banners to dynamic zones: mid and bottom (never top right below header)
        const zoneOrder = ['mid', 'bottom'];
        const zoneAssignments = {};
        const dynamicQueue = [];

        banners.forEach(b => {
            const pos = getPromoSlotPosition(b);
            if (pos === 'dynamic') {
                dynamicQueue.push(b);
            } else {
                if (!zoneAssignments[pos]) zoneAssignments[pos] = [];
                zoneAssignments[pos].push(b);
            }
        });

        // Distribute dynamic banners across available zones (rotating randomly so they don't stay hardcoded)
        const shuffledDynamic = shufflePromos(dynamicQueue);
        const startOffset = Math.floor(Math.random() * zoneOrder.length);
        shuffledDynamic.forEach((b, idx) => {
            const chosenZone = zoneOrder[(startOffset + idx) % zoneOrder.length];
            if (!zoneAssignments[chosenZone]) zoneAssignments[chosenZone] = [];
            zoneAssignments[chosenZone].push(b);
        });

        // Render up to 1 banner per zone (avoiding duplicate picks across zones when possible)
        const usedIds = new Set();
        Object.entries(zoneAssignments).forEach(([zone, list]) => {
            if (!list || list.length === 0) return;
            const unused = list.filter(item => !usedIds.has(String(item.id)));
            const candidates = unused.length > 0 ? unused : list;
            const chosen = shufflePromos(candidates)[0];
            usedIds.add(String(chosen.id));
            if (zone === 'mid') _lastMidPromoId = chosen.id;
            insertBannerAtZone(container, zone, chosen);
        });

        if (currentPlacement === 'library') {
            await window.populateAccordLibraryInlineAds();
        }

        setupAdImpressionObserver();
        window.hydrateSharedBookLinkPreviews?.();
    };

    window.getAccordSponsoredFeedCards = async function () {
        const promos = await fetchActivePromotions();
        // Include post, book, and non-edge-pinned banner promos so different ads appear throughout the feed stream
        const eligible = promos.filter(p => {
            if (p.promo_type === 'post' || p.promo_type === 'book') return true;
            if (p.promo_type === 'banner') {
                const pos = getPromoSlotPosition(p);
                return pos === 'dynamic' || pos === 'mid';
            }
            return false;
        });
        return shufflePromos(eligible);
    };

    function getSponsoredPostTypeMeta(type) {
        if (typeof window.getSharedPostTypeMeta === 'function') {
            return window.getSharedPostTypeMeta(type);
        }
        switch (type) {
            case 'video':
                return { label: 'Video', icon: 'fa-video', textColor: 'text-accord-blue' };
            case 'audio':
                return { label: 'Audio', icon: 'fa-circle-play', textColor: 'text-accord-gold' };
            case 'text':
                return { label: 'Text Post', icon: 'fa-align-left', textColor: 'text-emerald-600' };
            case 'testimony':
                return { label: 'Testimony', icon: 'fa-heart', textColor: 'text-rose-600' };
            default:
                return { label: 'Post', icon: 'fa-bullhorn', textColor: 'text-amber-600' };
        }
    }

    function getSponsoredYouTubeEmbedUrl(url) {
        if (typeof window.getSharedYouTubeEmbedUrl === 'function') {
            return window.getSharedYouTubeEmbedUrl(url);
        }
        if (!url) return '';
        let videoId = '';
        if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1]?.split('?')[0];
        else if (url.includes('watch?v=')) videoId = url.split('watch?v=')[1]?.split('&')[0];
        else if (url.includes('embed/')) videoId = url.split('embed/')[1]?.split('?')[0];
        else if (url.includes('/shorts/')) videoId = url.split('/shorts/')[1]?.split('?')[0];
        else if (url.includes('/live/')) videoId = url.split('/live/')[1]?.split('?')[0];
        return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
    }

    function extractSponsoredBookId(text) {
        if (typeof window.extractSharedBookId === 'function') {
            return window.extractSharedBookId(text);
        }
        if (!text) return null;
        const m = String(text).match(/(?:book\.html\?(?:[^#\s]*&)?(?:id|book)=|[?&]book=)(\d+)/i);
        return m ? m[1] : null;
    }

    window.toggleAccordSponsoredBody = function (btn) {
        if (!btn) return;
        const bodyEl = btn.previousElementSibling;
        if (!bodyEl) return;
        const expanded = btn.dataset.expanded === 'true';
        if (expanded) {
            bodyEl.textContent = btn.dataset.shortBody || '';
            btn.textContent = 'See more';
            btn.dataset.expanded = 'false';
        } else {
            bodyEl.textContent = btn.dataset.fullBody || '';
            btn.textContent = 'See less';
            btn.dataset.expanded = 'true';
        }
    };

    window.shareAccordSponsoredPost = async function (postId, promoId) {
        if (promoId) window.trackAccordAdClick(promoId);
        const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
        const url = `${base}post.html?id=${encodeURIComponent(postId)}`;
        if (typeof window.shareOrCopyPost === 'function') {
            await window.shareOrCopyPost({ id: postId, post_type: 'post', is_anonymous: true });
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            if (typeof window.showToast === 'function') window.showToast('Post link copied to clipboard.');
        } catch {
            prompt('Copy this post link:', url);
        }
    };

    function buildSponsoredPostMediaHtml(post, promo, href, targetAttr, altText) {
        if (post && post.post_type === 'video' && post.media_url) {
            if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(post.media_url)) {
                return `
                    <div class="relative w-full aspect-video bg-black">
                        <video controls playsinline preload="none" src="${escapeAdHtml(post.media_url)}" class="w-full h-full object-contain"></video>
                    </div>
                `;
            }
            const embedUrl = getSponsoredYouTubeEmbedUrl(post.media_url);
            return `
                <div class="relative w-full aspect-video bg-black">
                    <iframe loading="lazy" src="${escapeAdHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>
                </div>
            `;
        }

        if (post && post.post_type === 'audio' && post.media_url) {
            const isDirectAudio = /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(post.media_url);
            return isDirectAudio
                ? `<div class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                       <audio controls preload="none" src="${escapeAdHtml(post.media_url)}" class="w-full"></audio>
                   </div>`
                : `<a href="${escapeAdHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" onclick="trackAccordAdClick('${promo.id}')" class="mx-4 mb-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3.5 flex items-center space-x-3.5 transition-colors">
                       <div class="w-11 h-11 bg-accord-goldLight rounded-xl flex items-center justify-center text-accord-gold shrink-0">
                           <i class="fa-solid fa-circle-play text-lg"></i>
                       </div>
                       <div class="flex-grow min-w-0">
                           <p class="text-xs font-bold text-accord-slate truncate">Audio Stream</p>
                           <span class="text-[11px] text-accord-blue font-semibold hover:underline truncate block">Listen on external platform →</span>
                       </div>
                   </a>`;
        }

        const desktopImg = promo.desktop_image_url || promo.mobile_image_url || '';
        const mobileImg = promo.mobile_image_url || promo.desktop_image_url || '';
        if (!desktopImg && !mobileImg) return '';

        const mediaImgs = `
            ${desktopImg ? `<img src="${escapeAdHtml(desktopImg)}" alt="${altText}" class="hidden sm:block w-full max-h-72 md:max-h-80 object-cover ${href ? 'group-hover:scale-[1.01] transition-transform duration-300' : ''}">` : ''}
            ${mobileImg ? `<img src="${escapeAdHtml(mobileImg)}" alt="${altText}" class="sm:hidden w-full max-h-80 object-cover">` : ''}
        `;

        return href
            ? `<a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="block overflow-hidden border-y border-slate-100 bg-slate-50 group">${mediaImgs}</a>`
            : `<div class="block overflow-hidden border-y border-slate-100 bg-slate-50">${mediaImgs}</div>`;
    }

    function createSponsoredFeedPostCard(promo) {
        const post = promo._targetPost || null;
        const authorProfile = promo._authorProfile || null;
        const card = document.createElement('article');
        card.className = 'w-full max-w-2xl mx-auto bg-white border border-slate-200/80 rounded-xl sm:rounded-2xl shadow-sm overflow-visible';
        card.setAttribute('data-promo-id', promo.id);

        const postDetailHref = post ? `post.html?id=${encodeURIComponent(post.id)}` : '';
        const href = (promo.cta_url || '').trim() || (promo.ad_goal !== 'views' ? postDetailHref : '');
        const isExternal = /^https?:\/\//i.test(href);
        const targetAttr = isExternal ? 'target="_blank" rel="noopener noreferrer"' : '';

        if (post) {
            const displayAuthor = post.is_anonymous
                ? 'Anonymous'
                : (post.author_name || authorProfile?.full_name || promo.advertiser_name || 'Member');
            const isVerifiedAuthor = post.author_role === 'ministry_minister' && !post.is_anonymous;
            const authorAvatarUrl = (!post.is_anonymous && authorProfile?.avatar_url) ? authorProfile.avatar_url : '';
            const authorHandle = (!post.is_anonymous && authorProfile?.handle) ? authorProfile.handle : '';
            const authorProfileUrl = (!post.is_anonymous && post.author_id)
                ? `user.html?id=${encodeURIComponent(post.author_id)}`
                : null;

            const avatarVisual = authorAvatarUrl
                ? `<img src="${escapeAdHtml(authorAvatarUrl)}" alt="${escapeAdHtml(displayAuthor)}" class="w-full h-full object-cover rounded-full">`
                : `<span>${escapeAdHtml(displayAuthor.charAt(0).toUpperCase())}</span>`;

            const avatarInner = `
                <div class="relative w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-sm shrink-0">
                    ${avatarVisual}
                    ${isVerifiedAuthor ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-white"><i class="fa-solid fa-check text-[8px]"></i></span>` : ''}
                </div>
            `;

            const authorAvatarHtml = authorProfileUrl
                ? `<a href="${escapeAdHtml(authorProfileUrl)}" class="shrink-0 hover:opacity-90 transition-opacity">${avatarInner}</a>`
                : avatarInner;

            const authorNameHtml = authorProfileUrl
                ? `<a href="${escapeAdHtml(authorProfileUrl)}" class="text-[14px] font-bold text-slate-900 hover:underline truncate">${escapeAdHtml(displayAuthor)}</a>`
                : `<span class="text-[14px] font-bold text-slate-900 truncate">${escapeAdHtml(displayAuthor)}</span>`;

            const handleHtml = authorHandle
                ? `<span class="text-xs text-slate-500 font-medium truncate">${escapeAdHtml(authorHandle)}</span>`
                : '';

            const typeMeta = getSponsoredPostTypeMeta(post.post_type);
            const bodyText = String(post.body || promo.body || '');
            const isLongBody = bodyText.length > 260;
            const shownBody = isLongBody ? bodyText.slice(0, 260).trim() + '...' : bodyText;
            const linkedBookId = extractSponsoredBookId(bodyText);
            const mediaHtml = buildSponsoredPostMediaHtml(post, promo, href, targetAttr, escapeAdHtml(promo.title || bodyText || typeMeta.label));

            const likesCount = Number(post.likes_count) || 0;
            const commentsCount = Number(promo._commentsCount) || 0;
            const repostsCount = Number(post.reposts_count) || 0;

            const showCustomCtaBar = Boolean(href && href !== postDetailHref);

            card.innerHTML = `
                <div class="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
                    <div class="flex items-center space-x-2.5 min-w-0">
                        ${authorAvatarHtml}
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                ${authorNameHtml}
                                ${isVerifiedAuthor ? '<i class="fa-solid fa-circle-check text-accord-blue text-xs" title="Verified Ministry / Minister"></i>' : ''}
                                ${handleHtml}
                            </div>
                            <div class="flex items-center gap-1.5 text-[11px] text-slate-500 flex-wrap">
                                <span class="inline-flex items-center gap-1 font-semibold text-amber-600">
                                    <i class="fa-solid fa-bullhorn text-[9px]"></i>
                                    <span>Sponsored</span>
                                </span>
                                <span>·</span>
                                <span class="inline-flex items-center gap-1 font-semibold ${typeMeta.textColor}">
                                    <i class="fa-solid ${typeMeta.icon} text-[10px]"></i>
                                    <span>${typeMeta.label}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 pt-0.5">
                        ${typeof toggleSavePost === 'function' ? (() => {
                            const isSaved = typeof isPostSavedShared === 'function' && isPostSavedShared(post.id);
                            return `<button type="button" data-save-post-btn="${escapeAdHtml(post.id)}" onclick="toggleSavePost('${escapeAdHtml(post.id)}')" class="w-8 h-8 rounded-full ${isSaved ? 'hover:bg-amber-50 text-accord-gold' : 'hover:bg-slate-100 text-slate-400 hover:text-accord-slate'} flex items-center justify-center transition-colors" aria-label="${isSaved ? 'Remove from Saved' : 'Save Post'}" title="${isSaved ? 'Saved' : 'Save Post'}"><i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-bookmark text-sm"></i></button>`;
                        })() : ''}
                        <a href="promote.html" class="text-[10px] font-semibold text-slate-400 hover:text-accord-blue shrink-0">Advertise</a>
                    </div>
                </div>

                ${bodyText ? `
                <div class="px-4 pb-3 space-y-1.5">
                    <p class="text-[14px] text-slate-800 leading-relaxed whitespace-pre-wrap">${escapeAdHtml(shownBody)}</p>
                    ${isLongBody ? `<button type="button" onclick="toggleAccordSponsoredBody(this)" data-expanded="false" data-short-body="${escapeAdHtml(shownBody)}" data-full-body="${escapeAdHtml(bodyText)}" class="text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline">See more</button>` : ''}
                </div>` : ''}

                ${mediaHtml}
                ${linkedBookId ? `<div class="feed-book-link-preview mx-4 mt-3 mb-2" data-book-id="${escapeAdHtml(linkedBookId)}"></div>` : ''}

                ${showCustomCtaBar ? `
                <div class="mx-4 mt-3 mb-1 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-slate-800 truncate">${escapeAdHtml(promo.title || displayAuthor)}</p>
                        <p class="text-[11px] text-slate-500 truncate">${escapeAdHtml(href)}</p>
                    </div>
                    <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="px-3.5 py-1.5 rounded-lg bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shrink-0 transition-colors">
                        ${escapeAdHtml(promo.cta_text || 'Learn More')}
                    </a>
                </div>` : ''}

                <div class="px-4 py-2 flex items-center justify-between text-xs text-slate-500">
                    <div class="flex items-center gap-1.5">
                        <span class="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[9px]">
                            <i class="fa-solid fa-heart"></i>
                        </span>
                        <span>${likesCount}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <a href="${escapeAdHtml(postDetailHref)}#comments-section" onclick="trackAccordAdClick('${promo.id}')" class="hover:underline">
                            ${commentsCount} ${commentsCount === 1 ? 'comment' : 'comments'}
                        </a>
                        <span>${repostsCount} ${repostsCount === 1 ? 'repost' : 'reposts'}</span>
                    </div>
                </div>

                <div class="mx-4 border-t border-slate-200/80 py-1 grid grid-cols-4 gap-1">
                    <a href="${escapeAdHtml(postDetailHref)}" onclick="trackAccordAdClick('${promo.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                        <i class="fa-regular fa-heart text-sm"></i>
                        <span>Like</span>
                    </a>
                    <a href="${escapeAdHtml(postDetailHref)}#comments-section" onclick="trackAccordAdClick('${promo.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                        <i class="fa-regular fa-comment text-sm"></i>
                        <span>Comment</span>
                    </a>
                    <a href="${escapeAdHtml(postDetailHref)}" onclick="trackAccordAdClick('${promo.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                        <i class="fa-solid fa-retweet text-sm"></i>
                        <span>Repost</span>
                    </a>
                    <button type="button" onclick="shareAccordSponsoredPost('${escapeAdHtml(post.id)}', '${promo.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                        <i class="fa-solid fa-share text-sm"></i>
                        <span>Share</span>
                    </button>
                </div>
            `;
            return card;
        }

        const displayAuthor = promo.advertiser_name || promo.title || 'Accord Sponsor';
        const bodyText = String(promo.body || '');
        const mediaHtml = buildSponsoredPostMediaHtml(null, promo, href, targetAttr, escapeAdHtml(promo.title || bodyText || 'Sponsored Post'));

        card.innerHTML = `
            <div class="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
                <div class="flex items-center space-x-2.5 min-w-0">
                    <div class="w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-sm shrink-0">
                        <span>${escapeAdHtml(displayAuthor.charAt(0).toUpperCase())}</span>
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-[14px] font-bold text-slate-900 truncate">${escapeAdHtml(displayAuthor)}</span>
                        </div>
                        <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span class="inline-flex items-center gap-1 font-semibold text-amber-600">
                                <i class="fa-solid fa-bullhorn text-[9px]"></i>
                                <span>Sponsored</span>
                            </span>
                            <span>·</span>
                            <span class="inline-flex items-center gap-1 font-semibold text-emerald-600">
                                <i class="fa-solid fa-align-left text-[10px]"></i>
                                <span>Post</span>
                            </span>
                        </div>
                    </div>
                </div>
                <a href="promote.html" class="text-[10px] font-semibold text-slate-400 hover:text-accord-blue shrink-0 pt-1">Advertise</a>
            </div>
            <div class="px-4 pb-3 space-y-1.5">
                ${promo.title && promo.title !== displayAuthor ? `<h3 class="text-[15px] font-bold text-slate-900 leading-snug">${escapeAdHtml(promo.title)}</h3>` : ''}
                ${bodyText ? `<p class="text-[14px] text-slate-800 leading-relaxed whitespace-pre-wrap">${escapeAdHtml(bodyText)}</p>` : ''}
            </div>
            ${mediaHtml}
            ${href ? `
            <div class="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70 rounded-b-xl sm:rounded-b-2xl">
                <span class="text-[11px] text-slate-500 truncate">${escapeAdHtml(href)}</span>
                <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all shrink-0">
                    <span>${escapeAdHtml(promo.cta_text || 'Learn More')}</span>
                    <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </a>
            </div>` : ''}
        `;
        return card;
    }

    window.createAccordSponsoredCardElement = function (promo) {
        if (promo && promo.promo_type === 'post') {
            return createSponsoredFeedPostCard(promo);
        }

        const card = document.createElement('article');
        card.className = 'bg-gradient-to-br from-amber-50/60 via-white to-blue-50/40 border border-accord-gold/40 rounded-xl sm:rounded-2xl shadow-sm p-4 space-y-3';
        card.setAttribute('data-promo-id', promo.id);

        const href = (promo.cta_url || '').trim() || (promo.ad_goal !== 'views'
            ? (promo.target_book_id ? `book.html?id=${promo.target_book_id}` : promo.target_post_id ? `post.html?id=${promo.target_post_id}` : '')
            : '');
        const isExternal = /^https?:\/\//i.test(href);
        const targetAttr = isExternal ? 'target="_blank" rel="noopener noreferrer"' : '';
        const desktopImg = promo.desktop_image_url || promo.mobile_image_url || '';
        const mobileImg = promo.mobile_image_url || promo.desktop_image_url || '';
        const typeLabel = promo.promo_type === 'book' ? 'Promoted Book' : 'Sponsored Post';
        const altText = escapeAdHtml(promo.title || promo.body || typeLabel);

        const mediaImgs = `
            ${desktopImg ? `<img src="${escapeAdHtml(desktopImg)}" alt="${altText}" class="hidden sm:block w-full max-h-72 md:max-h-80 object-cover ${href ? 'group-hover:scale-[1.01] transition-transform duration-300' : ''}">` : ''}
            ${mobileImg ? `<img src="${escapeAdHtml(mobileImg)}" alt="${altText}" class="sm:hidden w-full max-h-80 object-cover">` : ''}
        `;

        const mediaHtml = (desktopImg || mobileImg)
            ? (href
                ? `<a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="block rounded-xl overflow-hidden border border-slate-200/80 bg-slate-50 group">${mediaImgs}</a>`
                : `<div class="block rounded-xl overflow-hidden border border-slate-200/80 bg-slate-50">${mediaImgs}</div>`)
            : '';

        card.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-0.5 rounded-full bg-accord-goldLight text-accord-gold text-[10px] font-extrabold uppercase tracking-wider">
                        <i class="fa-solid fa-star text-[9px] mr-1"></i>${typeLabel}
                    </span>
                    ${promo.advertiser_name ? `<span class="text-xs font-semibold text-slate-600">${escapeAdHtml(promo.advertiser_name)}</span>` : ''}
                </div>
                <a href="promote.html" class="text-[10px] font-semibold text-slate-400 hover:text-accord-blue">Advertise</a>
            </div>
            ${mediaHtml}
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-0.5">
                <div class="flex-1 min-w-0 space-y-1">
                    ${promo.title ? `<h3 class="text-[15px] sm:text-base font-bold text-slate-900 leading-snug">${escapeAdHtml(promo.title)}</h3>` : ''}
                    ${promo.body ? `<p class="text-xs sm:text-[13px] text-slate-600 leading-relaxed line-clamp-3">${escapeAdHtml(promo.body)}</p>` : ''}
                </div>
                ${href ? `
                <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all shrink-0 self-start sm:self-center">
                    <span>${escapeAdHtml(promo.cta_text || 'View Details')}</span>
                    <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </a>
                ` : ''}
            </div>
        `;
        return card;
    };

    window.observeAccordAds = setupAdImpressionObserver;

    document.addEventListener('DOMContentLoaded', () => {
        if (isMainSitePage()) {
            window.renderAccordCentralAdBanners();
        }
    });
})();
