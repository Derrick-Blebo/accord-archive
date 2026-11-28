function getPostShareUrl(postId) {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}post.html?id=${encodeURIComponent(postId)}`;
}

function isMobileShareContext() {
    const isSmallScreen = window.innerWidth < 768;
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return (isSmallScreen || isMobileUA) && typeof navigator.share === 'function';
}

async function shareOrCopyPost(post) {
    const url = getPostShareUrl(post.id);
    if (isMobileShareContext()) {
        try {
            await navigator.share({
                title: post.is_anonymous ? 'Accord Fellowship Post' : `${post.author_name || 'Accord'} on Accord`,
                text: `Check out this ${post.post_type} on Accord Archive:`,
                url
            });
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }

    try {
        await navigator.clipboard.writeText(url);
        if (typeof showToast === 'function') showToast('Unique post link copied to clipboard.');
    } catch {
        prompt('Copy this post link:', url);
    }
}

// ==========================================
// REUSABLE SAVE POST HELPERS (ALL POST TYPES)
// ==========================================

window._sharedSavedPostIds = window._sharedSavedPostIds || new Set();

function getSavedPostsStorageKey(userId) {
    return userId ? `accord_saved_posts_${userId}` : 'accord_saved_posts_guest';
}

function readLocalSavedPostIds(userId) {
    if (!userId) return [];
    try {
        const raw = localStorage.getItem(getSavedPostsStorageKey(userId));
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
        return [];
    }
}

function writeLocalSavedPostIds(userId, idsSet) {
    if (!userId) return;
    try {
        localStorage.setItem(getSavedPostsStorageKey(userId), JSON.stringify(Array.from(idsSet)));
    } catch {}
}

function isPostSavedShared(postId) {
    if (!postId) return false;
    return window._sharedSavedPostIds instanceof Set && window._sharedSavedPostIds.has(String(postId));
}

function updateSharedSavePostButtons(postId, isSaved) {
    const idStr = String(postId);
    document.querySelectorAll(`[data-save-post-btn="${CSS.escape(idStr)}"]`).forEach(btn => {
        btn.setAttribute('aria-label', isSaved ? 'Remove from Saved' : 'Save Post');
        btn.setAttribute('title', isSaved ? 'Saved' : 'Save Post');
        const variant = btn.dataset.saveBtnVariant || 'card';
        if (variant === 'ministry') {
            btn.className = isSaved
                ? 'px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 bg-amber-50 text-accord-gold border border-amber-200'
                : 'px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200';
        } else {
            btn.className = isSaved
                ? 'w-8 h-8 rounded-full hover:bg-amber-50 flex items-center justify-center transition-colors text-accord-gold'
                : 'w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors text-slate-400 hover:text-accord-slate';
        }
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = isSaved ? 'fa-solid fa-bookmark text-sm' : 'fa-regular fa-bookmark text-sm';
        }
    });

    document.querySelectorAll(`[data-save-post-menu-btn="${CSS.escape(idStr)}"]`).forEach(btn => {
        const icon = btn.querySelector('i');
        const label = btn.querySelector('span');
        if (icon) {
            icon.className = isSaved
                ? 'fa-solid fa-bookmark w-3.5 text-center text-accord-gold'
                : 'fa-regular fa-bookmark w-3.5 text-center text-accord-gold';
        }
        if (label) {
            label.textContent = isSaved ? 'Saved (Remove)' : 'Save Post';
        }
    });
}

async function loadSharedSavedPostIds(userId) {
    if (!userId) {
        window._sharedSavedPostIds = new Set();
        return window._sharedSavedPostIds;
    }

    const localIds = readLocalSavedPostIds(userId);
    const merged = new Set(localIds);

    const client = window.supabaseClient;
    if (client) {
        try {
            const { data, error } = await client
                .from('user_saved_posts')
                .select('post_id')
                .eq('user_id', userId);
            if (!error && Array.isArray(data)) {
                const remoteIds = data.map(r => String(r.post_id));
                const nextSet = new Set(remoteIds);
                localIds.forEach(id => nextSet.add(id));
                window._sharedSavedPostIds = nextSet;
                writeLocalSavedPostIds(userId, nextSet);
                return nextSet;
            }
        } catch {}
    }

    window._sharedSavedPostIds = merged;
    return merged;
}

async function toggleSavePost(postId) {
    if (!postId) return;
    const idStr = String(postId);
    const client = window.supabaseClient;

    let userId = window.currentFeedUserId || null;
    if (!userId && client?.auth?.getSession) {
        try {
            const { data: { session } } = await client.auth.getSession();
            userId = session?.user?.id || null;
        } catch {}
    }

    if (!userId) {
        if (typeof showToast === 'function') {
            showToast('Please sign in to save posts.', true);
        }
        const nextUrl = encodeURIComponent((window.location.pathname.split('/').pop() || 'feed.html') + window.location.search);
        setTimeout(() => { window.location.href = `signin.html?next=${nextUrl}`; }, 800);
        return;
    }

    if (!(window._sharedSavedPostIds instanceof Set)) {
        window._sharedSavedPostIds = new Set(readLocalSavedPostIds(userId));
    }

    const wasSaved = window._sharedSavedPostIds.has(idStr);
    const nowSaved = !wasSaved;

    if (nowSaved) {
        window._sharedSavedPostIds.add(idStr);
    } else {
        window._sharedSavedPostIds.delete(idStr);
    }
    writeLocalSavedPostIds(userId, window._sharedSavedPostIds);
    updateSharedSavePostButtons(idStr, nowSaved);

    if (client) {
        try {
            if (nowSaved) {
                const { error } = await client
                    .from('user_saved_posts')
                    .upsert({ user_id: userId, post_id: idStr }, { onConflict: 'user_id,post_id' });
                if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
                    console.warn('Could not sync saved post to Supabase:', error.message);
                }
            } else {
                const { error } = await client
                    .from('user_saved_posts')
                    .delete()
                    .eq('user_id', userId)
                    .eq('post_id', idStr);
                if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
                    console.warn('Could not remove saved post from Supabase:', error.message);
                }
            }
        } catch {}
    }

    if (typeof showToast === 'function') {
        showToast(nowSaved ? 'Post saved to your library.' : 'Removed from saved posts.');
    }
}

window.loadSharedSavedPostIds = loadSharedSavedPostIds;
window.isPostSavedShared = isPostSavedShared;
window.updateSharedSavePostButtons = updateSharedSavePostButtons;
window.toggleSavePost = toggleSavePost;

// ==========================================
// REUSABLE "SEND TO CHAT" MODAL
// Works on feed.html, post.html, index.html, book.html, user.html
// ==========================================

let _shareToChatPayload = null;
let _shareConversationsCache = [];
let _shareUsersCache = [];
let _shareCurrentUser = null;

function ensureShareToChatModalDom() {
    if (document.getElementById('accord-share-chat-modal')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'accord-share-chat-modal';
    wrapper.className = 'fixed inset-0 z-50 bg-accord-slate/70 backdrop-blur-sm hidden items-center justify-center p-4';
    wrapper.innerHTML = `
        <div class="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onclick="event.stopPropagation()">
            <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                    <h3 class="font-bold text-accord-slate text-base">Send to Chat</h3>
                    <p id="share-chat-item-label" class="text-[11px] text-accord-muted truncate max-w-[260px]"></p>
                </div>
                <button type="button" onclick="closeShareToChatModal()" class="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="p-4 space-y-3 border-b border-slate-100">
                <input type="text" id="share-chat-search" oninput="renderShareToChatTargets()" placeholder="Search conversations or people..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-[16px] sm:text-xs focus:outline-none focus:border-accord-blue">
                <input type="text" id="share-chat-note" placeholder="Add an optional message..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-[16px] sm:text-xs focus:outline-none focus:border-accord-blue">
            </div>
            <div id="share-chat-targets" class="p-3 overflow-y-auto space-y-1.5 max-h-72">
                <p class="py-6 text-center text-xs text-accord-muted">Loading chats...</p>
            </div>
        </div>
    `;
    wrapper.addEventListener('click', closeShareToChatModal);
    document.body.appendChild(wrapper);
}

async function openShareToChatModal(itemMeta) {
    const client = window.supabaseClient;
    if (!client) return;

    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
        if (typeof showToast === 'function') showToast('Please sign in to share in chat.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search)}`;
        }, 700);
        return;
    }

    _shareCurrentUser = session.user;
    _shareToChatPayload = itemMeta;
    ensureShareToChatModalDom();

    const labelEl = document.getElementById('share-chat-item-label');
    if (labelEl) labelEl.textContent = itemMeta?.title || 'Shared Item';
    const noteEl = document.getElementById('share-chat-note');
    if (noteEl) noteEl.value = '';
    const searchEl = document.getElementById('share-chat-search');
    if (searchEl) searchEl.value = '';

    const modal = document.getElementById('accord-share-chat-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');

    const targetsEl = document.getElementById('share-chat-targets');
    if (targetsEl) targetsEl.innerHTML = '<p class="py-6 text-center text-xs text-accord-muted">Loading chats...</p>';

    const [membershipsRes, profilesRes] = await Promise.all([
        client
            .from('conversation_members')
            .select('conversation_id, conversations(id, is_group, title, last_message_at)')
            .eq('user_id', _shareCurrentUser.id),
        client
            .from('profiles')
            .select('id, full_name, account_type, upgrade_status')
            .neq('id', _shareCurrentUser.id)
            .order('full_name', { ascending: true })
            .limit(40)
    ]);

    const convRows = (membershipsRes.data || []).map(m => m.conversations).filter(Boolean);
    const convIds = convRows.map(c => c.id);

    // Fetch other members for DM display names
    let dmPartnerByConv = {};
    if (convIds.length > 0) {
        const { data: allMembers } = await client
            .from('conversation_members')
            .select('conversation_id, user_id, profiles(id, full_name)')
            .in('conversation_id', convIds)
            .neq('user_id', _shareCurrentUser.id);

        (allMembers || []).forEach(m => {
            if (!dmPartnerByConv[m.conversation_id] && m.profiles) {
                dmPartnerByConv[m.conversation_id] = m.profiles.full_name || 'Member';
            }
        });
    }

    _shareConversationsCache = convRows
        .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
        .map(c => ({
            id: c.id,
            is_group: c.is_group,
            name: c.is_group ? (c.title || 'Group Chat') : (dmPartnerByConv[c.id] || 'Direct Message')
        }));

    _shareUsersCache = profilesRes.data || [];
    renderShareToChatTargets();
}

function renderShareToChatTargets() {
    const targetsEl = document.getElementById('share-chat-targets');
    if (!targetsEl) return;
    const q = (document.getElementById('share-chat-search')?.value || '').trim().toLowerCase();

    const filteredConvs = _shareConversationsCache.filter(c => c.name.toLowerCase().includes(q));
    const filteredUsers = _shareUsersCache.filter(u => (u.full_name || '').toLowerCase().includes(q));

    let html = '';
    if (filteredConvs.length > 0) {
        html += `<p class="px-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-accord-muted">Recent Chats</p>`;
        html += filteredConvs.map(c => `
            <button type="button" onclick="sendSharedItemToConversation('${c.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left">
                <div class="flex items-center space-x-3 min-w-0">
                    <div class="w-9 h-9 rounded-full ${c.is_group ? 'bg-amber-50 text-accord-gold' : 'bg-accord-lightBlue text-accord-blue'} font-bold text-xs flex items-center justify-center shrink-0">
                        <i class="fa-solid ${c.is_group ? 'fa-users' : 'fa-user'}"></i>
                    </div>
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-accord-slate truncate">${escapeShareHtml(c.name)}</p>
                        <p class="text-[10px] text-accord-muted">${c.is_group ? 'Group Chat' : 'Direct Message'}</p>
                    </div>
                </div>
                <span class="px-3 py-1 rounded-lg bg-accord-blue text-white text-[11px] font-bold shrink-0">Send</span>
            </button>
        `).join('');
    }

    if (filteredUsers.length > 0) {
        html += `<p class="px-2 pt-2 text-[10px] font-bold uppercase tracking-wider text-accord-muted">People</p>`;
        html += filteredUsers.map(u => {
            const name = u.full_name || 'Accord Member';
            return `
                <button type="button" onclick="sendSharedItemToUser('${u.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left">
                    <div class="flex items-center space-x-3 min-w-0">
                        <div class="w-9 h-9 rounded-full bg-slate-100 text-accord-slate font-bold text-xs flex items-center justify-center shrink-0">
                            ${escapeShareHtml(name.charAt(0).toUpperCase())}
                        </div>
                        <p class="text-xs font-bold text-accord-slate truncate">${escapeShareHtml(name)}</p>
                    </div>
                    <span class="px-3 py-1 rounded-lg bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate text-[11px] font-bold transition-colors shrink-0">Send</span>
                </button>
            `;
        }).join('');
    }

    if (!html) {
        html = `<p class="py-6 text-center text-xs text-accord-muted">No matching chats or people found.</p>`;
    }
    targetsEl.innerHTML = html;
}

async function sendSharedItemToUser(targetUserId) {
    const client = window.supabaseClient;
    if (!client || !_shareToChatPayload) return;

    const { data: convId, error } = await client.rpc('get_or_create_dm', { target_user_id: targetUserId });
    if (error || !convId) {
        if (typeof showToast === 'function') showToast(error?.message || 'Could not start chat.', true);
        return;
    }
    await sendSharedItemToConversation(convId);
}

async function sendSharedItemToConversation(conversationId) {
    const client = window.supabaseClient;
    if (!client || !_shareCurrentUser || !_shareToChatPayload) return;

    const note = document.getElementById('share-chat-note')?.value.trim() || '';
    const { error } = await client.from('chat_messages').insert([{
        conversation_id: conversationId,
        sender_id: _shareCurrentUser.id,
        message_type: _shareToChatPayload.type || 'shared_post',
        body: note || null,
        attachment_meta: {
            id: _shareToChatPayload.id,
            title: _shareToChatPayload.title,
            subtitle: _shareToChatPayload.subtitle || '',
            url: _shareToChatPayload.url,
            image_url: _shareToChatPayload.image_url || '',
            media_url: _shareToChatPayload.media_url || '',
            author_name: _shareToChatPayload.author_name || '',
            post_type: _shareToChatPayload.post_type || ''
        }
    }]);

    if (error) {
        if (typeof showToast === 'function') showToast(`Could not send: ${error.message}`, true);
        return;
    }

    closeShareToChatModal();
    if (typeof showToast === 'function') showToast('Sent to chat!');
}

