const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

let currentUser = null;
let allBooks = [];
let allTestimonies = [];
let savedBookmarks = [];
let savedTestimonyIds = [];
let purchasedBookIds = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    if (!currentUser) {
        document.getElementById('saved-loading').classList.add('hidden');
        document.getElementById('saved-content-container').classList.add('hidden');
        document.getElementById('saved-empty-state').classList.remove('hidden');
        document.getElementById('empty-state-title').innerText = 'Sign In Required';
        document.getElementById('empty-state-desc').innerText = 'Please sign in to view your saved books and testimonies across devices.';
        const actionsEl = document.getElementById('empty-state-actions');
        if (actionsEl) {
            actionsEl.innerHTML = `
                <a href="signin.html?next=saved.html" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-5 py-3 rounded-xl shadow-md transition-all">Sign In</a>
                <a href="index.html#library" class="bg-slate-100 hover:bg-slate-200 text-accord-slate text-xs font-bold px-5 py-3 rounded-xl transition-all">Browse Digital Library</a>
            `;
        }
        return;
    }

    await loadSavedData();
});

async function loadSavedData() {
    const [booksRes, testimoniesRes, bookmarksRes, testimonyBookmarksRes, purchasesRes] = await Promise.all([
        supabaseClient.from('books').select('*').is('deleted_at', null).eq('is_visible', true),
        supabaseClient.from('testimonies').select('*').eq('is_approved', true),
        supabaseClient.from('user_bookmarks').select('book_title').eq('user_id', currentUser.id),
        supabaseClient.from('user_testimony_bookmarks').select('testimony_id').eq('user_id', currentUser.id),
        supabaseClient.from('user_purchases').select('book_id').eq('user_id', currentUser.id)
    ]);

    document.getElementById('saved-loading').classList.add('hidden');

    allBooks = booksRes.data || [];
    allTestimonies = testimoniesRes.data || [];
    savedBookmarks = bookmarksRes.data ? bookmarksRes.data.map(b => b.book_title) : [];
    savedTestimonyIds = testimonyBookmarksRes.data ? testimonyBookmarksRes.data.map(t => Number(t.testimony_id)) : [];
    purchasedBookIds = purchasesRes.data ? purchasesRes.data.map(p => Number(p.book_id)) : [];

    renderSavedPages();
}

function setSavedFilter(filter) {
    currentFilter = filter;
    ['all', 'books', 'testimonies'].forEach(f => {
        const btn = document.getElementById(`sfilter-${f}`);
        if (btn) {
            btn.className = f === filter
                ? "px-4 py-2 rounded-xl text-xs font-bold transition-all bg-accord-slate text-white shadow-sm"
                : "px-4 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
        }
    });
    renderSavedPages();
}

