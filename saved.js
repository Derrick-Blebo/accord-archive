const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

let currentUser = null;
let allBooks = [];
let allTestimonies = [];
let allPlaylists = [];
let savedBookmarks = [];
let savedTestimonyIds = [];
let savedPlaylistIds = [];
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
    const [booksRes, testimoniesRes, bookmarksRes, testimonyBookmarksRes, purchasesRes, musicConfigRes, sermonsConfigRes, playlistBookmarksRes] = await Promise.all([
        supabaseClient.from('books').select('*').is('deleted_at', null).eq('is_visible', true),
        supabaseClient.from('testimonies').select('*').eq('is_approved', true),
        supabaseClient.from('user_bookmarks').select('book_title').eq('user_id', currentUser.id),
        supabaseClient.from('user_testimony_bookmarks').select('testimony_id').eq('user_id', currentUser.id),
        supabaseClient.from('user_purchases').select('book_id').eq('user_id', currentUser.id),
        supabaseClient.from('books').select('description').eq('title', '__ACCORD_MUSIC_CONFIG__').maybeSingle(),
        supabaseClient.from('books').select('description').eq('title', '__ACCORD_SERMONS_CONFIG__').maybeSingle(),
        supabaseClient.from('user_playlist_bookmarks').select('playlist_id').eq('user_id', currentUser.id)
    ]);

    document.getElementById('saved-loading').classList.add('hidden');

    allBooks = booksRes.data || [];
    allTestimonies = testimoniesRes.data || [];
    savedBookmarks = bookmarksRes.data ? bookmarksRes.data.map(b => b.book_title) : [];
    savedTestimonyIds = testimonyBookmarksRes.data ? testimonyBookmarksRes.data.map(t => Number(t.testimony_id)) : [];
    purchasedBookIds = purchasesRes.data ? purchasesRes.data.map(p => Number(p.book_id)) : [];

    const musicPlaylists = (() => {
        try {
            if (musicConfigRes.data?.description) {
                const parsed = JSON.parse(musicConfigRes.data.description);
                return Array.isArray(parsed?.playlists) ? parsed.playlists.map(p => ({ ...p, _hubPage: 'playlists.html' })) : [];
            }
        } catch {}
        return [];
    })();
    const sermonPlaylists = (() => {
        try {
            if (sermonsConfigRes.data?.description) {
                const parsed = JSON.parse(sermonsConfigRes.data.description);
                return Array.isArray(parsed?.playlists) ? parsed.playlists.map(p => ({ ...p, _hubPage: 'sermons.html' })) : [];
            }
        } catch {}
        return [];
    })();
    allPlaylists = [...musicPlaylists, ...sermonPlaylists];

    let localPlaylistIds = [];
    try {
        const raw = localStorage.getItem('accord_saved_playlists');
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) localPlaylistIds = arr.map(String);
    } catch {}
    const remotePlaylistIds = !playlistBookmarksRes.error && Array.isArray(playlistBookmarksRes.data)
        ? playlistBookmarksRes.data.map(p => String(p.playlist_id))
        : [];
    savedPlaylistIds = Array.from(new Set([...remotePlaylistIds, ...localPlaylistIds]));

    renderSavedPages();
}

