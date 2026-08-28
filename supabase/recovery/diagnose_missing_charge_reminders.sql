-- COBRADORA - DIAGNOSTICO SOMENTE LEITURA: por que cobrancas geradas
-- recentemente nao dispararam o lembrete de cobranca (charge_reminder /
-- template "cobranca") por WhatsApp.
--
-- Execute o arquivo inteiro no Supabase SQL Editor. Ajuste `days_back` se
-- quiser olhar mais/menos tempo pra tras.

-- billing_periods nao tem created_at; a "recencia" e medida pelas charges
-- (que tem created_at) geradas dentro dessas competencias.
WITH params AS (
	SELECT 3 AS days_back
),
recent_periods AS (
	SELECT DISTINCT
		bp.id AS billing_period_id,
		bp.reference_month,
		g.id AS group_id,
		g.name AS group_name,
		g.status AS group_status,
		o.id AS organization_id,
		o.name AS organization_name,
		o.status AS organization_status,
		o.billing_module
	FROM charges c
	JOIN billing_periods bp ON bp.id = c.billing_period_id
	JOIN groups g ON g.id = bp.group_id
	JOIN organizations o ON o.id = g.organization_id
	, params
	WHERE c.created_at >= now() - (params.days_back::text || ' days')::interval
),

gateway_report AS (
	SELECT
		'10_gateway_infinitepay'::text AS section,
		rp.organization_name AS item,
		format(
			'billing_module=%s; gateway_status=%s',
			rp.billing_module,
			coalesce(ga.status::text, '<SEM CONTA INFINITEPAY CADASTRADA>')
		) AS detail
	FROM (SELECT DISTINCT organization_id, organization_name, billing_module FROM recent_periods) rp
	LEFT JOIN gateway_accounts ga ON ga.organization_id = rp.organization_id AND ga.provider = 'infinitepay'
),

period_report AS (
	SELECT
		'20_recent_billing_period'::text AS section,
		rp.billing_period_id::text AS item,
		format(
			'org=%s; grupo=%s (status=%s); referencia=%s',
			rp.organization_name, rp.group_name, rp.group_status, rp.reference_month
		) AS detail
	FROM recent_periods rp
),

charge_contact_report AS (
	SELECT
		'30_charge_and_contact'::text AS section,
		c.id::text AS item,
		format(
			'billing_period_id=%s; participante=%s; charge_status=%s; telefone=%s; opt_in=%s; opt_out=%s',
			c.billing_period_id, p.name, c.status,
			coalesce(fc.phone_display, '<SEM CONTATO FINANCEIRO>'),
			coalesce(fc.whatsapp_opt_in_at::text, '<NULL - bloqueia o envio>'),
			coalesce(fc.whatsapp_opt_out_at::text, '<null>')
		) AS detail
	FROM charges c
	JOIN recent_periods rp ON rp.billing_period_id = c.billing_period_id
	JOIN participants p ON p.id = c.participant_id
	LEFT JOIN financial_contacts fc ON fc.id = p.financial_contact_id
),

notification_report AS (
	SELECT
		'40_charge_reminder_notification'::text AS section,
		wn.id::text AS item,
		format(
			'billing_period_id=%s; status=%s; error_code=%s; meta_message_id=%s; created_at=%s',
			wn.billing_period_id, wn.status, coalesce(wn.error_code, '<none>'),
			coalesce(wn.meta_message_id, '<none>'), wn.created_at::text
		) AS detail
	FROM whatsapp_notifications wn
	JOIN recent_periods rp ON rp.billing_period_id = wn.billing_period_id
	WHERE wn.kind = 'charge_reminder'
),

period_without_any_notification AS (
	SELECT
		'40_charge_reminder_notification'::text AS section,
		rp.billing_period_id::text AS item,
		'<NENHUMA notificacao charge_reminder para esta competencia> — enqueueChargeReminderNotifications nao criou nada pra ela (confira 10_gateway/30_charge acima: billing_module, gateway ou opt-in)'::text AS detail
	FROM recent_periods rp
	WHERE NOT EXISTS (
		SELECT 1 FROM whatsapp_notifications wn
		WHERE wn.kind = 'charge_reminder' AND wn.billing_period_id = rp.billing_period_id
	)
),

final_report AS (
	SELECT * FROM gateway_report
	UNION ALL SELECT * FROM period_report
	UNION ALL SELECT * FROM charge_contact_report
	UNION ALL SELECT * FROM notification_report
	UNION ALL SELECT * FROM period_without_any_notification
)
SELECT section, item, detail
FROM final_report
ORDER BY section, item;