function closeShareToChatModal() {
    const modal = document.getElementById('accord-share-chat-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function escapeShareHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==========================================
// SHARED FACEBOOK-STYLE POST CARD RENDERER
// Used by feed.html, user.html, and post.html
// ==========================================

function getSharedPostTypeMeta(type) {
    switch (type) {
        case 'video':
            return { label: 'Video', badgeClass: 'bg-blue-50 text-accord-blue border border-blue-200', icon: 'fa-video', textColor: 'text-accord-blue' };
        case 'audio':
            return { label: 'Audio', badgeClass: 'bg-amber-50 text-accord-gold border border-amber-200', icon: 'fa-circle-play', textColor: 'text-accord-gold' };
        case 'text':
            return { label: 'Text Post', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: 'fa-align-left', textColor: 'text-emerald-600' };
        case 'testimony':
        default:
            return { label: 'Testimony', badgeClass: 'bg-rose-50 text-rose-600 border border-rose-200', icon: 'fa-heart', textColor: 'text-rose-600' };
    }
}

function formatSharedFeedTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function extractSharedYouTubeVideoId(url) {
    if (!url) return '';
    const str = String(url).trim();
    let videoId = '';
    if (str.includes('youtu.be/')) videoId = str.split('youtu.be/')[1]?.split(/[?&#]/)[0];
    else if (str.includes('watch?v=')) videoId = str.split('watch?v=')[1]?.split(/[&?#]/)[0];
    else if (str.includes('embed/')) videoId = str.split('embed/')[1]?.split(/[?&#]/)[0];
    else if (str.includes('/shorts/')) videoId = str.split('/shorts/')[1]?.split(/[?&#]/)[0];
    else if (str.includes('/live/')) videoId = str.split('/live/')[1]?.split(/[?&#]/)[0];
    return videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId) ? videoId : '';
}

function getSharedYouTubeEmbedUrl(url) {
    if (!url) return '';
    const videoId = extractSharedYouTubeVideoId(url);
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
}

function getSharedVideoThumbnailUrl(url) {
    const videoId = extractSharedYouTubeVideoId(url);
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '';
}

function extractSharedBookId(text) {
    if (!text) return null;
    const m = String(text).match(/(?:book\.html\?(?:[^#\s]*&)?(?:id|book)=|[?&]book=)(\d+)/i);
    return m ? m[1] : null;
}

function getSharedAudioPlatformInfo(url) {
    const raw = String(url || '').toLowerCase();
    if (raw.includes('podcasts.apple.com')) {
        return { key: 'apple_podcasts', label: 'Apple Podcasts', icon: 'fa-solid fa-podcast', color: 'text-purple-600 bg-purple-50' };
    }
    if (raw.includes('music.apple.com')) {
        return { key: 'apple_music', label: 'Apple Music', icon: 'fa-brands fa-apple', color: 'text-rose-600 bg-rose-50' };
    }
    if (raw.includes('open.spotify.com') || raw.includes('spotify.com')) {
        return { key: 'spotify', label: 'Spotify', icon: 'fa-brands fa-spotify', color: 'text-emerald-600 bg-emerald-50' };
    }
    if (raw.includes('audiomack.com')) {
        return { key: 'audiomack', label: 'Audiomack', icon: 'fa-solid fa-headphones', color: 'text-amber-600 bg-amber-50' };
    }
    if (raw.includes('soundcloud.com')) {
        return { key: 'soundcloud', label: 'SoundCloud', icon: 'fa-brands fa-soundcloud', color: 'text-orange-600 bg-orange-50' };
    }
    if (raw.includes('youtube.com') || raw.includes('youtu.be') || raw.includes('music.youtube.com')) {
        return { key: 'youtube', label: 'YouTube', icon: 'fa-brands fa-youtube', color: 'text-red-600 bg-red-50' };
    }
    return { key: 'audio', label: 'Audio Stream', icon: 'fa-solid fa-circle-play', color: 'text-accord-gold bg-accord-goldLight' };
}

function getSharedAudioPlaybackPreference() {
    if (window.AccordAudioEmbed && typeof window.AccordAudioEmbed.getPlaybackPreference === 'function') {
        return window.AccordAudioEmbed.getPlaybackPreference();
    }
    try {
        return localStorage.getItem('accord_audio_playback_pref') === 'external' ? 'external' : 'in_app';
    } catch {
        return 'in_app';
    }
}

function setSharedAudioPlaybackPreference(pref) {
    const normalized = pref === 'external' ? 'external' : 'in_app';
    if (window.AccordAudioEmbed && typeof window.AccordAudioEmbed.setPlaybackPreference === 'function') {
        window.AccordAudioEmbed.setPlaybackPreference(normalized);
        return normalized;
    }
    try {
        localStorage.setItem('accord_audio_playback_pref', normalized);
    } catch {}
    return normalized;
}

function resolveSharedAudioTarget(url) {
    const rawUrl = String(url || '').trim();
    if (window.AccordAudioEmbed && typeof window.AccordAudioEmbed.resolveInAppAudioTarget === 'function') {
        return window.AccordAudioEmbed.resolveInAppAudioTarget(rawUrl);
    }
    const isDirectAudio = /\.(mp3|wav|ogg|m4a|aac|flac|opus)([?#]|$)/i.test(rawUrl);
    const pInfo = getSharedAudioPlatformInfo(rawUrl);
    return {
        kind: isDirectAudio ? 'audio' : 'external',
        embedUrl: isDirectAudio ? rawUrl : '',
        rawUrl,
        platform: pInfo.key,
        label: pInfo.label,
        icon: pInfo.icon,
        height: 360
    };
}

function renderSharedEmbeddedPlayerHtml(target, opts = {}) {
    if (window.AccordAudioEmbed && typeof window.AccordAudioEmbed.renderEmbeddedPlayerHtml === 'function') {
        return window.AccordAudioEmbed.renderEmbeddedPlayerHtml(target, opts);
    }
    if (!target || !target.embedUrl) return '';
    if (target.kind === 'audio') {
        const autoplayAttr = opts && opts.autoplay ? ' autoplay' : '';
        return `<audio controls preload="none"${autoplayAttr} src="${escapeShareHtml(target.embedUrl)}" class="w-full"></audio>`;
    }
    if (target.kind === 'iframe') {
        const height = Number(target.height) || 360;
        const title = escapeShareHtml(opts.title || target.label || 'Audio Player');
        return `<iframe src="${escapeShareHtml(target.embedUrl)}" title="${title}" style="height:${height}px;" class="block w-full border-0 rounded-lg bg-white" loading="lazy" allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"></iframe>`;
    }
    return '';
}

function mountSharedEmbeddedPlayer(containerEl, target, opts = {}) {
    if (!containerEl) return;
    if (window.AccordAudioEmbed && typeof window.AccordAudioEmbed.mountEmbeddedPlayer === 'function') {
        window.AccordAudioEmbed.mountEmbeddedPlayer(containerEl, target, opts);
        return;
    }
    containerEl.innerHTML = renderSharedEmbeddedPlayerHtml(target, opts);
    if (opts && opts.autoplay) {
        const audioEl = containerEl.querySelector('audio');
        if (audioEl && typeof audioEl.play === 'function') {
            audioEl.play().catch(() => {});
        }
    }
}

function syncSharedAudioPrefButtons(panel, pref) {
    const buttons = panel.querySelectorAll('[data-audio-pref-btn]');
    buttons.forEach(btn => {
        const isActive = btn.getAttribute('data-audio-pref-btn') === pref;
        btn.className = isActive
            ? 'px-2 py-0.5 rounded-md text-[11px] font-bold bg-accord-blue text-white transition-colors'
            : 'px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors';
    });
}

function bindSharedAudioCardInteractions(card, target, title) {
    const audioCard = card.querySelector('[data-audio-card]');
    if (!audioCard || !target) return;

    const panel = audioCard.querySelector('[data-audio-player-panel]');
    const playerBody = audioCard.querySelector('[data-audio-player-body]');
    const playBtn = audioCard.querySelector('[data-audio-play-btn]');
    const primaryTrigger = audioCard.querySelector('[data-audio-primary-trigger]');

    const collapseAudioCardPanel = (targetAudioCard) => {
        if (!targetAudioCard) return;
        const p = targetAudioCard.querySelector('[data-audio-player-panel]');
        const pb = targetAudioCard.querySelector('[data-audio-player-body]');
        const btn = targetAudioCard.querySelector('[data-audio-play-btn]');
        if (p) p.classList.add('hidden');
        if (pb) {
            pb.innerHTML = '';
            delete pb.dataset.loaded;
        }
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-play text-[11px]"></i><span>Play in App</span>';
        }
    };

    const toggleInlinePlayer = () => {
        if (!panel || !playerBody || target.kind === 'external') return;
        const isHidden = panel.classList.contains('hidden');
        if (isHidden) {
            if (typeof pauseAllOtherAccordMedia === 'function') {
                pauseAllOtherAccordMedia(audioCard);
            }
            if (playerBody.dataset.loaded !== '1') {
                mountSharedEmbeddedPlayer(playerBody, target, { title, autoplay: true });
                playerBody.dataset.loaded = '1';
            }
            syncSharedAudioPrefButtons(panel, getSharedAudioPlaybackPreference());
            panel.classList.remove('hidden');
            if (playBtn) {
                playBtn.innerHTML = '<i class="fa-solid fa-chevron-up text-[11px]"></i><span>Hide Player</span>';
            }
        } else {
            collapseAudioCardPanel(audioCard);
        }
    };

    if (playBtn) {
        playBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleInlinePlayer();
        });
    }

    if (primaryTrigger) {
        primaryTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (target.kind !== 'external' && getSharedAudioPlaybackPreference() !== 'external') {
                toggleInlinePlayer();
            } else if (target.rawUrl) {
                window.open(target.rawUrl, '_blank', 'noopener,noreferrer');
            }
        });
    }

    if (panel) {
        panel.querySelectorAll('[data-audio-pref-btn]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const chosen = btn.getAttribute('data-audio-pref-btn');
                const saved = setSharedAudioPlaybackPreference(chosen);
                syncSharedAudioPrefButtons(panel, saved);
            });
        });
    }
}

const _sharedAudioMetaCache = new Map();
async function fetchSharedAudioMetadata(url) {
    const clean = String(url || '').trim();
    if (!clean) return null;
    if (_sharedAudioMetaCache.has(clean)) return _sharedAudioMetaCache.get(clean);
    try {
        const res = await fetch(`/api/music-metadata?url=${encodeURIComponent(clean)}`);
        if (!res.ok) return null;
        const data = await res.json();
        const meta = {
            title: String(data?.title || '').trim(),
            image: String(data?.image || '').trim(),
            curator: String(data?.curator || '').trim()
        };
        _sharedAudioMetaCache.set(clean, meta);
        return meta;
    } catch {
        return null;
    }
}

async function hydrateSharedAudioLinkPreviews(rootEl = document) {
    const slots = Array.from(rootEl.querySelectorAll('[data-audio-meta-url]'));
    if (slots.length === 0) return;

    await Promise.all(slots.map(async slot => {
        const url = slot.getAttribute('data-audio-meta-url');
        if (!url || slot.dataset.audioHydrated === '1') return;
        slot.dataset.audioHydrated = '1';
        const meta = await fetchSharedAudioMetadata(url);
        if (!meta) return;

        const titleEl = slot.querySelector('[data-audio-title]');
        const thumbWrap = slot.querySelector('[data-audio-thumb]');
        if (meta.title && titleEl) {
            titleEl.textContent = meta.title;
        }
        if (meta.image && thumbWrap) {
            thumbWrap.innerHTML = `<img loading="lazy" decoding="async" src="${escapeShareHtml(meta.image)}" alt="${escapeShareHtml(meta.title || 'Audio cover')}" class="w-full h-full object-cover">`;
        }
    }));
}

const _sharedBookPreviewCache = new Map();
async function hydrateSharedBookLinkPreviews(rootEl = document) {
    const client = window.supabaseClient;
    if (!client) return;
    const slots = Array.from(rootEl.querySelectorAll('.feed-book-link-preview[data-book-id]'));
    if (slots.length === 0) return;

    const missingIds = [...new Set(slots.map(s => s.getAttribute('data-book-id')).filter(id => id && !_sharedBookPreviewCache.has(id)))];
    if (missingIds.length > 0) {
        const { data } = await client
            .from('books')
            .select('id, title, author, cover_url')
            .in('id', missingIds)
            .eq('is_visible', true);
        (data || []).forEach(b => _sharedBookPreviewCache.set(String(b.id), b));
    }

    slots.forEach(slot => {
        const book = _sharedBookPreviewCache.get(slot.getAttribute('data-book-id'));
        if (!book) return;
        slot.innerHTML = `
            <a href="book.html?id=${encodeURIComponent(book.id)}" class="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-accord-lightBlue/40 transition-colors">
                ${book.cover_url
                    ? `<img src="${escapeShareHtml(book.cover_url)}" alt="${escapeShareHtml(book.title)}" class="w-12 h-16 object-cover rounded-lg border border-slate-200 shrink-0">`
                    : `<div class="w-12 h-16 rounded-lg bg-accord-blue text-white flex items-center justify-center shrink-0"><i class="fa-solid fa-book"></i></div>`}
                <div class="min-w-0 flex-1">
                    <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-blue">Accord Library Book</p>
                    <p class="text-xs font-bold text-accord-slate truncate">${escapeShareHtml(book.title)}</p>
                    <p class="text-[11px] text-accord-muted truncate">By ${escapeShareHtml(book.author || 'Unknown')}</p>
                </div>
                <i class="fa-solid fa-chevron-right text-slate-400 text-xs shrink-0"></i>
            </a>
        `;
    });
}

function renderSharedCommentsHtml(comments) {
    if (!comments || comments.length === 0) {
        return `<p class="text-xs text-slate-400 py-1">No comments yet. Be the first to comment!</p>`;
    }
    return comments.map(c => {
        const name = c.author_name || 'Member';
        const text = c.comment_text || c.text || '';
        return `
            <div class="flex items-start gap-2">
                <div class="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    ${escapeShareHtml(name.charAt(0).toUpperCase())}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="inline-block bg-[#F0F2F5] rounded-2xl px-3.5 py-2 max-w-full">
                        <p class="text-xs font-bold text-slate-900">${escapeShareHtml(name)}</p>
                        <p class="text-xs sm:text-[13px] text-slate-800 whitespace-pre-wrap break-words leading-snug mt-0.5">${escapeShareHtml(text)}</p>
                    </div>
                    <div class="px-2 mt-0.5 text-[11px] font-semibold text-slate-500">
                        ${formatSharedFeedTimeAgo(c.created_at)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

const _sharedMobilePostRegistry = new Map();
const _sharedMobileVideoIds = [];
let _activeMobilePostId = null;
let _activeMobileVideoId = null;
let _mobileVideoCommentsOpen = false;
let _mobileVideoCaptionExpanded = false;
let _mobileModalHistoryPushed = false;

function createSharedFeedCardElement(post, options = {}) {
    const {
        repost = null,
        isLiked = false,
        isReposted = false,
        isSaved = undefined,
        commentsCount = 0,
        myAvatarInitial = 'U',
        authorHandle = '',
        authorAvatarUrl = '',
        reposterHandle = '',
        currentUserId = null,
        canManagePost = false,
        expandFullBody = false,
        openCommentsByDefault = false,
        showOpenFullPostLink = true,
        domId = ''
    } = options;

    const cardDomId = String(domId || post.id);

    const resolvedViewerId = currentUserId || window.currentFeedUserId || null;
    const isOwner = Boolean(resolvedViewerId && post.author_id && String(resolvedViewerId) === String(post.author_id));
    const canManage = isOwner || Boolean(canManagePost) || Boolean(
        resolvedViewerId &&
        post.author_id &&
        Array.isArray(window.editableFeedPageIds) &&
        window.editableFeedPageIds.includes(String(post.author_id))
    );

    const isTextPost = post.post_type === 'text' || post.post_type === 'testimony';
    const isVideoPost = post.post_type === 'video' && Boolean(post.media_url);
    const enableMobileFullscreen = showOpenFullPostLink !== false && (isTextPost || isVideoPost);
    if (enableMobileFullscreen) {
        _sharedMobilePostRegistry.set(String(post.id), {
            post,
            options: {
                repost,
                isLiked,
                isReposted,
                commentsCount,
                myAvatarInitial,
                authorHandle,
                authorAvatarUrl,
                reposterHandle,
                currentUserId: resolvedViewerId,
                canManage
            }
        });
        if (isVideoPost && !_sharedMobileVideoIds.includes(String(post.id))) {
            _sharedMobileVideoIds.push(String(post.id));
        }
        if (_activeMobilePostId && String(_activeMobilePostId) === String(post.id)) {
            setTimeout(() => syncMobileModalFromRegistry(String(post.id)), 0);
        }
        if (_activeMobileVideoId && String(_activeMobileVideoId) === String(post.id)) {
            setTimeout(() => syncMobileVideoModalFromRegistry(String(post.id)), 0);
        }
    }

    const card = document.createElement('article');
    card.className = 'bg-white border border-slate-200/80 rounded-xl sm:rounded-2xl shadow-sm overflow-visible';
    card.setAttribute('data-post-id', String(post.id));
    card.setAttribute('data-card-dom-id', cardDomId);

    const postUrl = getPostShareUrl(post.id);
    const resolvedIsSaved = typeof isSaved === 'boolean' ? isSaved : isPostSavedShared(post.id);
    const likesCount = Number(post.likes_count) || 0;
    const repostsCount = Number(post.reposts_count) || 0;
    const dateFormatted = formatSharedFeedTimeAgo(post.created_at);

    const displayAuthor = post.is_anonymous ? 'Anonymous' : (post.author_name || 'Anonymous');
    const isVerifiedAuthor = post.author_role === 'ministry_minister' && !post.is_anonymous;
    const authorProfileUrl = (!post.is_anonymous && post.author_id)
        ? `user.html?id=${encodeURIComponent(post.author_id)}`
        : null;

    let repostBannerHtml = '';
    if (repost) {
        const reposterName = repost.profiles?.full_name || repost.reposter_name || 'Member';
        const repHandle = repost.profiles?.handle || reposterHandle || '';
        const reposterUrl = `user.html?id=${encodeURIComponent(repost.user_id)}`;
        const quoteHtml = repost.quote_text
            ? `<p class="text-xs italic text-slate-700 bg-slate-50 border-l-2 border-emerald-500 pl-3 py-1.5 rounded-r-lg mt-1.5">"${escapeShareHtml(repost.quote_text)}"</p>`
            : '';
        repostBannerHtml = `
            <div class="px-4 pt-3 pb-2 border-b border-slate-100">
                <a href="${escapeShareHtml(reposterUrl)}" class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 flex-wrap">
                    <i class="fa-solid fa-retweet text-emerald-600"></i>
                    <span><strong class="text-slate-900">${escapeShareHtml(reposterName)}</strong>${repHandle ? ` <span class="text-slate-400 font-normal">${escapeShareHtml(repHandle)}</span>` : ''} reposted</span>
                </a>
                ${quoteHtml}
            </div>
        `;
    }

    const avatarVisual = (!post.is_anonymous && authorAvatarUrl)
        ? `<img loading="lazy" decoding="async" src="${escapeShareHtml(authorAvatarUrl)}" alt="${escapeShareHtml(displayAuthor)}" class="w-full h-full object-cover rounded-full">`
        : `<span>${escapeShareHtml(displayAuthor.charAt(0).toUpperCase())}</span>`;

    const avatarInner = `
        <div class="relative w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-sm shrink-0">
            ${avatarVisual}
            ${isVerifiedAuthor ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-white"><i class="fa-solid fa-check text-[8px]"></i></span>` : ''}
        </div>
    `;

    const authorAvatarHtml = authorProfileUrl
        ? `<a href="${escapeShareHtml(authorProfileUrl)}" class="shrink-0 hover:opacity-90 transition-opacity">${avatarInner}</a>`
        : avatarInner;

    const authorNameHtml = authorProfileUrl
        ? `<a href="${escapeShareHtml(authorProfileUrl)}" class="text-[14px] font-bold text-slate-900 hover:underline truncate">${escapeShareHtml(displayAuthor)}</a>`
        : `<span class="text-[14px] font-bold text-slate-900 truncate">${escapeShareHtml(displayAuthor)}</span>`;

    const handleHtml = (!post.is_anonymous && authorHandle)
        ? `<span class="text-xs text-slate-500 font-medium truncate">${escapeShareHtml(authorHandle)}</span>`
        : '';

    const typeMeta = getSharedPostTypeMeta(post.post_type);
    let mediaHtml = '';

    let audioTarget = null;
    let audioCardTitle = '';
    if (post.post_type === 'video' && post.media_url) {
        const embedUrl = getSharedYouTubeEmbedUrl(post.media_url);
        const isDirectVideo = /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(post.media_url);
        const thumbUrl = getSharedVideoThumbnailUrl(post.media_url);
        const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 768;

        if (showOpenFullPostLink !== false) {
            if (isMobileViewport) {
                const mobilePreviewVisual = isDirectVideo
                    ? `<video playsinline muted preload="none" src="${escapeShareHtml(post.media_url)}" class="w-full h-full object-cover pointer-events-none"></video>`
                    : (thumbUrl
                        ? `<img loading="lazy" decoding="async" src="${escapeShareHtml(thumbUrl)}" alt="${escapeShareHtml(post.body ? String(post.body).slice(0, 60) : 'Video')}" class="w-full h-full object-cover">`
                        : `<div class="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center"><i class="fa-solid fa-film text-3xl text-white/25"></i></div>`);

                mediaHtml = `
                    <div data-mobile-video-card="${escapeShareHtml(cardDomId)}" data-video-post-id="${escapeShareHtml(post.id)}" data-video-url="${escapeShareHtml(post.media_url)}" data-is-direct-video="${isDirectVideo ? '1' : '0'}" class="relative w-full aspect-video bg-black cursor-pointer overflow-hidden group select-none">
                        <div id="mobile-feed-video-poster-${escapeShareHtml(cardDomId)}" class="absolute inset-0 w-full h-full">
                            ${mobilePreviewVisual}
                            <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-black/15 to-transparent flex items-center justify-center pointer-events-none">
                                <span class="w-12 h-12 rounded-full bg-black/55 backdrop-blur-sm border border-white/30 text-white flex items-center justify-center shadow-lg group-active:scale-95 transition-transform">
                                    <i class="fa-solid fa-play text-base ml-0.5"></i>
                                </span>
                            </div>
                        </div>
                        <div id="mobile-feed-video-slot-${escapeShareHtml(cardDomId)}" class="absolute inset-0 w-full h-full hidden"></div>
                        <div id="mobile-feed-video-overlay-${escapeShareHtml(cardDomId)}" onclick="handleMobileFeedVideoTap(event, '${escapeShareHtml(cardDomId)}')" role="button" tabindex="0" aria-label="Unmute or open video in full view" class="absolute inset-0 z-10 flex flex-col justify-between p-2.5">
                            <div class="flex justify-end">
                                <span id="mobile-feed-video-status-${escapeShareHtml(cardDomId)}" class="hidden bg-black/65 backdrop-blur-sm text-white text-[10px] font-semibold px-2.5 py-1 rounded-full items-center gap-1.5 shadow">
                                    <i class="fa-solid fa-volume-xmark text-[10px]"></i>
                                    <span>Tap for sound</span>
                                </span>
                            </div>
                            <div class="flex justify-end">
                                <button type="button" onclick="openMobileVideoFromFeed(event, '${escapeShareHtml(post.id)}', '${escapeShareHtml(cardDomId)}')" class="bg-black/65 hover:bg-black/80 active:scale-95 backdrop-blur-sm text-white text-[10px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-all shadow">
                                    <i class="fa-solid fa-expand text-[9px]"></i>
                                    <span>Full view</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const desktopVideoHtml = isDirectVideo
                    ? `<video controls playsinline preload="none" src="${escapeShareHtml(post.media_url)}" class="w-full h-full object-contain"></video>`
                    : (thumbUrl
                        ? `<button type="button" onclick="playDesktopFeedYouTube(this, '${escapeShareHtml(embedUrl)}')" aria-label="Play video" class="relative w-full h-full block group cursor-pointer overflow-hidden bg-black">
                               <img loading="lazy" decoding="async" src="${escapeShareHtml(thumbUrl)}" alt="${escapeShareHtml(post.body ? String(post.body).slice(0, 60) : 'Video')}" class="w-full h-full object-cover">
                               <span class="absolute inset-0 bg-black/25 group-hover:bg-black/35 transition-colors flex items-center justify-center">
                                   <span class="w-16 h-16 rounded-full bg-black/65 border border-white/30 text-white flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                                       <i class="fa-solid fa-play text-xl ml-0.5"></i>
                                   </span>
                               </span>
                           </button>`
                        : `<iframe loading="lazy" src="${escapeShareHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>`);

                mediaHtml = `
                    <div class="relative w-full aspect-video bg-black">
                        ${desktopVideoHtml}
                    </div>
                `;
            }
        } else {
            const singlePostVideoHtml = isDirectVideo
                ? `<video controls playsinline preload="metadata" src="${escapeShareHtml(post.media_url)}" class="w-full h-full object-contain"></video>`
                : `<iframe loading="lazy" src="${escapeShareHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>`;
            mediaHtml = `
                <div class="relative w-full aspect-video bg-black">
                    ${singlePostVideoHtml}
                </div>
            `;
        }
    } else if (post.post_type === 'audio' && post.media_url) {
        audioTarget = resolveSharedAudioTarget(post.media_url);
        const pInfo = getSharedAudioPlatformInfo(post.media_url);
        const platformLabel = audioTarget.label || pInfo.label;
        const platformIcon = audioTarget.icon || pInfo.icon;
        const pulledTitle = String(post.media_title || '').trim();
        audioCardTitle = pulledTitle || platformLabel;

        if (audioTarget.kind === 'audio') {
            mediaHtml = `<div class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                   <div class="flex items-center justify-between gap-2">
                       <p class="text-xs font-bold text-accord-slate truncate">${escapeShareHtml(pulledTitle || 'Audio File')}</p>
                       <a href="${escapeShareHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-accord-blue hover:underline inline-flex items-center gap-1 shrink-0">
                           <span>Open File</span>
                           <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                       </a>
                   </div>
                   <audio controls preload="none" src="${escapeShareHtml(post.media_url)}" class="w-full"></audio>
               </div>`;
        } else {
            const pulledThumb = String(post.media_thumbnail || '').trim();
            const needsHydrate = !pulledTitle || !pulledThumb;
            const canPlayInApp = audioTarget.kind !== 'external' && Boolean(audioTarget.embedUrl);
            const currentPref = getSharedAudioPlaybackPreference();

            const summaryInnerHtml = `
                   <div data-audio-thumb class="w-14 h-14 rounded-xl overflow-hidden ${pInfo.color} flex items-center justify-center shrink-0 border border-slate-200/70">
                       ${pulledThumb
                           ? `<img loading="lazy" decoding="async" src="${escapeShareHtml(pulledThumb)}" alt="${escapeShareHtml(audioCardTitle)}" class="w-full h-full object-cover">`
                           : `<i class="${platformIcon} text-xl"></i>`}
                   </div>
                   <div class="flex-grow min-w-0">
                       <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-muted flex items-center gap-1.5">
                           <i class="${platformIcon}"></i>
                           <span>${escapeShareHtml(platformLabel)}</span>
                       </p>
                       <p data-audio-title class="text-xs sm:text-sm font-bold text-accord-slate truncate mt-0.5">${escapeShareHtml(audioCardTitle)}</p>
                       <span class="text-[11px] text-accord-blue font-semibold truncate block mt-0.5">${canPlayInApp && currentPref !== 'external' ? 'Tap to play in app' : `Open on ${escapeShareHtml(platformLabel)} →`}</span>
                   </div>`;

            const summaryRowHtml = canPlayInApp
                ? `<div data-audio-primary-trigger role="button" tabindex="0" class="p-3 flex items-center space-x-3.5 cursor-pointer hover:bg-slate-100/80 transition-colors">${summaryInnerHtml}</div>`
                : `<a href="${escapeShareHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="p-3 flex items-center space-x-3.5 hover:bg-slate-100/80 transition-colors group">${summaryInnerHtml}<i class="fa-solid fa-arrow-up-right-from-square text-xs text-slate-400 group-hover:text-accord-blue shrink-0 pr-1"></i></a>`;

            const actionsRowHtml = `
                <div class="px-3 pb-3 pt-0.5 flex flex-wrap items-center gap-2">
                    ${canPlayInApp ? `
                    <button type="button" data-audio-play-btn class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-sm">
                        <i class="fa-solid fa-play text-[11px]"></i>
                        <span>Play in App</span>
                    </button>` : ''}
                    <a href="${escapeShareHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors">
                        <span>Open on ${escapeShareHtml(platformLabel)}</span>
                        <i class="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-400"></i>
                    </a>
                </div>`;

            const playerPanelHtml = canPlayInApp ? `
                <div data-audio-player-panel class="hidden border-t border-slate-200 bg-white p-3 space-y-2.5">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <span class="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
                            <i class="${platformIcon}"></i>
                            <span>In-App Player</span>
                        </span>
                        <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                            <span class="text-[10px] font-semibold text-slate-500 px-1.5">Remember:</span>
                            <button type="button" data-audio-pref-btn="in_app" class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-accord-blue text-white transition-colors">In-App</button>
                            <button type="button" data-audio-pref-btn="external" class="px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors">External</button>
                        </div>
                    </div>
                    <div data-audio-player-body class="w-full overflow-hidden rounded-xl leading-none"></div>
                </div>` : '';

            mediaHtml = `<div data-audio-card="${post.id}" ${needsHydrate ? `data-audio-meta-url="${escapeShareHtml(post.media_url)}"` : ''} class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                   ${summaryRowHtml}
                   ${actionsRowHtml}
                   ${playerPanelHtml}
               </div>`;
        }
    }

    const bodyText = String(post.body || '');
    const isLongBody = !expandFullBody && bodyText.length > 260;
    const shownBody = isLongBody ? bodyText.slice(0, 260).trim() + '...' : bodyText;
    const linkedBookId = extractSharedBookId(bodyText);

    card.innerHTML = `
        ${repostBannerHtml}

        <!-- Facebook-Style Card Header -->
        <div class="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
            <div class="flex items-center space-x-2.5 min-w-0">
                ${authorAvatarHtml}
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${authorNameHtml}
                        ${isVerifiedAuthor ? '<i class="fa-solid fa-circle-check text-accord-blue text-xs" title="Verified Ministry / Minister"></i>' : ''}
                        ${handleHtml}
                    </div>
                    <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>${dateFormatted}</span>
                        ${post.edited_at ? `<span class="text-[10px] text-slate-400 italic">(edited)</span>` : ''}
                        <span>·</span>
                        <span class="inline-flex items-center gap-1 font-semibold ${typeMeta.textColor}">
                            <i class="fa-solid ${typeMeta.icon} text-[10px]"></i>
                            <span>${typeMeta.label}</span>
                        </span>
                    </div>
                </div>
            </div>

            <!-- Bookmark & 3-Dots More Menu -->
            <div class="flex items-center gap-0.5 shrink-0">
                <button type="button" data-save-post-btn="${escapeShareHtml(post.id)}" onclick="toggleSavePost('${escapeShareHtml(post.id)}')" class="w-8 h-8 rounded-full ${resolvedIsSaved ? 'hover:bg-amber-50 text-accord-gold' : 'hover:bg-slate-100 text-slate-400 hover:text-accord-slate'} flex items-center justify-center transition-colors" aria-label="${resolvedIsSaved ? 'Remove from Saved' : 'Save Post'}" title="${resolvedIsSaved ? 'Saved' : 'Save Post'}">
                    <i class="${resolvedIsSaved ? 'fa-solid' : 'fa-regular'} fa-bookmark text-sm"></i>
                </button>
                <div class="relative shrink-0">
                <button type="button" onclick="toggleFeedPostMenu(event, '${escapeShareHtml(cardDomId)}')" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors" aria-label="Post options">
                    <i class="fa-solid fa-ellipsis text-sm"></i>
                </button>
                <div id="feed-post-menu-${escapeShareHtml(cardDomId)}" onclick="event.stopPropagation()" class="feed-post-menu hidden absolute right-0 top-9 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                    ${showOpenFullPostLink ? `
                    <a href="${escapeShareHtml(postUrl)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-arrow-up-right-from-square w-3.5 text-center text-slate-400"></i>
                        <span>Open Full Post</span>
                    </a>` : ''}
                    <button type="button" data-save-post-menu-btn="${escapeShareHtml(post.id)}" onclick="closeAllFeedPostMenus(); toggleSavePost('${escapeShareHtml(post.id)}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="${resolvedIsSaved ? 'fa-solid' : 'fa-regular'} fa-bookmark w-3.5 text-center text-accord-gold"></i>
                        <span>${resolvedIsSaved ? 'Saved (Remove)' : 'Save Post'}</span>
                    </button>
                    ${canManage ? `
                    <button type="button" onclick="closeAllFeedPostMenus(); handleEditPostClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-regular fa-pen-to-square w-3.5 text-center text-accord-blue"></i>
                        <span>Edit Post</span>
                    </button>
                    <a href="promote.html?post=${encodeURIComponent(post.id)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-accord-gold hover:bg-amber-50/70 flex items-center gap-2.5">
                        <i class="fa-solid fa-bullhorn w-3.5 text-center"></i>
                        <span>Promote Post</span>
                    </a>` : ''}
                    <button type="button" onclick="closeAllFeedPostMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                        <span>Send to Chat</span>
                    </button>
                    <button type="button" onclick="closeAllFeedPostMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                        <span>Copy Link / Share</span>
                    </button>
                    ${canManage ? `
                    <button type="button" onclick="closeAllFeedPostMenus(); handleDeletePostClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                        <i class="fa-regular fa-trash-can w-3.5 text-center"></i>
                        <span>Delete Post</span>
                    </button>` : `
                    <button type="button" onclick="closeAllFeedPostMenus(); openReportModal('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                        <i class="fa-regular fa-flag w-3.5 text-center"></i>
                        <span>Flag Post</span>
                    </button>`}
                </div>
                </div>
            </div>
        </div>

        <!-- Post Content -->
        ${shownBody ? `
        <div ${enableMobileFullscreen ? `onclick="handleSharedTextPostBodyClick(event, '${post.id}')" class="px-4 pb-3 space-y-1.5 cursor-pointer md:cursor-auto active:bg-slate-50/70 md:active:bg-transparent transition-colors"` : `class="px-4 pb-3 space-y-1.5"`}>
            <p id="post-body-${escapeShareHtml(cardDomId)}" class="text-[14px] text-slate-800 leading-relaxed whitespace-pre-wrap">${escapeShareHtml(shownBody)}</p>
            ${isLongBody ? `<button type="button" id="post-see-more-${escapeShareHtml(cardDomId)}" onclick="toggleExpandPostBody('${post.id}', '${escapeShareHtml(cardDomId)}')" class="text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline">See more</button>` : ''}
        </div>` : ''}

        ${mediaHtml}
        ${linkedBookId ? `<div class="feed-book-link-preview mx-4 mb-3" data-book-id="${escapeShareHtml(linkedBookId)}"></div>` : ''}

        <!-- Engagement Summary Row (Facebook Style) -->
        <div class="px-4 py-2 flex items-center justify-between text-xs text-slate-500">
            <div class="flex items-center gap-1.5">
                <span class="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[9px]">
                    <i class="fa-solid fa-heart"></i>
                </span>
                <span id="like-count-${escapeShareHtml(cardDomId)}" data-like-count-for="${escapeShareHtml(post.id)}">${likesCount}</span>
            </div>
            <div class="flex items-center gap-3">
                <button type="button" onclick="handleSharedCommentTrigger('${post.id}', '${escapeShareHtml(cardDomId)}')" class="hover:underline">
                    <span id="comment-count-${escapeShareHtml(cardDomId)}" data-comment-count-for="${escapeShareHtml(post.id)}">${commentsCount}</span> ${commentsCount === 1 ? 'comment' : 'comments'}
                </button>
                <span id="repost-count-label-${escapeShareHtml(cardDomId)}" data-repost-count-for="${escapeShareHtml(post.id)}">${repostsCount} ${repostsCount === 1 ? 'repost' : 'reposts'}</span>
            </div>
        </div>

        <!-- Facebook-Style Action Bar -->
        <div class="mx-4 border-t border-slate-200/80 py-1 grid grid-cols-4 gap-1">
            <button type="button" onclick="togglePostLike('${post.id}')" id="like-btn-${escapeShareHtml(cardDomId)}" data-like-btn-for="${escapeShareHtml(post.id)}" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors ${isLiked ? 'text-rose-600' : 'text-slate-600'}">
                <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart text-sm"></i>
                <span>Like</span>
            </button>

            <button type="button" onclick="handleSharedCommentTrigger('${post.id}', '${escapeShareHtml(cardDomId)}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                <i class="fa-regular fa-comment text-sm"></i>
                <span>Comment</span>
            </button>

            <button type="button" onclick="handleRepostClick('${post.id}')" id="repost-btn-${escapeShareHtml(cardDomId)}" data-repost-btn-for="${escapeShareHtml(post.id)}" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors ${isReposted ? 'text-emerald-600' : 'text-slate-600'}">
                <i class="fa-solid fa-retweet text-sm"></i>
                <span>Repost</span>
            </button>

            <div class="relative">
                <button type="button" onclick="toggleSharedPostShareMenu(event, '${escapeShareHtml(cardDomId)}')" class="w-full py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                    <i class="fa-solid fa-share text-sm"></i>
                    <span>Share</span>
                </button>
                <div id="feed-share-menu-${escapeShareHtml(cardDomId)}" onclick="event.stopPropagation()" class="feed-post-menu hidden absolute right-0 bottom-11 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                    <button type="button" onclick="closeAllFeedPostMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-accord-lightBlue/60 flex items-center gap-2.5">
                        <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                        <span>Send to Chat</span>
                    </button>
                    <button type="button" onclick="closeAllFeedPostMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                        <span>Copy Link / Share</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Facebook-Style Inline Comment Section -->
        <div id="inline-comments-${escapeShareHtml(cardDomId)}" class="${openCommentsByDefault ? '' : 'hidden'} border-t border-slate-200/80 px-4 py-3 space-y-3 bg-white rounded-b-xl sm:rounded-b-2xl">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                    ${escapeShareHtml(myAvatarInitial)}
                </div>
                <form onsubmit="submitInlineComment(event, '${post.id}', '${escapeShareHtml(cardDomId)}')" class="flex-1 min-w-0 flex items-center gap-1.5 bg-[#F0F2F5] rounded-full px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-accord-blue/30">
                    <input type="text" id="inline-comment-input-${escapeShareHtml(cardDomId)}" placeholder="Write a comment..." class="flex-1 min-w-0 bg-transparent text-[16px] sm:text-[13px] text-slate-800 placeholder-slate-500 focus:outline-none py-1" required>
                    <button type="submit" class="text-accord-blue hover:text-accord-darkBlue px-1.5 py-1 text-xs font-bold shrink-0" aria-label="Send comment">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </form>
            </div>
            <div id="inline-comments-list-${escapeShareHtml(cardDomId)}" class="space-y-2.5">
                <p class="text-xs text-slate-400 text-center py-2">Loading comments...</p>
            </div>
            ${showOpenFullPostLink ? `
            <div class="pt-1">
                <a href="${escapeShareHtml(postUrl)}#comments-section" class="text-xs font-semibold text-slate-500 hover:underline">Open full post &amp; all comments →</a>
            </div>` : ''}
        </div>
    `;

    if (audioTarget && card.querySelector('[data-audio-card]')) {
        bindSharedAudioCardInteractions(card, audioTarget, audioCardTitle);
    }

    if (card.querySelector('[data-audio-meta-url]')) {
        hydrateSharedAudioLinkPreviews(card);
    }

    return card;
}

function toggleSharedPostShareMenu(e, domId) {
    e.stopPropagation();
    const menu = document.getElementById(`feed-share-menu-${domId}`);
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    if (typeof closeAllFeedPostMenus === 'function') closeAllFeedPostMenus();
    if (isHidden) menu.classList.remove('hidden');
}

// ==========================================
// REUSABLE EDIT & DELETE POST HELPERS
// ==========================================

let _editPostTarget = null;
let _editPostCallback = null;

function ensureEditPostModalDom() {
    if (document.getElementById('accord-edit-post-modal')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'accord-edit-post-modal';
    wrapper.className = 'fixed inset-0 z-50 bg-accord-slate/70 backdrop-blur-sm hidden items-center justify-center p-4';
    wrapper.innerHTML = `
        <div class="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-4" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 class="font-bold text-accord-slate text-base">Edit Post</h3>
                <button type="button" onclick="closeSharedEditPostModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center">
                    <i class="fa-solid fa-xmark text-xs"></i>
                </button>
            </div>
            <form id="accord-edit-post-form" onsubmit="submitSharedEditPost(event)" class="space-y-3.5">
                <div id="accord-edit-post-media-wrap" class="hidden">
                    <label class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Media URL</label>
                    <input type="url" id="accord-edit-post-media" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-[16px] sm:text-xs focus:outline-none focus:border-accord-blue focus:bg-white">
                </div>
                <div>
                    <label id="accord-edit-post-body-label" class="block text-[11px] font-bold uppercase tracking-wider text-accord-slate mb-1">Content</label>
                    <textarea id="accord-edit-post-body" rows="5" required class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-[16px] sm:text-xs focus:outline-none focus:border-accord-blue focus:bg-white"></textarea>
                </div>
                <div class="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onclick="closeSharedEditPostModal()" class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-xs font-bold">Cancel</button>
                    <button type="submit" id="accord-edit-post-save" class="px-5 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm">Save Changes</button>
                </div>
            </form>
        </div>
    `;
    wrapper.addEventListener('click', closeSharedEditPostModal);
    document.body.appendChild(wrapper);
}

function openSharedEditPostModal(post, onSaved) {
    if (!post) return;
    ensureEditPostModalDom();
    _editPostTarget = post;
    _editPostCallback = typeof onSaved === 'function' ? onSaved : null;

    const bodyInput = document.getElementById('accord-edit-post-body');
    const bodyLabel = document.getElementById('accord-edit-post-body-label');
    const mediaWrap = document.getElementById('accord-edit-post-media-wrap');
    const mediaInput = document.getElementById('accord-edit-post-media');
    const needsMedia = post.post_type === 'video' || post.post_type === 'audio';
    if (bodyInput) {
        bodyInput.value = post.body || '';
        bodyInput.required = !needsMedia;
    }
    if (bodyLabel) {
        bodyLabel.textContent = needsMedia ? 'Content (Optional)' : 'Content *';
    }
    mediaWrap?.classList.toggle('hidden', !needsMedia);
    if (mediaInput) {
        mediaInput.required = needsMedia;
        mediaInput.value = post.media_url || '';
    }

    const modal = document.getElementById('accord-edit-post-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeSharedEditPostModal() {
    const modal = document.getElementById('accord-edit-post-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
    _editPostTarget = null;
    _editPostCallback = null;
}

async function submitSharedEditPost(e) {
    e.preventDefault();
    const client = window.supabaseClient;
    if (!client || !_editPostTarget) return;

    const body = document.getElementById('accord-edit-post-body').value.trim();
    const needsMedia = _editPostTarget.post_type === 'video' || _editPostTarget.post_type === 'audio';
    const media_url = needsMedia ? (document.getElementById('accord-edit-post-media').value.trim() || null) : _editPostTarget.media_url;
    const btn = document.getElementById('accord-edit-post-save');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
    }

    const edited_at = new Date().toISOString();
    let updatePayload = { title: '', body, media_url, edited_at };
    if (_editPostTarget.post_type === 'audio' && media_url) {
        const meta = await fetchSharedAudioMetadata(media_url);
        if (meta) {
            updatePayload.media_title = meta.title || null;
            updatePayload.media_thumbnail = meta.image || null;
        }
    }

    let { data, error } = await client
        .from('feed_posts')
        .update(updatePayload)
        .eq('id', _editPostTarget.id)
        .select()
        .single();

    if (error && /media_title|media_thumbnail/i.test(error.message || '')) {
        const fallbackPayload = { title: '', body, media_url, edited_at };
        const retry = await client
            .from('feed_posts')
            .update(fallbackPayload)
            .eq('id', _editPostTarget.id)
            .select()
            .single();
        data = retry.data;
        error = retry.error;
    }

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }

    if (error) {
        if (typeof showToast === 'function') showToast(`Could not update post: ${error.message}`, true);
        return;
    }

    const cb = _editPostCallback;
    closeSharedEditPostModal();
    if (typeof showToast === 'function') showToast('Post updated.');
    if (cb) cb(data);
}

async function executeSharedDeletePost(postId, onDeleted) {
    const client = window.supabaseClient;
    if (!client || !postId) return;
    if (!confirm('Delete this post permanently? This cannot be undone.')) return;

    const { error } = await client
        .from('feed_posts')
        .delete()
        .eq('id', postId);

    if (error) {
        if (typeof showToast === 'function') showToast(`Could not delete post: ${error.message}`, true);
        return;
    }

    if (typeof showToast === 'function') showToast('Post deleted.');
    if (_activeMobilePostId && String(_activeMobilePostId) === String(postId)) {
        closeMobileTextPostModal();
    }
    if (_activeMobileVideoId && String(_activeMobileVideoId) === String(postId)) {
        const idx = _sharedMobileVideoIds.indexOf(String(postId));
        if (idx !== -1) _sharedMobileVideoIds.splice(idx, 1);
        closeMobileVideoModal();
    }
    if (typeof onDeleted === 'function') onDeleted(postId);
}

// ==========================================
// MOBILE FULL-SCREEN TEXT & VIDEO MODALS
// ==========================================

function handleSharedTextPostBodyClick(e, postId) {
    if (window.innerWidth >= 768) return;
    if (e.target && e.target.closest('a, button, input, textarea, select')) return;
    const entry = _sharedMobilePostRegistry.get(String(postId));
    if (entry && entry.post.post_type === 'video' && entry.post.media_url) {
        openMobileVideoModal(postId);
        return;
    }
    openMobileTextPostModal(postId);
}

function handleSharedCommentTrigger(postId, domId = '') {
    const resolvedDomId = String(domId || postId);
    const entry = _sharedMobilePostRegistry.get(String(postId));
    if (entry && window.innerWidth < 768) {
        if (entry.post.post_type === 'video' && entry.post.media_url) {
            openMobileVideoModal(postId, { openComments: true });
            return;
        }
        openMobileTextPostModal(postId, { focusComment: true });
        return;
    }
    if (typeof toggleInlineComments === 'function') {
        toggleInlineComments(postId, resolvedDomId);
    }
}

function closeMobileModalMenus() {
    document.querySelectorAll('.mobile-modal-menu').forEach(el => el.classList.add('hidden'));
}

function toggleMobileModalPostMenu(e, postId) {
    e.stopPropagation();
    const menu = document.getElementById(`mobile-modal-post-menu-${postId}`);
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeMobileModalMenus();
    if (isHidden) menu.classList.remove('hidden');
}

function toggleMobileModalShareMenu(e, postId) {
    e.stopPropagation();
    const menu = document.getElementById(`mobile-modal-share-menu-${postId}`);
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeMobileModalMenus();
    if (isHidden) menu.classList.remove('hidden');
}

let _lockedMobileBodyScrollY = 0;
let _isMobileModalBodyLocked = false;

function lockMobileModalBodyScroll() {
    if (_isMobileModalBodyLocked) return;
    _lockedMobileBodyScrollY = window.scrollY || window.pageYOffset || 0;
    _isMobileModalBodyLocked = true;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${_lockedMobileBodyScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
}

function unlockMobileModalBodyScroll() {
    if (_activeMobilePostId || _activeMobileVideoId) return;
    if (!_isMobileModalBodyLocked) return;
    _isMobileModalBodyLocked = false;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, _lockedMobileBodyScrollY);
}

function resetMobileModalViewportGeometry(modal) {
    if (!modal) return;
    modal.style.top = '';
    modal.style.left = '';
    modal.style.right = '';
    modal.style.bottom = '';
    modal.style.width = '';
    modal.style.height = '';
}

function syncActiveMobileModalViewport() {
    const textModal = document.getElementById('accord-mobile-post-modal');
    const videoModal = document.getElementById('accord-mobile-video-modal');
    const activeModals = [textModal, videoModal].filter((m) => m && !m.classList.contains('hidden'));
    if (!activeModals.length) return;

    const vv = window.visualViewport;
    activeModals.forEach((modal) => {
        if (vv) {
            modal.style.top = `${vv.offsetTop}px`;
            modal.style.left = `${vv.offsetLeft}px`;
            modal.style.width = `${vv.width}px`;
            modal.style.height = `${vv.height}px`;
            modal.style.right = 'auto';
            modal.style.bottom = 'auto';
        } else {
            modal.style.height = '100dvh';
        }
    });

    if (videoModal && !videoModal.classList.contains('hidden')) {
        const sheet = document.getElementById('mobile-video-comments-sheet');
        if (sheet) {
            if (vv && vv.height < window.innerHeight * 0.8) {
                sheet.style.height = `${Math.max(240, Math.floor(vv.height * 0.9))}px`;
            } else {
                sheet.style.height = '';
            }
        }
    }
}

if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncActiveMobileModalViewport);
    window.visualViewport.addEventListener('scroll', syncActiveMobileModalViewport);
}

function ensureMobileTextPostModalDom() {
    if (document.getElementById('accord-mobile-post-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'accord-mobile-post-modal';
    modal.className = 'fixed inset-0 z-[45] bg-white hidden flex-col md:hidden overflow-hidden';
    modal.addEventListener('click', closeMobileModalMenus);
    document.body.appendChild(modal);
}

function getLiveCardPostState(postId, fallbackOptions = {}, post = {}) {
    const likeCountEl = document.getElementById(`like-count-${postId}`);
    const likeBtnEl = document.getElementById(`like-btn-${postId}`);
    const commentCountEl = document.getElementById(`comment-count-${postId}`);
    const repostCountEl = document.getElementById(`repost-count-label-${postId}`);
    const repostBtnEl = document.getElementById(`repost-btn-${postId}`);

    const likesCount = likeCountEl ? (Number(likeCountEl.textContent) || 0) : (Number(post.likes_count) || 0);
    const isLiked = likeBtnEl ? likeBtnEl.classList.contains('text-rose-600') : Boolean(fallbackOptions.isLiked);
    const commentsCount = commentCountEl ? (Number(commentCountEl.textContent) || 0) : (Number(fallbackOptions.commentsCount) || 0);
    const repostsCount = repostCountEl
        ? (parseInt(repostCountEl.textContent, 10) || 0)
        : (Number(post.reposts_count) || 0);
    const isReposted = repostBtnEl ? repostBtnEl.classList.contains('text-emerald-600') : Boolean(fallbackOptions.isReposted);

    return { likesCount, isLiked, commentsCount, repostsCount, isReposted };
}

function renderMobileTextPostModalContent(postId) {
    const modal = document.getElementById('accord-mobile-post-modal');
    const entry = _sharedMobilePostRegistry.get(String(postId));
    if (!modal || !entry) return;

    const { post, options } = entry;
    const {
        repost = null,
        myAvatarInitial = 'U',
        authorHandle = '',
        authorAvatarUrl = '',
        reposterHandle = '',
        canManage = false
    } = options;

    const live = getLiveCardPostState(postId, options, post);
    const postUrl = getPostShareUrl(post.id);
    const dateFormatted = formatSharedFeedTimeAgo(post.created_at);
    const displayAuthor = post.is_anonymous ? 'Anonymous' : (post.author_name || 'Anonymous');
    const isVerifiedAuthor = post.author_role === 'ministry_minister' && !post.is_anonymous;
    const authorProfileUrl = (!post.is_anonymous && post.author_id)
        ? `user.html?id=${encodeURIComponent(post.author_id)}`
        : null;
    const typeMeta = getSharedPostTypeMeta(post.post_type);
    const bodyText = String(post.body || '');
    const linkedBookId = extractSharedBookId(bodyText);

    const avatarVisual = (!post.is_anonymous && authorAvatarUrl)
        ? `<img loading="lazy" decoding="async" src="${escapeShareHtml(authorAvatarUrl)}" alt="${escapeShareHtml(displayAuthor)}" class="w-full h-full object-cover rounded-full">`
        : `<span>${escapeShareHtml(displayAuthor.charAt(0).toUpperCase())}</span>`;

    const avatarInner = `
        <div class="relative w-9 h-9 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-sm shrink-0">
            ${avatarVisual}
            ${isVerifiedAuthor ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-white"><i class="fa-solid fa-check text-[7px]"></i></span>` : ''}
        </div>
    `;

    const authorAvatarHtml = authorProfileUrl
        ? `<a href="${escapeShareHtml(authorProfileUrl)}" class="shrink-0">${avatarInner}</a>`
        : avatarInner;

    const authorNameHtml = authorProfileUrl
        ? `<a href="${escapeShareHtml(authorProfileUrl)}" class="text-[14px] font-bold text-slate-900 hover:underline truncate">${escapeShareHtml(displayAuthor)}</a>`
        : `<span class="text-[14px] font-bold text-slate-900 truncate">${escapeShareHtml(displayAuthor)}</span>`;

    const handleHtml = (!post.is_anonymous && authorHandle)
        ? `<span class="text-[11px] text-slate-500 font-medium truncate">${escapeShareHtml(authorHandle)}</span>`
        : '';

    let repostBannerHtml = '';
    if (repost) {
        const reposterName = repost.profiles?.full_name || repost.reposter_name || 'Member';
        const repHandle = repost.profiles?.handle || reposterHandle || '';
        const reposterUrl = `user.html?id=${encodeURIComponent(repost.user_id)}`;
        const quoteHtml = repost.quote_text
            ? `<p class="text-xs italic text-slate-700 bg-slate-50 border-l-2 border-emerald-500 pl-3 py-1.5 rounded-r-lg mt-1.5">"${escapeShareHtml(repost.quote_text)}"</p>`
            : '';
        repostBannerHtml = `
            <div class="px-4 pt-3 pb-2 border-b border-slate-100 bg-slate-50/50">
                <a href="${escapeShareHtml(reposterUrl)}" class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 flex-wrap">
                    <i class="fa-solid fa-retweet text-emerald-600"></i>
                    <span><strong class="text-slate-900">${escapeShareHtml(reposterName)}</strong>${repHandle ? ` <span class="text-slate-400 font-normal">${escapeShareHtml(repHandle)}</span>` : ''} reposted</span>
                </a>
                ${quoteHtml}
            </div>
        `;
    }

    modal.innerHTML = `
        <!-- Sticky Top Bar -->
        <div class="shrink-0 bg-white border-b border-slate-200/80 px-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <button type="button" onclick="closeMobileTextPostModal()" class="w-9 h-9 rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 transition-colors" aria-label="Back to feed">
                    <i class="fa-solid fa-chevron-left text-base"></i>
                </button>
                ${authorAvatarHtml}
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${authorNameHtml}
                        ${isVerifiedAuthor ? '<i class="fa-solid fa-circle-check text-accord-blue text-[11px]" title="Verified Ministry / Minister"></i>' : ''}
                        ${handleHtml}
                    </div>
                    <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>${dateFormatted}</span>
                        ${post.edited_at ? `<span class="text-[10px] text-slate-400 italic">(edited)</span>` : ''}
                        <span>·</span>
                        <span class="inline-flex items-center gap-1 font-semibold ${typeMeta.textColor}">
                            <i class="fa-solid ${typeMeta.icon} text-[10px]"></i>
                            <span>${typeMeta.label}</span>
                        </span>
                    </div>
                </div>
            </div>

            <div class="relative shrink-0">
                <button type="button" onclick="toggleMobileModalPostMenu(event, '${post.id}')" class="w-9 h-9 rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors" aria-label="Post options">
                    <i class="fa-solid fa-ellipsis text-base"></i>
                </button>
                <div id="mobile-modal-post-menu-${post.id}" onclick="event.stopPropagation()" class="mobile-modal-menu hidden absolute right-0 top-10 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                    <a href="${escapeShareHtml(postUrl)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-arrow-up-right-from-square w-3.5 text-center text-slate-400"></i>
                        <span>Open Full Post</span>
                    </a>
                    <button type="button" data-save-post-menu-btn="${escapeShareHtml(post.id)}" onclick="closeMobileModalMenus(); toggleSavePost('${escapeShareHtml(post.id)}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="${isPostSavedShared(post.id) ? 'fa-solid' : 'fa-regular'} fa-bookmark w-3.5 text-center text-accord-gold"></i>
                        <span>${isPostSavedShared(post.id) ? 'Saved (Remove)' : 'Save Post'}</span>
                    </button>
                    ${canManage ? `
                    <button type="button" onclick="closeMobileModalMenus(); handleEditPostClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-regular fa-pen-to-square w-3.5 text-center text-accord-blue"></i>
                        <span>Edit Post</span>
                    </button>
                    <a href="promote.html?post=${encodeURIComponent(post.id)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-accord-gold hover:bg-amber-50/70 flex items-center gap-2.5">
                        <i class="fa-solid fa-bullhorn w-3.5 text-center"></i>
                        <span>Promote Post</span>
                    </a>` : ''}
                    <button type="button" onclick="closeMobileModalMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                        <span>Send to Chat</span>
                    </button>
                    <button type="button" onclick="closeMobileModalMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                        <span>Copy Link / Share</span>
                    </button>
                    ${canManage ? `
                    <button type="button" onclick="closeMobileModalMenus(); handleDeletePostClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                        <i class="fa-regular fa-trash-can w-3.5 text-center"></i>
                        <span>Delete Post</span>
                    </button>` : `
                    <button type="button" onclick="closeMobileModalMenus(); openReportModal('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                        <i class="fa-regular fa-flag w-3.5 text-center"></i>
                        <span>Flag Post</span>
                    </button>`}
                </div>
            </div>
        </div>

        <!-- Scrollable Full Post + All Comments -->
        <div id="mobile-modal-scroll-area" class="flex-1 overflow-y-auto overscroll-contain bg-white">
            ${repostBannerHtml}

            <div class="px-4 pt-4 pb-3 space-y-3">
                <p id="mobile-modal-post-body-${post.id}" class="text-[16px] text-slate-900 leading-relaxed whitespace-pre-wrap break-words">${escapeShareHtml(bodyText)}</p>
                ${linkedBookId ? `<div class="feed-book-link-preview" data-book-id="${escapeShareHtml(linkedBookId)}"></div>` : ''}
            </div>

            <!-- Engagement Summary Row -->
            <div class="px-4 py-2 flex items-center justify-between text-xs text-slate-500">
                <div class="flex items-center gap-1.5">
                    <span class="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[9px]">
                        <i class="fa-solid fa-heart"></i>
                    </span>
                    <span id="mobile-modal-like-count-${post.id}">${live.likesCount}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span id="mobile-modal-comment-count-label-${post.id}">
                        <span id="mobile-modal-comment-count-${post.id}">${live.commentsCount}</span> ${live.commentsCount === 1 ? 'comment' : 'comments'}
                    </span>
                    <span id="mobile-modal-repost-count-label-${post.id}">${live.repostsCount} ${live.repostsCount === 1 ? 'repost' : 'reposts'}</span>
                </div>
            </div>

            <!-- Action Bar -->
            <div class="mx-4 border-t border-b border-slate-200/80 py-1 grid grid-cols-4 gap-1">
                <button type="button" onclick="handleMobileModalLike('${post.id}')" id="mobile-modal-like-btn-${post.id}" class="py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${live.isLiked ? 'text-rose-600' : 'text-slate-600'}">
                    <i class="${live.isLiked ? 'fa-solid' : 'fa-regular'} fa-heart text-sm"></i>
                    <span>Like</span>
                </button>

                <button type="button" onclick="document.getElementById('mobile-modal-comment-input')?.focus()" class="py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors">
                    <i class="fa-regular fa-comment text-sm"></i>
                    <span>Comment</span>
                </button>

                <button type="button" onclick="handleRepostClick('${post.id}')" id="mobile-modal-repost-btn-${post.id}" class="py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${live.isReposted ? 'text-emerald-600' : 'text-slate-600'}">
                    <i class="fa-solid fa-retweet text-sm"></i>
                    <span>Repost</span>
                </button>

                <div class="relative">
                    <button type="button" onclick="toggleMobileModalShareMenu(event, '${post.id}')" class="w-full py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors">
                        <i class="fa-solid fa-share text-sm"></i>
                        <span>Share</span>
                    </button>
                    <div id="mobile-modal-share-menu-${post.id}" onclick="event.stopPropagation()" class="mobile-modal-menu hidden absolute right-0 bottom-11 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                        <button type="button" onclick="closeMobileModalMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-accord-lightBlue/60 flex items-center gap-2.5">
                            <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                            <span>Send to Chat</span>
                        </button>
                        <button type="button" onclick="closeMobileModalMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                            <span>Copy Link / Share</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- All Comments Section -->
            <div class="px-4 py-3.5 space-y-3 pb-6">
                <div id="mobile-modal-comments-list" class="space-y-3">
                    <p class="text-xs text-slate-400 text-center py-4">Loading comments...</p>
                </div>
            </div>
        </div>

        <!-- Sticky Bottom Comment Input -->
        <div class="shrink-0 bg-white border-t border-slate-200 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                    ${escapeShareHtml(myAvatarInitial)}
                </div>
                <form onsubmit="submitMobileModalComment(event, '${post.id}')" class="flex-1 min-w-0 flex items-center gap-1.5 bg-[#F0F2F5] rounded-full px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-accord-blue/30">
                    <input type="text" id="mobile-modal-comment-input" onfocus="setTimeout(syncActiveMobileModalViewport, 120)" placeholder="Write a comment..." class="flex-1 min-w-0 bg-transparent text-[16px] sm:text-xs leading-snug text-slate-800 placeholder-slate-500 focus:outline-none py-1" required>
                    <button type="submit" id="mobile-modal-comment-submit" class="text-accord-blue hover:text-accord-darkBlue px-1.5 py-1 text-xs font-bold shrink-0" aria-label="Send comment">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </form>
            </div>
        </div>
    `;

    if (modal.querySelector('.feed-book-link-preview[data-book-id]')) {
        hydrateSharedBookLinkPreviews(modal);
    }
}

async function openMobileTextPostModal(postId, options = {}) {
    const entry = _sharedMobilePostRegistry.get(String(postId));
    if (!entry) return;

    ensureMobileTextPostModalDom();
    _activeMobilePostId = String(postId);
    renderMobileTextPostModalContent(postId);

    const modal = document.getElementById('accord-mobile-post-modal');
    lockMobileModalBodyScroll();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    syncActiveMobileModalViewport();

    if (!_mobileModalHistoryPushed) {
        try {
            window.history.pushState({ accordMobilePostModal: String(postId) }, '');
            _mobileModalHistoryPushed = true;
        } catch (_) {}
    }

    if (typeof markPostAsViewed === 'function') {
        markPostAsViewed(postId);
    }

    await loadMobileModalComments(postId);

    if (options.focusComment) {
        setTimeout(() => {
            document.getElementById('mobile-modal-comment-input')?.focus();
        }, 60);
    }
}

function closeMobileTextPostModal({ fromPopState = false } = {}) {
    const modal = document.getElementById('accord-mobile-post-modal');
    if (!modal || modal.classList.contains('hidden')) {
        _activeMobilePostId = null;
        _mobileModalHistoryPushed = false;
        return;
    }

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    resetMobileModalViewportGeometry(modal);
    _activeMobilePostId = null;
    unlockMobileModalBodyScroll();

    if (!fromPopState && _mobileModalHistoryPushed) {
        _mobileModalHistoryPushed = false;
        if (window.history.state && window.history.state.accordMobilePostModal) {
            try {
                window.history.back();
            } catch (_) {}
        }
    } else {
        _mobileModalHistoryPushed = false;
    }
}

function syncMobileModalFromRegistry(postId) {
    const idStr = String(postId);
    const entry = _sharedMobilePostRegistry.get(idStr);
    if (!entry) return;

    const { post, options } = entry;
    const live = getLiveCardPostState(postId, options, post);

    if (_activeMobilePostId && String(_activeMobilePostId) === idStr) {
        const bodyEl = document.getElementById(`mobile-modal-post-body-${postId}`);
        if (bodyEl) bodyEl.textContent = String(post.body || '');

        const likeCountEl = document.getElementById(`mobile-modal-like-count-${postId}`);
        if (likeCountEl) likeCountEl.textContent = live.likesCount;

        const likeBtnEl = document.getElementById(`mobile-modal-like-btn-${postId}`);
        if (likeBtnEl) {
            likeBtnEl.className = `py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${live.isLiked ? 'text-rose-600' : 'text-slate-600'}`;
            const icon = likeBtnEl.querySelector('i');
            if (icon) icon.className = `${live.isLiked ? 'fa-solid' : 'fa-regular'} fa-heart text-sm`;
        }

        const repostLabelEl = document.getElementById(`mobile-modal-repost-count-label-${postId}`);
        if (repostLabelEl) repostLabelEl.textContent = `${live.repostsCount} ${live.repostsCount === 1 ? 'repost' : 'reposts'}`;

        const repostBtnEl = document.getElementById(`mobile-modal-repost-btn-${postId}`);
        if (repostBtnEl) {
            repostBtnEl.className = `py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${live.isReposted ? 'text-emerald-600' : 'text-slate-600'}`;
        }
    }

    if (_activeMobileVideoId && String(_activeMobileVideoId) === idStr) {
        const vLikeCount = document.getElementById(`mobile-video-like-count-${postId}`);
        if (vLikeCount) vLikeCount.textContent = live.likesCount;

        const vLikeBtn = document.getElementById(`mobile-video-like-btn-${postId}`);
        if (vLikeBtn) {
            const icon = vLikeBtn.querySelector('i');
            if (icon) icon.className = `${live.isLiked ? 'fa-solid text-rose-500' : 'fa-regular text-white'} fa-heart text-2xl drop-shadow`;
        }

        const vCommentCount = document.getElementById(`mobile-video-comment-count-${postId}`);
        if (vCommentCount) vCommentCount.textContent = live.commentsCount;

        const vSheetCount = document.getElementById(`mobile-video-sheet-comment-count-${postId}`);
        if (vSheetCount) vSheetCount.textContent = live.commentsCount;

        const vRepostCount = document.getElementById(`mobile-video-repost-count-${postId}`);
        if (vRepostCount) vRepostCount.textContent = live.repostsCount;

        const vRepostBtn = document.getElementById(`mobile-video-repost-btn-${postId}`);
        if (vRepostBtn) {
            const icon = vRepostBtn.querySelector('i');
            if (icon) icon.className = `fa-solid fa-retweet text-2xl drop-shadow ${live.isReposted ? 'text-emerald-400' : 'text-white'}`;
        }
    }
}

async function handleMobileModalLike(postId) {
    if (typeof togglePostLike === 'function') {
        await togglePostLike(postId);
    }
    syncMobileModalFromRegistry(postId);
}

async function fetchPostCommentsShared(postId) {
    const client = window.supabaseClient;
    if (!client) return { data: null, error: new Error('No client') };
    return await client
        .from('post_comments')
        .select('id, author_name, comment_text, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
}

async function submitSharedCommentPayload(postId, inputEl, submitBtnEl) {
    const client = window.supabaseClient;
    if (!client || !inputEl) return false;

    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
        if (typeof showToast === 'function') showToast('Please sign in to comment on posts.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search)}`;
        }, 800);
        return false;
    }

    const text = inputEl.value.trim();
    if (!text) return false;

    const activeCtx = typeof window.getAccordActiveContext === 'function' ? window.getAccordActiveContext() : null;
    if (activeCtx?.isSwitched && !activeCtx.permissions?.can_post) {
        if (typeof showToast === 'function') showToast('You do not have permission to comment on behalf of this verified page.', true);
        return false;
    }

    const commentAuthorId = activeCtx?.isSwitched ? activeCtx.activeProfileId : session.user.id;
    let authorName = activeCtx?.isSwitched
        ? (activeCtx.activeProfile?.full_name || 'Verified Page')
        : (session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Member');

    if (!activeCtx?.isSwitched) {
        const { data: prof } = await client.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle();
        if (prof?.full_name) authorName = prof.full_name;
    }

    inputEl.value = '';
    if (submitBtnEl) submitBtnEl.disabled = true;

    const { error } = await client.from('post_comments').insert([{
        post_id: postId,
        user_id: session.user.id,
        author_id: commentAuthorId,
        author_name: authorName,
        comment_text: text
    }]);

    if (submitBtnEl) submitBtnEl.disabled = false;

    if (error) {
        if (typeof showToast === 'function') showToast(`Could not post comment: ${error.message}`, true);
        inputEl.value = text;
        return false;
    }

    if (typeof markPostAsViewed === 'function') {
        markPostAsViewed(postId);
    }

    if (typeof commentCountsByPost === 'object' && commentCountsByPost !== null) {
        commentCountsByPost[String(postId)] = (commentCountsByPost[String(postId)] || 0) + 1;
    }

    const inlineContainer = document.getElementById(`inline-comments-${postId}`);
    if (inlineContainer && !inlineContainer.classList.contains('hidden') && typeof loadInlineComments === 'function') {
        loadInlineComments(postId);
    }

    return true;
}

async function loadMobileModalComments(postId, { scrollToBottom = false } = {}) {
    const listEl = document.getElementById('mobile-modal-comments-list');
    if (!listEl) return;

    const { data, error } = await fetchPostCommentsShared(postId);

    if (error) {
        listEl.innerHTML = `<p class="text-xs text-red-500 text-center py-3">Could not load comments.</p>`;
        return;
    }

    const comments = data || [];
    listEl.innerHTML = renderSharedCommentsHtml(comments);

    const countLabelEl = document.getElementById(`mobile-modal-comment-count-label-${postId}`);
    if (countLabelEl) {
        countLabelEl.innerHTML = `<span id="mobile-modal-comment-count-${postId}">${comments.length}</span> ${comments.length === 1 ? 'comment' : 'comments'}`;
    }
    const cardCountEl = document.getElementById(`comment-count-${postId}`);
    if (cardCountEl) cardCountEl.textContent = comments.length;

    if (scrollToBottom) {
        const scrollArea = document.getElementById('mobile-modal-scroll-area');
        if (scrollArea) {
            scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
        }
    }
}

async function submitMobileModalComment(e, postId) {
    e.preventDefault();
    const input = document.getElementById('mobile-modal-comment-input');
    const submitBtn = document.getElementById('mobile-modal-comment-submit');
    const ok = await submitSharedCommentPayload(postId, input, submitBtn);
    if (ok) {
        await loadMobileModalComments(postId, { scrollToBottom: true });
    }
}

// ==========================================
// MOBILE FEED AUTOPLAY + FULL-SCREEN VIDEO MODAL + SWIPE + COMMENT SHEET
// ==========================================

let _mobileFeedVideoObserver = null;
let _mobileFeedVideoSelectTimer = null;
let _activeMobileFeedVideoId = null;
let _mobileFeedVideoUnmutedPref = false;
const _mobileFeedVideoRatios = new Map();
const _mobileFeedVideoTimeMap = new Map();
const _mobileFeedVideoState = new Map();
let _activeMobileVideoModalOptions = { startTime: 0, unmuted: false };

function pauseAllOtherAccordMedia(exceptEl = null) {
    if (typeof document === 'undefined') return;

    document.querySelectorAll('video, audio').forEach((el) => {
        if (exceptEl && (el === exceptEl || (typeof exceptEl.contains === 'function' && exceptEl.contains(el)))) {
            return;
        }
        try {
            if (!el.paused) el.pause();
        } catch (_) {}
    });

    document.querySelectorAll('iframe').forEach((iframe) => {
        if (exceptEl && (iframe === exceptEl || (typeof exceptEl.contains === 'function' && exceptEl.contains(iframe)))) {
            return;
        }
        const src = String(iframe.getAttribute('src') || '');
        if (src.includes('youtube.com/embed/') || src.includes('youtube-nocookie.com/embed/')) {
            sendYouTubePlayerCommand(iframe, 'pauseVideo');
        }
    });

    if (_activeMobileFeedVideoId) {
        const activeSlot = document.getElementById(`mobile-feed-video-slot-${_activeMobileFeedVideoId}`);
        const activePlayer = document.getElementById(`mobile-feed-video-player-${_activeMobileFeedVideoId}`);
        const isExceptActiveFeed = Boolean(
            exceptEl && (
                exceptEl === activePlayer ||
                exceptEl === activeSlot ||
                (activeSlot && typeof activeSlot.contains === 'function' && activeSlot.contains(exceptEl))
            )
        );
        if (!isExceptActiveFeed) {
            teardownActiveMobileFeedVideo();
        }
    }

    document.querySelectorAll('[data-audio-card]').forEach((audioCard) => {
        if (exceptEl && (audioCard === exceptEl || (typeof audioCard.contains === 'function' && audioCard.contains(exceptEl)))) {
            return;
        }
        const panel = audioCard.querySelector('[data-audio-player-panel]');
        if (panel && !panel.classList.contains('hidden')) {
            panel.classList.add('hidden');
            const playerBody = audioCard.querySelector('[data-audio-player-body]');
            if (playerBody) {
                playerBody.innerHTML = '';
                delete playerBody.dataset.loaded;
            }
            const playBtn = audioCard.querySelector('[data-audio-play-btn]');
            if (playBtn) {
                playBtn.innerHTML = '<i class="fa-solid fa-play text-[11px]"></i><span>Play in App</span>';
            }
        }
    });
}

function playDesktopFeedYouTube(btnEl, embedUrl) {
    if (!btnEl || !embedUrl) return;
    pauseAllOtherAccordMedia(null);

    const sep = embedUrl.includes('?') ? '&' : '?';
    const params = ['autoplay=1', 'enablejsapi=1', 'playsinline=1'];
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')) {
        params.push(`origin=${encodeURIComponent(window.location.origin)}`);
    }
    const finalUrl = `${embedUrl}${sep}${params.join('&')}`;

    const iframe = document.createElement('iframe');
    iframe.src = finalUrl;
    iframe.className = 'w-full h-full border-0';
    iframe.setAttribute('allow', 'autoplay *; encrypted-media *; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    iframe.addEventListener('load', () => {
        registerYouTubeIframeListener(iframe, `desktop-${Date.now()}`);
    });
    btnEl.replaceWith(iframe);
}

function sendYouTubePlayerCommand(iframe, func, args = []) {
    if (!iframe || !iframe.contentWindow) return;
    try {
        iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func,
            args
        }), '*');
    } catch (_) {}
}

function registerYouTubeIframeListener(iframe, id) {
    if (!iframe || !iframe.contentWindow) return;
    try {
        iframe.contentWindow.postMessage(JSON.stringify({
            event: 'listening',
            id: String(id || '')
        }), '*');
    } catch (_) {}
}

function getSharedFeedAutoplayEmbedUrl(url, { startTime = 0, mute = true } = {}) {
    const embed = getSharedYouTubeEmbedUrl(url);
    if (!embed) return '';
    if (embed.includes('youtube.com/embed/')) {
        const videoId = extractSharedYouTubeVideoId(url);
        const sep = embed.includes('?') ? '&' : '?';
        const params = [
            'autoplay=1',
            'playsinline=1',
            'enablejsapi=1',
            'rel=0',
            'modestbranding=1',
            'loop=1'
        ];
        if (videoId) params.push(`playlist=${encodeURIComponent(videoId)}`);
        if (mute) params.push('mute=1');
        if (startTime > 0) params.push(`start=${Math.floor(startTime)}`);
        if (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')) {
            params.push(`origin=${encodeURIComponent(window.location.origin)}`);
        }
        return `${embed}${sep}${params.join('&')}`;
    }
    return embed;
}

function getSharedAutoplayVideoEmbedUrl(url, options = {}) {
    return getSharedFeedAutoplayEmbedUrl(url, { mute: true, ...options });
}

function updateMobileFeedVideoStatusBadge(postId, { visible = false, unmuted = false } = {}) {
    const statusEl = document.getElementById(`mobile-feed-video-status-${postId}`);
    if (!statusEl) return;
    if (!visible) {
        statusEl.classList.add('hidden');
        statusEl.classList.remove('flex');
        return;
    }
    statusEl.classList.remove('hidden');
    statusEl.classList.add('flex');
    statusEl.innerHTML = unmuted
        ? '<i class="fa-solid fa-volume-high text-[10px] text-sky-300"></i><span>Sound on · Tap to mute</span>'
        : '<i class="fa-solid fa-volume-xmark text-[10px]"></i><span>Tap for sound</span>';
}

function teardownActiveMobileFeedVideo() {
    if (_mobileFeedVideoSelectTimer) {
        clearTimeout(_mobileFeedVideoSelectTimer);
        _mobileFeedVideoSelectTimer = null;
    }
    if (!_activeMobileFeedVideoId) return;
    const postId = String(_activeMobileFeedVideoId);
    _activeMobileFeedVideoId = null;

    const directPlayer = document.getElementById(`mobile-feed-video-player-${postId}`);
    if (directPlayer && directPlayer.tagName === 'VIDEO') {
        if (!Number.isNaN(directPlayer.currentTime) && directPlayer.currentTime > 0) {
            _mobileFeedVideoTimeMap.set(postId, directPlayer.currentTime);
        }
        try {
            directPlayer.pause();
            directPlayer.removeAttribute('src');
            directPlayer.load();
        } catch (_) {}
    }

    const slot = document.getElementById(`mobile-feed-video-slot-${postId}`);
    if (slot) {
        slot.innerHTML = '';
        slot.classList.add('hidden');
    }
    const poster = document.getElementById(`mobile-feed-video-poster-${postId}`);
    if (poster) {
        poster.classList.remove('hidden');
    }
    updateMobileFeedVideoStatusBadge(postId, { visible: false });
    _mobileFeedVideoState.delete(postId);
}

function mountMobileFeedVideoPlayer(postId) {
    const idStr = String(postId);
    if (typeof window === 'undefined' || window.innerWidth >= 768) return;
    if (_activeMobileVideoId || _activeMobilePostId) return;

    const cardMedia = document.querySelector(`[data-mobile-video-card="${CSS.escape(idStr)}"]`);
    const slot = document.getElementById(`mobile-feed-video-slot-${idStr}`);
    if (!cardMedia || !slot) return;

    const mediaUrl = cardMedia.getAttribute('data-video-url') || '';
    const isDirectVideo = cardMedia.getAttribute('data-is-direct-video') === '1';
    if (!mediaUrl) return;

    pauseAllOtherAccordMedia(slot);

    const shouldUnmute = Boolean(_mobileFeedVideoUnmutedPref);
    _activeMobileFeedVideoId = idStr;
    _mobileFeedVideoState.set(idStr, { unmuted: shouldUnmute });

    const savedStart = Math.floor(_mobileFeedVideoTimeMap.get(idStr) || 0);
    slot.classList.remove('hidden');

    if (isDirectVideo) {
        slot.innerHTML = `<video id="mobile-feed-video-player-${idStr}" src="${escapeShareHtml(mediaUrl)}" autoplay ${shouldUnmute ? '' : 'muted'} playsinline loop preload="metadata" class="w-full h-full object-cover bg-black pointer-events-none"></video>`;
        const videoEl = document.getElementById(`mobile-feed-video-player-${idStr}`);
        if (videoEl) {
            videoEl.muted = !shouldUnmute;
            if (savedStart > 0) {
                videoEl.addEventListener('loadedmetadata', () => {
                    try { videoEl.currentTime = savedStart; } catch (_) {}
                }, { once: true });
            }
            videoEl.addEventListener('timeupdate', () => {
                if (!Number.isNaN(videoEl.currentTime)) {
                    _mobileFeedVideoTimeMap.set(idStr, videoEl.currentTime);
                }
            });
            videoEl.play().catch(() => {
                if (shouldUnmute) {
                    videoEl.muted = true;
                    _mobileFeedVideoState.set(idStr, { unmuted: false });
                    updateMobileFeedVideoStatusBadge(idStr, { visible: true, unmuted: false });
                    videoEl.play().catch(() => {});
                }
            });
        }
    } else {
        const autoplayUrl = getSharedFeedAutoplayEmbedUrl(mediaUrl, { startTime: savedStart, mute: true });
        slot.innerHTML = `<iframe id="mobile-feed-video-player-${idStr}" src="${escapeShareHtml(autoplayUrl)}" class="w-full h-full border-0 pointer-events-none" allow="autoplay *; encrypted-media *; picture-in-picture" allowfullscreen></iframe>`;
        const iframeEl = document.getElementById(`mobile-feed-video-player-${idStr}`);
        if (iframeEl) {
            const syncFeedYouTube = () => {
                if (String(_activeMobileFeedVideoId) !== idStr) return;
                registerYouTubeIframeListener(iframeEl, `feed-${idStr}`);
                sendYouTubePlayerCommand(iframeEl, 'playVideo');
                if (_mobileFeedVideoState.get(idStr)?.unmuted) {
                    sendYouTubePlayerCommand(iframeEl, 'unMute');
                } else {
                    sendYouTubePlayerCommand(iframeEl, 'mute');
                }
            };
            iframeEl.addEventListener('load', () => {
                syncFeedYouTube();
                setTimeout(syncFeedYouTube, 350);
                setTimeout(syncFeedYouTube, 800);
            });
        }
    }

    updateMobileFeedVideoStatusBadge(idStr, { visible: true, unmuted: shouldUnmute });
}

function scheduleActiveMobileFeedVideoSelection() {
    if (_mobileFeedVideoSelectTimer) {
        clearTimeout(_mobileFeedVideoSelectTimer);
    }
    _mobileFeedVideoSelectTimer = setTimeout(() => {
        _mobileFeedVideoSelectTimer = null;
        if (typeof window === 'undefined' || window.innerWidth >= 768) {
            teardownActiveMobileFeedVideo();
            return;
        }
        if (_activeMobileVideoId || _activeMobilePostId || document.hidden) return;

        let bestId = null;
        let bestRatio = 0;
        _mobileFeedVideoRatios.forEach((ratio, id) => {
            if (ratio >= 0.45 && ratio > bestRatio) {
                bestRatio = ratio;
                bestId = id;
            }
        });

        if (!bestId) {
            teardownActiveMobileFeedVideo();
            return;
        }
        if (String(_activeMobileFeedVideoId) === String(bestId)) return;

        teardownActiveMobileFeedVideo();
        mountMobileFeedVideoPlayer(bestId);
    }, 120);
}

function setupMobileFeedVideoObserver() {
    if (_mobileFeedVideoObserver) {
        _mobileFeedVideoObserver.disconnect();
        _mobileFeedVideoObserver = null;
    }
    _mobileFeedVideoRatios.clear();

    if (typeof window === 'undefined' || window.innerWidth >= 768) {
        teardownActiveMobileFeedVideo();
        return;
    }
    if (typeof IntersectionObserver === 'undefined') return;

    const cards = document.querySelectorAll('[data-mobile-video-card]');
    if (!cards.length) {
        teardownActiveMobileFeedVideo();
        return;
    }

    _mobileFeedVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const postId = entry.target.getAttribute('data-mobile-video-card');
            if (!postId) return;
            if (entry.isIntersecting) {
                _mobileFeedVideoRatios.set(String(postId), entry.intersectionRatio);
            } else {
                _mobileFeedVideoRatios.delete(String(postId));
            }
        });
        scheduleActiveMobileFeedVideoSelection();
    }, { threshold: [0, 0.25, 0.45, 0.65, 0.85] });

    cards.forEach((el) => _mobileFeedVideoObserver.observe(el));
}

