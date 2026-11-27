// ==========================================
// ACCORD SUPERADMIN COMMAND CENTER
// ==========================================

const SUPERADMIN_MASTER_EMAIL = (typeof MASTER_ADMIN_EMAIL !== 'undefined' && MASTER_ADMIN_EMAIL)
    ? MASTER_ADMIN_EMAIL
    : 'accordmedia1@gmail.com';

let rolesRegistry = getDefaultRolesRegistry();
let ministryUpgradeRequests = [];
let revokeTargetEmail = null;
let currentSuperadminUser = null;

function getDefaultRolesRegistry() {
    return [
        {
            email: SUPERADMIN_MASTER_EMAIL,
            name: 'Derrick Quaynortey Blebo',
            title: 'Founder & Master Superadmin',
            portals: ['superadmin', 'library', 'music', 'testimonies'],
            status: 'active',
            isMaster: true,
            updatedAt: new Date().toISOString()
        }
    ];
}

// ==========================================
// AUTHENTICATION & ACCESS VERIFICATION GATE
// ==========================================

window.onload = async function () {
    await loadRolesRegistryFromSupabase();
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session?.user?.email) {
        if (hasSuperadminPermission(session.user.email)) {
            unlockSuperadminDashboard(session.user);
        } else {
            await supabaseClient.auth.signOut();
            showLoginError('Access denied. Master Superadmin credentials required.');
        }
    }
};

function hasSuperadminPermission(email) {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    if (clean === SUPERADMIN_MASTER_EMAIL.toLowerCase()) return true;

    const entry = rolesRegistry.find(r => (r.email || '').toLowerCase() === clean);
    return Boolean(entry && entry.status === 'active' && Array.isArray(entry.portals) && entry.portals.includes('superadmin'));
}

function showLoginError(msg) {
    const errorBox = document.getElementById('login-error');
    if (errorBox) {
        errorBox.innerText = msg;
        errorBox.classList.remove('hidden');
    }
}

async function handleSuperadminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorBox.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Verifying Master Credentials...';

    try {
        if (typeof supabaseClient === 'undefined') {
            throw new Error('Database client failed to initialize. Check admin-core.js.');
        }

        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            showLoginError(error.message || 'Invalid email or password.');
            return;
        }

        await loadRolesRegistryFromSupabase();

        if (!hasSuperadminPermission(data?.user?.email)) {
            await supabaseClient.auth.signOut();
            showLoginError('Access denied. Your account is not authorized for Superadmin access.');
            return;
        }

        unlockSuperadminDashboard(data.user);
        showToast('Welcome to Accord Superadmin Command Center!');
    } catch (err) {
        console.error('Superadmin login error:', err);
        showLoginError(err.message || 'An unexpected error occurred during sign in.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Unlock Superadmin Command Center';
    }
}

function unlockSuperadminDashboard(user) {
    currentSuperadminUser = user || null;
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('dashboard-wrapper').classList.remove('hidden');
    const emailEl = document.getElementById('superadmin-user-email');
    if (emailEl && user?.email) emailEl.innerText = user.email;

    const hashTab = (window.location.hash || '').replace('#', '').trim();
    const validTabs = ['overview', 'roles', 'upgrades', 'promotions', 'withdrawals'];
    switchSuperadminTab(validTabs.includes(hashTab) ? hashTab : 'overview');

    fetchEcosystemMetrics();
    loadMinistryUpgradeRequests();
    loadSuperadminPromotions();
    loadSuperadminWithdrawals();
}

function switchSuperadminTab(tabKey) {
    const validTabs = ['overview', 'roles', 'upgrades', 'promotions', 'withdrawals'];
    const activeTab = validTabs.includes(tabKey) ? tabKey : 'overview';

    validTabs.forEach(key => {
        const panel = document.getElementById(`tab-panel-${key}`);
        const btn = document.getElementById(`tab-btn-${key}`);
        if (panel) {
            panel.classList.toggle('hidden', key !== activeTab);
        }
        if (btn) {
            if (key === activeTab) {
                btn.classList.add('bg-accord-slate', 'text-white', 'shadow-sm');
                btn.classList.remove('text-accord-muted', 'hover:text-accord-slate', 'hover:bg-slate-100');
            } else {
                btn.classList.remove('bg-accord-slate', 'text-white', 'shadow-sm');
                btn.classList.add('text-accord-muted', 'hover:text-accord-slate', 'hover:bg-slate-100');
            }
        }
    });

    if (window.location.hash !== `#${activeTab}`) {
        history.replaceState(null, '', `#${activeTab}`);
    }
}

async function handleSuperadminLogout() {
    await supabaseClient.auth.signOut();
    document.getElementById('dashboard-wrapper').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('superadmin-login-form').reset();
    showToast('Signed out of Superadmin.');
}

// ==========================================
// MINISTRY / MINISTER UPGRADE REQUESTS
// ==========================================

async function loadMinistryUpgradeRequests() {
    const tbody = document.getElementById('ministry-upgrades-tbody');
    if (!tbody) return;

    const rlsHint = document.getElementById('ministry-upgrades-rls-hint');
    if (rlsHint) rlsHint.classList.add('hidden');

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, account_type, upgrade_status, upgrade_pitch, upgrade_requested_at, ministry_role, verification_samples, verification_socials, verification_revoked_reason')
        .in('upgrade_status', ['pending', 'approved', 'rejected', 'revoked'])
        .order('upgrade_requested_at', { ascending: false });

    if (error) {
        if (rlsHint) rlsHint.classList.remove('hidden');
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-red-600">Could not load upgrade requests: ${escapeSuperHtml(error.message)}</td></tr>`;
        return;
    }

    const statusPriority = { pending: 0, approved: 1, rejected: 2, revoked: 3 };
    ministryUpgradeRequests = (data || []).slice().sort((a, b) => {
        const pa = statusPriority[a.upgrade_status] ?? 4;
        const pb = statusPriority[b.upgrade_status] ?? 4;
        if (pa !== pb) return pa - pb;
        const ta = a.upgrade_requested_at ? new Date(a.upgrade_requested_at).getTime() : 0;
        const tb = b.upgrade_requested_at ? new Date(b.upgrade_requested_at).getTime() : 0;
        return tb - ta;
    });
    renderMinistryUpgradeRequests();
}

