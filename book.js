// 1. Initialize Supabase (public page, matches index.js)
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

const HIDDEN_CONFIG_TITLES = [
    '__ACCORD_ROLES_CONFIG__',
    '__ACCORD_LAYOUT_CONFIG__',
    '__ACCORD_MUSIC_CONFIG__'
];

let currentUser = null;
let currentProfile = null;
let currentBook = null;
let currentBookId = null;
let hasLikedBook = false;
let bookLikesCount = 0;
let savedBookmarks = JSON.parse(localStorage.getItem('accord_bookmarks') || '[]');
let savedTestimonyIds = [];
let purchasedBookIds = [];
let authMode = 'signin';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    currentBookId = params.get('id') || params.get('book');

    await initAuth();

    if (!currentBookId) {
        showNotFound();
        return;
    }

    await loadBookPage();
});

// ==========================================
// AUTHENTICATION & USER STATE
// ==========================================

async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    await syncUserState();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        await syncUserState();
        if (currentBook) {
            await loadLikeState();
            renderBookDetails();
            await loadComments();
        }
    });
}

async function syncUserState() {
    const navLabel = document.getElementById('auth-nav-label');
    const mobileLabel = document.getElementById('mobile-auth-label');
    const commentHint = document.getElementById('comment-auth-hint');

    if (currentUser) {
        const fullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
        if (navLabel) navLabel.innerText = fullName;
        if (mobileLabel) mobileLabel.innerText = `Account (${fullName})`;
        if (commentHint) commentHint.innerText = `Commenting as ${fullName}`;

        const [profileRes, bookmarksRes, testimonyBookmarksRes, purchasesRes] = await Promise.all([
            supabaseClient.from('profiles').select('id, full_name, account_type, upgrade_status').eq('id', currentUser.id).maybeSingle(),
            supabaseClient.from('user_bookmarks').select('book_title').eq('user_id', currentUser.id),
            supabaseClient.from('user_testimony_bookmarks').select('testimony_id').eq('user_id', currentUser.id),
            supabaseClient.from('user_purchases').select('book_id').eq('user_id', currentUser.id)
        ]);

        currentProfile = profileRes.data || null;

        const isVerifiedMinistry = Boolean(
            currentProfile &&
            (currentProfile.account_type === 'ministry_minister' || currentProfile.upgrade_status === 'approved')
        );
        document.getElementById('book-profile-verified-badge')?.classList.toggle('hidden', !isVerifiedMinistry);
        document.getElementById('mobile-book-profile-verified-badge')?.classList.toggle('hidden', !isVerifiedMinistry);

        if (!bookmarksRes.error && bookmarksRes.data) {
            savedBookmarks = bookmarksRes.data.map(b => b.book_title);
            localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
        }
        if (!testimonyBookmarksRes.error && testimonyBookmarksRes.data) {
            savedTestimonyIds = testimonyBookmarksRes.data.map(t => Number(t.testimony_id));
        }
        if (!purchasesRes.error && purchasesRes.data) {
            purchasedBookIds = purchasesRes.data.map(p => String(p.book_id));
        }
    } else {
        currentProfile = null;
        document.getElementById('book-profile-verified-badge')?.classList.add('hidden');
        document.getElementById('mobile-book-profile-verified-badge')?.classList.add('hidden');
        if (navLabel) navLabel.innerText = 'Sign In';
        if (mobileLabel) mobileLabel.innerText = 'Sign In / Create Account';
        if (commentHint) commentHint.innerHTML = `<button type="button" onclick="openAuthModal()" class="text-accord-blue font-bold hover:underline">Sign in</button> to join the discussion.`;
        savedTestimonyIds = [];
        purchasedBookIds = [];
    }

    updateSavedBadge();
}

function updateSavedBadge() {
    const totalCount = savedBookmarks.length + savedTestimonyIds.length;
    const badge = document.getElementById('bookmark-badge');
    const mobileCount = document.getElementById('mobile-bookmark-count');
    if (badge) badge.innerText = totalCount;
    if (mobileCount) mobileCount.innerText = totalCount;
}

