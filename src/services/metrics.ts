const startedAt = new Date();

const counters = {
  discordClientErrors: 0,
  discordInteractionErrors: 0,
  discordInteractions: 0,
  discordLateInteractions: 0,
  discordMessageErrors: 0,
  dmFailures: 0,
  matchActionDenied: 0,
  matchAutoValidated: 0,
  matchCancelled: 0,
  matchCreated: 0,
  matchDuplicateRefused: 0,
  matchRefused: 0,
  matchValidated: 0,
  threadNotificationFailures: 0
};

export type MetricName = keyof typeof counters;

export type MetricsSnapshot = {
  startedAt: Date;
  uptimeSeconds: number;
  counters: Record<MetricName, number>;
};

export function incrementMetric(name: MetricName, value = 1): void {
  counters[name] += value;
}

export function getMetricsSnapshot(now = new Date()): MetricsSnapshot {
  return {
    startedAt,
    uptimeSeconds: Math.max(Math.floor((now.getTime() - startedAt.getTime()) / 1000), 0),
    counters: { ...counters }
  };
}

export function formatMetricsSnapshot(snapshot = getMetricsSnapshot()): string {
  const { counters: values } = snapshot;

  return [
    "Métriques depuis le dernier démarrage :",
    `Uptime : ${formatDuration(snapshot.uptimeSeconds)}`,
    `Interactions Discord : ${values.discordInteractions}`,
    `Interactions tardives : ${values.discordLateInteractions}`,
    `Parties créées : ${values.matchCreated}`,
    `Doublons refusés : ${values.matchDuplicateRefused}`,
    `Validations manuelles : ${values.matchValidated}`,
    `Auto-validations : ${values.matchAutoValidated}`,
    `Refus : ${values.matchRefused}`,
    `Annulations : ${values.matchCancelled}`,
    `Actions refusées : ${values.matchActionDenied}`,
    `Échecs DM : ${values.dmFailures}`,
    `Échecs notifications fil : ${values.threadNotificationFailures}`,
    `Erreurs interactions : ${values.discordInteractionErrors}`,
    `Erreurs messages : ${values.discordMessageErrors}`,
    `Erreurs client Discord : ${values.discordClientErrors}`
  ].join("\n");
}

export function resetMetricsForTests(): void {
  for (const key of Object.keys(counters) as MetricName[]) {
    counters[key] = 0;
  }
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}j ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