function handleMobileFeedVideoTap(e, postId) {
    if (e) e.stopPropagation();
    const idStr = String(postId);

    // If this video isn't actively mounted yet (e.g. quick tap before observer settles), mount and unmute it immediately.
    if (String(_activeMobileFeedVideoId) !== idStr) {
        _mobileFeedVideoUnmutedPref = true;
        teardownActiveMobileFeedVideo();
        mountMobileFeedVideoPlayer(idStr);
        return;
    }

    const state = _mobileFeedVideoState.get(idStr) || { unmuted: Boolean(_mobileFeedVideoUnmutedPref) };
    const nextUnmuted = !state.unmuted;
    state.unmuted = nextUnmuted;
    _mobileFeedVideoState.set(idStr, state);
    _mobileFeedVideoUnmutedPref = nextUnmuted;

    const playerEl = document.getElementById(`mobile-feed-video-player-${idStr}`);
    if (playerEl) {
        if (playerEl.tagName === 'VIDEO') {
            playerEl.muted = !nextUnmuted;
            if (playerEl.paused) {
                playerEl.play().catch(() => {});
            }
        } else if (playerEl.tagName === 'IFRAME') {
            registerYouTubeIframeListener(playerEl, `feed-${idStr}`);
            sendYouTubePlayerCommand(playerEl, nextUnmuted ? 'unMute' : 'mute');
            sendYouTubePlayerCommand(playerEl, 'playVideo');
        }
    }
    updateMobileFeedVideoStatusBadge(idStr, { visible: true, unmuted: nextUnmuted });
}

