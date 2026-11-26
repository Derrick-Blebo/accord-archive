const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

let promoUser = null;
let myPostsCache = [];
let booksCache = [];

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
    await Promise.all([loadPromoteChoices(), loadMyPromotions()]);

    const params = new URLSearchParams(window.location.search);
    const prePost = params.get('post');
    const preBook = params.get('book');
    if (prePost) {
        document.getElementById('promo-type').value = 'post';
        handlePromoTypeChange();
        document.getElementById('promo-post-id').value = prePost;
        prefillFromSelectedPost();
    } else if (preBook) {
        document.getElementById('promo-type').value = 'book';
        handlePromoTypeChange();
        document.getElementById('promo-book-id').value = preBook;
        prefillFromSelectedBook();
    }
});

async function loadPromoteChoices() {
    const [postsRes, booksRes] = await Promise.all([
        supabaseClient.from('feed_posts').select('id, title, body').eq('author_id', promoUser.id).order('created_at', { ascending: false }).limit(50),
        supabaseClient.from('books').select('id, title, author, description, cover_url').eq('is_visible', true).order('created_at', { ascending: false }).limit(100)
    ]);

    myPostsCache = postsRes.data || [];
    booksCache = (booksRes.data || []).filter(b => !String(b.title || '').startsWith('__ACCORD_'));

    const postSel = document.getElementById('promo-post-id');
    if (postSel) {
        postSel.innerHTML = '<option value="">-- Choose one of your posts --</option>' +
            myPostsCache.map(p => `<option value="${p.id}">${escapePromoHtml(p.title || 'Untitled Post')}</option>`).join('');
    }

    const bookSel = document.getElementById('promo-book-id');
    if (bookSel) {
        bookSel.innerHTML = '<option value="">-- Choose a library book --</option>' +
            booksCache.map(b => `<option value="${b.id}">${escapePromoHtml(b.title)} — ${escapePromoHtml(b.author || '')}</option>`).join('');
    }
}

function handlePromoTypeChange() {
    const type = document.getElementById('promo-type')?.value || 'post';
    document.getElementById('promo-post-select-wrap')?.classList.toggle('hidden', type !== 'post');
    document.getElementById('promo-book-select-wrap')?.classList.toggle('hidden', type !== 'book');
    document.getElementById('promo-banner-fields')?.classList.toggle('hidden', type !== 'banner');
}

function prefillFromSelectedPost() {
    const id = document.getElementById('promo-post-id')?.value;
    const post = myPostsCache.find(p => String(p.id) === String(id));
    if (!post) return;
    document.getElementById('promo-title').value = post.title || '';
    document.getElementById('promo-body').value = (post.body || '').slice(0, 260);
    document.getElementById('promo-cta-url').value = `post.html?id=${encodeURIComponent(post.id)}`;
}

function prefillFromSelectedBook() {
    const id = document.getElementById('promo-book-id')?.value;
    const book = booksCache.find(b => String(b.id) === String(id));
    if (!book) return;
    document.getElementById('promo-title').value = book.title || '';
    document.getElementById('promo-body').value = (book.description || '').slice(0, 260);
    document.getElementById('promo-cta-url').value = `book.html?id=${encodeURIComponent(book.id)}`;
}

function getSelectedPackage() {
    const raw = document.getElementById('promo-package')?.value || '7:10';
    const [days, price] = raw.split(':').map(Number);
    return { duration_days: days || 7, budget_amount: price || 10 };
}

function updatePromoPriceDisplay() {
    const { budget_amount } = getSelectedPackage();
    const el = document.getElementById('promo-price-display');
    if (el) el.textContent = `USD ${budget_amount.toFixed(2)}`;
}

async function handlePromotionSubmit(e) {
    e.preventDefault();
    if (!promoUser) return;

    const promoType = document.getElementById('promo-type').value;
    const title = document.getElementById('promo-title').value.trim();
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
    const desktopImg = promoType === 'banner' ? (document.getElementById('promo-desktop-img').value.trim() || null) : null;
    const mobileImg = promoType === 'banner' ? (document.getElementById('promo-mobile-img').value.trim() || null) : null;
    const { duration_days, budget_amount } = getSelectedPackage();

    const btn = document.getElementById('promo-pay-btn');
    if (btn) btn.disabled = true;

    window.launchAccordPaystackCheckout({
        email: promoUser.email,
        amount: budget_amount,
        currency: 'USD',
        metadata: { type: 'paid_promotion', promo_type: promoType, user_id: promoUser.id },
        onVerified: async (tx) => {
            const { error } = await supabaseClient.from('promotions').insert([{
                advertiser_id: promoUser.id,
                advertiser_name: promoUser.user_metadata?.full_name || promoUser.email?.split('@')[0] || 'Member',
                advertiser_email: promoUser.email,
                promo_type: promoType,
                target_post_id: targetPostId,
                target_book_id: targetBookId,
                title,
                body,
                desktop_image_url: desktopImg,
                mobile_image_url: mobileImg,
                cta_text: ctaText,
                cta_url: ctaUrl,
                placements: [placement],
                target_countries: targetCountries,
                duration_days,
                budget_amount,
                currency: tx.currency || 'USD',
                payment_provider: 'paystack',
                payment_reference: tx.reference,
                payment_status: 'paid',
                status: 'pending_approval'
            }]);

            if (btn) btn.disabled = false;
            if (error) {
                showToast(`Payment succeeded, but saving promotion failed: ${error.message}`, true);
                return;
            }
            showToast('Payment verified! Promotion submitted for Admin approval.');
            document.getElementById('promote-form')?.reset();
            updatePromoPriceDisplay();
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

    listEl.innerHTML = data.map(p => `
        <div class="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-1.5">
            <div class="flex items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusBadge[p.status] || 'bg-slate-100 text-slate-600'}">${escapePromoHtml(p.status.replace('_', ' '))}</span>
                <span class="text-[11px] font-semibold text-accord-muted">${p.duration_days}d · USD ${Number(p.budget_amount || 0).toFixed(2)}</span>
            </div>
            <p class="text-xs font-bold text-accord-slate truncate">${escapePromoHtml(p.title)}</p>
            <div class="flex items-center gap-3 text-[11px] text-accord-muted">
                <span><i class="fa-regular fa-eye mr-1"></i>${p.impressions_count || 0} views</span>
                <span><i class="fa-solid fa-arrow-pointer mr-1"></i>${p.clicks_count || 0} clicks</span>
            </div>
            ${p.admin_notes ? `<p class="text-[11px] text-accord-blue">Admin note: ${escapePromoHtml(p.admin_notes)}</p>` : ''}
        </div>
    `).join('');
}
