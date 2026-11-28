const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

let promoUser = null;
let myPostsCache = [];
let booksCache = [];
let promotablePageIds = [];
let promotablePagesById = {};
let savedCardsCache = [];
let usingLocalCardsFallback = false;
let myPromotionsCache = [];
let activeDetailPromoId = null;
let promoAuthorProfilesById = {};
let activePromoTab = 'create';

function switchPromoTab(tab) {
    const valid = ['create', 'campaigns', 'cards'].includes(tab) ? tab : 'create';
    activePromoTab = valid;

    document.querySelectorAll('[data-promo-tab]').forEach(btn => {
        const isSelected = btn.getAttribute('data-promo-tab') === valid;
        btn.className = isSelected
            ? 'px-4 py-2 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm inline-flex items-center gap-2'
            : 'px-4 py-2 rounded-xl text-xs font-bold transition-all text-accord-slate hover:bg-slate-100 inline-flex items-center gap-2';
    });

    ['create', 'campaigns', 'cards'].forEach(key => {
        const panel = document.getElementById(`promo-tab-panel-${key}`);
        if (panel) panel.classList.toggle('hidden', key !== valid);
    });
}

function getPostThumbnailHtml(post) {
    const typeMeta = typeof window.getSharedPostTypeMeta === 'function'
        ? window.getSharedPostTypeMeta(post?.post_type)
        : { label: 'Post', icon: 'fa-align-left', textColor: 'text-emerald-600' };
    const videoThumb = post?.post_type === 'video' && typeof window.getSharedVideoThumbnailUrl === 'function'
        ? window.getSharedVideoThumbnailUrl(post.media_url)
        : '';

    if (videoThumb) {
        return `
            <div class="relative w-14 h-14 rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-200">
                <img src="${escapePromoHtml(videoThumb)}" alt="Video thumbnail" class="w-full h-full object-cover">
                <span class="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/75 text-white flex items-center justify-center text-[9px]">
                    <i class="fa-solid ${typeMeta.icon}"></i>
                </span>
            </div>
        `;
    }

    const bgByType = {
        video: 'bg-blue-50 text-accord-blue border-blue-200',
        audio: 'bg-amber-50 text-accord-gold border-amber-200',
        text: 'bg-emerald-50 text-emerald-600 border-emerald-200',
        testimony: 'bg-rose-50 text-rose-600 border-rose-200'
    };
    const cls = bgByType[post?.post_type] || 'bg-slate-100 text-accord-slate border-slate-200';
    return `
        <div class="w-14 h-14 rounded-xl border ${cls} flex items-center justify-center shrink-0">
            <i class="fa-solid ${typeMeta.icon} text-lg"></i>
        </div>
    `;
}

function getPromotionThumbnailHtml(promo) {
    if (promo.promo_type === 'post' && promo._targetPost) {
        return getPostThumbnailHtml(promo._targetPost);
    }
    if (promo.promo_type === 'book') {
        const cover = promo._targetBook?.cover_url || promo.desktop_image_url || promo.mobile_image_url || '';
        if (cover) {
            return `
                <div class="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                    <img src="${escapePromoHtml(cover)}" alt="Book cover" class="w-full h-full object-cover">
                </div>
            `;
        }
        return `
            <div class="w-14 h-14 rounded-xl border bg-amber-50 text-accord-gold border-amber-200 flex items-center justify-center shrink-0">
                <i class="fa-solid fa-book-open text-lg"></i>
            </div>
        `;
    }
    const bannerImg = promo.desktop_image_url || promo.mobile_image_url || '';
    if (bannerImg) {
        return `
            <div class="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                <img src="${escapePromoHtml(bannerImg)}" alt="Banner preview" class="w-full h-full object-cover">
            </div>
        `;
    }
    return `
        <div class="w-14 h-14 rounded-xl border bg-blue-50 text-accord-blue border-blue-200 flex items-center justify-center shrink-0">
            <i class="fa-solid fa-panorama text-lg"></i>
        </div>
    `;
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast) return;
    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError ? 'fa-solid fa-circle-exclamation text-red-500 text-lg' : 'fa-solid fa-circle-check text-accord-gold text-lg';
    }
    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3500);
}

function escapePromoHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    promoUser = session?.user || null;

    if (!promoUser) {
        document.getElementById('promo-auth-required')?.classList.remove('hidden');
        return;
    }

    document.getElementById('promo-workspace')?.classList.remove('hidden');
    if (window.AccordCurrency?.init) {
        await window.AccordCurrency.init();
    }
    updatePromoPriceDisplay();
    handlePromoTypeChange();
    handlePromoGoalChange();
    await Promise.all([loadPromoteChoices(), loadSavedPaymentCards(), loadMyPromotions()]);
    renderPostPickerList();
    renderBookPickerList();

    const params = new URLSearchParams(window.location.search);
    const prePost = params.get('post');
    const preBook = params.get('book');
    const tabParam = params.get('tab');
    if (tabParam && ['create', 'campaigns', 'cards'].includes(tabParam)) {
        switchPromoTab(tabParam);
    }
    if (prePost) {
        switchPromoTab('create');
        document.getElementById('promo-type').value = 'post';
        handlePromoTypeChange();
        if (myPostsCache.some(p => String(p.id) === String(prePost))) {
            selectPromoPost(prePost);
        } else {
            showToast('You can only promote posts you made yourself.', true);
        }
    } else if (preBook) {
        switchPromoTab('create');
        document.getElementById('promo-type').value = 'book';
        handlePromoTypeChange();
        if (booksCache.some(b => String(b.id) === String(preBook))) {
            selectPromoBook(preBook);
        } else {
            showToast('You can only promote books you uploaded yourself.', true);
        }
    } else {
        updateLiveAdPreview();
    }
});

async function loadPromoteChoices() {
    promotablePageIds = [];
    promotablePagesById = {};
    const ctx = typeof window.waitForAccordActiveContext === 'function'
        ? await window.waitForAccordActiveContext()
        : null;

    if (ctx?.isSwitched) {
        if (ctx.permissions?.can_promote && ctx.activeProfile) {
            promotablePageIds = [String(ctx.activeProfileId)];
            promotablePagesById[String(ctx.activeProfileId)] = ctx.activeProfile;
        }
    } else {
        try {
            const { data: adminRows } = await supabaseClient
                .from('page_admins')
                .select('page_id, role, permissions, profiles!page_admins_page_id_fkey(id, full_name, handle, account_type, upgrade_status)')
                .eq('admin_user_id', promoUser.id);
            (adminRows || []).forEach(r => {
                const prof = r.profiles;
                const isVerified = prof && (prof.account_type === 'ministry_minister' || prof.upgrade_status === 'approved') && prof.upgrade_status !== 'revoked';
                const p = r.permissions && typeof r.permissions === 'object' ? r.permissions : {};
                if (isVerified && Boolean(p.can_promote)) {
                    const pid = String(r.page_id);
                    promotablePageIds.push(pid);
                    promotablePagesById[pid] = prof;
                }
            });
        } catch {
            promotablePageIds = [];
            promotablePagesById = {};
        }
    }

    const allowedAuthorIds = ctx?.isSwitched
        ? (ctx.permissions?.can_promote ? [String(ctx.activeProfileId)] : [])
        : [String(promoUser.id)];

    const payBtn = document.getElementById('promo-pay-btn');
    if (ctx?.isSwitched && !ctx.permissions?.can_promote) {
        if (payBtn) payBtn.disabled = true;
        showToast(`You do not have Promote permission for ${ctx.activeProfile?.full_name || 'this page'}.`, true);
    }

    const [postsRes, booksRes, profilesRes] = allowedAuthorIds.length === 0
        ? [{ data: [] }, { data: [] }, { data: [] }]
        : await Promise.all([
            supabaseClient.from('feed_posts').select('id, title, body, author_id, author_name, author_role, is_anonymous, post_type, media_url, likes_count, reposts_count, created_at').in('author_id', allowedAuthorIds).order('created_at', { ascending: false }).limit(80),
            supabaseClient.from('books').select('id, title, author, description, cover_url, author_id').eq('is_visible', true).in('author_id', allowedAuthorIds).order('created_at', { ascending: false }).limit(120),
            supabaseClient.from('profiles').select('id, handle, avatar_url, full_name, account_type, upgrade_status').in('id', allowedAuthorIds)
        ]);

    promoAuthorProfilesById = {};
    (profilesRes?.data || []).forEach(prof => {
        promoAuthorProfilesById[String(prof.id)] = prof;
    });

    myPostsCache = postsRes.data || [];
    booksCache = (booksRes.data || []).filter(b => !String(b.title || '').startsWith('__ACCORD_'));

    renderPostPickerList();
    renderBookPickerList();
}

