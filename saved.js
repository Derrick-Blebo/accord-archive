const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let allBooks = [];
let allTestimonies = [];
let savedBookmarks = [];
let savedTestimonyIds = [];
let purchasedBookIds = [];

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    if (!currentUser) {
        document.getElementById('saved-loading').classList.add('hidden');
        document.getElementById('saved-empty-state').classList.remove('hidden');
        document.getElementById('empty-state-title').innerText = 'Sign In Required';
        document.getElementById('empty-state-desc').innerText = 'Please sign in to view your saved books and testimonies across devices.';
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

function renderSavedPages() {
    const booksGrid = document.getElementById('saved-books-grid');
    const testimoniesGrid = document.getElementById('saved-testimonies-grid');
    const emptyState = document.getElementById('saved-empty-state');
    const subtitle = document.getElementById('saved-subtitle');

    booksGrid.innerHTML = '';
    testimoniesGrid.innerHTML = '';

    const matchedBooks = allBooks.filter(b => savedBookmarks.includes(b.title));
    const matchedTestimonies = allTestimonies.filter(t => savedTestimonyIds.includes(Number(t.id)));

    if (subtitle) {
        subtitle.innerText = `You have ${matchedBooks.length} saved publication(s) and ${matchedTestimonies.length} saved testimony(ies).`;
    }

    if (matchedBooks.length === 0 && matchedTestimonies.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    // Render Saved Books
    matchedBooks.forEach(book => {
        const isPurchased = purchasedBookIds.includes(Number(book.id));
        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200 rounded-3xl p-4 shadow-sm flex gap-4 items-center";
        card.innerHTML = `
            <div class="w-24 h-32 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                ${book.cover_url ? `<img src="${book.cover_url}" class="w-full h-full object-cover">` : `<div class="flex items-center justify-center h-full text-xs text-slate-400">Book</div>`}
            </div>
            <div class="flex-1 min-w-0">
                <h3 class="font-bold text-accord-slate text-sm truncate">${escapeHTML(book.title)}</h3>
                <p class="text-xs text-accord-muted truncate">${escapeHTML(book.author)}</p>
                <div class="mt-3 flex items-center gap-2">
                    <a href="index.html?book=${book.id}#library" class="bg-accord-blue text-white text-xs font-bold px-3 py-1.5 rounded-xl">View</a>
                    <button onclick="removeBookBookmark('${escapeHTML(book.title).replace(/'/g, "\\'")}')" class="text-red-500 text-xs hover:underline">Remove</button>
                </div>
            </div>
        `;
        booksGrid.appendChild(card);
    });

    // Render Saved Testimonies
    matchedTestimonies.forEach(t => {
        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200 rounded-3xl p-5 shadow-sm flex flex-col justify-between";
        card.innerHTML = `
            <div onclick="window.location.href='testimony.html?id=${t.id}'" class="cursor-pointer space-y-2">
                <span class="bg-accord-goldLight text-accord-gold text-[10px] font-bold px-2 py-0.5 rounded">${escapeHTML(t.category)}</span>
                <h3 class="font-bold text-accord-slate text-sm line-clamp-2">${escapeHTML(t.title)}</h3>
                <p class="text-xs text-accord-muted">By ${escapeHTML(t.author_name)}</p>
                <p class="text-xs text-slate-600 line-clamp-2">${escapeHTML(t.body)}</p>
            </div>
            <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                <a href="testimony.html?id=${t.id}" class="text-xs font-bold text-accord-blue hover:underline">Read Full Testimony</a>
                <button onclick="removeTestimonyBookmark(${t.id})" class="text-red-500 text-xs hover:underline"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
        testimoniesGrid.appendChild(card);
    });
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