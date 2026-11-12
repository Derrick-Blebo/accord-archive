// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let booksData = [];
let savedBookmarks = JSON.parse(localStorage.getItem('accord_bookmarks')) || [];
let currentCategory = 'All';

// Initialize App & Load Live Catalog from Supabase
window.onload = async function() {
    updateBookmarkBadge();
    await loadBooksFromSupabase();
};

async function loadBooksFromSupabase() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('*')
        .order('created_at', { ascending: false });

    if (!error && data) {
        booksData = data;

        // Check if visitor opened a direct shared ?book=ID link
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
}

function renderBooks(filteredList) {
    const grid = document.getElementById('books-grid');
    const emptyState = document.getElementById('empty-state');
    
    // 1 column on mobile, 2 on tablets/laptops and wide screens
    grid.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6";
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

        // Full-height left cover image
        const coverVisual = book.cover_url
            ? `<div class="w-full h-56 sm:h-full min-h-[210px] rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm relative bg-slate-100">
                   <img src="${book.cover_url}" alt="${book.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
               </div>`
            : `<div class="w-full h-56 sm:h-full min-h-[210px] rounded-2xl bg-gradient-to-br ${book.gradient || 'from-amber-900 via-orange-900 to-stone-950'} p-4 flex flex-col justify-between text-white shadow-sm relative overflow-hidden">
                   <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px]"></div>
                   <div class="relative z-10">
                       <p class="text-[8px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                       <h4 class="serif-heading text-sm font-bold mt-2 leading-snug line-clamp-4">${book.title}</h4>
                   </div>
                   <div class="relative z-10 text-[10px] text-slate-200/90 truncate">
                       ${book.author}
                   </div>
               </div>`;

        // Pill-shaped Download button matching the mockup
        const downloadButton = book.download_url
            ? `<a href="${book.download_url}" download class="flex-1 h-10 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 rounded-2xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center space-x-2">
                   <i class="fa-solid fa-download text-xs"></i>
                   <span>Download</span>
               </a>`
            : `<button onclick="triggerSimulatedDownload()" class="flex-1 h-10 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 rounded-2xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center space-x-2">
                   <i class="fa-solid fa-download text-xs"></i>
                   <span>Download</span>
               </button>`;

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col sm:flex-row gap-5 items-stretch group";
        card.innerHTML = `
            <!-- Left Column: Full-Height Book Cover -->
            <div class="w-full sm:w-36 md:w-40 shrink-0">
                ${coverVisual}
            </div>

            <!-- Right Column: Title, Author + (Pub Date), Description, and Bottom Action Row -->
            <div class="flex-1 flex flex-col justify-between min-w-0">
                <div>
                    <h3 class="font-bold text-accord-slate text-base sm:text-[17px] leading-snug mb-1.5 line-clamp-3 group-hover:text-accord-blue transition-colors">
                        ${book.title}
                    </h3>

                    <p class="text-xs font-bold text-accord-slate mb-2.5">
                        ${book.author} ${book.year ? `<span class="font-semibold text-accord-muted ml-1">(${book.year})</span>` : ''}
                    </p>

                    <p class="text-xs text-accord-muted leading-relaxed line-clamp-4 mb-4">
                        ${book.description || ''}
                    </p>
                </div>

                <!-- Bottom Action Row: Download Pill + Bookmark + Share -->
                <div class="flex items-center gap-2 pt-1">
                    ${downloadButton}
                    <button onclick="toggleBookmark(this, '${safeTitle}')" class="w-10 h-10 shrink-0 border ${isBookmarked ? 'text-accord-gold border-accord-gold bg-amber-50' : 'border-slate-200 text-accord-slate hover:border-accord-blue'} rounded-2xl flex items-center justify-center transition-all" title="Save Bookmark">
                        <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark text-xs"></i>
                    </button>
                    <button onclick="shareBook('${book.id}', '${safeTitle}', '${safeAuthor}')" class="w-10 h-10 shrink-0 border border-slate-200 text-accord-slate hover:border-accord-blue hover:text-accord-blue rounded-2xl flex items-center justify-center transition-all" title="Share Book">
                        <i class="fa-solid fa-share-nodes text-xs"></i>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Share Book Handler (Shares Direct Book Link via Native Share Sheet or Clipboard)
async function shareBook(id, title, author) {
    const shareUrl = `${window.location.origin}/?book=${id}`;
    const shareText = `Check out "${title}" by ${author} on Accord Digital Library.`;

    if (navigator.share) {
        try {
            await navigator.share({ title, text: shareText, url: shareUrl });
        } catch (err) {
            // User cancelled share dialog
        }
    } else {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
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

function toggleBookmark(btn, title) {
    const index = savedBookmarks.indexOf(title);
    const icon = btn.querySelector('i');
    if (index > -1) {
        savedBookmarks.splice(index, 1);
        icon.className = "fa-regular fa-bookmark text-xs";
        btn.classList.remove('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
        showToast("Removed from saved reading list.");
    } else {
        savedBookmarks.push(title);
        icon.className = "fa-solid fa-bookmark text-xs";
        btn.classList.add('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
        showToast("Book saved to your reading list!");
    }
    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
    updateBookmarkBadge();
}

function updateBookmarkBadge() {
    document.getElementById('bookmark-badge').innerText = savedBookmarks.length;
    document.getElementById('mobile-bookmark-count').innerText = savedBookmarks.length;
}

function openBookmarksModal() {
    const listContainer = document.getElementById('bookmarks-list');
    listContainer.innerHTML = '';

    if (savedBookmarks.length === 0) {
        listContainer.innerHTML = `<p class="text-sm text-accord-muted text-center py-8">No saved books yet. Click the bookmark icon on any book to save it for later.</p>`;
    } else {
        savedBookmarks.forEach(title => {
            const safeTitle = title.replace(/'/g, "\\'");
            const item = document.createElement('div');
            item.className = "flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200";
            item.innerHTML = `
                <span class="text-sm font-bold text-accord-slate">${title}</span>
                <button onclick="removeBookmark('${safeTitle}')" class="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1"><i class="fa-solid fa-trash"></i></button>
            `;
            listContainer.appendChild(item);
        });
    }

    const modal = document.getElementById('bookmarks-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeBookmarksModal() {
    const modal = document.getElementById('bookmarks-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    renderBooks(booksData);
}

function removeBookmark(title) {
    savedBookmarks = savedBookmarks.filter(t => t !== title);
    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
    updateBookmarkBadge();
    openBookmarksModal();
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