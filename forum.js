// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ADMIN_EMAIL = 'accordmedia1@gmail.com';

let eventsData = [];
let testimoniesData = [];
let commentsByTestimony = {};
let currentForumType = 'all';
let currentForumCategory = 'All';
let currentUser = null;
let authMode = 'signin';
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

        const authorInput = document.getElementById('testimony-author');
        if (authorInput && !authorInput.value) authorInput.value = fullName;

        const { data } = await supabaseClient
            .from('user_bookmarks')
            .select('book_title')
            .eq('user_id', currentUser.id);
        const count = data?.length || 0;
        if (document.getElementById('bookmark-badge')) document.getElementById('bookmark-badge').innerText = count;
        if (document.getElementById('mobile-bookmark-count')) document.getElementById('mobile-bookmark-count').innerText = count;
    } else {
        if (navLabel) navLabel.innerText = 'Sign In';
        if (mobileLabel) mobileLabel.innerText = 'Sign In / Create Account';
        formsContainer?.classList.remove('hidden');
        profileContainer?.classList.add('hidden');
        if (document.getElementById('bookmark-badge')) document.getElementById('bookmark-badge').innerText = '0';
        if (document.getElementById('mobile-bookmark-count')) document.getElementById('mobile-bookmark-count').innerText = '0';
    }
}

