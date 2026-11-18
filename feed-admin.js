// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MASTER_ADMIN_EMAIL = 'accordmedia1@gmail.com';
const ROLES_CONFIG_RECORD_NAME = '__ACCORD_ROLES_CONFIG__';

let allTestimonies = [];
let allComments = [];
let currentViewTestimonyId = null;
let deleteTargetId = null;

// ==========================================
// AUTHENTICATION & PERMISSION GATE
// ==========================================

window.onload = async function () {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session?.user?.email) {
        if (await hasTestimoniesAdminPermission(session.user.email)) {
            unlockDashboard(session.user);
        } else {
            await supabaseClient.auth.signOut();
            showLoginError('Access denied. Testimonies Admin permissions required.');
        }
    }
};

async function hasTestimoniesAdminPermission(email) {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    if (clean === MASTER_ADMIN_EMAIL.toLowerCase()) return true;

    // Check Supabase roles registry
    const { data } = await supabaseClient
        .from('books')
        .select('description')
        .eq('title', ROLES_CONFIG_RECORD_NAME)
        .maybeSingle();

    if (data?.description) {
        try {
            const registry = JSON.parse(data.description);
            if (Array.isArray(registry)) {
                const userEntry = registry.find(r => (r.email || '').toLowerCase() === clean);
                if (userEntry && userEntry.status === 'active') {
                    if (userEntry.isMaster || (userEntry.portals || []).includes('superadmin') || (userEntry.portals || []).includes('testimonies')) {
                        return true;
                    }
                }
            }
        } catch (e) {}
    }

    // Fallback to localStorage registry check
    const localSaved = localStorage.getItem('accord_roles_registry');
    if (localSaved) {
        try {
            const registry = JSON.parse(localSaved);
            const userEntry = registry.find(r => (r.email || '').toLowerCase() === clean);
            if (userEntry && userEntry.status === 'active') {
                if (userEntry.isMaster || (userEntry.portals || []).includes('superadmin') || (userEntry.portals || []).includes('testimonies')) {
                    return true;
                }
            }
        } catch (e) {}
    }

    return false;
}

