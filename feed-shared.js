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
        showToast('Unique post link copied to clipboard.');
    } catch {
        prompt('Copy this post link:', url);
    }
}