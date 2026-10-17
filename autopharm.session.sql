-- SELECT
--     u.id,
--     u.first_name,
--     u.last_name,
--     u.account_type,
--     u.is_staff,
--     u.is_disabled,
--     u.phone_verified_at,
--     o.credential_changed_at
-- FROM public.users AS u
-- JOIN public.owners AS o
--     ON o.user_id = u.id
-- WHERE u.account_type = 'OWNER';


SELECT *
FROM public.terminals;

-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_type = 'BASE TABLE'
-- ORDER BY table_name;


-- SELECT 'users' AS table_name, COUNT(*) AS row_count FROM public.users
-- UNION ALL
-- SELECT 'customers', COUNT(*) FROM public.customers
-- UNION ALL
-- SELECT 'doctors', COUNT(*) FROM public.doctors
-- UNION ALL
-- SELECT 'owners', COUNT(*) FROM public.owners
-- UNION ALL
-- SELECT 'refresh_tokens', COUNT(*) FROM public.refresh_tokens;


-- SELECT
--     sequencename,
--     start_value,
--     increment_by,
--     max_value,
--     cycle
-- FROM pg_sequences
-- WHERE schemaname = 'public'
--   AND sequencename = 'have_user_id_seq';