async function loadForumData() {
    const [eventsRes, testimoniesRes, commentsRes] = await Promise.all([
        supabaseClient
            .from('forum_events')
            .select('*')
            .eq('is_approved', true)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('testimonies')
            .select('*')
            .eq('is_approved', true)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('testimony_comments')
            .select('*')
            .order('created_at', { ascending: true })
    ]);

    document.getElementById('forum-loading')?.classList.add('hidden');

    eventsData = (!eventsRes.error && eventsRes.data) ? eventsRes.data : [];
    testimoniesData = (!testimoniesRes.error && testimoniesRes.data) ? testimoniesRes.data : [];

    commentsByTestimony = {};
    if (!commentsRes.error && commentsRes.data) {
        commentsRes.data.forEach(c => {
            if (!commentsByTestimony[c.testimony_id]) {
                commentsByTestimony[c.testimony_id] = [];
            }
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
    if (activeBtn) {
        activeBtn.className = "ftype-btn whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold transition-all bg-accord-slate text-white";
    }
    renderForumFeed();
}

function setForumCategory(category) {
    currentForumCategory = category;
    document.querySelectorAll('.fcat-btn').forEach(btn => {
        btn.className = "fcat-btn whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
    });
    const activeBtn = document.getElementById(`fcat-${category}`);
    if (activeBtn) {
        activeBtn.className = "fcat-btn whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm";
    }
    renderForumFeed();
}

function filterForumFeed() {
    renderForumFeed();
}

function clearSharedFocus() {
    window.history.replaceState({}, document.title, window.location.pathname);
    document.getElementById('shared-focus-banner')?.classList.add('hidden');
    renderForumFeed();
}

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderForumFeed() {
    const feed = document.getElementById('forum-feed');
    const emptyState = document.getElementById('forum-empty');
    const focusBanner = document.getElementById('shared-focus-banner');
    const focusLabel = document.getElementById('shared-focus-label');
    if (!feed) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sharedTestimonyId = urlParams.get('testimony');
    const sharedEventId = urlParams.get('event');

    feed.innerHTML = '';

    if (sharedTestimonyId) {
        const matched = testimoniesData.filter(t => String(t.id) === String(sharedTestimonyId));
        if (matched.length > 0) {
            focusBanner?.classList.remove('hidden');
            if (focusLabel) focusLabel.innerText = `Viewing shared testimony: "${matched[0].title}"`;
            emptyState?.classList.add('hidden');
            feed.appendChild(buildTestimonyCard(matched[0]));
            return;
        }
    }

    if (sharedEventId) {
        const matchedEvent = eventsData.filter(ev => String(ev.id) === String(sharedEventId));
        if (matchedEvent.length > 0) {
            focusBanner?.classList.remove('hidden');
            if (focusLabel) focusLabel.innerText = `Viewing church event: "${matchedEvent[0].title}"`;
            emptyState?.classList.add('hidden');
            feed.appendChild(buildEventCard(matchedEvent[0]));
            return;
        }
    }

    focusBanner?.classList.add('hidden');

    const query = (document.getElementById('forum-search')?.value || '').toLowerCase();

    const filteredEvents = (currentForumType === 'all' || currentForumType === 'events') && currentForumCategory === 'All'
        ? eventsData.filter(ev =>
            ev.title.toLowerCase().includes(query)
            || ev.organizer_name.toLowerCase().includes(query)
            || ev.description.toLowerCase().includes(query)
            || (ev.location || '').toLowerCase().includes(query)
        )
        : [];

    const filteredTestimonies = (currentForumType === 'all' || currentForumType === 'testimonies')
        ? testimoniesData.filter(item => {
            const matchesType = currentForumType === 'testimonies' || !item.event_id;
            const matchesCat = currentForumCategory === 'All' || item.category === currentForumCategory;
            const matchesQuery = item.title.toLowerCase().includes(query)
                || item.body.toLowerCase().includes(query)
                || item.author_name.toLowerCase().includes(query)
                || (item.location || '').toLowerCase().includes(query);
            return matchesType && matchesCat && matchesQuery;
        })
        : [];

    const combined = [
        ...filteredEvents.map(ev => ({ type: 'event', created_at: ev.created_at, data: ev })),
        ...filteredTestimonies.map(t => ({ type: 'testimony', created_at: t.created_at, data: t }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (combined.length === 0) {
        emptyState?.classList.remove('hidden');
        return;
    } else {
        emptyState?.classList.add('hidden');
    }

    combined.forEach(entry => {
        if (entry.type === 'event') {
            feed.appendChild(buildEventCard(entry.data));
        } else {
            feed.appendChild(buildTestimonyCard(entry.data));
        }
    });
}

function buildEventCard(ev) {
    const likedEvents = JSON.parse(localStorage.getItem('accord_liked_events') || '[]');
    const hasLikedEvent = likedEvents.includes(Number(ev.id));
    const eventTestimonies = testimoniesData.filter(t => Number(t.event_id) === Number(ev.id));
    const canDeleteEvent = currentUser && ((ev.user_id && currentUser.id === ev.user_id) || currentUser.email === ADMIN_EMAIL);
    const safeEventTitle = ev.title.replace(/'/g, "\\'");

    const card = document.createElement('section');
    card.className = "bg-white border-2 border-amber-200/90 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5 relative overflow-hidden";

    const eventTestimoniesHtml = eventTestimonies.length === 0
        ? `<div class="bg-amber-50/60 border border-amber-200/60 rounded-2xl p-5 text-center space-y-2">
               <p class="text-xs font-semibold text-slate-700">No testimonies shared under this service yet.</p>
               <button type="button" onclick="openTestimonyModal(${ev.id}, '${safeEventTitle}')" class="inline-flex items-center space-x-1.5 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2 rounded-xl transition-all">
                   <i class="fa-solid fa-plus text-[10px]"></i>
                   <span>Be the First to Share a Testimony from This Event</span>
               </button>
           </div>`
        : eventTestimonies.map(t => buildTestimonyCard(t, true).outerHTML).join('');

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
                    <div class="flex items-center space-x-2.5">
                        <button type="button" onclick="likeEvent(${ev.id})" class="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${hasLikedEvent ? 'bg-red-50 border-red-200 text-red-600' : 'bg-slate-50 hover:bg-red-50 border-slate-200 text-accord-slate hover:border-red-200 hover:text-red-600'}">
                            <i class="${hasLikedEvent ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                            <span>Like (${Number(ev.like_count) || 0})</span>
                        </button>

                        <button type="button" onclick="shareForumLink('event', ${ev.id}, '${safeEventTitle}')" class="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-50 hover:bg-blue-50 border border-slate-200 text-accord-slate hover:border-accord-blue hover:text-accord-blue transition-all">
                            <i class="fa-solid fa-share-nodes"></i>
                            <span>Share Event</span>
                        </button>
                    </div>

                    <button type="button" onclick="openTestimonyModal(${ev.id}, '${safeEventTitle}')" class="inline-flex items-center space-x-1.5 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition-all">
                        <i class="fa-solid fa-feather-pointed"></i>
                        <span>Post Testimony Under Event</span>
                    </button>
                </div>
            </div>
        </div>

        <div class="pt-4 border-t border-amber-200/70 space-y-4">
            <div class="flex items-center justify-between">
                <h4 class="text-xs font-extrabold uppercase tracking-wider text-accord-slate">
                    Testimonies from this Event (${eventTestimonies.length})
                </h4>
            </div>
            <div class="space-y-4">
                ${eventTestimoniesHtml}
            </div>
        </div>
    `;
    return card;
}

function buildTestimonyCard(item, isNestedInEvent = false) {
    const comments = commentsByTestimony[item.id] || [];
    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    const likedComments = JSON.parse(localStorage.getItem('accord_liked_comments') || '[]');
    const hasLiked = amenedIds.includes(Number(item.id));

    const isOwner = currentUser && item.user_id && currentUser.id === item.user_id;
    const canDeletePost = currentUser && (isOwner || currentUser.email === ADMIN_EMAIL);
    const safeTitle = item.title.replace(/'/g, "\\'");

    const parentEvent = item.event_id ? eventsData.find(e => Number(e.id) === Number(item.event_id)) : null;

    const initials = item.author_name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    const topComments = comments.filter(c => !c.parent_comment_id);
    const repliesByParent = {};
    comments.filter(c => c.parent_comment_id).forEach(r => {
        if (!repliesByParent[r.parent_comment_id]) repliesByParent[r.parent_comment_id] = [];
        repliesByParent[r.parent_comment_id].push(r);
    });

    const commentsHtml = topComments.length === 0
        ? `<p class="text-xs text-accord-muted italic py-1">No comments yet — encourage this believer below.</p>`
        : topComments.map(c => {
            const isCommentOwner = currentUser && c.user_id === currentUser.id;
            const canDeleteComment = currentUser && (isCommentOwner || currentUser.email === ADMIN_EMAIL);
            const hasLikedComment = likedComments.includes(Number(c.id));
            const replies = repliesByParent[c.id] || [];

            const repliesHtml = replies.map(r => {
                const isReplyOwner = currentUser && r.user_id === currentUser.id;
                const canDeleteReply = currentUser && (isReplyOwner || currentUser.email === ADMIN_EMAIL);
                const hasLikedReply = likedComments.includes(Number(r.id));

                return `
                    <div class="ml-6 mt-2 bg-white border border-slate-200/80 rounded-2xl p-3 flex items-start justify-between gap-2">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 mb-0.5">
                                <span class="text-[11px] font-bold text-accord-slate">${escapeHTML(r.author_name)}</span>
                                <span class="text-[10px] text-accord-muted">• ${formatDate(r.created_at)}</span>
                            </div>
                            <p class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${escapeHTML(r.comment_text)}</p>
                            <div class="flex items-center gap-3 mt-1.5">
                                <button type="button" onclick="likeComment(${r.id})" class="text-[11px] font-bold ${hasLikedReply ? 'text-red-500' : 'text-accord-muted hover:text-red-500'} transition-colors">
                                    <i class="${hasLikedReply ? 'fa-solid' : 'fa-regular'} fa-heart mr-1"></i>${Number(r.like_count) || 0}
                                </button>
                                ${isReplyOwner ? `<button type="button" onclick="openEditPostModal('comment', ${r.id})" class="text-[11px] font-bold text-accord-muted hover:text-accord-blue">Edit</button>` : ''}
                            </div>
                        </div>
                        ${canDeleteReply ? `<button onclick="deleteComment(${r.id})" class="text-slate-400 hover:text-red-500 text-xs p-1" title="Delete reply"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    </div>
                `;
            }).join('');

            return `
                <div class="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-xs font-bold text-accord-slate">${escapeHTML(c.author_name)}</span>
                                <span class="text-[10px] text-accord-muted">• ${formatDate(c.created_at)}</span>
                            </div>
                            <p class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${escapeHTML(c.comment_text)}</p>

                            <div class="flex items-center gap-4 mt-2">
                                <button type="button" onclick="likeComment(${c.id})" class="text-[11px] font-bold ${hasLikedComment ? 'text-red-500' : 'text-accord-muted hover:text-red-500'} transition-colors">
                                    <i class="${hasLikedComment ? 'fa-solid' : 'fa-regular'} fa-heart mr-1"></i>Like (${Number(c.like_count) || 0})
                                </button>
                                <button type="button" onclick="toggleReplyBox(${c.id})" class="text-[11px] font-bold text-accord-muted hover:text-accord-blue transition-colors">
                                    <i class="fa-solid fa-reply mr-1"></i>Reply
                                </button>
                                ${isCommentOwner ? `<button type="button" onclick="openEditPostModal('comment', ${c.id})" class="text-[11px] font-bold text-accord-muted hover:text-accord-blue transition-colors"><i class="fa-solid fa-pen mr-1"></i>Edit</button>` : ''}
                            </div>
                        </div>
                        ${canDeleteComment ? `<button onclick="deleteComment(${c.id})" class="text-slate-400 hover:text-red-500 text-xs p-1 transition-colors" title="Delete comment"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    </div>

                    ${repliesHtml}

                    <form id="reply-form-${c.id}" onsubmit="handleCommentSubmit(event, ${item.id}, ${c.id})" class="hidden mt-2.5 ml-6 flex items-center gap-2">
                        <input type="text" id="reply-input-${c.id}" required placeholder="Write a reply..." class="flex-1 bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-accord-slate focus:outline-none focus:border-accord-blue">
                        <button type="submit" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-[11px] font-bold px-3.5 py-2 rounded-xl">Reply</button>
                    </form>
                </div>
            `;
        }).join('');

    const card = document.createElement('article');
    card.className = isNestedInEvent
        ? "bg-slate-50/70 border border-slate-200/90 rounded-2xl p-5 space-y-4"
        : "bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm transition-all space-y-5";

    card.innerHTML = `
        <div class="flex items-start justify-between gap-4">
            <div class="flex items-center space-x-3.5">
                <div class="w-10 h-10 rounded-2xl bg-accord-lightBlue text-accord-blue font-extrabold text-xs flex items-center justify-center shrink-0">
                    ${escapeHTML(initials || 'AC')}
                </div>
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <h4 class="font-bold text-accord-slate text-sm">${escapeHTML(item.author_name)}</h4>
                        ${item.location ? `<span class="text-xs text-accord-muted"><i class="fa-solid fa-location-dot text-[10px] mr-1 text-accord-blue"></i>${escapeHTML(item.location)}</span>` : ''}
                    </div>
                    <p class="text-[11px] text-accord-muted mt-0.5">
                        ${formatDate(item.created_at)}
                        ${!isNestedInEvent && parentEvent ? ` • From <button type="button" onclick="shareForumLink('event', ${parentEvent.id}, '${parentEvent.title.replace(/'/g, "\\'")}', true)" class="text-accord-gold font-bold hover:underline">${escapeHTML(parentEvent.title)}</button>` : ''}
                    </p>
                </div>
            </div>

            <div class="flex items-center space-x-1.5">
                <span class="bg-accord-goldLight text-accord-gold text-[10px] font-bold px-3 py-1 rounded-full">
                    ${escapeHTML(item.category)}
                </span>
                ${isOwner ? `<button onclick="openEditPostModal('testimony', ${item.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue flex items-center justify-center transition-colors" title="Edit testimony"><i class="fa-solid fa-pen text-xs"></i></button>` : ''}
                ${canDeletePost ? `<button onclick="deleteTestimony(${item.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors" title="Delete testimony"><i class="fa-solid fa-trash-can text-xs"></i></button>` : ''}
            </div>
        </div>

        <div class="space-y-2">
            <h3 class="serif-heading text-lg sm:text-xl font-bold text-accord-slate leading-snug">
                ${escapeHTML(item.title)}
            </h3>
            <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                ${escapeHTML(item.body)}
            </p>
        </div>

        <div class="pt-3 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center space-x-2.5">
                <button type="button" onclick="likeTestimony(${item.id})" class="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${hasLiked ? 'bg-amber-50 border-accord-gold text-accord-gold' : 'bg-white hover:bg-amber-50 border-slate-200 text-accord-slate hover:border-accord-gold hover:text-accord-gold'}">
                    <i class="fa-solid fa-hands-praying"></i>
                    <span>Like / Amen (${Number(item.amen_count) || 0})</span>
                </button>

                <button type="button" onclick="shareForumLink('testimony', ${item.id}, '${safeTitle}')" class="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-blue-50 border border-slate-200 text-accord-slate hover:border-accord-blue hover:text-accord-blue transition-all">
                    <i class="fa-solid fa-share-nodes"></i>
                    <span>Share</span>
                </button>
            </div>

            <span class="text-xs font-semibold text-accord-muted">
                <i class="fa-regular fa-comment-dots mr-1 text-accord-blue"></i>
                ${comments.length} ${comments.length === 1 ? 'Comment' : 'Comments'}
            </span>
        </div>

        <div class="pt-2 space-y-3">
            <div class="space-y-2.5">
                ${commentsHtml}
            </div>

            <form onsubmit="handleCommentSubmit(event, ${item.id}, null)" class="flex items-center gap-2 pt-1">
                <input type="text" id="comment-input-${item.id}" required placeholder="${currentUser ? 'Write an encouraging comment or prayer...' : 'Sign in to comment on this testimony...'}" class="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-accord-slate focus:outline-none focus:border-accord-blue">
                <button type="submit" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shrink-0">
                    Post
                </button>
            </form>
        </div>
    `;
    return card;
}

async function shareForumLink(type, id, title, navigateOnly = false) {
    const shareUrl = `${window.location.origin}/forum.html?${type}=${id}`;
    if (navigateOnly) {
        window.history.pushState({}, '', `?${type}=${id}`);
        renderForumFeed();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop && navigator.share) {
        try {
            await navigator.share({ title, url: shareUrl });
        } catch (err) {}
    } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast(`${type === 'event' ? 'Event' : 'Testimony'} link copied to clipboard!`);
    }
}

function openTestimonyModal(eventId = null, eventTitle = '') {
    document.getElementById('testimony-event-id').value = eventId || '';

    const eventBanner = document.getElementById('selected-event-banner');
    const eventNameSpan = document.getElementById('selected-event-name');
    if (eventId && eventTitle) {
        eventNameSpan.innerText = eventTitle;
        eventBanner.classList.remove('hidden');
    } else {
        eventBanner.classList.add('hidden');
    }

    const guestWarning = document.getElementById('guest-edit-warning');
    if (guestWarning) {
        guestWarning.classList.toggle('hidden', Boolean(currentUser));
    }

    const modal = document.getElementById('testimony-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function clearSelectedEventForTestimony() {
    document.getElementById('testimony-event-id').value = '';
    document.getElementById('selected-event-banner')?.classList.add('hidden');
}

function closeTestimonyModal() {
    const modal = document.getElementById('testimony-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleTestimonySubmit(e) {
    e.preventDefault();

    const eventIdVal = document.getElementById('testimony-event-id').value;
    const author_name = document.getElementById('testimony-author').value.trim();
    const location = document.getElementById('testimony-location').value.trim();
    const title = document.getElementById('testimony-title').value.trim();
    const category = document.getElementById('testimony-category').value;
    const body = document.getElementById('testimony-body').value.trim();
    const btn = document.getElementById('testimony-submit-btn');

    btn.disabled = true;
    btn.innerText = 'Publishing...';

    const { error } = await supabaseClient
        .from('testimonies')
        .insert([{
            user_id: currentUser ? currentUser.id : null,
            event_id: eventIdVal ? Number(eventIdVal) : null,
            author_name,
            location,
            title,
            category,
            body
        }]);

    btn.disabled = false;
    btn.innerText = 'Publish Testimony';

    if (error) {
        showToast(`Could not publish testimony: ${error.message}`);
        return;
    }

    document.getElementById('testimony-form').reset();
    if (currentUser) {
        const fullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
        document.getElementById('testimony-author').value = fullName;
    }
    closeTestimonyModal();
    await loadForumData();
    showToast("Your testimony has been published!");
}

function openEventModal() {
    document.getElementById('event-form').reset();
    compressedEventFlyer = '';
    document.getElementById('event-flyer-preview').innerHTML = `<i class="fa-regular fa-image text-lg"></i>`;
    document.getElementById('event-flyer-name').innerText = 'JPG, PNG, or WebP (Auto-optimized)';

    const modal = document.getElementById('event-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEventModal() {
    const modal = document.getElementById('event-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
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
            const MAX_WIDTH = 640;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Compressed WebP at 0.80 quality
            compressedEventFlyer = canvas.toDataURL('image/webp', 0.80);
            document.getElementById('event-flyer-preview').innerHTML = `<img src="${compressedEventFlyer}" class="w-full h-full object-cover">`;
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

async function handleEventSubmit(e) {
    e.preventDefault();
    const organizer_name = document.getElementById('event-organizer').value.trim();
    const title = document.getElementById('event-title').value.trim();
    const event_date = document.getElementById('event-date').value.trim();
    const location = document.getElementById('event-location').value.trim();
    const description = document.getElementById('event-description').value.trim();
    const btn = document.getElementById('event-submit-btn');

    btn.disabled = true;
    btn.innerText = 'Publishing Event...';

    // Upload flyer to Supabase Storage as WebP
    let finalFlyerUrl = '';
    if (compressedEventFlyer && compressedEventFlyer.startsWith('data:image/')) {
        try {
            const blob = await (await fetch(compressedEventFlyer)).blob();
            const flyerFileName = `flyers/flyer_${Date.now()}.webp`;
            const { data: flyerUp, error: flyerErr } = await supabaseClient.storage
                .from('archive-files')
                .upload(flyerFileName, blob, {
                    contentType: 'image/webp',
                    cacheControl: '3600',
                    upsert: false
                });

            if (flyerErr) throw flyerErr;

            const { data: flyerPub } = supabaseClient.storage
                .from('archive-files')
                .getPublicUrl(flyerUp.path);

            finalFlyerUrl = flyerPub.publicUrl;
        } catch (err) {
            console.error("Flyer Upload Error:", err);
        }
    }

    const { error } = await supabaseClient
        .from('forum_events')
        .insert([{
            user_id: currentUser ? currentUser.id : null,
            organizer_name,
            title,
            event_date,
            location,
            description,
            flyer_url: finalFlyerUrl
        }]);

    btn.disabled = false;
    btn.innerText = 'Publish Church Event Post';

    if (error) {
        showToast(`Could not create event: ${error.message}`);
        return;
    }

    closeEventModal();
    await loadForumData();
    showToast("Church event post published! Members can now share testimonies under it.");
}

function toggleReplyBox(commentId) {
    if (!currentUser) {
        showToast("Please sign in to reply to comments.");
        openAuthModal();
        return;
    }
    const form = document.getElementById(`reply-form-${commentId}`);
    if (form) {
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) {
            document.getElementById(`reply-input-${commentId}`)?.focus();
        }
    }
}

async function handleCommentSubmit(e, testimonyId, parentCommentId = null) {
    e.preventDefault();
    if (!currentUser) {
        showToast("Please sign in to comment or reply.");
        openAuthModal();
        return;
    }

    const input = parentCommentId
        ? document.getElementById(`reply-input-${parentCommentId}`)
        : document.getElementById(`comment-input-${testimonyId}`);

    const commentText = input.value.trim();
    if (!commentText) return;

    const authorName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
    input.disabled = true;

    const { error } = await supabaseClient
        .from('testimony_comments')
        .insert([{
            testimony_id: Number(testimonyId),
            parent_comment_id: parentCommentId ? Number(parentCommentId) : null,
            user_id: currentUser.id,
            author_name: authorName,
            comment_text: commentText
        }]);

    input.disabled = false;

    if (error) {
        showToast(`Could not post: ${error.message}`);
        return;
    }

    input.value = '';
    await loadForumData();
    showToast(parentCommentId ? "Reply posted!" : "Comment posted!");
}

function openEditPostModal(type, id) {
    if (!currentUser) return;
    document.getElementById('edit-post-type').value = type;
    document.getElementById('edit-post-id').value = id;

    const titleGroup = document.getElementById('edit-title-group');
    const titleInput = document.getElementById('edit-post-title');
    const bodyInput = document.getElementById('edit-post-body');

    if (type === 'testimony') {
        const item = testimoniesData.find(t => Number(t.id) === Number(id));
        if (!item) return;
        document.getElementById('edit-post-heading').innerText = 'Edit Your Testimony';
        titleGroup.classList.remove('hidden');
        titleInput.required = true;
        titleInput.value = item.title;
        bodyInput.value = item.body;
    } else {
        const allComments = Object.values(commentsByTestimony).flat();
        const comment = allComments.find(c => Number(c.id) === Number(id));
        if (!comment) return;
        document.getElementById('edit-post-heading').innerText = 'Edit Your Comment';
        titleGroup.classList.add('hidden');
        titleInput.required = false;
        bodyInput.value = comment.comment_text;
    }

    const modal = document.getElementById('edit-post-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEditPostModal() {
    const modal = document.getElementById('edit-post-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleEditPostSubmit(e) {
    e.preventDefault();
    if (!currentUser) return;

    const type = document.getElementById('edit-post-type').value;
    const id = Number(document.getElementById('edit-post-id').value);
    const title = document.getElementById('edit-post-title').value.trim();
    const body = document.getElementById('edit-post-body').value.trim();

    if (type === 'testimony') {
        const { error } = await supabaseClient
            .from('testimonies')
            .update({ title, body })
            .eq('id', id)
            .eq('user_id', currentUser.id);
        if (error) {
            showToast(`Update failed: ${error.message}`);
            return;
        }
    } else {
        const { error } = await supabaseClient
            .from('testimony_comments')
            .update({ comment_text: body })
            .eq('id', id)
            .eq('user_id', currentUser.id);
        if (error) {
            showToast(`Update failed: ${error.message}`);
            return;
        }
    }

    closeEditPostModal();
    await loadForumData();
    showToast("Changes saved!");
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

async function likeComment(commentId) {
    const liked = JSON.parse(localStorage.getItem('accord_liked_comments') || '[]');
    if (liked.includes(Number(commentId))) {
        showToast("You already liked this comment!");
        return;
    }
    liked.push(Number(commentId));
    localStorage.setItem('accord_liked_comments', JSON.stringify(liked));
    await supabaseClient.rpc('increment_comment_like', { target_id: Number(commentId) });
    await loadForumData();
}

async function deleteEvent(id) {
    await supabaseClient.from('forum_events').delete().eq('id', id);
    await loadForumData();
    showToast("Event post deleted.");
}

async function deleteTestimony(id) {
    await supabaseClient.from('testimonies').delete().eq('id', id);
    await loadForumData();
    showToast("Testimony deleted.");
}

async function deleteComment(id) {
    await supabaseClient.from('testimony_comments').delete().eq('id', id);
    await loadForumData();
    showToast("Comment deleted.");
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
        options: { redirectTo: `${window.location.origin}/forum.html` }
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

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
}