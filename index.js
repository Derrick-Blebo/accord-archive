// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let booksData = [];
let savedBookmarks = JSON.parse(localStorage.getItem('accord_bookmarks')) || [];
let currentCategory = 'All';
let currentUser = null;
let authMode = 'signin';

// Initialize App: Render cached books immediately, then fetch fresh data & auth in parallel
document.addEventListener('DOMContentLoaded', () => {
    updateBookmarkBadge();

    const cachedBooks = localStorage.getItem('accord_books_cache');
    if (cachedBooks) {
        try {
            booksData = JSON.parse(cachedBooks);
            applyInitialRender();
        } catch (e) {
            renderSkeletonCards();
        }
    } else {
        renderSkeletonCards();
    }

    loadBooksFromSupabase();
    initAuth();
});

function renderSkeletonCards() {
    const grid = document.getElementById('books-grid');
    if (!grid) return;
    grid.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5";
    grid.innerHTML = Array(6).fill(`
        <div class="bg-white border border-slate-200/90 rounded-3xl p-4 flex gap-4 animate-pulse">
            <div class="w-28 sm:w-32 shrink-0 space-y-2.5">
                <div class="h-44 rounded-2xl bg-slate-200"></div>
                <div class="flex gap-1.5">
                    <div class="h-8 bg-slate-200 rounded-xl flex-1"></div>
                    <div class="h-8 w-8 bg-slate-200 rounded-xl"></div>
                    <div class="h-8 w-8 bg-slate-200 rounded-xl"></div>
                </div>
            </div>
            <div class="flex-1 space-y-2.5 py-1">
                <div class="h-3 bg-slate-200 rounded w-1/2"></div>
                <div class="h-4 bg-slate-200 rounded w-5/6"></div>
                <div class="h-3 bg-slate-200 rounded w-1/3"></div>
                <div class="h-3 bg-slate-100 rounded w-full mt-2"></div>
                <div class="h-3 bg-slate-100 rounded w-4/5"></div>
            </div>
        </div>
    `).join('');
}

function applyInitialRender() {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedBookId = urlParams.get('book');

    if (sharedBookId) {
        const matchedBook = booksData.filter(b => String(b.id) === String(sharedBookId));
        if (matchedBook.length > 0) {
            renderBooks(matchedBook);
            return;
        }
    }
    renderBooks(booksData);
}

// Optional Auth Initialization & Session Listener
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    await syncUserState();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        await syncUserState();
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
        document.getElementById('profile-display-name').innerText = fullName;
        document.getElementById('profile-display-email').innerText = currentUser.email;

        const subName = document.getElementById('sub-name');
        const subEmail = document.getElementById('sub-email');
        if (subName && !subName.value) subName.value = fullName;
        if (subEmail && !subEmail.value) subEmail.value = currentUser.email;

        await mergeAndLoadCloudBookmarks();
    } else {
        if (navLabel) navLabel.innerText = 'Sign In';
        if (mobileLabel) mobileLabel.innerText = 'Sign In / Create Account';
        formsContainer?.classList.remove('hidden');
        profileContainer?.classList.add('hidden');

        savedBookmarks = JSON.parse(localStorage.getItem('accord_bookmarks')) || [];
        updateBookmarkBadge();
    }
}

async function mergeAndLoadCloudBookmarks() {
    if (!currentUser) return;

    if (savedBookmarks.length > 0) {
        const rows = savedBookmarks.map(title => ({
            user_id: currentUser.id,
            book_title: title
        }));
        await supabaseClient
            .from('user_bookmarks')
            .upsert(rows, { onConflict: 'user_id,book_title' });
    }

    const { data, error } = await supabaseClient
        .from('user_bookmarks')
        .select('book_title')
        .eq('user_id', currentUser.id);

    if (!error && data) {
        savedBookmarks = data.map(item => item.book_title);
        localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
        updateBookmarkBadge();
        if (booksData.length > 0) applyInitialRender();
    }
}

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

function switchAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';
    document.getElementById('auth-name-field').classList.toggle('hidden', !isSignup);
    document.getElementById('auth-name').required = isSignup;
    document.getElementById('auth-submit-btn').innerText = isSignup ? 'Create Free Account' : 'Sign In';

    document.getElementById('tab-signin').className = !isSignup
        ? 'py-2 text-xs font-bold rounded-lg bg-white text-accord-slate shadow-sm transition-all'
        : 'py-2 text-xs font-bold rounded-lg text-accord-muted hover:text-accord-slate transition-all';
    document.getElementById('tab-signup').className = isSignup
        ? 'py-2 text-xs font-bold rounded-lg bg-white text-accord-slate shadow-sm transition-all'
        : 'py-2 text-xs font-bold rounded-lg text-accord-muted hover:text-accord-slate transition-all';
}

