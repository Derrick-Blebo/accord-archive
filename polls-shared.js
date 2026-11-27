(function () {
    let _registeredPolls = [];
    let _activePoll = null;
    let _activeShareUrl = '';
    let _conversationsCache = [];
    let _usersCache = [];
    let _currentUser = null;

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getClient() {
        return window.supabaseClient || null;
    }

    function getPollShareUrl(pollId) {
        const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
        return `${base}poll.html?id=${encodeURIComponent(pollId)}`;
    }

    function registerPolls(polls) {
        _registeredPolls = Array.isArray(polls) ? polls : [];
    }

    function findPollById(pollId) {
        return _registeredPolls.find(p => String(p.id) === String(pollId)) || null;
    }

    function summarizePollLeader(poll) {
        const nominees = Array.isArray(poll?.nominees) ? poll.nominees : [];
        const votes = poll?.votes || {};
        const totalVotes = Object.values(votes).reduce((a, b) => a + (Number(b) || 0), 0);
        const ranked = nominees
            .map(n => {
                const name = typeof n === 'string' ? n : (n?.name || '');
                return { name, count: Number(votes[name] || 0) };
            })
            .filter(r => r.name)
            .sort((a, b) => b.count - a.count);

        const topCount = ranked[0]?.count || 0;
        const leaders = ranked.filter(r => r.count === topCount);
        const hasLeader = topCount > 0 && leaders.length > 0;
        const leaderText = hasLeader ? leaders.map(l => l.name).join(' & ') : '';
        const pct = totalVotes > 0 ? Math.round((topCount / totalVotes) * 100) : 0;

        if (poll?.status === 'closed') {
            return hasLeader
                ? `Winner: ${leaderText} (${pct}% · ${totalVotes} votes)`
                : `Final Results · ${totalVotes} votes`;
        }
        if (poll?.status === 'nominating') {
            return 'Accepting nominations — click to view & participate';
        }
        return hasLeader
            ? `Leading: ${leaderText} (${pct}%) · ${totalVotes} votes — Vote now!`
            : `Open for voting · ${totalVotes} votes — Cast the first vote!`;
    }

    function ensureModalDom() {
        if (document.getElementById('accord-poll-share-modal')) return;
        const wrapper = document.createElement('div');
        wrapper.id = 'accord-poll-share-modal';
        wrapper.className = 'fixed inset-0 z-50 bg-accord-slate/75 backdrop-blur-sm hidden items-center justify-center p-4';
        wrapper.innerHTML = `
            <div class="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onclick="event.stopPropagation()">
                <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <div class="min-w-0 pr-3">
                        <h3 class="font-bold text-accord-slate text-sm flex items-center gap-1.5">
                            <i class="fa-solid fa-trophy text-accord-gold"></i>
                            <span>Share Award Poll</span>
                        </h3>
                        <p id="poll-share-subtitle" class="text-[11px] text-accord-muted truncate mt-0.5"></p>
                    </div>
                    <button type="button" onclick="window.AccordPolls.closeShareModal()" class="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="p-5 space-y-5 overflow-y-auto">
                    <div class="space-y-2.5">
                        <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-muted">Share Externally &amp; Invite Votes</p>
                        <div class="grid grid-cols-2 gap-2">
                            <button type="button" id="poll-share-native-btn" onclick="window.AccordPolls.shareNative()" class="hidden px-3 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                                <i class="fa-solid fa-share-from-square"></i>
                                <span>Share...</span>
                            </button>
                            <button type="button" onclick="window.AccordPolls.copyLink()" class="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                                <i class="fa-solid fa-link"></i>
                                <span>Copy Poll Link</span>
                            </button>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 pt-0.5">
                            <a id="poll-share-wa-link" href="#" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold transition-colors">
                                <i class="fa-brands fa-whatsapp text-sm"></i>
                                <span>WhatsApp</span>
                            </a>
                            <a id="poll-share-x-link" href="#" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors">
                                <i class="fa-brands fa-x-twitter"></i>
                                <span>X</span>
                            </a>
                            <a id="poll-share-tg-link" href="#" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold transition-colors">
                                <i class="fa-brands fa-telegram text-sm"></i>
                                <span>Telegram</span>
                            </a>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-4 space-y-2.5">
                        <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-muted">Share in Accord Chat</p>
                        <input type="text" id="poll-share-chat-note" placeholder="Add a message (e.g. Vote for your favourite!)..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue focus:bg-white">
                        <input type="text" id="poll-share-chat-search" oninput="window.AccordPolls.renderChatTargets()" placeholder="Search chats or members..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue focus:bg-white">
                        <div id="poll-share-chat-targets" class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                            <p class="py-4 text-center text-xs text-accord-muted">Loading chats...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        wrapper.addEventListener('click', closeShareModal);
        document.body.appendChild(wrapper);
    }

    async function openShareModal(pollOrId) {
        const poll = typeof pollOrId === 'string' ? findPollById(pollOrId) : pollOrId;
        if (!poll) return;

        ensureModalDom();
        _activePoll = poll;
        _activeShareUrl = getPollShareUrl(poll.id);

        const subEl = document.getElementById('poll-share-subtitle');
        if (subEl) subEl.textContent = poll.title || 'Accord Award Poll';

        const noteEl = document.getElementById('poll-share-chat-note');
        if (noteEl) noteEl.value = '';
        const searchEl = document.getElementById('poll-share-chat-search');
        if (searchEl) searchEl.value = '';

        const shareText = poll.status === 'closed'
            ? `See who won "${poll.title}" on Accord Music Hub:`
            : `Vote in "${poll.title}" on Accord Music Hub! See who is leading and cast your vote:`;

        const waEl = document.getElementById('poll-share-wa-link');
        const xEl = document.getElementById('poll-share-x-link');
        const tgEl = document.getElementById('poll-share-tg-link');
        if (waEl) waEl.href = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${_activeShareUrl}`)}`;
        if (xEl) xEl.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(_activeShareUrl)}`;
        if (tgEl) tgEl.href = `https://t.me/share/url?url=${encodeURIComponent(_activeShareUrl)}&text=${encodeURIComponent(shareText)}`;

        const nativeBtn = document.getElementById('poll-share-native-btn');
        if (nativeBtn) {
            nativeBtn.classList.toggle('hidden', typeof navigator.share !== 'function');
        }

        const modal = document.getElementById('accord-poll-share-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        await loadChatTargets();
    }

    function closeShareModal() {
        const modal = document.getElementById('accord-poll-share-modal');
        modal?.classList.add('hidden');
        modal?.classList.remove('flex');
    }

    async function loadChatTargets() {
        const targetsEl = document.getElementById('poll-share-chat-targets');
        const client = getClient();
        if (!targetsEl || !client) return;

        const { data: { session } } = await client.auth.getSession();
        if (!session?.user) {
            _currentUser = null;
            const next = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
            targetsEl.innerHTML = `
                <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                    <p class="text-xs text-accord-slate font-medium">Sign in to share this poll directly in Accord DMs and group chats.</p>
                    <a href="signin.html?next=${next}" class="inline-block px-4 py-1.5 rounded-xl bg-accord-blue text-white text-xs font-bold">Sign In</a>
                </div>
            `;
            return;
        }

        _currentUser = session.user;
        targetsEl.innerHTML = `<p class="py-4 text-center text-xs text-accord-muted">Loading conversations...</p>`;

        try {
            const [convRes, profilesRes] = await Promise.all([
                client
                    .from('conversation_members')
                    .select('conversation_id, conversations(id, is_group, title, last_message_at)')
                    .eq('user_id', _currentUser.id),
                client
                    .from('profiles')
                    .select('id, full_name')
                    .neq('id', _currentUser.id)
                    .order('full_name', { ascending: true })
                    .limit(40)
            ]);

            const convRows = (convRes.data || []).filter(r => r.conversations);
            const convIds = convRows.map(r => r.conversation_id);
            let otherNamesByConv = {};
            if (convIds.length > 0) {
                const { data: otherMembers } = await client
                    .from('conversation_members')
                    .select('conversation_id, user_id, profiles(full_name)')
                    .in('conversation_id', convIds)
                    .neq('user_id', _currentUser.id);
                (otherMembers || []).forEach(m => {
                    if (!otherNamesByConv[m.conversation_id]) {
                        otherNamesByConv[m.conversation_id] = m.profiles?.full_name || 'Member';
                    }
                });
            }

            _conversationsCache = convRows
                .map(r => ({
                    id: r.conversations.id,
                    is_group: r.conversations.is_group,
                    name: r.conversations.is_group
                        ? (r.conversations.title || 'Group Chat')
                        : (otherNamesByConv[r.conversations.id] || 'Direct Message'),
                    last_message_at: r.conversations.last_message_at
                }))
                .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

            _usersCache = profilesRes.data || [];
            renderChatTargets();
        } catch (err) {
            targetsEl.innerHTML = `<p class="py-4 text-center text-xs text-red-600">Could not load chats.</p>`;
        }
    }

    function renderChatTargets() {
        const targetsEl = document.getElementById('poll-share-chat-targets');
        if (!targetsEl || !_currentUser) return;
        const q = (document.getElementById('poll-share-chat-search')?.value || '').trim().toLowerCase();

        const filteredConvs = _conversationsCache.filter(c => c.name.toLowerCase().includes(q));
        const filteredUsers = _usersCache.filter(u => (u.full_name || '').toLowerCase().includes(q));

        let html = '';
        if (filteredConvs.length > 0) {
            html += `<p class="px-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-accord-muted">Recent Chats</p>`;
            html += filteredConvs.map(c => `
                <button type="button" onclick="window.AccordPolls.sendToConversation('${c.id}', this)" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors text-left">
                    <div class="flex items-center space-x-2.5 min-w-0">
                        <div class="w-8 h-8 rounded-full ${c.is_group ? 'bg-accord-goldLight text-amber-800' : 'bg-accord-lightBlue text-accord-blue'} font-bold text-xs flex items-center justify-center shrink-0">
                            <i class="fa-solid ${c.is_group ? 'fa-users' : 'fa-user'} text-[11px]"></i>
                        </div>
                        <p class="text-xs font-bold text-accord-slate truncate">${escapeHtml(c.name)}</p>
                    </div>
                    <span class="px-3 py-1 rounded-lg bg-accord-blue text-white text-[11px] font-bold shrink-0">Send</span>
                </button>
            `).join('');
        }

        if (filteredUsers.length > 0) {
            html += `<p class="px-2 pt-2 text-[10px] font-bold uppercase tracking-wider text-accord-muted">Members</p>`;
            html += filteredUsers.map(u => {
                const name = u.full_name || 'Accord Member';
                return `
                    <button type="button" onclick="window.AccordPolls.sendToUser('${u.id}', this)" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors text-left">
                        <div class="flex items-center space-x-2.5 min-w-0">
                            <div class="w-8 h-8 rounded-full bg-slate-100 text-accord-slate font-bold text-xs flex items-center justify-center shrink-0">
                                ${escapeHtml(name.charAt(0).toUpperCase())}
                            </div>
                            <p class="text-xs font-bold text-accord-slate truncate">${escapeHtml(name)}</p>
                        </div>
                        <span class="px-3 py-1 rounded-lg bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate text-[11px] font-bold transition-colors shrink-0">Send</span>
                    </button>
                `;
            }).join('');
        }

        if (!html) {
            html = `<p class="py-5 text-center text-xs text-accord-muted">No matching chats or members found.</p>`;
        }
        targetsEl.innerHTML = html;
    }

    async function sendToUser(targetUserId, btnEl) {
        const client = getClient();
        if (!client || !_activePoll) return;
        if (btnEl) {
            btnEl.disabled = true;
            const badge = btnEl.querySelector('span:last-child');
            if (badge) badge.textContent = 'Sending...';
        }
        const { data: convId, error } = await client.rpc('get_or_create_dm', { target_user_id: targetUserId });
        if (error || !convId) {
            if (typeof window.showToast === 'function') window.showToast(error?.message || 'Could not start chat.', true);
            if (btnEl) {
                btnEl.disabled = false;
                const badge = btnEl.querySelector('span:last-child');
                if (badge) badge.textContent = 'Send';
            }
            return;
        }
        await sendToConversation(convId, btnEl);
    }

    async function sendToConversation(conversationId, btnEl) {
        const client = getClient();
        if (!client || !_currentUser || !_activePoll) return;
        if (btnEl) {
            btnEl.disabled = true;
            const badge = btnEl.querySelector('span:last-child');
            if (badge) badge.textContent = 'Sending...';
        }

        const note = (document.getElementById('poll-share-chat-note')?.value || '').trim();
        const { error } = await client.from('chat_messages').insert([{
            conversation_id: conversationId,
            sender_id: _currentUser.id,
            message_type: 'shared_post',
            body: note || null,
            attachment_meta: {
                id: _activePoll.id,
                item_type: 'poll',
                badge_label: 'Award Poll',
                title: _activePoll.title || 'Accord Award Poll',
                subtitle: summarizePollLeader(_activePoll),
                author_name: 'Accord Music Awards',
                url: `poll.html?id=${encodeURIComponent(_activePoll.id)}`
            }
        }]);

        if (error) {
            if (typeof window.showToast === 'function') window.showToast(`Could not send: ${error.message}`, true);
            if (btnEl) {
                btnEl.disabled = false;
                const badge = btnEl.querySelector('span:last-child');
                if (badge) badge.textContent = 'Send';
            }
            return;
        }

        closeShareModal();
        if (typeof window.showToast === 'function') window.showToast('Poll shared to chat!');
    }

    async function shareNative() {
        if (!_activePoll || typeof navigator.share !== 'function') return;
        try {
            await navigator.share({
                title: `${_activePoll.title} — Accord Music Awards`,
                text: summarizePollLeader(_activePoll),
                url: _activeShareUrl
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                copyLink();
            }
        }
    }

    async function copyLink() {
        const url = _activeShareUrl;
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            if (typeof window.showToast === 'function') window.showToast('Poll link copied to clipboard!');
        } catch {
            prompt('Copy this poll link:', url);
        }
    }

    window.AccordPolls = {
        registerPolls,
        getPollShareUrl,
        summarizePollLeader,
        openShareModal,
        closeShareModal,
        renderChatTargets,
        sendToUser,
        sendToConversation,
        shareNative,
        copyLink
    };
})();
