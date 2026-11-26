const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    await loadTestimonyDetail();
});

async function loadTestimonyDetail() {
    const container = document.getElementById('testimony-detail-container');
    const urlParams = new URLSearchParams(window.location.search);
    const testimonyId = urlParams.get('id');

    if (!testimonyId) {
        container.innerHTML = `<p class="text-center text-red-500 py-10">Testimony not found.</p>`;
        return;
    }

    const [testRes, commRes] = await Promise.all([
        supabaseClient.from('testimonies').select('*').eq('id', testimonyId).single(),
        supabaseClient.from('testimony_comments').select('*').eq('testimony_id', testimonyId).order('created_at', { ascending: true })
    ]);

    if (testRes.error || !testRes.data) {
        container.innerHTML = `<p class="text-center text-red-500 py-10">Testimony not found.</p>`;
        return;
    }

    const item = testRes.data;
    const comments = commRes.data || [];
    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    const hasLiked = amenedIds.includes(Number(item.id));
    const likedComments = JSON.parse(localStorage.getItem('accord_liked_comments') || '[]');
    const safeTitle = item.title.replace(/'/g, "\\'");

    const topComments = comments.filter(c => !c.parent_comment_id);
    const repliesByParent = {};
    comments.filter(c => c.parent_comment_id).forEach(r => {
        if (!repliesByParent[r.parent_comment_id]) repliesByParent[r.parent_comment_id] = [];
        repliesByParent[r.parent_comment_id].push(r);
    });

    const commentsHtml = topComments.length === 0
        ? `<p class="text-xs text-accord-muted italic py-2">No comments yet. Be the first to share an encouraging word.</p>`
        : topComments.map(c => {
            const replies = repliesByParent[c.id] || [];
            const hasLikedComment = likedComments.includes(Number(c.id));

            const repliesHtml = replies.map(r => {
                const hasLikedReply = likedComments.includes(Number(r.id));
                return `
                    <div class="ml-6 mt-2 bg-white border border-slate-200/80 rounded-2xl p-3 flex items-start justify-between gap-2">
                        <div>
                            <p class="text-xs font-bold text-accord-slate">${escapeHTML(r.author_name)} <span class="text-[10px] text-accord-muted">• ${new Date(r.created_at).toLocaleDateString()}</span></p>
                            <p class="text-xs text-slate-700 mt-1">${escapeHTML(r.comment_text)}</p>
                            <button type="button" onclick="likeComment(${r.id})" class="text-[11px] font-bold ${hasLikedReply ? 'text-red-500' : 'text-accord-muted hover:text-red-500'} mt-1">
                                <i class="${hasLikedReply ? 'fa-solid' : 'fa-regular'} fa-thumbs-up mr-1"></i>${Number(r.like_count) || 0}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="bg-slate-50 border border-slate-200/70 rounded-2xl p-4 space-y-2">
                    <div class="flex items-start justify-between">
                        <div>
                            <p class="text-xs font-bold text-accord-slate">${escapeHTML(c.author_name)} <span class="text-[10px] text-accord-muted">• ${new Date(c.created_at).toLocaleDateString()}</span></p>
                            <p class="text-xs text-slate-700 mt-1">${escapeHTML(c.comment_text)}</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-4 pt-1">
                        <button type="button" onclick="likeComment(${c.id})" class="text-xs font-bold ${hasLikedComment ? 'text-red-500' : 'text-accord-muted hover:text-red-500'}">
                            <i class="${hasLikedComment ? 'fa-solid' : 'fa-regular'} fa-thumbs-up mr-1"></i>Like (${Number(c.like_count) || 0})
                        </button>
                        <button type="button" onclick="toggleReplyBox(${c.id})" class="text-xs font-bold text-accord-muted hover:text-accord-blue">
                            Reply
                        </button>
                    </div>

                    ${replies.length > 0 ? `
                        <div class="pt-1">
                            <button type="button" onclick="toggleRepliesAccordion(${c.id})" id="accordion-btn-${c.id}" class="text-xs font-bold text-accord-blue hover:underline">
                                <i class="fa-solid fa-caret-down mr-1"></i> View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}
                            </button>
                            <div id="replies-container-${c.id}" class="hidden space-y-2 mt-2">
                                ${repliesHtml}
                            </div>
                        </div>
                    ` : ''}

                    <form id="reply-form-${c.id}" onsubmit="handleCommentSubmit(event, ${item.id}, ${c.id})" class="hidden mt-2 ml-6 flex items-center gap-2">
                        <input type="text" id="reply-input-${c.id}" required placeholder="Write a reply..." class="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-accord-slate focus:outline-none focus:border-accord-blue">
                        <button type="submit" class="bg-accord-blue text-white text-[11px] font-bold px-3 py-2 rounded-xl">Reply</button>
                    </form>
                </div>
            `;
        }).join('');

    container.innerHTML = `
        <article class="bg-white border border-slate-200/90 rounded-3xl p-8 shadow-sm space-y-6">
            <div class="flex items-center justify-between">
                <span class="bg-accord-goldLight text-accord-gold text-xs font-bold px-3 py-1 rounded-full">${escapeHTML(item.category)}</span>
                <span class="text-xs text-accord-muted">${new Date(item.created_at).toLocaleDateString()}</span>
            </div>

            <h1 class="serif-heading text-3xl font-bold text-accord-slate leading-tight">${escapeHTML(item.title)}</h1>
            <p class="text-xs font-bold text-accord-slate">By ${escapeHTML(item.author_name)} ${item.location ? `(${escapeHTML(item.location)})` : ''}</p>

            <div class="text-sm text-slate-700 leading-relaxed whitespace-pre-line pt-2 border-t border-slate-100">
                ${escapeHTML(item.body)}
            </div>

            <!-- Facebook-Style Compact Spacing Bar -->
            <div class="pt-4 border-t border-slate-200 flex items-center justify-start space-x-8 text-sm text-accord-muted font-semibold">
                <button type="button" onclick="likeTestimony(${item.id})" class="hover:text-red-500 flex items-center space-x-1.5 transition-colors">
                    <i class="${hasLiked ? 'fa-solid text-red-500' : 'fa-regular'} fa-thumbs-up text-base"></i>
                    <span>${Number(item.amen_count) || 0} Likes</span>
                </button>
                <span class="flex items-center space-x-1.5">
                    <i class="fa-regular fa-comment text-base"></i>
                    <span>${comments.length} Comments</span>
                </span>
                <button type="button" onclick="shareTestimonyPage(${item.id}, '${safeTitle}')" class="hover:text-accord-blue flex items-center space-x-1.5 transition-colors">
                    <i class="fa-solid fa-share text-base"></i>
                    <span>Share</span>
                </button>
            </div>

            <div class="pt-6 border-t border-slate-200 space-y-4">
                <h3 class="font-bold text-sm text-accord-slate">Comments & Replies</h3>
                <div class="space-y-3">
                    ${commentsHtml}
                </div>

                <form onsubmit="handleCommentSubmit(event, ${item.id}, null)" class="flex items-center gap-2 pt-3">
                    <input type="text" id="main-comment-input" required placeholder="Write a comment..." class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-accord-slate focus:outline-none focus:border-accord-blue">
                    <button type="submit" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-5 py-3 rounded-xl">Post Comment</button>
                </form>
            </div>
        </article>
    `;
}

async function shareTestimonyPage(id, title) {
    const shareUrl = `${window.location.origin}/testimony.html?id=${id}`;
    if (navigator.share) {
        try { await navigator.share({ title, url: shareUrl }); } catch (err) {}
    } else {
        await navigator.clipboard.writeText(shareUrl);
        alert("Testimony link copied to clipboard!");
    }
}

function toggleRepliesAccordion(commentId) {
    const container = document.getElementById(`replies-container-${commentId}`);
    const btn = document.getElementById(`accordion-btn-${commentId}`);
    if (container) {
        container.classList.toggle('hidden');
        const isHidden = container.classList.contains('hidden');
        if (btn) {
            btn.innerHTML = isHidden 
                ? `<i class="fa-solid fa-caret-down mr-1"></i> View replies`
                : `<i class="fa-solid fa-caret-up mr-1"></i> Hide replies`;
        }
    }
}

function toggleReplyBox(commentId) {
    if (!currentUser) {
        alert("Please sign in to reply.");
        return;
    }
    document.getElementById(`reply-form-${commentId}`)?.classList.toggle('hidden');
}

async function likeTestimony(id) {
    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    if (amenedIds.includes(Number(id))) return;
    amenedIds.push(Number(id));
    localStorage.setItem('accord_amened_ids', JSON.stringify(amenedIds));
    await supabaseClient.rpc('increment_testimony_amen', { target_id: Number(id) });
    location.reload();
}

async function likeComment(id) {
    await supabaseClient.rpc('increment_comment_like', { target_id: Number(id) });
    location.reload();
}

async function handleCommentSubmit(e, testimonyId, parentId = null) {
    e.preventDefault();
    if (!currentUser) {
        alert("Please sign in to comment.");
        return;
    }

    const input = parentId ? document.getElementById(`reply-input-${parentId}`) : document.getElementById('main-comment-input');
    const text = input.value.trim();
    if (!text) return;

    const authorName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

    await supabaseClient.from('testimony_comments').insert([{
        testimony_id: Number(testimonyId),
        parent_comment_id: parentId ? Number(parentId) : null,
        user_id: currentUser.id,
        author_name: authorName,
        comment_text: text
    }]);

    location.reload();
}

function escapeHTML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}