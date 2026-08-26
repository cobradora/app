import {
  dispatchWhatsappNotifications,
  enqueueLatestCycleStartNotifications,
  type WhatsappDispatchFailure,
} from "@/services/whatsapp-notifications";

export type WhatsappReminderFailure = WhatsappDispatchFailure;

/**
 * O cron pode rodar diariamente, mas a outbox só cria uma notificação por
 * responsável+grupo+competência. Falhas ficam agendadas para retry sem que
 * cobranças já enviadas sejam recriadas.
 */
export async function sendDailyPaymentReminders() {
  // Reconcilia somente a competência mais recente de cada grupo. Um catch-up
  // de vários meses não pode provocar uma rajada de cobranças históricas.
  const cycleStartNotificationIds = await enqueueLatestCycleStartNotifications();
  const dispatch = await dispatchWhatsappNotifications();
  return { queued: cycleStartNotificationIds.length, ...dispatch };
}
