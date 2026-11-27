/**
 * Accord Archive — Centralized Ad Banner & Paid Promotions Renderer
 * Dynamically places approved ad banners across every main page of the site
 * and renders sponsored post/book cards in feeds.
 */

(function () {
    let _activePromotionsCache = null;
    let _adImpressionObserver = null;
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
        return (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
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

        const placement = getCurrentPagePlacement();
        const userCountry = getUserGeoCountry();

        _activePromotionsCache = data.filter(p => {
            if (p.starts_at && p.starts_at > nowIso) return false;
            if (p.ends_at && p.ends_at < nowIso) return false;

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
        const href = promo.cta_url || (promo.target_book_id ? `book.html?id=${promo.target_book_id}` : promo.target_post_id ? `post.html?id=${promo.target_post_id}` : 'promote.html');
        const isExternal = /^https?:\/\//i.test(href);
        const targetAttr = isExternal ? 'target="_blank" rel="noopener noreferrer"' : '';
        const desktopImg = promo.desktop_image_url || promo.mobile_image_url || '';
        const mobileImg = promo.mobile_image_url || promo.desktop_image_url || '';

        if (desktopImg || mobileImg) {
            return `
                <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" data-promo-id="${promo.id}" class="block relative rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/90 shadow-md group bg-white">
                    <span class="absolute top-2.5 left-2.5 z-10 px-2.5 py-0.5 rounded-full bg-accord-slate/80 text-white text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm">Sponsored</span>
                    ${desktopImg ? `<img src="${escapeAdHtml(desktopImg)}" alt="${escapeAdHtml(promo.title)}" class="hidden sm:block w-full max-h-56 object-cover group-hover:scale-[1.01] transition-transform duration-300">` : ''}
                    ${mobileImg ? `<img src="${escapeAdHtml(mobileImg)}" alt="${escapeAdHtml(promo.title)}" class="sm:hidden w-full max-h-60 object-cover">` : ''}
                </a>
            `;
        }

        return `
            <div data-promo-id="${promo.id}" class="rounded-2xl sm:rounded-3xl bg-gradient-to-r from-accord-slate via-slate-900 to-accord-darkBlue text-white p-5 sm:p-7 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div class="space-y-1.5 min-w-0">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accord-gold/20 text-accord-gold text-[10px] font-extrabold uppercase tracking-wider">
                        <i class="fa-solid fa-bullhorn text-[9px]"></i> Sponsored
                    </span>
                    <h3 class="text-base sm:text-xl font-bold leading-snug">${escapeAdHtml(promo.title)}</h3>
                    ${promo.body ? `<p class="text-xs sm:text-sm text-slate-200 line-clamp-2">${escapeAdHtml(promo.body)}</p>` : ''}
                </div>
                <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="px-5 py-2.5 rounded-xl bg-accord-gold hover:bg-amber-500 text-accord-slate text-xs font-extrabold shrink-0 transition-all shadow">
                    ${escapeAdHtml(promo.cta_text || 'Learn More')}
                </a>
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

    function insertBannerAtZone(container, zone, promo) {
        const existing = container.querySelector(`.accord-dynamic-banner-slot[data-accord-slot-zone="${zone}"]`);
        if (existing) {
            existing.innerHTML = buildBannerSlideHtml(promo);
            existing.classList.remove('hidden');
            return;
        }

        const slot = document.createElement('div');
        slot.className = 'accord-dynamic-banner-slot my-5 w-full';
        slot.setAttribute('data-accord-slot-zone', zone);
        slot.innerHTML = buildBannerSlideHtml(promo);

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

    window.renderAccordCentralAdBanners = async function (containerId) {
        if (!isMainSitePage() && !containerId) return;

        // Hide the legacy hardcoded slot so dynamic placement takes over cleanly
        const legacySlot = document.getElementById('accord-ad-banner-slot');
        if (legacySlot) {
            legacySlot.classList.add('hidden');
            legacySlot.innerHTML = '';
        }

        const promos = await fetchActivePromotions();
        const banners = promos.filter(p => p.promo_type === 'banner');

        document.querySelectorAll('.accord-dynamic-banner-slot').forEach(el => el.remove());

        if (banners.length === 0) {
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
        const shuffledDynamic = [...dynamicQueue].sort(() => Math.random() - 0.5);
        const startOffset = Math.floor(Math.random() * zoneOrder.length);
        shuffledDynamic.forEach((b, idx) => {
            const chosenZone = zoneOrder[(startOffset + idx) % zoneOrder.length];
            if (!zoneAssignments[chosenZone]) zoneAssignments[chosenZone] = [];
            zoneAssignments[chosenZone].push(b);
        });

        // Render up to 1 banner per zone (pick randomly if multiple target the same zone)
        Object.entries(zoneAssignments).forEach(([zone, list]) => {
            if (!list || list.length === 0) return;
            const chosen = list[Math.floor(Math.random() * list.length)];
            insertBannerAtZone(container, zone, chosen);
        });

        setupAdImpressionObserver();
    };

    window.getAccordSponsoredFeedCards = async function () {
        const promos = await fetchActivePromotions();
        return promos.filter(p => p.promo_type === 'post' || p.promo_type === 'book');
    };

    window.createAccordSponsoredCardElement = function (promo) {
        const card = document.createElement('article');
        card.className = 'bg-gradient-to-br from-amber-50/60 via-white to-blue-50/40 border border-accord-gold/40 rounded-xl sm:rounded-2xl shadow-sm p-4 space-y-3';
        card.setAttribute('data-promo-id', promo.id);

        const href = promo.cta_url || (promo.target_book_id ? `book.html?id=${promo.target_book_id}` : promo.target_post_id ? `post.html?id=${promo.target_post_id}` : 'promote.html');
        const isExternal = /^https?:\/\//i.test(href);
        const targetAttr = isExternal ? 'target="_blank" rel="noopener noreferrer"' : '';
        const imgUrl = promo.desktop_image_url || promo.mobile_image_url || '';
        const typeLabel = promo.promo_type === 'book' ? 'Promoted Book' : 'Sponsored Post';

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
            <div class="flex flex-col sm:flex-row gap-3.5 items-start">
                ${imgUrl ? `<img src="${escapeAdHtml(imgUrl)}" alt="${escapeAdHtml(promo.title)}" class="w-full sm:w-28 h-36 sm:h-28 object-cover rounded-xl border border-slate-200 shrink-0">` : ''}
                <div class="flex-1 min-w-0 space-y-1.5">
                    <h3 class="text-[15px] font-bold text-slate-900 leading-snug">${escapeAdHtml(promo.title)}</h3>
                    ${promo.body ? `<p class="text-xs sm:text-[13px] text-slate-700 leading-relaxed line-clamp-3">${escapeAdHtml(promo.body)}</p>` : ''}
                    <div class="pt-1">
                        <a href="${escapeAdHtml(href)}" ${targetAttr} onclick="trackAccordAdClick('${promo.id}')" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all">
                            <span>${escapeAdHtml(promo.cta_text || 'View Details')}</span>
                            <i class="fa-solid fa-arrow-right text-[10px]"></i>
                        </a>
                    </div>
                </div>
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
