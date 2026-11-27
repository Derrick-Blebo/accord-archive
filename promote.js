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

    const params = new URLSearchParams(window.location.search);
    const prePost = params.get('post');
    const preBook = params.get('book');
    if (prePost) {
        document.getElementById('promo-type').value = 'post';
        handlePromoTypeChange();
        if (myPostsCache.some(p => String(p.id) === String(prePost))) {
            document.getElementById('promo-post-id').value = prePost;
            prefillFromSelectedPost();
        } else {
            showToast('You can only promote posts you made yourself.', true);
        }
    } else if (preBook) {
        document.getElementById('promo-type').value = 'book';
        handlePromoTypeChange();
        if (booksCache.some(b => String(b.id) === String(preBook))) {
            document.getElementById('promo-book-id').value = preBook;
            prefillFromSelectedBook();
        } else {
            showToast('You can only promote books you uploaded yourself.', true);
        }
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

    const [postsRes, booksRes] = allowedAuthorIds.length === 0
        ? [{ data: [] }, { data: [] }]
        : await Promise.all([
            supabaseClient.from('feed_posts').select('id, title, body, author_id').in('author_id', allowedAuthorIds).order('created_at', { ascending: false }).limit(80),
            supabaseClient.from('books').select('id, title, author, description, cover_url, author_id').eq('is_visible', true).in('author_id', allowedAuthorIds).order('created_at', { ascending: false }).limit(120)
        ]);

    myPostsCache = postsRes.data || [];
    booksCache = (booksRes.data || []).filter(b => !String(b.title || '').startsWith('__ACCORD_'));

    const postSel = document.getElementById('promo-post-id');
    if (postSel) {
        postSel.innerHTML = myPostsCache.length === 0
            ? '<option value="">-- No eligible posts to promote yet --</option>'
            : '<option value="">-- Choose a post to promote --</option>' +
              myPostsCache.map(p => {
                  const pageProf = promotablePagesById[String(p.author_id)];
                  const prefix = pageProf ? `[${pageProf.full_name || 'Verified Page'}] ` : '';
                  const snippet = (p.body || '').trim().slice(0, 60) || 'Fellowship Post';
                  return `<option value="${escapePromoHtml(p.id)}">${escapePromoHtml(prefix + snippet)}</option>`;
              }).join('');
    }

    const bookSel = document.getElementById('promo-book-id');
    if (bookSel) {
        bookSel.innerHTML = booksCache.length === 0
            ? '<option value="">-- No eligible books to promote yet --</option>'
            : '<option value="">-- Choose a book to promote --</option>' +
              booksCache.map(b => {
                  const pageProf = promotablePagesById[String(b.author_id)];
                  const prefix = pageProf ? `[${pageProf.full_name || 'Verified Page'}] ` : '';
                  return `<option value="${escapePromoHtml(b.id)}">${escapePromoHtml(prefix + b.title)} — ${escapePromoHtml(b.author || '')}</option>`;
              }).join('');
    }
}

function handlePromoTypeChange() {
    const type = document.getElementById('promo-type')?.value || 'post';
    const isBanner = type === 'banner';
    document.getElementById('promo-post-select-wrap')?.classList.toggle('hidden', type !== 'post');
    document.getElementById('promo-book-select-wrap')?.classList.toggle('hidden', type !== 'book');
    document.getElementById('promo-banner-fields')?.classList.toggle('hidden', !isBanner);
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
            if (error && /(ad_goal|daily_budget_usd|local_currency|local_budget_amount|payment_card_label)/i.test(error.message || '')) {
                const { ad_goal: _ag, daily_budget_usd: _d, local_currency: _lc, local_budget_amount: _lb, payment_card_label: _pcl, ...fallbackPayload } = insertPayload;
                ({ error } = await supabaseClient.from('promotions').insert([fallbackPayload]));
            }

            if (btn) btn.disabled = false;
            if (error) {
                showToast(`Payment succeeded, but saving promotion failed: ${error.message}`, true);
                return;
            }
            showToast('Payment verified! Promotion submitted for Admin approval.');
            document.getElementById('promote-form')?.reset();
            syncDailyBudget(1, 'reset');
            syncDurationDays(7);
            handlePromoTypeChange();
            handlePromoGoalChange();
            await loadMyPromotions();
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

async function loadMyPromotions() {
    const listEl = document.getElementById('my-promotions-list');
    if (!listEl || !promoUser) return;

    const { data, error } = await supabaseClient
        .from('promotions')
        .select('*')
        .eq('advertiser_id', promoUser.id)
        .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-6 text-center">You haven't submitted any promotions yet.</p>`;
        return;
    }

    const statusBadge = {
        pending_approval: 'bg-amber-50 text-amber-700',
        approved: 'bg-emerald-50 text-emerald-700',
        rejected: 'bg-red-50 text-red-600',
        paused: 'bg-slate-100 text-slate-600',
        expired: 'bg-slate-100 text-slate-500'
    };

    listEl.innerHTML = data.map(p => {
        const fallbackLabel = p.promo_type === 'banner'
            ? 'Display Ad Banner'
            : p.promo_type === 'book'
                ? 'Promoted Book'
                : 'Promoted Post';
        const displayTitle = (p.title || '').trim() || (p.body ? p.body.slice(0, 70) : fallbackLabel);
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
            ? `<button type="button" onclick="togglePromotionPause('${escapePromoHtml(p.id)}', 'paused')" class="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-bold transition-colors inline-flex items-center gap-1"><i class="fa-solid fa-pause text-[9px]"></i> Pause Ad</button>`
            : canResume
                ? `<button type="button" onclick="togglePromotionPause('${escapePromoHtml(p.id)}', 'approved')" class="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold transition-colors inline-flex items-center gap-1"><i class="fa-solid fa-play text-[9px]"></i> Resume Ad</button>`
                : '';

        return `
        <div class="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-2">
            <div class="flex items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusBadge[p.status] || 'bg-slate-100 text-slate-600'}">${escapePromoHtml(p.status.replace('_', ' '))}</span>
                <span class="text-[11px] font-semibold text-accord-muted">${p.duration_days}d · ${escapePromoHtml(localLabel)} (${escapePromoHtml(dailyLabel)}/day)</span>
            </div>
            <p class="text-xs font-bold text-accord-slate truncate">${escapePromoHtml(displayTitle)}</p>
            <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-3 text-[11px] text-accord-muted">
                    <span><i class="fa-regular fa-eye mr-1"></i>${p.impressions_count || 0} views</span>
                    <span><i class="fa-solid fa-arrow-pointer mr-1"></i>${p.clicks_count || 0} clicks</span>
                    <span class="px-1.5 py-0.5 rounded bg-slate-200/70 text-[10px] font-bold text-accord-slate">${goalLabel}</span>
                </div>
                ${pauseBtnHtml}
            </div>
            ${p.payment_card_label ? `<p class="text-[10px] text-accord-muted"><i class="fa-regular fa-credit-card mr-1"></i>Paid with ${escapePromoHtml(p.payment_card_label)}</p>` : ''}
            ${p.admin_notes ? `<p class="text-[11px] text-accord-blue">Admin note: ${escapePromoHtml(p.admin_notes)}</p>` : ''}
        </div>
        `;
    }).join('');
}

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