function renderMinistryUpgradeRequests() {
    const tbody = document.getElementById('ministry-upgrades-tbody');
    const badge = document.getElementById('pending-upgrades-badge');
    if (!tbody) return;

    const pendingCount = ministryUpgradeRequests.filter(r => r.upgrade_status === 'pending').length;
    if (badge) {
        badge.textContent = `${pendingCount} Pending`;
    }
    const tabBadge = document.getElementById('tab-badge-upgrades');
    if (tabBadge) {
        tabBadge.textContent = pendingCount;
        tabBadge.classList.toggle('hidden', pendingCount === 0);
    }
    const overviewCount = document.getElementById('overview-pending-upgrades');
    if (overviewCount) overviewCount.textContent = pendingCount;

    if (ministryUpgradeRequests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-accord-muted">No Ministry / Minister upgrade requests yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    ministryUpgradeRequests.forEach(req => {
        const status = req.upgrade_status || 'none';
        const reqDate = req.upgrade_requested_at
            ? new Date(req.upgrade_requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';
        const samplesCount = Array.isArray(req.verification_samples) ? req.verification_samples.length : 0;

        let statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-accord-muted">${escapeSuperHtml(status)}</span>`;
        if (status === 'pending') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Pending</span>`;
        } else if (status === 'approved') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Approved</span>`;
        } else if (status === 'rejected') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-50 text-red-600">Rejected</span>`;
        } else if (status === 'revoked') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">Revoked</span>`;
        }

        let actionsHtml = `<button type="button" onclick="openInspectVerificationModal('${req.id}')" class="bg-accord-lightBlue hover:bg-blue-100 text-accord-blue text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all">Inspect (${samplesCount}/5)</button>`;
        if (status === 'pending') {
            actionsHtml += `
                <button type="button" onclick="approveMinistryUpgrade('${req.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all">Approve</button>
                <button type="button" onclick="rejectMinistryUpgrade('${req.id}')" class="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all">Reject</button>`;
        } else if (status === 'approved' || req.account_type === 'ministry_minister') {
            actionsHtml += `
                <button type="button" onclick="openRevokeVerificationModal('${req.id}')" class="bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all">Revoke</button>`;
        }

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0';
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${escapeSuperHtml(req.full_name || 'Member')}</p>
                <p class="text-[11px] text-accord-muted">${escapeSuperHtml(req.email || '')}</p>
                ${req.ministry_role ? `<span class="inline-block mt-1 px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-accord-slate">${escapeSuperHtml(req.ministry_role)}</span>` : ''}
            </td>
            <td class="py-4 px-6 max-w-md">
                <p class="text-xs text-slate-700 leading-relaxed line-clamp-3 whitespace-pre-wrap">${escapeSuperHtml(req.upgrade_pitch || '')}</p>
                ${status === 'revoked' && req.verification_revoked_reason ? `<p class="text-[11px] text-red-700 font-semibold mt-1">Revoked: ${escapeSuperHtml(req.verification_revoked_reason)}</p>` : ''}
            </td>
            <td class="py-4 px-6 text-center text-accord-muted whitespace-nowrap">${reqDate}</td>
            <td class="py-4 px-6 text-center">${statusPill}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function openInspectVerificationModal(userId) {
    const req = ministryUpgradeRequests.find(r => String(r.id) === String(userId));
    if (!req) return;

    const subtitle = document.getElementById('inspect-applicant-subtitle');
    const body = document.getElementById('inspect-verification-body');
    const footer = document.getElementById('inspect-verification-footer');
    if (subtitle) subtitle.textContent = `${req.full_name || 'Member'} • ${req.email || ''} ${req.ministry_role ? `• ${req.ministry_role}` : ''}`;

    const samples = Array.isArray(req.verification_samples) ? req.verification_samples : [];
    const socials = req.verification_socials && typeof req.verification_socials === 'object' ? req.verification_socials : {};
    const socialEntries = Object.entries(socials).filter(([, val]) => val && String(val).trim().startsWith('http'));

    const socialsHtml = socialEntries.length > 0
        ? `<div class="flex flex-wrap gap-2">${socialEntries.map(([k, v]) => `<a href="${escapeSuperHtml(v)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-accord-lightBlue text-accord-slate hover:text-accord-blue font-bold capitalize"><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i><span>${escapeSuperHtml(k)}</span></a>`).join('')}</div>`
        : `<p class="text-accord-muted italic">No external social links provided.</p>`;

    const samplesHtml = samples.length > 0
        ? samples.map((s, idx) => `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] font-extrabold uppercase tracking-wider text-accord-blue">Sample #${idx + 1} • ${escapeSuperHtml(s.post_type || 'text')}</span>
                    ${s.media_url ? `<a href="${escapeSuperHtml(s.media_url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-bold text-accord-blue hover:underline">Media Link</a>` : ''}
                </div>
                <p class="font-bold text-accord-slate text-xs">${escapeSuperHtml(s.title || 'Untitled')}</p>
                <p class="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">${escapeSuperHtml(s.body || '')}</p>
            </div>
        `).join('')
        : `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">No sample posts submitted yet (legacy request).</p>`;

    if (body) {
        body.innerHTML = `
            <div class="space-y-1.5">
                <h4 class="text-[11px] font-extrabold uppercase tracking-wider text-accord-muted">Statement of Faith & Gospel Plan</h4>
                <p class="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">${escapeSuperHtml(req.upgrade_pitch || '—')}</p>
            </div>
            <div class="space-y-1.5">
                <h4 class="text-[11px] font-extrabold uppercase tracking-wider text-accord-muted">Christian Social Activity Links</h4>
                ${socialsHtml}
            </div>
            <div class="space-y-2">
                <h4 class="text-[11px] font-extrabold uppercase tracking-wider text-accord-muted">5 Initial Sample Posts (${samples.length} provided)</h4>
                ${samplesHtml}
            </div>
        `;
    }

    if (footer) {
        if (req.upgrade_status === 'pending') {
            footer.innerHTML = `
                <button type="button" onclick="closeInspectVerificationModal()" class="px-4 py-2 rounded-xl bg-slate-200 text-accord-slate text-xs font-bold">Close</button>
                <button type="button" onclick="closeInspectVerificationModal(); rejectMinistryUpgrade('${req.id}')" class="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold">Reject</button>
                <button type="button" onclick="closeInspectVerificationModal(); approveMinistryUpgrade('${req.id}')" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">Approve Verification</button>
            `;
        } else {
            footer.innerHTML = `<button type="button" onclick="closeInspectVerificationModal()" class="px-4 py-2 rounded-xl bg-slate-200 text-accord-slate text-xs font-bold">Close</button>`;
        }
    }

    const modal = document.getElementById('inspect-verification-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeInspectVerificationModal() {
    const modal = document.getElementById('inspect-verification-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function openRevokeVerificationModal(userId) {
    const req = ministryUpgradeRequests.find(r => String(r.id) === String(userId));
    document.getElementById('revoke-target-user-id').value = userId;
    document.getElementById('revoke-target-label').textContent = `Account: ${req?.full_name || 'Member'} (${req?.email || userId})`;
    document.getElementById('revoke-reason-input').value = '';
    const modal = document.getElementById('revoke-verification-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeRevokeVerificationModal() {
    const modal = document.getElementById('revoke-verification-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

async function handleRevokeVerificationSubmit(e) {
    e.preventDefault();
    const userId = document.getElementById('revoke-target-user-id').value;
    const reason = document.getElementById('revoke-reason-input').value.trim();
    if (!userId || reason.length < 10) {
        showToast('Please provide a clear reason (at least 10 characters).');
        return;
    }

    const btn = document.getElementById('revoke-submit-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Revoking...';
    }

    const { error } = await supabaseClient.rpc('revoke_ministry_verification', {
        target_user_id: userId,
        reason
    });

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Revoke & Hide All Posts';
    }

    if (error) {
        showToast(`Could not revoke verification: ${error.message}`);
        return;
    }

    closeRevokeVerificationModal();
    await loadMinistryUpgradeRequests();
    showToast('Verification revoked and all posts by this account have been hidden.');
}

async function approveMinistryUpgrade(userId) {
    const rlsHint = document.getElementById('ministry-upgrades-rls-hint');
    const { data, error } = await supabaseClient
        .from('profiles')
        .update({
            account_type: 'ministry_minister',
            upgrade_status: 'approved'
        })
        .eq('id', userId)
        .select('id, account_type, upgrade_status');

    if (error) {
        showToast(`Could not approve upgrade: ${error.message}`);
        return;
    }

    if (!data || data.length === 0) {
        if (rlsHint) rlsHint.classList.remove('hidden');
        showToast('Update blocked by Supabase RLS on profiles. Run supabase-superadmin-profiles-rls.sql in Supabase SQL Editor.');
        return;
    }

    if (rlsHint) rlsHint.classList.add('hidden');
    await loadMinistryUpgradeRequests();
    showToast('Account upgraded to Ministry / Minister.');
}

async function rejectMinistryUpgrade(userId) {
    const rlsHint = document.getElementById('ministry-upgrades-rls-hint');
    const { data, error } = await supabaseClient
        .from('profiles')
        .update({
            account_type: 'normal_user',
            upgrade_status: 'rejected'
        })
        .eq('id', userId)
        .select('id, account_type, upgrade_status');

    if (error) {
        showToast(`Could not reject upgrade: ${error.message}`);
        return;
    }

    if (!data || data.length === 0) {
        if (rlsHint) rlsHint.classList.remove('hidden');
        showToast('Update blocked by Supabase RLS on profiles. Run supabase-superadmin-profiles-rls.sql in Supabase SQL Editor.');
        return;
    }

    if (rlsHint) rlsHint.classList.add('hidden');
    await loadMinistryUpgradeRequests();
    showToast('Upgrade request marked as rejected.');
}

function escapeSuperHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
// LOAD & PERSIST ROLES REGISTRY + METRICS
// ==========================================

async function loadRolesRegistryFromSupabase() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('id, description')
        .eq('title', ROLES_CONFIG_RECORD_NAME)
        .maybeSingle();

    if (!error && data?.description) {
        try {
            const parsed = JSON.parse(data.description);
            if (Array.isArray(parsed) && parsed.length > 0) {
                rolesRegistry = ensureMasterAccountIncluded(parsed);
                localStorage.setItem('accord_roles_registry', JSON.stringify(rolesRegistry));
                return;
            }
        } catch (e) {}
    }

    const localSaved = localStorage.getItem('accord_roles_registry');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                rolesRegistry = ensureMasterAccountIncluded(parsed);
                return;
            }
        } catch (e) {}
    }

    rolesRegistry = getDefaultRolesRegistry();
}