function handleAuthNavClick() {
    if (currentUser) {
        window.location.href = 'profile.html';
    } else {
        openAuthModal();
    }
}

// ==========================================
// LOAD BOOK, LIKES & COMMENTS
// ==========================================

async function loadBookPage() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('*')
        .eq('id', currentBookId)
        .maybeSingle();

    if (
        error ||
        !data ||
        HIDDEN_CONFIG_TITLES.includes(data.title) ||
        data.deleted_at ||
        data.is_visible === false ||
        data.status === 'draft'
    ) {
        showNotFound();
        return;
    }

    currentBook = data;
    bookLikesCount = Number(data.likes_count) || 0;
    document.title = `${data.title} — Accord Archive`;

    await Promise.all([loadLikeState(), loadComments()]);
    renderBookDetails();

    document.getElementById('book-loading')?.classList.add('hidden');
    document.getElementById('book-detail-card')?.classList.remove('hidden');
    document.getElementById('book-comments-section')?.classList.remove('hidden');
}

function showNotFound() {
    document.getElementById('book-loading')?.classList.add('hidden');
    document.getElementById('book-not-found')?.classList.remove('hidden');
}

function renderBookDetails() {
    if (!currentBook) return;

    const book = currentBook;
    const isPurchased = purchasedBookIds.includes(String(book.id));
    const isBookmarked = savedBookmarks.includes(book.title);
    const isSupabaseFile = book.download_url && book.download_url.includes('/archive-files/');
    const cleanReadUrl = book.download_url ? (isSupabaseFile ? book.download_url.split('?')[0] : book.download_url) : '';

    // Cover
    const coverWrapper = document.getElementById('book-cover-wrapper');
    if (coverWrapper) {
        coverWrapper.innerHTML = `
            ${book.cover_url
                ? `<img src="${escapeHTML(book.cover_url)}" alt="${escapeHTML(book.title)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="w-full h-72 sm:h-80 object-cover rounded-2xl border border-slate-200 shadow-md" />`
                : ''}
            <div class="w-full h-72 sm:h-80 rounded-2xl bg-gradient-to-br ${book.gradient || 'from-blue-900 via-indigo-900 to-slate-900'} p-5 flex-col justify-between text-white shadow-md" style="${book.cover_url ? 'display:none;' : 'display:flex;'}">
                <p class="text-[9px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                <h4 class="serif-heading text-base font-bold leading-snug">${escapeHTML(book.title)}</h4>
                <p class="text-xs text-slate-200">${escapeHTML(book.author)}</p>
            </div>
        `;
    }

    // Metadata
    document.getElementById('book-category').innerText = book.category || 'Archive';
    document.getElementById('book-rights-verified-badge')?.classList.toggle('hidden', !book.rights_verified);
    document.getElementById('book-year').innerText = book.year ? `Published: ${book.year}` : '';
    document.getElementById('book-pages').innerText = book.pages ? `• ${book.pages} pages` : '';
    document.getElementById('book-downloads').innerText = `• ${Number(book.downloads) || 0} downloads`;
    document.getElementById('book-title').innerText = book.title || '';
    document.getElementById('book-author').innerText = `Author / Source: ${book.author || 'Unknown'}`;
    document.getElementById('book-description').innerText = book.description || 'No description provided for this publication.';

    // Price Badge
    const priceEl = document.getElementById('book-price-badge');
    if (priceEl) {
        if (book.is_for_sale && !isPurchased) {
            priceEl.classList.remove('hidden');
            priceEl.innerHTML = `<span class="inline-flex items-center px-3 py-1 rounded-xl bg-accord-goldLight text-accord-gold text-xs font-extrabold">Paid Edition — USD ${Number(book.price || 0).toFixed(2)}</span>`;
        } else if (book.is_for_sale && isPurchased) {
            priceEl.classList.remove('hidden');
            priceEl.innerHTML = `<span class="inline-flex items-center px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-extrabold"><i class="fa-solid fa-circle-check mr-1.5"></i>Purchased &amp; Unlocked</span>`;
        } else {
            priceEl.classList.remove('hidden');
            priceEl.innerHTML = `<span class="inline-flex items-center px-3 py-1 rounded-xl bg-accord-lightBlue text-accord-blue text-xs font-extrabold">Free Digital Edition</span>`;
        }
    }

    // Primary CTA
    const ctaContainer = document.getElementById('book-primary-cta');
    if (ctaContainer) {
        if (book.is_for_sale && !isPurchased) {
            ctaContainer.innerHTML = `
                <button type="button" onclick="initiateBookPurchase()" class="w-full bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-cart-shopping"></i>
                    <span>Buy Now — USD ${Number(book.price || 0).toFixed(2)}</span>
                </button>`;
        } else if (book.is_for_sale && isPurchased && cleanReadUrl) {
            ctaContainer.innerHTML = `
                <a href="${escapeHTML(cleanReadUrl)}" target="_blank" rel="noopener noreferrer" onclick="recordBookDownload()" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-3.5 px-6 rounded-2xl shadow-sm transition-all flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-book-open-reader"></i>
                    <span>Read Full Publication</span>
                </a>`;
        } else if (book.download_url) {
            ctaContainer.innerHTML = `
                <a href="${escapeHTML(book.download_url)}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} onclick="recordBookDownload()" class="w-full bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-download"></i>
                    <span>Download / Read Publication</span>
                </a>`;
        } else {
            ctaContainer.innerHTML = `
                <button disabled class="w-full bg-slate-200 text-slate-500 text-xs font-bold py-3.5 px-6 rounded-2xl cursor-not-allowed">
                    Digital File Coming Soon
                </button>`;
        }
    }

    // Save Button State
    const saveBtn = document.getElementById('book-save-btn');
    const saveIcon = document.getElementById('book-save-icon');
    const saveLabel = document.getElementById('book-save-label');
    if (saveBtn && saveIcon && saveLabel) {
        saveBtn.className = isBookmarked
            ? 'px-4 py-3.5 rounded-2xl border border-accord-gold bg-accord-goldLight text-accord-gold text-xs font-bold transition-all inline-flex items-center space-x-1.5'
            : 'px-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 hover:border-accord-gold text-accord-slate text-xs font-bold transition-all inline-flex items-center space-x-1.5';
        saveIcon.className = `${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark`;
        saveLabel.innerText = isBookmarked ? 'Saved' : 'Save';
    }

    renderLikeButton();
}

// ==========================================
// LIKES (book_likes)
// ==========================================

function getVoterKey() {
    if (currentUser?.id) return `user:${currentUser.id}`;
    let guestKey = localStorage.getItem('accord_guest_voter_key');
    if (!guestKey) {
        guestKey = `guest:${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2)}`;
        localStorage.setItem('accord_guest_voter_key', guestKey);
    }
    return guestKey;
}

async function loadLikeState() {
    if (!currentBook) return;
    const voterKey = getVoterKey();

    const { data, error } = await supabaseClient
        .from('book_likes')
        .select('id')
        .eq('book_id', currentBook.id)
        .eq('voter_key', voterKey)
        .maybeSingle();

    hasLikedBook = !error && Boolean(data);
    renderLikeButton();
}

function renderLikeButton() {
    const btn = document.getElementById('book-like-btn');
    const icon = document.getElementById('book-like-icon');
    const countEl = document.getElementById('book-like-count');
    if (!btn || !icon || !countEl) return;

    btn.className = hasLikedBook
        ? 'px-4 py-3.5 rounded-2xl border border-rose-300 bg-rose-50 text-rose-600 text-xs font-bold transition-all inline-flex items-center space-x-2'
        : 'px-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 hover:border-rose-300 hover:bg-rose-50 text-accord-slate text-xs font-bold transition-all inline-flex items-center space-x-2';
    icon.className = `${hasLikedBook ? 'fa-solid' : 'fa-regular'} fa-heart`;
    countEl.innerText = bookLikesCount;
}

async function toggleBookLike() {
    if (!currentBook) return;
    const voterKey = getVoterKey();

    if (hasLikedBook) {
        const { error } = await supabaseClient
            .from('book_likes')
            .delete()
            .eq('book_id', currentBook.id)
            .eq('voter_key', voterKey);

        if (error) {
            showToast(`Could not update like: ${error.message}`);
            return;
        }
        hasLikedBook = false;
        bookLikesCount = Math.max(0, bookLikesCount - 1);
    } else {
        const { error } = await supabaseClient
            .from('book_likes')
            .insert([{ book_id: currentBook.id, voter_key: voterKey }]);

        if (error) {
            showToast(`Could not like publication: ${error.message}`);
            return;
        }
        hasLikedBook = true;
        bookLikesCount += 1;
    }

    renderLikeButton();
}

// ==========================================
// COMMENTS (book_comments)
// ==========================================

async function loadComments() {
    if (!currentBook) return;

    const { data, error } = await supabaseClient
        .from('book_comments')
        .select('*')
        .eq('book_id', currentBook.id)
        .order('created_at', { ascending: false });

    const listEl = document.getElementById('book-comments-list');
    const countEl = document.getElementById('comments-count-label');
    if (!listEl || !countEl) return;

    if (error) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted">Could not load comments right now.</p>`;
        return;
    }

    const comments = data || [];
    countEl.innerText = `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`;

    if (comments.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-4 text-center">No comments yet. Be the first to share a reflection.</p>`;
        return;
    }

    listEl.innerHTML = comments.map(c => {
        const isOwner = currentUser && currentUser.id === c.user_id;
        const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const isVerifiedRole = c.author_role === 'Ministry / Minister' || c.author_role === 'Admin';
        const roleBadge = isVerifiedRole
            ? `<span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2 py-0.5 rounded-full">${escapeHTML(c.author_role)}</span>`
            : `<span class="bg-slate-100 text-accord-muted text-[10px] font-semibold px-2 py-0.5 rounded-full">${escapeHTML(c.author_role || 'Member')}</span>`;

        return `
            <div class="rounded-2xl border border-slate-200/80 bg-accord-bg p-4 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-bold text-accord-slate">${escapeHTML(c.author_name)}</span>
                        ${roleBadge}
                        <span class="text-[11px] text-accord-muted">${dateStr}</span>
                    </div>
                    ${isOwner ? `<button type="button" onclick="deleteComment('${c.id}')" class="text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors" title="Delete comment"><i class="fa-regular fa-trash-can"></i></button>` : ''}
                </div>
                <p class="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">${escapeHTML(c.body)}</p>
            </div>
        `;
    }).join('');
}