function setSavedFilter(filter) {
    currentFilter = filter;
    ['all', 'purchased', 'books', 'testimonies', 'playlists'].forEach(f => {
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
    const playlistsGrid = document.getElementById('saved-playlists-grid');
    const booksSection = document.getElementById('saved-books-section');
    const testimoniesSection = document.getElementById('saved-testimonies-section');
    const playlistsSection = document.getElementById('saved-playlists-section');
    const headingBooks = document.getElementById('heading-books');
    const emptyState = document.getElementById('saved-empty-state');
    const subtitle = document.getElementById('saved-subtitle');

    booksGrid.innerHTML = '';
    testimoniesGrid.innerHTML = '';
    if (playlistsGrid) playlistsGrid.innerHTML = '';

    const purchasedBooks = allBooks.filter(b => purchasedBookIds.includes(Number(b.id)));
    const bookmarkedBooks = allBooks.filter(b => savedBookmarks.includes(b.title));
    const allSavedAndPurchasedBooks = allBooks.filter(
        b => purchasedBookIds.includes(Number(b.id)) || savedBookmarks.includes(b.title)
    );

    const matchedBooks = currentFilter === 'purchased'
        ? purchasedBooks
        : (currentFilter === 'books' ? bookmarkedBooks : allSavedAndPurchasedBooks);
    const matchedTestimonies = allTestimonies.filter(t => savedTestimonyIds.includes(Number(t.id)));
    const matchedPlaylists = allPlaylists.filter(p => savedPlaylistIds.includes(String(p.id)));

    if (subtitle) {
        subtitle.innerText = `You have ${purchasedBooks.length} purchased book(s), ${bookmarkedBooks.length} bookmarked publication(s), ${matchedTestimonies.length} saved testimony(ies), and ${matchedPlaylists.length} saved playlist(s).`;
    }
    if (headingBooks) {
        headingBooks.innerText = currentFilter === 'purchased'
            ? 'Purchased Publications & Books'
            : 'Purchased & Saved Publications';
    }

    const showBooks = currentFilter === 'all' || currentFilter === 'purchased' || currentFilter === 'books';
    const showTestimonies = currentFilter === 'all' || currentFilter === 'testimonies';
    const showPlaylists = currentFilter === 'all' || currentFilter === 'playlists';

    booksSection.style.display = showBooks && matchedBooks.length > 0 ? 'block' : 'none';
    testimoniesSection.style.display = showTestimonies && matchedTestimonies.length > 0 ? 'block' : 'none';
    if (playlistsSection) {
        playlistsSection.style.display = showPlaylists && matchedPlaylists.length > 0 ? 'block' : 'none';
    }

    if ((showBooks && matchedBooks.length > 0) || (showTestimonies && matchedTestimonies.length > 0) || (showPlaylists && matchedPlaylists.length > 0)) {
        emptyState.classList.add('hidden');
    } else {
        emptyState.classList.remove('hidden');
    }

    // Render Saved & Purchased Books
    if (showBooks) {
        matchedBooks.forEach(book => {
            const isPurchased = purchasedBookIds.includes(Number(book.id));
            const isBookmarked = savedBookmarks.includes(book.title);
            const safeTitle = book.title.replace(/'/g, "\\'");

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
            const isSignedSupabase = isSupabaseFile && book.download_url.includes('token=');
            const cleanReadUrl = book.download_url ? (isSupabaseFile && !isSignedSupabase ? book.download_url.split('?')[0] : book.download_url) : '';

            const priceLine = (book.is_for_sale && !isPurchased)
                ? `<p class="text-xs font-extrabold text-accord-blue mb-2.5">USD ${Number(book.price || 0).toFixed(2)}</p>`
                : '';

            let primaryActionButton = '';
            if (book.is_for_sale && !isPurchased) {
                primaryActionButton = `<a href="book.html?id=${book.id}" class="flex-1 h-9 bg-accord-gold hover:bg-amber-500 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm shadow-amber-500/20 flex items-center justify-center space-x-1.5"><i class="fa-solid fa-cart-shopping text-[11px]"></i><span>Buy Now</span></a>`;
            } else if (isPurchased) {
                primaryActionButton = cleanReadUrl
                    ? `<a href="${cleanReadUrl}" target="_blank" rel="noopener noreferrer" class="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-book-open-reader text-[11px]"></i><span>Read</span></a>`
                    : `<a href="book.html?id=${book.id}" class="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded-full transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-book-open-reader text-[11px]"></i><span>Open Book</span></a>`;
            } else {
                primaryActionButton = book.download_url
                    ? `<a href="${book.download_url}" ${isSupabaseFile ? 'download' : 'target="_blank" rel="noopener noreferrer"'} class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-3 rounded-xl transition-all shadow-sm flex items-center justify-center space-x-1.5"><i class="fa-solid fa-download text-[10px]"></i><span>Download</span></a>`
                    : `<a href="book.html?id=${book.id}" class="flex-1 h-9 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-3 rounded-xl flex items-center justify-center">Open Book</a>`;
            }

            const bookmarkActionBtn = isBookmarked
                ? `<button onclick="removeBookBookmark('${safeTitle}')" class="w-9 h-9 shrink-0 border text-accord-gold border-accord-gold bg-amber-50 rounded-xl flex items-center justify-center transition-all" title="Remove Bookmark">
                       <i class="fa-solid fa-bookmark text-[11px]"></i>
                   </button>`
                : `<a href="book.html?id=${book.id}" class="w-9 h-9 shrink-0 border border-slate-200 bg-slate-50 hover:border-accord-blue text-accord-slate rounded-xl flex items-center justify-center transition-all" title="View Book Details">
                       <i class="fa-solid fa-arrow-up-right-from-square text-[11px]"></i>
                   </a>`;

            const card = document.createElement('div');
            card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-4 shadow-sm hover:shadow-lg transition-all duration-300 flex gap-4 items-stretch group";
            card.innerHTML = `
                <div class="w-28 sm:w-32 shrink-0">${coverVisual}</div>
                <div class="flex-1 flex flex-col justify-between min-w-0">
                    <div>
                        <div class="flex items-center justify-between gap-2 mb-1.5">
                            <div class="flex items-center gap-1.5 min-w-0">
                                <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-0.5 rounded-md truncate">${escapeHTML(book.category || 'Archive')}</span>
                                ${isPurchased ? `<span class="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0"><i class="fa-solid fa-circle-check mr-1"></i>Purchased</span>` : ''}
                            </div>
                            ${book.year ? `<span class="text-[11px] font-semibold text-accord-muted shrink-0">${book.year}</span>` : ''}
                        </div>
                        <a href="book.html?id=${book.id}" class="block">
                            <h3 class="font-bold text-accord-slate text-sm sm:text-[15px] leading-snug mb-1 line-clamp-2 hover:text-accord-blue transition-colors">${escapeHTML(book.title)}</h3>
                        </a>
                        <p class="text-[11px] font-bold text-accord-slate mb-1.5 truncate">${escapeHTML(book.author)}</p>
                        <p class="text-[11px] text-accord-muted leading-relaxed line-clamp-2 mb-2.5">${escapeHTML(book.description || '')}</p>
                        ${priceLine}
                    </div>
                    <div class="flex items-center gap-1.5">
                        ${primaryActionButton}
                        ${bookmarkActionBtn}
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

    // Render Saved Playlists
    if (showPlaylists && playlistsGrid) {
        const fallbackImg = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800';
        matchedPlaylists.forEach(pl => {
            const safeId = escapeHTML(pl.id).replace(/'/g, "\\'");
            const hubPage = pl._hubPage || 'playlists.html';
            const plLink = pl.links?.spotify || pl.links?.apple || pl.links?.audiomack || pl.link || hubPage;
            const card = document.createElement('div');
            card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-4 shadow-sm hover:shadow-lg transition-all duration-300 flex gap-4 items-center";
            card.innerHTML = `
                <div class="w-20 h-20 rounded-2xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200/80">
                    <img src="${escapeHTML(pl.image || fallbackImg)}" alt="${escapeHTML(pl.title)}" class="w-full h-full object-cover">
                </div>
                <div class="flex-1 min-w-0 space-y-1.5">
                    <span class="inline-block bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2 py-0.5 rounded-md truncate max-w-full">${escapeHTML(pl.genre || (hubPage === 'sermons.html' ? 'Sermon Audio' : 'Curated Playlist'))}</span>
                    <h3 class="font-bold text-accord-slate text-sm leading-snug truncate">${escapeHTML(pl.title)}</h3>
                    <p class="text-[11px] text-accord-muted truncate">${escapeHTML(pl.curator || 'SoundSpace PR')}</p>
                    <div class="flex items-center gap-2 pt-1">
                        <a href="${escapeHTML(plLink)}" target="${plLink.startsWith('http') ? '_blank' : '_self'}" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-[11px] font-bold transition-all">
                            <i class="fa-solid fa-play text-[9px]"></i>
                            <span>Listen</span>
                        </a>
                        <a href="${hubPage}" class="inline-flex items-center px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-[11px] font-bold transition-all">${hubPage === 'sermons.html' ? 'All Sermons' : 'All Playlists'}</a>
                        <button type="button" onclick="removePlaylistBookmark('${safeId}')" class="ml-auto text-red-500 hover:text-red-600 p-1.5" title="Remove Saved Playlist">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
            playlistsGrid.appendChild(card);
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

async function removePlaylistBookmark(playlistId) {
    const id = String(playlistId);
    savedPlaylistIds = savedPlaylistIds.filter(pid => pid !== id);
    localStorage.setItem('accord_saved_playlists', JSON.stringify(savedPlaylistIds));
    if (currentUser) {
        await supabaseClient.from('user_playlist_bookmarks').delete().eq('user_id', currentUser.id).eq('playlist_id', id);
        supabaseClient.rpc('record_playlist_event', {
            p_playlist_id: id,
            p_playlist_title: allPlaylists.find(p => String(p.id) === id)?.title || '',
            p_event_type: 'unsave',
            p_page_source: 'saved'
        }).then(() => {});
    }
    loadSavedData();
}

function escapeHTML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}