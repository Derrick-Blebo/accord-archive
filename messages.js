// =========================================================
// ACCORD MESSAGES.JS — Real-time 1-on-1 DMs, Group Chats & Content Sharing
// =========================================================

let chatUser = null;
let conversations = [];
let activeConvId = null;
let activeMessages = [];
let allDirectoryUsers = [];
let selectedGroupMemberIds = new Set();
let chatRealtimeChannel = null;

let attachTab = 'books';
let attachBooksCache = [];
let attachPostsCache = [];
let replyToMessage = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof supabaseClient === 'undefined') return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
        const nextUrl = 'messages.html' + window.location.search;
        window.location.href = `signin.html?next=${encodeURIComponent(nextUrl)}`;
        return;
    }

    chatUser = session.user;
    await loadDirectoryUsers();
    await loadConversations();

    const params = new URLSearchParams(window.location.search);
    const dmUserId = params.get('dm');
    const convParam = params.get('c');

    if (dmUserId && dmUserId !== chatUser.id) {
        const { data: convId, error } = await supabaseClient.rpc('get_or_create_dm', { target_user_id: dmUserId });
        if (!error && convId) {
            await loadConversations();
            await openConversation(convId);
        }
    } else if (convParam) {
        await openConversation(convParam);
    }

    subscribeToChatRealtime();
});

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

async function loadDirectoryUsers() {
    const { data } = await supabaseClient
        .from('profiles')
        .select('id, full_name, account_type, upgrade_status')
        .neq('id', chatUser.id)
        .order('full_name', { ascending: true })
        .limit(100);
    allDirectoryUsers = data || [];
}

async function loadConversations() {
    const { data: memberships, error } = await supabaseClient
        .from('conversation_members')
        .select('conversation_id, last_read_at, conversations(id, is_group, title, last_message_at, created_at)')
        .eq('user_id', chatUser.id);

    if (error) {
        document.getElementById('conversations-list').innerHTML = `<p class="p-6 text-center text-xs text-red-600">${escapeChatHtml(error.message)}</p>`;
        return;
    }

    const validRows = (memberships || []).filter(m => m.conversations);
    const convIds = validRows.map(m => m.conversation_id);

    let membersByConv = {};
    if (convIds.length > 0) {
        const { data: allMembers } = await supabaseClient
            .from('conversation_members')
            .select('conversation_id, user_id, profiles(id, full_name, account_type, upgrade_status)')
            .in('conversation_id', convIds);

        (allMembers || []).forEach(m => {
            if (!membersByConv[m.conversation_id]) membersByConv[m.conversation_id] = [];
            membersByConv[m.conversation_id].push(m);
        });
    }

    conversations = validRows
        .map(m => {
            const c = m.conversations;
            const members = membersByConv[c.id] || [];
            const others = members.filter(x => x.user_id !== chatUser.id).map(x => x.profiles).filter(Boolean);
            const partner = !c.is_group ? others[0] || null : null;
            const displayName = c.is_group
                ? (c.title || 'Group Chat')
                : (partner?.full_name || 'Direct Message');
            const isUnread = c.last_message_at && (!m.last_read_at || new Date(c.last_message_at) > new Date(m.last_read_at));
            return {
                id: c.id,
                is_group: c.is_group,
                title: displayName,
                partner,
                members,
                last_message_at: c.last_message_at,
                isUnread
            };
        })
        .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

    renderConversationsList();
    if (typeof window.refreshGlobalChatBadge === 'function') {
        window.refreshGlobalChatBadge();
    }
}

