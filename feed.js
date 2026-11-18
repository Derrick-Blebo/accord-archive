// Initialize Supabase Client
// Replace these with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentTab = 'all';
let currentUser = null;
let savedItems = JSON.parse(localStorage.getItem('accord_saved_items')) || [];

document.addEventListener('DOMContentLoaded', async () => {
    await checkUserSession();
    updateBookmarkBadge();
    loadFeedData();
});

// --- AUTHENTICATION & UI SYNC ---
async function checkUserSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    
    const authLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');
    
    if (currentUser) {
        if (authLabel) authLabel.textContent = 'Account';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Account Settings';
    } else {
        if (authLabel) authLabel.textContent = 'Sign In';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Sign In / Create Account';
    }
}

function handleAuthNavClick() {
    if (currentUser) {
        window.location.href = 'profile.html';
    } else {
        window.location.href = 'signin.html';
    }
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.classList.toggle('hidden');
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    
    if (!toast) return;
    
    msgEl.textContent = message;
    if (isError) {
        iconEl.className = 'fa-solid fa-circle-exclamation text-red-500 text-lg';
    } else {
        iconEl.className = 'fa-solid fa-circle-check text-accord-gold text-lg';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

// --- TAB FILTERING ---
function setFeedTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.feed-tab-btn').forEach(btn => {
        btn.className = 'feed-tab-btn px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-white text-accord-slate hover:bg-slate-100 border border-slate-200';
    });
    
    const activeBtn = document.getElementById(`tab-${tab}`);
    if (activeBtn) {
        activeBtn.className = 'feed-tab-btn px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm';
    }
    
    loadFeedData();
}

// --- LOAD FEED DATA FROM SUPABASE ---
async function loadFeedData() {
    const streamContainer = document.getElementById('feed-stream');
    if (!streamContainer) return;

    streamContainer.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
            <i class="fa-solid fa-spinner fa-spin text-2xl text-accord-blue"></i>
            <p class="text-xs text-accord-muted font-medium">Loading fellowship stream...</p>
        </div>
    `;

    let query = supabaseClient.from('sermons').select('*').eq('status', 'published').eq('is_visible', true).order('created_at', { ascending: false });

    if (currentTab === 'sermons') {
        query = query.in('media_type', ['video', 'audio']);
    } else if (currentTab === 'video') {
        query = query.eq('media_type', 'video');
    } else if (currentTab === 'audio') {
        query = query.eq('media_type', 'audio');
    } else if (currentTab === 'text') {
        query = query.eq('media_type', 'text');
    }

    const { data, error } = await query;

    if (error) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-red-200 rounded-3xl p-8 text-center space-y-2">
                <i class="fa-solid fa-triangle-exclamation text-xl text-red-500"></i>
                <p class="text-xs font-bold text-accord-slate">Unable to load feed items.</p>
                <p class="text-[11px] text-accord-muted">Please check your network or database connection.</p>
            </div>
        `;
        return;
    }

    if (!data || data.length === 0) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
                <i class="fa-regular fa-folder-open text-3xl text-slate-300"></i>
                <h3 class="font-bold text-accord-slate text-sm">No posts found in this section</h3>
                <p class="text-xs text-accord-muted">Be the first to share a testimony, text sermon, or media link!</p>
            </div>
        `;
        return;
    }

    streamContainer.innerHTML = '';
    data.forEach(item => {
        streamContainer.appendChild(renderFeedCard(item));
    });
}

// --- RENDER INDIVIDUAL FEED CARD ---
function renderFeedCard(item) {
    const card = document.createElement('div');
    card.className = 'bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-sm space-y-4 hover:shadow-md transition-shadow';
    
    const isBookmarked = savedItems.some(i => i.id === item.id);
    const dateFormatted = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    let mediaContentHtml = '';

    if (item.media_type === 'video' && item.media_url) {
        const embedUrl = getYouTubeEmbedUrl(item.media_url);
        mediaContentHtml = `
            <div class="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-inner">
                <iframe src="${embedUrl}" class="w-full h-full border-0" allowfullscreen></iframe>
            </div>
        `;
    } else if (item.media_type === 'audio' && item.media_url) {
        mediaContentHtml = `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center space-x-4">
                <div class="w-12 h-12 bg-accord-goldLight rounded-xl flex items-center justify-center text-accord-gold shrink-0">
                    <i class="fa-solid fa-podcast text-xl"></i>
                </div>
                <div class="flex-grow min-w-0">
                    <p class="text-xs font-bold text-accord-slate truncate">Audio Stream / Spotify Episode</p>
                    <a href="${item.media_url}" target="_blank" class="text-[11px] text-accord-blue font-semibold hover:underline truncate block">Listen on external platform →</a>
                </div>
            </div>
        `;
    } else if (item.content) {
        mediaContentHtml = `
            <div class="text-xs sm:text-sm text-accord-slate leading-relaxed whitespace-pre-wrap bg-slate-50/70 border border-slate-100 rounded-2xl p-5">
                ${escapeHtml(item.content)}
            </div>
        `;
    }

    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-9 h-9 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-xs">
                    ${escapeHtml(item.author ? item.author.charAt(0).toUpperCase() : 'A')}
                </div>
                <div>
                    <h4 class="text-xs font-bold text-accord-slate">${escapeHtml(item.author || 'Anonymous Believer')}</h4>
                    <p class="text-[10px] text-accord-muted">${dateFormatted} • <span class="text-accord-blue font-medium">${escapeHtml(item.category)}</span></p>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button type="button" onclick="toggleBookmark('${item.id}', '${escapeHtml(item.title).replace(/'/g, "\\'")}', '${item.media_type}')" class="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors" title="Bookmark">
                    <i class="${isBookmarked ? 'fa-solid text-accord-gold' : 'fa-regular'} fa-bookmark text-xs"></i>
                </button>
                <button type="button" onclick="openReportModal('${item.id}')" class="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors" title="Report Spam">
                    <i class="fa-regular fa-flag text-xs"></i>
                </button>
            </div>
        </div>

        <div>
            <h3 class="serif-heading text-lg font-bold text-accord-slate">${escapeHtml(item.title)}</h3>
        </div>

        ${mediaContentHtml}
    `;

    return card;
}