async function handleCommentSubmit(e) {
    e.preventDefault();
    if (!currentBook) return;

    if (!currentUser) {
        showToast('Please sign in to post a comment.');
        openAuthModal();
        return;
    }

    const input = document.getElementById('book-comment-input');
    const submitBtn = document.getElementById('book-comment-submit');
    const body = (input?.value || '').trim();
    if (!body) return;

    const authorName =
        currentProfile?.full_name ||
        currentUser.user_metadata?.full_name ||
        currentUser.user_metadata?.name ||
        currentUser.email.split('@')[0];

    const isVerifiedMinistry =
        currentProfile?.account_type === 'ministry_minister' ||
        currentProfile?.upgrade_status === 'approved';
    const authorRole = isVerifiedMinistry ? 'Ministry / Minister' : 'Member';

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Posting...';
    }

    const { error } = await supabaseClient.from('book_comments').insert([{
        book_id: currentBook.id,
        user_id: currentUser.id,
        author_name: authorName,
        author_role: authorRole,
        body
    }]);

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Post Comment';
    }

    if (error) {
        showToast(`Could not post comment: ${error.message}`);
        return;
    }

    if (input) input.value = '';
    showToast('Comment posted!');
    await loadComments();
}

async function deleteComment(commentId) {
    if (!currentUser) return;
    const { error } = await supabaseClient
        .from('book_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', currentUser.id);

    if (error) {
        showToast(`Could not delete comment: ${error.message}`);
        return;
    }
    showToast('Comment deleted.');
    await loadComments();
}

