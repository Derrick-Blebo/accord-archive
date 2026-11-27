// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

const LAYOUT_CONFIG_CATEGORY_NAME = '__ACCORD_LAYOUT_CONFIG__';
const HIDDEN_CONFIG_TITLES = [
    '__ACCORD_ROLES_CONFIG__',
    '__ACCORD_LAYOUT_CONFIG__',
    '__ACCORD_MUSIC_CONFIG__',
    '__ACCORD_ADS_CONFIG__'
];

let allBooks = [];
let categoriesList = [];

// Default Kindle-Style Shelves (Displayed immediately until overridden from Admin)
function getDefaultShelves() {
    return [
        {
            id: 'shelf_special_picks',
            title: 'Accord Special Picks',
            subtitle: 'Foundational Christian classics & ministry landmarks',
            mode: 'recommended',
            category: '',
            limit: 10,
            bookIds: [],
            enabled: true
        },
        {
            id: 'shelf_most_popular',
            title: 'Most Popular Publications',
            subtitle: 'Most downloaded and read across the Accord library',
            mode: 'popular',
            category: '',
            limit: 10,
            bookIds: [],
            enabled: true
        },
        {
            id: 'shelf_new_additions',
            title: 'New Additions to the Archive',
            subtitle: 'Recently cataloged manuscripts, biographies, and devotionals',
            mode: 'newest',
            category: '',
            limit: 10,
            bookIds: [],
            enabled: true
        },
        {
            id: 'shelf_recommended',
            title: 'Recommended for You',
            subtitle: 'Essential readings on prayer, spiritual awakening, and leadership',
            mode: 'category',
            category: 'Prayer & Devotion',
            limit: 10,
            bookIds: [],
            enabled: true
        }
    ];
}

let homepageShelves = getDefaultShelves();

let bannerConfig = {
    enabled: true,
    afterCount: 6,
    intervalSeconds: 5,
    slides: [],
    badge: 'ACCORD HERITAGE INITIATIVE',
    headline: 'Do You Hold a Rare Christian Manuscript or Church Chronicle?',
    subtext: 'Partner with Accord Archive to digitize and preserve revival histories, biographies, and sermons for future generations.',
    btnText: 'Submit a Manuscript',
    actionType: 'contribute',
    customUrl: 'feed.html'
};

let currentBannerSlideIndex = 0;
let bannerSliderIntervalId = null;

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
// LOAD BOOKS, CATEGORIES, SHELVES & BANNER
// ==========================================

