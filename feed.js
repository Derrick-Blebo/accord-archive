let currentTab = 'all';
let currentUser = null;
let currentProfile = null; // { account_type: 'normal_user' | 'ministry_minister', upgrade_status, full_name }
let allFeedPosts = [];
let likedPostIds = new Set();
let commentCountsByPost = {};

function getVoterKey() {
    if (currentUser?.id) return `user_${currentUser.id}`;
    let guestKey = localStorage.getItem('accord_guest_voter_key');
    if (!guestKey) {
        guestKey = 'guest_' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
        localStorage.setItem('accord_guest_voter_key', guestKey);
    }
    return guestKey;
}

document.addEventListener('DOMContentLoaded', async () => {
    await initFeedSession();
    await loadFeedPosts();
});

function isMinistryOrMinister(profile = currentProfile) {
    if (!profile) return false;
    return profile.account_type === 'ministry_minister' || profile.upgrade_status === 'approved';
}

function syncFeedAccountUI() {
    const verified = isMinistryOrMinister(currentProfile);
    const badge = document.getElementById('feed-profile-verified-badge') || document.getElementById('profile-verified-badge');
    const profileIcon = document.getElementById('feed-profile-icon') || document.getElementById('user-profile-icon');

    if (badge) {
        badge.classList.toggle('hidden', !verified);
    }

    if (currentUser && profileIcon && !profileIcon.querySelector('i, img')) {
        const displayName = currentProfile?.full_name || currentUser.email || 'U';
        profileIcon.textContent = displayName.charAt(0).toUpperCase();
    }
}

async function initFeedSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    const authLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');

    if (currentUser) {
        if (authLabel) authLabel.textContent = 'Account';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Account Settings';

        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('id, full_name, email, account_type, upgrade_status')
            .eq('id', currentUser.id)
            .maybeSingle();

        currentProfile = profile || {
            id: currentUser.id,
            full_name: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
            email: currentUser.email,
            account_type: 'normal_user',
            upgrade_status: 'none'
        };
    } else {
        currentProfile = null;
        if (authLabel) authLabel.textContent = 'Sign In';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Sign In / Create Account';
    }

    syncFeedAccountUI();
}

function handleAuthNavClick() {
    if (currentUser) {
        window.location.href = 'profile.html';
    } else {
        window.location.href = 'signin.html';
    }
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-lg'
            : 'fa-solid fa-circle-check text-accord-gold text-lg';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function setFeedTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.feed-tab-btn').forEach(btn => {
        btn.className = 'feed-tab-btn whitespace-nowrap px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-white text-accord-slate hover:bg-slate-100 border border-slate-200';
    });

    const activeBtn = document.getElementById(`tab-${tab}`);
    if (activeBtn) {
        activeBtn.className = 'feed-tab-btn whitespace-nowrap px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm';
    }

    renderFeedStream();
}

async function loadFeedPosts() {
    const streamContainer = document.getElementById('feed-stream');
    if (!streamContainer) return;

    streamContainer.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
            <i class="fa-solid fa-spinner fa-spin text-2xl text-accord-blue"></i>
            <p class="text-xs text-accord-muted font-medium">Loading fellowship feed...</p>
        </div>
    `;

    const [postsRes, likesRes, commentsRes] = await Promise.all([
        supabaseClient.from('feed_posts').select('*').eq('is_approved', true).order('created_at', { ascending: false }),
        supabaseClient.from('post_likes').select('post_id').eq('voter_key', getVoterKey()),
        supabaseClient.from('post_comments').select('post_id')
    ]);

    if (postsRes.error) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-2">
                <p class="text-xs font-bold text-red-600">Could not load feed posts.</p>
                <p class="text-xs text-accord-muted">${escapeHtml(postsRes.error.message)}</p>
            </div>
        `;
        return;
    }

    allFeedPosts = postsRes.data || [];
    likedPostIds = new Set((likesRes.data || []).map(l => String(l.post_id)));

    commentCountsByPost = {};
    (commentsRes.data || []).forEach(c => {
        const key = String(c.post_id);
        commentCountsByPost[key] = (commentCountsByPost[key] || 0) + 1;
    });

    renderFeedStream();
}