function renderConversationsList() {
    const listEl = document.getElementById('conversations-list');
    if (!listEl) return;

    const q = (document.getElementById('conv-search')?.value || '').trim().toLowerCase();
    const filtered = conversations.filter(c => c.title.toLowerCase().includes(q));

    if (filtered.length === 0) {
        listEl.innerHTML = `<p class="p-6 text-center text-xs text-accord-muted">No conversations yet. Start a DM or group chat above.</p>`;
        return;
    }

    listEl.innerHTML = filtered.map(c => {
        const isActive = c.id === activeConvId;
        const verified = c.partner && isVerifiedMinistryProfile(c.partner);
        const timeStr = c.last_message_at ? formatChatTime(c.last_message_at) : '';
        return `
            <button type="button" onclick="openConversation('${c.id}')" class="w-full px-4 py-3.5 flex items-center space-x-3 text-left transition-colors ${isActive ? 'bg-accord-lightBlue/60' : 'hover:bg-slate-100/70'}">
                <div class="w-10 h-10 rounded-full ${c.is_group ? 'bg-amber-50 text-accord-gold' : 'bg-accord-lightBlue text-accord-blue'} font-bold text-xs flex items-center justify-center shrink-0">
                    ${c.is_group ? '<i class="fa-solid fa-users"></i>' : escapeChatHtml(c.title.charAt(0).toUpperCase())}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                        <p class="text-xs font-bold text-accord-slate truncate flex items-center gap-1">
                            <span>${escapeChatHtml(c.title)}</span>
                            ${verified ? '<i class="fa-solid fa-circle-check text-accord-blue text-[10px]"></i>' : ''}
                        </p>
                        <span class="text-[10px] text-slate-400 shrink-0">${timeStr}</span>
                    </div>
                    <p class="text-[11px] text-accord-muted truncate mt-0.5">${c.is_group ? `${c.members.length} members` : 'Direct Message'}</p>
                </div>
                ${c.isUnread ? '<span class="w-2.5 h-2.5 rounded-full bg-accord-blue shrink-0"></span>' : ''}
            </button>
        `;
    }).join('');
}

async function openConversation(convId) {
    activeConvId = convId;
    window.activeAccordConvId = convId;
    cancelReplyMessage();
    const conv = conversations.find(c => c.id === convId);

    // Responsive mobile switch
    document.getElementById('chat-sidebar')?.classList.add('hidden', 'md:flex');
    const threadPane = document.getElementById('chat-thread-pane');
    threadPane?.classList.remove('hidden');
    threadPane?.classList.add('flex');

    document.getElementById('chat-empty-state')?.classList.add('hidden');
    document.getElementById('chat-active-container')?.classList.remove('hidden');
    document.getElementById('chat-active-container')?.classList.add('flex');

    const titleEl = document.getElementById('active-chat-title');
    const subEl = document.getElementById('active-chat-subtitle');
    const avatarEl = document.getElementById('active-chat-avatar');

    if (conv) {
        if (titleEl) {
            titleEl.textContent = conv.title;
            titleEl.href = conv.partner ? `user.html?id=${encodeURIComponent(conv.partner.id)}` : '#';
        }
        if (subEl) {
            subEl.textContent = conv.is_group
                ? `${conv.members.length} members in group`
                : 'View public profile';
        }
        if (avatarEl) {
            avatarEl.innerHTML = conv.is_group
                ? '<i class="fa-solid fa-users"></i>'
                : escapeChatHtml(conv.title.charAt(0).toUpperCase());
        }
        conv.isUnread = false;
    }

    renderConversationsList();
    await loadMessagesForActiveConv();
    await markConversationRead(convId);
}

function closeMobileThread() {
    window.activeAccordConvId = null;
    document.getElementById('chat-sidebar')?.classList.remove('hidden');
    const threadPane = document.getElementById('chat-thread-pane');
    threadPane?.classList.add('hidden');
    threadPane?.classList.remove('flex');
}

async function markConversationRead(convId) {
    await supabaseClient
        .from('conversation_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', convId)
        .eq('user_id', chatUser.id);

    if (typeof window.markMessageNotificationsRead === 'function') {
        await window.markMessageNotificationsRead(convId);
    }

    if (typeof window.refreshGlobalChatBadge === 'function') {
        window.refreshGlobalChatBadge();
    }
}

async function loadMessagesForActiveConv() {
    if (!activeConvId) return;
    const { data, error } = await supabaseClient
        .from('chat_messages')
        .select('id, conversation_id, sender_id, message_type, body, attachment_meta, created_at, profiles(id, full_name)')
        .eq('conversation_id', activeConvId)
        .order('created_at', { ascending: true })
        .limit(200);

    if (error) {
        showToast(error.message, true);
        return;
    }

    activeMessages = data || [];
    renderMessagesStream();
}

