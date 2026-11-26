// =========================================================
// ACCORD USER.JS — Unified Public Account Profile
// Followers, Following, Posts, Reposts, Testimonies & Activities
// =========================================================

let targetUserId = null;
let targetProfile = null;
let viewerUser = null;
let currentProfileTab = 'posts';

let followersList = [];
let followingList = [];
let isFollowingTarget = false;

let userOriginalPosts = [];
let userReposts = [];
let userTestimonies = [];
let userActivities = [];

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const { data: { session } } = await supabaseClient.auth.getSession();
    viewerUser = session?.user || null;

    targetUserId = params.get('id') || viewerUser?.id || null;
    if (!targetUserId) {
        showProfileNotFound();
        return;
    }

    await loadUnifiedProfile();
});

function showProfileNotFound() {
    document.getElementById('profile-loading')?.classList.add('hidden');
    document.getElementById('profile-not-found')?.classList.remove('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-base'
            : 'fa-solid fa-circle-check text-accord-gold text-base';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3500);
}

async function loadUnifiedProfile() {
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, bio, avatar_url, account_type, upgrade_status, created_at')
        .eq('id', targetUserId)
        .maybeSingle();

    if (error || !profile) {
        showProfileNotFound();
        return;
    }

    targetProfile = profile;
    const displayName = profile.full_name || 'Accord Member';
    document.title = `${displayName} — Accord Archive`;

    const [
        followersRes,
        followingRes,
        postsRes,
        repostsRes,
        postCommentsRes,
        bookCommentsRes
    ] = await Promise.all([
        supabaseClient
            .from('account_follows')
            .select('follower_id, created_at, profiles!account_follows_follower_id_fkey(id, full_name, account_type, upgrade_status)')
            .eq('following_id', targetUserId)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('account_follows')
            .select('following_id, created_at, profiles!account_follows_following_id_fkey(id, full_name, account_type, upgrade_status)')
            .eq('follower_id', targetUserId)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('feed_posts')
            .select('*')
            .eq('author_id', targetUserId)
            .eq('is_approved', true)
            .eq('is_anonymous', false)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('post_reposts')
            .select('id, post_id, quote_text, created_at, feed_posts(*)')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('post_comments')
            .select('id, post_id, body, created_at, feed_posts(id, title)')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false })
            .limit(20),
        supabaseClient
            .from('book_comments')
            .select('id, book_id, body, created_at, books(id, title)')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false })
            .limit(20)
    ]);

    followersList = (followersRes.data || []).map(r => r.profiles).filter(Boolean);
    followingList = (followingRes.data || []).map(r => r.profiles).filter(Boolean);

    const allAuthored = postsRes.data || [];
    userOriginalPosts = allAuthored.filter(p => p.post_type !== 'testimony');
    userTestimonies = allAuthored.filter(p => p.post_type === 'testimony');

    userReposts = (repostsRes.data || [])
        .filter(r => r.feed_posts && r.feed_posts.is_approved)
        .map(r => ({
            repost_id: r.id,
            quote_text: r.quote_text,
            reposted_at: r.created_at,
            post: r.feed_posts
        }));

    // Build chronological activities feed
    const activities = [];
    userReposts.forEach(r => {
        activities.push({
            type: 'repost',
            created_at: r.reposted_at,
            title: `Reposted "${r.post.title}"`,
            detail: r.quote_text || r.post.body,
            url: `post.html?id=${encodeURIComponent(r.post.id)}`
        });
    });
    (postCommentsRes.data || []).forEach(c => {
        activities.push({
            type: 'post_comment',
            created_at: c.created_at,
            title: `Commented on "${c.feed_posts?.title || 'a feed post'}"`,
            detail: c.body,
            url: `post.html?id=${encodeURIComponent(c.post_id)}`
        });
    });
    (bookCommentsRes.data || []).forEach(c => {
        activities.push({
            type: 'book_comment',
            created_at: c.created_at,
            title: `Reviewed "${c.books?.title || 'a book'}"`,
            detail: c.body,
            url: `book.html?id=${encodeURIComponent(c.book_id)}`
        });
    });
    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    userActivities = activities;

    isFollowingTarget = Boolean(
        viewerUser && followersList.some(f => f.id === viewerUser.id)
    );

    renderProfileHeader();
    renderProfileStream();

    document.getElementById('profile-loading')?.classList.add('hidden');
    document.getElementById('profile-header-card')?.classList.remove('hidden');
    document.getElementById('profile-tabs-bar')?.classList.remove('hidden');
    document.getElementById('profile-stream')?.classList.remove('hidden');
}

