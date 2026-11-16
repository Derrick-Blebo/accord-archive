// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ADMIN_EMAIL = 'accordmedia1@gmail.com';

let eventsData = [];
let testimoniesData = [];
let commentsByTestimony = {};
let savedTestimonyIds = [];
let currentForumType = 'all';
let currentForumCategory = 'All';
let currentUser = null;
let compressedEventFlyer = '';

document.addEventListener('DOMContentLoaded', async () => {
    await initAuth();
    await loadForumData();
});

async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    await syncUserState();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        await syncUserState();
        renderForumFeed();
    });
}

async function syncUserState() {
    const navLabel = document.getElementById('auth-nav-label');
    const mobileLabel = document.getElementById('mobile-auth-label');

    if (currentUser) {
        const fullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
        if (navLabel) navLabel.innerText = fullName;
        if (mobileLabel) mobileLabel.innerText = `Account (${fullName})`;

        const authorInput = document.getElementById('testimony-author');
        if (authorInput && !authorInput.value) authorInput.value = fullName;

        // Fetch saved testimonies count
        const { data } = await supabaseClient
            .from('user_testimony_bookmarks')
            .select('testimony_id')
            .eq('user_id', currentUser.id);
        
        savedTestimonyIds = data ? data.map(item => Number(item.testimony_id)) : [];
        const totalSaved = savedTestimonyIds.length;
        const badge = document.getElementById('bookmark-badge');
        if (badge) badge.innerText = totalSaved;
    } else {
        if (navLabel) navLabel.innerText = 'Sign In';
        if (mobileLabel) mobileLabel.innerText = 'Sign In / Create Account';
        savedTestimonyIds = [];
        const badge = document.getElementById('bookmark-badge');
        if (badge) badge.innerText = '0';
    }
}

function handleAuthNavClick() {
    if (currentUser) {
        window.location.href = 'profile.html';
    } else {
        openAuthModal();
    }
}

async function loadForumData() {
    const [eventsRes, testimoniesRes, commentsRes] = await Promise.all([
        supabaseClient.from('forum_events').select('*').eq('is_approved', true).order('created_at', { ascending: false }),
        supabaseClient.from('testimonies').select('*').eq('is_approved', true).order('created_at', { ascending: false }),
        supabaseClient.from('testimony_comments').select('*').order('created_at', { ascending: true })
    ]);

    document.getElementById('forum-loading')?.classList.add('hidden');

    eventsData = (!eventsRes.error && eventsRes.data) ? eventsRes.data : [];
    testimoniesData = (!testimoniesRes.error && testimoniesRes.data) ? testimoniesRes.data : [];

    commentsByTestimony = {};
    if (!commentsRes.error && commentsRes.data) {
        commentsRes.data.forEach(c => {
            if (!commentsByTestimony[c.testimony_id]) commentsByTestimony[c.testimony_id] = [];
            commentsByTestimony[c.testimony_id].push(c);
        });
    }

    renderForumFeed();
}

function setForumTypeFilter(type) {
    currentForumType = type;
    document.querySelectorAll('.ftype-btn').forEach(btn => {
        btn.className = "ftype-btn whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
    });
    const activeBtn = document.getElementById(`ftype-${type}`);
    if (activeBtn) activeBtn.className = "ftype-btn whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold transition-all bg-accord-slate text-white";
    renderForumFeed();
}

function setForumCategory(category) {
    currentForumCategory = category;
    document.querySelectorAll('.fcat-btn').forEach(btn => {
        btn.className = "fcat-btn whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
    });
    const activeBtn = document.getElementById(`fcat-${category}`);
    if (activeBtn) activeBtn.className = "fcat-btn whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm";
    renderForumFeed();
}

function filterForumFeed() {
    renderForumFeed();
}

