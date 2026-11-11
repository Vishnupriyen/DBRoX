-- Round 5 (pre-pilot): stock travels as movements (stockMoves), never as an overwritten total.
-- A lot's qty on the server is the sum of its movements. Existing lots get one opening movement equal to their qty
-- now (a lot that already has movements is left alone; safe to run twice).
INSERT INTO docs(tenant_id, tbl, id, data, updated_at)
SELECT b.tenant_id, 'stockMoves', 'open:' || b.id,
       jsonb_build_object('id', 'open:' || b.id, 'tenantId', b.tenant_id, 'batchId', b.id, 'productId', b.data->'productId',
         'delta', COALESCE((b.data->>'qty')::numeric, 0)::int, 'reason', 'opening (moved to movements)', 'by', 'server',
         'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
       now()
FROM docs b
WHERE b.tbl = 'batches' AND COALESCE((b.data->>'qty')::numeric, 0) <> 0
  AND NOT EXISTS (SELECT 1 FROM docs m WHERE m.tenant_id = b.tenant_id AND m.tbl = 'stockMoves' AND m.data->>'batchId' = b.id)
ON CONFLICT (tenant_id, tbl, id) DO NOTHING;
-- the movements of a lot, quickly (the sum check, reports)
CREATE INDEX IF NOT EXISTS docs_moves_lot ON docs (tenant_id, (data->>'batchId')) WHERE tbl = 'stockMoves';