async function handleGoogleSignIn() {
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin
        }
    });
    if (error) {
        showToast(error.message);
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const fullName = document.getElementById('auth-name').value.trim();
    const submitBtn = document.getElementById('auth-submit-btn');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Please wait...';

    if (authMode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } }
        });
        if (error) {
            showToast(error.message);
        } else if (data.session) {
            showToast(`Welcome to Accord, ${fullName || 'Reader'}!`);
            closeAuthModal();
        } else {
            showToast('Account created! Check your email to confirm.');
            closeAuthModal();
        }
    } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
            showToast(error.message);
        } else {
            showToast('Signed in successfully!');
            closeAuthModal();
        }
    }

    submitBtn.disabled = false;
    switchAuthMode(authMode);
}

async function handleSignOut() {
    await supabaseClient.auth.signOut();
    localStorage.removeItem('accord_bookmarks');
    savedBookmarks = [];
    updateBookmarkBadge();
    if (booksData.length > 0) applyInitialRender();
    closeAuthModal();
    showToast('Signed out.');
}

async function loadBooksFromSupabase() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('id, title, author, category, year, pages, description, cover_url, download_url, gradient')
        .is('deleted_at', null)
        .eq('is_visible', true)
        .order('created_at', { ascending: false });

    if (!error && data) {
        booksData = data;
        try {
            localStorage.setItem('accord_books_cache', JSON.stringify(data));
        } catch (e) {
            // Ignore storage quota errors if cover images are large
        }
        applyInitialRender();
    }
}

