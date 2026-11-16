// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allBooks = [];
let savedBookmarks = [];
let purchasedBookIds = [];
let currentUser = null;
let authMode = 'signin';

window.onload = async function() {
    updateBookmarkBadge();
    await initAuth();
    await loadSavedBooksPage();
};

async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    await syncUserState();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        await syncUserState();
        if (allBooks.length > 0) {
            renderSavedBooks();
        }
    });
}

async function syncUserState() {
    const navLabel = document.getElementById('auth-nav-label');
    const formsContainer = document.getElementById('auth-forms-container');
    const profileContainer = document.getElementById('auth-profile-container');
    const syncText = document.getElementById('sync-status-text');

    if (currentUser) {
        const fullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
        if (navLabel) navLabel.innerText = fullName;
        if (syncText) syncText.innerHTML = `Synced with <strong class="text-accord-slate">${currentUser.email}</strong>`;

        formsContainer?.classList.add('hidden');
        profileContainer?.classList.remove('hidden');
        document.getElementById('profile-display-name').innerText = fullName;
        document.getElementById('profile-display-email').innerText = currentUser.email;

        const { data, error } = await supabaseClient
            .from('user_bookmarks')
            .select('book_title')
            .eq('user_id', currentUser.id);

        if (!error && data) {
            savedBookmarks = data.map(item => item.book_title);
            localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
            updateBookmarkBadge();
        }

        const { data: purchases, error: purchaseErr } = await supabaseClient
            .from('user_purchases')
            .select('book_id')
            .eq('user_id', currentUser.id);

        if (!purchaseErr && purchases) {
            purchasedBookIds = purchases.map(p => Number(p.book_id));
        }
    } else {
        if (navLabel) navLabel.innerText = 'Sign In';
        if (syncText) syncText.innerHTML = `Sign in required • <button onclick="openAuthModal()" class="text-accord-blue font-bold hover:underline">Sign In</button>`;
        formsContainer?.classList.remove('hidden');
        profileContainer?.classList.add('hidden');

        savedBookmarks = [];
        purchasedBookIds = [];
        localStorage.removeItem('accord_bookmarks');
        updateBookmarkBadge();
    }
}

async function loadSavedBooksPage() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('*')
        .is('deleted_at', null)
        .eq('is_visible', true)
        .order('created_at', { ascending: false });

    document.getElementById('saved-loading').classList.add('hidden');

    if (!error && data) {
        allBooks = data;
        renderSavedBooks();
    }
}

function trackDownload(bookId) {
    supabaseClient.rpc('increment_book_download', { book_id: Number(bookId) });
}