function openMobileVideoFromFeed(e, postId, domId = '') {
    if (e) e.stopPropagation();
    const idStr = String(postId);
    const resolvedDomId = String(domId || postId);

    const directPlayer = document.getElementById(`mobile-feed-video-player-${resolvedDomId}`);
    if (directPlayer && directPlayer.tagName === 'VIDEO' && !Number.isNaN(directPlayer.currentTime)) {
        _mobileFeedVideoTimeMap.set(resolvedDomId, directPlayer.currentTime);
    }

    const startTime = Math.floor(_mobileFeedVideoTimeMap.get(resolvedDomId) || 0);
    const activeState = _mobileFeedVideoState.get(resolvedDomId);
    const unmuted = activeState ? Boolean(activeState.unmuted) : Boolean(_mobileFeedVideoUnmutedPref);

    teardownActiveMobileFeedVideo();
    openMobileVideoModal(idStr, { startTime, unmuted });
}

if (typeof window !== 'undefined') {
    window.setupMobileFeedVideoObserver = setupMobileFeedVideoObserver;
    window.teardownActiveMobileFeedVideo = teardownActiveMobileFeedVideo;
    window.pauseAllOtherAccordMedia = pauseAllOtherAccordMedia;
    window.playDesktopFeedYouTube = playDesktopFeedYouTube;

    document.addEventListener('play', (event) => {
        const target = event.target;
        if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
            pauseAllOtherAccordMedia(target);
        }
    }, true);

    window.addEventListener('message', (event) => {
        if (!event.origin || (!event.origin.includes('youtube.com') && !event.origin.includes('youtube-nocookie.com'))) {
            return;
        }
        let data = null;
        try {
            data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch (_) {
            return;
        }
        if (!data || typeof data !== 'object') return;

        if (data.event === 'infoDelivery' && data.info) {
            if (typeof data.info.currentTime === 'number' && _activeMobileFeedVideoId) {
                const feedIframe = document.getElementById(`mobile-feed-video-player-${_activeMobileFeedVideoId}`);
                if (feedIframe && feedIframe.contentWindow === event.source) {
                    _mobileFeedVideoTimeMap.set(String(_activeMobileFeedVideoId), data.info.currentTime);
                }
            }
            if (typeof data.info.muted === 'boolean' && _activeMobileVideoId) {
                const modalIframe = document.getElementById('mobile-video-yt-player');
                if (modalIframe && modalIframe.tagName === 'IFRAME' && modalIframe.contentWindow === event.source && modalIframe.dataset.ytReady === '1') {
                    const isNowUnmuted = !data.info.muted && (typeof data.info.volume !== 'number' || data.info.volume > 0);
                    const initialSyncAt = Number(modalIframe.dataset.ytInitialSyncAt || 0);
                    const withinGraceWindow = initialSyncAt > 0 && (Date.now() - initialSyncAt) < 350;
                    if (!withinGraceWindow || isNowUnmuted === Boolean(_activeMobileVideoModalOptions.unmuted)) {
                        _activeMobileVideoModalOptions.unmuted = isNowUnmuted;
                        _mobileFeedVideoUnmutedPref = isNowUnmuted;
                    }
                }
            }
        }

        if (data.event === 'onStateChange') {
            if (data.info === 1) {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    if (iframe.contentWindow === event.source) {
                        pauseAllOtherAccordMedia(iframe);
                        break;
                    }
                }
            } else if (data.info === 2 || data.info === -1 || data.info === 5) {
                const modalIframe = document.getElementById('mobile-video-yt-player');
                if (
                    modalIframe &&
                    modalIframe.tagName === 'IFRAME' &&
                    modalIframe.contentWindow === event.source &&
                    modalIframe.dataset.ytUnmuteAttempted === '1' &&
                    modalIframe.dataset.ytFallbackMuted !== '1'
                ) {
                    const initialSyncAt = Number(modalIframe.dataset.ytInitialSyncAt || 0);
                    if (initialSyncAt > 0 && (Date.now() - initialSyncAt) < 2000) {
                        modalIframe.dataset.ytFallbackMuted = '1';
                        sendYouTubePlayerCommand(modalIframe, 'mute');
                        sendYouTubePlayerCommand(modalIframe, 'playVideo');
                    }
                }
            }
        }

        if (data.event === 'onReady') {
            const modalIframe = document.getElementById('mobile-video-yt-player');
            if (modalIframe && modalIframe.tagName === 'IFRAME' && modalIframe.contentWindow === event.source) {
                modalIframe.dataset.ytReady = '1';
                modalIframe.dataset.ytInitialSyncAt = String(Date.now());
                sendYouTubePlayerCommand(modalIframe, 'playVideo');
                if (_activeMobileVideoModalOptions.unmuted && modalIframe.dataset.ytFallbackMuted !== '1') {
                    modalIframe.dataset.ytUnmuteAttempted = '1';
                    sendYouTubePlayerCommand(modalIframe, 'unMute');
                } else {
                    sendYouTubePlayerCommand(modalIframe, 'mute');
                }
            }
            if (_activeMobileFeedVideoId) {
                const feedIframe = document.getElementById(`mobile-feed-video-player-${_activeMobileFeedVideoId}`);
                if (feedIframe && feedIframe.tagName === 'IFRAME' && feedIframe.contentWindow === event.source) {
                    sendYouTubePlayerCommand(feedIframe, 'playVideo');
                    if (_mobileFeedVideoState.get(String(_activeMobileFeedVideoId))?.unmuted) {
                        sendYouTubePlayerCommand(feedIframe, 'unMute');
                    } else {
                        sendYouTubePlayerCommand(feedIframe, 'mute');
                    }
                }
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            teardownActiveMobileFeedVideo();
        } else {
            setupMobileFeedVideoObserver();
        }
    });
}

