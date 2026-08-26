-- COBRADORA - DIAGNOSTICO SOMENTE LEITURA: por que o organizador nao recebeu
-- a lista atualizada (kind organizer_list_update) apos um pagamento confirmado.
--
-- Ajuste os dois valores abaixo se precisar investigar outro caso.
-- Execute o arquivo inteiro no Supabase SQL Editor.

WITH params AS (
	SELECT
		'teste-prod'::text AS org_name,
		'+5511990011189'::varchar(14) AS contact_phone
),
target_org AS (
	SELECT o.*
	FROM organizations o, params
	WHERE o.name = params.org_name
),
target_contact AS (
	SELECT fc.*
	FROM financial_contacts fc, params
	WHERE fc.phone_normalized = params.contact_phone
),
recent_payments AS (
	SELECT p.*
	FROM payments p
	JOIN target_org o ON o.id = p.organization_id
	WHERE p.gateway = 'infinitepay'
	ORDER BY p.created_at DESC
	LIMIT 5
),
payment_charges AS (
	SELECT
		pa.payment_id,
		c.id AS charge_id,
		c.status AS charge_status,
		c.billing_period_id,
		bp.reference_month,
		g.id AS group_id,
		g.name AS group_name,
		g.status AS group_status
	FROM recent_payments rp
	JOIN payment_allocations pa ON pa.payment_id = rp.id
	JOIN charges c ON c.id = pa.charge_id
	JOIN billing_periods bp ON bp.id = c.billing_period_id
	JOIN groups g ON g.id = bp.group_id
),
related_billing_periods AS (
	SELECT DISTINCT billing_period_id FROM payment_charges
),

org_report AS (
	SELECT
		'10_organization'::text AS section,
		coalesce(o.name, '<nao encontrada>') AS item,
		format(
			'id=%s; status=%s; billing_module=%s; organizer_phone_normalized=%s; organizer_phone_display=%s',
			o.id, o.status, o.billing_module,
			coalesce(o.organizer_phone_normalized, '<NULL - bloqueia o envio>'),
			coalesce(o.organizer_phone_display, '<NULL>')
		) AS detail
	FROM params
	LEFT JOIN target_org o ON true
),
contact_report AS (
	SELECT
		'20_financial_contact'::text AS section,
		coalesce(fc.phone_display, '<nao encontrado>') AS item,
		format(
			'id=%s; organization_id=%s; whatsapp_opt_in_at=%s; whatsapp_opt_out_at=%s',
			fc.id, fc.organization_id, fc.whatsapp_opt_in_at::text, fc.whatsapp_opt_out_at::text
		) AS detail
	FROM params
	LEFT JOIN target_contact fc ON true
),
payment_report AS (
	SELECT
		'30_recent_payment'::text AS section,
		rp.id::text AS item,
		format(
			'gateway_payment_id=%s; amount=%s; status=%s; paid_at=%s; created_at=%s',
			rp.gateway_payment_id, rp.amount, rp.status, rp.paid_at::text, rp.created_at::text
		) AS detail
	FROM recent_payments rp
),
webhook_report AS (
	SELECT
		'35_webhook_event'::text AS section,
		we.external_event_id AS item,
		format(
			'processing_status=%s; received_at=%s; processed_at=%s; error_message=%s',
			we.processing_status, we.received_at::text, we.processed_at::text, coalesce(we.error_message, '<none>')
		) AS detail
	FROM recent_payments rp
	JOIN webhook_events we ON we.provider = 'infinitepay' AND we.external_event_id = rp.gateway_payment_id
),
checkout_report AS (
	SELECT
		'37_checkout_session'::text AS section,
		cs.id::text AS item,
		format('status=%s; gateway_payment_id=%s', cs.status, cs.gateway_payment_id) AS detail
	FROM recent_payments rp
	JOIN checkout_sessions cs ON cs.gateway_payment_id = rp.gateway_payment_id
),
charge_report AS (
	SELECT
		'40_charge_and_group'::text AS section,
		pc.charge_id::text AS item,
		format(
			'payment_id=%s; charge_status=%s; billing_period_id=%s; reference_month=%s; group=%s (status=%s)',
			pc.payment_id, pc.charge_status, pc.billing_period_id, pc.reference_month, pc.group_name, pc.group_status
		) AS detail
	FROM payment_charges pc
),
notification_report AS (
	SELECT
		'50_organizer_list_update_for_this_period'::text AS section,
		wn.id::text AS item,
		format(
			'billing_period_id=%s; status=%s; error_code=%s; meta_message_id=%s; created_at=%s; idempotency_key=%s',
			wn.billing_period_id, wn.status, coalesce(wn.error_code, '<none>'), coalesce(wn.meta_message_id, '<none>'),
			wn.created_at::text, wn.idempotency_key
		) AS detail
	FROM whatsapp_notifications wn
	JOIN target_org o ON o.id = wn.organization_id
	WHERE wn.kind = 'organizer_list_update'
		AND wn.billing_period_id IN (SELECT billing_period_id FROM related_billing_periods)
),
notification_report_missing AS (
	SELECT
		'50_organizer_list_update_for_this_period'::text AS section,
		'<nenhuma notificacao encontrada para essa competencia>'::text AS item,
		'Se a linha 40_charge_and_group existe mas nao ha nada aqui, enqueueOrganizerListUpdates nunca inseriu a notificacao (grupo inativo, ou o gate de status/billing_module/organizer_phone falhou).'::text AS detail
	WHERE NOT EXISTS (SELECT 1 FROM notification_report)
		AND EXISTS (SELECT 1 FROM payment_charges)
),
recent_org_notifications AS (
	SELECT
		'60_recent_organizer_list_update_any_period'::text AS section,
		wn.id::text AS item,
		format(
			'billing_period_id=%s; status=%s; error_code=%s; created_at=%s',
			wn.billing_period_id, wn.status, coalesce(wn.error_code, '<none>'), wn.created_at::text
		) AS detail
	FROM whatsapp_notifications wn
	JOIN target_org o ON o.id = wn.organization_id
	WHERE wn.kind = 'organizer_list_update'
	ORDER BY wn.created_at DESC
	LIMIT 10
),
final_report AS (
	SELECT * FROM org_report
	UNION ALL SELECT * FROM contact_report
	UNION ALL SELECT * FROM payment_report
	UNION ALL SELECT * FROM webhook_report
	UNION ALL SELECT * FROM checkout_report
	UNION ALL SELECT * FROM charge_report
	UNION ALL SELECT * FROM notification_report
	UNION ALL SELECT * FROM notification_report_missing
	UNION ALL SELECT * FROM recent_org_notifications
)
SELECT section, item, detail
FROM final_report
ORDER BY section, item;
