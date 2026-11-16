// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ADMIN_EMAIL = 'accordmedia1@gmail.com';

let testimoniesData = [];
let commentsByTestimony = {};
let currentForumCategory = 'All';
let currentUser = null;
let authMode = 'signin';

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
        if (testimoniesData.length > 0) renderTestimonies(getFilteredTestimonies());
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
    const { data: testimonies, error: testErr } = await supabaseClient
        .from('testimonies')
        .select('*')
        .eq('is_approved', true)
        .order('created_at', { ascending: false });

    const { data: comments, error: commErr } = await supabaseClient
        .from('testimony_comments')
        .select('*')
        .order('created_at', { ascending: true });

    document.getElementById('forum-loading')?.classList.add('hidden');

    commentsByTestimony = {};
    if (!commErr && comments) {
        comments.forEach(c => {
            if (!commentsByTestimony[c.testimony_id]) {
                commentsByTestimony[c.testimony_id] = [];
            }
            commentsByTestimony[c.testimony_id].push(c);
        });
    }

    if (!testErr && testimonies) {
        testimoniesData = testimonies;
        const countBadge = document.getElementById('testimony-total-count');
        if (countBadge) {
            countBadge.innerText = `${testimonies.length} ${testimonies.length === 1 ? 'Testimony' : 'Testimonies'} Shared`;
        }
        renderTestimonies(getFilteredTestimonies());
    }
}

function setForumCategory(category) {
    currentForumCategory = category;
    document.querySelectorAll('.fcat-btn').forEach(btn => {
        btn.className = "fcat-btn whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
    });
    const activeBtn = document.getElementById(`fcat-${category}`);
    if (activeBtn) {
        activeBtn.className = "fcat-btn whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm";
    }
    filterTestimonies();
}

function getFilteredTestimonies() {
    const query = (document.getElementById('forum-search')?.value || '').toLowerCase();
    return testimoniesData.filter(item => {
        const matchesCat = currentForumCategory === 'All' || item.category === currentForumCategory;
        const matchesQuery = item.title.toLowerCase().includes(query)
            || item.body.toLowerCase().includes(query)
            || item.author_name.toLowerCase().includes(query)
            || (item.location || '').toLowerCase().includes(query);
        return matchesCat && matchesQuery;
    });
}