function renderSavedBooks() {
    const grid = document.getElementById('saved-books-grid');
    const emptyState = document.getElementById('saved-empty-state');
    const subtitle = document.getElementById('saved-subtitle');

    const matchedBooks = allBooks.filter(book => savedBookmarks.includes(book.title));
    updateBookmarkBadge();

    if (subtitle) {
        if (!currentUser) {
            subtitle.innerText = 'Sign in to view and manage your bookmarked publications.';
        } else {
            subtitle.innerText = matchedBooks.length === 1
                ? 'You have 1 saved publication in your library.'
                : `You have ${matchedBooks.length} saved publications in your library.`;
        }
    }

    grid.innerHTML = '';

    if (!currentUser) {
        document.getElementById('empty-state-title').innerText = 'Sign In to View Saved Books';
        document.getElementById('empty-state-desc').innerText = 'Create a free account or sign in with Google to save books and access your reading list across devices.';
        document.getElementById('empty-state-actions').innerHTML = `
            <button onclick="openAuthModal()" class="inline-flex items-center space-x-2 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-6 py-3.5 rounded-xl shadow-md shadow-blue-500/20 transition-all">
                <i class="fa-regular fa-user"></i>
                <span>Sign In / Create Account</span>
            </button>
        `;
        emptyState.classList.remove('hidden');
        return;
    }

    if (matchedBooks.length === 0) {
        document.getElementById('empty-state-title').innerText = 'No Saved Books Yet';
        document.getElementById('empty-state-desc').innerText = 'Click the bookmark icon on any publication in the Digital Library to save it here for quick reading and downloading.';
        document.getElementById('empty-state-actions').innerHTML = `
            <a href="index.html#library" class="inline-flex items-center space-x-2 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-6 py-3.5 rounded-xl shadow-md shadow-blue-500/20 transition-all">
                <i class="fa-solid fa-book-open"></i>
                <span>Browse Digital Library</span>
            </a>
        `;
        emptyState.classList.remove('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    matchedBooks.forEach(book => {
        const isPurchased = purchasedBookIds.includes(Number(book.id));
        const safeTitle = book.title.replace(/'/g, "\\'");
        const safeAuthor = (book.author || '').replace(/'/g, "\\'");

        const coverVisual = book.cover_url
            ? `<div class="w-full h-56 sm:h-48 rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm relative bg-slate-100">
                   <img src="${book.cover_url}" alt="${book.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
               </div>`
            : `<div class="w-full h-56 sm:h-48 rounded-2xl bg-gradient-to-br ${book.gradient || 'from-amber-900 via-orange-900 to-stone-950'} p-4 flex flex-col justify-between text-white shadow-sm relative overflow-hidden">
                   <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px]"></div>
                   <div class="relative z-10">
                       <p class="text-[8px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                       <h4 class="serif-heading text-sm font-bold mt-1.5 leading-snug line-clamp-3">${book.title}</h4>
                   </div>
                   <div class="relative z-10 text-[10px] text-slate-200/90 truncate">
                       ${book.author}
                   </div>
               </div>`;

        const isSupabaseFile = book.download_url && book.download_url.includes('/archive-files/');
        const cleanReadUrl = book.download_url
            ? (isSupabaseFile ? book.download_url.split('?')[0] : book.download_url)
            : '';

        const priceLine = (book.is_for_sale && !isPurchased)
            ? `<p class="text-xs font-extrabold text-accord-blue mb-3">USD ${Number(book.price || 0).toFixed(2)}</p>`
            : '';

        let primaryActionButton = '';
        if (book.is_for_sale && !isPurchased) {
            primaryActionButton = `<a href="index.html?book=${book.id}#library" class="flex-1 sm:flex-initial sm:px-6 h-10 bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold px-5 rounded-full transition-all shadow-sm shadow-amber-500/20 flex items-center justify-center space-x-2">
                   <i class="fa-solid fa-cart-shopping text-xs"></i>
                   <span>Buy Now</span>
               </a>`;
        } else if (book.is_for_sale && isPurchased) {
            primaryActionButton = cleanReadUrl
                ? `<a href="${cleanReadUrl}" target="_blank" rel="noopener noreferrer" class="flex-1 sm:flex-initial sm:px-6 h-10 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 rounded-full transition-all shadow-sm shadow-emerald-500/20 flex items-center justify-center space-x-2">
                       <i class="fa-solid fa-book-open-reader text-xs"></i>
                       <span>Read</span>
                   </a>`
                : `<button onclick="showToast('PDF file is being prepared for reading.')" class="flex-1 sm:flex-initial sm:px-6 h-10 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 rounded-full transition-all shadow-sm flex items-center justify-center space-x-2">
                       <i class="fa-solid fa-book-open-reader text-xs"></i>
                       <span>Read</span>
                   </button>`;
        } else {
            primaryActionButton = book.download_url
                ? `<a href="${book.download_url}" onclick="trackDownload('${book.id}')" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} class="flex-1 sm:flex-initial sm:px-6 h-10 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 rounded-2xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center space-x-2">
                       <i class="fa-solid fa-download text-xs"></i>
                       <span>Download</span>
                   </a>`
                : `<button onclick="showToast('This archive item does not have a PDF attached yet.')" class="flex-1 sm:flex-initial sm:px-6 h-10 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 rounded-2xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center space-x-2">
                       <i class="fa-solid fa-download text-xs"></i>
                       <span>Download</span>
                   </button>`;
        }

        const metaBadges = `
            <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
                ${book.category ? `<span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-0.5 rounded-md">${book.category}</span>` : ''}
                ${book.pages && book.pages !== 'TBD' ? `<span class="bg-slate-100 text-accord-muted text-[10px] font-semibold px-2 py-0.5 rounded-md">${book.pages} pages</span>` : ''}
            </div>
        `;

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-4 sm:p-5 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col sm:flex-row gap-5 items-center group";
        card.innerHTML = `
            <!-- Left Column: Compact Book Cover -->
            <div class="w-full sm:w-36 shrink-0">
                ${coverVisual}
            </div>

            <!-- Right Column: Wide Content & Action Row -->
            <div class="flex-1 flex flex-col justify-between min-w-0 w-full">
                <div>
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-1">
                        <h3 class="font-bold text-accord-slate text-base sm:text-lg leading-snug truncate group-hover:text-accord-blue transition-colors">
                            ${book.title}
                        </h3>
                        ${metaBadges}
                    </div>

                    <p class="text-xs font-bold text-accord-slate mb-2">
                        ${book.author} ${book.year ? `<span class="font-semibold text-accord-muted ml-1">(${book.year})</span>` : ''}
                    </p>

                    <p class="text-xs text-accord-muted leading-relaxed line-clamp-2 mb-2.5">
                        ${book.description || ''}
                    </p>

                    ${priceLine}
                </div>

                <!-- Bottom Action Row -->
                <div class="flex items-center gap-2">
                    ${primaryActionButton}
                    <button onclick="shareBook('${book.id}', '${safeTitle}', '${safeAuthor}')" class="w-10 h-10 shrink-0 border border-slate-200 text-accord-slate hover:border-accord-blue hover:text-accord-blue rounded-2xl flex items-center justify-center transition-all" title="Copy Book Link">
                        <i class="fa-solid fa-share-nodes text-xs md:hidden"></i>
                        <i class="fa-regular fa-copy text-xs hidden md:inline"></i>
                    </button>
                    <button onclick="removeSavedBook('${safeTitle}')" class="w-10 h-10 shrink-0 border border-red-200 bg-red-50/70 hover:bg-red-100 text-red-500 rounded-2xl flex items-center justify-center transition-all" title="Remove from Saved Books">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function removeSavedBook(title) {
    savedBookmarks = savedBookmarks.filter(t => t !== title);
    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));

    if (currentUser) {
        await supabaseClient
            .from('user_bookmarks')
            .delete()
            .eq('user_id', currentUser.id)
            .eq('book_title', title);
    }

    renderSavedBooks();
    showToast("Removed from Saved Books.");
}

async function shareBook(id, title, author) {
    const shareUrl = `${window.location.origin}/?book=${id}`;
    const isDesktop = window.innerWidth >= 768;

    if (!isDesktop && navigator.share) {
        const shareText = `Check out "${title}" by ${author} on Accord Digital Library.`;
        try {
            await navigator.share({ title, text: shareText, url: shareUrl });
        } catch (err) {}
    } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Book link copied to clipboard!");
    }
}

function updateBookmarkBadge() {
    const badge = document.getElementById('bookmark-badge');
    if (badge) badge.innerText = savedBookmarks.length;
}

// Auth Modal Helpers
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
        options: { redirectTo: `${window.location.origin}/saved.html` }
    });
    if (error) showToast(error.message);
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

    submitBtn.disabled = false;
    switchAuthMode(authMode);
}

async function handleSignOut() {
    await supabaseClient.auth.signOut();
    localStorage.removeItem('accord_bookmarks');
    savedBookmarks = [];
    purchasedBookIds = [];
    renderSavedBooks();
    closeAuthModal();
    showToast('Signed out.');
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