function escapeHTML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderForumFeed() {
    const grid = document.getElementById('forum-grid');
    const eventsContainer = document.getElementById('forum-events-container');
    const emptyState = document.getElementById('forum-empty');
    if (!grid || !eventsContainer) return;

    grid.innerHTML = '';
    eventsContainer.innerHTML = '';

    const query = (document.getElementById('forum-search')?.value || '').toLowerCase();

    const filteredEvents = (currentForumType === 'all' || currentForumType === 'events') && currentForumCategory === 'All'
        ? eventsData.filter(ev => ev.title.toLowerCase().includes(query) || ev.organizer_name.toLowerCase().includes(query) || ev.description.toLowerCase().includes(query))
        : [];

    const filteredTestimonies = (currentForumType === 'all' || currentForumType === 'testimonies')
        ? testimoniesData.filter(item => {
            const matchesType = currentForumType === 'testimonies' || !item.event_id;
            const matchesCat = currentForumCategory === 'All' || item.category === currentForumCategory;
            const matchesQuery = item.title.toLowerCase().includes(query) || item.body.toLowerCase().includes(query) || item.author_name.toLowerCase().includes(query);
            return matchesType && matchesCat && matchesQuery;
        })
        : [];

    if (filteredEvents.length === 0 && filteredTestimonies.length === 0) {
        emptyState?.classList.remove('hidden');
        return;
    } else {
        emptyState?.classList.add('hidden');
    }

    filteredEvents.forEach(ev => {
        eventsContainer.appendChild(buildEventCard(ev));
    });

    filteredTestimonies.forEach(t => {
        grid.appendChild(buildTestimonyGridCard(t));
    });
}

