// =========================================================
// ACCORD AUTHOR.JS
// Book Uploads, Author Metrics, Earnings & Withdrawals, Hide Toggle & Takedown Requests
// =========================================================

let authorUser = null;
let authorProfile = null;
let managedAuthorPages = [];
let activeAuthorPageId = '';
let authorBooks = [];
let authorWithdrawals = [];
let salesStatsByBook = {};
let availableBalance = 0;

function getActiveAuthorContext() {
    if (activeAuthorPageId) {
        const entry = managedAuthorPages.find(p => String(p.page.id) === String(activeAuthorPageId));
        if (entry) {
            return {
                isOwn: false,
                targetAuthorId: entry.page.id,
                targetAuthorName: entry.page.full_name || entry.page.email || 'Verified Page',
                targetAuthorEmail: entry.page.email || '',
                canPostBooks: Boolean(entry.perms.can_post_books),
                canWithdrawFunds: Boolean(entry.perms.can_withdraw_funds)
            };
        }
    }
    return {
        isOwn: true,
        targetAuthorId: authorUser?.id || null,
        targetAuthorName: getAuthorDisplayName(),
        targetAuthorEmail: authorUser?.email || '',
        canPostBooks: true,
        canWithdrawFunds: true
    };
}

async function loadManagedAuthorPages() {
    managedAuthorPages = [];
    if (!authorUser) return;
    try {
        const [{ data: myProf }, { data: adminRows }] = await Promise.all([
            supabaseClient.from('profiles').select('id, full_name, handle, email').eq('id', authorUser.id).maybeSingle(),
            supabaseClient
                .from('page_admins')
                .select('page_id, role, permissions, profiles!page_admins_page_id_fkey(id, full_name, handle, email, account_type, upgrade_status)')
                .eq('admin_user_id', authorUser.id)
        ]);
        authorProfile = myProf || null;
        managedAuthorPages = (adminRows || [])
            .filter(r => {
                const prof = r.profiles;
                const isVerified = prof && (prof.account_type === 'ministry_minister' || prof.upgrade_status === 'approved') && prof.upgrade_status !== 'revoked';
                if (!isVerified) return false;
                const p = r.permissions && typeof r.permissions === 'object' ? r.permissions : {};
                return Boolean(p.can_post_books) || Boolean(p.can_withdraw_funds);
            })
            .map(r => {
                const p = r.permissions && typeof r.permissions === 'object' ? r.permissions : {};
                return {
                    page: r.profiles,
                    perms: {
                        can_post_books: Boolean(p.can_post_books),
                        can_withdraw_funds: Boolean(p.can_withdraw_funds)
                    }
                };
            });
    } catch {
        managedAuthorPages = [];
    }

    const params = new URLSearchParams(window.location.search);
    const reqPage = params.get('page');
    if (reqPage && managedAuthorPages.some(e => String(e.page.id) === String(reqPage))) {
        activeAuthorPageId = reqPage;
    }
    syncAuthorContextSwitcher();
}

function syncAuthorContextSwitcher() {
    const wrap = document.getElementById('author-page-switcher-wrap');
    const sel = document.getElementById('author-page-select');
    if (wrap && sel) {
        if (managedAuthorPages.length === 0) {
            wrap.classList.add('hidden');
        } else {
            const selfName = getAuthorDisplayName();
            sel.innerHTML = [
                `<option value="">Myself (${escapeAuthorHtml(selfName)})</option>`,
                ...managedAuthorPages.map(e => `<option value="${escapeAuthorHtml(e.page.id)}">${escapeAuthorHtml(e.page.full_name || 'Verified Page')} (Verified Page)</option>`)
            ].join('');
            sel.value = activeAuthorPageId;
            wrap.classList.remove('hidden');
        }
    }
    syncAuthorPermissionButtons();
}