function showLoginError(msg) {
    const errorBox = document.getElementById('login-error');
    if (errorBox) {
        errorBox.innerText = msg;
        errorBox.classList.remove('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorBox.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Verifying Credentials...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.innerText = 'Unlock Testimonies Portal';

    if (error) {
        showLoginError(error.message || 'Invalid email or password.');
        return;
    }

    if (!await hasTestimoniesAdminPermission(data?.user?.email)) {
        await supabaseClient.auth.signOut();
        showLoginError('Access denied. Your account is not authorized for Testimonies Admin.');
        return;
    }

    unlockDashboard(data.user);
    showToast('Welcome to Testimonies & Forum Admin!');
}

function unlockDashboard(user) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('dashboard-wrapper').classList.remove('hidden');
    const emailEl = document.getElementById('admin-user-email');
    if (emailEl && user?.email) emailEl.innerText = user.email;

    fetchTestimoniesAndComments();
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    document.getElementById('dashboard-wrapper').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('login-form').reset();
    showToast('Signed out successfully.');
}

// ==========================================
// DATA FETCHING & RENDERING
// ==========================================

async function fetchTestimoniesAndComments() {
    const [testRes, commRes] = await Promise.all([
        supabaseClient.from('testimonies').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('testimony_comments').select('*').order('created_at', { ascending: false })
    ]);

    if (!testRes.error && testRes.data) {
        allTestimonies = testRes.data;
    } else {
        allTestimonies = [];
    }

    if (!commRes.error && commRes.data) {
        allComments = commRes.data;
    } else {
        allComments = [];
    }

    updateMetrics();
    renderTestimoniesTable();
}

function updateMetrics() {
    const total = allTestimonies.length;
    const published = allTestimonies.filter(t => t.is_visible !== false).length;
    const totalComments = allComments.length;

    document.getElementById('stat-total-testimonies').innerText = total;
    document.getElementById('stat-published-testimonies').innerText = published;
    document.getElementById('stat-total-comments').innerText = totalComments;
    document.getElementById('stat-compilation-ready').innerText = published;
}

function renderTestimoniesTable() {
    const tbody = document.getElementById('testimonies-table-body');
    if (!tbody) return;

    const query = (document.getElementById('testimony-search')?.value || '').toLowerCase().trim();
    const filter = document.getElementById('testimony-filter')?.value || 'all';

    let filtered = allTestimonies.filter(t => {
        const matchesQuery = (t.title || '').toLowerCase().includes(query) ||
                             (t.author || '').toLowerCase().includes(query) ||
                             (t.content || '').toLowerCase().includes(query) ||
                             (t.category || '').toLowerCase().includes(query);

        if (!matchesQuery) return false;

        if (filter === 'published') return t.is_visible !== false;
        if (filter === 'hidden') return t.is_visible === false;
        return true;
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-accord-muted">No testimonies found matching your search or filter.</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        const isVisible = item.is_visible !== false;
        const commentCount = allComments.filter(c => c.testimony_id === item.id).length;
        const safeId = item.id;
        const author = item.author || 'Anonymous';
        const title = item.title || 'Untitled Testimony';
        const category = item.category || 'Faith & Grace';
        const contentSnippet = (item.content || '').substring(0, 90) + ((item.content || '').length > 90 ? '...' : '');

        const statusBadge = isVisible
            ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Published</span>`
            : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Hidden</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div class="flex items-center space-x-3">
                    <div class="w-9 h-9 rounded-xl bg-amber-50 text-accord-gold font-bold flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid fa-quote-left"></i>
                    </div>
                    <div>
                        <p class="font-bold text-accord-slate">${escapeHTML(title)}</p>
                        <p class="text-[11px] text-accord-muted">By ${escapeHTML(author)}</p>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6">
                <span class="bg-slate-100 text-accord-slate text-[10px] font-bold px-2.5 py-1 rounded-lg">${escapeHTML(category)}</span>
            </td>
            <td class="py-4 px-6 text-accord-muted max-w-xs truncate">${escapeHTML(contentSnippet)}</td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${commentCount}</td>
            <td class="py-4 px-6 text-center">${statusBadge}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                <button type="button" onclick="openViewModal('${safeId}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="View & Moderate">
                    <i class="fa-solid fa-eye text-xs"></i>
                </button>
                <button type="button" onclick="toggleTestimonyVisibility('${safeId}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-amber-50 text-slate-600 hover:text-amber-600 transition-all inline-flex items-center justify-center" title="${isVisible ? 'Hide Testimony' : 'Publish Testimony'}">
                    <i class="fa-solid ${isVisible ? 'fa-eye-slash' : 'fa-eye'} text-xs"></i>
                </button>
                <button type="button" onclick="promptDeleteTestimony('${safeId}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete Testimony">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// MODAL & MODERATION ACTIONS
// ==========================================

async function openViewModal(id) {
    const item = allTestimonies.find(t => t.id === id);
    if (!item) return;

    currentViewTestimonyId = id;
    const isVisible = item.is_visible !== false;

    document.getElementById('modal-title').innerText = item.title || 'Untitled Testimony';
    document.getElementById('modal-author').innerText = item.author || 'Anonymous';
    document.getElementById('modal-date').innerText = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
    document.getElementById('modal-category-badge').innerText = item.category || 'Faith & Grace';
    document.getElementById('modal-content').innerText = item.content || '';

    const statusBadge = document.getElementById('modal-status');
    statusBadge.innerText = isVisible ? 'Published' : 'Hidden';
    statusBadge.className = isVisible 
        ? 'px-2.5 py-1 rounded-full font-bold text-[10px] bg-emerald-50 text-emerald-700' 
        : 'px-2.5 py-1 rounded-full font-bold text-[10px] bg-amber-50 text-amber-700';

    const toggleBtn = document.getElementById('modal-toggle-status-btn');
    toggleBtn.innerText = isVisible ? 'Hide / Unpublish' : 'Publish Testimony';
    toggleBtn.className = isVisible 
        ? 'px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition-all' 
        : 'px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all';

    // Load comments for this testimony
    const commentsContainer = document.getElementById('modal-comments-list');
    const matchedComments = allComments.filter(c => c.testimony_id === id);
    document.getElementById('modal-comment-count').innerText = matchedComments.length;

    commentsContainer.innerHTML = '';
    if (matchedComments.length === 0) {
        commentsContainer.innerHTML = `<p class="text-xs text-accord-muted italic py-2">No reader comments on this testimony yet.</p>`;
    } else {
        matchedComments.forEach(c => {
            const div = document.createElement('div');
            div.className = "bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-start justify-between gap-3 text-xs";
            div.innerHTML = `
                <div>
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-accord-slate">${escapeHTML(c.author || 'Reader')}</span>
                        <span class="text-[10px] text-accord-muted">• ${new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                    <p class="text-accord-muted mt-1">${escapeHTML(c.content || '')}</p>
                </div>
                <button type="button" onclick="deleteComment('${c.id}')" class="text-slate-400 hover:text-red-500 p-1 transition-colors" title="Delete Comment">
                    <i class="fa-solid fa-trash text-[11px]"></i>
                </button>
            `;
            commentsContainer.appendChild(div);
        });
    }

    const modal = document.getElementById('view-testimony-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeViewModal() {
    const modal = document.getElementById('view-testimony-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    currentViewTestimonyId = null;
}

async function toggleCurrentModalStatus() {
    if (!currentViewTestimonyId) return;
    await toggleTestimonyVisibility(currentViewTestimonyId);
    openViewModal(currentViewTestimonyId);
}

async function toggleTestimonyVisibility(id) {
    const item = allTestimonies.find(t => t.id === id);
    if (!item) return;

    const newVisibility = item.is_visible === false ? true : false;

    const { error } = await supabaseClient
        .from('testimonies')
        .update({ is_visible: newVisibility })
        .eq('id', id);

    if (error) {
        showToast('Error updating testimony status.');
        return;
    }

    item.is_visible = newVisibility;
    renderTestimoniesTable();
    updateMetrics();
    showToast(newVisibility ? 'Testimony published successfully.' : 'Testimony hidden from public.');
}

function promptDeleteTestimony(id) {
    deleteTargetId = id;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    document.getElementById('confirm-btn').onclick = async function () {
        await executeDeleteTestimony(deleteTargetId);
        closeConfirmModal();
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    deleteTargetId = null;
}

async function executeDeleteTestimony(id) {
    // Delete associated comments first
    await supabaseClient.from('testimony_comments').delete().eq('testimony_id', id);

    const { error } = await supabaseClient.from('testimonies').delete().eq('id', id);

    if (error) {
        showToast('Error deleting testimony.');
        return;
    }

    allTestimonies = allTestimonies.filter(t => t.id !== id);
    allComments = allComments.filter(c => c.testimony_id !== id);
    renderTestimoniesTable();
    updateMetrics();
    showToast('Testimony and comments deleted permanently.');
    if (currentViewTestimonyId === id) closeViewModal();
}

async function deleteComment(commentId) {
    const { error } = await supabaseClient.from('testimony_comments').delete().eq('id', commentId);
    if (error) {
        showToast('Error deleting comment.');
        return;
    }

    allComments = allComments.filter(c => c.id !== commentId);
    updateMetrics();
    showToast('Comment deleted.');
    if (currentViewTestimonyId) openViewModal(currentViewTestimonyId);
}

// ==========================================
// EXPORT TO EXCEL (BOOK COMPILATION)
// ==========================================

function exportTestimoniesToExcel() {
    const publishedOnly = allTestimonies.filter(t => t.is_visible !== false);
    const rows = publishedOnly.map((t, idx) => ({
        No: idx + 1,
        Title: t.title || '',
        Author: t.author || 'Anonymous',
        Category: t.category || 'Faith & Grace',
        Full_Story: t.content || '',
        Date_Submitted: t.created_at ? new Date(t.created_at).toLocaleDateString() : ''
    }));

    if (rows.length === 0) {
        showToast('No published testimonies available to export.');
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Book_Compilation_Testimonies');
    XLSX.writeFile(workbook, 'Accord_Testimonies_Book_Compilation.xlsx');
    showToast('Exported published testimonies for book compilation!');
}

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}