function renderProfileHeader() {
    const displayName = targetProfile.full_name || 'Accord Member';
    const isVerified = isVerifiedMinistryProfile(targetProfile);

    document.getElementById('profile-avatar-initial').textContent = displayName.charAt(0).toUpperCase();
    document.getElementById('profile-display-name').textContent = displayName;

    const verifiedIcon = document.getElementById('profile-verified-icon');
    const roleBadge = document.getElementById('profile-role-badge');
    if (isVerified) {
        if (verifiedIcon && typeof getVerifiedCheckmarkSvg === 'function') {
            verifiedIcon.innerHTML = getVerifiedCheckmarkSvg();
            verifiedIcon.classList.remove('hidden');
        }
        roleBadge?.classList.remove('hidden');
    } else {
        verifiedIcon?.classList.add('hidden');
        roleBadge?.classList.add('hidden');
    }

    const joinedEl = document.getElementById('profile-joined-date');
    if (joinedEl && targetProfile.created_at) {
        const joined = new Date(targetProfile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        joinedEl.textContent = `${isVerified ? 'Verified Ministry / Minister' : 'Community Member'} · Joined ${joined}`;
    }

    const bioEl = document.getElementById('profile-bio');
    if (bioEl) {
        if (targetProfile.bio && targetProfile.bio.trim()) {
            bioEl.textContent = targetProfile.bio.trim();
            bioEl.classList.remove('hidden');
        } else {
            bioEl.classList.add('hidden');
        }
    }

    document.getElementById('stat-followers').textContent = followersList.length;
    document.getElementById('stat-following').textContent = followingList.length;
    document.getElementById('stat-posts').textContent = userOriginalPosts.length + userReposts.length;

    const isSelf = viewerUser && viewerUser.id === targetUserId;
    document.getElementById('user-edit-btn')?.classList.toggle('hidden', !isSelf);
    document.getElementById('user-message-btn')?.classList.toggle('hidden', Boolean(isSelf));
    renderFollowButton();
}

function renderFollowButton() {
    const btn = document.getElementById('user-follow-btn');
    const icon = document.getElementById('user-follow-icon');
    const label = document.getElementById('user-follow-label');
    if (!btn || !icon || !label) return;

    if (viewerUser && viewerUser.id === targetUserId) {
        btn.classList.add('hidden');
        return;
    }

    btn.classList.remove('hidden');
    if (isFollowingTarget) {
        btn.className = 'px-5 py-2.5 rounded-xl border border-accord-blue bg-accord-lightBlue text-accord-blue hover:bg-blue-100 text-xs font-bold transition-all inline-flex items-center space-x-2';
        icon.className = 'fa-solid fa-user-check';
        label.textContent = 'Following';
    } else {
        btn.className = 'px-5 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all inline-flex items-center space-x-2';
        icon.className = 'fa-solid fa-user-plus';
        label.textContent = 'Follow';
    }
}

async function toggleFollowUser() {
    if (!viewerUser) {
        showToast('Please sign in to follow accounts.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent('user.html?id=' + targetUserId)}`;
        }, 800);
        return;
    }
    if (viewerUser.id === targetUserId) return;

    const btn = document.getElementById('user-follow-btn');
    if (btn) btn.disabled = true;

    if (isFollowingTarget) {
        const { error } = await supabaseClient
            .from('account_follows')
            .delete()
            .eq('follower_id', viewerUser.id)
            .eq('following_id', targetUserId);

        if (error) {
            showToast(`Could not unfollow: ${error.message}`, true);
        } else {
            isFollowingTarget = false;
            followersList = followersList.filter(f => f.id !== viewerUser.id);
            showToast(`Unfollowed ${targetProfile.full_name || 'user'}.`);
        }
    } else {
        const { error } = await supabaseClient
            .from('account_follows')
            .insert([{ follower_id: viewerUser.id, following_id: targetUserId }]);

        if (error) {
            showToast(`Could not follow: ${error.message}`, true);
        } else {
            isFollowingTarget = true;
            followersList.unshift({
                id: viewerUser.id,
                full_name: viewerUser.user_metadata?.full_name || viewerUser.email?.split('@')[0] || 'You'
            });
            showToast(`Now following ${targetProfile.full_name || 'user'}!`);
        }
    }

    if (btn) btn.disabled = false;
    document.getElementById('stat-followers').textContent = followersList.length;
    renderFollowButton();
}

