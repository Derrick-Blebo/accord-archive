// =========================================================
// ACCORD ADMIN.JS
// Core Auth, Fast Parallel Fetching, Shelves, Multi-Banner Slider,
// Bulk Excel, Categories, Catalog CRUD, User Books, Trash & Forum Mod
// =========================================================

const ADMIN_EMAIL = 'accordmedia1@gmail.com';

let catalogData = [];
let trashData = [];
let submissionsData = [];
let userBookSubmissionsData = [];
let categoriesData = [];
let purchasesData = [];
let testimoniesModData = [];
let commentsModData = [];
let parsedExcelRows = [];
let deleteTargetId = null;
let currentCompressedCover = "";
let currentBannerDesktopCompressed = "";
let currentBannerMobileCompressed = "";
let autoRefreshIntervalId = null;
let activeAdminTab = 'catalog';

// Home Page Shelves & Banner State (Synced via Supabase + localStorage fallback)
let homeLayoutConfig = getDefaultHomeLayoutConfig();
let selectedShelfBookIds = new Set();

function getDefaultHomeLayoutConfig() {
    return {
        shelves: [
            {
                id: 'shelf_special_picks',
                title: 'Accord Special Picks',
                subtitle: 'Foundational Christian classics & ministry landmarks',
                mode: 'recommended',
                category: '',
                limit: 10,
                bookIds: [],
                enabled: true
            },
            {
                id: 'shelf_most_popular',
                title: 'Most Popular Publications',
                subtitle: 'Most downloaded and read across the Accord library',
                mode: 'popular',
                category: '',
                limit: 10,
                bookIds: [],
                enabled: true
            },
            {
                id: 'shelf_new_additions',
                title: 'New Additions to the Archive',
                subtitle: 'Recently cataloged manuscripts, biographies, and devotionals',
                mode: 'newest',
                category: '',
                limit: 10,
                bookIds: [],
                enabled: true
            },
            {
                id: 'shelf_recommended',
                title: 'Recommended for You',
                subtitle: 'Essential readings on prayer, spiritual awakening, and leadership',
                mode: 'category',
                category: 'Prayer & Devotion',
                limit: 10,
                bookIds: [],
                enabled: true
            }
        ],
        banner: {
            enabled: true,
            afterCount: 6,
            intervalSeconds: 5,
            slides: [],
            badge: 'ACCORD HERITAGE INITIATIVE',
            headline: 'Do You Hold a Rare Christian Manuscript or Church Chronicle?',
            subtext: 'Partner with Accord Archive to digitize and preserve revival histories, biographies, and sermons for future generations.',
            btnText: 'Submit a Manuscript',
            actionType: 'contribute',
            customUrl: 'forum.html'
        }
    };
}

// Check Auth Session on Page Load
window.onload = async function() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user?.email === ADMIN_EMAIL) {
        unlockDashboard(session.user);
    } else if (session) {
        await supabaseClient.auth.signOut();
    }
};

function unlockDashboard(user) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('dashboard-wrapper').classList.remove('hidden');
    const emailLabel = document.getElementById('admin-user-email');
    if (emailLabel && user?.email) emailLabel.innerText = user.email;

    fetchAllData();

    // Background refresh every 45s without resetting search or freezing active modals
    if (!autoRefreshIntervalId) {
        autoRefreshIntervalId = setInterval(() => {
            const wrapper = document.getElementById('dashboard-wrapper');
            const archiveModal = document.getElementById('archive-modal');
            const shelfModal = document.getElementById('shelf-modal');
            const bannerModal = document.getElementById('banner-slide-modal');
            const isModalOpen =
                (archiveModal && !archiveModal.classList.contains('hidden')) ||
                (shelfModal && !shelfModal.classList.contains('hidden')) ||
                (bannerModal && !bannerModal.classList.contains('hidden'));
            if (wrapper && !wrapper.classList.contains('hidden') && !isModalOpen) {
                fetchAllData(true);
            }
        }, 45000);
    }
}

async function handleAdminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorBox.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerText = "Signing in...";

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    submitBtn.disabled = false;
    submitBtn.innerText = "Sign In to Dashboard";

    if (error) {
        errorBox.innerText = error.message || "Invalid email or password.";
        errorBox.classList.remove('hidden');
    } else if (data?.user?.email !== ADMIN_EMAIL) {
        await supabaseClient.auth.signOut();
        errorBox.innerText = "Access denied. Archivist credentials required.";
        errorBox.classList.remove('hidden');
    } else if (data?.user) {
        unlockDashboard(data.user);
        showToast("Welcome back to Accord Admin!");
    }
}

async function handleAdminLogout() {
    if (autoRefreshIntervalId) {
        clearInterval(autoRefreshIntervalId);
        autoRefreshIntervalId = null;
    }
    await supabaseClient.auth.signOut();
    document.getElementById('dashboard-wrapper').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('admin-login-form').reset();
    showToast("Signed out successfully.");
}

// FAST PARALLEL DATA FETCHING
async function fetchAllData(isSilentRefresh = false) {
    const [booksRes, purchasesRes, catsRes, subsRes, testModRes, commModRes, userBooksRes] = await Promise.all([
        supabaseClient.from('books').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('user_purchases').select('book_id, amount_paid'),
        supabaseClient.from('categories').select('*').order('name', { ascending: true }),
        supabaseClient.from('submissions').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('testimonies').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('testimony_comments').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('user_book_submissions').select('*').eq('approval_status', 'pending').order('created_at', { ascending: false })
    ]);

    if (!purchasesRes.error && purchasesRes.data) {
        purchasesData = purchasesRes.data;
    }

    if (!booksRes.error && booksRes.data) {
        const books = booksRes.data;
        const configRecord = books.find(b => b.title === LAYOUT_CONFIG_CATEGORY_NAME);
        if (configRecord && configRecord.description) {
            try {
                const parsed = JSON.parse(configRecord.description);
                homeLayoutConfig = {
                    shelves: Array.isArray(parsed.shelves) ? parsed.shelves : getDefaultHomeLayoutConfig().shelves,
                    banner: { ...getDefaultHomeLayoutConfig().banner, ...(parsed.banner || {}) }
                };
                if (!Array.isArray(homeLayoutConfig.banner.slides)) {
                    homeLayoutConfig.banner.slides = [];
                }
                localStorage.setItem('accord_home_layout_config', JSON.stringify(homeLayoutConfig));
            } catch (e) {}
        } else {
            const localSaved = localStorage.getItem('accord_home_layout_config');
            if (localSaved) {
                try {
                    const parsed = JSON.parse(localSaved);
                    homeLayoutConfig = {
                        shelves: Array.isArray(parsed.shelves) ? parsed.shelves : getDefaultHomeLayoutConfig().shelves,
                        banner: { ...getDefaultHomeLayoutConfig().banner, ...(parsed.banner || {}) }
                    };
                } catch (e) {}
            }
        }

        const systemTitles = [LAYOUT_CONFIG_CATEGORY_NAME, '__ACCORD_MUSIC_CONFIG__', '__ACCORD_ROLES_CONFIG__'];
        const realBooks = books.filter(b => !systemTitles.includes(b.title));
        catalogData = realBooks.filter(b => !b.deleted_at);
        trashData = realBooks.filter(b => b.deleted_at);
    }

    if (!catsRes.error && catsRes.data) {
        categoriesData = catsRes.data;
        populateCategoryDropdowns();
    }

    if (!subsRes.error && subsRes.data) {
        submissionsData = subsRes.data;
    }

    if (!userBooksRes.error && userBooksRes.data) {
        userBookSubmissionsData = userBooksRes.data;
    }

    if (!testModRes.error && testModRes.data) {
        testimoniesModData = testModRes.data;
    }

    if (!commModRes.error && commModRes.data) {
        commentsModData = commModRes.data;
    }

    updateStats();
    updateAllTabBadges();
    renderActiveTabOnly(isSilentRefresh);
}

function updateAllTabBadges() {
    const catBadge = document.getElementById('categories-badge');
    if (catBadge) catBadge.innerText = categoriesData.length;

    const trashBadge = document.getElementById('trash-badge');
    if (trashBadge) trashBadge.innerText = trashData.length;

    const forumBadge = document.getElementById('forum-badge');
    if (forumBadge) forumBadge.innerText = testimoniesModData.length;

    const draftCount = catalogData.filter(b => b.status === 'draft' || b.is_visible === false).length;
    const draftBadge = document.getElementById('drafts-subtab-badge');
    if (draftBadge) draftBadge.innerText = draftCount;

    const subBadge = document.getElementById('submitted-subtab-badge');
    if (subBadge) subBadge.innerText = submissionsData.length;

    const userBooksBadge = document.getElementById('user-books-subtab-badge');
    if (userBooksBadge) userBooksBadge.innerText = userBookSubmissionsData.length;

    const shelves = homeLayoutConfig?.shelves || [];
    const activeShelves = shelves.filter(s => s.enabled !== false).length;
    const shelvesBadge = document.getElementById('shelves-badge');
    const statShelves = document.getElementById('stat-shelves-count');
    if (shelvesBadge) shelvesBadge.innerText = activeShelves;
    if (statShelves) statShelves.innerText = activeShelves;
}

function renderActiveTabOnly(isSilentRefresh = false) {
    if (activeAdminTab === 'catalog') {
        filterAdminBooks();
    } else if (activeAdminTab === 'shelves') {
        renderShelvesTable();
        renderBannerSlidesTable();
        if (!isSilentRefresh) populateBannerForm();
    } else if (activeAdminTab === 'categories') {
        renderCategoriesTable();
    } else if (activeAdminTab === 'submissions') {
        renderDraftsTable();
        renderSubmissionsTable();
        renderUserBookSubmissionsTable();
    } else if (activeAdminTab === 'trash') {
        renderTrashTable();
    } else if (activeAdminTab === 'downloads') {
        renderDownloadsTable();
    } else if (activeAdminTab === 'forum') {
        renderForumModeration();
    }
}

// ==========================================
// HOME SHELVES & MULTI-BANNER SLIDER MANAGER
// ==========================================

async function persistHomeLayoutConfig() {
    localStorage.setItem('accord_home_layout_config', JSON.stringify(homeLayoutConfig));

    const { data: existing } = await supabaseClient
        .from('books')
        .select('id')
        .eq('title', LAYOUT_CONFIG_CATEGORY_NAME)
        .maybeSingle();

    const configPayload = {
        title: LAYOUT_CONFIG_CATEGORY_NAME,
        author: 'System Config',
        category: 'System',
        year: '2026',
        pages: '0',
        description: JSON.stringify(homeLayoutConfig),
        is_visible: false,
        status: 'system_config',
        is_for_sale: false,
        price: 0
    };

    if (existing?.id) {
        await supabaseClient.from('books').update(configPayload).eq('id', existing.id);
    } else {
        await supabaseClient.from('books').insert([configPayload]);
    }

    renderShelvesTable();
    renderBannerSlidesTable();
    updateAllTabBadges();
    updateStats();
}

