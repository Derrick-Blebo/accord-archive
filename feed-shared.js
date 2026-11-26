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
                title: post.title,
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
                <input type="text" id="share-chat-search" oninput="renderShareToChatTargets()" placeholder="Search conversations or people..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-accord-blue">
                <input type="text" id="share-chat-note" placeholder="Add an optional message..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue">
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
            return { label: 'Audio', badgeClass: 'bg-amber-50 text-accord-gold border border-amber-200', icon: 'fa-podcast', textColor: 'text-accord-gold' };
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

function getSharedYouTubeEmbedUrl(url) {
    if (!url) return '';
    let videoId = '';
    if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1]?.split('?')[0];
    else if (url.includes('watch?v=')) videoId = url.split('watch?v=')[1]?.split('&')[0];
    else if (url.includes('embed/')) videoId = url.split('embed/')[1]?.split('?')[0];
    else if (url.includes('/shorts/')) videoId = url.split('/shorts/')[1]?.split('?')[0];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
}

function extractSharedBookId(text) {
    if (!text) return null;
    const m = String(text).match(/(?:book\.html\?(?:[^#\s]*&)?(?:id|book)=|[?&]book=)(\d+)/i);
    return m ? m[1] : null;
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

function createSharedFeedCardElement(post, options = {}) {
    const {
        repost = null,
        isLiked = false,
        isReposted = false,
        commentsCount = 0,
        myAvatarInitial = 'U',
        authorHandle = '',
        reposterHandle = '',
        expandFullBody = false,
        openCommentsByDefault = false,
        showOpenFullPostLink = true
    } = options;

    const card = document.createElement('article');
    card.className = 'bg-white border border-slate-200/80 rounded-xl sm:rounded-2xl shadow-sm overflow-visible';
    card.setAttribute('data-post-id', String(post.id));

    const postUrl = getPostShareUrl(post.id);
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

    const avatarInner = `
        <div class="relative w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-sm shrink-0">
            <span>${escapeShareHtml(displayAuthor.charAt(0).toUpperCase())}</span>
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

    if (post.post_type === 'video' && post.media_url) {
        const embedUrl = getSharedYouTubeEmbedUrl(post.media_url);
        mediaHtml = `
            <div class="relative w-full aspect-video bg-black">
                <iframe src="${escapeShareHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>
            </div>
        `;
    } else if (post.post_type === 'audio' && post.media_url) {
        const isDirectAudio = /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(post.media_url);
        mediaHtml = isDirectAudio
            ? `<div class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                   <audio controls src="${escapeShareHtml(post.media_url)}" class="w-full"></audio>
               </div>`
            : `<div class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center space-x-3.5">
                   <div class="w-11 h-11 bg-accord-goldLight rounded-xl flex items-center justify-center text-accord-gold shrink-0">
                       <i class="fa-solid fa-podcast text-lg"></i>
                   </div>
                   <div class="flex-grow min-w-0">
                       <p class="text-xs font-bold text-accord-slate truncate">Audio Stream</p>
                       <a href="${escapeShareHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-accord-blue font-semibold hover:underline truncate block">Listen on external platform →</a>
                   </div>
               </div>`;
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
                        <span>·</span>
                        <span class="inline-flex items-center gap-1 font-semibold ${typeMeta.textColor}">
                            <i class="fa-solid ${typeMeta.icon} text-[10px]"></i>
                            <span>${typeMeta.label}</span>
                        </span>
                    </div>
                </div>
            </div>

            <!-- 3-Dots More Menu -->
            <div class="relative shrink-0">
                <button type="button" onclick="toggleFeedPostMenu(event, '${post.id}')" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors" aria-label="Post options">
                    <i class="fa-solid fa-ellipsis text-sm"></i>
                </button>
                <div id="feed-post-menu-${post.id}" onclick="event.stopPropagation()" class="feed-post-menu hidden absolute right-0 top-9 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                    ${showOpenFullPostLink ? `
                    <a href="${escapeShareHtml(postUrl)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-arrow-up-right-from-square w-3.5 text-center text-slate-400"></i>
                        <span>Open Full Post</span>
                    </a>` : ''}
                    <button type="button" onclick="closeAllFeedPostMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                        <span>Send to Chat</span>
                    </button>
                    <button type="button" onclick="closeAllFeedPostMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                        <span>Copy Link / Share</span>
                    </button>
                    <button type="button" onclick="closeAllFeedPostMenus(); openReportModal('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                        <i class="fa-regular fa-flag w-3.5 text-center"></i>
                        <span>Flag Post</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Post Content -->
        <div class="px-4 pb-3 space-y-1.5">
            ${post.title ? (showOpenFullPostLink
                ? `<a href="${escapeShareHtml(postUrl)}" class="block text-[15px] font-bold text-slate-900 hover:text-accord-blue leading-snug">${escapeShareHtml(post.title)}</a>`
                : `<h1 class="text-lg sm:text-xl font-bold text-slate-900 leading-snug">${escapeShareHtml(post.title)}</h1>`) : ''}
            <p id="post-body-${post.id}" class="text-[14px] text-slate-800 leading-relaxed whitespace-pre-wrap">${escapeShareHtml(shownBody)}</p>
            ${isLongBody ? `<button type="button" id="post-see-more-${post.id}" onclick="toggleExpandPostBody('${post.id}')" class="text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline">See more</button>` : ''}
        </div>

        ${mediaHtml}
        ${linkedBookId ? `<div class="feed-book-link-preview mx-4 mb-3" data-book-id="${escapeShareHtml(linkedBookId)}"></div>` : ''}

        <!-- Engagement Summary Row (Facebook Style) -->
        <div class="px-4 py-2 flex items-center justify-between text-xs text-slate-500">
            <div class="flex items-center gap-1.5">
                <span class="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[9px]">
                    <i class="fa-solid fa-heart"></i>
                </span>
                <span id="like-count-${post.id}">${likesCount}</span>
            </div>
            <div class="flex items-center gap-3">
                <button type="button" onclick="toggleInlineComments('${post.id}')" class="hover:underline">
                    <span id="comment-count-${post.id}">${commentsCount}</span> ${commentsCount === 1 ? 'comment' : 'comments'}
                </button>
                <span id="repost-count-label-${post.id}">${repostsCount} ${repostsCount === 1 ? 'repost' : 'reposts'}</span>
            </div>
        </div>

        <!-- Facebook-Style Action Bar -->
        <div class="mx-4 border-t border-slate-200/80 py-1 grid grid-cols-4 gap-1">
            <button type="button" onclick="togglePostLike('${post.id}')" id="like-btn-${post.id}" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors ${isLiked ? 'text-rose-600' : 'text-slate-600'}">
                <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart text-sm"></i>
                <span>Like</span>
            </button>

            <button type="button" onclick="toggleInlineComments('${post.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                <i class="fa-regular fa-comment text-sm"></i>
                <span>Comment</span>
            </button>

            <button type="button" onclick="handleRepostClick('${post.id}')" id="repost-btn-${post.id}" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors ${isReposted ? 'text-emerald-600' : 'text-slate-600'}">
                <i class="fa-solid fa-retweet text-sm"></i>
                <span>Repost</span>
            </button>

            <button type="button" onclick="handleShareClick('${post.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                <i class="fa-solid fa-share text-sm"></i>
                <span>Share</span>
            </button>
        </div>

        <!-- Facebook-Style Inline Comment Section -->
        <div id="inline-comments-${post.id}" class="${openCommentsByDefault ? '' : 'hidden'} border-t border-slate-200/80 px-4 py-3 space-y-3 bg-white rounded-b-xl sm:rounded-b-2xl">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                    ${escapeShareHtml(myAvatarInitial)}
                </div>
                <form onsubmit="submitInlineComment(event, '${post.id}')" class="flex-1 flex items-center gap-1.5 bg-[#F0F2F5] rounded-full px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-accord-blue/30">
                    <input type="text" id="inline-comment-input-${post.id}" placeholder="Write a comment..." class="flex-1 bg-transparent text-xs sm:text-[13px] text-slate-800 placeholder-slate-500 focus:outline-none py-1" required>
                    <button type="submit" class="text-accord-blue hover:text-accord-darkBlue px-1.5 py-1 text-xs font-bold shrink-0" aria-label="Send comment">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </form>
            </div>
            <div id="inline-comments-list-${post.id}" class="space-y-2.5">
                <p class="text-xs text-slate-400 text-center py-2">Loading comments...</p>
            </div>
            ${showOpenFullPostLink ? `
            <div class="pt-1">
                <a href="${escapeShareHtml(postUrl)}#comments-section" class="text-xs font-semibold text-slate-500 hover:underline">Open full post &amp; all comments →</a>
            </div>` : ''}
        </div>
    `;

    return card;
}