function syncAuthorPermissionButtons() {
    const ctx = getActiveAuthorContext();
    const uploadTop = document.getElementById('author-upload-btn-top');
    const uploadTable = document.getElementById('author-upload-btn-table');
    const withdrawBtn = document.getElementById('author-withdraw-btn');
    const noteEl = document.getElementById('author-context-perms-note');

    [uploadTop, uploadTable].forEach(btn => {
        if (!btn) return;
        btn.disabled = !ctx.canPostBooks;
        btn.classList.toggle('opacity-50', !ctx.canPostBooks);
        btn.classList.toggle('cursor-not-allowed', !ctx.canPostBooks);
        btn.title = ctx.canPostBooks ? '' : 'You do not have Book Management permission for this page.';
    });

    if (withdrawBtn) {
        withdrawBtn.disabled = !ctx.canWithdrawFunds;
        withdrawBtn.classList.toggle('opacity-50', !ctx.canWithdrawFunds);
        withdrawBtn.classList.toggle('cursor-not-allowed', !ctx.canWithdrawFunds);
        withdrawBtn.title = ctx.canWithdrawFunds ? '' : 'You do not have Withdrawal permission for this page.';
    }

    if (noteEl) {
        if (ctx.isOwn) {
            noteEl.textContent = '';
        } else {
            const caps = [
                ctx.canPostBooks ? 'Books' : null,
                ctx.canWithdrawFunds ? 'Withdraw Funds' : null
            ].filter(Boolean).join(' & ');
            noteEl.textContent = caps ? `Powers on this page: ${caps}` : 'View only';
        }
    }
}

async function handleAuthorContextChange() {
    const sel = document.getElementById('author-page-select');
    activeAuthorPageId = sel?.value || '';
    syncAuthorPermissionButtons();
    await loadAuthorDashboardData();
}

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof supabaseClient === 'undefined') return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
        window.location.href = 'signin.html?next=author.html';
        return;
    }

    authorUser = session.user;
    syncAuthorHeaderLabels();
    bindAuthorUploadListeners();
    await Promise.all([loadAuthorCategories(), loadManagedAuthorPages()]);
    await loadAuthorDashboardData();
});

function getAuthorDisplayName() {
    return (
        authorUser?.user_metadata?.full_name ||
        authorUser?.user_metadata?.name ||
        authorUser?.email?.split('@')[0] ||
        'Author'
    );
}

function syncAuthorHeaderLabels() {
    const displayName = getAuthorDisplayName();
    const navLabel = document.getElementById('auth-nav-label');
    const mobileLabel = document.getElementById('mobile-auth-label');
    const subtitle = document.getElementById('author-subtitle');

    if (navLabel) navLabel.textContent = displayName;
    if (mobileLabel) mobileLabel.textContent = `Account (${displayName})`;
    if (subtitle) {
        subtitle.textContent = `Signed in as ${displayName} (${authorUser.email}). Upload books, manage visibility, request takedowns, and withdraw earnings.`;
    }
}

function bindAuthorUploadListeners() {
    const pdfInput = document.getElementById('upload-book-pdf');
    if (pdfInput) {
        pdfInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            const metaEl = document.getElementById('upload-pdf-meta');
            const pagesInput = document.getElementById('upload-book-pages');
            if (!file) {
                if (metaEl) metaEl.textContent = 'PDF up to 50MB, or provide an external PDF link below.';
                if (pagesInput) pagesInput.value = 'TBD';
                return;
            }

            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            let detectedPages = 'TBD';

            if (window.pdfjsLib && file.type === 'application/pdf') {
                try {
                    const buf = await file.arrayBuffer();
                    const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
                    detectedPages = String(pdfDoc.numPages || 'TBD');
                } catch (_) {
                    detectedPages = 'TBD';
                }
            }

            if (pagesInput) pagesInput.value = detectedPages;
            if (metaEl) {
                metaEl.textContent = `${file.name} (${sizeMb} MB${detectedPages !== 'TBD' ? ` • ${detectedPages} pages` : ''})`;
            }
        });
    }
}