function getMobileVideoList() {
    if (Array.isArray(window.allFeedPosts) && window.allFeedPosts.length > 0) {
        window.allFeedPosts.forEach(p => {
            if (p && p.post_type === 'video' && p.media_url && _sharedMobilePostRegistry.has(String(p.id))) {
                if (!_sharedMobileVideoIds.includes(String(p.id))) {
                    _sharedMobileVideoIds.push(String(p.id));
                }
            }
        });
    }
    return _sharedMobileVideoIds.filter(id => _sharedMobilePostRegistry.has(String(id)));
}

function ensureMobileVideoModalDom() {
    let modal = document.getElementById('accord-mobile-video-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'accord-mobile-video-modal';
        modal.className = 'fixed inset-0 z-[46] bg-black hidden flex-col md:hidden overflow-hidden select-none';
        modal.addEventListener('click', closeMobileModalMenus);
        document.body.appendChild(modal);
    }

    if (document.getElementById('mobile-video-player-slot')) return;

    modal.innerHTML = `
        <div id="mobile-video-ambient-slot" class="contents"></div>
        <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/80 pointer-events-none"></div>
        <div id="mobile-video-top-bar" class="relative z-30 shrink-0 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 flex items-center justify-between"></div>
        <div id="mobile-video-stage" class="relative z-10 flex-1 flex items-center justify-center touch-none transition-transform duration-200 ease-out">
            <div id="mobile-video-player-slot" class="w-full flex items-center justify-center">
                <video id="mobile-video-direct-player" controls playsinline loop class="hidden w-full max-h-[62dvh] object-contain bg-black"></video>
                <div id="mobile-video-yt-wrap" class="hidden w-full aspect-video bg-black shadow-2xl">
                    <iframe id="mobile-video-yt-player" class="w-full h-full border-0" allow="autoplay *; encrypted-media *; picture-in-picture" allowfullscreen></iframe>
                </div>
            </div>
            <div id="mobile-video-stage-overlays" class="contents"></div>
        </div>
        <div id="mobile-video-comment-bar" class="relative z-20 shrink-0 px-3.5 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-black/75 border-t border-white/10"></div>
        <div id="mobile-video-comments-sheet-slot" class="contents"></div>
    `;

    const stage = document.getElementById('mobile-video-stage');
    if (stage) {
        attachMobileVideoSwipeHandlers(stage);
    }

    const directPlayer = document.getElementById('mobile-video-direct-player');
    if (directPlayer) {
        directPlayer.addEventListener('volumechange', () => {
            if (!_activeMobileVideoId || directPlayer.classList.contains('hidden')) return;
            const isNowUnmuted = !directPlayer.muted && directPlayer.volume > 0;
            _activeMobileVideoModalOptions.unmuted = isNowUnmuted;
            _mobileFeedVideoUnmutedPref = isNowUnmuted;
        });
    }

    const ytPlayer = document.getElementById('mobile-video-yt-player');
    if (ytPlayer) {
        const syncModalYouTubePlayback = () => {
            const activePostId = ytPlayer.dataset.ytPostId || '';
            if (!activePostId || String(_activeMobileVideoId) !== String(activePostId)) return;
            registerYouTubeIframeListener(ytPlayer, `modal-${activePostId}`);
            ytPlayer.dataset.ytInitialSyncAt = String(Date.now());
            sendYouTubePlayerCommand(ytPlayer, 'playVideo');
            if (_activeMobileVideoModalOptions.unmuted && ytPlayer.dataset.ytFallbackMuted !== '1') {
                ytPlayer.dataset.ytUnmuteAttempted = '1';
                sendYouTubePlayerCommand(ytPlayer, 'unMute');
            } else {
                sendYouTubePlayerCommand(ytPlayer, 'mute');
            }
        };
        ytPlayer.addEventListener('load', () => {
            const currentSrc = ytPlayer.getAttribute('src') || '';
            if (!currentSrc || currentSrc === 'about:blank') return;
            const loadedPostId = ytPlayer.dataset.ytPostId || '';
            syncModalYouTubePlayback();
            [150, 400, 850, 1400].forEach((delay) => {
                setTimeout(() => {
                    if (String(_activeMobileVideoId) !== String(loadedPostId)) return;
                    if (ytPlayer.dataset.ytReady !== '1') {
                        syncModalYouTubePlayback();
                    } else {
                        sendYouTubePlayerCommand(ytPlayer, 'playVideo');
                    }
                }, delay);
            });
        });
    }
}