// ==========================================
// SAVE, DOWNLOAD, PURCHASE & SHARE
// ==========================================

async function toggleCurrentBookBookmark() {
    if (!currentBook) return;
    const bookTitle = currentBook.title;
    const isAlreadySaved = savedBookmarks.includes(bookTitle);

    if (isAlreadySaved) {
        savedBookmarks = savedBookmarks.filter(t => t !== bookTitle);
        showToast('Removed from Saved.');
        if (currentUser) {
            await supabaseClient.from('user_bookmarks').delete().eq('user_id', currentUser.id).eq('book_title', bookTitle);
        }
    } else {
        savedBookmarks.push(bookTitle);
        showToast('Saved to your library!');
        if (currentUser) {
            await supabaseClient.from('user_bookmarks').upsert({ user_id: currentUser.id, book_title: bookTitle });
        }
    }

    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
    updateSavedBadge();
    renderBookDetails();
}

async function recordBookDownload() {
    if (!currentBook) return;
    currentBook.downloads = (Number(currentBook.downloads) || 0) + 1;
    document.getElementById('book-downloads').innerText = `• ${currentBook.downloads} downloads`;

    const { error } = await supabaseClient.rpc('increment_book_download', { book_id: Number(currentBook.id) });
    if (error) console.error('Failed to record download count:', error.message);
}