function ensureMasterAccountIncluded(list) {
    const masterIdx = list.findIndex(r => (r.email || '').toLowerCase() === SUPERADMIN_MASTER_EMAIL.toLowerCase());
    const masterRecord = {
        email: SUPERADMIN_MASTER_EMAIL,
        name: masterIdx > -1 ? (list[masterIdx].name || 'Derrick Quaynortey Blebo') : 'Derrick Quaynortey Blebo',
        title: masterIdx > -1 ? (list[masterIdx].title || 'Founder & Master Superadmin') : 'Founder & Master Superadmin',
        portals: ['superadmin', 'library', 'music', 'testimonies'],
        status: 'active',
        isMaster: true,
        updatedAt: new Date().toISOString()
    };

    if (masterIdx > -1) {
        list[masterIdx] = masterRecord;
        return list;
    }
    return [masterRecord, ...list];
}

async function persistRolesRegistry() {
    rolesRegistry = ensureMasterAccountIncluded(rolesRegistry);
    localStorage.setItem('accord_roles_registry', JSON.stringify(rolesRegistry));

    const { data: existing } = await supabaseClient
        .from('books')
        .select('id')
        .eq('title', ROLES_CONFIG_RECORD_NAME)
        .maybeSingle();

    const payload = {
        title: ROLES_CONFIG_RECORD_NAME,
        author: 'System Roles Config',
        category: 'System',
        year: '2026',
        pages: '0',
        description: JSON.stringify(rolesRegistry),
        is_visible: false,
        status: 'system_config',
        is_for_sale: false,
        price: 0
    };

    if (existing?.id) {
        await supabaseClient.from('books').update(payload).eq('id', existing.id);
    } else {
        await supabaseClient.from('books').insert([payload]);
    }

    renderAdminRolesTable();
    updateAdminRoleCounts();
}

async function fetchEcosystemMetrics() {
    const [booksRes, subsRes, testimoniesRes, commentsRes] = await Promise.all([
        supabaseClient.from('books').select('id, title, status, is_visible, deleted_at, description'),
        supabaseClient.from('submissions').select('id, category'),
        supabaseClient.from('testimonies').select('id'),
        supabaseClient.from('testimony_comments').select('id')
    ]);

    if (!booksRes.error && booksRes.data) {
        const systemTitles = [ROLES_CONFIG_RECORD_NAME, LAYOUT_CONFIG_CATEGORY_NAME, MUSIC_CONFIG_RECORD_NAME];

        const roleRow = booksRes.data.find(b => b.title === ROLES_CONFIG_RECORD_NAME);
        if (roleRow?.description) {
            try {
                const parsed = JSON.parse(roleRow.description);
                if (Array.isArray(parsed)) rolesRegistry = ensureMasterAccountIncluded(parsed);
            } catch (e) {}
        }

        const musicRow = booksRes.data.find(b => b.title === MUSIC_CONFIG_RECORD_NAME);
        let musicItemsCount = 0;
        let activePollsCount = 0;
        if (musicRow?.description) {
            try {
                const musicCfg = JSON.parse(musicRow.description);
                musicItemsCount = (musicCfg.artistes?.length || 0) + (musicCfg.playlists?.length || 0);
                activePollsCount = (musicCfg.polls || []).filter(p => p.status === 'open').length;
            } catch (e) {}
        }
        document.getElementById('stat-music-items').innerText = musicItemsCount;
        document.getElementById('stat-music-polls').innerText = activePollsCount;

        const realBooks = booksRes.data.filter(b => !systemTitles.includes(b.title) && !b.deleted_at);
        const liveBooks = realBooks.filter(b => b.is_visible !== false && b.status !== 'draft');
        const draftBooks = realBooks.filter(b => b.status === 'draft' || b.is_visible === false);

        const manuscriptSubs = (!subsRes.error && subsRes.data)
            ? subsRes.data.filter(s => s.category !== 'MUSIC_SUBMISSION' && s.category !== 'POLL_VOTE')
            : [];

        document.getElementById('stat-lib-books').innerText = liveBooks.length;
        document.getElementById('stat-lib-pending').innerText = draftBooks.length + manuscriptSubs.length;
    }

    if (!testimoniesRes.error && testimoniesRes.data) {
        document.getElementById('stat-forum-posts').innerText = testimoniesRes.data.length;
    }

    if (!commentsRes.error && commentsRes.data) {
        document.getElementById('stat-forum-comments').innerText = commentsRes.data.length;
    }

    renderAdminRolesTable();
    updateAdminRoleCounts();
}

function updateAdminRoleCounts() {
    const activeRoles = rolesRegistry.filter(r => r.status === 'active');
    const libAdmins = activeRoles.filter(r => r.portals?.includes('library') || r.portals?.includes('superadmin')).length;
    const musicAdmins = activeRoles.filter(r => r.portals?.includes('music') || r.portals?.includes('superadmin')).length;
    const forumAdmins = activeRoles.filter(r => r.portals?.includes('testimonies') || r.portals?.includes('superadmin')).length;

    if (document.getElementById('stat-lib-admins')) document.getElementById('stat-lib-admins').innerText = libAdmins;
    if (document.getElementById('stat-music-admins')) document.getElementById('stat-music-admins').innerText = musicAdmins;
    if (document.getElementById('stat-forum-admins')) document.getElementById('stat-forum-admins').innerText = forumAdmins;
    if (document.getElementById('overview-active-admins')) document.getElementById('overview-active-admins').innerText = activeRoles.length;
}

// ==========================================
// RENDER & MANAGE TEAM PERMISSIONS MATRIX
// ==========================================