function renderBooks(filteredList) {
    const grid = document.getElementById('books-grid');
    const emptyState = document.getElementById('empty-state');

    grid.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5";
    grid.innerHTML = '';

    if (filteredList.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    filteredList.forEach(book => {
        const isBookmarked = savedBookmarks.includes(book.title);
        const safeTitle = book.title.replace(/'/g, "\\'");
        const safeAuthor = (book.author || '').replace(/'/g, "\\'");

        const coverVisual = book.cover_url
            ? `<div class="w-full h-48 sm:h-full min-h-[195px] rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm relative bg-slate-100">
                   <img src="${book.cover_url}" alt="${book.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
               </div>`
            : `<div class="w-full h-48 sm:h-full min-h-[195px] rounded-2xl bg-gradient-to-br ${book.gradient || 'from-amber-900 via-orange-900 to-stone-950'} p-3.5 flex flex-col justify-between text-white shadow-sm relative overflow-hidden">
                   <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px]"></div>
                   <div class="relative z-10">
                       <p class="text-[7px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                       <h4 class="serif-heading text-xs font-bold mt-1.5 leading-snug line-clamp-4">${book.title}</h4>
                   </div>
                   <div class="relative z-10 text-[9px] text-slate-200/90 truncate">
                       ${book.author}
                   </div>
               </div>`;

        const isSupabaseFile = book.download_url && book.download_url.includes('/archive-files/');
        const downloadButton = book.download_url
            ? `<a href="${book.download_url}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-[11px] font-bold px-3 rounded-xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center space-x-1.5">
                   <i class="fa-solid fa-download text-[10px]"></i>
                   <span>Download</span>
               </a>`
            : `<button onclick="triggerSimulatedDownload()" class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-[11px] font-bold px-3 rounded-xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center space-x-1.5">
                   <i class="fa-solid fa-download text-[10px]"></i>
                   <span>Download</span>
               </button>`;

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-4 shadow-sm hover:shadow-lg transition-all duration-300 flex gap-4 items-stretch group";
        card.innerHTML = `
            <!-- Left Column: Full-Height Book Cover -->
            <div class="w-28 sm:w-32 shrink-0">
                ${coverVisual}
            </div>

            <!-- Right Column: Metadata, Description & Unified Action Row -->
            <div class="flex-1 flex flex-col justify-between min-w-0">
                <div>
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                        <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2 py-0.5 rounded-md truncate">
                            ${book.category || 'Archive'}
                        </span>
                        ${book.year ? `<span class="text-[10px] font-semibold text-accord-muted shrink-0">${book.year}</span>` : ''}
                    </div>

                    <h3 class="font-bold text-accord-slate text-sm sm:text-[15px] leading-snug mb-1 line-clamp-2 group-hover:text-accord-blue transition-colors">
                        ${book.title}
                    </h3>

                    <p class="text-[11px] font-bold text-accord-slate mb-1.5 truncate">
                        ${book.author}
                    </p>

                    <p class="text-[11px] text-accord-muted leading-relaxed line-clamp-3 mb-3">
                        ${book.description || ''}
                    </p>
                </div>

                <!-- Unified Bottom Action Row: Download + Bookmark + Copy -->
                <div class="flex items-center gap-1.5">
                    ${downloadButton}
                    <button onclick="toggleBookmark(this, '${safeTitle}')" class="w-9 h-9 shrink-0 border ${isBookmarked ? 'text-accord-gold border-accord-gold bg-amber-50' : 'border-slate-200 text-accord-slate hover:border-accord-blue'} rounded-xl flex items-center justify-center transition-all" title="Save Bookmark">
                        <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark text-[11px]"></i>
                    </button>
                    <button onclick="shareBook('${book.id}', '${safeTitle}', '${safeAuthor}')" class="w-9 h-9 shrink-0 border border-slate-200 text-accord-slate hover:border-accord-blue hover:text-accord-blue rounded-xl flex items-center justify-center transition-all" title="Copy Book Link">
                        <i class="fa-solid fa-share-nodes text-[11px] md:hidden"></i>
                        <i class="fa-regular fa-copy text-[11px] hidden md:inline"></i>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Share Book Handler (Mobile: Native Share Sheet | PC: Copy Direct Book Link)
async function shareBook(id, title, author) {
    const shareUrl = `${window.location.origin}/?book=${id}`;
    const isDesktop = window.innerWidth >= 768;

    if (!isDesktop && navigator.share) {
        const shareText = `Check out "${title}" by ${author} on Accord Digital Library.`;
        try {
            await navigator.share({ title, text: shareText, url: shareUrl });
        } catch (err) {
            // User cancelled share dialog
        }
    } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Book link copied to clipboard!");
    }
}

// Category Filter
function setCategory(category) {
    currentCategory = category;
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.className = "category-btn whitespace-nowrap px-4 py-3 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
    });
    const activeBtn = document.getElementById(`cat-btn-${category}`);
    if (activeBtn) {
        activeBtn.className = "category-btn whitespace-nowrap px-4 py-3 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-md shadow-blue-500/20";
    }
    filterBooks();
}

function filterBooks() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const filtered = booksData.filter(book => {
        const matchesCategory = currentCategory === 'All' || book.category === currentCategory;
        const matchesQuery = book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query) || book.description.toLowerCase().includes(query);
        return matchesCategory && matchesQuery;
    });
    renderBooks(filtered);
}

function resetFilters() {
    document.getElementById('search-input').value = '';
    if (window.location.search) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    setCategory('All');
}

function triggerSimulatedDownload() {
    showToast("This archive item does not have a PDF attached yet.");
}

async function toggleBookmark(btn, title) {
    const index = savedBookmarks.indexOf(title);
    const icon = btn.querySelector('i');
    if (index > -1) {
        savedBookmarks.splice(index, 1);
        icon.className = "fa-regular fa-bookmark text-[11px]";
        btn.classList.remove('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
        showToast("Removed from Saved Books.");
        if (currentUser) {
            await supabaseClient.from('user_bookmarks').delete().eq('user_id', currentUser.id).eq('book_title', title);
        }
    } else {
        savedBookmarks.push(title);
        icon.className = "fa-solid fa-bookmark text-[11px]";
        btn.classList.add('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
        showToast("Added to Saved Books!");
        if (currentUser) {
            await supabaseClient.from('user_bookmarks').upsert({ user_id: currentUser.id, book_title: title });
        }
    }
    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
    updateBookmarkBadge();
}

function updateBookmarkBadge() {
    document.getElementById('bookmark-badge').innerText = savedBookmarks.length;
    document.getElementById('mobile-bookmark-count').innerText = savedBookmarks.length;
}

// Community Submission Form -> Saves Directly to Supabase
async function handleFormSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('sub-name').value;
    const email = document.getElementById('sub-email').value;
    const title = document.getElementById('sub-title').value;
    const category = document.getElementById('sub-category').value;
    const description = document.getElementById('sub-desc').value;

    const { error } = await supabaseClient
        .from('submissions')
        .insert([{ name, email, title, category, description }]);

    if (!error) {
        showToast(`Thank you, ${name}! Your manuscript "${title}" has been submitted for archive review.`);
        document.getElementById('contribution-form').reset();
    } else {
        showToast("Error submitting manuscript. Please try again.");
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
}