function renderFeedStream() {
    const streamContainer = document.getElementById('feed-stream');
    if (!streamContainer) return;

    const visiblePosts = currentTab === 'all'
        ? allFeedPosts
        : allFeedPosts.filter(p => p.post_type === currentTab);

    if (visiblePosts.length === 0) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
                <i class="fa-regular fa-folder-open text-3xl text-slate-300"></i>
                <h3 class="font-bold text-accord-slate text-sm">No posts in this category yet</h3>
                <p class="text-xs text-accord-muted">Select another tab or share a new post above.</p>
            </div>
        `;
        return;
    }

    streamContainer.innerHTML = '';
    visiblePosts.forEach(post => {
        streamContainer.appendChild(renderFeedCard(post));
    });
}

function getPostTypeMeta(type) {
    switch (type) {
        case 'video':
            return { label: 'Video', badgeClass: 'bg-blue-50 text-accord-blue border border-blue-200', icon: 'fa-video' };
        case 'audio':
            return { label: 'Audio', badgeClass: 'bg-amber-50 text-accord-gold border border-amber-200', icon: 'fa-podcast' };
        case 'text':
            return { label: 'Text Post', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: 'fa-align-left' };
        case 'testimony':
        default:
            return { label: 'Testimony', badgeClass: 'bg-rose-50 text-rose-600 border border-rose-200', icon: 'fa-heart' };
    }
}

function renderFeedCard(post) {
    const card = document.createElement('article');
    card.className = 'bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-sm space-y-4 hover:shadow-md transition-shadow';

    const postUrl = getPostShareUrl(post.id);
    const isLiked = likedPostIds.has(String(post.id));
    const likesCount = Number(post.likes_count) || 0;
    const commentsCount = commentCountsByPost[String(post.id)] || 0;
    const dateFormatted = post.created_at
        ? new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

    const displayAuthor = post.is_anonymous ? 'Anonymous' : (post.author_name || 'Anonymous');
    const isVerifiedAuthor = post.author_role === 'ministry_minister' && !post.is_anonymous;
    const ministryUrl = (isVerifiedAuthor && post.author_id)
        ? `ministry.html?id=${encodeURIComponent(post.author_id)}`
        : null;

    const roleBadge = isVerifiedAuthor
        ? `<span class="ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-accord-gold border border-amber-200"><i class="fa-solid fa-circle-check text-[9px]"></i>Ministry / Minister</span>`
        : '';

    const avatarInner = `
        <div class="relative w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-xs shrink-0">
            <span>${escapeHtml(displayAuthor.charAt(0).toUpperCase())}</span>
            ${isVerifiedAuthor ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-white"><i class="fa-solid fa-check text-[8px]"></i></span>` : ''}
        </div>
    `;

    const authorAvatarHtml = ministryUrl
        ? `<a href="${escapeHtml(ministryUrl)}" class="shrink-0 hover:opacity-90 transition-opacity" title="View ${escapeHtml(displayAuthor)}">${avatarInner}</a>`
        : avatarInner;

    const authorNameHtml = ministryUrl
        ? `<a href="${escapeHtml(ministryUrl)}" class="text-xs font-bold text-accord-slate hover:text-accord-blue hover:underline truncate">${escapeHtml(displayAuthor)}</a>`
        : `<h4 class="text-xs font-bold text-accord-slate truncate">${escapeHtml(displayAuthor)}</h4>`;

    const typeMeta = getPostTypeMeta(post.post_type);
    let mediaHtml = '';

    if (post.post_type === 'video' && post.media_url) {
        const embedUrl = getYouTubeEmbedUrl(post.media_url);
        mediaHtml = `
            <div class="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-inner">
                <iframe src="${escapeHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>
            </div>
        `;
    } else if (post.post_type === 'audio' && post.media_url) {
        const isDirectAudio = /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(post.media_url);
        mediaHtml = isDirectAudio
            ? `<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                   <audio controls src="${escapeHtml(post.media_url)}" class="w-full"></audio>
               </div>`
            : `<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center space-x-4">
                   <div class="w-12 h-12 bg-accord-goldLight rounded-xl flex items-center justify-center text-accord-gold shrink-0">
                       <i class="fa-solid fa-podcast text-xl"></i>
                   </div>
                   <div class="flex-grow min-w-0">
                       <p class="text-xs font-bold text-accord-slate truncate">Audio Stream</p>
                       <a href="${escapeHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-accord-blue font-semibold hover:underline truncate block">Listen on external platform →</a>
                   </div>
               </div>`;
    }

    const shareBtnLabel = isMobileShareContext() ? 'Share' : 'Copy Link';
    const shareBtnIcon = isMobileShareContext() ? 'fa-share-nodes' : 'fa-link';

    card.innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <div class="flex items-center space-x-3 min-w-0">
                ${authorAvatarHtml}
                <div class="min-w-0">
                    <div class="flex items-center flex-wrap">
                        ${authorNameHtml}
                        ${roleBadge}
                    </div>
                    <p class="text-[10px] text-accord-muted">${dateFormatted}</p>
                </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 ${typeMeta.badgeClass}">
                <i class="fa-solid ${typeMeta.icon} mr-1"></i>${typeMeta.label}
            </span>
        </div>

        <div class="space-y-2">
            <a href="${escapeHtml(postUrl)}" class="block group">
                <h3 class="serif-heading text-lg sm:text-xl font-bold text-accord-slate group-hover:text-accord-blue transition-colors">
                    ${escapeHtml(post.title)}
                </h3>
            </a>
            <p class="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap line-clamp-4">
                ${escapeHtml(post.body)}
            </p>
            <a href="${escapeHtml(postUrl)}" class="inline-flex items-center space-x-1 text-xs font-bold text-accord-blue hover:underline">
                <span>Open Post & Comments</span>
                <i class="fa-solid fa-arrow-right text-[10px]"></i>
            </a>
        </div>

        ${mediaHtml}

        <!-- Post Actions Bar: Like, Comments Link, Adaptive Share/Copy Link, Report/Flag -->
        <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex items-center space-x-2">
                <button type="button" onclick="togglePostLike('${post.id}')" id="like-btn-${post.id}" class="px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 ${isLiked ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200'}">
                    <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                    <span id="like-count-${post.id}">${likesCount}</span>
                </button>

                <a href="${escapeHtml(postUrl)}#comments-section" class="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200 font-bold transition-all flex items-center space-x-1.5">
                    <i class="fa-regular fa-comment"></i>
                    <span>${commentsCount}</span>
                </a>

                <button type="button" onclick="handleShareClick('${post.id}')" class="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-blue-50 text-accord-slate hover:text-accord-blue border border-slate-200 font-bold transition-all flex items-center space-x-1.5">
                    <i class="fa-solid ${shareBtnIcon}"></i>
                    <span>${shareBtnLabel}</span>
                </button>
            </div>

            <button type="button" onclick="openReportModal('${post.id}')" class="px-3 py-2 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 font-semibold transition-all flex items-center space-x-1.5" title="Report / Flag Post">
                <i class="fa-regular fa-flag"></i>
                <span>Flag</span>
            </button>
        </div>
    `;

    return card;
}

function handleShareClick(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (post) shareOrCopyPost(post);
}

async function togglePostLike(postId) {
    const voterKey = getVoterKey();
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post) return;

    const alreadyLiked = likedPostIds.has(String(postId));
    let nextCount = Number(post.likes_count) || 0;

    if (alreadyLiked) {
        await supabaseClient.from('post_likes').delete().eq('post_id', postId).eq('voter_key', voterKey);
        likedPostIds.delete(String(postId));
        nextCount = Math.max(0, nextCount - 1);
    } else {
        const { error } = await supabaseClient.from('post_likes').insert([{ post_id: postId, voter_key: voterKey }]);
        if (error) {
            showToast('Could not record like.', true);
            return;
        }
        likedPostIds.add(String(postId));
        nextCount += 1;
    }

    post.likes_count = nextCount;
    await supabaseClient.from('feed_posts').update({ likes_count: nextCount }).eq('id', postId);

    const countEl = document.getElementById(`like-count-${postId}`);
    const btnEl = document.getElementById(`like-btn-${postId}`);
    if (countEl) countEl.textContent = nextCount;
    if (btnEl) {
        btnEl.className = !alreadyLiked
            ? 'px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 bg-rose-50 text-rose-600 border border-rose-200'
            : 'px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200';
        const icon = btnEl.querySelector('i');
        if (icon) icon.className = !alreadyLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    }
}