async function loadLibraryData() {
    const [booksRes, catsRes] = await Promise.all([
        supabaseClient
            .from('books')
            .select('*')
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('categories')
            .select('*')
            .order('name', { ascending: true })
    ]);

    if (!booksRes.error && booksRes.data) {
        // 1. Check for saved layout configuration in books table (or fallback to localStorage / defaults)
        const configRecord = booksRes.data.find(b => b.title === LAYOUT_CONFIG_CATEGORY_NAME);
        if (configRecord && configRecord.description) {
            try {
                const parsedConfig = JSON.parse(configRecord.description);
                if (Array.isArray(parsedConfig.shelves) && parsedConfig.shelves.length > 0) {
                    homepageShelves = parsedConfig.shelves;
                }
                if (parsedConfig.banner) {
                    bannerConfig = { ...bannerConfig, ...parsedConfig.banner };
                }
                localStorage.setItem('accord_home_layout_config', configRecord.description);
            } catch (e) {
                console.warn('Could not parse layout config from DB:', e);
            }
        } else {
            const localSaved = localStorage.getItem('accord_home_layout_config');
            if (localSaved) {
                try {
                    const parsedConfig = JSON.parse(localSaved);
                    if (Array.isArray(parsedConfig.shelves) && parsedConfig.shelves.length > 0) {
                        homepageShelves = parsedConfig.shelves;
                    }
                    if (parsedConfig.banner) {
                        bannerConfig = { ...bannerConfig, ...parsedConfig.banner };
                    }
                } catch (e) {}
            }
        }

        // 2. Filter published books (excluding hidden system config rows) & deduplicate by title
        const realBooks = booksRes.data.filter(
            b => !HIDDEN_CONFIG_TITLES.includes(b.title) && !b.deleted_at && b.is_visible !== false && b.status !== 'draft'
        );
        const seenTitles = new Set();
        allBooks = realBooks.filter(book => {
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

    renderCuratedShelves();
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
// KINDLE-STYLE CURATED HORIZONTAL SHELVES
// ==========================================

function renderCuratedShelves() {
    const wrapper = document.getElementById('curated-sections-wrapper');
    if (!wrapper) return;

    const query = (document.getElementById('library-search')?.value || '').trim();
    // Hide curated shelves while actively searching or filtering so results stay focused
    if (query.length > 0 || currentCategory !== 'All' || currentAccessFilter !== 'all') {
        wrapper.innerHTML = '';
        return;
    }

    const enabledShelves = (homepageShelves || []).filter(s => s.enabled !== false);
    if (enabledShelves.length === 0 || allBooks.length === 0) {
        wrapper.innerHTML = '';
        return;
    }

    let html = '';
    enabledShelves.forEach(shelf => {
        let shelfBooks = [];
        const limit = Number(shelf.limit) || 10;

        if (shelf.mode === 'manual') {
            const ids = Array.isArray(shelf.bookIds) ? shelf.bookIds.map(Number) : [];
            shelfBooks = ids.map(id => allBooks.find(b => Number(b.id) === id)).filter(Boolean);
        } else if (shelf.mode === 'popular') {
            shelfBooks = [...allBooks].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0)).slice(0, limit);
        } else if (shelf.mode === 'newest') {
            shelfBooks = [...allBooks].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, limit);
        } else if (shelf.mode === 'recommended') {
            shelfBooks = [...allBooks].filter(b => b.is_for_sale || (Number(b.downloads) || 0) > 0).slice(0, limit);
            if (shelfBooks.length < 4) shelfBooks = allBooks.slice(0, limit);
        } else if (shelf.mode === 'category') {
            shelfBooks = allBooks.filter(b => (b.category || '').toLowerCase() === (shelf.category || '').toLowerCase()).slice(0, limit);
            if (shelfBooks.length === 0) shelfBooks = allBooks.slice(0, limit);
        }

        if (shelfBooks.length === 0) return;

        const rowId = `shelf-row-${shelf.id}`;
        const cardsHtml = shelfBooks.map(book => {
            const isPurchased = purchasedBookIds.includes(Number(book.id));
            const priceLabel = book.is_for_sale
                ? (isPurchased ? `<span class="text-[11px] font-bold text-emerald-600">Purchased</span>` : `<span class="text-xs font-extrabold text-accord-slate">USD ${Number(book.price || 0).toFixed(2)}</span>`)
                : `<span class="text-[11px] font-bold text-accord-blue">Free Edition</span>`;

            const coverImg = book.cover_url
                ? `<div class="w-full h-52 rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm bg-slate-100 relative">
                       <img src="${escapeHTML(book.cover_url)}"
                            alt="${escapeHTML(book.title)}"
                            loading="lazy"
                            onerror="this.parentElement.style.display='none'; this.parentElement.nextElementSibling.style.display='flex';"
                            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                   </div>
                   <div class="w-full h-52 rounded-2xl bg-gradient-to-br ${book.gradient || 'from-blue-900 via-indigo-900 to-slate-900'} p-3.5 flex-col justify-between text-white shadow-sm" style="display:none;">
                       <p class="text-[7px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                       <h4 class="serif-heading text-xs font-bold leading-snug line-clamp-4">${escapeHTML(book.title)}</h4>
                       <p class="text-[9px] text-slate-200 truncate">${escapeHTML(book.author)}</p>
                   </div>`
                : `<div class="w-full h-52 rounded-2xl bg-gradient-to-br ${book.gradient || 'from-blue-900 via-indigo-900 to-slate-900'} p-3.5 flex flex-col justify-between text-white shadow-sm">
                       <p class="text-[7px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                       <h4 class="serif-heading text-xs font-bold leading-snug line-clamp-4">${escapeHTML(book.title)}</h4>
                       <p class="text-[9px] text-slate-200 truncate">${escapeHTML(book.author)}</p>
                   </div>`;

            return `
                <div onclick="openBookModal(${book.id})" class="w-36 sm:w-40 shrink-0 cursor-pointer group snap-start">
                    ${coverImg}
                    <div class="mt-2.5 space-y-0.5">
                        <h3 class="font-bold text-accord-slate text-xs leading-snug line-clamp-2 group-hover:text-accord-blue transition-colors">
                            ${escapeHTML(book.title)}
                        </h3>
                        <p class="text-[11px] text-accord-muted truncate">${escapeHTML(book.author)}</p>
                        <div class="pt-0.5">${priceLabel}</div>
                    </div>
                </div>
            `;
        }).join('');

        html += `
            <div class="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-6 shadow-sm">
                <div class="flex items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 class="serif-heading text-lg sm:text-xl font-bold text-accord-slate">${escapeHTML(shelf.title)}</h2>
                        ${shelf.subtitle ? `<p class="text-xs text-accord-muted mt-0.5">${escapeHTML(shelf.subtitle)}</p>` : ''}
                    </div>
                    <div class="flex items-center space-x-1.5 shrink-0">
                        <button type="button" onclick="scrollShelf('${rowId}', -340)" class="w-8 h-8 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-accord-slate flex items-center justify-center transition-all" aria-label="Scroll left">
                            <i class="fa-solid fa-chevron-left text-xs"></i>
                        </button>
                        <button type="button" onclick="scrollShelf('${rowId}', 340)" class="w-8 h-8 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-accord-slate flex items-center justify-center transition-all" aria-label="Scroll right">
                            <i class="fa-solid fa-chevron-right text-xs"></i>
                        </button>
                    </div>
                </div>
                <div id="${rowId}" class="flex gap-4 overflow-x-auto pb-2 no-scrollbar snap-x scroll-smooth">
                    ${cardsHtml}
                </div>
            </div>
        `;
    });

    wrapper.innerHTML = html;
}

function scrollShelf(rowId, delta) {
    const row = document.getElementById(rowId);
    if (row) row.scrollBy({ left: delta, behavior: 'smooth' });
}

// ==========================================
// RENDER MAIN BOOK GRID + MULTI-BANNER IMAGE SLIDER
// ==========================================

function buildBookCardElement(book) {
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
    const isSignedSupabase = isSupabaseFile && book.download_url.includes('token=');
    const cleanReadUrl = book.download_url ? (isSupabaseFile && !isSignedSupabase ? book.download_url.split('?')[0] : book.download_url) : '';

    const priceLine = (book.is_for_sale && !isPurchased)
        ? `<p class="text-xs font-extrabold text-accord-blue mb-2.5">USD ${Number(book.price || 0).toFixed(2)}</p>`
        : '';

    let primaryActionButton = '';
    const isProtected = book.is_downloadable === false && Boolean(book.encrypted_url);
    if (book.is_for_sale && !isPurchased) {
        primaryActionButton = `<button type="button" onclick="openBookModal(${book.id})" class="flex-1 h-9 bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm shadow-amber-500/20 flex items-center justify-center space-x-1.5"><i class="fa-solid fa-cart-shopping text-[11px]"></i><span>Buy Now</span></button>`;
    } else if (isProtected) {
        primaryActionButton = `<button type="button" onclick="openBookModal(${book.id})" class="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-book-open-reader text-[11px]"></i><span>Read In-App</span></button>`;
    } else if (book.is_for_sale && isPurchased) {
        primaryActionButton = cleanReadUrl
            ? `<a href="${book.download_url || cleanReadUrl}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} onclick="recordBookDownload(${book.id})" class="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-download text-[11px]"></i><span>Download</span></a>`
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

            <div class="flex items-center gap-1.5 relative">
                ${primaryActionButton}
                <div class="relative shrink-0">
                    <button type="button" onclick="toggleBookCardMenu(event, '${book.id}')" class="w-9 h-9 border border-slate-200 hover:border-accord-blue bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-accord-blue rounded-xl flex items-center justify-center transition-all" title="More options" aria-label="More options">
                        <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
                    </button>
                    <div id="book-menu-${book.id}" onclick="event.stopPropagation()" class="book-card-menu hidden absolute right-0 bottom-11 w-44 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-30">
                        <button type="button" onclick="closeAllBookCardMenus(); toggleBookmark('${safeTitle}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-slate-50 transition-colors ${isBookmarked ? 'text-accord-gold' : 'text-accord-slate'}">
                            <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark w-3.5 text-center"></i>
                            <span>${isBookmarked ? 'Saved' : 'Save Book'}</span>
                        </button>
                        <button type="button" onclick="closeAllBookCardMenus(); sendBookToChat(${book.id})" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-accord-slate flex items-center gap-2.5 hover:bg-slate-50 transition-colors">
                            <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                            <span>Send to Chat</span>
                        </button>
                        <button type="button" onclick="closeAllBookCardMenus(); shareBookLink(${book.id}, '${safeTitle}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-accord-slate flex items-center gap-2.5 hover:bg-slate-50 transition-colors">
                            <i class="fa-solid fa-share-nodes w-3.5 text-center text-emerald-600"></i>
                            <span>Share Book</span>
                        </button>
                        <button type="button" onclick="closeAllBookCardMenus(); openBookModal(${book.id})" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-accord-slate flex items-center gap-2.5 hover:bg-slate-50 transition-colors border-t border-slate-100 mt-1 pt-2">
                            <i class="fa-solid fa-circle-info w-3.5 text-center text-slate-400"></i>
                            <span>View Details</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    return card;
}

function closeAllBookCardMenus() {
    document.querySelectorAll('.book-card-menu').forEach(el => el.classList.add('hidden'));
}

function toggleBookCardMenu(e, bookId) {
    e.stopPropagation();
    const menu = document.getElementById(`book-menu-${bookId}`);
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeAllBookCardMenus();
    if (isHidden) menu.classList.remove('hidden');
}

window.addEventListener('click', closeAllBookCardMenus);

function sendBookToChat(bookId) {
    const book = (typeof allBooks !== 'undefined' ? allBooks : []).find(b => String(b.id) === String(bookId));
    if (!book || typeof openShareToChatModal !== 'function') return;
    openShareToChatModal({
        type: 'shared_book',
        id: book.id,
        title: book.title,
        subtitle: (book.description || '').slice(0, 110),
        url: `${window.location.origin}/book.html?id=${encodeURIComponent(book.id)}`,
        image_url: book.cover_url || '',
        author_name: book.author || 'Accord Library'
    });
}

function stopBannerSliderInterval() {
    if (bannerSliderIntervalId) {
        clearInterval(bannerSliderIntervalId);
        bannerSliderIntervalId = null;
    }
}

function startBannerSliderInterval(totalSlides) {
    stopBannerSliderInterval();
    if (totalSlides <= 1) return;
    const intervalMs = Math.max(2, Number(bannerConfig.intervalSeconds) || 5) * 1000;
    bannerSliderIntervalId = setInterval(() => {
        nextBannerSlide(totalSlides, false);
    }, intervalMs);
}

function goToBannerSlide(index, totalSlides, resetTimer = true) {
    currentBannerSlideIndex = (index + totalSlides) % totalSlides;
    for (let i = 0; i < totalSlides; i++) {
        const slideEl = document.getElementById(`accord-banner-slide-${i}`);
        const dotEl = document.getElementById(`accord-banner-dot-${i}`);
        if (slideEl) {
            if (i === currentBannerSlideIndex) {
                slideEl.classList.remove('hidden', 'opacity-0');
                slideEl.classList.add('block', 'opacity-100');
            } else {
                slideEl.classList.remove('block', 'opacity-100');
                slideEl.classList.add('hidden', 'opacity-0');
            }
        }
        if (dotEl) {
            dotEl.className = i === currentBannerSlideIndex
                ? 'w-6 h-2 rounded-full bg-white shadow transition-all'
                : 'w-2 h-2 rounded-full bg-white/50 hover:bg-white/80 transition-all';
        }
    }
    if (resetTimer) {
        startBannerSliderInterval(totalSlides);
    }
}

function nextBannerSlide(totalSlides, resetTimer = true) {
    goToBannerSlide(currentBannerSlideIndex + 1, totalSlides, resetTimer);
}

function prevBannerSlide(totalSlides) {
    goToBannerSlide(currentBannerSlideIndex - 1, totalSlides, true);
}

async function renderMidGridBanner(showBanner) {
    const bannerEl = document.getElementById('mid-grid-banner');
    if (!bannerEl) return;

    stopBannerSliderInterval();

    if (typeof window.isAccordAdsEnabledForPage === 'function') {
        const adsAllowed = await window.isAccordAdsEnabledForPage('library');
        if (!adsAllowed) {
            bannerEl.classList.add('hidden');
            bannerEl.innerHTML = '';
            return;
        }
    }

    if (!showBanner || bannerConfig.enabled === false) {
        bannerEl.classList.add('hidden');
        bannerEl.innerHTML = '';
        return;
    }

    const activeSlides = Array.isArray(bannerConfig.slides)
        ? bannerConfig.slides.filter(s => s && s.enabled !== false && (s.desktopUrl || s.mobileUrl))
        : [];

    // 1. If Admin uploaded Image Banner Slides, render the Responsive Auto-Sliding Carousel
    if (activeSlides.length > 0) {
        currentBannerSlideIndex = 0;
        const total = activeSlides.length;

        const slidesHtml = activeSlides.map((slide, idx) => {
            const desktopSrc = slide.desktopUrl || slide.mobileUrl;
            const mobileSrc = slide.mobileUrl || slide.desktopUrl;
            const isFirst = idx === 0;
            const altText = escapeHTML(slide.alt || `Accord Promotional Banner ${idx + 1}`);

            const pictureMarkup = `
                <picture class="block w-full">
                    <source media="(max-width: 767px)" srcset="${escapeHTML(mobileSrc)}">
                    <img src="${escapeHTML(desktopSrc)}" alt="${altText}" class="w-full h-auto max-h-[420px] sm:max-h-[380px] object-cover rounded-3xl shadow-lg border border-slate-200/80" />
                </picture>
            `;

            let clickableWrapper = pictureMarkup;
            if (slide.actionType === 'contribute') {
                clickableWrapper = `<div onclick="openContributeModal()" class="cursor-pointer group relative overflow-hidden rounded-3xl">${pictureMarkup}</div>`;
            } else if (slide.actionType === 'forum') {
                clickableWrapper = `<a href="feed.html" class="block group relative overflow-hidden rounded-3xl">${pictureMarkup}</a>`;
            } else if (slide.linkUrl) {
                const isExternal = slide.linkUrl.startsWith('http');
                clickableWrapper = `<a href="${escapeHTML(slide.linkUrl)}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ''} class="block group relative overflow-hidden rounded-3xl">${pictureMarkup}</a>`;
            }

            return `
                <div id="accord-banner-slide-${idx}" class="banner-slide ${isFirst ? 'block opacity-100' : 'hidden opacity-0'} w-full">
                    ${clickableWrapper}
                </div>
            `;
        }).join('');

        const controlsHtml = total > 1 ? `
            <button type="button" onclick="prevBannerSlide(${total})" class="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-accord-slate/60 hover:bg-accord-slate text-white flex items-center justify-center backdrop-blur-sm transition-all shadow-md" aria-label="Previous banner">
                <i class="fa-solid fa-chevron-left text-xs"></i>
            </button>
            <button type="button" onclick="nextBannerSlide(${total}, true)" class="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-accord-slate/60 hover:bg-accord-slate text-white flex items-center justify-center backdrop-blur-sm transition-all shadow-md" aria-label="Next banner">
                <i class="fa-solid fa-chevron-right text-xs"></i>
            </button>
            <div class="absolute bottom-3.5 left-1/2 -translate-x-1/2 z-20 flex items-center space-x-2 bg-accord-slate/50 backdrop-blur-sm px-3 py-1.5 rounded-full">
                ${activeSlides.map((_, idx) => `
                    <button type="button" id="accord-banner-dot-${idx}" onclick="goToBannerSlide(${idx}, ${total}, true)" class="${idx === 0 ? 'w-6 h-2 rounded-full bg-white shadow transition-all' : 'w-2 h-2 rounded-full bg-white/50 hover:bg-white/80 transition-all'}" aria-label="Slide ${idx + 1}"></button>
                `).join('')}
            </div>
        ` : '';

        bannerEl.innerHTML = `
            <div class="relative w-full rounded-3xl overflow-hidden">
                ${slidesHtml}
                ${controlsHtml}
            </div>
        `;
        bannerEl.classList.remove('hidden');
        startBannerSliderInterval(total);
        return;
    }

    // 2. No uploaded slides: keep mid-grid-banner hidden (centralized dynamic banner ads in ads.js handle site-wide banners)
    bannerEl.classList.add('hidden');
    bannerEl.innerHTML = '';
}

function renderBooks() {
    const gridTop = document.getElementById('book-grid-top');
    const gridBottom = document.getElementById('book-grid-bottom');
    const countLabel = document.getElementById('publication-count');
    const emptyState = document.getElementById('empty-library-state');
    if (!gridTop || !gridBottom) return;

    renderCuratedShelves();

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

    gridTop.innerHTML = '';
    gridBottom.innerHTML = '';

    if (filtered.length === 0) {
        emptyState?.classList.remove('hidden');
        renderMidGridBanner(false);
        return;
    } else {
        emptyState?.classList.add('hidden');
    }

    const splitIndex = Math.max(1, Number(bannerConfig.afterCount) || 6);
    const topBooks = filtered.slice(0, splitIndex);
    const bottomBooks = filtered.slice(splitIndex);

    topBooks.forEach(book => gridTop.appendChild(buildBookCardElement(book)));
    renderMidGridBanner(filtered.length > splitIndex);
    const adChunkSize = 8;
    bottomBooks.forEach((book, idx) => {
        gridBottom.appendChild(buildBookCardElement(book));
        if ((idx + 1) % adChunkSize === 0 && idx < bottomBooks.length - 1) {
            const adSlot = document.createElement('div');
            adSlot.className = 'accord-library-inline-ad col-span-full my-3 hidden';
            adSlot.setAttribute('data-ad-chunk-index', String(Math.floor((idx + 1) / adChunkSize)));
            gridBottom.appendChild(adSlot);
        }
    });
    window.populateAccordLibraryInlineAds?.();
}

// ==========================================
// BOOK DETAIL ROUTING, BOOKMARKS & DOWNLOADS
// ==========================================

function checkSharedBookParam() {
    const params = new URLSearchParams(window.location.search);
    const sharedBookId = params.get('book');
    if (sharedBookId) {
        window.location.replace(`book.html?id=${encodeURIComponent(sharedBookId)}`);
    }
}

function openBookModal(bookId) {
    window.location.href = `book.html?id=${encodeURIComponent(bookId)}`;
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

    book.downloads = (Number(book.downloads) || 0) + 1;

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

    if (typeof window.launchAccordPaystackCheckout !== 'function') {
        showToast("Payment module is still loading. Please try again.");
        return;
    }

    window.launchAccordPaystackCheckout({
        email: currentUser.email,
        amount: Number(book.price) || 0,
        currency: 'GHS',
        metadata: { type: 'book_purchase', book_id: Number(book.id), user_id: currentUser.id },
        onVerified: async (tx) => {
            const { error } = await supabaseClient.from('user_purchases').insert([{
                user_id: currentUser.id,
                book_id: Number(book.id),
                amount_paid: Number(book.price) || 0,
                payment_reference: tx.reference,
                payment_provider: 'paystack',
                currency: tx.currency || 'GHS'
            }]);

            if (!error) {
                purchasedBookIds.push(Number(book.id));
                showToast(`Payment verified! "${book.title}" is now unlocked.`);
                renderBooks();
            } else {
                showToast(`Purchase notice: ${error.message}`);
            }
        },
        onError: (msg) => showToast(msg),
        onCancel: () => showToast("Checkout canceled.")
    });
}

async function shareBookLink(bookId, title) {
    const shareUrl = `${window.location.origin}/book.html?id=${bookId}`;
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop && navigator.share) {
        try { await navigator.share({ title, url: shareUrl }); return; } catch (err) {}
    }
    await navigator.clipboard.writeText(shareUrl);
    showToast("Book link copied to clipboard!");
}

// ==========================================
// CONTRIBUTE ARCHIVE SUBMISSION MODAL (WITH PDF UPLOAD)
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
    const fileInput = document.getElementById('sub-file');
    const selectedFile = fileInput?.files?.[0] || null;
    const submitBtn = document.getElementById('sub-submit-btn');

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = selectedFile ? 'Uploading manuscript...' : 'Submitting...';
    }

    let downloadUrl = '';
    if (selectedFile) {
        try {
            const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileName = `submissions/manuscript_${Date.now()}_${cleanName}`;
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('archive-files')
                .upload(fileName, selectedFile, { cacheControl: '3600', upsert: false });

            if (uploadError) throw uploadError;

            const { data: pubData } = supabaseClient.storage
                .from('archive-files')
                .getPublicUrl(uploadData.path);

            downloadUrl = pubData.publicUrl;
        } catch (err) {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Submit for Editorial Review';
            }
            showToast(`File upload failed: ${err.message}`);
            return;
        }
    }

    const finalDescription = downloadUrl
        ? `${description}\n\n[Attached Manuscript PDF: ${downloadUrl}]`
        : description;

    let { error } = await supabaseClient.from('submissions').insert([{
        name,
        email,
        title,
        category,
        description: finalDescription,
        download_url: downloadUrl
    }]);

    // Fallback if `submissions` table does not have a `download_url` column yet
    if (error && error.message && error.message.includes('download_url')) {
        const retry = await supabaseClient.from('submissions').insert([{
            name,
            email,
            title,
            category,
            description: finalDescription
        }]);
        error = retry.error;
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Submit for Editorial Review';
    }

    if (error) {
        showToast(`Submission failed: ${error.message}`);
        return;
    }

    document.getElementById('contribute-form').reset();
    const nameSpan = document.getElementById('sub-file-name');
    if (nameSpan) {
        nameSpan.innerText = 'Click to browse or drag PDF file here (Max 50MB)';
        nameSpan.classList.remove('text-accord-blue', 'font-bold');
    }
    closeContributeModal();
    showToast("Thank you! Your manuscript has been submitted for editorial review.");
}