function syncMobileVideoModalPlayer(postId, post, { startTime = 0, unmuted = false } = {}) {
    const directPlayer = document.getElementById('mobile-video-direct-player');
    const ytWrap = document.getElementById('mobile-video-yt-wrap');
    const ytPlayer = document.getElementById('mobile-video-yt-player');
    if (!directPlayer || !ytWrap || !ytPlayer) return;

    const mediaUrl = post.media_url || '';
    const isDirectVideo = /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(mediaUrl);

    if (isDirectVideo) {
        const ytSrc = ytPlayer.getAttribute('src') || '';
        if (ytSrc && ytSrc !== 'about:blank') {
            sendYouTubePlayerCommand(ytPlayer, 'pauseVideo');
        }
        ytWrap.classList.add('hidden');
        directPlayer.classList.remove('hidden');

        pauseAllOtherAccordMedia(directPlayer);

        const prevSrc = directPlayer.getAttribute('src') || '';
        if (prevSrc !== mediaUrl) {
            directPlayer.src = mediaUrl;
            directPlayer.load();
        }
        directPlayer.muted = !unmuted;

        if (startTime > 0) {
            if (directPlayer.readyState >= 1) {
                try { directPlayer.currentTime = startTime; } catch (_) {}
            } else {
                directPlayer.addEventListener('loadedmetadata', () => {
                    if (String(_activeMobileVideoId) !== String(postId)) return;
                    try { directPlayer.currentTime = startTime; } catch (_) {}
                }, { once: true });
            }
        }

        directPlayer.play().catch((err) => {
            if (String(_activeMobileVideoId) !== String(postId) || err?.name === 'AbortError') return;
            directPlayer.muted = true;
            directPlayer.play().catch(() => {});
        });
        return;
    }

    try {
        directPlayer.pause();
        directPlayer.removeAttribute('src');
        directPlayer.load();
    } catch (_) {}
    directPlayer.classList.add('hidden');
    ytWrap.classList.remove('hidden');

    pauseAllOtherAccordMedia(ytPlayer);

    ytPlayer.dataset.ytPostId = String(postId);
    ytPlayer.dataset.ytUnmuteAttempted = '0';
    ytPlayer.dataset.ytFallbackMuted = '0';
    ytPlayer.dataset.ytInitialSyncAt = String(Date.now());

    const ytVideoId = extractSharedYouTubeVideoId(mediaUrl);
    const currentYtSrc = ytPlayer.getAttribute('src') || '';
    if (ytPlayer.dataset.ytReady === '1' && ytVideoId && currentYtSrc.includes('youtube.com/embed/')) {
        registerYouTubeIframeListener(ytPlayer, `modal-${postId}`);
        sendYouTubePlayerCommand(ytPlayer, 'loadVideoById', [{ videoId: ytVideoId, startSeconds: Math.floor(startTime) || 0 }]);
        sendYouTubePlayerCommand(ytPlayer, 'playVideo');
        if (unmuted) {
            ytPlayer.dataset.ytUnmuteAttempted = '1';
            sendYouTubePlayerCommand(ytPlayer, 'unMute');
        } else {
            sendYouTubePlayerCommand(ytPlayer, 'mute');
        }
        return;
    }

    ytPlayer.dataset.ytReady = '0';
    // Always start YouTube embeds muted in the URL so browser autoplay policy allows immediate playback;
    // unMute is applied via YouTube IFrame API in onReady/load when unmuted=true, with muted fallback if blocked.
    const autoplayEmbedUrl = getSharedAutoplayVideoEmbedUrl(mediaUrl, { startTime, mute: true });
    ytPlayer.src = autoplayEmbedUrl;
}