function openCreatePostModal(defaultType = 'testimony') {
    const typeSelect = document.getElementById('post-type');
    if (typeSelect) typeSelect.value = defaultType;
    togglePostTypeFields();
    toggleAnonymousAuthorInput();

    const modal = document.getElementById('create-post-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeCreatePostModal() {
    const modal = document.getElementById('create-post-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
    document.getElementById('create-post-form')?.reset();
}

function togglePostTypeFields() {
    const type = document.getElementById('post-type')?.value || 'testimony';
    const urlGroup = document.getElementById('post-url-group');
    const urlInput = document.getElementById('post-url');
    const idBox = document.getElementById('testimony-identity-box');
    const noteEl = document.getElementById('create-post-permission-note');

    const needsUrl = type === 'video' || type === 'audio';
    urlGroup?.classList.toggle('hidden', !needsUrl);
    if (urlInput) urlInput.required = needsUrl;

    // Anonymous toggle applies to testimonies
    idBox?.classList.toggle('hidden', type !== 'testimony');

    if (type === 'testimony') {
        if (noteEl) noteEl.textContent = 'Testimonies can be shared by anyone, including anonymously.';
    } else if (!currentUser) {
        if (noteEl) noteEl.textContent = 'Sign in with a Ministry / Minister account to post Videos, Audio, or Text Posts.';
    } else if (!isMinistryOrMinister()) {
        if (noteEl) noteEl.textContent = 'Your account is a Normal User. Request a Ministry / Minister upgrade in Profile to publish Videos, Audio, or Text Posts.';
    } else {
        if (noteEl) noteEl.textContent = 'Verified Ministry / Minister account active: your post publishes directly to the feed.';
    }
}

function toggleAnonymousAuthorInput() {
    const isAnon = document.getElementById('post-anonymous')?.checked;
    const nameWrap = document.getElementById('guest-author-name-wrapper');
    nameWrap?.classList.toggle('hidden', Boolean(isAnon));
}

async function handleCreatePostSubmit(e) {
    e.preventDefault();

    const postType = document.getElementById('post-type').value;
    const title = document.getElementById('post-title').value.trim();
    const body = document.getElementById('post-content').value.trim();
    const mediaUrl = document.getElementById('post-url')?.value.trim() || null;
    const isAnonymous = postType === 'testimony' ? Boolean(document.getElementById('post-anonymous')?.checked) : false;
    const customName = document.getElementById('post-author-name')?.value.trim() || '';

    // Enforce permissions: Testimonies allow guests/anonymous; Video/Audio/Text require Ministry/Minister
    if (postType !== 'testimony') {
        if (!currentUser) {
            showToast('Please sign in with a Ministry / Minister account to post.', true);
            return;
        }
        if (!isMinistryOrMinister()) {
            showToast('Only Ministry / Minister accounts can publish Video, Audio, or Text Posts. Request an upgrade in Profile.', true);
            return;
        }
    }

    const submitBtn = document.getElementById('create-post-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Publishing...';
    }

    let authorName = 'Anonymous';
    if (!isAnonymous) {
        if (currentProfile?.full_name) {
            authorName = currentProfile.full_name;
        } else if (currentUser?.email) {
            authorName = currentUser.email.split('@')[0];
        } else if (customName) {
            authorName = customName;
        } else {
            authorName = 'Anonymous';
        }
    }

    const resolvedRole = currentUser
        ? (isMinistryOrMinister(currentProfile) ? 'ministry_minister' : (currentProfile?.account_type || 'normal_user'))
        : 'guest';

    const payload = {
        post_type: postType,
        title,
        body,
        media_url: (postType === 'video' || postType === 'audio') ? mediaUrl : null,
        author_id: currentUser ? currentUser.id : null,
        author_name: authorName,
        author_role: resolvedRole,
        is_anonymous: isAnonymous,
        is_approved: true
    };

    const { data, error } = await supabaseClient
        .from('feed_posts')
        .insert([payload])
        .select()
        .single();

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Publish to Feed';
    }

    if (error) {
        showToast(`Could not publish post: ${error.message}`, true);
        return;
    }

    closeCreatePostModal();
    showToast('Published to the feed!');
    if (data) {
        allFeedPosts.unshift(data);
        setFeedTab(postType);
    } else {
        await loadFeedPosts();
    }
}

function openReportModal(postId) {
    document.getElementById('report-post-id').value = postId;
    const modal = document.getElementById('report-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
    document.getElementById('report-form')?.reset();
}

async function handleReportSubmit(e) {
    e.preventDefault();
    const post_id = document.getElementById('report-post-id').value;
    const categoryReason = document.getElementById('report-category-reason').value;
    const details = document.getElementById('report-reason').value.trim();

    const { error } = await supabaseClient.from('post_reports').insert([{
        post_id,
        reporter_id: currentUser ? currentUser.id : null,
        reason: categoryReason,
        details
    }]);

    if (error) {
        showToast('Could not submit flag report.', true);
        return;
    }

    closeReportModal();
    showToast('Post flagged for moderation review.');
}

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
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}