function renderMessagesStream() {
    const stream = document.getElementById('messages-stream');
    if (!stream) return;

    if (activeMessages.length === 0) {
        stream.innerHTML = `<p class="py-12 text-center text-xs text-accord-muted">No messages yet. Say hello or share a book or post!</p>`;
        return;
    }

    const conv = conversations.find(c => c.id === activeConvId);
    stream.innerHTML = activeMessages.map(msg => {
        const isMine = msg.sender_id === chatUser.id;
        const senderName = msg.profiles?.full_name || 'Member';
        const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let cardHtml = '';
        if (msg.message_type !== 'text' && msg.attachment_meta) {
            const meta = msg.attachment_meta;
            const isVideoPost = meta.post_type === 'video';
            const badgeLabel = msg.message_type === 'shared_book'
                ? 'Shared Book'
                : msg.message_type === 'shared_testimony'
                    ? 'Shared Testimony'
                    : msg.message_type === 'shared_profile'
                        ? 'Shared Profile'
                        : isVideoPost
                            ? 'Shared Video'
                            : 'Shared Post';
            const resolvedThumb = meta.image_url || (isVideoPost ? getChatVideoThumbnailUrl(meta.media_url) : '');
            let mediaThumbHtml = '';
            if (isVideoPost) {
                if (resolvedThumb) {
                    mediaThumbHtml = `
                        <div class="relative w-16 h-12 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                            <img src="${escapeChatHtml(resolvedThumb)}" class="w-full h-full object-cover" alt="">
                            <span class="absolute inset-0 flex items-center justify-center bg-black/30">
                                <span class="w-6 h-6 rounded-full bg-white/90 text-accord-slate flex items-center justify-center text-[9px] shadow"><i class="fa-solid fa-play ml-0.5"></i></span>
                            </span>
                        </div>
                    `;
                } else if (meta.media_url && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(meta.media_url)) {
                    mediaThumbHtml = `
                        <div class="relative w-16 h-12 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                            <video src="${escapeChatHtml(meta.media_url)}#t=0.5" muted playsinline preload="metadata" class="w-full h-full object-cover"></video>
                            <span class="absolute inset-0 flex items-center justify-center bg-black/30">
                                <span class="w-6 h-6 rounded-full bg-white/90 text-accord-slate flex items-center justify-center text-[9px] shadow"><i class="fa-solid fa-play ml-0.5"></i></span>
                            </span>
                        </div>
                    `;
                } else {
                    mediaThumbHtml = `
                        <div class="w-16 h-12 rounded-lg bg-slate-900/90 text-white flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-play text-xs"></i>
                        </div>
                    `;
                }
            } else if (resolvedThumb) {
                mediaThumbHtml = `<img src="${escapeChatHtml(resolvedThumb)}" class="w-10 h-14 object-cover rounded-lg shrink-0" alt="">`;
            }
            cardHtml = `
                <a href="${escapeChatHtml(safeChatUrl(meta.url))}" class="block rounded-2xl p-3 border transition-colors ${isMine ? 'bg-white/15 border-white/25 text-white hover:bg-white/20' : 'bg-slate-50 border-slate-200 text-accord-slate hover:bg-slate-100'}">
                    <span class="text-[10px] font-extrabold uppercase tracking-wider opacity-80">${badgeLabel}</span>
                    <div class="flex items-start gap-2.5 mt-1">
                        ${mediaThumbHtml}
                        <div class="min-w-0 flex-1">
                            <p class="text-xs font-bold leading-snug line-clamp-2">${escapeChatHtml(meta.title || 'Shared Item')}</p>
                            ${meta.author_name ? `<p class="text-[10px] opacity-80 mt-0.5">${escapeChatHtml(meta.author_name)}</p>` : ''}
                            ${meta.subtitle ? `<p class="text-[11px] opacity-85 line-clamp-2 mt-1">${escapeChatHtml(meta.subtitle)}</p>` : ''}
                        </div>
                    </div>
                    <p class="text-[11px] font-bold mt-2 underline">Open →</p>
                </a>
            `;
        }

        let replyQuoteHtml = '';
        const replyMeta = msg.attachment_meta?.reply_to;
        if (replyMeta) {
            const quotedId = escapeChatHtml(replyMeta.id || '');
            replyQuoteHtml = `
                <button type="button" onclick="scrollToMessage('${quotedId}')" class="w-full text-left rounded-xl px-2.5 py-1.5 border-l-4 transition-colors ${isMine ? 'bg-white/15 border-white/70 text-white hover:bg-white/25' : 'bg-slate-100 border-accord-blue text-accord-slate hover:bg-slate-200/70'}">
                    <p class="text-[10px] font-bold opacity-90 truncate">${escapeChatHtml(replyMeta.sender_name || 'Member')}</p>
                    <p class="text-[11px] opacity-80 truncate">${escapeChatHtml(replyMeta.preview || '')}</p>
                </button>
            `;
        }

        const replyBtnHtml = `
            <button type="button" onclick="setReplyToMessage('${msg.id}')" class="w-7 h-7 rounded-full text-slate-400 hover:text-accord-blue hover:bg-slate-200/70 flex items-center justify-center opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" title="Reply to message" aria-label="Reply to message">
                <i class="fa-solid fa-reply text-[11px]"></i>
            </button>
        `;

        const linkedBookId = (!cardHtml && msg.body)
            ? (String(msg.body).match(/(?:book\.html\?(?:[^#\s]*&)?(?:id|book)=|[?&]book=)(\d+)/i)?.[1] || null)
            : null;

        return `
            <div data-msg-id="${msg.id}" class="group flex flex-col ${isMine ? 'items-end' : 'items-start'} transition-all duration-300 rounded-2xl">
                ${!isMine && conv?.is_group ? `<span class="text-[10px] font-bold text-accord-muted ml-2 mb-0.5">${escapeChatHtml(senderName)}</span>` : ''}
                <div class="flex items-center gap-1.5 max-w-full ${isMine ? 'flex-row-reverse' : 'flex-row'}">
                    <div class="max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 space-y-2 shadow-sm ${isMine ? 'bg-accord-blue text-white rounded-br-sm' : 'bg-white text-accord-slate border border-slate-200 rounded-bl-sm'}">
                        ${replyQuoteHtml}
                        ${cardHtml}
                        ${linkedBookId ? `<div class="chat-book-link-preview" data-book-id="${linkedBookId}" data-mine="${isMine ? '1' : '0'}"></div>` : ''}
                        ${msg.body ? `<p class="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed break-words">${escapeChatHtml(msg.body)}</p>` : ''}
                    </div>
                    ${replyBtnHtml}
                </div>
                <span class="text-[10px] text-slate-400 mt-1 px-1">${timeStr}</span>
            </div>
        `;
    }).join('');

    stream.scrollTop = stream.scrollHeight;
    hydrateChatBookLinkPreviews();
}

const _chatBookPreviewCache = new Map();
async function hydrateChatBookLinkPreviews() {
    const slots = Array.from(document.querySelectorAll('.chat-book-link-preview[data-book-id]'));
    if (slots.length === 0) return;
    const missing = [...new Set(slots.map(s => s.getAttribute('data-book-id')).filter(id => id && !_chatBookPreviewCache.has(id)))];
    if (missing.length > 0) {
        const { data } = await supabaseClient
            .from('books')
            .select('id, title, author, cover_url')
            .in('id', missing)
            .eq('is_visible', true);
        (data || []).forEach(b => _chatBookPreviewCache.set(String(b.id), b));
    }
    slots.forEach(slot => {
        const book = _chatBookPreviewCache.get(slot.getAttribute('data-book-id'));
        if (!book) return;
        const isMine = slot.getAttribute('data-mine') === '1';
        slot.innerHTML = `
            <a href="book.html?id=${encodeURIComponent(book.id)}" class="flex items-center gap-2.5 p-2.5 rounded-xl border ${isMine ? 'bg-white/15 border-white/25 text-white' : 'bg-slate-50 border-slate-200 text-accord-slate'}">
                ${book.cover_url ? `<img src="${escapeChatHtml(book.cover_url)}" class="w-10 h-14 object-cover rounded-lg shrink-0" alt="">` : ''}
                <div class="min-w-0">
                    <p class="text-[10px] font-bold uppercase opacity-80">Book Preview</p>
                    <p class="text-xs font-bold leading-snug line-clamp-2">${escapeChatHtml(book.title)}</p>
                    <p class="text-[10px] opacity-80">${escapeChatHtml(book.author || '')}</p>
                </div>
            </a>
        `;
    });
}

function getMessagePreviewText(msg) {
    if (!msg) return '';
    if (msg.body && msg.body.trim()) return msg.body.trim();
    if (msg.attachment_meta?.title) return msg.attachment_meta.title;
    return 'Attachment';
}

function setReplyToMessage(msgId) {
    const msg = activeMessages.find(m => String(m.id) === String(msgId));
    if (!msg) return;
    const senderName = msg.sender_id === chatUser.id ? 'You' : (msg.profiles?.full_name || 'Member');
    const preview = getMessagePreviewText(msg).slice(0, 120);

    replyToMessage = {
        id: msg.id,
        sender_name: senderName,
        preview
    };

    const bar = document.getElementById('chat-reply-preview');
    const authorEl = document.getElementById('chat-reply-author');
    const textEl = document.getElementById('chat-reply-text');
    if (authorEl) authorEl.textContent = `Replying to ${senderName}`;
    if (textEl) textEl.textContent = preview;
    bar?.classList.remove('hidden');
    document.getElementById('chat-message-input')?.focus();
}

function cancelReplyMessage() {
    replyToMessage = null;
    document.getElementById('chat-reply-preview')?.classList.add('hidden');
}

function scrollToMessage(msgId) {
    if (!msgId) return;
    const target = document.querySelector(`[data-msg-id="${CSS.escape(String(msgId))}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('ring-2', 'ring-accord-blue/50', 'bg-accord-lightBlue/40');
    setTimeout(() => {
        target.classList.remove('ring-2', 'ring-accord-blue/50', 'bg-accord-lightBlue/40');
    }, 1500);
}

async function handleSendMessage(e) {
    e.preventDefault();
    if (!activeConvId || !chatUser) return;
    const input = document.getElementById('chat-message-input');
    const body = input?.value.trim() || '';
    if (!body) return;

    const pendingReply = replyToMessage ? { ...replyToMessage } : null;
    input.value = '';
    cancelReplyMessage();

    const payload = {
        conversation_id: activeConvId,
        sender_id: chatUser.id,
        message_type: 'text',
        body
    };
    if (pendingReply) {
        payload.attachment_meta = { reply_to: pendingReply };
    }

    const { error } = await supabaseClient.from('chat_messages').insert([payload]);

    if (error) {
        showToast(`Could not send message: ${error.message}`, true);
        input.value = body;
        if (pendingReply) {
            replyToMessage = pendingReply;
            document.getElementById('chat-reply-preview')?.classList.remove('hidden');
        }
    }
}

function subscribeToChatRealtime() {
    if (chatRealtimeChannel || typeof supabaseClient.channel !== 'function') return;
    chatRealtimeChannel = supabaseClient
        .channel(`accord_chat_page_${chatUser.id}`)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            async (payload) => {
                const msg = payload?.new;
                if (!msg) return;

                if (msg.conversation_id === activeConvId) {
                    const { data: fullMsg } = await supabaseClient
                        .from('chat_messages')
                        .select('id, conversation_id, sender_id, message_type, body, attachment_meta, created_at, profiles(id, full_name)')
                        .eq('id', msg.id)
                        .maybeSingle();

                    if (fullMsg && !activeMessages.some(m => m.id === fullMsg.id)) {
                        activeMessages.push(fullMsg);
                        renderMessagesStream();
                    }
                    if (msg.sender_id !== chatUser.id) {
                        await markConversationRead(activeConvId);
                    }
                }
                await loadConversations();
            }
        )
        .subscribe();
}

// ==========================================
// NEW DM & NEW GROUP MODALS
// ==========================================

function openNewDmModal() {
    document.getElementById('new-dm-search').value = '';
    renderNewDmUsers();
    const modal = document.getElementById('new-dm-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeNewDmModal() {
    const modal = document.getElementById('new-dm-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function renderNewDmUsers() {
    const listEl = document.getElementById('new-dm-users-list');
    if (!listEl) return;
    const q = (document.getElementById('new-dm-search')?.value || '').trim().toLowerCase();
    const filtered = allDirectoryUsers.filter(u => (u.full_name || '').toLowerCase().includes(q));

    if (filtered.length === 0) {
        listEl.innerHTML = `<p class="py-6 text-center text-xs text-accord-muted">No users found.</p>`;
        return;
    }

    listEl.innerHTML = filtered.map(u => {
        const name = u.full_name || 'Accord Member';
        const verified = isVerifiedMinistryProfile(u);
        return `
            <button type="button" onclick="startDmFromModal('${u.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left">
                <div class="flex items-center space-x-3 min-w-0">
                    <div class="w-9 h-9 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                        ${escapeChatHtml(name.charAt(0).toUpperCase())}
                    </div>
                    <p class="text-xs font-bold text-accord-slate truncate flex items-center gap-1.5">
                        <span>${escapeChatHtml(name)}</span>
                        ${verified ? '<i class="fa-solid fa-circle-check text-accord-blue text-[10px]"></i>' : ''}
                    </p>
                </div>
                <span class="text-[11px] font-bold text-accord-blue">Message</span>
            </button>
        `;
    }).join('');
}

async function startDmFromModal(targetUserId) {
    closeNewDmModal();
    const { data: convId, error } = await supabaseClient.rpc('get_or_create_dm', { target_user_id: targetUserId });
    if (error || !convId) {
        showToast(error?.message || 'Could not start conversation.', true);
        return;
    }
    await loadConversations();
    await openConversation(convId);
}

function openNewGroupModal() {
    selectedGroupMemberIds.clear();
    document.getElementById('new-group-title').value = '';
    document.getElementById('new-group-search').value = '';
    renderNewGroupMembers();
    const modal = document.getElementById('new-group-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeNewGroupModal() {
    const modal = document.getElementById('new-group-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function renderNewGroupMembers() {
    const listEl = document.getElementById('new-group-members-list');
    if (!listEl) return;
    const q = (document.getElementById('new-group-search')?.value || '').trim().toLowerCase();
    const filtered = allDirectoryUsers.filter(u => (u.full_name || '').toLowerCase().includes(q));

    listEl.innerHTML = filtered.map(u => {
        const checked = selectedGroupMemberIds.has(u.id) ? 'checked' : '';
        const name = u.full_name || 'Accord Member';
        return `
            <label class="flex items-center space-x-3 px-2.5 py-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" ${checked} onchange="toggleGroupMemberSelection('${u.id}')" class="rounded text-accord-blue">
                <span class="text-xs font-semibold text-accord-slate truncate">${escapeChatHtml(name)}</span>
            </label>
        `;
    }).join('');
}

function toggleGroupMemberSelection(userId) {
    if (selectedGroupMemberIds.has(userId)) selectedGroupMemberIds.delete(userId);
    else selectedGroupMemberIds.add(userId);
}

async function handleCreateGroupSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('new-group-title').value.trim();
    const memberIds = Array.from(selectedGroupMemberIds);
    if (memberIds.length === 0) {
        showToast('Select at least one member for the group.', true);
        return;
    }

    const { data: convId, error } = await supabaseClient.rpc('create_group_chat', {
        group_title: title,
        member_ids: memberIds
    });

    if (error || !convId) {
        showToast(error?.message || 'Could not create group.', true);
        return;
    }

    closeNewGroupModal();
    await loadConversations();
    await openConversation(convId);
}

// ==========================================
// QUICK-ATTACH BOOK / POST PICKER
// ==========================================

async function openAttachModal() {
    if (!activeConvId) return;
    const modal = document.getElementById('attach-item-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');

    if (attachBooksCache.length === 0) {
        const { data } = await supabaseClient
            .from('books')
            .select('id, title, author, cover_url')
            .order('created_at', { ascending: false })
            .limit(60);
        attachBooksCache = (data || []).filter(b => !String(b.title || '').startsWith('__ACCORD_'));
    }
    if (attachPostsCache.length === 0) {
        const { data } = await supabaseClient
            .from('feed_posts')
            .select('id, title, body, author_name, post_type, media_url')
            .eq('is_approved', true)
            .order('created_at', { ascending: false })
            .limit(60);
        attachPostsCache = data || [];
    }

    renderAttachItems();
}

function closeAttachModal() {
    const modal = document.getElementById('attach-item-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function setAttachTab(tab) {
    attachTab = tab;
    document.getElementById('attach-tab-books').className = tab === 'books'
        ? 'px-4 py-2 rounded-xl text-xs font-bold bg-accord-blue text-white'
        : 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-accord-slate';
    document.getElementById('attach-tab-posts').className = tab === 'posts'
        ? 'px-4 py-2 rounded-xl text-xs font-bold bg-accord-blue text-white'
        : 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-accord-slate';
    renderAttachItems();
}

function renderAttachItems() {
    const listEl = document.getElementById('attach-items-list');
    if (!listEl) return;
    const q = (document.getElementById('attach-search')?.value || '').trim().toLowerCase();

    if (attachTab === 'books') {
        const items = attachBooksCache.filter(b =>
            (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)
        );
        listEl.innerHTML = items.length === 0
            ? '<p class="py-6 text-center text-xs text-accord-muted">No matching books.</p>'
            : items.map(b => `
                <button type="button" onclick="sendAttachedBook('${b.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left">
                    <div class="min-w-0 pr-3">
                        <p class="text-xs font-bold text-accord-slate truncate">${escapeChatHtml(b.title)}</p>
                        <p class="text-[10px] text-accord-muted truncate">${escapeChatHtml(b.author || 'Accord Library')}</p>
                    </div>
                    <span class="px-3 py-1 rounded-lg bg-accord-blue text-white text-[11px] font-bold shrink-0">Share</span>
                </button>
            `).join('');
    } else {
        const items = attachPostsCache.filter(p =>
            (p.title || '').toLowerCase().includes(q) || (p.author_name || '').toLowerCase().includes(q)
        );
        listEl.innerHTML = items.length === 0
            ? '<p class="py-6 text-center text-xs text-accord-muted">No matching posts.</p>'
            : items.map(p => `
                <button type="button" onclick="sendAttachedPost('${p.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left">
                    <div class="min-w-0 pr-3">
                        <p class="text-xs font-bold text-accord-slate truncate">${escapeChatHtml(p.title)}</p>
                        <p class="text-[10px] text-accord-muted truncate">${escapeChatHtml(p.post_type)} · ${escapeChatHtml(p.author_name || 'Member')}</p>
                    </div>
                    <span class="px-3 py-1 rounded-lg bg-accord-blue text-white text-[11px] font-bold shrink-0">Share</span>
                </button>
            `).join('');
    }
}

async function sendAttachedBook(bookId) {
    const b = attachBooksCache.find(x => String(x.id) === String(bookId));
    if (!b || !activeConvId) return;
    closeAttachModal();
    await supabaseClient.from('chat_messages').insert([{
        conversation_id: activeConvId,
        sender_id: chatUser.id,
        message_type: 'shared_book',
        attachment_meta: {
            id: b.id,
            title: b.title,
            author_name: b.author || '',
            image_url: b.cover_url || '',
            url: `book.html?id=${encodeURIComponent(b.id)}`
        }
    }]);
}

async function sendAttachedPost(postId) {
    const p = attachPostsCache.find(x => String(x.id) === String(postId));
    if (!p || !activeConvId) return;
    closeAttachModal();
    const videoThumb = p.post_type === 'video' ? getChatVideoThumbnailUrl(p.media_url) : '';
    await supabaseClient.from('chat_messages').insert([{
        conversation_id: activeConvId,
        sender_id: chatUser.id,
        message_type: p.post_type === 'testimony' ? 'shared_testimony' : 'shared_post',
        attachment_meta: {
            id: p.id,
            title: p.title,
            subtitle: (p.body || '').slice(0, 110),
            author_name: p.author_name || 'Member',
            post_type: p.post_type,
            image_url: videoThumb,
            media_url: p.media_url || '',
            url: `post.html?id=${encodeURIComponent(p.id)}`
        }
    }]);
}

function getChatVideoThumbnailUrl(url) {
    if (!url) return '';
    const str = String(url).trim();
    let videoId = '';
    if (str.includes('youtu.be/')) videoId = str.split('youtu.be/')[1]?.split(/[?&#]/)[0];
    else if (str.includes('watch?v=')) videoId = str.split('watch?v=')[1]?.split(/[?&#]/)[0];
    else if (str.includes('embed/')) videoId = str.split('embed/')[1]?.split(/[?&#]/)[0];
    else if (str.includes('/shorts/')) videoId = str.split('/shorts/')[1]?.split(/[?&#]/)[0];
    else if (str.includes('/live/')) videoId = str.split('/live/')[1]?.split(/[?&#]/)[0];
    if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }
    return '';
}

function safeChatUrl(url) {
    const s = String(url || '').trim();
    if (!s) return '#';
    if (/^(javascript|data|vbscript):/i.test(s)) return '#';
    return s;
}

function formatChatTime(dateStr) {
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeChatHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