function filterTestimonies() {
    renderTestimonies(getFilteredTestimonies());
}

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderTestimonies(list) {
    const feed = document.getElementById('testimonies-feed');
    const emptyState = document.getElementById('forum-empty');
    if (!feed) return;

    feed.innerHTML = '';

    if (list.length === 0) {
        emptyState?.classList.remove('hidden');
        return;
    } else {
        emptyState?.classList.add('hidden');
    }

    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');

    list.forEach(item => {
        const comments = commentsByTestimony[item.id] || [];
        const hasAmened = amenedIds.includes(Number(item.id));
        const canDeletePost = currentUser && ((item.user_id && currentUser.id === item.user_id) || currentUser.email === ADMIN_EMAIL);

        const initials = item.author_name
            .split(' ')
            .map(n => n[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();

        const commentsHtml = comments.length === 0
            ? `<p class="text-xs text-accord-muted italic py-2">No reflections yet — leave an encouraging comment below.</p>`
            : comments.map(c => {
                const canDeleteComment = currentUser && (currentUser.id === c.user_id || currentUser.email === ADMIN_EMAIL);
                return `
                    <div class="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5 flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-xs font-bold text-accord-slate">${escapeHTML(c.author_name)}</span>
                                <span class="text-[10px] text-accord-muted">• ${formatTimeAgo(c.created_at)}</span>
                            </div>
                            <p class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${escapeHTML(c.comment_text)}</p>
                        </div>
                        ${canDeleteComment ? `<button onclick="deleteComment(${c.id})" class="text-slate-400 hover:text-red-500 text-xs p-1 transition-colors" title="Delete comment"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    </div>
                `;
            }).join('');

        const card = document.createElement('article');
        card.className = "bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm transition-all space-y-5";
        card.innerHTML = `
            <!-- Author & Category Header -->
            <div class="flex items-start justify-between gap-4">
                <div class="flex items-center space-x-3.5">
                    <div class="w-11 h-11 rounded-2xl bg-accord-lightBlue text-accord-blue font-extrabold text-sm flex items-center justify-center shrink-0">
                        ${escapeHTML(initials || 'AC')}
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h4 class="font-bold text-accord-slate text-sm">${escapeHTML(item.author_name)}</h4>
                            ${item.location ? `<span class="text-xs text-accord-muted"><i class="fa-solid fa-location-dot text-[10px] mr-1 text-accord-blue"></i>${escapeHTML(item.location)}</span>` : ''}
                        </div>
                        <p class="text-[11px] text-accord-muted mt-0.5">Shared on ${formatTimeAgo(item.created_at)}</p>
                    </div>
                </div>

                <div class="flex items-center space-x-2">
                    <span class="bg-accord-goldLight text-accord-gold text-[10px] font-bold px-3 py-1 rounded-full">
                        ${escapeHTML(item.category)}
                    </span>
                    ${canDeletePost ? `<button onclick="deleteTestimony(${item.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors" title="Delete testimony"><i class="fa-solid fa-trash-can text-xs"></i></button>` : ''}
                </div>
            </div>

            <!-- Testimony Title & Full Story -->
            <div class="space-y-2.5">
                <h3 class="serif-heading text-xl sm:text-2xl font-bold text-accord-slate leading-snug">
                    ${escapeHTML(item.title)}
                </h3>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    ${escapeHTML(item.body)}
                </p>
            </div>

            <!-- Engagement Bar: Amen + Comment Count -->
            <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <button type="button" onclick="sendAmen(${item.id})" class="inline-flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${hasAmened ? 'bg-amber-50 border-accord-gold text-accord-gold' : 'bg-slate-50 hover:bg-amber-50 border-slate-200 text-accord-slate hover:border-accord-gold hover:text-accord-gold'}">
                        <i class="fa-solid fa-hands-praying"></i>
                        <span>Amen (${Number(item.amen_count) || 0})</span>
                    </button>
                    <span class="text-xs font-semibold text-accord-muted">
                        <i class="fa-regular fa-comment-dots mr-1 text-accord-blue"></i>
                        ${comments.length} ${comments.length === 1 ? 'Comment' : 'Comments'}
                    </span>
                </div>
            </div>

            <!-- Comments Section (Sign-in required to comment) -->
            <div class="pt-3 border-t border-slate-100 space-y-3">
                <div class="space-y-2.5">
                    ${commentsHtml}
                </div>

                <form onsubmit="handleCommentSubmit(event, ${item.id})" class="flex items-center gap-2 pt-1">
                    <input type="text" id="comment-input-${item.id}" required placeholder="${currentUser ? 'Write an encouraging comment or prayer...' : 'Sign in to comment on this testimony...'}" class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-accord-slate focus:outline-none focus:border-accord-blue focus:bg-white">
                    <button type="submit" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shrink-0">
                        Post
                    </button>
                </form>
            </div>
        `;
        feed.appendChild(card);
    });
}

// Open Testimony Modal for ANY visitor (no sign-in required to share a testimony)
function openTestimonyModal() {
    const modal = document.getElementById('testimony-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeTestimonyModal() {
    const modal = document.getElementById('testimony-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleTestimonySubmit(e) {
    e.preventDefault();

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
            author_name,
            location,
            title,
            category,
            body
        }]);

    btn.disabled = false;
    btn.innerText = 'Publish Testimony to Forum';

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
    showToast("Thank you! Your testimony has been published to the forum.");
}

// Commenting remains restricted to signed-in users
async function handleCommentSubmit(e, testimonyId) {
    e.preventDefault();
    if (!currentUser) {
        showToast("Please sign in to comment on testimonies.");
        openAuthModal();
        return;
    }

    const input = document.getElementById(`comment-input-${testimonyId}`);
    const commentText = input.value.trim();
    if (!commentText) return;

    const authorName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
    input.disabled = true;

    const { error } = await supabaseClient
        .from('testimony_comments')
        .insert([{
            testimony_id: Number(testimonyId),
            user_id: currentUser.id,
            author_name: authorName,
            comment_text: commentText
        }]);

    input.disabled = false;

    if (error) {
        showToast(`Could not post comment: ${error.message}`);
        return;
    }

    input.value = '';
    await loadForumData();
    showToast("Comment posted!");
}

async function sendAmen(testimonyId) {
    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    if (amenedIds.includes(Number(testimonyId))) {
        showToast("You already said Amen to this testimony!");
        return;
    }

    amenedIds.push(Number(testimonyId));
    localStorage.setItem('accord_amened_ids', JSON.stringify(amenedIds));

    await supabaseClient.rpc('increment_testimony_amen', { target_id: Number(testimonyId) });
    await loadForumData();
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