-- All existing strips were built with 2 rows.
-- Append ' 2R' to any part label that is exactly one character (S, A, T, B).
UPDATE songs
SET parts = (
  SELECT jsonb_agg(
    CASE
      WHEN length(p->>'label') = 1
        THEN jsonb_set(p, '{label}', to_jsonb((p->>'label') || ' 2R'))
      ELSE p
    END
  )
  FROM jsonb_array_elements(parts) p
)
WHERE parts IS NOT NULL AND jsonb_array_length(parts) > 0;