function renderAdminRolesTable() {
    const tbody = document.getElementById('admin-roles-table-body');
    if (!tbody) return;

    const query = (document.getElementById('role-search')?.value || '').toLowerCase().trim();
    const filtered = rolesRegistry.filter(r =>
        (r.name || '').toLowerCase().includes(query) ||
        (r.email || '').toLowerCase().includes(query) ||
        (r.title || '').toLowerCase().includes(query)
    );

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-accord-muted">No matching admin accounts found.</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        const isMaster = item.isMaster || item.email.toLowerCase() === SUPERADMIN_MASTER_EMAIL.toLowerCase();
        const isActive = item.status === 'active';
        const safeEmail = item.email.replace(/'/g, "\\'");

        const hasLibrary = isMaster || (item.portals || []).includes('library');
        const hasMusic = isMaster || (item.portals || []).includes('music');
        const hasTestimonies = isMaster || (item.portals || []).includes('testimonies');
        const hasSuper = isMaster || (item.portals || []).includes('superadmin');

        const renderTogglePill = (portalKey, isGranted, colorClass) => {
            if (isMaster) {
                return `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-accord-slate"><i class="fa-solid fa-lock mr-1 text-accord-gold"></i> Master</span>`;
            }
            return `
                <button type="button" onclick="quickTogglePortal('${safeEmail}', '${portalKey}')" class="px-3 py-1 rounded-xl text-[11px] font-bold transition-all ${isGranted ? colorClass : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}" title="Click to toggle ${portalKey} access">
                    <i class="fa-solid ${isGranted ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1"></i>
                    ${isGranted ? 'Granted' : 'No Access'}
                </button>
            `;
        };

        const statusBadge = isActive
            ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Active</span>`
            : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">Suspended</span>`;

        const actionsHtml = isMaster
            ? `<span class="text-[11px] font-bold text-accord-muted italic">Protected Owner</span>`
            : `
                <button type="button" onclick="toggleAccountStatus('${safeEmail}')" class="w-8 h-8 rounded-xl ${isActive ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'} hover:opacity-80 transition-all inline-flex items-center justify-center" title="${isActive ? 'Suspend Account' : 'Activate Account'}">
                    <i class="fa-solid ${isActive ? 'fa-pause' : 'fa-play'} text-xs"></i>
                </button>
                <button type="button" onclick="openAdminRoleModal('edit', '${safeEmail}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Permissions">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button type="button" onclick="promptRevokeRole('${safeEmail}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Revoke & Remove">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            `;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div class="flex items-center space-x-3">
                    <div class="w-9 h-9 rounded-xl ${isMaster ? 'bg-accord-slate text-accord-gold' : 'bg-accord-lightBlue text-accord-blue'} font-bold flex items-center justify-center text-xs shrink-0">
                        ${escapeSuperHtml((item.name || item.email || 'A').substring(0, 2).toUpperCase())}
                    </div>
                    <div>
                        <p class="font-bold text-accord-slate flex items-center gap-1.5">
                            <span>${escapeSuperHtml(item.name || 'Team Member')}</span>
                            ${hasSuper ? `<span class="bg-amber-100 text-amber-800 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full">Superadmin</span>` : ''}
                        </p>
                        <p class="text-[11px] text-accord-muted">${escapeSuperHtml(item.email)}</p>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6 text-accord-muted font-semibold">${escapeSuperHtml(item.title || 'Admin')}</td>
            <td class="py-4 px-6 text-center">${renderTogglePill('library', hasLibrary, 'bg-blue-50 text-accord-blue border border-blue-200')}</td>
            <td class="py-4 px-6 text-center">${renderTogglePill('music', hasMusic, 'bg-emerald-50 text-emerald-700 border border-emerald-200')}</td>
            <td class="py-4 px-6 text-center">${renderTogglePill('testimonies', hasTestimonies, 'bg-amber-50 text-amber-700 border border-amber-200')}</td>
            <td class="py-4 px-6 text-center">${statusBadge}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function quickTogglePortal(email, portalKey) {
    const clean = email.trim().toLowerCase();
    if (clean === SUPERADMIN_MASTER_EMAIL.toLowerCase()) return;

    const record = rolesRegistry.find(r => r.email.toLowerCase() === clean);
    if (!record) return;

    if (!Array.isArray(record.portals)) record.portals = [];
    if (record.portals.includes(portalKey)) {
        record.portals = record.portals.filter(p => p !== portalKey);
    } else {
        record.portals.push(portalKey);
    }
    record.updatedAt = new Date().toISOString();

    await persistRolesRegistry();
    showToast(`Updated ${portalKey} permission for ${record.name || record.email}.`);
}

async function toggleAccountStatus(email) {
    const clean = email.trim().toLowerCase();
    if (clean === SUPERADMIN_MASTER_EMAIL.toLowerCase()) return;

    const record = rolesRegistry.find(r => r.email.toLowerCase() === clean);
    if (!record) return;

    record.status = record.status === 'active' ? 'suspended' : 'active';
    record.updatedAt = new Date().toISOString();

    await persistRolesRegistry();
    showToast(record.status === 'active' ? `Account ${record.email} activated.` : `Account ${record.email} suspended.`);
}

function openAdminRoleModal(mode, email = null) {
    const modal = document.getElementById('admin-role-modal');
    const heading = document.getElementById('role-modal-heading');
    document.getElementById('admin-role-form').reset();
    document.getElementById('edit-role-original-email').value = '';
    const emailInput = document.getElementById('role-user-email');
    emailInput.disabled = false;

    if (mode === 'edit' && email) {
        heading.innerText = 'Edit Admin Portal Permissions';
        const record = rolesRegistry.find(r => r.email.toLowerCase() === email.toLowerCase());
        if (record) {
            document.getElementById('edit-role-original-email').value = record.email;
            document.getElementById('role-user-name').value = record.name || '';
            document.getElementById('role-user-title').value = record.title || '';
            emailInput.value = record.email;
            document.getElementById('perm-library').checked = (record.portals || []).includes('library');
            document.getElementById('perm-music').checked = (record.portals || []).includes('music');
            document.getElementById('perm-testimonies').checked = (record.portals || []).includes('testimonies');
            document.getElementById('perm-superadmin').checked = (record.portals || []).includes('superadmin');
        }
    } else {
        heading.innerText = 'Assign Admin Portal Access';
        document.getElementById('perm-library').checked = true;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAdminRoleModal() {
    const modal = document.getElementById('admin-role-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleSaveAdminRole(e) {
    e.preventDefault();
    const originalEmail = document.getElementById('edit-role-original-email').value.trim().toLowerCase();
    const name = document.getElementById('role-user-name').value.trim();
    const title = document.getElementById('role-user-title').value.trim() || 'Department Admin';
    const email = document.getElementById('role-user-email').value.trim().toLowerCase();

    const portals = [];
    if (document.getElementById('perm-library').checked) portals.push('library');
    if (document.getElementById('perm-music').checked) portals.push('music');
    if (document.getElementById('perm-testimonies').checked) portals.push('testimonies');
    if (document.getElementById('perm-superadmin').checked) {
        portals.push('superadmin');
        if (!portals.includes('library')) portals.push('library');
        if (!portals.includes('music')) portals.push('music');
        if (!portals.includes('testimonies')) portals.push('testimonies');
    }

    if (portals.length === 0) {
        showToast('Please select at least one admin portal to assign.');
        return;
    }

    const newRecord = {
        email,
        name,
        title,
        portals,
        status: 'active',
        isMaster: email === SUPERADMIN_MASTER_EMAIL.toLowerCase(),
        updatedAt: new Date().toISOString()
    };

    if (originalEmail) {
        const idx = rolesRegistry.findIndex(r => r.email.toLowerCase() === originalEmail);
        if (idx > -1) {
            newRecord.status = rolesRegistry[idx].status || 'active';
            rolesRegistry[idx] = newRecord;
        } else {
            rolesRegistry.push(newRecord);
        }
    } else {
        const existingIdx = rolesRegistry.findIndex(r => r.email.toLowerCase() === email);
        if (existingIdx > -1) {
            rolesRegistry[existingIdx] = newRecord;
        } else {
            rolesRegistry.push(newRecord);
        }
    }

    closeAdminRoleModal();
    await persistRolesRegistry();
    showToast(`Permissions saved for ${name} (${email})!`);
}

function promptRevokeRole(email) {
    if (email.toLowerCase() === SUPERADMIN_MASTER_EMAIL.toLowerCase()) return;
    revokeTargetEmail = email;
    document.getElementById('confirm-title').innerText = `Revoke Access for ${email}?`;
    document.getElementById('confirm-text').innerText = 'This account will immediately lose access to all Accord admin portals.';

    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    document.getElementById('confirm-btn').onclick = async function () {
        rolesRegistry = rolesRegistry.filter(r => r.email.toLowerCase() !== revokeTargetEmail.toLowerCase());
        closeConfirmModal();
        await persistRolesRegistry();
        showToast(`Admin access revoked for ${revokeTargetEmail}.`);
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    revokeTargetEmail = null;
}

function exportRolesToExcel() {
    const rows = rolesRegistry.map(r => ({
        Name: r.name || '',
        Email: r.email || '',
        Title: r.title || '',
        Library_Admin: (r.portals || []).includes('library') || r.isMaster ? 'YES' : 'NO',
        Music_Admin: (r.portals || []).includes('music') || r.isMaster ? 'YES' : 'NO',
        Testimonies_Admin: (r.portals || []).includes('testimonies') || r.isMaster ? 'YES' : 'NO',
        Superadmin: (r.portals || []).includes('superadmin') || r.isMaster ? 'YES' : 'NO',
        Status: (r.status || 'active').toUpperCase(),
        Last_Updated: r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Accord_Admin_Access');
    XLSX.writeFile(workbook, 'Accord_Admin_Access_Registry.xlsx');
    showToast('Exported Admin Access Registry to Excel!');
}

// ==========================================
// PAID PROMOTIONS, SITE BANNERS & AD CREATOR
// ==========================================

const SITE_BANNER_LOCATIONS = [
    { key: 'all', label: 'Every Main Page', page: 'All 12 pages', icon: 'fa-globe' },
    { key: 'library', label: 'Library', page: 'index.html', icon: 'fa-book-open' },
    { key: 'feed', label: 'Fellowship Feed', page: 'feed.html', icon: 'fa-comments' },
    { key: 'music', label: 'Music Hub', page: 'music.html', icon: 'fa-music' },
    { key: 'book', label: 'Book Detail', page: 'book.html', icon: 'fa-book' },
    { key: 'post', label: 'Post Detail', page: 'post.html', icon: 'fa-newspaper' },
    { key: 'author', label: 'Author Studio', page: 'author.html', icon: 'fa-feather-pointed' },
    { key: 'artist', label: 'Artist Hub', page: 'artist.html', icon: 'fa-microphone-lines' },
    { key: 'ministry', label: 'Ministry Page', page: 'ministry.html', icon: 'fa-church' },
    { key: 'polls', label: 'Polls & Awards', page: 'polls.html', icon: 'fa-square-poll-vertical' },
    { key: 'saved', label: 'Saved Library', page: 'saved.html', icon: 'fa-bookmark' },
    { key: 'user', label: 'User Profile', page: 'user.html', icon: 'fa-user' }
];

let cachedSuperadminPromos = [];
let currentAdFilter = 'all';
let currentLocationFilter = 'all_filter';
let cachedLibraryLayoutRow = null;

function getPromoSlotPositionMeta(promo) {
    const raw = String(promo?.slot_position || '').trim().toLowerCase();
    if (raw === 'top' || raw === 'mid' || raw === 'bottom' || raw === 'dynamic') return raw;
    const notes = String(promo?.admin_notes || '');
    const m = notes.match(/\[slot:(top|mid|bottom|dynamic)\]/i);
    return m ? m[1].toLowerCase() : 'dynamic';
}

function setSuperadminAdFilter(filterKey) {
    currentAdFilter = filterKey || 'all';
    document.querySelectorAll('.ad-filter-btn').forEach(btn => {
        const active = btn.getAttribute('data-ad-filter') === currentAdFilter;
        btn.className = active
            ? 'ad-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-bold bg-accord-blue text-white'
            : 'ad-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white text-accord-slate border border-slate-200 hover:bg-slate-50';
    });
    renderSuperadminPromotionsList();
}

function setSuperadminLocationFilter(locKey) {
    currentLocationFilter = (currentLocationFilter === locKey && locKey !== 'all_filter') ? 'all_filter' : (locKey || 'all_filter');
    const clearBtn = document.getElementById('clear-location-filter-btn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', currentLocationFilter === 'all_filter');
    }
    renderSuperadminBannerLocations();
    renderSuperadminPromotionsList();
}

function renderSuperadminBannerLocations() {
    const grid = document.getElementById('superadmin-banner-locations');
    if (!grid) return;

    const nowIso = new Date().toISOString();
    const liveBanners = cachedSuperadminPromos.filter(p => {
        if (p.status !== 'approved') return false;
        if (p.starts_at && p.starts_at > nowIso) return false;
        if (p.ends_at && p.ends_at < nowIso) return false;
        return true;
    });

    grid.innerHTML = SITE_BANNER_LOCATIONS.map(loc => {
        const count = liveBanners.filter(p => {
            const placements = Array.isArray(p.placements) && p.placements.length > 0
                ? p.placements.map(x => String(x).toLowerCase())
                : ['all'];
            if (loc.key === 'all') return placements.includes('all');
            return placements.includes('all') || placements.includes(loc.key);
        }).length;

        const isSelected = currentLocationFilter === loc.key;
        const cardClass = isSelected
            ? 'border-accord-blue bg-accord-lightBlue/60 ring-2 ring-accord-blue/20'
            : 'border-slate-200 bg-slate-50/60 hover:border-accord-blue/50 hover:bg-white';

        return `
            <button type="button" onclick="setSuperadminLocationFilter('${loc.key}')" class="text-left rounded-xl border p-2.5 transition-all ${cardClass}">
                <div class="flex items-center justify-between gap-1">
                    <i class="fa-solid ${loc.icon} text-[11px] ${isSelected ? 'text-accord-blue' : 'text-accord-muted'}"></i>
                    <span class="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">${count} live</span>
                </div>
                <p class="text-xs font-bold text-accord-slate mt-1.5 truncate">${escapeSuperHtml(loc.label)}</p>
                <p class="text-[10px] text-accord-muted truncate">${escapeSuperHtml(loc.page)}</p>
            </button>
        `;
    }).join('');
}

async function loadSuperadminPromotions() {
    const listEl = document.getElementById('superadmin-promotions-list');
    const geoEl = document.getElementById('audience-geo-summary');
    const badgeEl = document.getElementById('pending-promotions-badge');
    if (!listEl) return;

    const [promosRes, signalsRes, layoutRes] = await Promise.all([
        supabaseClient.from('promotions').select('*').order('created_at', { ascending: false }).limit(100),
        supabaseClient.from('user_audience_signals').select('country, device_type').order('created_at', { ascending: false }).limit(500),
        supabaseClient.from('books').select('id, description').eq('title', '__ACCORD_LAYOUT_CONFIG__').limit(1).maybeSingle()
    ]);

    if (geoEl && !signalsRes.error && Array.isArray(signalsRes.data)) {
        const counts = {};
        signalsRes.data.forEach(s => {
            const c = s.country || 'GLOBAL';
            counts[c] = (counts[c] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
        geoEl.innerHTML = top.map(([country, count]) => `
            <div class="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                <p class="text-[10px] font-bold uppercase tracking-wider text-accord-muted">Audience Region</p>
                <p class="text-base font-extrabold text-accord-slate mt-0.5">${escapeSuperHtml(country)}</p>
                <p class="text-[11px] text-accord-blue font-semibold">${count} sessions</p>
            </div>
        `).join('');
    }

    cachedLibraryLayoutRow = layoutRes?.data || null;
    renderSuperadminLibraryBanners();

    if (promosRes.error) {
        listEl.innerHTML = `<p class="text-xs text-red-600 py-6 text-center bg-white border border-slate-200 rounded-2xl">Could not load promotions: ${escapeSuperHtml(promosRes.error.message)}</p>`;
        return;
    }

    cachedSuperadminPromos = promosRes.data || [];
    const pendingCount = cachedSuperadminPromos.filter(p => p.status === 'pending_approval').length;
    if (badgeEl) badgeEl.textContent = `${pendingCount} Pending`;
    const tabBadge = document.getElementById('tab-badge-promotions');
    if (tabBadge) {
        tabBadge.textContent = pendingCount;
        tabBadge.classList.toggle('hidden', pendingCount === 0);
    }
    const overviewCount = document.getElementById('overview-pending-promotions');
    if (overviewCount) overviewCount.textContent = pendingCount;

    renderSuperadminBannerLocations();
    renderSuperadminPromotionsList();
}

function renderSuperadminPromotionsList() {
    const listEl = document.getElementById('superadmin-promotions-list');
    if (!listEl) return;

    const filtered = cachedSuperadminPromos.filter(p => {
        if (currentAdFilter === 'banner' && p.promo_type !== 'banner') return false;
        if (currentAdFilter === 'approved' && p.status !== 'approved') return false;
        if (currentAdFilter === 'pending_approval' && p.status !== 'pending_approval') return false;
        if (currentAdFilter === 'paused' && p.status !== 'paused' && p.status !== 'rejected' && p.status !== 'expired') return false;

        if (currentLocationFilter !== 'all_filter') {
            const placements = Array.isArray(p.placements) && p.placements.length > 0
                ? p.placements.map(x => String(x).toLowerCase())
                : ['all'];
            if (currentLocationFilter === 'all') {
                if (!placements.includes('all')) return false;
            } else if (!placements.includes('all') && !placements.includes(currentLocationFilter)) {
                return false;
            }
        }
        return true;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-6 text-center bg-white border border-slate-200 rounded-2xl">No banners or ads match the current filter. Click <strong>Create Banner / Ad</strong> above to publish one.</p>`;
        return;
    }

    listEl.innerHTML = filtered.map(p => {
        const badgeClass = p.status === 'approved'
            ? 'bg-emerald-50 text-emerald-700'
            : p.status === 'pending_approval'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-600';

        const slotPos = getPromoSlotPositionMeta(p);
        const slotLabels = { dynamic: 'Dynamic Auto', top: 'Top Slot', mid: 'Mid-Page', bottom: 'Bottom Slot' };
        const placements = Array.isArray(p.placements) && p.placements.length > 0 ? p.placements : ['all'];
        const thumbUrl = p.desktop_image_url || p.mobile_image_url || '';
        const views = Number(p.impressions_count || 0);
        const clicks = Number(p.clicks_count || 0);
        const ctr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0.0';
        const dailyUsd = Number(p.daily_budget_usd || 0) || (Number(p.budget_amount || 0) > 0 ? Number(p.budget_amount) / Math.max(1, Number(p.duration_days || 1)) : 0);
        const priorityBadge = dailyUsd > 0 ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">$${dailyUsd.toFixed(2)}/day</span>` : '';
        const scheduleLabel = p.ends_at
            ? `Ends ${new Date(p.ends_at).toLocaleDateString()}`
            : (p.duration_days === 0 ? 'Always Live' : `${p.duration_days || 7}d`);

        return `
            <div class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
                <div class="flex items-start gap-3.5 min-w-0 flex-1">
                    ${thumbUrl
                        ? `<img src="${escapeSuperHtml(thumbUrl)}" alt="${p.promo_type === 'banner' ? 'Banner ad' : escapeSuperHtml(p.title)}" class="w-24 h-16 object-cover rounded-xl border border-slate-200 shrink-0 bg-slate-100">`
                        : `<div class="w-24 h-16 rounded-xl bg-gradient-to-br from-accord-slate to-accord-darkBlue text-white flex items-center justify-center shrink-0 text-[10px] font-bold px-2 text-center">Text Banner</div>`
                    }
                    <div class="space-y-1 min-w-0">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${badgeClass}">${escapeSuperHtml((p.status || '').replace('_', ' '))}</span>
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-accord-lightBlue text-accord-blue uppercase">${escapeSuperHtml(p.promo_type)}</span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700">${escapeSuperHtml(slotLabels[slotPos] || 'Dynamic Auto')}</span>
                            ${priorityBadge}
                            <span class="text-[11px] font-semibold text-accord-muted">${escapeSuperHtml(scheduleLabel)}</span>
                        </div>
                        ${p.promo_type === 'banner'
                            ? `<p class="text-xs font-semibold text-accord-slate truncate">${escapeSuperHtml(p.body || p.cta_url || 'Display Banner')}</p>`
                            : `<h3 class="text-sm font-bold text-accord-slate truncate">${escapeSuperHtml((p.title || '').trim() || p.body || p.cta_url || (p.promo_type === 'book' ? 'Promoted Book' : 'Promoted Post'))}</h3>`
                        }
                        <p class="text-[11px] text-accord-muted">Locations: <strong class="text-accord-slate">${escapeSuperHtml(placements.join(', '))}</strong> • Countries: ${escapeSuperHtml((p.target_countries || ['GLOBAL']).join(', '))}</p>
                        <p class="text-[11px] text-slate-600">By ${escapeSuperHtml(p.advertiser_name || 'Superadmin')} • Views: <strong>${views}</strong> • Clicks: <strong>${clicks}</strong> (${ctr}% CTR)</p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <button type="button" onclick="openSuperadminAdModal('${p.id}')" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-xs font-bold">Edit</button>
                    ${p.status !== 'approved'
                        ? `<button type="button" onclick="reviewSuperadminPromotion('${p.id}', 'approved', ${p.duration_days || 0})" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">Go Live</button>`
                        : `<button type="button" onclick="reviewSuperadminPromotion('${p.id}', 'paused', ${p.duration_days || 0})" class="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold">Pause</button>`
                    }
                    ${p.status === 'pending_approval' ? `<button type="button" onclick="reviewSuperadminPromotion('${p.id}', 'rejected', ${p.duration_days || 7})" class="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold">Reject</button>` : ''}
                    <button type="button" onclick="deleteSuperadminPromotion('${p.id}')" class="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold" title="Delete Ad"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function renderSuperadminLibraryBanners() {
    const container = document.getElementById('superadmin-library-banners-list');
    if (!container) return;

    if (!cachedLibraryLayoutRow?.description) {
        container.innerHTML = `<p class="text-xs text-accord-muted">No legacy Library slider config found. Dynamic banners above will appear on Library (<code>index.html</code>) automatically.</p>`;
        return;
    }

    let parsed = {};
    try {
        parsed = JSON.parse(cachedLibraryLayoutRow.description);
    } catch (_) {
        container.innerHTML = `<p class="text-xs text-accord-muted">Could not parse Library slider config.</p>`;
        return;
    }

    const bannerCfg = parsed.banner || {};
    const slides = Array.isArray(bannerCfg.slides) ? bannerCfg.slides : [];
    const isEnabled = bannerCfg.enabled !== false;

    const toggleHtml = `
        <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 mb-2">
            <div class="text-xs">
                <span class="font-bold text-accord-slate">Library Mid-Grid Slider Status:</span>
                <span class="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">${isEnabled ? 'Enabled' : 'Disabled'}</span>
                <span class="text-accord-muted ml-2">(${slides.length} slide${slides.length === 1 ? '' : 's'})</span>
            </div>
            <button type="button" onclick="toggleLibrarySliderEnabled(${!isEnabled})" class="px-3 py-1.5 rounded-lg text-[11px] font-bold ${isEnabled ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'}">
                ${isEnabled ? 'Disable Legacy Slider' : 'Enable Legacy Slider'}
            </button>
        </div>
    `;

    if (slides.length === 0) {
        container.innerHTML = toggleHtml + `<p class="text-xs text-accord-muted">No custom slides uploaded in Library Admin.</p>`;
        return;
    }

    container.innerHTML = toggleHtml + slides.map((s, idx) => `
        <div class="flex items-center justify-between gap-3 border border-slate-200 rounded-xl p-2.5 text-xs">
            <div class="flex items-center gap-3 min-w-0">
                ${s.desktopUrl || s.mobileUrl ? `<img src="${escapeSuperHtml(s.desktopUrl || s.mobileUrl)}" alt="${escapeSuperHtml(s.alt || 'Slide')}" class="w-16 h-10 object-cover rounded-lg border border-slate-200 shrink-0">` : ''}
                <div class="min-w-0">
                    <p class="font-bold text-accord-slate truncate">${escapeSuperHtml(s.alt || `Slide ${idx + 1}`)}</p>
                    <p class="text-[11px] text-accord-muted truncate">Location: Library (<code>index.html #mid-grid-banner</code>) • Action: ${escapeSuperHtml(s.actionType || 'link')} ${s.linkUrl ? `(${escapeSuperHtml(s.linkUrl)})` : ''}</p>
                </div>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${s.enabled !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${s.enabled !== false ? 'Active' : 'Hidden'}</span>
        </div>
    `).join('');
}

async function toggleLibrarySliderEnabled(enable) {
    if (!cachedLibraryLayoutRow) return;
    try {
        const parsed = JSON.parse(cachedLibraryLayoutRow.description || '{}');
        if (!parsed.banner) parsed.banner = {};
        parsed.banner.enabled = Boolean(enable);
        const { error } = await supabaseClient
            .from('books')
            .update({ description: JSON.stringify(parsed) })
            .eq('id', cachedLibraryLayoutRow.id);
        if (error) throw error;
        showToast(`Library legacy slider ${enable ? 'enabled' : 'disabled'}.`);
        loadSuperadminPromotions();
    } catch (err) {
        showToast(`Could not update library slider: ${err.message}`, true);
    }
}

function toggleSuperadminAllPlacements(allCheckbox) {
    const isAll = allCheckbox.checked;
    document.querySelectorAll('#superadmin-ad-placements-grid input[name="superadmin-ad-placement"]').forEach(cb => {
        if (isAll) cb.checked = false;
    });
}

function syncSuperadminSpecificPlacement() {
    const anySpecific = Array.from(document.querySelectorAll('#superadmin-ad-placements-grid input[name="superadmin-ad-placement"]')).some(cb => cb.checked);
    const allCb = document.getElementById('superadmin-ad-place-all');
    if (allCb) {
        allCb.checked = !anySpecific;
    }
}

function updateSuperadminAdImagePreview(variant) {
    const urlInput = document.getElementById(`superadmin-ad-${variant}-url`);
    const previewEl = document.getElementById(`superadmin-ad-${variant}-preview`);
    if (!urlInput || !previewEl) return;
    const url = urlInput.value.trim();
    if (!url) {
        previewEl.classList.add('hidden');
        previewEl.innerHTML = '';
        return;
    }
    previewEl.innerHTML = `<img src="${escapeSuperHtml(url)}" alt="${variant} preview" class="w-full h-24 object-cover">`;
    previewEl.classList.remove('hidden');
}

async function handleSuperadminAdImageUpload(input, variant) {
    const file = input?.files?.[0];
    if (!file) return;
    try {
        showToast(`Uploading ${variant} banner image...`);
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const fileName = `banners/superadmin_${variant}_${Date.now()}.${ext}`;
        const { data, error } = await supabaseClient.storage
            .from('archive-files')
            .upload(fileName, file, {
                contentType: file.type || 'image/png',
                cacheControl: '3600',
                upsert: false
            });
        if (error) throw error;
        const { data: pubData } = supabaseClient.storage
            .from('archive-files')
            .getPublicUrl(data.path);
        const urlInput = document.getElementById(`superadmin-ad-${variant}-url`);
        if (urlInput && pubData?.publicUrl) {
            urlInput.value = pubData.publicUrl;
            updateSuperadminAdImagePreview(variant);
            showToast(`${variant} image uploaded!`);
        }
    } catch (err) {
        showToast(`Image upload failed: ${err.message}`, true);
    }
}

function handleSuperadminAdTypeChange() {
    const type = document.getElementById('superadmin-ad-type')?.value || 'banner';
    const isBanner = type === 'banner';
    const titleWrap = document.getElementById('superadmin-ad-title-wrap');
    const titleInput = document.getElementById('superadmin-ad-title');
    if (titleWrap) titleWrap.classList.toggle('hidden', isBanner);
    if (titleInput) {
        titleInput.required = !isBanner;
        if (isBanner) titleInput.value = '';
    }
}

function openSuperadminAdModal(promoId = null) {
    const modal = document.getElementById('superadmin-ad-modal');
    const form = document.getElementById('superadmin-ad-form');
    if (!modal || !form) return;
    form.reset();

    const promo = promoId ? cachedSuperadminPromos.find(p => p.id === promoId) : null;
    document.getElementById('superadmin-ad-id').value = promo ? promo.id : '';
    document.getElementById('superadmin-ad-modal-title').textContent = promo ? 'Edit Site Banner / Ad' : 'Create Site Banner / Ad';
    document.getElementById('superadmin-ad-type').value = promo?.promo_type || 'banner';
    document.getElementById('superadmin-ad-slot-position').value = promo ? getPromoSlotPositionMeta(promo) : 'dynamic';
    document.getElementById('superadmin-ad-title').value = promo?.title || '';
    document.getElementById('superadmin-ad-body').value = promo?.body || '';
    document.getElementById('superadmin-ad-desktop-url').value = promo?.desktop_image_url || '';
    document.getElementById('superadmin-ad-mobile-url').value = promo?.mobile_image_url || '';
    document.getElementById('superadmin-ad-cta-text').value = promo?.cta_text || 'Learn More';
    document.getElementById('superadmin-ad-cta-url').value = promo?.cta_url || '';
    document.getElementById('superadmin-ad-countries').value = (promo?.target_countries && promo.target_countries.length > 0)
        ? promo.target_countries.join(', ')
        : 'GLOBAL';
    document.getElementById('superadmin-ad-duration').value = promo ? String(promo.duration_days ?? 30) : '30';
    document.getElementById('superadmin-ad-status').value = promo?.status === 'paused' ? 'paused' : 'approved';

    const placements = Array.isArray(promo?.placements) && promo.placements.length > 0 ? promo.placements : ['all'];
    const allCb = document.getElementById('superadmin-ad-place-all');
    if (allCb) allCb.checked = placements.includes('all');
    document.querySelectorAll('#superadmin-ad-placements-grid input[name="superadmin-ad-placement"]').forEach(cb => {
        cb.checked = !placements.includes('all') && placements.includes(cb.value);
    });

    updateSuperadminAdImagePreview('desktop');
    updateSuperadminAdImagePreview('mobile');
    handleSuperadminAdTypeChange();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSuperadminAdModal() {
    const modal = document.getElementById('superadmin-ad-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function handleSuperadminAdSubmit(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('superadmin-ad-submit-btn');
    const editId = document.getElementById('superadmin-ad-id').value.trim();
    const promoType = document.getElementById('superadmin-ad-type').value;
    const isBanner = promoType === 'banner';
    const slotPosition = document.getElementById('superadmin-ad-slot-position').value || 'dynamic';
    const title = isBanner ? '' : document.getElementById('superadmin-ad-title').value.trim();
    const body = document.getElementById('superadmin-ad-body').value.trim() || null;
    const desktopUrl = document.getElementById('superadmin-ad-desktop-url').value.trim() || null;
    const mobileUrl = document.getElementById('superadmin-ad-mobile-url').value.trim() || null;
    const ctaText = document.getElementById('superadmin-ad-cta-text').value.trim() || 'Learn More';
    const ctaUrl = document.getElementById('superadmin-ad-cta-url').value.trim() || 'index.html';
    const countriesRaw = document.getElementById('superadmin-ad-countries').value.trim() || 'GLOBAL';
    const targetCountries = countriesRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const durationDays = Number(document.getElementById('superadmin-ad-duration').value || 0);
    const status = document.getElementById('superadmin-ad-status').value || 'approved';

    const specificPlacements = Array.from(document.querySelectorAll('#superadmin-ad-placements-grid input[name="superadmin-ad-placement"]:checked')).map(cb => cb.value);
    const allChecked = document.getElementById('superadmin-ad-place-all')?.checked;
    const placements = (allChecked || specificPlacements.length === 0) ? ['all'] : specificPlacements;

    if (!isBanner && !title) {
        showToast('Please enter an ad title.', true);
        return;
    }
    if (isBanner && !desktopUrl && !mobileUrl && !body) {
        showToast('Please upload a banner image or enter short banner text.', true);
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    const now = new Date();
    const endsAt = durationDays > 0 ? new Date(now.getTime() + durationDays * 86400000).toISOString() : null;

    const payload = {
        promo_type: promoType,
        title,
        body,
        desktop_image_url: desktopUrl,
        mobile_image_url: mobileUrl,
        cta_text: ctaText,
        cta_url: ctaUrl,
        placements,
        slot_position: slotPosition,
        target_countries: targetCountries.length > 0 ? targetCountries : ['GLOBAL'],
        duration_days: durationDays,
        status,
        admin_notes: `[slot:${slotPosition}] Created via Superadmin`,
        starts_at: status === 'approved' ? now.toISOString() : null,
        ends_at: status === 'approved' ? endsAt : null
    };

    try {
        let res;
        if (editId) {
            res = await supabaseClient.from('promotions').update(payload).eq('id', editId);
            if (res.error && /slot_position/i.test(res.error.message || '')) {
                const { slot_position: _omit, ...fallbackPayload } = payload;
                res = await supabaseClient.from('promotions').update(fallbackPayload).eq('id', editId);
            }
        } else {
            const insertPayload = {
                ...payload,
                advertiser_id: currentSuperadminUser?.id || null,
                advertiser_name: 'Accord Archive',
                advertiser_email: currentSuperadminUser?.email || SUPERADMIN_MASTER_EMAIL,
                budget_amount: 0,
                currency: 'USD',
                payment_provider: 'superadmin',
                payment_status: 'waived'
            };
            res = await supabaseClient.from('promotions').insert(insertPayload);
            if (res.error && /slot_position/i.test(res.error.message || '')) {
                const { slot_position: _omit, ...fallbackInsert } = insertPayload;
                res = await supabaseClient.from('promotions').insert(fallbackInsert);
            }
        }

        if (res.error) throw res.error;

        closeSuperadminAdModal();
        showToast(editId ? 'Banner / Ad updated!' : 'Banner / Ad created and published!');
        loadSuperadminPromotions();
    } catch (err) {
        showToast(`Could not save ad: ${err.message}`, true);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save & Publish Ad';
        }
    }
}

async function deleteSuperadminPromotion(promoId) {
    if (!promoId || !confirm('Permanently delete this banner / ad?')) return;
    const { error } = await supabaseClient.from('promotions').delete().eq('id', promoId);
    if (error) {
        showToast(`Could not delete ad: ${error.message}. Run the latest SQL migration or use Pause instead.`, true);
        return;
    }
    showToast('Banner / Ad deleted.');
    loadSuperadminPromotions();
}

async function reviewSuperadminPromotion(promoId, newStatus, durationDays = 0) {
    const now = new Date();
    const days = Number(durationDays || 0);
    const ends = days > 0 ? new Date(now.getTime() + days * 86400000).toISOString() : null;
    const updates = {
        status: newStatus,
        reviewed_at: now.toISOString()
    };
    if (newStatus === 'approved') {
        updates.starts_at = now.toISOString();
        updates.ends_at = ends;
    }

    const { error } = await supabaseClient.from('promotions').update(updates).eq('id', promoId);
    if (error) {
        showToast(`Could not update promotion: ${error.message}`, true);
        return;
    }
    showToast(`Promotion marked as ${newStatus}.`);
    loadSuperadminPromotions();
}

async function loadSuperadminWithdrawals() {
    const listEl = document.getElementById('superadmin-withdrawals-list');
    const badgeEl = document.getElementById('pending-withdrawals-badge');
    const tabBadge = document.getElementById('tab-badge-withdrawals');
    const overviewCount = document.getElementById('overview-pending-withdrawals');
    if (!listEl) return;

    const { data, error } = await supabaseClient
        .from('author_withdrawals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Failed to load author withdrawals:', error);
        if (badgeEl) badgeEl.textContent = 'Error';
        listEl.innerHTML = `<p class="text-xs text-red-600 py-6 text-center bg-white border border-red-200 rounded-2xl">Could not load withdrawal requests: ${escapeSuperHtml(error.message)}</p>`;
        return;
    }

    const rows = Array.isArray(data) ? data : [];
    const pendingCount = rows.filter(w => w.status === 'pending').length;
    if (badgeEl) badgeEl.textContent = `${pendingCount} Pending`;
    if (tabBadge) {
        tabBadge.textContent = pendingCount;
        tabBadge.classList.toggle('hidden', pendingCount === 0);
    }
    if (overviewCount) overviewCount.textContent = pendingCount;

    if (rows.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-accord-muted py-8 text-center bg-white border border-slate-200 rounded-2xl">No author withdrawal requests yet.</p>`;
        return;
    }

    const statusOrder = { pending: 0, paid: 1, rejected: 2 };
    const sorted = rows.slice().sort((a, b) => {
        const pa = statusOrder[a.status] ?? 3;
        const pb = statusOrder[b.status] ?? 3;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    listEl.innerHTML = sorted.map(w => {
        const isPending = w.status === 'pending';
        const pillClass = w.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : w.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700';
        const isDelegated = w.requested_by_user_id && w.author_id && String(w.requested_by_user_id) !== String(w.author_id);
        const issuerName = w.requested_by_name || w.author_name || 'Account Owner';
        const issuerHandle = w.requested_by_handle ? ` ${w.requested_by_handle}` : '';
        const issuerEmail = w.requested_by_email || w.author_email || '';
        const issuerText = `${issuerName}${issuerHandle}${issuerEmail ? ` • ${issuerEmail}` : ''}`;
        const createdText = w.created_at ? new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        return `
            <div class="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
                <div class="space-y-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${pillClass}">${escapeSuperHtml(w.status)}</span>
                        <span class="text-sm font-extrabold text-accord-slate">USD ${Number(w.amount || 0).toFixed(2)}</span>
                        ${isDelegated ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-accord-blue border border-blue-200">Issued by Page Admin</span>` : ''}
                        ${createdText ? `<span class="text-[11px] text-accord-muted">${escapeSuperHtml(createdText)}</span>` : ''}
                    </div>
                    <p class="text-xs font-bold text-accord-slate">Page / Author: ${escapeSuperHtml(w.author_name || 'Author')} (${escapeSuperHtml(w.author_email || '')})</p>
                    <p class="text-[11px] font-semibold text-indigo-700">Issued by: ${escapeSuperHtml(issuerText)}</p>
                    <p class="text-[11px] text-accord-muted">${escapeSuperHtml(w.payout_method || '')} • ${escapeSuperHtml(w.payout_details || '')}</p>
                    ${w.paystack_transfer_reference ? `<p class="text-[11px] text-emerald-700 font-mono">Paystack Ref: ${escapeSuperHtml(w.paystack_transfer_reference)}</p>` : ''}
                </div>
                ${isPending ? `
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <button type="button" onclick="triggerPaystackAuthorPayout('${w.id}')" class="px-3.5 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold">Pay via Paystack</button>
                    <button type="button" onclick="updateWithdrawalStatus('${w.id}', 'paid')" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">Mark Paid</button>
                    <button type="button" onclick="updateWithdrawalStatus('${w.id}', 'rejected')" class="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold">Reject</button>
                </div>` : ''}
            </div>
        `;
    }).join('');
}

async function triggerPaystackAuthorPayout(withdrawalId) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const token = session?.access_token;
    if (!token) {
        showToast('Session expired. Please sign in again.', true);
        return;
    }

    const { data: w } = await supabaseClient.from('author_withdrawals').select('*').eq('id', withdrawalId).maybeSingle();
    if (!w) return;

    const resp = await fetch('/api/paystack-payout', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            withdrawalId: w.id,
            amount: w.amount,
            currency: 'GHS',
            recipientType: (w.payout_method || '').toLowerCase().includes('mobile') ? 'mobile_money' : 'nuban',
            accountName: w.account_name || w.author_name,
            accountNumber: w.account_number || '',
            bankCode: w.bank_code || ''
        })
    });
    const resData = await resp.json();
    if (!resp.ok || !resData.success) {
        showToast(resData.error || 'Paystack payout failed.', true);
        return;
    }

    await supabaseClient.from('author_withdrawals').update({
        status: 'paid',
        paystack_recipient_code: resData.recipient_code,
        paystack_transfer_code: resData.transfer_code,
        paystack_transfer_reference: resData.reference
    }).eq('id', w.id);

    showToast('Paystack payout initiated and withdrawal marked paid!');
    loadSuperadminWithdrawals();
}

async function updateWithdrawalStatus(withdrawalId, newStatus) {
    const { error } = await supabaseClient.from('author_withdrawals').update({ status: newStatus }).eq('id', withdrawalId);
    if (error) {
        showToast(`Could not update withdrawal: ${error.message}`, true);
        return;
    }
    showToast(`Withdrawal marked ${newStatus}.`);
    loadSuperadminWithdrawals();
}