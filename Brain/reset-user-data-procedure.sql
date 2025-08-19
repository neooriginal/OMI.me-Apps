-- Stored procedure for atomic user data reset
-- This ensures all operations happen together or not at all

CREATE OR REPLACE FUNCTION public.reset_user_data(p_uid TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Ensure predictable search_path for SECURITY DEFINER
    PERFORM set_config('search_path', 'public', true);
    
    -- Order matters if you don't have ON DELETE CASCADE:
    -- Delete relationships first (they reference nodes)
    DELETE FROM brain_relationships WHERE uid = p_uid;
    
    -- Then delete nodes
    DELETE FROM brain_nodes WHERE uid = p_uid;
    
    -- Finally reset user's encryption key status
    UPDATE brain_users 
    SET 
        code_check = NULL,
        has_key = false
    WHERE uid = p_uid;
    
    -- If no rows were updated (user doesn't exist), that's okay
    -- The function will complete successfully
END;
$$;

-- Revoke execute from public roles, only allow through API server
REVOKE EXECUTE ON FUNCTION public.reset_user_data(TEXT) FROM anon, authenticated;
-- If you need authenticated users to call it directly, uncomment:
-- GRANT EXECUTE ON FUNCTION public.reset_user_data(TEXT) TO authenticated;