function startDmWithUser() {
    if (!viewerUser) {
        showToast('Please sign in to send messages.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent('messages.html?dm=' + targetUserId)}`;
        }, 800);
        return;
    }
    window.location.href = `messages.html?dm=${encodeURIComponent(targetUserId)}`;
}

async function shareUserProfile() {
    const url = `${window.location.origin}/user.html?id=${encodeURIComponent(targetUserId)}`;
    if (typeof openShareToChatModal === 'function' && viewerUser) {
        openShareToChatModal({
            type: 'shared_profile',
            id: targetUserId,
            title: targetProfile.full_name || 'Accord Member',
            subtitle: isVerifiedMinistryProfile(targetProfile) ? 'Verified Ministry / Minister' : 'Accord Community Member',
            url,
            author_name: targetProfile.full_name || 'Accord Member'
        });
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Profile link copied to clipboard.');
    } catch {
        prompt('Copy profile link:', url);
    }
}

function openConnectionsModal(mode) {
    const modal = document.getElementById('connections-modal');
    const titleEl = document.getElementById('connections-modal-title');
    const listEl = document.getElementById('connections-modal-list');
    if (!modal || !titleEl || !listEl) return;

    const items = mode === 'followers' ? followersList : followingList;
    titleEl.textContent = mode === 'followers' ? `Followers (${items.length})` : `Following (${items.length})`;

    if (items.length === 0) {
        listEl.innerHTML = `<p class="py-8 text-center text-xs text-accord-muted">No ${mode} yet.</p>`;
    } else {
        listEl.innerHTML = items.map(acc => {
            const name = acc.full_name || 'Accord Member';
            const verified = isVerifiedMinistryProfile(acc);
            return `
                <a href="user.html?id=${encodeURIComponent(acc.id)}" class="flex items-center justify-between py-2.5 px-2 rounded-xl hover:bg-slate-50 transition-colors">
                    <div class="flex items-center space-x-3 min-w-0">
                        <div class="w-9 h-9 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                            ${escapeProfileHtml(name.charAt(0).toUpperCase())}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-accord-slate truncate flex items-center gap-1.5">
                                <span>${escapeProfileHtml(name)}</span>
                                ${verified ? '<i class="fa-solid fa-circle-check text-accord-blue text-[11px]" title="Verified"></i>' : ''}
                            </p>
                            <p class="text-[10px] text-accord-muted">${verified ? 'Verified Ministry' : 'Member'}</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-[10px] text-slate-400"></i>
                </a>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeConnectionsModal() {
    const modal = document.getElementById('connections-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function setProfileTab(tab) {
    currentProfileTab = tab;
    document.querySelectorAll('.ptab-btn').forEach(btn => {
        btn.className = 'ptab-btn px-5 py-2.5 rounded-xl text-xs font-bold bg-white text-accord-slate border border-slate-200 hover:bg-slate-100 transition-all';
    });
    const active = document.getElementById(`ptab-${tab}`);
    if (active) {
        active.className = 'ptab-btn px-5 py-2.5 rounded-xl text-xs font-bold bg-accord-blue text-white shadow-sm transition-all';
    }
    renderProfileStream();
}

function renderProfileStream() {
    const stream = document.getElementById('profile-stream');
    if (!stream) return;

    if (currentProfileTab === 'posts') {
        const combined = [
            ...userOriginalPosts.map(p => ({ kind: 'post', sortAt: p.created_at, post: p })),
            ...userReposts.map(r => ({ kind: 'repost', sortAt: r.reposted_at, post: r.post, quote: r.quote_text }))
        ].sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));

        if (combined.length === 0) {
            stream.innerHTML = emptyCard('fa-regular fa-newspaper', 'No posts or reposts yet', 'Posts by verified accounts and reposts will appear here.');
            return;
        }

        stream.innerHTML = combined.map(item => renderProfilePostCard(item)).join('');
        return;
    }

    if (currentProfileTab === 'testimonies') {
        if (userTestimonies.length === 0) {
            stream.innerHTML = emptyCard('fa-regular fa-heart', 'No testimonies shared yet', 'Public testimonies shared by this account will appear here.');
            return;
        }
        stream.innerHTML = userTestimonies.map(p => renderProfilePostCard({ kind: 'post', sortAt: p.created_at, post: p })).join('');
        return;
    }

    if (currentProfileTab === 'activities') {
        if (userActivities.length === 0) {
            stream.innerHTML = emptyCard('fa-solid fa-bolt', 'No recent activity', 'Reposts and comments on posts or books will appear here.');
            return;
        }
        stream.innerHTML = userActivities.map(act => {
            const icon = act.type === 'repost'
                ? 'fa-retweet text-emerald-600 bg-emerald-50'
                : act.type === 'book_comment'
                    ? 'fa-book-open text-accord-gold bg-accord-goldLight'
                    : 'fa-comment-dots text-accord-blue bg-accord-lightBlue';
            const dateStr = new Date(act.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return `
                <a href="${escapeProfileHtml(act.url)}" class="block bg-white border border-slate-200/90 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div class="flex items-start gap-3">
                        <div class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${icon}">
                            <i class="fa-solid ${icon.split(' ')[0]} text-xs"></i>
                        </div>
                        <div class="min-w-0 flex-1 space-y-1">
                            <p class="text-xs font-bold text-accord-slate">${escapeProfileHtml(act.title)}</p>
                            ${act.detail ? `<p class="text-xs text-accord-muted line-clamp-2">${escapeProfileHtml(act.detail)}</p>` : ''}
                            <p class="text-[10px] text-slate-400 font-semibold">${dateStr}</p>
                        </div>
                    </div>
                </a>
            `;
        }).join('');
    }
}

function renderProfilePostCard(item) {
    const p = item.post;
    const dateStr = new Date(item.sortAt || p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const repostBanner = item.kind === 'repost'
        ? `<div class="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 w-fit">
               <i class="fa-solid fa-retweet"></i>
               <span>${escapeProfileHtml(targetProfile.full_name || 'User')} reposted</span>
           </div>`
        : '';
    const quoteHtml = item.quote
        ? `<p class="text-xs italic text-accord-slate bg-slate-50 border-l-2 border-accord-blue pl-3 py-1.5 rounded-r-lg">"${escapeProfileHtml(item.quote)}"</p>`
        : '';

    return `
        <article class="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm space-y-3 hover:shadow-md transition-shadow">
            ${repostBanner}
            ${quoteHtml}
            <div class="flex items-center justify-between text-xs text-accord-muted">
                <span class="font-bold text-accord-slate">${escapeProfileHtml(p.author_name || 'Member')}</span>
                <span>${dateStr}</span>
            </div>
            <a href="post.html?id=${encodeURIComponent(p.id)}" class="block group">
                <h3 class="serif-heading text-lg font-bold text-accord-slate group-hover:text-accord-blue transition-colors">${escapeProfileHtml(p.title)}</h3>
            </a>
            <p class="text-xs sm:text-sm text-slate-700 line-clamp-3 whitespace-pre-wrap">${escapeProfileHtml(p.body)}</p>
            <div class="pt-2 flex items-center justify-between text-xs text-accord-muted">
                <div class="flex items-center gap-4">
                    <span><i class="fa-regular fa-heart mr-1"></i>${Number(p.likes_count) || 0}</span>
                    <span><i class="fa-solid fa-retweet mr-1"></i>${Number(p.reposts_count) || 0}</span>
                </div>
                <a href="post.html?id=${encodeURIComponent(p.id)}" class="font-bold text-accord-blue hover:underline">Open Post →</a>
            </div>
        </article>
    `;
}

function emptyCard(iconClass, title, subtitle) {
    return `
        <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-2">
            <i class="${iconClass} text-3xl text-slate-300"></i>
            <h3 class="text-sm font-bold text-accord-slate">${title}</h3>
            <p class="text-xs text-accord-muted">${subtitle}</p>
        </div>
    `;
}

function escapeProfileHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