function renderShelvesTable() {
    const tbody = document.getElementById('shelves-table-body');
    const shelves = homeLayoutConfig?.shelves || [];
    if (!tbody) return;

    tbody.innerHTML = '';

    if (shelves.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-accord-muted">No shelves configured. Click "New Shelf Section" or "Reset Defaults".</td></tr>`;
        return;
    }

    const modeLabels = {
        manual: 'Hand-Picked Books',
        popular: 'Auto: Most Popular (Downloads)',
        newest: 'Auto: New Additions (Latest)',
        recommended: 'Auto: Recommended Classics',
        category: 'Auto: Category Filter'
    };

    shelves.forEach((shelf, idx) => {
        const isEnabled = shelf.enabled !== false;
        const modeDesc = shelf.mode === 'category'
            ? `Category: ${shelf.category || 'All'}`
            : (modeLabels[shelf.mode] || 'Auto');

        const bookCountLabel = shelf.mode === 'manual'
            ? `${(shelf.bookIds || []).length} selected`
            : `Up to ${shelf.limit || 10}`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 text-center whitespace-nowrap">
                <div class="inline-flex items-center space-x-1">
                    <button type="button" onclick="moveShelf(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-50 disabled:opacity-40 text-slate-600 hover:text-accord-blue flex items-center justify-center" title="Move Up">
                        <i class="fa-solid fa-arrow-up text-[10px]"></i>
                    </button>
                    <button type="button" onclick="moveShelf(${idx}, 1)" ${idx === shelves.length - 1 ? 'disabled' : ''} class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-50 disabled:opacity-40 text-slate-600 hover:text-accord-blue flex items-center justify-center" title="Move Down">
                        <i class="fa-solid fa-arrow-down text-[10px]"></i>
                    </button>
                </div>
            </td>
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate text-sm">${escapeHTML(shelf.title)}</p>
                <p class="text-[11px] text-accord-muted">${escapeHTML(shelf.subtitle || '')}</p>
            </td>
            <td class="py-4 px-6">
                <span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${escapeHTML(modeDesc)}</span>
            </td>
            <td class="py-4 px-6 text-center font-semibold text-accord-muted">${bookCountLabel}</td>
            <td class="py-4 px-6 text-center">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}">
                    ${isEnabled ? 'Visible' : 'Hidden'}
                </span>
            </td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                <button type="button" onclick="toggleShelfEnabled('${shelf.id}')" class="w-8 h-8 rounded-xl ${isEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-600'} hover:opacity-80 transition-all inline-flex items-center justify-center" title="Toggle Visibility">
                    <i class="fa-solid ${isEnabled ? 'fa-eye' : 'fa-eye-slash'} text-xs"></i>
                </button>
                <button type="button" onclick="openShelfModal('edit', '${shelf.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Shelf & Choose Books">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button type="button" onclick="deleteShelf('${shelf.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete Shelf">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function moveShelf(index, direction) {
    const shelves = homeLayoutConfig.shelves;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= shelves.length) return;
    const temp = shelves[index];
    shelves[index] = shelves[targetIdx];
    shelves[targetIdx] = temp;
    await persistHomeLayoutConfig();
    showToast("Shelf order updated!");
}

async function toggleShelfEnabled(shelfId) {
    const shelf = homeLayoutConfig.shelves.find(s => s.id === shelfId);
    if (!shelf) return;
    shelf.enabled = shelf.enabled === false ? true : false;
    await persistHomeLayoutConfig();
    showToast(shelf.enabled ? `"${shelf.title}" enabled on home page.` : `"${shelf.title}" hidden.`);
}

async function deleteShelf(shelfId) {
    homeLayoutConfig.shelves = homeLayoutConfig.shelves.filter(s => s.id !== shelfId);
    await persistHomeLayoutConfig();
    showToast("Shelf section removed.");
}

async function resetDefaultShelves() {
    const existingSlides = homeLayoutConfig?.banner?.slides || [];
    homeLayoutConfig = getDefaultHomeLayoutConfig();
    homeLayoutConfig.banner.slides = existingSlides;
    await persistHomeLayoutConfig();
    populateBannerForm();
    showToast("Default shelves restored!");
}

function toggleShelfModeUI() {
    const mode = document.getElementById('shelf-mode').value;
    document.getElementById('shelf-manual-picker')?.classList.toggle('hidden', mode !== 'manual');
    document.getElementById('shelf-category-wrapper')?.classList.toggle('hidden', mode !== 'category');
}

function openShelfModal(mode, shelfId = null) {
    const modal = document.getElementById('shelf-modal');
    const heading = document.getElementById('shelf-modal-heading');
    document.getElementById('shelf-form').reset();
    document.getElementById('edit-shelf-id').value = '';
    document.getElementById('shelf-book-search').value = '';
    selectedShelfBookIds = new Set();

    const catSelect = document.getElementById('shelf-category-select');
    if (catSelect) {
        catSelect.innerHTML = categoriesData.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
    }

    if (mode === 'edit' && shelfId) {
        heading.innerText = "Edit Home Shelf Section";
        const shelf = homeLayoutConfig.shelves.find(s => s.id === shelfId);
        if (shelf) {
            document.getElementById('edit-shelf-id').value = shelf.id;
            document.getElementById('shelf-title').value = shelf.title || '';
            document.getElementById('shelf-subtitle').value = shelf.subtitle || '';
            document.getElementById('shelf-mode').value = shelf.mode || 'manual';
            document.getElementById('shelf-limit').value = shelf.limit || 10;
            if (shelf.category && catSelect) catSelect.value = shelf.category;
            (shelf.bookIds || []).forEach(id => selectedShelfBookIds.add(Number(id)));
        }
    } else {
        heading.innerText = "Create Home Shelf Section";
        document.getElementById('shelf-mode').value = 'manual';
        document.getElementById('shelf-limit').value = 10;
    }

    toggleShelfModeUI();
    renderShelfBookPicker();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeShelfModal() {
    const modal = document.getElementById('shelf-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

function renderShelfBookPicker() {
    const container = document.getElementById('shelf-books-checklist');
    const countEl = document.getElementById('shelf-selected-count');
    if (countEl) countEl.innerText = selectedShelfBookIds.size;
    if (!container) return;

    const query = (document.getElementById('shelf-book-search')?.value || '').toLowerCase().trim();
    const publishedBooks = catalogData.filter(b => b.is_visible !== false && b.status !== 'draft');

    const filtered = publishedBooks.filter(b =>
        (b.title || '').toLowerCase().includes(query) ||
        (b.author || '').toLowerCase().includes(query) ||
        (b.category || '').toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        container.innerHTML = `<p class="p-4 text-center text-xs text-accord-muted">No matching books found.</p>`;
        return;
    }

    container.innerHTML = filtered.map(b => {
        const checked = selectedShelfBookIds.has(Number(b.id)) ? 'checked' : '';
        return `
            <label class="flex items-center justify-between px-4 py-2.5 hover:bg-blue-50/50 cursor-pointer transition-colors">
                <div class="flex items-center space-x-3 pr-3 min-w-0">
                    <input type="checkbox" ${checked} onchange="toggleBookInShelf(${b.id}, this.checked)" class="rounded text-accord-blue focus:ring-accord-blue w-4 h-4 shrink-0">
                    <div class="truncate">
                        <p class="text-xs font-bold text-accord-slate truncate">${escapeHTML(b.title)}</p>
                        <p class="text-[10px] text-accord-muted truncate">${escapeHTML(b.author)} • ${escapeHTML(b.category)}</p>
                    </div>
                </div>
                <span class="text-[10px] font-semibold text-accord-muted shrink-0">${escapeHTML(b.year || '')}</span>
            </label>
        `;
    }).join('');
}

function toggleBookInShelf(bookId, isChecked) {
    if (isChecked) {
        selectedShelfBookIds.add(Number(bookId));
    } else {
        selectedShelfBookIds.delete(Number(bookId));
    }
    const countEl = document.getElementById('shelf-selected-count');
    if (countEl) countEl.innerText = selectedShelfBookIds.size;
}

async function handleShelfSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-shelf-id').value;
    const title = document.getElementById('shelf-title').value.trim();
    const subtitle = document.getElementById('shelf-subtitle').value.trim();
    const mode = document.getElementById('shelf-mode').value;
    const category = document.getElementById('shelf-category-select')?.value || '';
    const limit = parseInt(document.getElementById('shelf-limit').value, 10) || 10;

    if (mode === 'manual' && selectedShelfBookIds.size === 0) {
        showToast("Please select at least 1 book for a hand-picked shelf.");
        return;
    }

    const shelfObj = {
        id: editId || `shelf_${Date.now()}`,
        title,
        subtitle,
        mode,
        category,
        limit,
        bookIds: Array.from(selectedShelfBookIds),
        enabled: true
    };

    if (editId) {
        const idx = homeLayoutConfig.shelves.findIndex(s => s.id === editId);
        if (idx > -1) {
            shelfObj.enabled = homeLayoutConfig.shelves[idx].enabled;
            homeLayoutConfig.shelves[idx] = shelfObj;
        }
    } else {
        homeLayoutConfig.shelves.push(shelfObj);
    }

    closeShelfModal();
    await persistHomeLayoutConfig();
    showToast(`Shelf "${title}" saved!`);
}

// ==========================================
// MULTI-BANNER IMAGE SLIDES (DESKTOP + MOBILE)
// ==========================================

function populateBannerForm() {
    const b = homeLayoutConfig?.banner || getDefaultHomeLayoutConfig().banner;
    const enabledEl = document.getElementById('banner-enabled');
    if (enabledEl) enabledEl.checked = b.enabled !== false;
    if (document.getElementById('banner-after-count')) document.getElementById('banner-after-count').value = b.afterCount || 6;
    if (document.getElementById('banner-interval-seconds')) document.getElementById('banner-interval-seconds').value = b.intervalSeconds || 5;
}

async function handleSaveBannerConfig(e) {
    e.preventDefault();
    if (!homeLayoutConfig.banner) homeLayoutConfig.banner = getDefaultHomeLayoutConfig().banner;
    homeLayoutConfig.banner.enabled = document.getElementById('banner-enabled').checked;
    homeLayoutConfig.banner.afterCount = parseInt(document.getElementById('banner-after-count').value, 10) || 6;
    homeLayoutConfig.banner.intervalSeconds = parseInt(document.getElementById('banner-interval-seconds').value, 10) || 5;

    await persistHomeLayoutConfig();
    showToast("Banner placement and slide timing saved!");
}

function renderBannerSlidesTable() {
    const tbody = document.getElementById('banner-slides-table-body');
    if (!tbody) return;

    const slides = Array.isArray(homeLayoutConfig?.banner?.slides) ? homeLayoutConfig.banner.slides : [];
    tbody.innerHTML = '';

    if (slides.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-accord-muted">No image banner slides uploaded yet. Click "Add Banner Slide" above to upload Desktop (1920×640) & Mobile (1080×1080) banners.</td></tr>`;
        return;
    }

    const actionLabels = {
        link: 'Opens URL',
        contribute: 'Opens Manuscript Modal',
        forum: 'Opens Testimonies Forum',
        none: 'Image Only (No Click)'
    };

    slides.forEach((slide, idx) => {
        const isEnabled = slide.enabled !== false;
        const desktopThumb = slide.desktopUrl
            ? `<img src="${escapeHTML(slide.desktopUrl)}" class="w-28 h-10 object-cover rounded-lg border border-slate-200 shadow-sm">`
            : `<span class="text-[10px] text-slate-400">None</span>`;
        const mobileThumb = slide.mobileUrl
            ? `<img src="${escapeHTML(slide.mobileUrl)}" class="w-10 h-10 object-cover rounded-lg border border-slate-200 shadow-sm">`
            : `<span class="text-[10px] text-slate-400">Uses Desktop</span>`;

        const actionText = slide.actionType === 'link'
            ? `URL: ${slide.linkUrl || '#'}`
            : (actionLabels[slide.actionType] || 'Opens URL');

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-3.5 px-5 text-center whitespace-nowrap">
                <div class="inline-flex items-center space-x-1">
                    <button type="button" onclick="moveBannerSlide(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-50 disabled:opacity-40 text-slate-600 hover:text-accord-blue flex items-center justify-center" title="Move Up">
                        <i class="fa-solid fa-arrow-up text-[10px]"></i>
                    </button>
                    <button type="button" onclick="moveBannerSlide(${idx}, 1)" ${idx === slides.length - 1 ? 'disabled' : ''} class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-50 disabled:opacity-40 text-slate-600 hover:text-accord-blue flex items-center justify-center" title="Move Down">
                        <i class="fa-solid fa-arrow-down text-[10px]"></i>
                    </button>
                </div>
            </td>
            <td class="py-3.5 px-5">${desktopThumb}</td>
            <td class="py-3.5 px-5">${mobileThumb}</td>
            <td class="py-3.5 px-5">
                <p class="font-bold text-accord-slate text-xs">${escapeHTML(slide.alt || `Banner Slide #${idx + 1}`)}</p>
                <p class="text-[10px] text-accord-muted truncate max-w-[220px]">${escapeHTML(actionText)}</p>
            </td>
            <td class="py-3.5 px-5 text-center">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}">
                    ${isEnabled ? 'Active' : 'Hidden'}
                </span>
            </td>
            <td class="py-3.5 px-5 text-right space-x-1.5 whitespace-nowrap">
                <button type="button" onclick="toggleBannerSlideEnabled('${slide.id}')" class="w-8 h-8 rounded-xl ${isEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-600'} hover:opacity-80 transition-all inline-flex items-center justify-center" title="Toggle Slide">
                    <i class="fa-solid ${isEnabled ? 'fa-eye' : 'fa-eye-slash'} text-xs"></i>
                </button>
                <button type="button" onclick="openBannerSlideModal('edit', '${slide.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Slide">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button type="button" onclick="deleteBannerSlide('${slide.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete Slide">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleBannerSlideLinkField() {
    const action = document.getElementById('banner-slide-action')?.value || 'link';
    document.getElementById('banner-slide-link-wrapper')?.classList.toggle('hidden', action !== 'link');
}

function openBannerSlideModal(mode, slideId = null) {
    const modal = document.getElementById('banner-slide-modal');
    const heading = document.getElementById('banner-slide-modal-heading');
    document.getElementById('banner-slide-form').reset();
    document.getElementById('edit-banner-slide-id').value = '';
    currentBannerDesktopCompressed = "";
    currentBannerMobileCompressed = "";

    const deskPreview = document.getElementById('banner-desktop-preview');
    const mobPreview = document.getElementById('banner-mobile-preview');
    if (deskPreview) {
        deskPreview.innerHTML = `<i class="fa-solid fa-panorama text-xl mb-1 text-accord-blue"></i><span class="text-[10px] font-semibold">Click to upload Desktop Banner</span>`;
    }
    if (mobPreview) {
        mobPreview.innerHTML = `<i class="fa-solid fa-mobile-screen text-xl mb-1 text-accord-gold"></i><span class="text-[10px] font-semibold">Click to upload Mobile Banner</span>`;
    }
    const deskFilename = document.getElementById('banner-desktop-filename');
    const mobFilename = document.getElementById('banner-mobile-filename');
    if (deskFilename) deskFilename.innerText = 'JPG, PNG, or WebP (3:1 wide)';
    if (mobFilename) mobFilename.innerText = 'Optional (Falls back to Desktop if empty)';

    if (!homeLayoutConfig.banner) homeLayoutConfig.banner = getDefaultHomeLayoutConfig().banner;
    if (!Array.isArray(homeLayoutConfig.banner.slides)) homeLayoutConfig.banner.slides = [];

    if (mode === 'edit' && slideId) {
        heading.innerText = "Edit Promotional Banner Slide";
        const slide = homeLayoutConfig.banner.slides.find(s => s.id === slideId);
        if (slide) {
            document.getElementById('edit-banner-slide-id').value = slide.id;
            document.getElementById('banner-desktop-url-input').value = slide.desktopUrl || '';
            document.getElementById('banner-mobile-url-input').value = slide.mobileUrl || '';
            document.getElementById('banner-slide-alt').value = slide.alt || '';
            document.getElementById('banner-slide-action').value = slide.actionType || 'link';
            document.getElementById('banner-slide-link').value = slide.linkUrl || '';
            if (slide.desktopUrl && deskPreview) {
                deskPreview.innerHTML = `<img src="${escapeHTML(slide.desktopUrl)}" class="w-full h-full object-cover">`;
            }
            if (slide.mobileUrl && mobPreview) {
                mobPreview.innerHTML = `<img src="${escapeHTML(slide.mobileUrl)}" class="w-full h-full object-cover">`;
            }
        }
    } else {
        heading.innerText = "Add Promotional Banner Slide";
        document.getElementById('banner-slide-action').value = 'link';
    }

    toggleBannerSlideLinkField();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeBannerSlideModal() {
    const modal = document.getElementById('banner-slide-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function uploadCompressedBannerImage(dataUrl, prefix) {
    const blob = await (await fetch(dataUrl)).blob();
    const fileName = `banners/${prefix}_${Date.now()}.webp`;
    const { data: upData, error: upErr } = await supabaseClient.storage
        .from('archive-files')
        .upload(fileName, blob, {
            contentType: 'image/webp',
            cacheControl: '3600',
            upsert: false
        });
    if (upErr) throw upErr;
    const { data: pubData } = supabaseClient.storage
        .from('archive-files')
        .getPublicUrl(upData.path);
    return pubData.publicUrl;
}

async function handleBannerSlideSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-banner-slide-id').value;
    const saveBtn = document.getElementById('save-banner-slide-btn');

    let desktopUrl = document.getElementById('banner-desktop-url-input').value.trim();
    let mobileUrl = document.getElementById('banner-mobile-url-input').value.trim();
    const alt = document.getElementById('banner-slide-alt').value.trim() || 'Accord Promotional Banner';
    const actionType = document.getElementById('banner-slide-action').value;
    const linkUrl = document.getElementById('banner-slide-link').value.trim();

    if (!desktopUrl && !currentBannerDesktopCompressed && !mobileUrl && !currentBannerMobileCompressed) {
        showToast("Please upload or paste at least a Desktop Banner image.");
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = "Uploading Banner...";
    }

    try {
        if (currentBannerDesktopCompressed) {
            desktopUrl = await uploadCompressedBannerImage(currentBannerDesktopCompressed, 'desktop_banner');
        }
        if (currentBannerMobileCompressed) {
            mobileUrl = await uploadCompressedBannerImage(currentBannerMobileCompressed, 'mobile_banner');
        }
    } catch (err) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Banner Slide";
        }
        showToast(`Banner image upload failed: ${err.message}`);
        return;
    }

    if (!desktopUrl && mobileUrl) desktopUrl = mobileUrl;

    if (!homeLayoutConfig.banner) homeLayoutConfig.banner = getDefaultHomeLayoutConfig().banner;
    if (!Array.isArray(homeLayoutConfig.banner.slides)) homeLayoutConfig.banner.slides = [];

    const slideObj = {
        id: editId || `banner_${Date.now()}`,
        desktopUrl,
        mobileUrl: mobileUrl || desktopUrl,
        alt,
        actionType,
        linkUrl,
        enabled: true
    };

    if (editId) {
        const idx = homeLayoutConfig.banner.slides.findIndex(s => s.id === editId);
        if (idx > -1) {
            slideObj.enabled = homeLayoutConfig.banner.slides[idx].enabled;
            homeLayoutConfig.banner.slides[idx] = slideObj;
        }
    } else {
        homeLayoutConfig.banner.slides.push(slideObj);
    }

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Banner Slide";
    }

    closeBannerSlideModal();
    await persistHomeLayoutConfig();
    showToast("Promotional banner slide saved!");
}

async function moveBannerSlide(index, direction) {
    const slides = homeLayoutConfig?.banner?.slides || [];
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const temp = slides[index];
    slides[index] = slides[targetIdx];
    slides[targetIdx] = temp;
    await persistHomeLayoutConfig();
    showToast("Banner slide order updated!");
}

async function toggleBannerSlideEnabled(slideId) {
    const slide = (homeLayoutConfig?.banner?.slides || []).find(s => s.id === slideId);
    if (!slide) return;
    slide.enabled = slide.enabled === false ? true : false;
    await persistHomeLayoutConfig();
    showToast(slide.enabled ? "Banner slide enabled." : "Banner slide hidden.");
}

async function deleteBannerSlide(slideId) {
    if (!homeLayoutConfig?.banner?.slides) return;
    homeLayoutConfig.banner.slides = homeLayoutConfig.banner.slides.filter(s => s.id !== slideId);
    await persistHomeLayoutConfig();
    showToast("Banner slide removed.");
}

// ==========================================
// BULK EXCEL / CSV UPLOAD (STRICT NO-DUPLICATES)
// ==========================================

function openExcelUploadModal() {
    parsedExcelRows = [];
    const fileInput = document.getElementById('excel-file-input');
    if (fileInput) fileInput.value = '';
    document.getElementById('excel-file-name').innerText = 'Click or drag Excel spreadsheet (.xlsx, .csv)';
    document.getElementById('excel-row-preview').innerText = 'All rows will be imported automatically';
    document.getElementById('execute-excel-import-btn').disabled = true;
    document.getElementById('excel-progress-box').classList.add('hidden');
    document.getElementById('excel-progress-bar').style.width = '0%';

    const modal = document.getElementById('excel-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeExcelUploadModal() {
    const modal = document.getElementById('excel-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

function downloadExcelTemplate() {
    const sampleRows = [
        {
            title: "The Great Awakening",
            author: "Jonathan Edwards",
            category: "Church History",
            year: "1742",
            pages: "320",
            description: "Historical account of the spiritual revival across New England.",
            download_url: "https://example.com/great-awakening.pdf",
            cover_url: "",
            is_for_sale: "false",
            price: "0"
        },
        {
            title: "Accord 2023 Mag",
            author: "Accord Editorial",
            category: "Magazines",
            year: "2023",
            pages: "48",
            description: "Faith-based lifestyle and urban gospel chronicle.",
            download_url: "https://example.com/accord-2023-mag.pdf",
            cover_url: "",
            is_for_sale: "true",
            price: "12.00"
        }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Accord_Books");
    XLSX.writeFile(workbook, "Accord_Bulk_Books_Template.xlsx");
}

document.getElementById('excel-file-input')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('excel-file-name').innerText = file.name;
    const reader = new FileReader();

    reader.onload = function(ev) {
        try {
            const data = new Uint8Array(ev.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            parsedExcelRows = rawRows
                .map(row => {
                    const normalized = {};
                    Object.keys(row).forEach(k => {
                        normalized[k.trim().toLowerCase().replace(/\s+/g, '_')] = row[k];
                    });
                    return normalized;
                })
                .filter(row => String(row.title || '').trim() !== '');

            if (parsedExcelRows.length > 0) {
                const existingTitles = new Set(
                    catalogData.map(b => (b.title || '').trim().toLowerCase())
                );
                let newCount = 0;
                let dupCount = 0;
                const seenInSheet = new Set();

                parsedExcelRows.forEach(r => {
                    const key = String(r.title).trim().toLowerCase();
                    if (existingTitles.has(key) || seenInSheet.has(key)) {
                        dupCount++;
                    } else {
                        seenInSheet.add(key);
                        newCount++;
                    }
                });

                document.getElementById('excel-row-preview').innerText = dupCount > 0
                    ? `${newCount} new book(s) ready • ${dupCount} duplicate(s) will be skipped automatically.`
                    : `${newCount} new book row(s) detected and ready to import.`;
                document.getElementById('execute-excel-import-btn').disabled = newCount === 0;
                showToast(newCount === 0
                    ? "All books in this file are already in your catalog."
                    : `Detected ${newCount} new book(s) (${dupCount} duplicates skipped).`);
            } else {
                document.getElementById('excel-row-preview').innerText = 'No valid rows with a "title" column found.';
                document.getElementById('execute-excel-import-btn').disabled = true;
                showToast("No valid book rows found. Make sure your sheet has a 'title' column.");
            }
        } catch (err) {
            console.error("Excel Parse Error:", err);
            showToast("Failed to read spreadsheet. Please upload a valid .xlsx, .xls, or .csv file.");
        }
    };
    reader.readAsArrayBuffer(file);
});

async function processExcelUpload() {
    if (parsedExcelRows.length === 0) return;

    const importBtn = document.getElementById('execute-excel-import-btn');
    const progressBox = document.getElementById('excel-progress-box');
    const progressBar = document.getElementById('excel-progress-bar');
    const statusText = document.getElementById('excel-status-text');
    const counterText = document.getElementById('excel-counter');

    importBtn.disabled = true;
    progressBox.classList.remove('hidden');

    let addedCount = 0;
    let skippedCount = 0;
    const total = parsedExcelRows.length;
    const existingCatNames = new Set(categoriesData.map(c => c.name.toLowerCase()));

    const existingTitles = new Set(
        catalogData.map(b => (b.title || '').trim().toLowerCase())
    );

    for (let i = 0; i < total; i++) {
        const row = parsedExcelRows[i];
        const pct = Math.round(((i + 1) / total) * 100);
        progressBar.style.width = `${pct}%`;
        counterText.innerText = `${i + 1} / ${total}`;

        const title = String(row.title || 'Untitled Book').trim();
        const normalizedTitle = title.toLowerCase();

        if (existingTitles.has(normalizedTitle)) {
            skippedCount++;
            statusText.innerText = `Skipped duplicate: "${title}"`;
            continue;
        }

        statusText.innerText = `Importing: "${title}"`;

        const categoryName = String(row.category || 'Uncategorized').trim() || 'Uncategorized';

        if (categoryName !== 'Uncategorized' && !existingCatNames.has(categoryName.toLowerCase())) {
            const { error: catErr } = await supabaseClient.from('categories').insert([{ name: categoryName }]);
            if (!catErr) existingCatNames.add(categoryName.toLowerCase());
        }

        const saleFlag = String(row.is_for_sale || '').trim().toLowerCase();
        const isForSale = saleFlag === 'true' || saleFlag === '1' || saleFlag === 'yes';
        const price = isForSale ? (parseFloat(row.price) || 0) : 0;

        const payload = {
            title,
            author: String(row.author || 'TBD').trim() || 'TBD',
            category: categoryName,
            year: String(row.year || new Date().getFullYear()).trim(),
            pages: String(row.pages || 'TBD').trim() || 'TBD',
            description: String(row.description || 'Imported via spreadsheet.').trim(),
            download_url: String(row.download_url || row.link || row.url || '').trim(),
            cover_url: String(row.cover_url || row.cover || '').trim(),
            is_for_sale: isForSale,
            price,
            gradient: "from-blue-900 via-indigo-900 to-slate-900",
            is_visible: true,
            status: 'published'
        };

        const { error } = await supabaseClient.from('books').insert([payload]);
        if (!error) {
            addedCount++;
            existingTitles.add(normalizedTitle);
        }
    }

    statusText.innerText = `Done! ${addedCount} new book(s) added, ${skippedCount} duplicate(s) skipped.`;
    showToast(`Import complete: ${addedCount} added, ${skippedCount} duplicates skipped.`);
    await fetchAllData();

    setTimeout(() => {
        closeExcelUploadModal();
    }, 1600);
}

// ==========================================
// CATEGORIES MANAGEMENT
// ==========================================

function populateCategoryDropdowns() {
    const catNames = categoriesData.map(c => c.name);

    const filterSelect = document.getElementById('admin-cat-filter');
    if (filterSelect) {
        const currentFilter = filterSelect.value || 'All';
        filterSelect.innerHTML = `<option value="All">All Categories</option>` +
            catNames.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
        filterSelect.value = catNames.includes(currentFilter) ? currentFilter : 'All';
    }

    const modalSelect = document.getElementById('form-category');
    if (modalSelect) {
        const currentModalVal = modalSelect.value;
        if (catNames.length === 0) {
            modalSelect.innerHTML = `<option value="Uncategorized">Uncategorized (Add categories in Categories tab)</option>`;
        } else {
            modalSelect.innerHTML = catNames.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
            if (catNames.includes(currentModalVal)) {
                modalSelect.value = currentModalVal;
            }
        }
    }
}

function renderCategoriesTable() {
    const tbody = document.getElementById('categories-table-body');
    const badge = document.getElementById('categories-badge');
    if (badge) badge.innerText = categoriesData.length;
    if (!tbody) return;

    tbody.innerHTML = '';

    if (categoriesData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-accord-muted">No categories yet. Add your first category above.</td></tr>`;
        return;
    }

    categoriesData.forEach(cat => {
        const bookCount = catalogData.filter(b => b.category === cat.name).length;
        const safeName = cat.name.replace(/'/g, "\\'");

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate">
                <span class="bg-accord-lightBlue text-accord-blue text-xs font-bold px-3 py-1.5 rounded-lg inline-block">${escapeHTML(cat.name)}</span>
            </td>
            <td class="py-4 px-6 text-center text-accord-muted font-semibold">${bookCount}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                <button onclick="openEditCategoryModal(${cat.id}, '${safeName}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Rename Category">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button onclick="promptDeleteCategory(${cat.id}, '${safeName}', ${bookCount})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete Category">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleAddCategory(e) {
    e.preventDefault();
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();
    if (!name) return;

    const { error } = await supabaseClient
        .from('categories')
        .insert([{ name }]);

    if (error) {
        showToast(error.code === '23505' ? "That category already exists." : `Could not add category: ${error.message}`);
        return;
    }

    input.value = '';
    await fetchAllData();
    showToast(`Category "${name}" added!`);
}

function openEditCategoryModal(id, currentName) {
    document.getElementById('edit-category-id').value = id;
    document.getElementById('edit-category-old-name').value = currentName;
    document.getElementById('edit-category-name').value = currentName;
    const modal = document.getElementById('edit-category-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEditCategoryModal() {
    const modal = document.getElementById('edit-category-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleRenameCategory(e) {
    e.preventDefault();
    const id = document.getElementById('edit-category-id').value;
    const oldName = document.getElementById('edit-category-old-name').value;
    const newName = document.getElementById('edit-category-name').value.trim();

    if (!newName || newName === oldName) {
        closeEditCategoryModal();
        return;
    }

    const { error } = await supabaseClient
        .from('categories')
        .update({ name: newName })
        .eq('id', id);

    if (error) {
        showToast(error.code === '23505' ? "A category with that name already exists." : `Rename failed: ${error.message}`);
        return;
    }

    await supabaseClient
        .from('books')
        .update({ category: newName })
        .eq('category', oldName);

    closeEditCategoryModal();
    await fetchAllData();
    showToast(`Category renamed to "${newName}"!`);
}

function promptDeleteCategory(id, name, bookCount) {
    document.getElementById('confirm-title').innerText = `Delete "${name}"?`;
    document.getElementById('confirm-text').innerText = bookCount > 0
        ? `This category currently has ${bookCount} book(s). Deleting it removes it from the dropdown list, while existing books keep their label until edited.`
        : "This category will be permanently removed from your dropdown list.";

    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('confirm-btn').onclick = async function() {
        await supabaseClient.from('categories').delete().eq('id', id);
        closeConfirmModal();
        await fetchAllData();
        showToast(`Category "${name}" deleted.`);
    };
}

// ==========================================
// TAB SWITCHING (LAZY-RENDERED FOR SPEED) & PENDING REVIEWS
// ==========================================

function switchTab(tabName) {
    activeAdminTab = tabName;
    const tabs = ['catalog', 'shelves', 'categories', 'submissions', 'trash', 'downloads', 'forum'];
    tabs.forEach(t => {
        const sec = document.getElementById(`section-${t}`);
        const btn = document.getElementById(`nav-tab-${t}`);
        if (!sec) return;
        if (t === tabName) {
            sec.classList.remove('hidden');
            if (btn) btn.className = "px-3.5 py-2 rounded-xl text-xs font-bold transition-all bg-white text-accord-blue shadow-sm";
        } else {
            sec.classList.add('hidden');
            if (btn) btn.className = "px-3.5 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
        }
    });

    renderActiveTabOnly(false);
}

function openPendingReviews(subTab = 'drafts') {
    switchTab('submissions');
    switchPendingSubTab(subTab);
}

function switchPendingSubTab(subTab) {
    const isDrafts = subTab === 'drafts';
    document.getElementById('pending-panel-drafts')?.classList.toggle('hidden', !isDrafts);
    document.getElementById('pending-panel-submitted')?.classList.toggle('hidden', isDrafts);

    const draftBtn = document.getElementById('subtab-btn-drafts');
    const subBtn = document.getElementById('subtab-btn-submitted');

    if (draftBtn) {
        draftBtn.className = isDrafts
            ? "px-4 py-2 rounded-xl text-xs font-bold transition-all bg-white text-accord-blue shadow-sm"
            : "px-4 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
    }
    if (subBtn) {
        subBtn.className = !isDrafts
            ? "px-4 py-2 rounded-xl text-xs font-bold transition-all bg-white text-accord-blue shadow-sm"
            : "px-4 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
    }
}

function renderDraftsTable() {
    const tbody = document.getElementById('drafts-table-body');
    const draftBooks = catalogData.filter(b => b.status === 'draft' || b.is_visible === false);

    const draftBadge = document.getElementById('drafts-subtab-badge');
    if (draftBadge) draftBadge.innerText = draftBooks.length;

    if (!tbody) return;
    tbody.innerHTML = '';

    if (draftBooks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-accord-muted">No draft or hidden books at the moment.</td></tr>`;
        return;
    }

    draftBooks.forEach(book => {
        const thumb = book.cover_url
            ? `<img src="${escapeHTML(book.cover_url)}" class="w-9 h-12 rounded-lg object-cover shadow-sm border border-slate-200 shrink-0">`
            : `<div class="w-9 h-12 rounded-lg bg-amber-50 text-accord-gold flex items-center justify-center font-bold text-xs shrink-0"><i class="fa-solid fa-file-pen"></i></div>`;

        const saleTag = book.is_for_sale
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">USD ${Number(book.price || 0).toFixed(2)}</span>`
            : '';

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate flex items-center space-x-3">
                ${thumb}
                <div>
                    <p class="leading-snug">${escapeHTML(book.title)}</p>
                    <div class="flex items-center gap-1 mt-0.5">
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800"><i class="fa-solid fa-file-pen mr-1"></i> Draft</span>
                        ${saleTag}
                    </div>
                </div>
            </td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(book.author)}</td>
            <td class="py-4 px-6"><span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${escapeHTML(book.category)}</span></td>
            <td class="py-4 px-6 text-center text-accord-muted">${escapeHTML(book.year)}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                <button onclick="toggleBookVisibility(${book.id}, true)" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl shadow-sm transition-all" title="Publish Now">
                    <i class="fa-solid fa-cloud-arrow-up mr-1"></i> Publish
                </button>
                <button onclick="openArchiveModal('edit', ${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Draft">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button onclick="promptDelete(${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Move to Recycle Bin">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// CATALOG TABLE & SINGLE ARCHIVE CRUD
// ==========================================

function renderCatalogTable(list) {
    const tbody = document.getElementById('admin-book-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-accord-muted">No archives found matching your criteria.</td></tr>`;
        return;
    }

    list.forEach(book => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";

        let statusBadge = '';
        if (book.status === 'uploading') {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 mt-0.5"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Uploading PDF...</span>`;
        } else if (book.status === 'failed') {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-600 mt-0.5"><i class="fa-solid fa-circle-exclamation mr-1"></i> Upload Failed</span>`;
        } else if (book.download_url) {
            const isExternal = !book.download_url.includes('/archive-files/');
            statusBadge = isExternal
                ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-accord-blue mt-0.5"><i class="fa-solid fa-link mr-1"></i> External Link</span>`
                : `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-600 mt-0.5"><i class="fa-solid fa-circle-check mr-1"></i> Upload Successful</span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 mt-0.5">No PDF Linked</span>`;
        }

        let visibilityBadge = '';
        if (book.status === 'draft') {
            visibilityBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 mt-0.5"><i class="fa-solid fa-file-pen mr-1"></i> Draft</span>`;
        } else if (book.is_visible === false) {
            visibilityBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700 mt-0.5"><i class="fa-solid fa-eye-slash mr-1"></i> Hidden</span>`;
        }

        const saleBadge = book.is_for_sale
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 mt-0.5"><i class="fa-solid fa-tag mr-1"></i> For Sale • USD ${Number(book.price || 0).toFixed(2)}</span>`
            : '';

        const isVisible = book.is_visible !== false;
        const visibilityBtn = isVisible
            ? `<button onclick="toggleBookVisibility(${book.id}, false)" class="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-amber-50 text-emerald-600 hover:text-amber-600 transition-all inline-flex items-center justify-center" title="Visible on Homepage (Click to Hide)"><i class="fa-solid fa-eye text-xs"></i></button>`
            : `<button onclick="toggleBookVisibility(${book.id}, true)" class="w-8 h-8 rounded-xl bg-slate-200 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 transition-all inline-flex items-center justify-center" title="Hidden / Draft (Click to Publish)"><i class="fa-solid fa-eye-slash text-xs"></i></button>`;

        const thumb = book.cover_url
            ? `<img src="${escapeHTML(book.cover_url)}" class="w-9 h-12 rounded-lg object-cover shadow-sm border border-slate-200 shrink-0" loading="lazy">`
            : `<div class="w-9 h-12 rounded-lg bg-accord-lightBlue text-accord-blue flex items-center justify-center font-bold text-xs shrink-0"><i class="fa-solid fa-book"></i></div>`;

        const viewUrl = book.download_url
            ? (book.download_url.includes('/archive-files/') ? book.download_url.split('?')[0] : book.download_url)
            : '';

        const viewBtn = viewUrl
            ? `<a href="${escapeHTML(viewUrl)}" target="_blank" rel="noopener noreferrer" class="w-8 h-8 rounded-xl bg-accord-lightBlue hover:bg-accord-blue text-accord-blue hover:text-white transition-all inline-flex items-center justify-center" title="View & Read Book"><i class="fa-solid fa-book-open-reader text-xs"></i></a>`
            : `<button disabled class="w-8 h-8 rounded-xl bg-slate-100 text-slate-300 cursor-not-allowed inline-flex items-center justify-center" title="No PDF available"><i class="fa-solid fa-book-open-reader text-xs"></i></button>`;

        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate flex items-center space-x-3">
                ${thumb}
                <div>
                    <p class="leading-snug">${escapeHTML(book.title)}</p>
                    <div class="flex flex-wrap items-center gap-1">
                        ${statusBadge}
                        ${visibilityBadge}
                        ${saleBadge}
                    </div>
                </div>
            </td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(book.author)}</td>
            <td class="py-4 px-6"><span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-md inline-block leading-tight">${escapeHTML(book.category)}</span></td>
            <td class="py-4 px-6 text-center text-accord-muted">${escapeHTML(book.year)}</td>
            <td class="py-4 px-6 text-center text-accord-muted">${escapeHTML(book.pages || 'TBD')} p.</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${visibilityBtn}
                ${viewBtn}
                <button onclick="openArchiveModal('edit', ${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Archive"><i class="fa-solid fa-pen text-xs"></i></button>
                <button onclick="promptDelete(${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Move to Recycle Bin"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleBookVisibility(id, makeVisible) {
    const updateFields = makeVisible
        ? { is_visible: true, status: 'published' }
        : { is_visible: false };

    const { error } = await supabaseClient
        .from('books')
        .update(updateFields)
        .eq('id', id);

    if (!error) {
        await fetchAllData();
        showToast(makeVisible ? "Book is now published on the homepage." : "Book hidden from the homepage.");
    } else {
        showToast(`Could not update visibility: ${error.message}`);
    }
}

function filterAdminBooks() {
    const searchEl = document.getElementById('admin-search');
    const clearBtn = document.getElementById('admin-clear-search');
    const query = (searchEl?.value || '').toLowerCase().trim();
    const cat = document.getElementById('admin-cat-filter')?.value || 'All';

    if (clearBtn) {
        clearBtn.classList.toggle('hidden', query.length === 0);
    }

    const filtered = catalogData.filter(book => {
        const matchesCat = cat === 'All' || book.category === cat;
        const matchesQuery =
            (book.title || '').toLowerCase().includes(query) ||
            (book.author || '').toLowerCase().includes(query) ||
            (book.category || '').toLowerCase().includes(query) ||
            (book.description || '').toLowerCase().includes(query);
        return matchesCat && matchesQuery;
    });
    renderCatalogTable(filtered);
}

function clearAdminSearch() {
    const searchEl = document.getElementById('admin-search');
    if (searchEl) searchEl.value = '';
    filterAdminBooks();
}

function togglePriceField() {
    const isForSale = document.getElementById('form-is-for-sale').value === 'true';
    const wrapper = document.getElementById('price-field-wrapper');
    const priceInput = document.getElementById('form-price');
    wrapper.classList.toggle('hidden', !isForSale);
    priceInput.required = isForSale;
    if (!isForSale) priceInput.value = '';
}

function openArchiveModal(mode, id = null) {
    const modal = document.getElementById('archive-modal');
    const heading = document.getElementById('modal-heading');
    document.getElementById('archive-form').reset();
    document.getElementById('edit-book-id').value = '';
    currentCompressedCover = "";

    populateCategoryDropdowns();
    document.getElementById('form-is-for-sale').value = 'false';
    togglePriceField();

    const fileNameDisplay = document.getElementById('file-name-display');
    const uploadUi = document.getElementById('upload-ui');
    if (fileNameDisplay) {
        fileNameDisplay.textContent = "Max size: 50MB";
        fileNameDisplay.classList.remove('text-accord-blue', 'font-bold');
    }
    if (uploadUi) {
        uploadUi.classList.remove('border-accord-blue', 'bg-accord-lightBlue');
    }

    const coverPreview = document.getElementById('cover-preview-box');
    const coverName = document.getElementById('cover-name-display');
    if (coverPreview) coverPreview.innerHTML = `<i class="fa-regular fa-image"></i>`;
    if (coverName) {
        coverName.textContent = "JPG, PNG, WebP (Auto-optimized)";
        coverName.classList.remove('text-accord-blue', 'font-bold');
    }

    if (mode === 'edit' && id !== null) {
        heading.innerText = "Edit Archive Item";
        const book = catalogData.find(b => b.id === id);
        if (book) {
            document.getElementById('edit-book-id').value = book.id;
            document.getElementById('form-title').value = book.title === 'Untitled Draft' ? '' : book.title;
            document.getElementById('form-author').value = book.author === 'TBD' ? '' : book.author;

            const catSelect = document.getElementById('form-category');
            if (book.category && ![...catSelect.options].some(o => o.value === book.category)) {
                catSelect.innerHTML += `<option value="${escapeHTML(book.category)}">${escapeHTML(book.category)}</option>`;
            }
            catSelect.value = book.category;

            document.getElementById('form-year').value = book.year === 'TBD' ? '' : book.year;
            document.getElementById('form-pages').value = book.pages;
            document.getElementById('form-description').value = book.description === 'Draft in progress.' ? '' : book.description;

            document.getElementById('form-is-for-sale').value = book.is_for_sale ? 'true' : 'false';
            togglePriceField();
            if (book.is_for_sale) {
                document.getElementById('form-price').value = Number(book.price || 0).toFixed(2);
            }

            const externalInput = document.getElementById('form-external-url');
            if (externalInput && book.download_url && !book.download_url.includes('/archive-files/')) {
                externalInput.value = book.download_url;
            }

            if (book.cover_url && coverPreview) {
                coverPreview.innerHTML = `<img src="${escapeHTML(book.cover_url)}" class="w-full h-full object-cover">`;
            }
        }
    } else {
        heading.innerText = "Add New Archive Item";
        document.getElementById('form-pages').value = 'TBD';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        document.getElementById('archive-modal-box')?.classList.remove('scale-95');
        document.getElementById('archive-modal-box')?.classList.add('scale-100');
    }, 10);
}

function closeArchiveModal() {
    const modal = document.getElementById('archive-modal');
    document.getElementById('archive-modal-box')?.classList.remove('scale-100');
    document.getElementById('archive-modal-box')?.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 200);
}

async function handleArchiveSubmit(e) {
    e.preventDefault();
    await processArchiveSave(false);
}

async function saveAsDraft() {
    const titleInput = document.getElementById('form-title');
    if (!titleInput.value.trim()) {
        titleInput.value = "Untitled Draft";
    }
    await processArchiveSave(true);
}

async function processArchiveSave(isDraft) {
    const fileInput = document.getElementById('form-file');
    const selectedFile = fileInput && fileInput.files.length > 0 ? fileInput.files[0] : null;
    const externalUrlInput = document.getElementById('form-external-url');
    const externalUrl = externalUrlInput ? externalUrlInput.value.trim() : "";
    const coverToSave = currentCompressedCover;

    const editId = document.getElementById('edit-book-id').value;
    const title = document.getElementById('form-title').value.trim() || "Untitled Draft";

    if (!editId && title !== "Untitled Draft") {
        const isDuplicate = catalogData.some(
            b => (b.title || '').trim().toLowerCase() === title.toLowerCase()
        );
        if (isDuplicate) {
            showToast(`"${title}" already exists in the catalog! Edit the existing entry instead.`);
            return;
        }
    }

    const author = document.getElementById('form-author').value.trim() || "TBD";
    const category = document.getElementById('form-category').value || "Uncategorized";
    const year = document.getElementById('form-year').value.trim() || "TBD";
    const pages = document.getElementById('form-pages').value || "TBD";
    const description = document.getElementById('form-description').value.trim() || "Draft in progress.";
    const isForSale = document.getElementById('form-is-for-sale').value === 'true';
    const price = isForSale ? (parseFloat(document.getElementById('form-price').value) || 0) : 0;

    closeArchiveModal();

    const tempId = Date.now();
    const existingBook = editId ? catalogData.find(b => b.id == editId) : null;
    const initialUrl = externalUrl || (existingBook ? existingBook.download_url : "");

    let finalCoverUrl = existingBook ? existingBook.cover_url : "";
    if (coverToSave && coverToSave.startsWith('data:image/')) {
        try {
            const blob = await (await fetch(coverToSave)).blob();
            const coverFileName = `covers/cover_${Date.now()}.webp`;
            const { data: coverUp, error: coverErr } = await supabaseClient.storage
                .from('archive-files')
                .upload(coverFileName, blob, {
                    contentType: 'image/webp',
                    cacheControl: '3600',
                    upsert: false
                });

            if (coverErr) throw coverErr;

            const { data: coverPub } = supabaseClient.storage
                .from('archive-files')
                .getPublicUrl(coverUp.path);

            finalCoverUrl = coverPub.publicUrl;
        } catch (err) {
            console.error("Cover Upload Error:", err);
            showToast(`Cover upload failed: ${err.message}`);
        }
    }

    const tempBook = {
        id: editId ? Number(editId) : tempId,
        title, author, category, year, pages, description,
        is_for_sale: isForSale,
        price,
        downloads: existingBook ? existingBook.downloads : 0,
        cover_url: finalCoverUrl,
        download_url: initialUrl,
        is_visible: !isDraft,
        status: selectedFile ? 'uploading' : (isDraft ? 'draft' : 'published')
    };

    if (editId) {
        const idx = catalogData.findIndex(b => b.id == editId);
        if (idx > -1) catalogData[idx] = tempBook;
    } else {
        catalogData.unshift(tempBook);
    }
    filterAdminBooks();
    renderDraftsTable();

    let downloadUrl = initialUrl;
    if (selectedFile) {
        try {
            const originalName = selectedFile.name || 'document.pdf';
            const lastDotIndex = originalName.lastIndexOf('.');
            const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
            const fileExtension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '.pdf';
            const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9._-]/g, "_");
            const fileName = `${cleanName}_acc${Date.now()}${fileExtension}`;

            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('archive-files')
                .upload(fileName, selectedFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabaseClient.storage
                .from('archive-files')
                .getPublicUrl(uploadData.path);

            downloadUrl = `${publicUrlData.publicUrl}?download=${encodeURIComponent(fileName)}`;
        } catch (error) {
            console.error("Supabase Storage Upload Error:", error);
            const target = catalogData.find(b => b.id === tempBook.id);
            if (target) target.status = 'failed';
            filterAdminBooks();
            showToast(`Upload failed: ${error.message}`);
            return;
        }
    }

    const payload = {
        title, author, category, year, pages,
        is_for_sale: isForSale,
        price,
        download_url: downloadUrl,
        cover_url: finalCoverUrl,
        description,
        gradient: existingBook ? existingBook.gradient : "from-blue-900 via-indigo-900 to-slate-900",
        is_visible: !isDraft,
        status: isDraft ? 'draft' : 'published'
    };

    let dbError = null;
    if (editId) {
        const { error } = await supabaseClient.from('books').update(payload).eq('id', editId);
        dbError = error;
    } else {
        const { error } = await supabaseClient.from('books').insert([payload]);
        dbError = error;
    }

    if (dbError) {
        console.error("Supabase Save Error:", dbError);
        showToast(`Save failed: ${dbError.message}`);
        return;
    }

    showToast(isDraft ? `Draft "${title}" saved!` : `Archive "${title}" published!`);
    await fetchAllData();
}

// ==========================================
// RECYCLE BIN, SUBMISSIONS, USER BOOKS, STATS & FORUM MOD
// ==========================================

async function promptDelete(id) {
    await supabaseClient
        .from('books')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

    await fetchAllData();
    showToast("Moved to Recycle Bin.");
}

function renderTrashTable() {
    const tbody = document.getElementById('trash-table-body');
    const badge = document.getElementById('trash-badge');
    if (badge) badge.innerText = trashData.length;
    if (!tbody) return;

    tbody.innerHTML = '';

    if (trashData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-accord-muted">Recycle Bin is empty.</td></tr>`;
        return;
    }

    trashData.forEach(book => {
        const deletedDate = new Date(book.deleted_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric'
        });

        const viewUrl = book.download_url
            ? (book.download_url.includes('/archive-files/') ? book.download_url.split('?')[0] : book.download_url)
            : '';

        const viewBtn = viewUrl
            ? `<a href="${escapeHTML(viewUrl)}" target="_blank" rel="noopener noreferrer" class="w-8 h-8 rounded-xl bg-accord-lightBlue hover:bg-accord-blue text-accord-blue hover:text-white transition-all inline-flex items-center justify-center" title="View & Read Book"><i class="fa-solid fa-book-open-reader text-xs"></i></a>`
            : `<button disabled class="w-8 h-8 rounded-xl bg-slate-100 text-slate-300 cursor-not-allowed inline-flex items-center justify-center" title="No PDF available"><i class="fa-solid fa-book-open-reader text-xs"></i></button>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate">${escapeHTML(book.title)}</td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(book.author)}</td>
            <td class="py-4 px-6"><span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${escapeHTML(book.category)}</span></td>
            <td class="py-4 px-6 text-accord-muted">${deletedDate}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${viewBtn}
                <button onclick="restoreFromTrash(${book.id})" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all" title="Restore to Catalog">
                    <i class="fa-solid fa-rotate-left mr-1"></i> Restore
                </button>
                <button onclick="promptPermanentDelete(${book.id})" class="bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all" title="Delete Forever">
                    <i class="fa-solid fa-trash mr-1"></i> Delete Forever
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function restoreFromTrash(id) {
    await supabaseClient
        .from('books')
        .update({ deleted_at: null })
        .eq('id', id);

    await fetchAllData();
    showToast("Archive restored to live catalog!");
}

function promptPermanentDelete(id) {
    deleteTargetId = id;
    document.getElementById('confirm-title').innerText = "Delete Permanently?";
    document.getElementById('confirm-text').innerText = "This will permanently remove the book and its PDF/cover files from storage. This cannot be undone.";
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('confirm-btn').onclick = function() {
        executePermanentDelete(deleteTargetId);
    };
}

function promptEmptyTrash() {
    if (trashData.length === 0) {
        showToast("Recycle Bin is already empty.");
        return;
    }
    document.getElementById('confirm-title').innerText = "Empty Recycle Bin?";
    document.getElementById('confirm-text').innerText = `Permanently delete all ${trashData.length} item(s) in the Recycle Bin? This cannot be undone.`;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('confirm-btn').onclick = async function() {
        for (const item of [...trashData]) {
            await removeStorageFile(item.download_url);
            await removeStorageFile(item.cover_url);
            await supabaseClient.from('books').delete().eq('id', item.id);
        }
        closeConfirmModal();
        await fetchAllData();
        showToast("Recycle Bin emptied.");
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    deleteTargetId = null;
}

async function removeStorageFile(fileUrl) {
    if (!fileUrl || !fileUrl.includes('/archive-files/')) return;
    try {
        const filePath = decodeURIComponent(fileUrl.split('/archive-files/')[1].split('?')[0]);
        await supabaseClient.storage.from('archive-files').remove([filePath]);
    } catch (e) {}
}

async function executePermanentDelete(id) {
    const book = trashData.find(b => b.id === id);
    if (book) {
        await removeStorageFile(book.download_url);
        await removeStorageFile(book.cover_url);
    }
    await supabaseClient.from('books').delete().eq('id', id);
    closeConfirmModal();
    await fetchAllData();
    showToast("Archive permanently deleted.");
}

function renderSubmissionsTable() {
    const tbody = document.getElementById('submissions-table-body');
    const subBadge = document.getElementById('submitted-subtab-badge');
    if (subBadge) subBadge.innerText = submissionsData.length;

    if (!tbody) return;
    tbody.innerHTML = '';

    if (submissionsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-accord-muted">No submitted manuscript reviews at this time.</td></tr>`;
        return;
    }

    submissionsData.forEach(sub => {
        let pdfUrl = sub.download_url || '';
        let cleanDesc = sub.description || '';
        const urlMatch = cleanDesc.match(/\[Attached Manuscript PDF:\s*(https?:\/\/[^\s\]]+)\]/i);
        if (!pdfUrl && urlMatch) {
            pdfUrl = urlMatch[1];
            cleanDesc = cleanDesc.replace(urlMatch[0], '').trim();
        }

        const pdfBadge = pdfUrl
            ? `<a href="${escapeHTML(pdfUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center space-x-1 bg-blue-50 hover:bg-accord-blue text-accord-blue hover:text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all mt-1.5">
                   <i class="fa-solid fa-file-pdf"></i>
                   <span>View Uploaded Manuscript PDF</span>
               </a>`
            : `<span class="inline-block text-[10px] text-slate-400 mt-1">No PDF file attached</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${escapeHTML(sub.name)}</p>
                <p class="text-[10px] text-accord-muted">${escapeHTML(sub.email)}</p>
            </td>
            <td class="py-4 px-6 font-bold text-accord-slate">${escapeHTML(sub.title)}</td>
            <td class="py-4 px-6"><span class="bg-amber-50 text-accord-gold text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${escapeHTML(sub.category)}</span></td>
            <td class="py-4 px-6 text-accord-muted max-w-xs">
                <p class="line-clamp-2">${escapeHTML(cleanDesc)}</p>
                ${pdfBadge}
            </td>
            <td class="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                <button onclick="approveSubmission(${sub.id})" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl shadow-sm transition-all"><i class="fa-solid fa-check mr-1"></i> Approve</button>
                <button onclick="rejectSubmission(${sub.id})" class="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all"><i class="fa-solid fa-xmark mr-1"></i> Reject</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function approveSubmission(id) {
    const sub = submissionsData.find(s => s.id === id);
    if (sub) {
        let pdfUrl = sub.download_url || '';
        let cleanDesc = sub.description || '';
        const urlMatch = cleanDesc.match(/\[Attached Manuscript PDF:\s*(https?:\/\/[^\s\]]+)\]/i);
        if (!pdfUrl && urlMatch) {
            pdfUrl = urlMatch[1];
            cleanDesc = cleanDesc.replace(urlMatch[0], '').trim();
        }

        await supabaseClient.from('books').insert([{
            title: sub.title,
            author: sub.name,
            category: sub.category,
            year: new Date().getFullYear().toString(),
            pages: "TBD",
            is_for_sale: false,
            price: 0,
            download_url: pdfUrl,
            cover_url: "",
            description: cleanDesc,
            gradient: "from-blue-900 via-blue-800 to-indigo-950",
            is_visible: true,
            status: 'published'
        }]);
        await supabaseClient.from('submissions').delete().eq('id', id);
        await fetchAllData();
        showToast(`Submission "${sub.title}" approved and published!`);
    }
}

async function rejectSubmission(id) {
    await supabaseClient.from('submissions').delete().eq('id', id);
    await fetchAllData();
    showToast("Submission rejected and removed.");
}

function renderUserBookSubmissionsTable() {
    const tbody = document.getElementById('user-books-table-body');
    const badge = document.getElementById('user-books-subtab-badge');
    if (badge) badge.innerText = userBookSubmissionsData.length;
    if (!tbody) return;

    tbody.innerHTML = '';

    if (userBookSubmissionsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-accord-muted">No user book submissions awaiting approval.</td></tr>`;
        return;
    }

    userBookSubmissionsData.forEach(item => {
        const priceBadge = item.is_for_sale
            ? `<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">For Sale • USD ${Number(item.price || 0).toFixed(2)}</span>`
            : `<span class="bg-blue-50 text-accord-blue text-[10px] font-bold px-2 py-0.5 rounded">Free Book</span>`;

        const pdfLink = item.download_url
            ? `<a href="${escapeHTML(item.download_url)}" target="_blank" rel="noopener noreferrer" class="text-accord-blue hover:underline text-[11px] font-bold"><i class="fa-solid fa-file-pdf mr-1"></i>Preview File</a>`
            : `<span class="text-[10px] text-slate-400">No file</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${escapeHTML(item.submitter_name)}</p>
                <p class="text-[10px] text-accord-muted">${escapeHTML(item.submitter_email)}</p>
            </td>
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${escapeHTML(item.title)}</p>
                <p class="text-[10px] text-accord-muted">By ${escapeHTML(item.author)}</p>
            </td>
            <td class="py-4 px-6"><span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-md">${escapeHTML(item.category)}</span></td>
            <td class="py-4 px-6">${priceBadge}</td>
            <td class="py-4 px-6">${pdfLink}</td>
            <td class="py-4 px-6 text-right space-x-2 whitespace-nowrap">
                <button onclick="approveUserBookSubmission('${item.id}')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl shadow-sm transition-all"><i class="fa-solid fa-check mr-1"></i> Approve</button>
                <button onclick="rejectUserBookSubmission('${item.id}')" class="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all"><i class="fa-solid fa-xmark mr-1"></i> Reject</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function approveUserBookSubmission(id) {
    const submission = userBookSubmissionsData.find(s => String(s.id) === String(id));
    if (!submission) return;

    const { error: insertErr } = await supabaseClient.from('books').insert([{
        title: submission.title,
        author: submission.author,
        category: submission.category,
        year: submission.year || new Date().getFullYear().toString(),
        pages: submission.pages || 'TBD',
        description: submission.description,
        download_url: submission.download_url || '',
        cover_url: submission.cover_url || '',
        is_for_sale: Boolean(submission.is_for_sale),
        price: submission.is_for_sale ? (Number(submission.price) || 0) : 0,
        gradient: 'from-blue-900 via-indigo-900 to-slate-900',
        is_visible: true,
        status: 'published'
    }]);

    if (insertErr) {
        showToast(`Could not publish book: ${insertErr.message}`);
        return;
    }

    await supabaseClient
        .from('user_book_submissions')
        .update({ approval_status: 'approved' })
        .eq('id', id);

    await fetchAllData();
    showToast(`"${submission.title}" approved and published to the library.`);
}

async function rejectUserBookSubmission(id) {
    await supabaseClient
        .from('user_book_submissions')
        .update({ approval_status: 'rejected' })
        .eq('id', id);

    await fetchAllData();
    showToast("User book submission rejected.");
}

function updateStats() {
    document.getElementById('stat-total').innerText = catalogData.length;

    const totalDownloads = catalogData.reduce((sum, book) => sum + (Number(book.downloads) || 0), 0);
    const downloadsEl = document.getElementById('stat-downloads');
    if (downloadsEl) {
        downloadsEl.innerText = totalDownloads.toLocaleString();
    }

    const totalRevenue = purchasesData.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0);
    const salesSummaryEl = document.getElementById('stat-sales-summary');
    if (salesSummaryEl) {
        salesSummaryEl.innerHTML = `
            <span>${purchasesData.length} sold • USD ${totalRevenue.toFixed(2)}</span>
            <i class="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-0.5 transition-transform"></i>
        `;
    }

    const draftCount = catalogData.filter(b => b.status === 'draft' || b.is_visible === false).length;
    const totalPending = draftCount + submissionsData.length + userBookSubmissionsData.length;

    const statPendingEl = document.getElementById('stat-pending');
    if (statPendingEl) statPendingEl.innerText = totalPending;

    const pendingBadgeEl = document.getElementById('pending-badge');
    if (pendingBadgeEl) pendingBadgeEl.innerText = totalPending;
}

function renderDownloadsTable() {
    const tbody = document.getElementById('downloads-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (catalogData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-accord-muted">No publications in the catalog yet.</td></tr>`;
        return;
    }

    const salesByBook = {};
    purchasesData.forEach(p => {
        const key = Number(p.book_id);
        if (!salesByBook[key]) {
            salesByBook[key] = { count: 0, revenue: 0 };
        }
        salesByBook[key].count += 1;
        salesByBook[key].revenue += Number(p.amount_paid) || 0;
    });

    const sortedBooks = [...catalogData].sort((a, b) => {
        const scoreA = (Number(a.downloads) || 0) + (salesByBook[Number(a.id)]?.count || 0);
        const scoreB = (Number(b.downloads) || 0) + (salesByBook[Number(b.id)]?.count || 0);
        return scoreB - scoreA;
    });

    const maxDownloads = Math.max(...sortedBooks.map(b => Number(b.downloads) || 0), 1);

    sortedBooks.forEach((book, index) => {
        const count = Number(book.downloads) || 0;
        const barWidth = Math.round((count / maxDownloads) * 100);
        const bookSales = salesByBook[Number(book.id)] || { count: 0, revenue: 0 };

        const thumb = book.cover_url
            ? `<img src="${escapeHTML(book.cover_url)}" class="w-8 h-11 rounded-lg object-cover border border-slate-200 shrink-0" loading="lazy">`
            : `<div class="w-8 h-11 rounded-lg bg-accord-lightBlue text-accord-blue flex items-center justify-center font-bold text-xs shrink-0"><i class="fa-solid fa-book"></i></div>`;

        const salesCell = book.is_for_sale
            ? `<div class="inline-flex flex-col items-end">
                   <span class="font-extrabold text-xs text-emerald-700">USD ${bookSales.revenue.toFixed(2)}</span>
                   <span class="text-[10px] text-accord-muted font-semibold">${bookSales.count} ${bookSales.count === 1 ? 'copy' : 'copies'} sold @ USD ${Number(book.price || 0).toFixed(2)}</span>
               </div>`
            : `<span class="text-[11px] text-accord-muted">Free Archive</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 text-center font-extrabold text-accord-muted">#${index + 1}</td>
            <td class="py-4 px-6 font-bold text-accord-slate flex items-center space-x-3">
                ${thumb}
                <div>
                    <p>${escapeHTML(book.title)}</p>
                    ${book.is_for_sale ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 mt-0.5"><i class="fa-solid fa-tag mr-1"></i> For Sale</span>` : ''}
                </div>
            </td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(book.author)}</td>
            <td class="py-4 px-6"><span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${escapeHTML(book.category)}</span></td>
            <td class="py-4 px-6 text-right">${salesCell}</td>
            <td class="py-4 px-6 text-right">
                <div class="inline-flex flex-col items-end min-w-[90px]">
                    <span class="font-extrabold text-sm text-accord-slate">${count.toLocaleString()}</span>
                    <div class="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                        <div class="h-full bg-purple-600 rounded-full" style="width: ${barWidth}%"></div>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderForumModeration() {
    const tBody = document.getElementById('mod-testimonies-body');
    const cBody = document.getElementById('mod-comments-body');
    const badge = document.getElementById('forum-badge');

    if (badge) badge.innerText = testimoniesModData.length;
    if (document.getElementById('mod-testimony-count')) {
        document.getElementById('mod-testimony-count').innerText = `${testimoniesModData.length} posts`;
    }
    if (document.getElementById('mod-comment-count')) {
        document.getElementById('mod-comment-count').innerText = `${commentsModData.length} comments`;
    }

    if (tBody) {
        tBody.innerHTML = '';
        if (testimoniesModData.length === 0) {
            tBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-accord-muted">No testimonies posted yet.</td></tr>`;
        } else {
            testimoniesModData.forEach(item => {
                const isApproved = item.is_approved !== false;
                const statusPill = isApproved
                    ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Live</span>`
                    : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">Hidden</span>`;

                const toggleBtn = isApproved
                    ? `<button onclick="toggleTestimonyApproval(${item.id}, false)" class="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-amber-50 text-emerald-600 hover:text-amber-600 transition-all inline-flex items-center justify-center" title="Hide off-topic testimony"><i class="fa-solid fa-eye text-xs"></i></button>`
                    : `<button onclick="toggleTestimonyApproval(${item.id}, true)" class="w-8 h-8 rounded-xl bg-slate-200 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 transition-all inline-flex items-center justify-center" title="Approve & restore to forum"><i class="fa-solid fa-eye-slash text-xs"></i></button>`;

                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
                tr.innerHTML = `
                    <td class="py-4 px-6">
                        <p class="font-bold text-accord-slate">${escapeHTML(item.author_name)}</p>
                        <p class="text-[10px] text-accord-muted">${escapeHTML(item.location || 'Location not specified')}</p>
                    </td>
                    <td class="py-4 px-6 max-w-md">
                        <p class="font-bold text-accord-slate mb-0.5">${escapeHTML(item.title)}</p>
                        <p class="text-[11px] text-accord-muted line-clamp-2">${escapeHTML(item.body)}</p>
                    </td>
                    <td class="py-4 px-6"><span class="bg-amber-50 text-accord-gold text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${escapeHTML(item.category)}</span></td>
                    <td class="py-4 px-6 text-center">${statusPill}</td>
                    <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                        ${toggleBtn}
                        <button onclick="deleteModTestimony(${item.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete permanently">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </td>
                `;
                tBody.appendChild(tr);
            });
        }
    }

    if (cBody) {
        cBody.innerHTML = '';
        if (commentsModData.length === 0) {
            cBody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-accord-muted">No reader comments yet.</td></tr>`;
        } else {
            commentsModData.forEach(c => {
                const parent = testimoniesModData.find(t => Number(t.id) === Number(c.testimony_id));
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
                tr.innerHTML = `
                    <td class="py-3.5 px-6 font-bold text-accord-slate">${escapeHTML(c.author_name)}</td>
                    <td class="py-3.5 px-6 text-accord-muted max-w-[180px] truncate">${escapeHTML(parent ? parent.title : `Post #${c.testimony_id}`)}</td>
                    <td class="py-3.5 px-6 text-slate-700 max-w-md">${escapeHTML(c.comment_text)}</td>
                    <td class="py-3.5 px-6 text-right">
                        <button onclick="deleteModComment(${c.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Remove off-topic comment">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </td>
                `;
                cBody.appendChild(tr);
            });
        }
    }
}

async function toggleTestimonyApproval(id, makeApproved) {
    const { error } = await supabaseClient
        .from('testimonies')
        .update({ is_approved: makeApproved })
        .eq('id', id);

    if (!error) {
        await fetchAllData();
        showToast(makeApproved ? "Testimony is now visible on the forum." : "Testimony hidden from public view.");
    } else {
        showToast(`Action failed: ${error.message}`);
    }
}

async function deleteModTestimony(id) {
    await supabaseClient.from('testimonies').delete().eq('id', id);
    await fetchAllData();
    showToast("Testimony permanently deleted.");
}

async function deleteModComment(id) {
    await supabaseClient.from('testimony_comments').delete().eq('id', id);
    await fetchAllData();
    showToast("Comment removed.");
}

async function exportApprovedTestimonies() {
    const approved = testimoniesModData.filter(t => t.is_approved !== false);
    if (approved.length === 0) {
        showToast("No approved testimonies to export yet.");
        return;
    }

    const compiledText = approved.map((t, i) => (
        `CHAPTER ${i + 1}: ${t.title.toUpperCase()}\n` +
        `By ${t.author_name}${t.location ? ` (${t.location})` : ''} | Theme: ${t.category}\n` +
        `----------------------------------------\n` +
        `${t.body}\n`
    )).join('\n========================================\n\n');

    await navigator.clipboard.writeText(compiledText);
    showToast(`Copied ${approved.length} approved testimonies to clipboard for book compilation!`);
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

// ==========================================
// FILE & IMAGE COMPRESSION EVENT LISTENERS
// ==========================================

document.getElementById('form-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const fileNameDisplay = document.getElementById('file-name-display');
    const uploadUi = document.getElementById('upload-ui');
    const titleInput = document.getElementById('form-title');
    const pageInput = document.getElementById('form-pages');

    if (file) {
        if (fileNameDisplay) {
            fileNameDisplay.textContent = file.name;
            fileNameDisplay.classList.add('text-accord-blue', 'font-bold');
        }
        if (uploadUi) {
            uploadUi.classList.add('border-accord-blue', 'bg-accord-lightBlue');
        }

        if (titleInput && !titleInput.value) {
            titleInput.value = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
        }

        if (file.type === 'application/pdf' && typeof pdfjsLib !== 'undefined' && pageInput) {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                try {
                    const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
                    pageInput.value = pdf.numPages;
                } catch {
                    pageInput.value = 'TBD';
                }
            };
            fileReader.readAsArrayBuffer(file);
        }
    }
});

document.getElementById('form-cover')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const previewBox = document.getElementById('cover-preview-box');
    const coverName = document.getElementById('cover-name-display');

    if (file) {
        if (coverName) {
            coverName.textContent = file.name;
            coverName.classList.add('text-accord-blue', 'font-bold');
        }

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 480;
                const scale = Math.min(1, MAX_WIDTH / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                currentCompressedCover = canvas.toDataURL('image/webp', 0.80);
                if (previewBox) {
                    previewBox.innerHTML = `<img src="${currentCompressedCover}" class="w-full h-full object-cover">`;
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Desktop Banner Upload Auto-Compressor (1920px Max Width WebP)
document.getElementById('banner-desktop-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const previewBox = document.getElementById('banner-desktop-preview');
    const nameLabel = document.getElementById('banner-desktop-filename');
    if (!file) return;

    if (nameLabel) {
        nameLabel.textContent = file.name;
        nameLabel.classList.add('text-accord-blue', 'font-bold');
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1920;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            currentBannerDesktopCompressed = canvas.toDataURL('image/webp', 0.85);
            if (previewBox) {
                previewBox.innerHTML = `<img src="${currentBannerDesktopCompressed}" class="w-full h-full object-cover">`;
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// Mobile Banner Upload Auto-Compressor (1080px Max Width WebP)
document.getElementById('banner-mobile-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const previewBox = document.getElementById('banner-mobile-preview');
    const nameLabel = document.getElementById('banner-mobile-filename');
    if (!file) return;

    if (nameLabel) {
        nameLabel.textContent = file.name;
        nameLabel.classList.add('text-accord-blue', 'font-bold');
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1080;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            currentBannerMobileCompressed = canvas.toDataURL('image/webp', 0.85);
            if (previewBox) {
                previewBox.innerHTML = `<img src="${currentBannerMobileCompressed}" class="w-full h-full object-cover">`;
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

async function approveBookTakedown(bookId) {
    const { error } = await supabaseClient
        .from('books')
        .update({
            takedown_status: 'approved',
            is_visible: false,
            deleted_at: new Date().toISOString()
        })
        .eq('id', bookId);

    if (error) {
        showToast(`Could not approve takedown: ${error.message}`);
        return;
    }

    await fetchAllData();
    showToast('Takedown approved and book moved to Recycle Bin.');
}

async function rejectBookTakedown(bookId) {
    const { error } = await supabaseClient
        .from('books')
        .update({ takedown_status: 'rejected' })
        .eq('id', bookId);

    if (error) {
        showToast(`Could not reject takedown: ${error.message}`);
        return;
    }

    await fetchAllData();
    showToast('Takedown request rejected.');
}