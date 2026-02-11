import type { Game, PrismaClient } from "@prisma/client";

export function normalizeGameInput(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export async function listActiveGames(prisma: PrismaClient): Promise<Game[]> {
  const games = await prisma.game.findMany({ where: { active: true } });
  return sortGames(games);
}

export async function listAllGames(prisma: PrismaClient): Promise<Game[]> {
  const games = await prisma.game.findMany();
  return sortGames(games);
}

export async function resolveGameFromInput(
  prisma: PrismaClient,
  input: string,
  includeInactive = false
): Promise<Game | null> {
  const normalized = normalizeGameInput(input);
  const games = await prisma.game.findMany({
    where: includeInactive ? {} : { active: true }
  });

  return (
    games.find((game) => normalizeGameInput(game.code) === normalized) ??
    games.find((game) => normalizeGameInput(game.label) === normalized) ??
    null
  );
}
