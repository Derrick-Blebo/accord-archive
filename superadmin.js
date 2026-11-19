// ==========================================
// ACCORD SUPERADMIN COMMAND CENTER
// ==========================================

let rolesRegistry = getDefaultRolesRegistry();
let ministryUpgradeRequests = [];
let revokeTargetEmail = null;

function getDefaultRolesRegistry() {
    return [
        {
            email: MASTER_ADMIN_EMAIL,
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
    if (clean === MASTER_ADMIN_EMAIL.toLowerCase()) return true;

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

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.innerText = 'Unlock Superadmin Command Center';

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
}

function unlockSuperadminDashboard(user) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('dashboard-wrapper').classList.remove('hidden');
    const emailEl = document.getElementById('superadmin-user-email');
    if (emailEl && user?.email) emailEl.innerText = user.email;

    fetchEcosystemMetrics();
    loadMinistryUpgradeRequests();
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

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, account_type, upgrade_status, upgrade_pitch, upgrade_requested_at')
        .neq('upgrade_status', 'none')
        .order('upgrade_requested_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-red-600">Could not load upgrade requests: ${escapeSuperHtml(error.message)}</td></tr>`;
        return;
    }

    ministryUpgradeRequests = data || [];
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

        let statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-accord-muted">${escapeSuperHtml(status)}</span>`;
        if (status === 'pending') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Pending</span>`;
        } else if (status === 'approved') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Approved</span>`;
        } else if (status === 'rejected') {
            statusPill = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-50 text-red-600">Rejected</span>`;
        }

        const actionsHtml = status === 'pending'
            ? `<button type="button" onclick="approveMinistryUpgrade('${req.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all">Approve</button>
               <button type="button" onclick="rejectMinistryUpgrade('${req.id}')" class="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all">Reject</button>`
            : `<span class="text-[11px] text-accord-muted">${req.account_type === 'ministry_minister' ? 'Ministry / Minister' : 'Normal User'}</span>`;

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0';
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${escapeSuperHtml(req.full_name || 'Member')}</p>
                <p class="text-[11px] text-accord-muted">${escapeSuperHtml(req.email || '')}</p>
            </td>
            <td class="py-4 px-6 max-w-md">
                <p class="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">${escapeSuperHtml(req.upgrade_pitch || '')}</p>
            </td>
            <td class="py-4 px-6 text-center text-accord-muted whitespace-nowrap">${reqDate}</td>
            <td class="py-4 px-6 text-center">${statusPill}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function approveMinistryUpgrade(userId) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({
            account_type: 'ministry_minister',
            upgrade_status: 'approved'
        })
        .eq('id', userId);

    if (error) {
        showToast(`Could not approve upgrade: ${error.message}`);
        return;
    }

    await loadMinistryUpgradeRequests();
    showToast('Account upgraded to Ministry / Minister.');
}

async function rejectMinistryUpgrade(userId) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({
            account_type: 'normal_user',
            upgrade_status: 'rejected'
        })
        .eq('id', userId);

    if (error) {
        showToast(`Could not reject upgrade: ${error.message}`);
        return;
    }

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
    const masterIdx = list.findIndex(r => (r.email || '').toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase());
    const masterRecord = {
        email: MASTER_ADMIN_EMAIL,
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
        const isMaster = item.isMaster || item.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();
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
    if (clean === MASTER_ADMIN_EMAIL.toLowerCase()) return;

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
    if (clean === MASTER_ADMIN_EMAIL.toLowerCase()) return;

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
        isMaster: email === MASTER_ADMIN_EMAIL.toLowerCase(),
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
    if (email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) return;
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