function buildEventCard(ev) {
    const likedEvents = JSON.parse(localStorage.getItem('accord_liked_events') || '[]');
    const hasLikedEvent = likedEvents.includes(Number(ev.id));
    const eventTestimonies = testimoniesData.filter(t => Number(t.event_id) === Number(ev.id));
    const canDeleteEvent = currentUser && ((ev.user_id && currentUser.id === ev.user_id) || currentUser.email === ADMIN_EMAIL);
    const safeEventTitle = (ev.title || '').replace(/'/g, "\\'");

    const card = document.createElement('section');
    card.className = "bg-white border-2 border-amber-200/90 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6";

    // Split testimonies into initial 3 and remaining
    const initialTestimonies = eventTestimonies.slice(0, 3);
    const remainingTestimonies = eventTestimonies.slice(3);

    const initialHtml = initialTestimonies.map(t => buildTestimonyGridCard(t, true).outerHTML).join('');
    const remainingHtml = remainingTestimonies.map(t => buildTestimonyGridCard(t, true).outerHTML).join('');

    const gridColsClass = eventTestimonies.length >= 3 ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "grid grid-cols-1 md:grid-cols-2 gap-4";

    const testimoniesGridHtml = eventTestimonies.length === 0
        ? `<div class="bg-amber-50/60 border border-amber-200/60 rounded-2xl p-5 text-center space-y-2">
               <p class="text-xs font-semibold text-slate-700">No testimonies shared under this service yet.</p>
               <button type="button" onclick="openTestimonyModal(${ev.id}, '${safeEventTitle}')" class="inline-flex items-center space-x-1.5 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2 rounded-xl transition-all">
                   <i class="fa-solid fa-plus text-[10px]"></i>
                   <span>Be the First to Share a Testimony from This Event</span>
               </button>
           </div>`
        : `
           <div class="${gridColsClass}">
               ${initialHtml}
           </div>
           ${remainingTestimonies.length > 0 ? `
               <div id="extra-testimonies-${ev.id}" class="hidden ${gridColsClass} mt-4">
                   ${remainingHtml}
               </div>
               <div class="text-center pt-2">
                   <button type="button" onclick="toggleEventTestimonies(${ev.id})" id="event-toggle-btn-${ev.id}" class="inline-flex items-center space-x-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold px-5 py-2.5 rounded-xl transition-all">
                       <i class="fa-solid fa-chevron-down mr-1"></i>
                       <span>See more testimonies (${remainingTestimonies.length} more)</span>
                   </button>
               </div>
           ` : ''}
          `;

    card.innerHTML = `
        <div class="flex flex-col md:flex-row gap-6">
            ${ev.flyer_url ? `
                <div class="w-full md:w-52 shrink-0">
                    <img src="${ev.flyer_url}" alt="${escapeHTML(ev.title)}" class="w-full h-64 md:h-60 object-cover rounded-2xl border border-slate-200 shadow-sm">
                </div>
            ` : ''}

            <div class="flex-1 flex flex-col justify-between space-y-4">
                <div>
                    <div class="flex items-start justify-between gap-3 mb-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="bg-accord-gold text-white text-[10px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full">
                                <i class="fa-solid fa-church mr-1"></i> Church Event Thread
                            </span>
                            <span class="text-xs font-bold text-accord-slate">${escapeHTML(ev.organizer_name)}</span>
                        </div>
                        ${canDeleteEvent ? `<button onclick="deleteEvent(${ev.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors" title="Delete event"><i class="fa-solid fa-trash-can text-xs"></i></button>` : ''}
                    </div>

                    <h3 class="serif-heading text-2xl sm:text-3xl font-bold text-accord-slate leading-snug mb-2">
                        ${escapeHTML(ev.title)}
                    </h3>

                    <div class="flex flex-wrap items-center gap-4 text-xs text-accord-muted font-semibold mb-3">
                        ${ev.event_date ? `<span><i class="fa-regular fa-calendar mr-1 text-accord-gold"></i>${escapeHTML(ev.event_date)}</span>` : ''}
                        ${ev.location ? `<span><i class="fa-solid fa-location-dot mr-1 text-accord-blue"></i>${escapeHTML(ev.location)}</span>` : ''}
                    </div>

                    <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                        ${escapeHTML(ev.description)}
                    </p>
                </div>

                <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center space-x-6 text-sm font-semibold text-accord-muted">
                        <button type="button" onclick="likeEvent(${ev.id})" class="hover:text-red-500 flex items-center space-x-1.5 transition-colors cursor-pointer">
                            <i class="${hasLikedEvent ? 'fa-solid text-red-500' : 'fa-regular'} fa-thumbs-up text-base"></i>
                            <span>${Number(ev.like_count) || 0}</span>
                        </button>
                        <span class="flex items-center space-x-1.5">
                            <i class="fa-regular fa-comment text-base"></i>
                            <span>${eventTestimonies.length}</span>
                        </span>
                        <button type="button" onclick="shareForumLink('event', ${ev.id}, '${safeEventTitle}')" class="hover:text-accord-blue flex items-center space-x-1.5 transition-colors cursor-pointer">
                            <i class="fa-solid fa-share text-base"></i>
                            <span>Share</span>
                        </button>
                    </div>

                    <button type="button" onclick="openTestimonyModal(${ev.id}, '${safeEventTitle}')" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition-all">
                        Post Testimony Under Event
                    </button>
                </div>
            </div>
        </div>

        <div class="pt-4 border-t border-amber-200/70 space-y-4">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-accord-slate">
                Testimonies from this Event (${eventTestimonies.length})
            </h4>
            ${testimoniesGridHtml}
        </div>
    `;
    return card;
}

function toggleEventTestimonies(eventId) {
    const extraContainer = document.getElementById(`extra-testimonies-${eventId}`);
    const toggleBtn = document.getElementById(`event-toggle-btn-${eventId}`);
    if (extraContainer) {
        extraContainer.classList.toggle('hidden');
        const isHidden = extraContainer.classList.contains('hidden');
        if (toggleBtn) {
            toggleBtn.innerHTML = isHidden
                ? `<i class="fa-solid fa-chevron-down mr-1"></i><span>See more testimonies</span>`
                : `<i class="fa-solid fa-chevron-up mr-1"></i><span>See less</span>`;
        }
    }
}

function buildTestimonyGridCard(item) {
    const comments = commentsByTestimony[item.id] || [];
    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    const hasLiked = amenedIds.includes(Number(item.id));
    const isSaved = savedTestimonyIds.includes(Number(item.id));
    const safeTitle = (item.title || '').replace(/'/g, "\\'");

    const card = document.createElement('div');
    card.className = "bg-white border border-slate-200/90 hover:border-accord-blue rounded-3xl p-5 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between group relative";
    card.innerHTML = `
        <button type="button" onclick="toggleSaveTestimony(event, ${item.id})" class="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-50 hover:bg-amber-50 border border-slate-200 ${isSaved ? 'text-accord-gold border-accord-gold bg-amber-50' : 'text-slate-400 hover:text-accord-gold'} flex items-center justify-center transition-all" title="Save Testimony">
            <i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-bookmark text-xs"></i>
        </button>

        <div onclick="window.location.href='testimony.html?id=${item.id}'" class="cursor-pointer space-y-3 pr-8">
            <div class="flex items-center justify-between gap-2">
                <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-0.5 rounded-md truncate">
                    ${escapeHTML(item.category)}
                </span>
                <span class="text-[10px] font-semibold text-accord-muted shrink-0">${formatDate(item.created_at)}</span>
            </div>

            <h3 class="font-bold text-accord-slate text-base leading-snug line-clamp-2 group-hover:text-accord-blue transition-colors">
                ${escapeHTML(item.title)}
            </h3>

            <p class="text-xs font-bold text-accord-slate truncate">
                By ${escapeHTML(item.author_name)} ${item.location ? `(${escapeHTML(item.location)})` : ''}
            </p>

            <p class="text-xs text-accord-muted leading-relaxed line-clamp-3">
                ${escapeHTML(item.body)}
            </p>
        </div>

        <div class="pt-4 mt-4 border-t border-slate-100 flex items-center justify-start space-x-6 text-xs text-accord-muted font-semibold">
            <button type="button" onclick="likeTestimony(${item.id})" class="hover:text-red-500 flex items-center space-x-1.5 transition-colors cursor-pointer">
                <i class="${hasLiked ? 'fa-solid text-red-500' : 'fa-regular'} fa-thumbs-up text-sm"></i>
                <span>${Number(item.amen_count) || 0}</span>
            </button>
            
            <a href="testimony.html?id=${item.id}" class="hover:text-accord-blue flex items-center space-x-1.5 transition-colors">
                <i class="fa-regular fa-comment text-sm"></i>
                <span>${comments.length}</span>
            </a>

            <button type="button" onclick="shareForumLink('testimony', ${item.id}, '${safeTitle}')" class="hover:text-accord-blue flex items-center space-x-1.5 transition-colors cursor-pointer">
                <i class="fa-solid fa-share text-sm"></i>
                <span>Share</span>
            </button>
        </div>
    `;
    return card;
}

async function toggleSaveTestimony(e, testimonyId) {
    e.stopPropagation();
    if (!currentUser) {
        showToast("Please sign in to save testimonies.");
        openAuthModal();
        return;
    }

    const isAlreadySaved = savedTestimonyIds.includes(Number(testimonyId));
    if (isAlreadySaved) {
        savedTestimonyIds = savedTestimonyIds.filter(id => id !== Number(testimonyId));
        await supabaseClient.from('user_testimony_bookmarks').delete().eq('user_id', currentUser.id).eq('testimony_id', testimonyId);
        showToast("Removed from Saved Items.");
    } else {
        savedTestimonyIds.push(Number(testimonyId));
        await supabaseClient.from('user_testimony_bookmarks').upsert({ user_id: currentUser.id, testimony_id: Number(testimonyId) });
        showToast("Saved to your library!");
    }
    const badge = document.getElementById('bookmark-badge');
    if (badge) badge.innerText = savedTestimonyIds.length;
    renderForumFeed();
}

async function shareForumLink(type, id, title) {
    const shareUrl = `${window.location.origin}/forum.html?${type}=${id}`;
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop && navigator.share) {
        try { await navigator.share({ title, url: shareUrl }); } catch (err) {}
    } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast(`${type === 'event' ? 'Event' : 'Testimony'} link copied to clipboard!`);
    }
}