function renderMobileVideoModalContent(postId, { slideDirection = '', startTime = 0, unmuted = false } = {}) {
    ensureMobileVideoModalDom();
    const modal = document.getElementById('accord-mobile-video-modal');
    const entry = _sharedMobilePostRegistry.get(String(postId));
    if (!modal || !entry) return;

    const { post, options } = entry;
    const {
        myAvatarInitial = 'U',
        authorHandle = '',
        authorAvatarUrl = '',
        canManage = false
    } = options;

    _mobileVideoCaptionExpanded = false;
    const live = getLiveCardPostState(postId, options, post);
    const postUrl = getPostShareUrl(post.id);
    const dateFormatted = formatSharedFeedTimeAgo(post.created_at);
    const displayAuthor = post.is_anonymous ? 'Anonymous' : (post.author_name || 'Anonymous');
    const isVerifiedAuthor = post.author_role === 'ministry_minister' && !post.is_anonymous;
    const authorProfileUrl = (!post.is_anonymous && post.author_id)
        ? `user.html?id=${encodeURIComponent(post.author_id)}`
        : null;

    const thumbUrl = getSharedVideoThumbnailUrl(post.media_url || '');

    const videoList = getMobileVideoList();
    const currentIdx = videoList.indexOf(String(postId));
    const hasMultiple = videoList.length > 1;

    const avatarVisual = (!post.is_anonymous && authorAvatarUrl)
        ? `<img loading="lazy" decoding="async" src="${escapeShareHtml(authorAvatarUrl)}" alt="${escapeShareHtml(displayAuthor)}" class="w-full h-full object-cover rounded-full">`
        : `<span>${escapeShareHtml(displayAuthor.charAt(0).toUpperCase())}</span>`;

    const avatarInner = `
        <div class="relative w-9 h-9 rounded-full bg-white/20 text-white font-bold flex items-center justify-center text-sm shrink-0 ring-2 ring-white/80 overflow-hidden">
            ${avatarVisual}
            ${isVerifiedAuthor ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-black"><i class="fa-solid fa-check text-[7px]"></i></span>` : ''}
        </div>
    `;

    const bodyText = String(post.body || '').trim();
    const isLongCaption = bodyText.length > 90;

    const ambientBgHtml = thumbUrl
        ? `<img src="${escapeShareHtml(thumbUrl)}" alt="" class="absolute inset-0 w-full h-full object-cover blur-3xl scale-125 opacity-55 pointer-events-none">`
        : `<div class="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-800 to-black pointer-events-none"></div>`;

    const ambientSlot = document.getElementById('mobile-video-ambient-slot');
    if (ambientSlot) {
        ambientSlot.innerHTML = ambientBgHtml;
    }

    const topBar = document.getElementById('mobile-video-top-bar');
    if (topBar) {
        topBar.innerHTML = `
            <button type="button" onclick="closeMobileVideoModal()" class="w-10 h-10 rounded-full bg-black/30 hover:bg-black/50 active:bg-black/70 text-white flex items-center justify-center transition-colors" aria-label="Back to feed">
                <i class="fa-solid fa-chevron-left text-lg"></i>
            </button>

            <div class="flex items-center gap-2">
                ${hasMultiple && currentIdx !== -1 ? `
                <span class="text-[11px] font-semibold text-white/80 bg-black/35 backdrop-blur-sm px-2.5 py-1 rounded-full">
                    ${currentIdx + 1} / ${videoList.length}
                </span>` : ''}
                <div class="relative">
                    <button type="button" onclick="toggleMobileModalPostMenu(event, '${post.id}')" class="w-10 h-10 rounded-full bg-black/30 hover:bg-black/50 active:bg-black/70 text-white flex items-center justify-center transition-colors" aria-label="Video options">
                        <i class="fa-solid fa-ellipsis text-lg"></i>
                    </button>
                    <div id="mobile-modal-post-menu-${post.id}" onclick="event.stopPropagation()" class="mobile-modal-menu hidden absolute right-0 top-11 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40">
                        <a href="${escapeShareHtml(postUrl)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="fa-solid fa-arrow-up-right-from-square w-3.5 text-center text-slate-400"></i>
                            <span>Open Full Post</span>
                        </a>
                        <button type="button" data-save-post-menu-btn="${escapeShareHtml(post.id)}" onclick="closeMobileModalMenus(); toggleSavePost('${escapeShareHtml(post.id)}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="${isPostSavedShared(post.id) ? 'fa-solid' : 'fa-regular'} fa-bookmark w-3.5 text-center text-accord-gold"></i>
                            <span>${isPostSavedShared(post.id) ? 'Saved (Remove)' : 'Save Post'}</span>
                        </button>
                        ${canManage ? `
                        <button type="button" onclick="closeMobileModalMenus(); handleEditPostClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="fa-regular fa-pen-to-square w-3.5 text-center text-accord-blue"></i>
                            <span>Edit Post</span>
                        </button>
                        <a href="promote.html?post=${encodeURIComponent(post.id)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-accord-gold hover:bg-amber-50/70 flex items-center gap-2.5">
                            <i class="fa-solid fa-bullhorn w-3.5 text-center"></i>
                            <span>Promote Post</span>
                        </a>` : ''}
                        <button type="button" onclick="closeMobileModalMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                            <span>Send to Chat</span>
                        </button>
                        <button type="button" onclick="closeMobileModalMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                            <span>Copy Link / Share</span>
                        </button>
                        ${canManage ? `
                        <button type="button" onclick="closeMobileModalMenus(); handleDeletePostClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                            <i class="fa-regular fa-trash-can w-3.5 text-center"></i>
                            <span>Delete Post</span>
                        </button>` : `
                        <button type="button" onclick="closeMobileModalMenus(); openReportModal('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                            <i class="fa-regular fa-flag w-3.5 text-center"></i>
                            <span>Flag Post</span>
                        </button>`}
                    </div>
                </div>
            </div>
        `;
    }

    const stageOverlays = document.getElementById('mobile-video-stage-overlays');
    if (stageOverlays) {
        stageOverlays.innerHTML = `
            <!-- Right-Side Vertical Action Rail (Facebook Video Style) -->
            <div class="absolute right-3 bottom-5 z-20 flex flex-col items-center gap-4">
                <button type="button" onclick="handleMobileVideoLike('${post.id}')" id="mobile-video-like-btn-${post.id}" class="flex flex-col items-center gap-1 active:scale-90 transition-transform" aria-label="Like video">
                    <i class="${live.isLiked ? 'fa-solid text-rose-500' : 'fa-regular text-white'} fa-heart text-2xl drop-shadow"></i>
                    <span id="mobile-video-like-count-${post.id}" class="text-[11px] font-bold text-white drop-shadow">${live.likesCount}</span>
                </button>

                <button type="button" onclick="openMobileVideoCommentsSheet('${post.id}')" class="flex flex-col items-center gap-1 active:scale-90 transition-transform" aria-label="Open comments">
                    <i class="fa-regular fa-comment text-white text-2xl drop-shadow"></i>
                    <span id="mobile-video-comment-count-${post.id}" class="text-[11px] font-bold text-white drop-shadow">${live.commentsCount}</span>
                </button>

                <button type="button" onclick="handleRepostClick('${post.id}')" id="mobile-video-repost-btn-${post.id}" class="flex flex-col items-center gap-1 active:scale-90 transition-transform" aria-label="Repost video">
                    <i class="fa-solid fa-retweet text-2xl drop-shadow ${live.isReposted ? 'text-emerald-400' : 'text-white'}"></i>
                    <span id="mobile-video-repost-count-${post.id}" class="text-[11px] font-bold text-white drop-shadow">${live.repostsCount}</span>
                </button>

                <div class="relative">
                    <button type="button" onclick="toggleMobileModalShareMenu(event, '${post.id}')" class="flex flex-col items-center gap-1 active:scale-90 transition-transform" aria-label="Share video">
                        <i class="fa-solid fa-share text-white text-2xl drop-shadow"></i>
                        <span class="text-[11px] font-bold text-white drop-shadow">Share</span>
                    </button>
                    <div id="mobile-modal-share-menu-${post.id}" onclick="event.stopPropagation()" class="mobile-modal-menu hidden absolute right-11 bottom-0 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40">
                        <button type="button" onclick="closeMobileModalMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-accord-lightBlue/60 flex items-center gap-2.5">
                            <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                            <span>Send to Chat</span>
                        </button>
                        <button type="button" onclick="closeMobileModalMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                            <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                            <span>Copy Link / Share</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Bottom-Left Author & Caption Overlay -->
            <div class="absolute left-3.5 right-16 bottom-4 z-20 text-white space-y-1.5">
                <div class="flex items-center gap-2.5">
                    ${authorProfileUrl ? `<a href="${escapeShareHtml(authorProfileUrl)}" class="shrink-0">${avatarInner}</a>` : avatarInner}
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${authorProfileUrl
                                ? `<a href="${escapeShareHtml(authorProfileUrl)}" class="text-[14px] font-bold text-white hover:underline truncate drop-shadow">${escapeShareHtml(displayAuthor)}</a>`
                                : `<span class="text-[14px] font-bold text-white truncate drop-shadow">${escapeShareHtml(displayAuthor)}</span>`}
                            ${isVerifiedAuthor ? '<i class="fa-solid fa-circle-check text-sky-400 text-xs drop-shadow"></i>' : ''}
                            ${authorHandle ? `<span class="text-[11px] text-white/75 truncate">${escapeShareHtml(authorHandle)}</span>` : ''}
                        </div>
                        <p class="text-[11px] text-white/75">${dateFormatted} · Video</p>
                    </div>
                </div>
                ${bodyText ? `
                <div class="text-[13px] text-white/95 leading-snug drop-shadow">
                    <p id="mobile-video-caption-${post.id}" class="line-clamp-2 whitespace-pre-wrap break-words">${escapeShareHtml(bodyText)}</p>
                    ${isLongCaption ? `<button type="button" id="mobile-video-caption-toggle-${post.id}" onclick="toggleMobileVideoCaption('${post.id}')" class="text-xs font-bold text-white/80 hover:text-white mt-0.5">... more</button>` : ''}
                </div>` : ''}
                ${hasMultiple ? `
                <p class="text-[10px] text-white/60 flex items-center gap-1 pt-0.5">
                    <i class="fa-solid fa-arrows-up-down text-[9px]"></i>
                    <span>Swipe up or down for more videos</span>
                </p>` : ''}
            </div>
        `;
    }

    const commentBar = document.getElementById('mobile-video-comment-bar');
    if (commentBar) {
        commentBar.innerHTML = `
            <button type="button" onclick="openMobileVideoCommentsSheet('${post.id}', { focusInput: true })" class="w-full flex items-center justify-between bg-white/15 hover:bg-white/20 active:bg-white/25 text-white/80 rounded-full px-4 py-2.5 text-xs transition-colors">
                <span>Add a comment...</span>
                <i class="fa-regular fa-comment text-sm text-white/75"></i>
            </button>
        `;
    }

    const sheetSlot = document.getElementById('mobile-video-comments-sheet-slot');
    if (sheetSlot) {
        sheetSlot.innerHTML = `
            <div id="mobile-video-comments-backdrop" onclick="closeMobileVideoCommentsSheet()" class="absolute inset-0 z-40 bg-black/45 hidden transition-opacity duration-200"></div>
            <div id="mobile-video-comments-sheet" onclick="event.stopPropagation()" class="absolute inset-x-0 bottom-0 z-50 h-[72%] max-h-[92%] bg-white rounded-t-2xl shadow-2xl flex flex-col transform translate-y-full transition-transform duration-300 ease-out">
                <!-- Drag Handle & Header -->
                <div id="mobile-video-sheet-header" class="shrink-0 pt-2.5 pb-2.5 px-4 border-b border-slate-200/80 touch-none">
                    <div class="w-10 h-1 rounded-full bg-slate-300 mx-auto mb-2.5"></div>
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <h3 class="text-sm font-bold text-slate-900">All comments</h3>
                            <span id="mobile-video-sheet-comment-count-${post.id}" class="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${live.commentsCount}</span>
                        </div>
                        <button type="button" onclick="closeMobileVideoCommentsSheet()" class="w-8 h-8 rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors" aria-label="Close comments">
                            <i class="fa-solid fa-xmark text-base"></i>
                        </button>
                    </div>
                </div>

                <!-- Scrollable Comments List -->
                <div id="mobile-video-comments-scroll" class="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3 bg-white">
                    <div id="mobile-video-comments-list" class="space-y-3">
                        <p class="text-xs text-slate-400 text-center py-6">Loading comments...</p>
                    </div>
                </div>

                <!-- Sticky Comment Input -->
                <div class="shrink-0 bg-white border-t border-slate-200 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                            ${escapeShareHtml(myAvatarInitial)}
                        </div>
                        <form onsubmit="submitMobileVideoComment(event, '${post.id}')" class="flex-1 min-w-0 flex items-center gap-1.5 bg-[#F0F2F5] rounded-full px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-accord-blue/30">
                            <input type="text" id="mobile-video-comment-input" onfocus="setTimeout(syncActiveMobileModalViewport, 120)" placeholder="Write a comment..." class="flex-1 min-w-0 bg-transparent text-[16px] sm:text-xs leading-snug text-slate-800 placeholder-slate-500 focus:outline-none py-1" required>
                            <button type="submit" id="mobile-video-comment-submit" class="text-accord-blue hover:text-accord-darkBlue px-1.5 py-1 text-xs font-bold shrink-0" aria-label="Send comment">
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    const stage = document.getElementById('mobile-video-stage');
    if (stage) {
        if (slideDirection) {
            stage.style.transition = 'none';
            stage.style.transform = slideDirection === 'up' ? 'translateY(36px)' : 'translateY(-36px)';
            stage.style.opacity = '0.7';
            requestAnimationFrame(() => {
                stage.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
                stage.style.transform = 'translateY(0)';
                stage.style.opacity = '1';
            });
        } else {
            stage.style.transform = 'translateY(0)';
            stage.style.opacity = '1';
        }
    }

    const sheetHeader = document.getElementById('mobile-video-sheet-header');
    if (sheetHeader) {
        attachMobileVideoSheetDragHandlers(sheetHeader);
    }

    syncMobileVideoModalPlayer(postId, post, { startTime, unmuted });
}