// ==========================================
// AUTH MODAL & HELPERS (COMPLETE)
// ==========================================

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');

    if (!currentUser && typeof window.mountAccordGoogleSignIn === 'function') {
        window.mountAccordGoogleSignIn({
            containerId: 'google-gsi-container',
            fallbackBtnId: 'google-fallback-btn',
            fallbackLinkId: 'google-fallback-link',
            redirectTo: `${window.location.origin}/index.html`,
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
    document.getElementById('auth-terms-field')?.classList.toggle('hidden', !isSignup);
    const termsCheckbox = document.getElementById('auth-terms-checkbox');
    if (termsCheckbox) termsCheckbox.required = isSignup;
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
        await window.triggerAccordGoogleOAuthFallback(`${window.location.origin}/index.html`, (msg) => showToast(msg));
        return;
    }
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } }
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
        if (!document.getElementById('auth-terms-checkbox')?.checked) {
            showToast('You must accept the Terms of Service & Privacy Policy.');
            return;
        }
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    terms_accepted_at: new Date().toISOString(),
                    terms_version: '2026-11'
                },
                emailRedirectTo: `${window.location.origin}/signin.html`
            }
        });
        if (error) showToast(error.message);
        else if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            showToast('An account with this email already exists. Please sign in instead.');
            switchAuthMode('signin');
        } else {
            if (data?.session) {
                await window.ensureUserProfileRow?.(supabaseClient, data.user, fullName, '', true);
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