async function likeEvent(eventId) {
    const liked = JSON.parse(localStorage.getItem('accord_liked_events') || '[]');
    if (liked.includes(Number(eventId))) {
        showToast("You already liked this event!");
        return;
    }
    liked.push(Number(eventId));
    localStorage.setItem('accord_liked_events', JSON.stringify(liked));
    await supabaseClient.rpc('increment_event_like', { target_id: Number(eventId) });
    await loadForumData();
}

async function likeTestimony(testimonyId) {
    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    if (amenedIds.includes(Number(testimonyId))) {
        showToast("You already liked this testimony!");
        return;
    }
    amenedIds.push(Number(testimonyId));
    localStorage.setItem('accord_amened_ids', JSON.stringify(amenedIds));
    await supabaseClient.rpc('increment_testimony_amen', { target_id: Number(testimonyId) });
    await loadForumData();
}

function openTestimonyModal(eventId = null, eventTitle = '') {
    document.getElementById('testimony-event-id').value = eventId || '';
    const eventBanner = document.getElementById('selected-event-banner');
    const eventNameSpan = document.getElementById('selected-event-name');
    if (eventId && eventTitle) {
        if (eventNameSpan) eventNameSpan.innerText = eventTitle;
        eventBanner?.classList.remove('hidden');
    } else {
        eventBanner?.classList.add('hidden');
    }
    const modal = document.getElementById('testimony-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeTestimonyModal() {
    const modal = document.getElementById('testimony-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleTestimonySubmit(e) {
    e.preventDefault();
    const eventIdVal = document.getElementById('testimony-event-id').value;
    const author_name = document.getElementById('testimony-author').value.trim();
    const location = document.getElementById('testimony-location').value.trim();
    const title = document.getElementById('testimony-title').value.trim();
    const category = document.getElementById('testimony-category').value;
    const body = document.getElementById('testimony-body').value.trim();

    const { error } = await supabaseClient.from('testimonies').insert([{
        user_id: currentUser ? currentUser.id : null,
        event_id: eventIdVal ? Number(eventIdVal) : null,
        author_name, location, title, category, body
    }]);

    if (error) {
        showToast(`Could not publish: ${error.message}`);
        return;
    }

    document.getElementById('testimony-form').reset();
    closeTestimonyModal();
    await loadForumData();
    showToast("Your testimony has been published!");
}

function openEventModal() {
    document.getElementById('event-form').reset();
    const modal = document.getElementById('event-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeEventModal() {
    const modal = document.getElementById('event-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleEventSubmit(e) {
    e.preventDefault();
    const organizer_name = document.getElementById('event-organizer').value.trim();
    const title = document.getElementById('event-title').value.trim();
    const event_date = document.getElementById('event-date').value.trim();
    const location = document.getElementById('event-location').value.trim();
    const description = document.getElementById('event-description').value.trim();

    const { error } = await supabaseClient.from('forum_events').insert([{
        user_id: currentUser ? currentUser.id : null,
        organizer_name, title, event_date, location, description, flyer_url: compressedEventFlyer || ''
    }]);

    if (error) {
        showToast(`Could not create event: ${error.message}`);
        return;
    }

    closeEventModal();
    await loadForumData();
    showToast("Church event post published!");
}

document.getElementById('event-flyer-input')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('event-flyer-name').innerText = file.name;
    const reader = new FileReader();
    reader.onload = function(ev) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = (img.height * 640) / img.width;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            compressedEventFlyer = canvas.toDataURL('image/webp', 0.80);
            document.getElementById('event-flyer-preview').innerHTML = `<img src="${compressedEventFlyer}" class="w-full h-full object-cover">`;
            document.getElementById('event-flyer-preview').classList.remove('hidden');
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

function openAuthModal() {
    document.getElementById('auth-modal')?.classList.remove('hidden');
    document.getElementById('auth-modal')?.classList.add('flex');
}

function closeAuthModal() {
    document.getElementById('auth-modal')?.classList.remove('flex');
    document.getElementById('auth-modal')?.classList.add('hidden');
}

async function handleGoogleSignIn() {
    await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/forum.html` }
    });
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
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}