async function initiateBookPurchase() {
    if (!currentBook) return;
    if (!currentUser) {
        showToast('Please sign in to purchase this publication.');
        openAuthModal();
        return;
    }

    const { error } = await supabaseClient.from('user_purchases').insert([{
        user_id: currentUser.id,
        book_id: Number(currentBook.id),
        amount_paid: Number(currentBook.price) || 0
    }]);

    if (!error) {
        purchasedBookIds.push(String(currentBook.id));
        showToast(`Unlocked "${currentBook.title}"! You can now read or download it.`);
        renderBookDetails();
    } else {
        showToast(`Purchase notice: ${error.message}`);
    }
}

function sendCurrentBookToChat() {
    if (!currentBook || typeof openShareToChatModal !== 'function') return;
    openShareToChatModal({
        type: 'shared_book',
        id: currentBook.id,
        title: currentBook.title,
        subtitle: (currentBook.description || '').slice(0, 110),
        url: `${window.location.origin}/book.html?id=${encodeURIComponent(currentBook.id)}`,
        image_url: currentBook.cover_url || '',
        author_name: currentBook.author || 'Accord Library'
    });
}

async function shareCurrentBook() {
    if (!currentBook) return;
    const shareUrl = `${window.location.origin}/book.html?id=${currentBook.id}`;
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop && navigator.share) {
        try {
            await navigator.share({ title: currentBook.title, url: shareUrl });
            return;
        } catch (err) {}
    }
    await navigator.clipboard.writeText(shareUrl);
    showToast('Book link copied to clipboard!');
}