async function loadAuthorCategories() {
    const select = document.getElementById('upload-book-category');
    if (!select) return;

    const { data, error } = await supabaseClient
        .from('categories')
        .select('name')
        .order('name', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
        const names = data
            .map(c => c.name)
            .filter(name => name && !String(name).startsWith('__ACCORD_'));
        if (names.length > 0) {
            select.innerHTML = names
                .map(name => `<option value="${escapeAuthorHtml(name)}">${escapeAuthorHtml(name)}</option>`)
                .join('');
        }
    }
}

function openUploadBookModal() {
    const ctx = getActiveAuthorContext();
    if (!ctx.canPostBooks) {
        showToast('You do not have permission to post books for this verified page.', true);
        return;
    }
    document.getElementById('upload-book-form')?.reset();
    const authorInput = document.getElementById('upload-book-author');
    const yearInput = document.getElementById('upload-book-year');
    const pagesInput = document.getElementById('upload-book-pages');
    const metaEl = document.getElementById('upload-pdf-meta');

    if (authorInput) authorInput.value = ctx.targetAuthorName || getAuthorDisplayName();
    if (yearInput) yearInput.value = String(new Date().getFullYear());
    if (pagesInput) pagesInput.value = 'TBD';
    if (metaEl) metaEl.textContent = 'PDF up to 50MB, or provide an external PDF link below.';

    toggleUploadPriceField();
    const modal = document.getElementById('upload-book-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeUploadBookModal() {
    const modal = document.getElementById('upload-book-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

function toggleUploadPriceField() {
    const isForSale = document.getElementById('upload-book-access')?.value === 'true';
    const wrapper = document.getElementById('upload-price-wrapper');
    const priceInput = document.getElementById('upload-book-price');

    wrapper?.classList.toggle('hidden', !isForSale);
    if (priceInput) {
        priceInput.required = isForSale;
        if (!isForSale) priceInput.value = '';
    }
}

async function uploadAuthorFile(file, folder = '') {
    const originalName = file.name || 'document.pdf';
    const lastDotIndex = originalName.lastIndexOf('.');
    const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
    const fileExtension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '.pdf';
    const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${cleanName}_acc${Date.now()}${fileExtension}`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('archive-files')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
        });

    if (uploadError) {
        console.error('Supabase Storage Upload Error:', uploadError);
        throw new Error(uploadError.message || 'Storage upload failed.');
    }

    const { data: publicUrlData } = supabaseClient.storage
        .from('archive-files')
        .getPublicUrl(uploadData.path);

    return folder === 'covers'
        ? publicUrlData.publicUrl
        : `${publicUrlData.publicUrl}?download=${encodeURIComponent(fileName)}`;
}

async function handleAuthorBookUpload(e) {
    e.preventDefault();

    const title = document.getElementById('upload-book-title').value.trim();
    const authorName = document.getElementById('upload-book-author').value.trim() || getAuthorDisplayName();
    const category = document.getElementById('upload-book-category').value.trim() || 'General';
    const year = document.getElementById('upload-book-year').value.trim() || String(new Date().getFullYear());
    const pages = document.getElementById('upload-book-pages').value.trim() || 'TBD';
    const isForSale = document.getElementById('upload-book-access').value === 'true';
    const price = isForSale ? (parseFloat(document.getElementById('upload-book-price').value) || 0) : 0;
    const description = document.getElementById('upload-book-description').value.trim();

    const pdfFile = document.getElementById('upload-book-pdf').files?.[0] || null;
    const coverFile = document.getElementById('upload-book-cover').files?.[0] || null;
    const externalUrl = document.getElementById('upload-book-url').value.trim();

    const rightsBasis = document.getElementById('upload-rights-basis')?.value || 'original_author';
    const rightsStatement = document.getElementById('upload-rights-statement')?.value.trim() || '';
    const rightsProofUrl = document.getElementById('upload-rights-proof-url')?.value.trim() || '';
    const rightsAttested = Boolean(document.getElementById('upload-rights-attestation')?.checked);

    if (!title || !description) {
        showToast('Please enter both a book title and description.', true);
        return;
    }

    if (rightsStatement.length < 15 || !rightsAttested) {
        showToast('Please complete the Publishing Rights statement and attestation.', true);
        return;
    }

    if (!pdfFile && !externalUrl) {
        showToast('Please attach a PDF file or enter an external PDF URL.', true);
        return;
    }

    if (pdfFile && pdfFile.size > 50 * 1024 * 1024) {
        showToast('PDF file must be 50MB or smaller.', true);
        return;
    }

    const submitBtn = document.getElementById('upload-book-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading...';
    }

    try {
        let downloadUrl = externalUrl || '';
        let coverUrl = '';

        if (pdfFile) {
            downloadUrl = await uploadAuthorFile(pdfFile);
        }
        if (coverFile) {
            coverUrl = await uploadAuthorFile(coverFile, 'covers');
        }

        const ctx = getActiveAuthorContext();
        if (!ctx.canPostBooks) {
            throw new Error('You do not have permission to post books for this verified page.');
        }

        const bookPayload = {
            title,
            author: authorName,
            author_id: ctx.targetAuthorId,
            category,
            year,
            pages,
            description,
            download_url: downloadUrl,
            cover_url: coverUrl,
            is_for_sale: isForSale,
            price,
            gradient: 'from-blue-900 via-indigo-900 to-slate-900',
            is_visible: false,
            status: 'draft',
            takedown_status: 'none',
            rights_basis: rightsBasis,
            rights_statement: rightsStatement,
            rights_proof_url: rightsProofUrl || null,
            rights_verified: false,
            copyright_status: 'clear'
        };

        const { data: insertedBook, error: bookError } = await supabaseClient
            .from('books')
            .insert([bookPayload])
            .select()
            .single();

        if (bookError) {
            throw new Error(bookError.message);
        }

        // Log in user_book_submissions so it appears under Library Admin > Pending Reviews
        await supabaseClient
            .from('user_book_submissions')
            .insert([{
                submitter_name: getAuthorDisplayName(),
                submitter_email: authorUser.email,
                title,
                author: authorName,
                category,
                year,
                pages,
                description,
                download_url: downloadUrl,
                cover_url: coverUrl,
                is_for_sale: isForSale,
                price,
                rights_basis: rightsBasis,
                rights_statement: rightsStatement,
                rights_proof_url: rightsProofUrl || null,
                approval_status: 'pending'
            }]);

        closeUploadBookModal();
        showToast('Book uploaded and sent for Library Admin review.');
        if (insertedBook) {
            authorBooks.unshift(insertedBook);
            renderAuthorMetrics();
            renderAuthorBooksTable();
        }
        await loadAuthorDashboardData();
    } catch (err) {
        showToast(`Upload failed: ${err.message}`, true);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Book';
        }
    }
}

function handleAuthNavClick() {
    window.location.href = 'profile.html';
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-lg'
            : 'fa-solid fa-circle-check text-accord-gold text-lg';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function escapeAuthorHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadAuthorDashboardData() {
    const ctx = getActiveAuthorContext();
    const targetId = ctx.targetAuthorId;
    if (!targetId) return;

    const [booksRes, withdrawalsRes] = await Promise.all([
        supabaseClient
            .from('books')
            .select('*')
            .eq('author_id', targetId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('author_withdrawals')
            .select('*')
            .eq('author_id', targetId)
            .order('created_at', { ascending: false })
    ]);

    authorBooks = (!booksRes.error && booksRes.data) ? booksRes.data : [];
    authorWithdrawals = (!withdrawalsRes.error && withdrawalsRes.data) ? withdrawalsRes.data : [];

    salesStatsByBook = {};
    const bookIds = authorBooks.map(b => b.id);
    if (bookIds.length > 0) {
        const { data: purchases } = await supabaseClient
            .from('user_purchases')
            .select('book_id, amount_paid')
            .in('book_id', bookIds);

        (purchases || []).forEach(p => {
            const key = Number(p.book_id);
            if (!salesStatsByBook[key]) {
                salesStatsByBook[key] = { count: 0, earned: 0 };
            }
            salesStatsByBook[key].count += 1;
            salesStatsByBook[key].earned += Number(p.amount_paid) || 0;
        });
    }

    renderAuthorMetrics();
    renderAuthorBooksTable();
    renderAuthorWithdrawalsTable();
}

function renderAuthorMetrics() {
    const uploadedCount = authorBooks.length;
    const totalDownloads = authorBooks.reduce((sum, b) => sum + (Number(b.downloads) || 0), 0);

    let totalSales = 0;
    let grossEarned = 0;
    authorBooks.forEach(b => {
        const stat = salesStatsByBook[Number(b.id)];
        if (stat) {
            totalSales += stat.count;
            grossEarned += stat.earned;
        }
    });

    const committedWithdrawals = authorWithdrawals
        .filter(w => w.status !== 'rejected')
        .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

    availableBalance = Math.max(0, grossEarned - committedWithdrawals);

    document.getElementById('metric-uploaded-count').textContent = uploadedCount.toLocaleString();
    document.getElementById('metric-downloads-count').textContent = totalDownloads.toLocaleString();
    document.getElementById('metric-sales-count').textContent = totalSales.toLocaleString();
    document.getElementById('metric-earned-amount').textContent = `USD ${availableBalance.toFixed(2)}`;
    document.getElementById('metric-withdrawn-note').textContent =
        `Gross: USD ${grossEarned.toFixed(2)} • Allocated: USD ${committedWithdrawals.toFixed(2)}`;
}

function renderAuthorBooksTable() {
    const tbody = document.getElementById('author-books-tbody');
    if (!tbody) return;

    if (authorBooks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-10 text-center space-y-3">
                    <p class="text-accord-muted">No books linked to your author account yet.</p>
                    <button type="button" onclick="openUploadBookModal()" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2 rounded-xl inline-flex items-center space-x-1.5">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span>Upload Your First Book</span>
                    </button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    authorBooks.forEach(book => {
        const downloads = Number(book.downloads) || 0;
        const stat = salesStatsByBook[Number(book.id)] || { count: 0, earned: 0 };
        const isVisible = book.is_visible !== false && book.status !== 'draft';
        const tdStatus = book.takedown_status || 'none';

        const visibilityPill = book.status === 'draft'
            ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Pending Review</span>`
            : isVisible
                ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Visible</span>`
                : `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Hidden</span>`;

        const hideToggleBtn = `
            <button type="button" onclick="toggleAuthorBookVisibility('${book.id}', ${!isVisible})" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-[11px] font-bold transition-all">
                <i class="fa-solid ${isVisible ? 'fa-eye-slash' : 'fa-eye'} mr-1"></i>
                ${isVisible ? 'Hide' : 'Show'}
            </button>
        `;

        let takedownActionHtml = '';
        if (tdStatus === 'pending') {
            takedownActionHtml = `
                <span class="inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <i class="fa-solid fa-clock mr-1"></i> Takedown Pending Admin
                </span>
            `;
        } else if (tdStatus === 'approved') {
            takedownActionHtml = `
                <span class="inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-bold bg-red-50 text-red-600">
                    Takedown Approved
                </span>
            `;
        } else {
            const safeTitle = escapeAuthorHtml(book.title).replace(/'/g, "\\'");
            takedownActionHtml = `
                <button type="button" onclick="openTakedownModal('${book.id}', '${safeTitle}')" class="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-bold transition-all">
                    <i class="fa-solid fa-flag mr-1"></i> Request Takedown
                </button>
            `;
        }

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/70 transition-colors';
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate text-sm">${escapeAuthorHtml(book.title)}</p>
                <p class="text-[11px] text-accord-muted">${escapeAuthorHtml(book.category || 'Archive')} • ${book.is_for_sale ? `USD ${Number(book.price || 0).toFixed(2)}` : 'Free'}</p>
            </td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${downloads.toLocaleString()}</td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${stat.count.toLocaleString()}</td>
            <td class="py-4 px-6 text-right font-extrabold text-emerald-700">USD ${stat.earned.toFixed(2)}</td>
            <td class="py-4 px-6 text-center">${visibilityPill}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${hideToggleBtn}
                ${takedownActionHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleAuthorBookVisibility(bookId, makeVisible) {
    const ctx = getActiveAuthorContext();
    if (!ctx.canPostBooks) {
        showToast('You do not have permission to manage books for this verified page.', true);
        return;
    }
    const updatePayload = makeVisible
        ? { is_visible: true, status: 'published' }
        : { is_visible: false };

    const { error } = await supabaseClient
        .from('books')
        .update(updatePayload)
        .eq('id', bookId)
        .eq('author_id', ctx.targetAuthorId);

    if (error) {
        showToast(`Could not update visibility: ${error.message}`, true);
        return;
    }

    showToast(makeVisible ? 'Book is now visible in the public library.' : 'Book hidden from the public library.');
    await loadAuthorDashboardData();
}

function openTakedownModal(bookId, title) {
    document.getElementById('takedown-book-id').value = bookId;
    document.getElementById('takedown-book-title').textContent = title;
    document.getElementById('takedown-reason').value = '';
    const modal = document.getElementById('takedown-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeTakedownModal() {
    const modal = document.getElementById('takedown-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleTakedownSubmit(e) {
    e.preventDefault();
    const bookId = document.getElementById('takedown-book-id').value;
    const reason = document.getElementById('takedown-reason').value.trim();
    const btn = document.getElementById('takedown-submit-btn');

    if (reason.length < 15) {
        showToast('Please provide a reason of at least 15 characters.', true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    const ctx = getActiveAuthorContext();
    if (!ctx.canPostBooks) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Submit Takedown Request';
        }
        showToast('You do not have permission to manage books for this verified page.', true);
        return;
    }

    const { error } = await supabaseClient
        .from('books')
        .update({
            takedown_status: 'pending',
            takedown_reason: reason,
            takedown_requested_at: new Date().toISOString()
        })
        .eq('id', bookId)
        .eq('author_id', ctx.targetAuthorId);

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Takedown Request';
    }

    if (error) {
        showToast(`Request failed: ${error.message}`, true);
        return;
    }

    closeTakedownModal();
    showToast('Takedown request sent to Library Admin for approval.');
    await loadAuthorDashboardData();
}

function openWithdrawModal() {
    const ctx = getActiveAuthorContext();
    if (!ctx.canWithdrawFunds) {
        showToast('You do not have permission to withdraw funds for this verified page.', true);
        return;
    }
    document.getElementById('modal-available-balance').textContent = `USD ${availableBalance.toFixed(2)}`;
    const amountInput = document.getElementById('withdraw-amount');
    if (amountInput) {
        amountInput.max = availableBalance.toFixed(2);
        amountInput.value = '';
    }
    const modal = document.getElementById('withdraw-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleWithdrawSubmit(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const payoutMethod = document.getElementById('withdraw-method').value;
    const bankCode = document.getElementById('withdraw-bank-code')?.value.trim() || '';
    const accountNumber = document.getElementById('withdraw-account-number')?.value.trim() || '';
    const accountName = document.getElementById('withdraw-account-name')?.value.trim() || '';
    const extraNotes = document.getElementById('withdraw-details')?.value.trim() || '';
    const payoutDetails = `${accountName} (${bankCode} - ${accountNumber})${extraNotes ? ' • ' + extraNotes : ''}`;
    const btn = document.getElementById('withdraw-submit-btn');

    if (isNaN(amount) || amount <= 0) {
        showToast('Enter a valid withdrawal amount.', true);
        return;
    }
    if (amount > availableBalance) {
        showToast('Amount exceeds your available earnings balance.', true);
        return;
    }
    if (!bankCode || !accountNumber || !accountName) {
        showToast('Please enter your bank/MoMo code, account number, and account holder name.', true);
        return;
    }

    const ctx = getActiveAuthorContext();
    if (!ctx.canWithdrawFunds) {
        showToast('You do not have permission to withdraw funds for this verified page.', true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    const issuerName = authorProfile?.full_name || getAuthorDisplayName();
    const issuerHandle = authorProfile?.handle || '';

    const { error } = await supabaseClient
        .from('author_withdrawals')
        .insert([{
            author_id: ctx.targetAuthorId,
            author_name: ctx.targetAuthorName,
            author_email: ctx.targetAuthorEmail,
            requested_by_user_id: authorUser.id,
            requested_by_name: issuerName,
            requested_by_email: authorUser.email,
            requested_by_handle: issuerHandle,
            amount,
            payout_method: payoutMethod,
            payout_details: payoutDetails,
            bank_code: bankCode,
            account_number: accountNumber,
            account_name: accountName,
            status: 'pending'
        }]);

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Request Withdrawal';
    }

    if (error) {
        showToast(`Could not submit withdrawal: ${error.message}`, true);
        return;
    }

    closeWithdrawModal();
    showToast('Withdrawal request submitted.');
    await loadAuthorDashboardData();
}

function renderAuthorWithdrawalsTable() {
    const tbody = document.getElementById('author-withdrawals-tbody');
    if (!tbody) return;

    if (authorWithdrawals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-accord-muted">No withdrawal requests yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    authorWithdrawals.forEach(w => {
        const d = w.created_at
            ? new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';

        let pill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Pending</span>`;
        if (w.status === 'paid' || w.status === 'approved') {
            pill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">${escapeAuthorHtml(w.status)}</span>`;
        } else if (w.status === 'rejected') {
            pill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">Rejected</span>`;
        }

        const issuerName = w.requested_by_name || w.author_name || 'Account Owner';
        const issuerSub = [w.requested_by_handle, w.requested_by_email].filter(Boolean).join(' • ');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="py-3.5 px-6 text-accord-muted">${d}</td>
            <td class="py-3.5 px-6">
                <p class="font-bold text-accord-slate">${escapeAuthorHtml(w.payout_method)}</p>
                <p class="text-[11px] text-accord-muted">${escapeAuthorHtml(w.payout_details)}</p>
            </td>
            <td class="py-3.5 px-6">
                <p class="font-semibold text-accord-slate">${escapeAuthorHtml(issuerName)}</p>
                ${issuerSub ? `<p class="text-[10px] text-accord-muted">${escapeAuthorHtml(issuerSub)}</p>` : ''}
            </td>
            <td class="py-3.5 px-6 text-right font-bold text-accord-slate">USD ${Number(w.amount || 0).toFixed(2)}</td>
            <td class="py-3.5 px-6 text-center">${pill}</td>
        `;
        tbody.appendChild(tr);
    });
}

function handleAuthorCoverPreview(event) {
    const file = event.target.files?.[0];
    const metaEl = document.getElementById('upload-cover-meta');
    const previewBox = document.getElementById('upload-cover-preview-box');

    if (!file) {
        if (metaEl) metaEl.textContent = 'JPG, PNG, WebP (Auto-optimized)';
        if (previewBox) previewBox.innerHTML = '<i class="fa-regular fa-image"></i>';
        return;
    }

    if (metaEl) metaEl.textContent = file.name;
    if (previewBox) {
        const objectUrl = URL.createObjectURL(file);
        previewBox.innerHTML = `<img src="${objectUrl}" alt="Cover preview" class="w-full h-full object-cover">`;
    }
}

let authorDisputes = [];

async function loadAuthorCopyrightDisputes() {
    const section = document.getElementById('author-disputes-section');
    const listEl = document.getElementById('author-disputes-list');
    if (!section || !listEl || !authorUser) return;

    const bookIds = authorBooks.map(b => b.id);
    if (bookIds.length === 0) {
        section.classList.add('hidden');
        return;
    }

    const { data, error } = await supabaseClient
        .from('book_copyright_reports')
        .select('*')
        .in('book_id', bookIds)
        .in('status', ['disputed', 'under_review', 'open'])
        .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
        authorDisputes = [];
        section.classList.add('hidden');
        return;
    }

    authorDisputes = data;
    section.classList.remove('hidden');
    listEl.innerHTML = data.map(rep => {
        const book = authorBooks.find(b => String(b.id) === String(rep.book_id));
        const hasResponded = Boolean(rep.author_counter_statement);
        const canRespond = rep.status === 'disputed' && !hasResponded;
        return `
            <div class="bg-white border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1 min-w-0">
                    <p class="text-xs font-bold text-accord-slate">${escapeAuthorHtml(book?.title || 'Book #' + rep.book_id)} <span class="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">${escapeAuthorHtml(rep.status)}</span></p>
                    <p class="text-[11px] text-accord-muted">Claim: <strong>${escapeAuthorHtml(rep.claim_type)}</strong> — ${escapeAuthorHtml(rep.details)}</p>
                    ${hasResponded ? `<p class="text-[11px] text-emerald-700 font-semibold">Counter-notice submitted. Awaiting Library Admin settlement.</p>` : ''}
                </div>
                ${canRespond ? `
                    <button type="button" onclick="openCounterNoticeModal('${rep.id}')" class="px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shrink-0">
                        Submit Counter-Notice
                    </button>
                ` : ''}
            </div>
        `;
    }).join('');
}

function openCounterNoticeModal(reportId) {
    const rep = authorDisputes.find(r => String(r.id) === String(reportId));
    const book = rep ? authorBooks.find(b => String(b.id) === String(rep.book_id)) : null;
    document.getElementById('counter-report-id').value = reportId;
    document.getElementById('counter-notice-book-title').textContent = book ? book.title : '';
    document.getElementById('counter-statement').value = '';
    document.getElementById('counter-proof-url').value = '';
    const modal = document.getElementById('counter-notice-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeCounterNoticeModal() {
    const modal = document.getElementById('counter-notice-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

async function handleCounterNoticeSubmit(e) {
    e.preventDefault();
    const reportId = document.getElementById('counter-report-id').value;
    const statement = document.getElementById('counter-statement').value.trim();
    const proofUrl = document.getElementById('counter-proof-url').value.trim();
    const btn = document.getElementById('counter-submit-btn');

    if (statement.length < 20) {
        showToast('Please provide at least 20 characters explaining your rights.', true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    const { error } = await supabaseClient
        .from('book_copyright_reports')
        .update({
            author_counter_statement: statement,
            author_counter_proof_url: proofUrl || null,
            author_responded_at: new Date().toISOString()
        })
        .eq('id', reportId);

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Counter-Notice';
    }

    if (error) {
        showToast(`Could not submit counter-notice: ${error.message}`, true);
        return;
    }

    closeCounterNoticeModal();
    await loadAuthorCopyrightDisputes();
    showToast('Counter-notice submitted for Library Admin settlement.');
}

// Hook into loadAuthorDashboardData completion
const _origLoadAuthorDashboardData = loadAuthorDashboardData;
loadAuthorDashboardData = async function () {
    await _origLoadAuthorDashboardData();
    await loadAuthorCopyrightDisputes();
};