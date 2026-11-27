-- ============================================================================
-- Accord Archive — Saved Payment Cards & Author Payout Account Details
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. USER PAYMENT CARDS (Masked card metadata for ad promotion checkout selection)
CREATE TABLE IF NOT EXISTS public.user_payment_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    card_holder text NOT NULL,
    brand text NOT NULL DEFAULT 'Card',
    last4 text NOT NULL CHECK (char_length(last4) = 4),
    exp_month text NOT NULL,
    exp_year text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_payment_cards_user ON public.user_payment_cards(user_id, created_at DESC);

ALTER TABLE public.user_payment_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own payment cards" ON public.user_payment_cards;
CREATE POLICY "Users can view own payment cards"
    ON public.user_payment_cards
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own payment cards" ON public.user_payment_cards;
CREATE POLICY "Users can insert own payment cards"
    ON public.user_payment_cards
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own payment cards" ON public.user_payment_cards;
CREATE POLICY "Users can update own payment cards"
    ON public.user_payment_cards
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own payment cards" ON public.user_payment_cards;
CREATE POLICY "Users can delete own payment cards"
    ON public.user_payment_cards
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Optional column on promotions to record which saved card label was chosen
ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS payment_card_label text;

-- 2. AUTHOR PAYOUT ACCOUNTS (Saved Bank / Mobile Money account shown on Author page)
CREATE TABLE IF NOT EXISTS public.author_payout_accounts (
    author_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    payout_method text NOT NULL DEFAULT 'Mobile Money (Paystack)',
    bank_code text NOT NULL,
    account_number text NOT NULL,
    account_name text NOT NULL,
    notes text,
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.author_payout_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authors and page admins can view payout account" ON public.author_payout_accounts;
CREATE POLICY "Authors and page admins can view payout account"
    ON public.author_payout_accounts
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = author_id
        OR EXISTS (
            SELECT 1 FROM public.page_admins pa
            WHERE pa.page_id = author_id
              AND pa.admin_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Authors and withdraw admins can upsert payout account" ON public.author_payout_accounts;
CREATE POLICY "Authors and withdraw admins can upsert payout account"
    ON public.author_payout_accounts
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = author_id
        OR EXISTS (
            SELECT 1 FROM public.page_admins pa
            WHERE pa.page_id = author_id
              AND pa.admin_user_id = auth.uid()
              AND coalesce((pa.permissions ->> 'can_withdraw_funds')::boolean, false) = true
        )
    );

DROP POLICY IF EXISTS "Authors and withdraw admins can update payout account" ON public.author_payout_accounts;
CREATE POLICY "Authors and withdraw admins can update payout account"
    ON public.author_payout_accounts
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR EXISTS (
            SELECT 1 FROM public.page_admins pa
            WHERE pa.page_id = author_id
              AND pa.admin_user_id = auth.uid()
              AND coalesce((pa.permissions ->> 'can_withdraw_funds')::boolean, false) = true
        )
    )
    WITH CHECK (
        auth.uid() = author_id
        OR EXISTS (
            SELECT 1 FROM public.page_admins pa
            WHERE pa.page_id = author_id
              AND pa.admin_user_id = auth.uid()
              AND coalesce((pa.permissions ->> 'can_withdraw_funds')::boolean, false) = true
        )
    );

DROP POLICY IF EXISTS "Authors and withdraw admins can delete payout account" ON public.author_payout_accounts;
CREATE POLICY "Authors and withdraw admins can delete payout account"
    ON public.author_payout_accounts
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR EXISTS (
            SELECT 1 FROM public.page_admins pa
            WHERE pa.page_id = author_id
              AND pa.admin_user_id = auth.uid()
              AND coalesce((pa.permissions ->> 'can_withdraw_funds')::boolean, false) = true
        )
    );
