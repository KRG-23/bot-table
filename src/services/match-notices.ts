import type { AutomationSettings } from "./automation-settings";
import { formatWeekday } from "./automation-settings";

function formatReviewSchedule(settings: AutomationSettings): string {
  return `${formatWeekday(settings.weeklyReviewWeekday)} à ${settings.weeklyReviewTime}`;
}

export function buildPendingValidationNotice(settings: AutomationSettings): string {
  return [
    "⏳ Partie en attente de validation.",
    `Les joueurs recevront un DM si elle est validée automatiquement au récap du ${formatReviewSchedule(
      settings
    )}, ou dès validation par un admin avant la soirée.`
  ].join("\n");
}

export function buildPendingValidationDm(gameLabel: string, settings: AutomationSettings): string {
  return [
    `✅ Votre partie ${gameLabel} est enregistrée en attente de validation.`,
    `Vous recevrez un DM si elle est validée automatiquement au récap du ${formatReviewSchedule(
      settings
    )}, ou dès validation par un admin avant la soirée.`
  ].join("\n");
}