function getPostPromoStatusBadge(postId) {
    const match = myPromotionsCache.find(pr => pr.promo_type === 'post' && String(pr.target_post_id) === String(postId) && ['approved', 'pending_approval', 'paused'].includes(pr.status));
    if (!match) return '';
    if (match.status === 'approved') {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold"><i class="fa-solid fa-rocket text-[9px]"></i> Promoted</span>`;
    }
    if (match.status === 'pending_approval') {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold"><i class="fa-regular fa-clock text-[9px]"></i> Pending</span>`;
    }
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">Paused</span>`;
}

function renderPostPickerList() {
    const listEl = document.getElementById('promo-post-picker-list');
    const countEl = document.getElementById('promo-post-picker-count');
    if (!listEl) return;

    const query = (document.getElementById('promo-post-search')?.value || '').trim().toLowerCase();
    const typeFilter = document.getElementById('promo-post-type-filter')?.value || 'all';
    const selectedId = document.getElementById('promo-post-id')?.value || '';

    const filtered = myPostsCache.filter(p => {
        if (typeFilter !== 'all' && p.post_type !== typeFilter) return false;
        if (query) {
            const hay = `${p.body || ''} ${p.author_name || ''} ${p.post_type || ''}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });

    if (countEl) {
        countEl.textContent = `${filtered.length} post${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-8 text-center">${myPostsCache.length === 0 ? 'No eligible posts to promote yet.' : 'No posts match your search.'}</p>`;
        return;
    }

    listEl.innerHTML = filtered.map(p => {
        const isSelected = String(p.id) === String(selectedId);
        const typeMeta = typeof window.getSharedPostTypeMeta === 'function'
            ? window.getSharedPostTypeMeta(p.post_type)
            : { label: 'Post', icon: 'fa-align-left', textColor: 'text-emerald-600' };
        const pageProf = promotablePagesById[String(p.author_id)] || promoAuthorProfilesById[String(p.author_id)];
        const authorLabel = p.is_anonymous ? 'Anonymous' : (p.author_name || pageProf?.full_name || 'Your Post');
        const dateLabel = p.created_at ? new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const snippet = (p.body || '').trim() || `${typeMeta.label} post`;
        const promoBadge = getPostPromoStatusBadge(p.id);

        return `
        <div role="button" tabindex="0" onclick="selectPromoPost('${escapePromoHtml(p.id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPromoPost('${escapePromoHtml(p.id)}'); }" class="p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${isSelected ? 'bg-accord-lightBlue/40' : 'hover:bg-slate-50'}">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                ${getPostThumbnailHtml(p)}
                <div class="min-w-0 flex-1 space-y-1">
                    <p class="text-xs font-semibold text-accord-slate line-clamp-2 leading-snug">${escapePromoHtml(snippet)}</p>
                    <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-accord-muted">
                        <span class="inline-flex items-center gap-1 font-semibold ${typeMeta.textColor}">
                            <i class="fa-solid ${typeMeta.icon} text-[9px]"></i>
                            <span>${escapePromoHtml(typeMeta.label)}</span>
                        </span>
                        <span>·</span>
                        <span class="truncate max-w-[130px] font-medium text-slate-600">${escapePromoHtml(authorLabel)}</span>
                        ${dateLabel ? `<span>·</span><span>${escapePromoHtml(dateLabel)}</span>` : ''}
                        ${promoBadge}
                    </div>
                </div>
            </div>
            <button type="button" onclick="event.stopPropagation(); selectPromoPost('${escapePromoHtml(p.id)}')" class="px-3 py-1.5 rounded-xl text-[11px] font-bold shrink-0 transition-all ${isSelected ? 'bg-accord-blue text-white shadow-sm' : 'bg-slate-100 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue border border-slate-200'}">
                ${isSelected ? '<i class="fa-solid fa-check mr-1"></i>Selected' : 'Boost'}
            </button>
        </div>
        `;
    }).join('');
}

function selectPromoPost(postId) {
    const input = document.getElementById('promo-post-id');
    if (input) input.value = postId || '';
    prefillFromSelectedPost();
    renderPostPickerList();
    updateLiveAdPreview();
}

function renderBookPickerList() {
    const listEl = document.getElementById('promo-book-picker-list');
    const countEl = document.getElementById('promo-book-picker-count');
    if (!listEl) return;

    const query = (document.getElementById('promo-book-search')?.value || '').trim().toLowerCase();
    const selectedId = document.getElementById('promo-book-id')?.value || '';

    const filtered = booksCache.filter(b => {
        if (!query) return true;
        return `${b.title || ''} ${b.author || ''}`.toLowerCase().includes(query);
    });

    if (countEl) {
        countEl.textContent = `${filtered.length} book${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-8 text-center">${booksCache.length === 0 ? 'No eligible books to promote yet.' : 'No books match your search.'}</p>`;
        return;
    }

    listEl.innerHTML = filtered.map(b => {
        const isSelected = String(b.id) === String(selectedId);
        const coverHtml = b.cover_url
            ? `<img src="${escapePromoHtml(b.cover_url)}" alt="${escapePromoHtml(b.title)}" class="w-11 h-14 rounded-lg object-cover border border-slate-200 shrink-0">`
            : `<div class="w-11 h-14 rounded-lg bg-amber-50 text-accord-gold border border-amber-200 flex items-center justify-center shrink-0"><i class="fa-solid fa-book"></i></div>`;
        return `
        <div role="button" tabindex="0" onclick="selectPromoBook('${escapePromoHtml(b.id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPromoBook('${escapePromoHtml(b.id)}'); }" class="p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${isSelected ? 'bg-accord-lightBlue/40' : 'hover:bg-slate-50'}">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                ${coverHtml}
                <div class="min-w-0 flex-1 space-y-0.5">
                    <p class="text-xs font-bold text-accord-slate truncate">${escapePromoHtml(b.title || 'Untitled Book')}</p>
                    <p class="text-[11px] text-accord-muted truncate">${escapePromoHtml(b.author || 'Unknown Author')}</p>
                </div>
            </div>
            <button type="button" onclick="event.stopPropagation(); selectPromoBook('${escapePromoHtml(b.id)}')" class="px-3 py-1.5 rounded-xl text-[11px] font-bold shrink-0 transition-all ${isSelected ? 'bg-accord-blue text-white shadow-sm' : 'bg-slate-100 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue border border-slate-200'}">
                ${isSelected ? '<i class="fa-solid fa-check mr-1"></i>Selected' : 'Select'}
            </button>
        </div>
        `;
    }).join('');
}

function selectPromoBook(bookId) {
    const input = document.getElementById('promo-book-id');
    if (input) input.value = bookId || '';
    prefillFromSelectedBook();
    renderBookPickerList();
    updateLiveAdPreview();
}

function handlePromoTypeChange() {
    const type = document.getElementById('promo-type')?.value || 'post';
    const isBanner = type === 'banner';
    document.getElementById('promo-post-select-wrap')?.classList.toggle('hidden', type !== 'post');
    document.getElementById('promo-book-select-wrap')?.classList.toggle('hidden', type !== 'book');
    document.getElementById('promo-banner-fields')?.classList.toggle('hidden', !isBanner);

    const badge = document.getElementById('promo-preview-type-badge');
    if (badge) {
        badge.textContent = type === 'banner' ? 'Display Banner' : type === 'book' ? 'Promoted Book' : 'Feed Post';
    }
    updateLiveAdPreview();
}

function handlePromoGoalChange() {
    const goal = document.getElementById('promo-goal')?.value || 'views';
    const isClicks = goal === 'clicks';
    const ctaInput = document.getElementById('promo-cta-url');
    const ctaLabel = document.getElementById('promo-cta-url-label');
    if (ctaInput) {
        ctaInput.required = isClicks;
        ctaInput.placeholder = isClicks
            ? 'https://... or book.html?id=...'
            : 'https://... or book.html?id=... (optional for views)';
    }
    if (ctaLabel) {
        ctaLabel.textContent = isClicks ? 'Destination URL *' : 'Destination URL (Optional)';
    }
}

function prefillFromSelectedPost() {
    const id = document.getElementById('promo-post-id')?.value;
    const post = myPostsCache.find(p => String(p.id) === String(id));
    if (!post) return;
    document.getElementById('promo-body').value = (post.body || '').slice(0, 260);
    document.getElementById('promo-cta-url').value = `post.html?id=${encodeURIComponent(post.id)}`;
}

function prefillFromSelectedBook() {
    const id = document.getElementById('promo-book-id')?.value;
    const book = booksCache.find(b => String(b.id) === String(id));
    if (!book) return;
    document.getElementById('promo-body').value = (book.description || '').slice(0, 260);
    document.getElementById('promo-cta-url').value = `book.html?id=${encodeURIComponent(book.id)}`;
}

function buildAdPreviewElement(promo) {
    if (typeof window.createAccordSponsoredCardElement === 'function') {
        const el = window.createAccordSponsoredCardElement(promo);
        el.classList.add('pointer-events-none');
        return el;
    }
    const fallback = document.createElement('div');
    fallback.className = 'p-4 rounded-xl bg-white border border-slate-200 text-xs text-accord-slate';
    fallback.textContent = promo.body || promo.title || 'Ad Preview';
    return fallback;
}

function updateLiveAdPreview() {
    const container = document.getElementById('promo-live-preview');
    if (!container) return;

    const promoType = document.getElementById('promo-type')?.value || 'post';
    const adGoal = document.getElementById('promo-goal')?.value || 'views';
    const body = document.getElementById('promo-body')?.value.trim() || '';
    const ctaUrl = document.getElementById('promo-cta-url')?.value.trim() || '';
    const ctaText = document.getElementById('promo-cta-text')?.value.trim() || 'Learn More';

    if (promoType === 'post') {
        const postId = document.getElementById('promo-post-id')?.value || '';
        const post = myPostsCache.find(p => String(p.id) === String(postId)) || null;
        if (!post) {
            container.innerHTML = `<p class="text-xs text-accord-muted text-center py-8">Select a post on the left to see a live preview of your boosted post.</p>`;
            return;
        }
        const authorProf = (!post.is_anonymous && post.author_id)
            ? (promoAuthorProfilesById[String(post.author_id)] || promotablePagesById[String(post.author_id)] || null)
            : null;
        const syntheticPromo = {
            id: 'preview',
            promo_type: 'post',
            ad_goal: adGoal,
            target_post_id: post.id,
            advertiser_name: promoUser?.user_metadata?.full_name || promoUser?.email?.split('@')[0] || 'Member',
            body: body || post.body || '',
            cta_url: ctaUrl,
            cta_text: ctaText,
            _targetPost: { ...post, body: body || post.body || '' },
            _authorProfile: authorProf,
            _commentsCount: 0
        };
        container.innerHTML = '';
        container.appendChild(buildAdPreviewElement(syntheticPromo));
        window.hydrateSharedBookLinkPreviews?.(container);
        return;
    }

    if (promoType === 'book') {
        const bookId = document.getElementById('promo-book-id')?.value || '';
        const book = booksCache.find(b => String(b.id) === String(bookId)) || null;
        if (!book) {
            container.innerHTML = `<p class="text-xs text-accord-muted text-center py-8">Select a book on the left to see a live preview of your promoted book.</p>`;
            return;
        }
        const syntheticPromo = {
            id: 'preview',
            promo_type: 'book',
            ad_goal: adGoal,
            target_book_id: book.id,
            title: book.title || '',
            advertiser_name: book.author || '',
            body: body || book.description || '',
            desktop_image_url: book.cover_url || '',
            mobile_image_url: book.cover_url || '',
            cta_url: ctaUrl || `book.html?id=${book.id}`,
            cta_text: ctaText
        };
        container.innerHTML = '';
        container.appendChild(buildAdPreviewElement(syntheticPromo));
        return;
    }

    const desktopImg = document.getElementById('promo-desktop-img')?.value.trim() || '';
    const mobileImg = document.getElementById('promo-mobile-img')?.value.trim() || '';
    if (!desktopImg && !mobileImg && !body) {
        container.innerHTML = `<p class="text-xs text-accord-muted text-center py-8">Enter a banner image URL or ad copy to preview your display banner.</p>`;
        return;
    }
    const syntheticBanner = {
        id: 'preview',
        promo_type: 'banner',
        ad_goal: adGoal,
        body,
        desktop_image_url: desktopImg,
        mobile_image_url: mobileImg,
        cta_url: ctaUrl,
        cta_text: ctaText
    };
    container.innerHTML = '';
    container.appendChild(buildAdPreviewElement(syntheticBanner));
}

let _dailyBudgetUsd = 1;
let _durationDays = 7;

function syncDailyBudget(val, source = 'slider') {
    const parsed = Math.max(1, Math.round(Number(val) || 1));
    _dailyBudgetUsd = parsed;

    const slider = document.getElementById('promo-daily-slider');
    const input = document.getElementById('promo-daily-input');
    if (slider && source !== 'slider') slider.value = String(Math.min(100, parsed));
    if (input && source !== 'input') input.value = String(parsed);

    document.querySelectorAll('[data-daily-preset]').forEach(btn => {
        const isActive = Number(btn.getAttribute('data-daily-preset')) === parsed;
        btn.className = isActive
            ? 'px-2.5 py-1 rounded-lg text-[11px] font-bold border border-accord-blue bg-accord-lightBlue text-accord-blue'
            : 'px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 bg-white text-accord-slate hover:bg-slate-100';
    });

    updatePromoPriceDisplay();
}

function syncDurationDays(val) {
    const parsed = Math.max(1, Math.min(30, Math.round(Number(val) || 7)));
    _durationDays = parsed;

    const slider = document.getElementById('promo-duration-slider');
    if (slider) slider.value = String(parsed);

    document.querySelectorAll('[data-duration-preset]').forEach(btn => {
        const isActive = Number(btn.getAttribute('data-duration-preset')) === parsed;
        btn.className = isActive
            ? 'px-2.5 py-1 rounded-lg text-[11px] font-bold border border-accord-blue bg-accord-lightBlue text-accord-blue'
            : 'px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 bg-white text-accord-slate hover:bg-slate-100';
    });

    updatePromoPriceDisplay();
}

function estimateDailyViews(_dailyUsd) {
    // Future hook: once site traffic reaches calibration threshold, return { available: true, minViews, maxViews }
    return { available: false };
}

function getSelectedPackage() {
    const daily_budget_usd = Math.max(1, Number(_dailyBudgetUsd || 1));
    const duration_days = Math.max(1, Number(_durationDays || 7));
    return {
        daily_budget_usd,
        duration_days,
        budget_amount: Number((daily_budget_usd * duration_days).toFixed(2))
    };
}

function updatePromoPriceDisplay() {
    const { daily_budget_usd, duration_days, budget_amount } = getSelectedPackage();
    const curr = window.AccordCurrency?.getInfo ? window.AccordCurrency.getInfo() : { code: 'USD', symbol: '$', rate: 1, decimals: 2 };
    const fmtLocal = (usd) => window.AccordCurrency?.formatLocalFromUsd
        ? window.AccordCurrency.formatLocalFromUsd(usd)
        : `USD ${Number(usd).toFixed(2)}`;

    const badge = document.getElementById('promo-currency-badge');
    if (badge) badge.textContent = `${curr.code} (${curr.symbol})`;

    const dailyLocalEl = document.getElementById('promo-daily-local');
    if (dailyLocalEl) dailyLocalEl.textContent = `${fmtLocal(daily_budget_usd)} / day`;

    const dailyUsdNoteEl = document.getElementById('promo-daily-usd-note');
    if (dailyUsdNoteEl) {
        if (curr.code !== 'USD') {
            dailyUsdNoteEl.textContent = `(USD ${daily_budget_usd.toFixed(2)}/day)`;
            dailyUsdNoteEl.classList.remove('hidden');
        } else {
            dailyUsdNoteEl.classList.add('hidden');
        }
    }

    const durLabel = document.getElementById('promo-duration-label');
    if (durLabel) durLabel.textContent = `${duration_days} ${duration_days === 1 ? 'day' : 'days'}`;

    const endDateEl = document.getElementById('promo-end-date-label');
    if (endDateEl) {
        const endDate = new Date(Date.now() + duration_days * 86400000);
        endDateEl.textContent = `Runs until ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    const priorityBadge = document.getElementById('promo-priority-badge');
    if (priorityBadge) {
        if (daily_budget_usd >= 20) {
            priorityBadge.textContent = `Top Priority (${daily_budget_usd}×)`;
            priorityBadge.className = 'px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 shrink-0';
        } else if (daily_budget_usd >= 10) {
            priorityBadge.textContent = `High Priority (${daily_budget_usd}×)`;
            priorityBadge.className = 'px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-amber-50 text-amber-700 shrink-0';
        } else if (daily_budget_usd >= 5) {
            priorityBadge.textContent = `Boosted Priority (${daily_budget_usd}×)`;
            priorityBadge.className = 'px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-accord-lightBlue text-accord-blue shrink-0';
        } else {
            priorityBadge.textContent = `Standard Priority (${daily_budget_usd}×)`;
            priorityBadge.className = 'px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-slate-200/80 text-accord-slate shrink-0';
        }
    }

    // Update preset pill labels to local currency if non-USD
    document.querySelectorAll('[data-daily-preset]').forEach(btn => {
        const usd = Number(btn.getAttribute('data-daily-preset'));
        btn.textContent = `${fmtLocal(usd)}/day`;
    });

    const estViewsEl = document.getElementById('promo-estimated-views');
    if (estViewsEl) {
        const est = estimateDailyViews(daily_budget_usd);
        estViewsEl.textContent = est.available
            ? ` ~${est.minViews.toLocaleString()} – ${est.maxViews.toLocaleString()} views/day`
            : ' N/A';
    }

    const priceEl = document.getElementById('promo-price-display');
    if (priceEl) priceEl.textContent = fmtLocal(budget_amount);

    const subEl = document.getElementById('promo-price-usd-sub');
    if (subEl) {
        const usdSummary = `${duration_days} ${duration_days === 1 ? 'day' : 'days'} × USD ${daily_budget_usd.toFixed(2)}/day = USD ${budget_amount.toFixed(2)}`;
        subEl.textContent = usdSummary;
    }
}

async function handlePromotionSubmit(e) {
    e.preventDefault();
    if (!promoUser) return;

    const promoType = document.getElementById('promo-type').value;
    const isBanner = promoType === 'banner';
    const adGoal = document.getElementById('promo-goal')?.value || 'views';
    const title = '';
    const body = document.getElementById('promo-body').value.trim();
    const ctaUrl = document.getElementById('promo-cta-url').value.trim();
    const ctaText = document.getElementById('promo-cta-text').value.trim() || 'Learn More';
    const placement = document.getElementById('promo-placement').value;
    const targetCountryRaw = document.getElementById('promo-target-country').value.trim();
    const targetCountries = targetCountryRaw
        ? targetCountryRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        : [];
    const targetCategories = Array.from(document.querySelectorAll('input[name="promo-target-category"]:checked'))
        .map(cb => cb.value.trim())
        .filter(Boolean);
    const targetPostId = promoType === 'post' ? (document.getElementById('promo-post-id').value || null) : null;
    const targetBookId = promoType === 'book' ? (Number(document.getElementById('promo-book-id').value) || null) : null;
    const desktopImg = isBanner ? (document.getElementById('promo-desktop-img').value.trim() || null) : null;
    const mobileImg = isBanner ? (document.getElementById('promo-mobile-img').value.trim() || null) : null;
    const { daily_budget_usd, duration_days, budget_amount } = getSelectedPackage();
    const localInfo = window.AccordCurrency?.getInfo ? window.AccordCurrency.getInfo() : { code: 'USD' };
    const localBudgetAmount = window.AccordCurrency?.fromUsd ? window.AccordCurrency.fromUsd(budget_amount, localInfo.code) : budget_amount;

    if (isBanner && !desktopImg && !mobileImg && !body) {
        showToast('Please provide a banner image URL or short description.', true);
        return;
    }

    if (adGoal === 'clicks' && !ctaUrl) {
        showToast('Please enter a destination URL for a clicks campaign.', true);
        return;
    }

    if (ctaUrl && /^(javascript|data|vbscript):/i.test(ctaUrl)) {
        showToast('Please enter a valid destination URL.', true);
        return;
    }

    if (promoType === 'post') {
        if (!targetPostId) {
            showToast('Please select a post to promote.', true);
            return;
        }
        const { data: postCheck } = await supabaseClient
            .from('feed_posts')
            .select('id, author_id')
            .eq('id', targetPostId)
            .maybeSingle();
        const isAllowedPost = postCheck && (
            String(postCheck.author_id) === String(promoUser.id) ||
            promotablePageIds.includes(String(postCheck.author_id))
        );
        if (!isAllowedPost) {
            showToast('You can only promote posts made by you or a verified page you manage.', true);
            return;
        }
    } else if (promoType === 'book') {
        if (!targetBookId) {
            showToast('Please select a book to promote.', true);
            return;
        }
        const { data: bookCheck } = await supabaseClient
            .from('books')
            .select('id, author_id')
            .eq('id', targetBookId)
            .maybeSingle();
        const isAllowedBook = bookCheck && (
            String(bookCheck.author_id) === String(promoUser.id) ||
            promotablePageIds.includes(String(bookCheck.author_id))
        );
        if (!isAllowedBook) {
            showToast('You can only promote books uploaded by you or a verified page you manage.', true);
            return;
        }
    }

    const btn = document.getElementById('promo-pay-btn');
    if (btn) btn.disabled = true;

    let paystackCurrency = 'GHS';
    try {
        const cfgResp = await fetch('/api/paystack-verify');
        if (cfgResp.ok) {
            const cfgData = await cfgResp.json();
            if (cfgData?.currency) paystackCurrency = String(cfgData.currency).toUpperCase();
        }
    } catch (_) {}

    const chargeAmount = window.AccordCurrency?.fromUsd
        ? window.AccordCurrency.fromUsd(budget_amount, paystackCurrency)
        : budget_amount;

    const selectedCardId = document.getElementById('promo-card-select')?.value || '';
    const selectedCard = savedCardsCache.find(c => String(c.id) === String(selectedCardId)) || null;
    const selectedCardLabel = selectedCard ? `${selectedCard.brand} •••• ${selectedCard.last4}` : null;

    window.launchAccordPaystackCheckout({
        email: promoUser.email,
        amount: chargeAmount,
        currency: paystackCurrency,
        channels: selectedCard ? ['card'] : undefined,
        metadata: {
            type: 'paid_promotion',
            promo_type: promoType,
            ad_goal: adGoal,
            user_id: promoUser.id,
            daily_budget_usd,
            duration_days,
            total_usd: budget_amount,
            local_currency: localInfo.code,
            ...(selectedCard ? {
                selected_card_id: selectedCard.id,
                selected_card_brand: selectedCard.brand,
                selected_card_last4: selectedCard.last4
            } : {})
        },
        onVerified: async (tx) => {
            if (!selectedCard && tx?.authorization?.last4) {
                await maybeSavePaystackCard(tx.authorization);
            }

            const cardLabel = selectedCardLabel
                || (tx?.authorization?.last4 ? `${(tx.authorization.brand || 'Card').toUpperCase()} •••• ${tx.authorization.last4}` : null);

            const insertPayload = {
                advertiser_id: promoUser.id,
                advertiser_name: promoUser.user_metadata?.full_name || promoUser.email?.split('@')[0] || 'Member',
                advertiser_email: promoUser.email,
                promo_type: promoType,
                ad_goal: adGoal,
                target_post_id: targetPostId,
                target_book_id: targetBookId,
                title,
                body,
                desktop_image_url: desktopImg,
                mobile_image_url: mobileImg,
                cta_text: ctaText,
                cta_url: ctaUrl || null,
                placements: [placement],
                target_countries: targetCountries,
                target_categories: targetCategories,
                duration_days,
                budget_amount,
                daily_budget_usd,
                local_currency: localInfo.code,
                local_budget_amount: localBudgetAmount,
                currency: tx.currency || paystackCurrency,
                payment_provider: 'paystack',
                payment_reference: tx.reference,
                payment_status: 'paid',
                payment_card_label: cardLabel,
                status: 'pending_approval'
            };

            let { error } = await supabaseClient.from('promotions').insert([insertPayload]);
            if (error && /(ad_goal|daily_budget_usd|local_currency|local_budget_amount|payment_card_label|target_categories)/i.test(error.message || '')) {
                const { ad_goal: _ag, daily_budget_usd: _d, local_currency: _lc, local_budget_amount: _lb, payment_card_label: _pcl, target_categories: _tc, ...fallbackPayload } = insertPayload;
                ({ error } = await supabaseClient.from('promotions').insert([fallbackPayload]));
            }

            if (btn) btn.disabled = false;
            if (error) {
                showToast(`Payment succeeded, but saving promotion failed: ${error.message}`, true);
                return;
            }
            showToast('Payment verified! Promotion submitted for Admin approval.');
            document.getElementById('promote-form')?.reset();
            const postIdInput = document.getElementById('promo-post-id');
            if (postIdInput) postIdInput.value = '';
            const bookIdInput = document.getElementById('promo-book-id');
            if (bookIdInput) bookIdInput.value = '';
            syncDailyBudget(1, 'reset');
            syncDurationDays(7);
            handlePromoTypeChange();
            handlePromoGoalChange();
            renderPostPickerList();
            renderBookPickerList();
            await loadMyPromotions();
            switchPromoTab('campaigns');
        },
        onError: (msg) => {
            if (btn) btn.disabled = false;
            showToast(msg, true);
        },
        onCancel: () => {
            if (btn) btn.disabled = false;
            showToast('Checkout canceled.', true);
        }
    });
}

async function enrichMyPromotionsTargets(promos) {
    if (!Array.isArray(promos) || promos.length === 0) return;

    const postIds = [...new Set(promos.filter(p => p.promo_type === 'post' && p.target_post_id).map(p => String(p.target_post_id)))];
    const bookIds = [...new Set(promos.filter(p => p.promo_type === 'book' && p.target_book_id).map(p => Number(p.target_book_id)).filter(Boolean))];

    const [postsRes, booksRes] = await Promise.all([
        postIds.length > 0
            ? supabaseClient.from('feed_posts').select('id, title, body, author_id, author_name, author_role, is_anonymous, post_type, media_url, likes_count, reposts_count, created_at').in('id', postIds)
            : Promise.resolve({ data: [] }),
        bookIds.length > 0
            ? supabaseClient.from('books').select('id, title, author, description, cover_url, author_id').in('id', bookIds)
            : Promise.resolve({ data: [] })
    ]);

    const postById = new Map((postsRes.data || []).map(row => [String(row.id), row]));
    const bookById = new Map((booksRes.data || []).map(row => [String(row.id), row]));

    const missingAuthorIds = [...new Set(
        (postsRes.data || [])
            .filter(p => !p.is_anonymous && p.author_id && !promoAuthorProfilesById[String(p.author_id)])
            .map(p => String(p.author_id))
    )];
    if (missingAuthorIds.length > 0) {
        const { data: extraProfs } = await supabaseClient
            .from('profiles')
            .select('id, handle, avatar_url, full_name, account_type, upgrade_status')
            .in('id', missingAuthorIds);
        (extraProfs || []).forEach(prof => {
            promoAuthorProfilesById[String(prof.id)] = prof;
        });
    }

    promos.forEach(p => {
        if (p.promo_type === 'post' && p.target_post_id) {
            const post = postById.get(String(p.target_post_id)) || null;
            p._targetPost = post;
            p._authorProfile = (post && !post.is_anonymous && post.author_id)
                ? (promoAuthorProfilesById[String(post.author_id)] || promotablePagesById[String(post.author_id)] || null)
                : null;
        }
        if (p.promo_type === 'book' && p.target_book_id) {
            p._targetBook = bookById.get(String(p.target_book_id)) || null;
        }
    });
}

async function loadMyPromotions() {
    const listEl = document.getElementById('my-promotions-list');
    if (!listEl || !promoUser) return;

    const { data, error } = await supabaseClient
        .from('promotions')
        .select('*')
        .eq('advertiser_id', promoUser.id)
        .order('created_at', { ascending: false });

    const countBadge = document.getElementById('promo-tab-campaigns-count');

    if (error || !data || data.length === 0) {
        myPromotionsCache = [];
        if (countBadge) countBadge.textContent = '0';
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-8 text-center">You haven't submitted any promotions yet.</p>`;
        renderPostPickerList();
        return;
    }

    myPromotionsCache = data;
    if (countBadge) countBadge.textContent = String(data.length);

    await enrichMyPromotionsTargets(myPromotionsCache);
    renderMyPromotionsList();
    renderPostPickerList();
}

function boostExistingPromotion(promoId) {
    const p = myPromotionsCache.find(item => String(item.id) === String(promoId));
    if (!p) return;
    switchPromoTab('create');
    const typeEl = document.getElementById('promo-type');
    if (typeEl) {
        typeEl.value = p.promo_type || 'post';
        handlePromoTypeChange();
    }
    if (p.promo_type === 'post' && p.target_post_id && myPostsCache.some(mp => String(mp.id) === String(p.target_post_id))) {
        selectPromoPost(p.target_post_id);
    } else if (p.promo_type === 'book' && p.target_book_id && booksCache.some(bk => String(bk.id) === String(p.target_book_id))) {
        selectPromoBook(p.target_book_id);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMyPromotionsList() {
    const listEl = document.getElementById('my-promotions-list');
    if (!listEl) return;

    const statusFilter = document.getElementById('promo-status-filter')?.value || 'all';
    const filtered = statusFilter === 'all'
        ? myPromotionsCache
        : myPromotionsCache.filter(p => p.status === statusFilter);

    if (filtered.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-8 text-center">${myPromotionsCache.length === 0 ? "You haven't submitted any promotions yet." : 'No promotions match this status filter.'}</p>`;
        return;
    }

    const statusBadge = {
        pending_approval: 'bg-amber-50 text-amber-700',
        approved: 'bg-emerald-50 text-emerald-700',
        rejected: 'bg-red-50 text-red-600',
        paused: 'bg-slate-100 text-slate-600',
        expired: 'bg-slate-100 text-slate-500'
    };

    listEl.innerHTML = filtered.map(p => {
        const typeLabel = p.promo_type === 'banner'
            ? 'Display Banner'
            : p.promo_type === 'book'
                ? 'Promoted Book'
                : 'Promoted Post';
        const targetTitle = p._targetBook?.title || p._targetPost?.body || '';
        const displayTitle = (p.title || '').trim() || (p.body ? p.body.slice(0, 90) : '') || (targetTitle ? targetTitle.slice(0, 90) : typeLabel);
        const goalLabel = (p.ad_goal === 'views' || (!p.ad_goal && !p.cta_url)) ? 'Views' : 'Clicks';
        const totalUsd = Number(p.budget_amount || 0);
        const dailyUsd = Number(p.daily_budget_usd || 0) || (totalUsd > 0 ? totalUsd / Math.max(1, Number(p.duration_days || 1)) : 0);
        const localLabel = window.AccordCurrency?.formatLocalFromUsd
            ? window.AccordCurrency.formatLocalFromUsd(totalUsd)
            : `USD ${totalUsd.toFixed(2)}`;
        const dailyLabel = window.AccordCurrency?.formatLocalFromUsd
            ? window.AccordCurrency.formatLocalFromUsd(dailyUsd)
            : `USD ${dailyUsd.toFixed(2)}`;
        const canPause = p.status === 'approved';
        const canResume = p.status === 'paused';
        const pauseBtnHtml = canPause
            ? `<button type="button" onclick="event.stopPropagation(); togglePromotionPause('${escapePromoHtml(p.id)}', 'paused')" class="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold transition-colors inline-flex items-center gap-1"><i class="fa-solid fa-pause text-[9px]"></i> Pause</button>`
            : canResume
                ? `<button type="button" onclick="event.stopPropagation(); togglePromotionPause('${escapePromoHtml(p.id)}', 'approved')" class="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold transition-colors inline-flex items-center gap-1"><i class="fa-solid fa-play text-[9px]"></i> Resume</button>`
                : '';

        const authorName = p._targetPost && !p._targetPost.is_anonymous
            ? (p._targetPost.author_name || p._authorProfile?.full_name || '')
            : (p._targetBook?.author || '');
        const dateLabel = formatPromoDateOnly(p.created_at) || '';

        return `
        <div role="button" tabindex="0" onclick="openPromotionDetailsModal('${escapePromoHtml(p.id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPromotionDetailsModal('${escapePromoHtml(p.id)}'); }" class="p-4 hover:bg-slate-50/90 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 focus:outline-none focus:bg-slate-50">
            <div class="flex items-start gap-3.5 min-w-0 flex-1">
                ${getPromotionThumbnailHtml(p)}
                <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusBadge[p.status] || 'bg-slate-100 text-slate-600'}">${escapePromoHtml((p.status || '').replace('_', ' '))}</span>
                        <span class="text-[11px] font-semibold text-accord-muted">${escapePromoHtml(typeLabel)}</span>
                        ${authorName ? `<span class="text-[11px] text-accord-muted">· ${escapePromoHtml(authorName)}</span>` : ''}
                        ${dateLabel ? `<span class="text-[11px] text-accord-muted">· ${escapePromoHtml(dateLabel)}</span>` : ''}
                    </div>
                    <p class="text-xs sm:text-[13px] font-bold text-accord-slate line-clamp-2 leading-snug">${escapePromoHtml(displayTitle)}</p>
                    <div class="flex items-center gap-3 flex-wrap text-[11px] text-accord-muted pt-0.5">
                        <span><i class="fa-regular fa-eye mr-1"></i>${p.impressions_count || 0} views</span>
                        <span><i class="fa-solid fa-arrow-pointer mr-1"></i>${p.clicks_count || 0} clicks</span>
                        <span class="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-accord-slate">${goalLabel}</span>
                        <span class="font-semibold text-accord-slate">${p.duration_days}d · ${escapePromoHtml(localLabel)} (${escapePromoHtml(dailyLabel)}/day)</span>
                    </div>
                    ${p.admin_notes ? `<p class="text-[11px] text-accord-blue">Admin note: ${escapePromoHtml(p.admin_notes)}</p>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                ${pauseBtnHtml}
                <button type="button" onclick="event.stopPropagation(); openPromotionDetailsModal('${escapePromoHtml(p.id)}')" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue text-[11px] font-bold transition-colors inline-flex items-center gap-1.5">
                    <i class="fa-regular fa-eye text-[10px]"></i>
                    <span>Preview</span>
                </button>
            </div>
        </div>
        `;
    }).join('');
}

function formatPromoDateTime(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }) + ' · ' + d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatPromoDateOnly(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getPromoPeriodSummary(p) {
    const durationDays = Math.max(1, Number(p.duration_days || 1));
    const startsLabel = formatPromoDateOnly(p.starts_at);
    const endsLabel = formatPromoDateOnly(p.ends_at);
    if (startsLabel && endsLabel) {
        const endMs = Date.parse(p.ends_at);
        const nowMs = Date.now();
        let remainingText = '';
        if (!Number.isNaN(endMs)) {
            const diffDays = Math.ceil((endMs - nowMs) / (1000 * 60 * 60 * 24));
            remainingText = diffDays > 0
                ? `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`
                : 'Ended';
        }
        return {
            range: `${startsLabel} – ${endsLabel}`,
            note: remainingText || `${durationDays} day${durationDays === 1 ? '' : 's'} total`
        };
    }
    if (p.status === 'pending_approval') {
        return {
            range: `${durationDays} day${durationDays === 1 ? '' : 's'} (pending start)`,
            note: 'Period begins once approved by an Admin'
        };
    }
    if (p.status === 'rejected') {
        return {
            range: `${durationDays} day${durationDays === 1 ? '' : 's'} (not active)`,
            note: 'Campaign was not approved'
        };
    }
    return {
        range: `${durationDays} day${durationDays === 1 ? '' : 's'}`,
        note: startsLabel ? `Started ${startsLabel}` : 'Schedule not set'
    };
}

function formatPromoPlacements(placements, slotPosition) {
    const map = {
        all: 'All Main Pages (Library, Feed, Music)',
        library: 'Digital Library',
        feed: 'Fellowship Feed',
        music: 'Music Page'
    };
    const arr = Array.isArray(placements) && placements.length ? placements : ['all'];
    const labels = arr.map(pl => map[pl] || pl);
    if (slotPosition) {
        labels.push(`Slot: ${slotPosition}`);
    }
    return labels.join(', ');
}

function openPromotionDetailsModal(promoId) {
    const p = myPromotionsCache.find(item => String(item.id) === String(promoId));
    if (!p) return;
    activeDetailPromoId = p.id;

    const modal = document.getElementById('promo-details-modal');
    const statusEl = document.getElementById('promo-detail-status');
    const typeEl = document.getElementById('promo-detail-type');
    const titleEl = document.getElementById('promo-detail-title');
    const bodyEl = document.getElementById('promo-details-body');
    const footerEl = document.getElementById('promo-details-footer');
    if (!modal || !bodyEl) return;

    const statusBadge = {
        pending_approval: 'bg-amber-50 text-amber-700',
        approved: 'bg-emerald-50 text-emerald-700',
        rejected: 'bg-red-50 text-red-600',
        paused: 'bg-slate-100 text-slate-600',
        expired: 'bg-slate-100 text-slate-500'
    };

    const typeLabel = p.promo_type === 'banner'
        ? 'Display Ad Banner'
        : p.promo_type === 'book'
            ? 'Promoted Library Book'
            : 'Promoted Feed Post';
    const displayTitle = (p.title || '').trim() || (p.body ? p.body.slice(0, 80) : typeLabel);
    const goalLabel = (p.ad_goal === 'views' || (!p.ad_goal && !p.cta_url)) ? 'Views (Awareness)' : 'Clicks (Traffic)';
    const impressions = Number(p.impressions_count || 0);
    const clicks = Number(p.clicks_count || 0);
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) + '%' : '0.00%';

    const totalUsd = Number(p.budget_amount || 0);
    const durationDays = Math.max(1, Number(p.duration_days || 1));
    const dailyUsd = Number(p.daily_budget_usd || 0) || (totalUsd > 0 ? totalUsd / durationDays : 0);
    const totalLocal = window.AccordCurrency?.formatLocalFromUsd
        ? window.AccordCurrency.formatLocalFromUsd(totalUsd)
        : `USD ${totalUsd.toFixed(2)}`;
    const dailyLocal = window.AccordCurrency?.formatLocalFromUsd
        ? window.AccordCurrency.formatLocalFromUsd(dailyUsd)
        : `USD ${dailyUsd.toFixed(2)}`;

    const period = getPromoPeriodSummary(p);
    const submittedAt = formatPromoDateTime(p.created_at) || 'Unknown';
    const countries = Array.isArray(p.target_countries) && p.target_countries.length
        ? p.target_countries.join(', ')
        : 'Global (All Countries)';
    const placementsText = formatPromoPlacements(p.placements, p.slot_position);

    if (statusEl) {
        statusEl.className = `px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusBadge[p.status] || 'bg-slate-100 text-slate-600'}`;
        statusEl.textContent = (p.status || 'unknown').replace('_', ' ');
    }
    if (typeEl) typeEl.textContent = typeLabel;
    if (titleEl) titleEl.textContent = displayTitle;

    const safeUrl = p.cta_url && /^(https?:\/\/|\/|[a-z0-9_-]+\.html)/i.test(String(p.cta_url).trim())
        ? String(p.cta_url).trim()
        : null;

    bodyEl.innerHTML = `
        <div class="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-3.5 space-y-2">
            <p class="text-[11px] font-bold uppercase tracking-wider text-accord-slate flex items-center gap-1.5">
                <i class="fa-regular fa-eye text-accord-blue"></i> Ad Preview
            </p>
            <div id="promo-detail-live-preview" class="rounded-xl overflow-hidden"></div>
        </div>

        <div class="grid grid-cols-3 gap-2.5">
            <div class="rounded-2xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                <p class="text-[10px] font-bold uppercase tracking-wider text-accord-muted">Views</p>
                <p class="text-base font-extrabold text-accord-slate mt-0.5">${impressions.toLocaleString()}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                <p class="text-[10px] font-bold uppercase tracking-wider text-accord-muted">Clicks</p>
                <p class="text-base font-extrabold text-accord-slate mt-0.5">${clicks.toLocaleString()}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                <p class="text-[10px] font-bold uppercase tracking-wider text-accord-muted">CTR</p>
                <p class="text-base font-extrabold text-accord-blue mt-0.5">${ctr}</p>
            </div>
        </div>

        <div class="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2.5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-accord-slate flex items-center gap-1.5">
                <i class="fa-regular fa-calendar text-accord-blue"></i> Ad Period &amp; Schedule
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Active Period</p>
                    <p class="font-bold text-accord-slate">${escapePromoHtml(period.range)}</p>
                    <p class="text-[11px] text-accord-muted">${escapePromoHtml(period.note)}</p>
                </div>
                <div>
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Submitted On</p>
                    <p class="font-semibold text-accord-slate">${escapePromoHtml(submittedAt)}</p>
                    <p class="text-[11px] text-accord-muted">Duration: ${durationDays} day${durationDays === 1 ? '' : 's'}</p>
                </div>
            </div>
        </div>

        <div class="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2.5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-accord-slate flex items-center gap-1.5">
                <i class="fa-solid fa-wallet text-accord-blue"></i> Budget &amp; Payment
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Total Budget</p>
                    <p class="font-bold text-accord-slate">${escapePromoHtml(totalLocal)} <span class="text-[11px] font-medium text-accord-muted">($${totalUsd.toFixed(2)} USD)</span></p>
                    <p class="text-[11px] text-accord-muted">${escapePromoHtml(dailyLocal)}/day ($${dailyUsd.toFixed(2)} USD/day)</p>
                </div>
                <div>
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Payment</p>
                    <p class="font-semibold text-accord-slate">${escapePromoHtml(p.payment_card_label || (p.payment_provider ? String(p.payment_provider).toUpperCase() : 'Paystack'))}</p>
                    <p class="text-[11px] text-accord-muted">Status: ${escapePromoHtml(p.payment_status || 'paid')}${p.payment_reference ? ` · Ref: ${escapePromoHtml(p.payment_reference)}` : ''}</p>
                </div>
            </div>
        </div>

        <div class="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2.5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-accord-slate flex items-center gap-1.5">
                <i class="fa-solid fa-bullseye text-accord-blue"></i> Targeting &amp; Placement
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Goal</p>
                    <p class="font-semibold text-accord-slate">${escapePromoHtml(goalLabel)}</p>
                </div>
                <div>
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Target Countries</p>
                    <p class="font-semibold text-accord-slate">${escapePromoHtml(countries)}</p>
                </div>
                <div class="sm:col-span-2">
                    <p class="text-[10px] text-accord-muted uppercase font-semibold">Placements</p>
                    <p class="font-semibold text-accord-slate">${escapePromoHtml(placementsText)}</p>
                </div>
            </div>
        </div>

        <div class="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2.5">
            <p class="text-[11px] font-bold uppercase tracking-wider text-accord-slate flex items-center gap-1.5">
                <i class="fa-regular fa-newspaper text-accord-blue"></i> Ad Creative &amp; Link
            </p>
            ${p.body ? `<p class="text-accord-slate leading-relaxed whitespace-pre-line">${escapePromoHtml(p.body)}</p>` : '<p class="text-accord-muted italic">No ad copy provided.</p>'}
            ${safeUrl ? `
                <div class="pt-1 flex items-center justify-between gap-2 flex-wrap">
                    <span class="text-[11px] text-accord-muted">CTA: <strong class="text-accord-slate">${escapePromoHtml(p.cta_text || 'Learn More')}</strong></span>
                    <a href="${escapePromoHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-bold text-accord-blue hover:underline truncate max-w-full">
                        ${escapePromoHtml(safeUrl)} <i class="fa-solid fa-arrow-up-right-from-square text-[9px] ml-0.5"></i>
                    </a>
                </div>
            ` : ''}
            ${(p.desktop_image_url || p.mobile_image_url) ? `
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    ${p.desktop_image_url ? `
                        <a href="${escapePromoHtml(p.desktop_image_url)}" target="_blank" rel="noopener noreferrer" class="block rounded-xl overflow-hidden border border-slate-200 bg-white">
                            <img src="${escapePromoHtml(p.desktop_image_url)}" alt="Desktop banner" class="w-full h-24 object-cover">
                            <span class="block px-2.5 py-1 text-[10px] font-semibold text-accord-muted">Desktop Banner</span>
                        </a>
                    ` : ''}
                    ${p.mobile_image_url ? `
                        <a href="${escapePromoHtml(p.mobile_image_url)}" target="_blank" rel="noopener noreferrer" class="block rounded-xl overflow-hidden border border-slate-200 bg-white">
                            <img src="${escapePromoHtml(p.mobile_image_url)}" alt="Mobile banner" class="w-full h-24 object-cover">
                            <span class="block px-2.5 py-1 text-[10px] font-semibold text-accord-muted">Mobile Banner</span>
                        </a>
                    ` : ''}
                </div>
            ` : ''}
        </div>

        ${p.admin_notes ? `
            <div class="rounded-2xl border border-accord-blue/25 bg-accord-lightBlue/40 p-3.5">
                <p class="text-[10px] font-bold uppercase tracking-wider text-accord-blue mb-1">Admin Note</p>
                <p class="text-accord-slate leading-relaxed">${escapePromoHtml(p.admin_notes)}</p>
            </div>
        ` : ''}
    `;

    if (footerEl) {
        const canPause = p.status === 'approved';
        const canResume = p.status === 'paused';
        const actionBtn = canPause
            ? `<button type="button" onclick="togglePromotionPause('${escapePromoHtml(p.id)}', 'paused')" class="px-4 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold inline-flex items-center gap-1.5"><i class="fa-solid fa-pause text-[10px]"></i> Pause Ad</button>`
            : canResume
                ? `<button type="button" onclick="togglePromotionPause('${escapePromoHtml(p.id)}', 'approved')" class="px-4 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-bold inline-flex items-center gap-1.5"><i class="fa-solid fa-play text-[10px]"></i> Resume Ad</button>`
                : '';
        const boostAgainBtn = (p.promo_type === 'post' || p.promo_type === 'book')
            ? `<button type="button" onclick="closePromotionDetailsModal(); boostExistingPromotion('${escapePromoHtml(p.id)}')" class="px-4 py-2 rounded-xl bg-accord-lightBlue hover:bg-accord-blue text-accord-blue hover:text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"><i class="fa-solid fa-rocket text-[10px]"></i> Boost Again</button>`
            : '';
        footerEl.innerHTML = `
            ${boostAgainBtn}
            ${actionBtn}
            <button type="button" onclick="closePromotionDetailsModal()" class="px-4 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-200 text-accord-slate text-xs font-bold">Close</button>
        `;
    }

    const detailPreviewHost = document.getElementById('promo-detail-live-preview');
    if (detailPreviewHost) {
        const previewPromo = {
            ...p,
            _targetPost: p._targetPost || null,
            _authorProfile: p._authorProfile || null,
            _commentsCount: 0,
            ...(p.promo_type === 'book' && p._targetBook ? {
                title: p.title || p._targetBook.title || '',
                advertiser_name: p.advertiser_name || p._targetBook.author || '',
                desktop_image_url: p.desktop_image_url || p._targetBook.cover_url || '',
                mobile_image_url: p.mobile_image_url || p._targetBook.cover_url || ''
            } : {})
        };
        detailPreviewHost.innerHTML = '';
        detailPreviewHost.appendChild(buildAdPreviewElement(previewPromo));
        window.hydrateSharedBookLinkPreviews?.(detailPreviewHost);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closePromotionDetailsModal() {
    activeDetailPromoId = null;
    const modal = document.getElementById('promo-details-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeDetailPromoId !== null) {
        closePromotionDetailsModal();
    }
});

async function togglePromotionPause(promoId, nextStatus) {
    if (!promoUser || !promoId) return;
    if (nextStatus !== 'paused' && nextStatus !== 'approved') return;

    const { error } = await supabaseClient
        .from('promotions')
        .update({ status: nextStatus })
        .eq('id', promoId)
        .eq('advertiser_id', promoUser.id);

    if (error) {
        showToast(`Could not update ad status: ${error.message}`, true);
        return;
    }

    showToast(nextStatus === 'paused'
        ? 'Ad paused. It will not appear across the site until you resume it.'
        : 'Ad resumed and is active again.');
    await loadMyPromotions();
    if (activeDetailPromoId && String(activeDetailPromoId) === String(promoId)) {
        openPromotionDetailsModal(promoId);
    }
}

// =========================================================
// ADDED PAYMENT CARDS MANAGEMENT
// =========================================================

function getSavedCardsStorageKey() {
    return promoUser ? `accord_saved_cards:${promoUser.id}` : null;
}

function readLocalSavedCards() {
    const key = getSavedCardsStorageKey();
    if (!key) return [];
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function writeLocalSavedCards(cards) {
    const key = getSavedCardsStorageKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(cards || []));
    } catch (_) {}
}

function detectCardBrand(digits) {
    if (/^4/.test(digits)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
    if (/^(506|650|507)/.test(digits)) return 'Verve';
    if (/^3[47]/.test(digits)) return 'Amex';
    return 'Card';
}

function getCardBrandIcon(brand) {
    const b = String(brand || '').toLowerCase();
    if (b.includes('visa')) return 'fa-brands fa-cc-visa text-blue-600';
    if (b.includes('master')) return 'fa-brands fa-cc-mastercard text-orange-600';
    if (b.includes('amex')) return 'fa-brands fa-cc-amex text-sky-600';
    return 'fa-solid fa-credit-card text-accord-blue';
}

function formatCardNumberInput(input) {
    const digits = String(input.value || '').replace(/\D/g, '').slice(0, 19);
    input.value = digits.replace(/(.{4})/g, '$1 ').trim();
}

async function loadSavedPaymentCards() {
    if (!promoUser) return;
    usingLocalCardsFallback = false;

    const { data, error } = await supabaseClient
        .from('user_payment_cards')
        .select('*')
        .eq('user_id', promoUser.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        usingLocalCardsFallback = true;
        savedCardsCache = readLocalSavedCards();
    } else {
        savedCardsCache = data || [];
    }

    renderSavedPaymentCards();
}

function renderSavedPaymentCards() {
    const listEl = document.getElementById('saved-cards-list');
    const selectEl = document.getElementById('promo-card-select');
    const cardsCountBadge = document.getElementById('promo-tab-cards-count');
    if (cardsCountBadge) cardsCountBadge.textContent = String(savedCardsCache.length);

    if (selectEl) {
        const previousVal = selectEl.value;
        const defaultCard = savedCardsCache.find(c => c.is_default) || savedCardsCache[0] || null;
        selectEl.innerHTML = [
            ...savedCardsCache.map(c => {
                const label = `${c.brand} •••• ${c.last4} (Exp ${c.exp_month}/${String(c.exp_year).slice(-2)})${c.is_default ? ' — Default' : ''}`;
                return `<option value="${escapePromoHtml(c.id)}">${escapePromoHtml(label)}</option>`;
            }),
            `<option value="">Pay with new card / Mobile Money (Paystack)</option>`
        ].join('');

        if (previousVal && savedCardsCache.some(c => String(c.id) === String(previousVal))) {
            selectEl.value = previousVal;
        } else if (defaultCard) {
            selectEl.value = String(defaultCard.id);
        } else {
            selectEl.value = '';
        }
    }

    if (!listEl) return;
    if (savedCardsCache.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-4 text-center">No payment cards added yet. Add a card to choose which card to use for your ads.</p>`;
        return;
    }

    listEl.innerHTML = savedCardsCache.map(c => `
        <div class="p-3 rounded-2xl border ${c.is_default ? 'border-accord-blue/50 bg-blue-50/40' : 'border-slate-200/80 bg-slate-50/70'} flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <i class="${getCardBrandIcon(c.brand)} text-lg"></i>
                </div>
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <p class="text-xs font-bold text-accord-slate">${escapePromoHtml(c.brand)} •••• ${escapePromoHtml(c.last4)}</p>
                        ${c.is_default ? `<span class="px-1.5 py-0.5 rounded-full bg-accord-lightBlue text-accord-blue text-[9px] font-extrabold uppercase">Default</span>` : ''}
                    </div>
                    <p class="text-[11px] text-accord-muted truncate">${escapePromoHtml(c.card_holder)} · Exp ${escapePromoHtml(c.exp_month)}/${escapePromoHtml(String(c.exp_year).slice(-2))}</p>
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                ${!c.is_default ? `<button type="button" onclick="setDefaultPaymentCard('${escapePromoHtml(c.id)}')" class="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-bold text-accord-slate">Set Default</button>` : ''}
                <button type="button" onclick="removePaymentCard('${escapePromoHtml(c.id)}')" class="w-7 h-7 rounded-lg bg-white hover:bg-red-50 border border-slate-200 text-slate-400 hover:text-red-600 flex items-center justify-center transition-colors" title="Remove card">
                    <i class="fa-solid fa-trash text-[10px]"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function openAddCardModal() {
    const modal = document.getElementById('add-card-modal');
    const holderInput = document.getElementById('card-holder-input');
    if (holderInput && !holderInput.value && promoUser) {
        holderInput.value = promoUser.user_metadata?.full_name || promoUser.email?.split('@')[0] || '';
    }
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeAddCardModal() {
    const modal = document.getElementById('add-card-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleAddCardSubmit(e) {
    e.preventDefault();
    if (!promoUser) return;

    const cardHolder = document.getElementById('card-holder-input')?.value.trim() || '';
    const rawDigits = (document.getElementById('card-number-input')?.value || '').replace(/\D/g, '');
    const expMonthRaw = (document.getElementById('card-exp-month')?.value || '').replace(/\D/g, '');
    const expYearRaw = (document.getElementById('card-exp-year')?.value || '').replace(/\D/g, '');
    const isDefault = Boolean(document.getElementById('card-default-checkbox')?.checked) || savedCardsCache.length === 0;

    if (!cardHolder) {
        showToast('Please enter the cardholder name.', true);
        return;
    }
    if (rawDigits.length < 13 || rawDigits.length > 19) {
        showToast('Please enter a valid card number.', true);
        return;
    }
    const expMonthNum = Number(expMonthRaw);
    if (!expMonthRaw || expMonthNum < 1 || expMonthNum > 12) {
        showToast('Please enter a valid expiry month (01-12).', true);
        return;
    }
    if (expYearRaw.length !== 2 && expYearRaw.length !== 4) {
        showToast('Please enter a valid expiry year (YY or YYYY).', true);
        return;
    }

    const expMonth = String(expMonthNum).padStart(2, '0');
    const expYear = expYearRaw.length === 2 ? `20${expYearRaw}` : expYearRaw;
    const brand = detectCardBrand(rawDigits);
    const last4 = rawDigits.slice(-4);

    const btn = document.getElementById('add-card-submit-btn');
    if (btn) btn.disabled = true;

    if (usingLocalCardsFallback) {
        const next = savedCardsCache.map(c => ({ ...c, is_default: isDefault ? false : c.is_default }));
        next.unshift({
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            user_id: promoUser.id,
            card_holder: cardHolder,
            brand,
            last4,
            exp_month: expMonth,
            exp_year: expYear,
            is_default: isDefault,
            created_at: new Date().toISOString()
        });
        writeLocalSavedCards(next);
        savedCardsCache = next;
    } else {
        if (isDefault && savedCardsCache.length > 0) {
            await supabaseClient
                .from('user_payment_cards')
                .update({ is_default: false })
                .eq('user_id', promoUser.id);
        }
        const { error } = await supabaseClient
            .from('user_payment_cards')
            .insert([{
                user_id: promoUser.id,
                card_holder: cardHolder,
                brand,
                last4,
                exp_month: expMonth,
                exp_year: expYear,
                is_default: isDefault
            }]);
        if (error) {
            if (btn) btn.disabled = false;
            showToast(`Could not save card: ${error.message}`, true);
            return;
        }
    }

    if (btn) btn.disabled = false;
    document.getElementById('add-card-form')?.reset();
    closeAddCardModal();
    showToast(`${brand} •••• ${last4} added to your payment cards.`);
    await loadSavedPaymentCards();
}

async function setDefaultPaymentCard(cardId) {
    if (!promoUser || !cardId) return;
    if (usingLocalCardsFallback) {
        const next = savedCardsCache.map(c => ({ ...c, is_default: String(c.id) === String(cardId) }));
        writeLocalSavedCards(next);
        savedCardsCache = next;
        renderSavedPaymentCards();
        showToast('Default payment card updated.');
        return;
    }

    await supabaseClient
        .from('user_payment_cards')
        .update({ is_default: false })
        .eq('user_id', promoUser.id);
    const { error } = await supabaseClient
        .from('user_payment_cards')
        .update({ is_default: true })
        .eq('id', cardId)
        .eq('user_id', promoUser.id);

    if (error) {
        showToast(`Could not update default card: ${error.message}`, true);
        return;
    }
    showToast('Default payment card updated.');
    await loadSavedPaymentCards();
}

async function removePaymentCard(cardId) {
    if (!promoUser || !cardId) return;
    if (usingLocalCardsFallback) {
        const next = savedCardsCache.filter(c => String(c.id) !== String(cardId));
        if (next.length > 0 && !next.some(c => c.is_default)) next[0].is_default = true;
        writeLocalSavedCards(next);
        savedCardsCache = next;
        renderSavedPaymentCards();
        showToast('Payment card removed.');
        return;
    }

    const { error } = await supabaseClient
        .from('user_payment_cards')
        .delete()
        .eq('id', cardId)
        .eq('user_id', promoUser.id);
    if (error) {
        showToast(`Could not remove card: ${error.message}`, true);
        return;
    }
    showToast('Payment card removed.');
    await loadSavedPaymentCards();
}

async function maybeSavePaystackCard(auth) {
    if (!promoUser || !auth?.last4) return;
    const brand = String(auth.brand || 'Card').replace(/\b\w/g, ch => ch.toUpperCase());
    const last4 = String(auth.last4).slice(-4);
    const expMonth = String(auth.exp_month || '01').padStart(2, '0');
    const expYear = String(auth.exp_year || '2028');
    if (savedCardsCache.some(c => c.last4 === last4 && String(c.exp_month) === expMonth)) return;

    const cardHolder = promoUser.user_metadata?.full_name || promoUser.email?.split('@')[0] || 'Cardholder';
    const isDefault = savedCardsCache.length === 0;
    if (usingLocalCardsFallback) {
        const next = [...savedCardsCache, {
            id: `local_${Date.now()}`,
            user_id: promoUser.id,
            card_holder: cardHolder,
            brand,
            last4,
            exp_month: expMonth,
            exp_year: expYear,
            is_default: isDefault,
            created_at: new Date().toISOString()
        }];
        writeLocalSavedCards(next);
    } else {
        await supabaseClient.from('user_payment_cards').insert([{
            user_id: promoUser.id,
            card_holder: cardHolder,
            brand,
            last4,
            exp_month: expMonth,
            exp_year: expYear,
            is_default: isDefault
        }]);
    }
    await loadSavedPaymentCards();
}