function openCopyrightReportModal() {
    if (!currentBook) return;
    const nameInput = document.getElementById('cr-reporter-name');
    const emailInput = document.getElementById('cr-reporter-email');
    if (nameInput && !nameInput.value && currentProfile?.full_name) {
        nameInput.value = currentProfile.full_name;
    }
    if (emailInput && !emailInput.value && currentUser?.email) {
        emailInput.value = currentUser.email;
    }
    const modal = document.getElementById('copyright-report-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeCopyrightReportModal() {
    const modal = document.getElementById('copyright-report-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
    document.getElementById('copyright-report-form')?.reset();
}

async function handleCopyrightReportSubmit(e) {
    e.preventDefault();
    if (!currentBook) return;

    const reporterName = document.getElementById('cr-reporter-name').value.trim();
    const reporterEmail = document.getElementById('cr-reporter-email').value.trim();
    const claimType = document.getElementById('cr-claim-type').value;
    const proofUrl = document.getElementById('cr-proof-url').value.trim();
    const details = document.getElementById('cr-details').value.trim();
    const btn = document.getElementById('cr-submit-btn');

    if (details.length < 20) {
        showToast('Please provide at least 20 characters explaining the claim.');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    const { error } = await supabaseClient
        .from('book_copyright_reports')
        .insert([{
            book_id: currentBook.id,
            reporter_id: currentUser ? currentUser.id : null,
            reporter_name: reporterName,
            reporter_email: reporterEmail,
            claim_type: claimType,
            proof_url: proofUrl || null,
            details,
            status: 'open'
        }]);

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }

    if (error) {
        showToast(`Could not submit copyright report: ${error.message}`);
        return;
    }

    closeCopyrightReportModal();
    showToast('Copyright report submitted. Our Library Admin team will review it.');
}

// ==========================================
// AUTH MODAL & HELPERS
// ==========================================

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');

    if (typeof window.mountAccordGoogleSignIn === 'function') {
        window.mountAccordGoogleSignIn({
            containerId: 'google-gsi-container',
            fallbackBtnId: 'google-fallback-btn',
            fallbackLinkId: 'google-fallback-link',
            redirectTo: window.location.href,
            onSuccess: () => {
                closeAuthModal();
                showToast('Signed in with Google!');
            },
            onError: (msg) => showToast(msg || 'Google sign-in failed.')
        });
    }
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

function switchAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';
    document.getElementById('auth-name-field')?.classList.toggle('hidden', !isSignup);
    const nameInput = document.getElementById('auth-name');
    if (nameInput) nameInput.required = isSignup;
    const submitBtn = document.getElementById('auth-submit-btn');
    if (submitBtn) submitBtn.innerText = isSignup ? 'Create Free Account' : 'Sign In';

    const tabSignin = document.getElementById('tab-signin');
    const tabSignup = document.getElementById('tab-signup');
    if (tabSignin) {
        tabSignin.className = !isSignup
            ? 'py-2 text-xs font-bold rounded-lg bg-white text-accord-slate shadow-sm transition-all'
            : 'py-2 text-xs font-bold rounded-lg text-accord-muted hover:text-accord-slate transition-all';
    }
    if (tabSignup) {
        tabSignup.className = isSignup
            ? 'py-2 text-xs font-bold rounded-lg bg-white text-accord-slate shadow-sm transition-all'
            : 'py-2 text-xs font-bold rounded-lg text-accord-muted hover:text-accord-slate transition-all';
    }
}

async function handleGoogleSignIn() {
    if (typeof window.triggerAccordGoogleOAuthFallback === 'function') {
        await window.triggerAccordGoogleOAuthFallback(window.location.href, (msg) => showToast(msg));
        return;
    }
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href, queryParams: { prompt: 'select_account' } }
    });
    if (error) showToast(error.message);
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const fullName = document.getElementById('auth-name')?.value.trim() || '';
    const submitBtn = document.getElementById('auth-submit-btn');

    if (password.length < 6) {
        showToast('Password must be at least 6 characters.');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Please wait...';
    }

    if (authMode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: fullName },
                emailRedirectTo: `${window.location.origin}/signin.html`
            }
        });
        if (error) showToast(error.message);
        else if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            showToast('An account with this email already exists. Please sign in instead.');
            switchAuthMode('signin');
        } else {
            if (data?.session) {
                await window.ensureUserProfileRow?.(supabaseClient, data.user, fullName);
            }
            showToast(data.session ? `Welcome to Accord, ${fullName || 'Reader'}!` : 'Account created! Check your email to confirm.');
            closeAuthModal();
        }
    } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) showToast(error.message);
        else {
            await window.ensureUserProfileRow?.(supabaseClient, data?.user);
            showToast('Signed in successfully!');
            closeAuthModal();
        }
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        switchAuthMode(authMode);
    }
}

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}