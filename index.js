// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allBooks = [];
let categoriesList = [];
let savedBookmarks = JSON.parse(localStorage.getItem('accord_bookmarks') || '[]');
let savedTestimonyIds = [];
let purchasedBookIds = [];
let currentCategory = 'All';
let currentAccessFilter = 'all';
let currentUser = null;
let authMode = 'signin';

document.addEventListener('DOMContentLoaded', async () => {
    await initAuth();
    await loadLibraryData();
});

// ==========================================
// AUTHENTICATION & SAVED BADGE SYNC
// ==========================================

async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    await syncUserState();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        await syncUserState();
        renderBooks();
    });
}

async function syncUserState() {
    const navLabel = document.getElementById('auth-nav-label');
    const mobileLabel = document.getElementById('mobile-auth-label');
    const formsContainer = document.getElementById('auth-forms-container');
    const profileContainer = document.getElementById('auth-profile-container');

    if (currentUser) {
        const fullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
        if (navLabel) navLabel.innerText = fullName;
        if (mobileLabel) mobileLabel.innerText = `Account (${fullName})`;

        formsContainer?.classList.add('hidden');
        profileContainer?.classList.remove('hidden');
        if (document.getElementById('profile-display-name')) document.getElementById('profile-display-name').innerText = fullName;
        if (document.getElementById('profile-display-email')) document.getElementById('profile-display-email').innerText = currentUser.email;

        const [bookmarksRes, testimonyBookmarksRes, purchasesRes] = await Promise.all([
            supabaseClient.from('user_bookmarks').select('book_title').eq('user_id', currentUser.id),
            supabaseClient.from('user_testimony_bookmarks').select('testimony_id').eq('user_id', currentUser.id),
            supabaseClient.from('user_purchases').select('book_id').eq('user_id', currentUser.id)
        ]);

        if (!bookmarksRes.error && bookmarksRes.data) {
            savedBookmarks = bookmarksRes.data.map(b => b.book_title);
            localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
        }
        if (!testimonyBookmarksRes.error && testimonyBookmarksRes.data) {
            savedTestimonyIds = testimonyBookmarksRes.data.map(t => Number(t.testimony_id));
        }
        if (!purchasesRes.error && purchasesRes.data) {
            purchasedBookIds = purchasesRes.data.map(p => Number(p.book_id));
        }
    } else {
        if (navLabel) navLabel.innerText = 'Sign In';
        if (mobileLabel) mobileLabel.innerText = 'Sign In / Create Account';
        formsContainer?.classList.remove('hidden');
        profileContainer?.classList.add('hidden');
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
// LOAD BOOKS & CATEGORIES FROM SUPABASE
// ==========================================

async function loadLibraryData() {
    const [booksRes, catsRes] = await Promise.all([
        supabaseClient
            .from('books')
            .select('*')
            .is('deleted_at', null)
            .eq('is_visible', true)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('categories')
            .select('*')
            .order('name', { ascending: true })
    ]);

    if (!booksRes.error && booksRes.data) {
        // Deduplicate books by lowercase title so duplicates never show on the homepage
        const seenTitles = new Set();
        allBooks = booksRes.data.filter(book => {
            const key = (book.title || '').trim().toLowerCase();
            if (!key || seenTitles.has(key)) return false;
            seenTitles.add(key);
            return true;
        });
    }

    if (!catsRes.error && catsRes.data) {
        categoriesList = catsRes.data;
        renderCategoryButtons();
    }

    renderBooks();
    checkSharedBookParam();
}

function renderCategoryButtons() {
    const container = document.getElementById('category-filters');
    if (!container) return;

    const allBtnClass = currentCategory === 'All'
        ? "cat-btn whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm"
        : "cat-btn whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";

    let html = `<button type="button" onclick="setCategoryFilter('All')" id="cat-All" class="${allBtnClass}">All Archives</button>`;

    categoriesList.forEach(cat => {
        const safeCat = escapeHTML(cat.name);
        const jsCat = cat.name.replace(/'/g, "\\'");
        const isActive = currentCategory === cat.name;
        const btnClass = isActive
            ? "cat-btn whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm"
            : "cat-btn whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";

        html += `<button type="button" onclick="setCategoryFilter('${jsCat}')" class="${btnClass}">${safeCat}</button>`;
    });

    container.innerHTML = html;
}

function setCategoryFilter(category) {
    currentCategory = category;
    renderCategoryButtons();
    renderBooks();
}

function setAccessFilter(accessType) {
    currentAccessFilter = accessType;
    ['all', 'free', 'paid'].forEach(type => {
        const btn = document.getElementById(`access-${type}`);
        if (!btn) return;
        if (type === accessType) {
            btn.className = "access-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-accord-slate text-white";
        } else {
            btn.className = "access-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
        }
    });
    renderBooks();
}

function filterBooks() {
    const searchInput = document.getElementById('library-search');
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn && searchInput) {
        if (searchInput.value.trim().length > 0) {
            clearBtn.classList.remove('hidden');
            clearBtn.classList.add('flex');
        } else {
            clearBtn.classList.add('hidden');
            clearBtn.classList.remove('flex');
        }
    }
    renderBooks();
}

// ==========================================
// RENDER RECTANGULAR BOOK GRID CARDS
// ==========================================

function renderBooks() {
    const grid = document.getElementById('book-grid');
    const countLabel = document.getElementById('publication-count');
    const emptyState = document.getElementById('empty-library-state');
    if (!grid) return;

    const query = (document.getElementById('library-search')?.value || '').toLowerCase();

    const filtered = allBooks.filter(book => {
        const matchesCategory = currentCategory === 'All' || book.category === currentCategory;
        const matchesAccess =
            currentAccessFilter === 'all' ||
            (currentAccessFilter === 'free' && !book.is_for_sale) ||
            (currentAccessFilter === 'paid' && Boolean(book.is_for_sale));
        const matchesQuery =
            (book.title || '').toLowerCase().includes(query) ||
            (book.author || '').toLowerCase().includes(query) ||
            (book.category || '').toLowerCase().includes(query) ||
            (book.description || '').toLowerCase().includes(query);

        return matchesCategory && matchesAccess && matchesQuery;
    });

    if (countLabel) {
        countLabel.innerText = `Showing ${filtered.length} ${filtered.length === 1 ? 'publication' : 'publications'}`;
    }

    grid.innerHTML = '';

    if (filtered.length === 0) {
        emptyState?.classList.remove('hidden');
        return;
    } else {
        emptyState?.classList.add('hidden');
    }

    filtered.forEach(book => {
        const isBookmarked = savedBookmarks.includes(book.title);
        const isPurchased = purchasedBookIds.includes(Number(book.id));
        const safeTitle = (book.title || '').replace(/'/g, "\\'");

        const fallbackCoverHtml = `
            <div class="fallback-cover w-full h-48 sm:h-full min-h-[195px] rounded-2xl bg-gradient-to-br ${book.gradient || 'from-blue-900 via-indigo-900 to-slate-900'} p-3.5 flex flex-col justify-between text-white shadow-sm relative overflow-hidden" style="${book.cover_url ? 'display:none;' : 'display:flex;'}">
                <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px]"></div>
                <div class="relative z-10">
                    <p class="text-[7px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                    <h4 class="serif-heading text-xs font-bold mt-1.5 leading-snug line-clamp-4">${escapeHTML(book.title)}</h4>
                </div>
                <div class="relative z-10 text-[9px] text-slate-200/90 truncate">${escapeHTML(book.author)}</div>
            </div>
        `;

        const coverVisual = book.cover_url
            ? `<div class="w-full h-48 sm:h-full min-h-[195px] rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm relative bg-slate-100">
                   <img src="${escapeHTML(book.cover_url)}"
                        alt="${escapeHTML(book.title)}"
                        loading="lazy"
                        onerror="this.parentElement.style.display='none'; this.parentElement.nextElementSibling.style.display='flex';"
                        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
               </div>
               ${fallbackCoverHtml}`
            : fallbackCoverHtml;

        const isSupabaseFile = book.download_url && book.download_url.includes('/archive-files/');
        const cleanReadUrl = book.download_url ? (isSupabaseFile ? book.download_url.split('?')[0] : book.download_url) : '';

        const priceLine = (book.is_for_sale && !isPurchased)
            ? `<p class="text-xs font-extrabold text-accord-blue mb-2.5">USD ${Number(book.price || 0).toFixed(2)}</p>`
            : '';

        let primaryActionButton = '';
        if (book.is_for_sale && !isPurchased) {
            primaryActionButton = `<button type="button" onclick="openBookModal(${book.id})" class="flex-1 h-9 bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm shadow-amber-500/20 flex items-center justify-center space-x-1.5"><i class="fa-solid fa-cart-shopping text-[11px]"></i><span>Buy Now</span></button>`;
        } else if (book.is_for_sale && isPurchased) {
            primaryActionButton = cleanReadUrl
                ? `<a href="${cleanReadUrl}" target="_blank" rel="noopener noreferrer" onclick="recordBookDownload(${book.id})" class="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-book-open-reader text-[11px]"></i><span>Read</span></a>`
                : `<button type="button" onclick="openBookModal(${book.id})" class="flex-1 h-9 bg-emerald-600 text-white text-xs font-bold px-4 rounded-full">Read</button>`;
        } else {
            primaryActionButton = book.download_url
                ? `<a href="${book.download_url}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} onclick="recordBookDownload(${book.id})" class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-3 rounded-xl transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-download text-[10px]"></i><span>Download</span></a>`
                : `<button type="button" onclick="openBookModal(${book.id})" class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-3 rounded-xl">Details</button>`;
        }

        const card = document.createElement('article');
        card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-4 shadow-sm hover:shadow-lg transition-all duration-300 flex gap-4 items-stretch group";
        card.innerHTML = `
            <div onclick="openBookModal(${book.id})" class="w-28 sm:w-32 shrink-0 cursor-pointer">
                ${coverVisual}
            </div>
            <div class="flex-1 flex flex-col justify-between min-w-0">
                <div onclick="openBookModal(${book.id})" class="cursor-pointer">
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                        <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-0.5 rounded-md truncate">
                            ${escapeHTML(book.category || 'Archive')}
                        </span>
                        ${book.year ? `<span class="text-[11px] font-semibold text-accord-muted shrink-0">${escapeHTML(book.year)}</span>` : ''}
                    </div>
                    <h3 class="font-bold text-accord-slate text-sm sm:text-[15px] leading-snug mb-1 line-clamp-2 group-hover:text-accord-blue transition-colors">
                        ${escapeHTML(book.title)}
                    </h3>
                    <p class="text-[11px] font-bold text-accord-slate mb-1.5 truncate">
                        ${escapeHTML(book.author)}
                    </p>
                    <p class="text-[11px] text-accord-muted leading-relaxed line-clamp-2 mb-2.5">
                        ${escapeHTML(book.description || '')}
                    </p>
                    ${priceLine}
                </div>

                <div class="flex items-center gap-1.5">
                    ${primaryActionButton}
                    <button type="button" onclick="toggleBookmark('${safeTitle}')" class="w-9 h-9 shrink-0 border ${isBookmarked ? 'text-accord-gold border-accord-gold bg-amber-50' : 'text-slate-400 hover:text-accord-gold border-slate-200 hover:border-accord-gold bg-slate-50'} rounded-xl flex items-center justify-center transition-all" title="${isBookmarked ? 'Remove from Saved' : 'Save Book'}">
                        <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark text-[11px]"></i>
                    </button>
                    <button type="button" onclick="shareBookLink(${book.id}, '${safeTitle}')" class="w-9 h-9 shrink-0 border border-slate-200 hover:border-accord-blue bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-accord-blue rounded-xl flex items-center justify-center transition-all" title="Share Book">
                        <i class="fa-solid fa-share-nodes text-[11px]"></i>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ==========================================
// BOOK DETAIL MODAL, BOOKMARKS & DOWNLOADS
// ==========================================

function checkSharedBookParam() {
    const params = new URLSearchParams(window.location.search);
    const sharedBookId = params.get('book');
    if (sharedBookId) {
        openBookModal(Number(sharedBookId));
    }
}

function openBookModal(bookId) {
    const book = allBooks.find(b => Number(b.id) === Number(bookId));
    if (!book) return;

    const modal = document.getElementById('book-detail-modal');
    const content = document.getElementById('book-modal-content');
    if (!modal || !content) return;

    const isPurchased = purchasedBookIds.includes(Number(book.id));
    const isBookmarked = savedBookmarks.includes(book.title);
    const safeTitle = (book.title || '').replace(/'/g, "\\'");
    const isSupabaseFile = book.download_url && book.download_url.includes('/archive-files/');

    const actionHtml = (book.is_for_sale && !isPurchased)
        ? `<button type="button" onclick="initiateBookPurchase(${book.id})" class="flex-1 bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2">
               <i class="fa-solid fa-cart-shopping"></i>
               <span>Purchase Publication — USD ${Number(book.price || 0).toFixed(2)}</span>
           </button>`
        : (book.download_url
            ? `<a href="${book.download_url}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} onclick="recordBookDownload(${book.id})" class="flex-1 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center space-x-2">
                   <i class="fa-solid fa-download"></i>
                   <span>Download / Read Full Publication</span>
               </a>`
            : `<button disabled class="flex-1 bg-slate-200 text-slate-500 text-xs font-bold py-3.5 px-6 rounded-2xl cursor-not-allowed">Digital File Coming Soon</button>`);

    content.innerHTML = `
        <div class="flex flex-col sm:flex-row gap-6">
            <div class="w-36 sm:w-44 shrink-0 mx-auto sm:mx-0">
                ${book.cover_url
                    ? `<img src="${escapeHTML(book.cover_url)}" alt="${escapeHTML(book.title)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="w-full h-56 object-cover rounded-2xl border border-slate-200 shadow-md">`
                    : ''}
                <div class="w-full h-56 rounded-2xl bg-gradient-to-br ${book.gradient || 'from-blue-900 via-indigo-900 to-slate-900'} p-4 flex-col justify-between text-white shadow-md" style="${book.cover_url ? 'display:none;' : 'display:flex;'}">
                    <p class="text-[8px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                    <h4 class="serif-heading text-sm font-bold leading-snug">${escapeHTML(book.title)}</h4>
                    <p class="text-[10px] text-slate-200">${escapeHTML(book.author)}</p>
                </div>
            </div>

            <div class="flex-1 space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="bg-accord-lightBlue text-accord-blue text-[11px] font-bold px-3 py-1 rounded-lg">${escapeHTML(book.category)}</span>
                    <span class="text-xs font-semibold text-accord-muted">Published: ${escapeHTML(book.year || 'TBD')}</span>
                    <span class="text-xs font-semibold text-accord-muted">• ${escapeHTML(book.pages || 'TBD')} pages</span>
                </div>

                <h2 class="serif-heading text-2xl font-bold text-accord-slate leading-snug">${escapeHTML(book.title)}</h2>
                <p class="text-xs font-bold text-accord-slate">Author / Source: ${escapeHTML(book.author)}</p>

                <p class="text-xs sm:text-sm text-slate-600 leading-relaxed pt-2 border-t border-slate-100">
                    ${escapeHTML(book.description || '')}
                </p>

                <div class="pt-4 flex flex-wrap items-center gap-2.5">
                    ${actionHtml}
                    <button type="button" onclick="toggleBookmark('${safeTitle}'); openBookModal(${book.id});" class="px-4 py-3.5 rounded-2xl border ${isBookmarked ? 'border-accord-gold bg-amber-50 text-accord-gold' : 'border-slate-200 bg-slate-50 text-accord-slate hover:border-accord-gold'} text-xs font-bold transition-all">
                        <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark mr-1"></i> ${isBookmarked ? 'Saved' : 'Save'}
                    </button>
                    <button type="button" onclick="shareBookLink(${book.id}, '${safeTitle}')" class="px-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-blue-50 text-accord-slate hover:text-accord-blue text-xs font-bold transition-all">
                        <i class="fa-solid fa-share-nodes mr-1"></i> Share
                    </button>
                </div>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeBookModal() {
    const modal = document.getElementById('book-detail-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
    if (window.location.search.includes('book=')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

async function toggleBookmark(bookTitle) {
    const isAlreadySaved = savedBookmarks.includes(bookTitle);

    if (isAlreadySaved) {
        savedBookmarks = savedBookmarks.filter(t => t !== bookTitle);
        showToast("Removed from Saved.");
        if (currentUser) {
            await supabaseClient.from('user_bookmarks').delete().eq('user_id', currentUser.id).eq('book_title', bookTitle);
        }
    } else {
        savedBookmarks.push(bookTitle);
        showToast("Saved to your library!");
        if (currentUser) {
            await supabaseClient.from('user_bookmarks').upsert({ user_id: currentUser.id, book_title: bookTitle });
        }
    }

    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
    updateSavedBadge();
    renderBooks();
}

async function recordBookDownload(bookId) {
    const book = allBooks.find(b => Number(b.id) === Number(bookId));
    if (!book) return;
    
    // Optimistically update local state so the UI updates instantly
    book.downloads = (Number(book.downloads) || 0) + 1;

    // Call the secure atomic database function
    const { error } = await supabaseClient.rpc('increment_book_download', { book_id: Number(bookId) });
    if (error) {
        console.error("Failed to record download count:", error.message);
    }
}

async function initiateBookPurchase(bookId) {
    if (!currentUser) {
        showToast("Please sign in to purchase this publication.");
        closeBookModal();
        openAuthModal();
        return;
    }
    const book = allBooks.find(b => Number(b.id) === Number(bookId));
    if (!book) return;

    const { error } = await supabaseClient.from('user_purchases').insert([{
        user_id: currentUser.id,
        book_id: Number(book.id),
        amount_paid: Number(book.price) || 0
    }]);

    if (!error) {
        purchasedBookIds.push(Number(book.id));
        showToast(`Unlocked "${book.title}"! You can now read or download it.`);
        renderBooks();
        openBookModal(book.id);
    } else {
        showToast(`Purchase notice: ${error.message}`);
    }
}

async function shareBookLink(bookId, title) {
    const shareUrl = `${window.location.origin}/?book=${bookId}`;
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop && navigator.share) {
        try { await navigator.share({ title, url: shareUrl }); } catch (err) {}
    } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Book link copied to clipboard!");
    }
}

// ==========================================
// CONTRIBUTE ARCHIVE SUBMISSION MODAL
// ==========================================

function openContributeModal() {
    const modal = document.getElementById('contribute-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeContributeModal() {
    const modal = document.getElementById('contribute-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleContributeSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('sub-name').value.trim();
    const email = document.getElementById('sub-email').value.trim();
    const title = document.getElementById('sub-title').value.trim();
    const category = document.getElementById('sub-category').value;
    const description = document.getElementById('sub-description').value.trim();

    const { error } = await supabaseClient.from('submissions').insert([{
        name, email, title, category, description
    }]);

    if (error) {
        showToast(`Submission failed: ${error.message}`);
        return;
    }

    document.getElementById('contribute-form').reset();
    closeContributeModal();
    showToast("Thank you! Your manuscript has been submitted for editorial review.");
}

// ==========================================
// AUTH MODAL & HELPERS
// ==========================================

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
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
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
    });
    if (error) showToast(error.message);
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const fullName = document.getElementById('auth-name')?.value.trim() || '';
    const submitBtn = document.getElementById('auth-submit-btn');

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Please wait...';
    }

    if (authMode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } }
        });
        if (error) showToast(error.message);
        else {
            showToast(data.session ? `Welcome to Accord, ${fullName || 'Reader'}!` : 'Account created! Check your email to confirm.');
            closeAuthModal();
        }
    } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) showToast(error.message);
        else {
            showToast('Signed in successfully!');
            closeAuthModal();
        }
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        switchAuthMode(authMode);
    }
}

async function handleSignOut() {
    await supabaseClient.auth.signOut();
    closeAuthModal();
    showToast('Signed out.');
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