function renderSavedPages() {
    const booksGrid = document.getElementById('saved-books-grid');
    const testimoniesGrid = document.getElementById('saved-testimonies-grid');
    const booksSection = document.getElementById('saved-books-section');
    const testimoniesSection = document.getElementById('saved-testimonies-section');
    const emptyState = document.getElementById('saved-empty-state');
    const subtitle = document.getElementById('saved-subtitle');

    booksGrid.innerHTML = '';
    testimoniesGrid.innerHTML = '';

    const matchedBooks = allBooks.filter(b => savedBookmarks.includes(b.title));
    const matchedTestimonies = allTestimonies.filter(t => savedTestimonyIds.includes(Number(t.id)));

    if (subtitle) {
        subtitle.innerText = `You have ${matchedBooks.length} saved publication(s) and ${matchedTestimonies.length} saved testimony(ies).`;
    }

    const showBooks = currentFilter === 'all' || currentFilter === 'books';
    const showTestimonies = currentFilter === 'all' || currentFilter === 'testimonies';

    booksSection.style.display = showBooks && matchedBooks.length > 0 ? 'block' : 'none';
    testimoniesSection.style.display = showTestimonies && matchedTestimonies.length > 0 ? 'block' : 'none';

    if ((showBooks && matchedBooks.length > 0) || (showTestimonies && matchedTestimonies.length > 0)) {
        emptyState.classList.add('hidden');
    } else {
        emptyState.classList.remove('hidden');
    }

    // Render Saved Books using original home page card design
    if (showBooks) {
        matchedBooks.forEach(book => {
            const isPurchased = purchasedBookIds.includes(Number(book.id));
            const safeTitle = book.title.replace(/'/g, "\\'");
            const safeAuthor = (book.author || '').replace(/'/g, "\\'");

            const coverVisual = book.cover_url
                ? `<div class="w-full h-48 sm:h-full min-h-[195px] rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm relative bg-slate-100">
                       <img src="${book.cover_url}" alt="${escapeHTML(book.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                   </div>`
                : `<div class="w-full h-48 sm:h-full min-h-[195px] rounded-2xl bg-gradient-to-br ${book.gradient || 'from-amber-900 via-orange-900 to-stone-950'} p-3.5 flex flex-col justify-between text-white shadow-sm relative overflow-hidden">
                       <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px]"></div>
                       <div class="relative z-10">
                           <p class="text-[7px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                           <h4 class="serif-heading text-xs font-bold mt-1.5 leading-snug line-clamp-4">${escapeHTML(book.title)}</h4>
                       </div>
                       <div class="relative z-10 text-[9px] text-slate-200/90 truncate">${escapeHTML(book.author)}</div>
                   </div>`;

            const isSupabaseFile = book.download_url && book.download_url.includes('/archive-files/');
            const cleanReadUrl = book.download_url ? (isSupabaseFile ? book.download_url.split('?')[0] : book.download_url) : '';

            const priceLine = (book.is_for_sale && !isPurchased)
                ? `<p class="text-xs font-extrabold text-accord-blue mb-2.5">USD ${Number(book.price || 0).toFixed(2)}</p>`
                : '';

            let primaryActionButton = '';
            if (book.is_for_sale && !isPurchased) {
                primaryActionButton = `<a href="book.html?id=${book.id}" class="flex-1 h-9 bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm shadow-amber-500/20 flex items-center justify-center space-x-1.5"><i class="fa-solid fa-cart-shopping text-[11px]"></i><span>Buy Now</span></a>`;
            } else if (book.is_for_sale && isPurchased) {
                primaryActionButton = cleanReadUrl
                    ? `<a href="${cleanReadUrl}" target="_blank" rel="noopener noreferrer" class="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-book-open-reader text-[11px]"></i><span>Read</span></a>`
                    : `<button class="flex-1 h-9 bg-emerald-600 text-white text-xs font-bold px-4 rounded-full">Read</button>`;
            } else {
                primaryActionButton = book.download_url
                    ? `<a href="${book.download_url}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-3 rounded-xl transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-download text-[10px]"></i><span>Download</span></a>`
                    : `<button class="flex-1 h-9 bg-accord-blue text-white text-xs font-bold px-3 rounded-xl">Download</button>`;
            }

            const card = document.createElement('div');
            card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-4 shadow-sm hover:shadow-lg transition-all duration-300 flex gap-4 items-stretch group";
            card.innerHTML = `
                <div class="w-28 sm:w-32 shrink-0">${coverVisual}</div>
                <div class="flex-1 flex flex-col justify-between min-w-0">
                    <div>
                        <div class="flex items-center justify-between gap-2 mb-1.5">
                            <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-0.5 rounded-md truncate">${escapeHTML(book.category || 'Archive')}</span>
                            ${book.year ? `<span class="text-[11px] font-semibold text-accord-muted shrink-0">${book.year}</span>` : ''}
                        </div>
                        <h3 class="font-bold text-accord-slate text-sm sm:text-[15px] leading-snug mb-1 line-clamp-2">${escapeHTML(book.title)}</h3>
                        <p class="text-[11px] font-bold text-accord-slate mb-1.5 truncate">${escapeHTML(book.author)}</p>
                        <p class="text-[11px] text-accord-muted leading-relaxed line-clamp-2 mb-2.5">${escapeHTML(book.description || '')}</p>
                        ${priceLine}
                    </div>
                    <div class="flex items-center gap-1.5">
                        ${primaryActionButton}
                        <button onclick="removeBookBookmark('${safeTitle}')" class="w-9 h-9 shrink-0 border text-accord-gold border-accord-gold bg-amber-50 rounded-xl flex items-center justify-center transition-all" title="Remove Bookmark">
                            <i class="fa-solid fa-bookmark text-[11px]"></i>
                        </button>
                    </div>
                </div>
            `;
            booksGrid.appendChild(card);
        });
    }

    // Render Saved Testimonies
    if (showTestimonies) {
        matchedTestimonies.forEach(t => {
            const card = document.createElement('div');
            card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-5 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between";
            card.innerHTML = `
                <div onclick="window.location.href='post.html?legacy_testimony=${t.id}'" class="cursor-pointer space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-0.5 rounded-md truncate">${escapeHTML(t.category)}</span>
                        <span class="text-[10px] font-semibold text-accord-muted shrink-0">${new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                    <h3 class="font-bold text-accord-slate text-base leading-snug line-clamp-2">${escapeHTML(t.title)}</h3>
                    <p class="text-xs font-bold text-accord-slate truncate">By ${escapeHTML(t.author_name)} ${t.location ? `(${escapeHTML(t.location)})` : ''}</p>
                    <p class="text-xs text-accord-muted leading-relaxed line-clamp-3">${escapeHTML(t.body)}</p>
                </div>
                <div class="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
                    <a href="post.html?legacy_testimony=${t.id}" class="text-accord-blue hover:underline">Read Full Testimony</a>
                    <button onclick="removeTestimonyBookmark(${t.id})" class="text-red-500 hover:text-red-600" title="Remove"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            `;
            testimoniesGrid.appendChild(card);
        });
    }
}

async function removeBookBookmark(title) {
    savedBookmarks = savedBookmarks.filter(t => t !== title);
    localStorage.setItem('accord_bookmarks', JSON.stringify(savedBookmarks));
    if (currentUser) {
        await supabaseClient.from('user_bookmarks').delete().eq('user_id', currentUser.id).eq('book_title', title);
    }
    loadSavedData();
}

async function removeTestimonyBookmark(testimonyId) {
    savedTestimonyIds = savedTestimonyIds.filter(id => id !== Number(testimonyId));
    if (currentUser) {
        await supabaseClient.from('user_testimony_bookmarks').delete().eq('user_id', currentUser.id).eq('testimony_id', Number(testimonyId));
    }
    loadSavedData();
}

function escapeHTML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}