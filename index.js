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
        renderBooks(booksData);
    }
}

// Render Books to Grid (No Page Numbers, Clean Multi-Line Category Corners & Book Covers)
function renderBooks(filteredList) {
    const grid = document.getElementById('books-grid');
    const emptyState = document.getElementById('empty-state');
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

        const downloadAction = book.download_url
            ? `onclick="window.open('${book.download_url}', '_blank')"`
            : `onclick="triggerSimulatedDownload()"`;

        // Render Uploaded Book Cover or Styled Gradient Fallback (Without Page Count)
        const coverVisual = book.cover_url
            ? `<div class="h-44 rounded-2xl overflow-hidden shadow-md relative group-hover:scale-[1.02] transition-transform bg-slate-100">
                   <img src="${book.cover_url}" alt="${book.title}" class="w-full h-full object-cover" />
               </div>`
            : `<div class="h-44 rounded-2xl bg-gradient-to-br ${book.gradient || 'from-blue-900 via-blue-800 to-indigo-950'} p-5 flex flex-col justify-between text-white shadow-md relative overflow-hidden group-hover:scale-[1.02] transition-transform">
                   <div class="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:14px_14px]"></div>
                   <div>
                       <p class="text-[9px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                       <h4 class="serif-heading text-lg font-bold mt-1 leading-snug line-clamp-2">${book.title}</h4>
                   </div>
                   <div class="flex items-center justify-between text-xs text-slate-300">
                       <span>${book.author}</span>
                   </div>
               </div>`;

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between group";
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between gap-2 mb-4">
                    <span class="bg-accord-lightBlue text-accord-blue font-bold text-[11px] px-2.5 py-1 rounded-md uppercase tracking-wider leading-tight">${book.category}</span>
                    <span class="text-xs font-semibold text-accord-muted shrink-0">Pub. ${book.year}</span>
                </div>

                ${coverVisual}

                <div class="mt-4 space-y-2">
                    <h3 class="font-bold text-accord-slate text-base group-hover:text-accord-blue transition-colors">${book.title}</h3>
                    <p class="text-xs text-accord-muted line-clamp-2">${book.description}</p>
                </div>
            </div>

            <div class="flex items-center space-x-3 pt-6 mt-4 border-t border-slate-100">
                <button ${downloadAction} class="flex-1 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-md shadow-blue-500/20 flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-download"></i>
                    <span>Download</span>
                </button>
                <button onclick="toggleBookmark(this, '${safeTitle}')" class="p-2.5 border border-slate-200 hover:border-accord-blue ${isBookmarked ? 'text-accord-gold border-accord-gold bg-amber-50' : 'text-accord-slate'} rounded-xl transition-all">
                    <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
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
        icon.className = "fa-regular fa-bookmark";
        btn.classList.remove('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
        showToast("Removed from saved reading list.");
    } else {
        savedBookmarks.push(title);
        icon.className = "fa-solid fa-bookmark";
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