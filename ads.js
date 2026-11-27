/**
 * Accord Archive — Centralized Ad Banner & Paid Promotions Renderer
 * Dynamically places approved ad banners across every main page of the site
 * and renders sponsored post/book cards in feeds.
 */

(function () {
    let _activePromotionsCache = null;
    let _adImpressionObserver = null;
    let _lastMidPromoId = null;
    const _trackedImpressions = new Set();

    const MAIN_PAGE_PLACEMENTS = {
        library: ['index.html', ''],
        feed: ['feed.html'],
        music: ['music.html'],
        book: ['book.html'],
        post: ['post.html'],
        author: ['author.html'],
        artist: ['artist.html', 'artist-blog.html'],
        ministry: ['ministry.html'],
        polls: ['polls.html'],
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
        if (raw === 'top' || raw === 'mid' || raw === 'bottom' || raw === 'dynamic') {
            return raw;
        }
        const notes = String(promo?.admin_notes || '');
        const match = notes.match(/\[slot:(top|mid|bottom|dynamic)\]/i);
        if (match) return match[1].toLowerCase();
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

    async function fetchActivePromotions(forceRefresh = false) {
        if (_activePromotionsCache && !forceRefresh) return _activePromotionsCache;
        const client = window.supabaseClient;
        if (!client) return [];

        const nowIso = new Date().toISOString();
        const { data, error } = await client
            .from('promotions')
            .select('*')
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(60);

        if (error || !Array.isArray(data)) {
            _activePromotionsCache = [];
            return [];
        }

        const nowMs = Date.now();
        const placement = getCurrentPagePlacement();
        const userCountry = getUserGeoCountry();

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
            return true;
        });

        return _activePromotionsCache;
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

    function getContentAnchorChildren(container) {
        return Array.from(container.children).filter(el => {
            if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
            if (el.id === 'accord-ad-banner-slot' || el.id === 'mid-grid-banner') return false;
            if (el.classList.contains('accord-dynamic-banner-slot')) return false;
            if (el.classList.contains('hidden')) return false;
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
        const existing = container.querySelector(`.accord-dynamic-banner-slot[data-accord-slot-zone="${zone}"]`);
        if (existing) {
            existing.innerHTML = renderPromoSlotHtml(promo);
            existing.classList.remove('hidden');
            return;
        }

        const slot = document.createElement('div');
        slot.className = 'accord-dynamic-banner-slot my-5 w-full';
        slot.setAttribute('data-accord-slot-zone', zone);
        slot.innerHTML = renderPromoSlotHtml(promo);

        const anchors = getContentAnchorChildren(container);

        if (zone === 'top') {
            if (anchors.length > 0) {
                container.insertBefore(slot, anchors[0]);
            } else {
                container.prepend(slot);
            }
            return;
        }

        if (zone === 'mid') {
            const bookGridBottom = document.getElementById('book-grid-bottom');
            if (bookGridBottom && bookGridBottom.parentElement === container) {
                container.insertBefore(slot, bookGridBottom);
                return;
            }
            if (anchors.length >= 2) {
                const midIdx = Math.max(1, Math.floor(anchors.length / 2));
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
    };

    window.renderAccordCentralAdBanners = async function (containerId) {
        if (!isMainSitePage() && !containerId) return;

        // Hide the legacy hardcoded slot so dynamic placement takes over cleanly
        const legacySlot = document.getElementById('accord-ad-banner-slot');
        if (legacySlot) {
            legacySlot.classList.add('hidden');
            legacySlot.innerHTML = '';
        }

        const promos = await fetchActivePromotions();
        const currentPlacement = getCurrentPagePlacement();
        // On feed.html, feed.js renders inline ads (including banners) directly between posts in #feed-stream;
        // only render explicitly top/bottom-pinned banners as page-level zones on feed.html.
        const banners = currentPlacement === 'feed'
            ? promos.filter(p => {
                if (p.promo_type !== 'banner') return false;
                const pos = getPromoSlotPosition(p);
                return pos === 'top' || pos === 'bottom';
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

        // Group or assign banners to dynamic zones: top, mid, bottom
        const zoneOrder = ['mid', 'top', 'bottom'];
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

    window.createAccordSponsoredCardElement = function (promo) {
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
