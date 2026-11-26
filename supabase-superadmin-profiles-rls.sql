-- ============================================================================
-- Accord Archive — Superadmin RLS Policies & Role Sync for public.profiles
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- Allows Superadmins to view and approve/reject all Ministry/Minister
-- upgrade requests while leaving existing member/public policies untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    roles_raw text;
    roles_json jsonb;
BEGIN
    IF caller_email = '' THEN
        RETURN false;
    END IF;

    -- Master Superadmin & authorized admin emails
    IF caller_email IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com') THEN
        RETURN true;
    END IF;

    -- Also honor active superadmin entries stored in __ACCORD_ROLES_CONFIG__
    SELECT b.description
      INTO roles_raw
      FROM public.books b
     WHERE b.title = '__ACCORD_ROLES_CONFIG__'
     LIMIT 1;

    IF roles_raw IS NOT NULL AND roles_raw <> '' THEN
        BEGIN
            roles_json := roles_raw::jsonb;
            IF jsonb_typeof(roles_json) = 'array' AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(roles_json) AS elem
                WHERE lower(coalesce(elem ->> 'email', '')) = caller_email
                  AND coalesce(elem ->> 'status', '') = 'active'
                  AND (
                      coalesce((elem ->> 'isMaster')::boolean, false) = true
                      OR coalesce(elem -> 'portals', '[]'::jsonb) ? 'superadmin'
                  )
            ) THEN
                RETURN true;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
    END IF;

    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Permissive SELECT policy for Superadmins (leaves existing user policies intact)
DROP POLICY IF EXISTS "Superadmins can view all profiles" ON public.profiles;
CREATE POLICY "Superadmins can view all profiles"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (public.is_superadmin());

-- Permissive UPDATE policy for Superadmins to approve/reject upgrade requests
DROP POLICY IF EXISTS "Superadmins can update all profiles" ON public.profiles;
CREATE POLICY "Superadmins can update all profiles"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- Sync any already-approved profiles whose account_type stayed normal_user
UPDATE public.profiles
SET account_type = 'ministry_minister'
WHERE upgrade_status = 'approved'
  AND (account_type IS NULL OR account_type <> 'ministry_minister');
