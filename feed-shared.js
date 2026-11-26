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
