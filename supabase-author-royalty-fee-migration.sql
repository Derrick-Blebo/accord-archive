-- Accord Archive — 10% Author Book Sales Royalty Fee
-- Applies a 10% Accord platform fee (90% net author royalty) on every book sold
-- on behalf of a signed-up author (books.author_id IS NOT NULL), both retroactively
-- for existing user_purchases rows and automatically on all future purchases.
-- Books uploaded directly by Library Admin (books.author_id IS NULL) remain 100% Accord-owned.

-- 1. Add royalty breakdown columns to user_purchases
ALTER TABLE public.user_purchases
    ADD COLUMN IF NOT EXISTS platform_fee_rate numeric(5,4) NOT NULL DEFAULT 0.10,
    ADD COLUMN IF NOT EXISTS platform_fee_amount numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS author_royalty_amount numeric(12,2) NOT NULL DEFAULT 0;

-- 2. Trigger function to compute 10% Accord fee / 90% author royalty on insert or price/book update
CREATE OR REPLACE FUNCTION public.calculate_purchase_royalties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_author_id uuid;
    v_gross numeric(12,2);
BEGIN
    SELECT b.author_id
    INTO v_author_id
    FROM public.books b
    WHERE b.id = NEW.book_id;

    v_gross := GREATEST(0, ROUND(COALESCE(NEW.amount_paid, 0)::numeric, 2));

    IF v_author_id IS NOT NULL THEN
        NEW.platform_fee_rate := 0.1000;
        NEW.platform_fee_amount := ROUND(v_gross * 0.10, 2);
        NEW.author_royalty_amount := GREATEST(0, v_gross - NEW.platform_fee_amount);
    ELSE
        NEW.platform_fee_rate := 1.0000;
        NEW.platform_fee_amount := v_gross;
        NEW.author_royalty_amount := 0;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calculate_purchase_royalties ON public.user_purchases;
CREATE TRIGGER trg_calculate_purchase_royalties
    BEFORE INSERT OR UPDATE OF book_id, amount_paid ON public.user_purchases
    FOR EACH ROW EXECUTE FUNCTION public.calculate_purchase_royalties();

-- 3. Retroactively backfill existing user_purchases rows
UPDATE public.user_purchases up
SET
    platform_fee_rate = CASE WHEN b.author_id IS NOT NULL THEN 0.1000 ELSE 1.0000 END,
    platform_fee_amount = CASE
        WHEN b.author_id IS NOT NULL THEN ROUND(GREATEST(0, COALESCE(up.amount_paid, 0)::numeric) * 0.10, 2)
        ELSE GREATEST(0, ROUND(COALESCE(up.amount_paid, 0)::numeric, 2))
    END,
    author_royalty_amount = CASE
        WHEN b.author_id IS NOT NULL THEN GREATEST(
            0,
            GREATEST(0, ROUND(COALESCE(up.amount_paid, 0)::numeric, 2))
            - ROUND(GREATEST(0, COALESCE(up.amount_paid, 0)::numeric) * 0.10, 2)
        )
        ELSE 0
    END
FROM public.books b
WHERE b.id = up.book_id;

-- 4. Enforce net (90%) available royalty balance on author_withdrawals inserts
CREATE OR REPLACE FUNCTION public.enforce_withdrawal_issuer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_net_earned numeric(12,2);
    v_committed numeric(12,2);
    v_available numeric(12,2);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required to request a withdrawal.';
    END IF;

    -- Always record the authenticated issuer unless superadmin explicitly overrides
    IF NOT public.is_superadmin() THEN
        NEW.requested_by_user_id := auth.uid();
    ELSIF NEW.requested_by_user_id IS NULL THEN
        NEW.requested_by_user_id := auth.uid();
    END IF;

    IF NEW.author_id IS NULL THEN
        NEW.author_id := auth.uid();
    END IF;

    IF NEW.author_id <> auth.uid()
       AND NOT public.has_page_permission(NEW.author_id, auth.uid(), 'can_withdraw_funds')
       AND NOT public.is_superadmin() THEN
        RAISE EXCEPTION 'You do not have permission to withdraw funds for this verified page.';
    END IF;

    IF COALESCE(NEW.amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
    END IF;

    SELECT COALESCE(SUM(up.author_royalty_amount), 0)
    INTO v_net_earned
    FROM public.user_purchases up
    JOIN public.books b ON b.id = up.book_id
    WHERE b.author_id = NEW.author_id
      AND b.deleted_at IS NULL;

    SELECT COALESCE(SUM(w.amount), 0)
    INTO v_committed
    FROM public.author_withdrawals w
    WHERE w.author_id = NEW.author_id
      AND w.status <> 'rejected';

    v_available := GREATEST(0, v_net_earned - v_committed);

    IF NOT public.is_superadmin() AND ROUND(NEW.amount::numeric, 2) > v_available THEN
        RAISE EXCEPTION 'Requested withdrawal (USD %) exceeds available net royalty balance (USD %).',
            ROUND(NEW.amount::numeric, 2), v_available;
    END IF;

    RETURN NEW;
END;
$$;