// --- HELPER: YOUTUBE EMBED URL PARSER ---
function getYouTubeEmbedUrl(url) {
    let videoId = '';
    if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1]?.split('?')[0];
    } else if (url.includes('watch?v=')) {
        videoId = url.split('watch?v=')[1]?.split('&')[0];
    } else if (url.includes('embed/')) {
        videoId = url.split('embed/')[1]?.split('?')[0];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- MODAL CONTROLS ---
function openCreatePostModal() {
    if (!currentUser) {
        showToast('Please sign in to share a post or testimony.', true);
        setTimeout(() => window.location.href = 'signin.html', 1500);
        return;
    }
    document.getElementById('create-post-modal').classList.remove('hidden');
    document.getElementById('create-post-modal').classList.add('flex');
}

function closeCreatePostModal() {
    document.getElementById('create-post-modal').classList.remove('flex');
    document.getElementById('create-post-modal').classList.add('hidden');
    document.getElementById('create-post-form').reset();
}

function togglePostTypeFields() {
    const type = document.getElementById('post-type').value;
    const urlGroup = document.getElementById('post-url-group');
    const contentGroup = document.getElementById('post-content-group');

    if (type === 'text') {
        urlGroup.classList.add('hidden');
        contentGroup.classList.remove('hidden');
    } else {
        urlGroup.classList.remove('hidden');
        contentGroup.classList.add('hidden');
    }
}

// --- SUBMIT NEW POST ---
async function handleCreatePostSubmit(e) {
    e.preventDefault();
    if (!currentUser) {
        showToast('You must be signed in to post.', true);
        return;
    }

    const title = document.getElementById('post-title').value.trim();
    const media_type = document.getElementById('post-type').value;
    const category = document.getElementById('post-category').value.trim();
    const media_url = document.getElementById('post-url').value.trim();
    const content = document.getElementById('post-content').value.trim();

    const { error } = await supabaseClient.from('sermons').insert([{
        title,
        media_type,
        category,
        media_url: media_type === 'text' ? null : media_url,
        content: media_type === 'text' ? content : null,
        author: currentUser.email.split('@')[0],
        user_id: currentUser.id,
        status: media_type === 'text' ? 'published' : 'pending', // Text posts publish instantly, link submissions go to admin queue
        is_visible: true
    }]);

    if (error) {
        showToast('Error publishing post. Please try again.', true);
        return;
    }

    closeCreatePostModal();
    if (media_type === 'text') {
        showToast('Your post has been published to the feed!');
        loadFeedData();
    } else {
        showToast('Media link submitted successfully! Pending admin review.');
    }
}

// --- REPORT SPAM MODAL & SUBMISSION ---
function openReportModal(postId) {
    if (!currentUser) {
        showToast('Please sign in to report posts.', true);
        return;
    }
    document.getElementById('report-post-id').value = postId;
    document.getElementById('report-modal').classList.remove('hidden');
    document.getElementById('report-modal').classList.add('flex');
}

function closeReportModal() {
    document.getElementById('report-modal').classList.remove('flex');
    document.getElementById('report-modal').classList.add('hidden');
    document.getElementById('report-form').reset();
}

async function handleReportSubmit(e) {
    e.preventDefault();
    const sermon_id = document.getElementById('report-post-id').value;
    const reason = document.getElementById('report-reason').value.trim();

    const { error } = await supabaseClient.from('post_reports').insert([{
        sermon_id,
        user_id: currentUser.id,
        reason
    }]);

    if (error) {
        showToast('Failed to submit report.', true);
        return;
    }

    closeReportModal();
    showToast('Post reported successfully. Thank you for keeping Accord clean.');
}

// --- BOOKMARK MANAGEMENT ---
function toggleBookmark(id, title, type) {
    const index = savedItems.findIndex(i => i.id === id);
    if (index > -1) {
        savedItems.splice(index, 1);
        showToast('Removed from saved items.');
    } else {
        savedItems.push({ id, title, type, saved_at: new Date().toISOString() });
        showToast('Saved to your reading/media list!');
    }
    localStorage.setItem('accord_saved_items', JSON.stringify(savedItems));
    updateBookmarkBadge();
    loadFeedData();
}

function updateBookmarkBadge() {
    const badge = document.getElementById('bookmark-badge');
    const mobileBadge = document.getElementById('mobile-bookmark-count');
    const count = savedItems.length;
    if (badge) badge.textContent = count;
    if (mobileBadge) mobileBadge.textContent = count;
}