function toggleMobileVideoCaption(postId) {
    const captionEl = document.getElementById(`mobile-video-caption-${postId}`);
    const toggleBtn = document.getElementById(`mobile-video-caption-toggle-${postId}`);
    if (!captionEl || !toggleBtn) return;
    _mobileVideoCaptionExpanded = !_mobileVideoCaptionExpanded;
    if (_mobileVideoCaptionExpanded) {
        captionEl.classList.remove('line-clamp-2');
        toggleBtn.textContent = 'less';
    } else {
        captionEl.classList.add('line-clamp-2');
        toggleBtn.textContent = '... more';
    }
}

function attachMobileVideoSwipeHandlers(stageEl) {
    let startY = 0;
    let startX = 0;
    let currentDeltaY = 0;
    let tracking = false;

    stageEl.addEventListener('touchstart', (e) => {
        if (_mobileVideoCommentsOpen || e.touches.length !== 1) return;
        if (e.target && e.target.closest('button, a, .mobile-modal-menu')) return;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        currentDeltaY = 0;
        tracking = true;
        stageEl.style.transition = 'none';
    }, { passive: true });

    stageEl.addEventListener('touchmove', (e) => {
        if (!tracking || _mobileVideoCommentsOpen || e.touches.length !== 1) return;
        const dy = e.touches[0].clientY - startY;
        const dx = e.touches[0].clientX - startX;
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
            currentDeltaY = dy;
            stageEl.style.transform = `translateY(${Math.max(-140, Math.min(140, dy * 0.45))}px)`;
        }
    }, { passive: true });

    stageEl.addEventListener('touchend', () => {
        if (!tracking) return;
        tracking = false;
        stageEl.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';

        const threshold = 55;
        if (!_mobileVideoCommentsOpen && Math.abs(currentDeltaY) > threshold) {
            if (currentDeltaY < 0) {
                navigateMobileVideoByOffset(1);
                return;
            } else {
                navigateMobileVideoByOffset(-1);
                return;
            }
        }
        stageEl.style.transform = 'translateY(0)';
    }, { passive: true });
}

function attachMobileVideoSheetDragHandlers(headerEl) {
    let startY = 0;
    let deltaY = 0;
    let dragging = false;
    const sheet = document.getElementById('mobile-video-comments-sheet');
    if (!sheet) return;

    headerEl.addEventListener('touchstart', (e) => {
        if (!_mobileVideoCommentsOpen || e.touches.length !== 1) return;
        startY = e.touches[0].clientY;
        deltaY = 0;
        dragging = true;
        sheet.style.transition = 'none';
    }, { passive: true });

    headerEl.addEventListener('touchmove', (e) => {
        if (!dragging || e.touches.length !== 1) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 0) {
            deltaY = dy;
            sheet.style.transform = `translateY(${dy}px)`;
        }
    }, { passive: true });

    headerEl.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        sheet.style.transition = '';
        if (deltaY > 75) {
            closeMobileVideoCommentsSheet();
        } else {
            sheet.style.transform = '';
        }
    }, { passive: true });
}

function navigateMobileVideoByOffset(offset) {
    if (!_activeMobileVideoId) return;
    const videoList = getMobileVideoList();
    const idx = videoList.indexOf(String(_activeMobileVideoId));
    const stage = document.getElementById('mobile-video-stage');

    if (idx === -1 || videoList.length <= 1) {
        if (stage) stage.style.transform = 'translateY(0)';
        return;
    }

    const nextIdx = idx + offset;
    if (nextIdx < 0 || nextIdx >= videoList.length) {
        if (stage) stage.style.transform = 'translateY(0)';
        if (typeof showToast === 'function' && nextIdx >= videoList.length) {
            showToast('No more videos below.');
        }
        return;
    }

    const nextPostId = videoList[nextIdx];
    _activeMobileVideoId = String(nextPostId);
    _mobileVideoCommentsOpen = false;
    _activeMobileVideoModalOptions = {
        startTime: 0,
        unmuted: Boolean(_activeMobileVideoModalOptions.unmuted)
    };
    renderMobileVideoModalContent(nextPostId, {
        slideDirection: offset > 0 ? 'up' : 'down',
        startTime: 0,
        unmuted: Boolean(_activeMobileVideoModalOptions.unmuted)
    });

    if (typeof markPostAsViewed === 'function') {
        markPostAsViewed(nextPostId);
    }
}

async function openMobileVideoModal(postId, options = {}) {
    const entry = _sharedMobilePostRegistry.get(String(postId));
    if (!entry) return;

    teardownActiveMobileFeedVideo();
    _activeMobileVideoModalOptions = {
        startTime: Number(options.startTime) || 0,
        unmuted: options.unmuted !== undefined ? Boolean(options.unmuted) : Boolean(_mobileFeedVideoUnmutedPref)
    };

    ensureMobileVideoModalDom();
    _activeMobileVideoId = String(postId);
    _mobileVideoCommentsOpen = false;
    renderMobileVideoModalContent(postId, _activeMobileVideoModalOptions);

    const modal = document.getElementById('accord-mobile-video-modal');
    lockMobileModalBodyScroll();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    syncActiveMobileModalViewport();

    if (!_mobileModalHistoryPushed) {
        try {
            window.history.pushState({ accordMobileVideoModal: String(postId) }, '');
            _mobileModalHistoryPushed = true;
        } catch (_) {}
    }

    if (typeof markPostAsViewed === 'function') {
        markPostAsViewed(postId);
    }

    if (options.openComments) {
        setTimeout(() => {
            openMobileVideoCommentsSheet(postId, { focusInput: true });
        }, 60);
    }
}

function closeMobileVideoModal({ fromPopState = false } = {}) {
    const modal = document.getElementById('accord-mobile-video-modal');
    if (!modal || modal.classList.contains('hidden')) {
        _activeMobileVideoId = null;
        _mobileVideoCommentsOpen = false;
        return;
    }

    const directPlayer = document.getElementById('mobile-video-direct-player');
    if (directPlayer) {
        try {
            directPlayer.pause();
            directPlayer.removeAttribute('src');
            directPlayer.load();
        } catch (_) {}
    }
    const ytPlayer = document.getElementById('mobile-video-yt-player');
    if (ytPlayer) {
        sendYouTubePlayerCommand(ytPlayer, 'pauseVideo');
        ytPlayer.dataset.ytReady = '0';
        ytPlayer.dataset.ytPostId = '';
        try { ytPlayer.src = 'about:blank'; } catch (_) {}
    }

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.innerHTML = '';
    resetMobileModalViewportGeometry(modal);
    _activeMobileVideoId = null;
    _mobileVideoCommentsOpen = false;
    _activeMobileVideoModalOptions = { startTime: 0, unmuted: false };
    unlockMobileModalBodyScroll();

    setTimeout(() => {
        setupMobileFeedVideoObserver();
    }, 80);

    if (!fromPopState && _mobileModalHistoryPushed) {
        _mobileModalHistoryPushed = false;
        if (window.history.state && window.history.state.accordMobileVideoModal) {
            try {
                window.history.back();
            } catch (_) {}
        }
    } else {
        _mobileModalHistoryPushed = false;
    }
}

async function openMobileVideoCommentsSheet(postId, { focusInput = false } = {}) {
    const sheet = document.getElementById('mobile-video-comments-sheet');
    const backdrop = document.getElementById('mobile-video-comments-backdrop');
    if (!sheet || !backdrop) return;

    _mobileVideoCommentsOpen = true;
    backdrop.classList.remove('hidden');
    sheet.style.transform = '';
    syncActiveMobileModalViewport();
    requestAnimationFrame(() => {
        sheet.classList.remove('translate-y-full');
    });

    await loadMobileVideoComments(postId);

    if (focusInput) {
        setTimeout(() => {
            document.getElementById('mobile-video-comment-input')?.focus();
        }, 180);
    }
}

function closeMobileVideoCommentsSheet() {
    const sheet = document.getElementById('mobile-video-comments-sheet');
    const backdrop = document.getElementById('mobile-video-comments-backdrop');
    if (!sheet || !backdrop) return;

    _mobileVideoCommentsOpen = false;
    sheet.style.transform = '';
    sheet.style.height = '';
    sheet.classList.add('translate-y-full');
    backdrop.classList.add('hidden');
}

async function handleMobileVideoLike(postId) {
    if (typeof togglePostLike === 'function') {
        await togglePostLike(postId);
    }
    syncMobileModalFromRegistry(postId);
}

async function loadMobileVideoComments(postId, { scrollToBottom = false } = {}) {
    const listEl = document.getElementById('mobile-video-comments-list');
    if (!listEl) return;

    const { data, error } = await fetchPostCommentsShared(postId);

    if (error) {
        listEl.innerHTML = `<p class="text-xs text-red-500 text-center py-4">Could not load comments.</p>`;
        return;
    }

    const comments = data || [];
    listEl.innerHTML = renderSharedCommentsHtml(comments);

    const countEl = document.getElementById(`mobile-video-comment-count-${postId}`);
    if (countEl) countEl.textContent = comments.length;
    const sheetCountEl = document.getElementById(`mobile-video-sheet-comment-count-${postId}`);
    if (sheetCountEl) sheetCountEl.textContent = comments.length;
    const cardCountEl = document.getElementById(`comment-count-${postId}`);
    if (cardCountEl) cardCountEl.textContent = comments.length;

    if (scrollToBottom) {
        const scrollArea = document.getElementById('mobile-video-comments-scroll');
        if (scrollArea) {
            scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
        }
    }
}

async function submitMobileVideoComment(e, postId) {
    e.preventDefault();
    const input = document.getElementById('mobile-video-comment-input');
    const submitBtn = document.getElementById('mobile-video-comment-submit');
    const ok = await submitSharedCommentPayload(postId, input, submitBtn);
    if (ok) {
        await loadMobileVideoComments(postId, { scrollToBottom: true });
    }
}

window.addEventListener('popstate', () => {
    if (_activeMobileVideoId && !(window.history.state && window.history.state.accordMobileVideoModal)) {
        closeMobileVideoModal({ fromPopState: true });
    }
    if (_activeMobilePostId && !(window.history.state && window.history.state.accordMobilePostModal)) {
        closeMobileTextPostModal({ fromPopState: true });
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
        teardownActiveMobileFeedVideo();
        if (_activeMobileVideoId) closeMobileVideoModal();
        if (_activeMobilePostId) closeMobileTextPostModal();
    } else {
        setupMobileFeedVideoObserver();
    }
});
