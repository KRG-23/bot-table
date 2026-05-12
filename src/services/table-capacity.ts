import type { Event, Game, PrismaClient } from "@prisma/client";

import { listActiveGames, normalizeGameInput, resolveGameFromInput } from "./games";

const INITIAL_GAME_DEFAULT_TABLE_COUNTS = [
  {
    aliases: ["w40k", "warhammer 40000", "warhammer 40k"],
    tables: 5
  },
  {
    aliases: ["aos", "age of sigmar"],
    tables: 2
  }
];

export type GameTableAllocation = {
  game: Game;
  tables: number;
};

export type GameTableCapacity = {
  game: Game;
  tables: number;
};

export type EventTableCapacity = {
  usesGameCapacities: boolean;
  totalTables: number;
  gameTables: GameTableCapacity[];
};

export function inferInitialGameDefaultTableCount(game: Pick<Game, "code" | "label">): number {
  const normalizedValues = [normalizeGameInput(game.code), normalizeGameInput(game.label)];
  const defaultEntry = INITIAL_GAME_DEFAULT_TABLE_COUNTS.find((entry) =>
    entry.aliases.some((alias) => normalizedValues.includes(normalizeGameInput(alias)))
  );

  return defaultEntry?.tables ?? 0;
}

export function getDefaultGameTableCount(game: Pick<Game, "defaultTables">): number {
  return Math.max(game.defaultTables, 0);
}

export async function buildDefaultGameTableAllocations(
  prisma: PrismaClient
): Promise<GameTableAllocation[]> {
  const games = await listActiveGames(prisma);

  return games
    .map((game) => ({
      game,
      tables: getDefaultGameTableCount(game)
    }))
    .filter((allocation) => allocation.tables > 0);
}

export async function parseGameTableAllocations(
  prisma: PrismaClient,
  input: string
): Promise<{ allocations: GameTableAllocation[]; errors: string[] }> {
  const chunks = input
    .split(/[\n,;]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const allocations = new Map<number, GameTableAllocation>();
  const errors: string[] = [];

  if (chunks.length === 0) {
    return { allocations: [], errors: ["Aucune table saisie."] };
  }

  for (const chunk of chunks) {
    const parsed = parseAllocationChunk(chunk);
    if (!parsed) {
      errors.push(`Format invalide : "${chunk}". Utilise par exemple "W40K=5, AoS=2".`);
      continue;
    }

    const game = await resolveGameFromInput(prisma, parsed.gameInput);
    if (!game) {
      errors.push(`Jeu introuvable : "${parsed.gameInput}".`);
      continue;
    }

    if (!Number.isInteger(parsed.tables) || parsed.tables < 0) {
      errors.push(`Nombre de tables invalide pour ${game.label}.`);
      continue;
    }

    allocations.set(game.id, { game, tables: parsed.tables });
  }

  return { allocations: [...allocations.values()], errors };
}

export async function replaceGameTableCapacities(
  prisma: PrismaClient,
  eventId: number,
  allocations: GameTableAllocation[]
): Promise<void> {
  const nonZeroAllocations = allocations.filter((allocation) => allocation.tables > 0);

  await prisma.$transaction([
    prisma.eventGameCapacity.deleteMany({ where: { eventId } }),
    ...nonZeroAllocations.map((allocation) =>
      prisma.eventGameCapacity.create({
        data: {
          eventId,
          gameId: allocation.game.id,
          tables: allocation.tables
        }
      })
    )
  ]);
}

export async function upsertGameTableCapacity(
  prisma: PrismaClient,
  eventId: number,
  gameId: number,
  tables: number
): Promise<void> {
  if (tables <= 0) {
    await prisma.eventGameCapacity.deleteMany({ where: { eventId, gameId } });
    return;
  }

  await prisma.eventGameCapacity.upsert({
    where: { eventId_gameId: { eventId, gameId } },
    create: { eventId, gameId, tables },
    update: { tables }
  });
}

export async function getEventTableCapacity(
  prisma: PrismaClient,
  event: Pick<Event, "id" | "tables">
): Promise<EventTableCapacity> {
  const capacities = await prisma.eventGameCapacity.findMany({
    where: { eventId: event.id },
    include: { game: true },
    orderBy: { game: { label: "asc" } }
  });

  if (capacities.length === 0) {
    return {
      usesGameCapacities: false,
      totalTables: event.tables,
      gameTables: []
    };
  }

  const gameTables = capacities.map((capacity) => ({
    game: capacity.game,
    tables: capacity.tables
  }));

  return {
    usesGameCapacities: true,
    totalTables: gameTables.reduce((total, capacity) => total + capacity.tables, 0),
    gameTables
  };
}

export async function getGameTableCapacity(
  prisma: PrismaClient,
  event: Pick<Event, "id" | "tables">,
  gameId: number
): Promise<number> {
  const capacities = await prisma.eventGameCapacity.findMany({
    where: { eventId: event.id },
    select: { gameId: true, tables: true }
  });

  if (capacities.length === 0) {
    return event.tables;
  }

  return capacities.find((capacity) => capacity.gameId === gameId)?.tables ?? 0;
}

export async function recalculateEventTables(
  prisma: PrismaClient,
  eventId: number
): Promise<number> {
  const aggregate = await prisma.eventGameCapacity.aggregate({
    where: { eventId },
    _sum: { tables: true }
  });

  return aggregate._sum.tables ?? 0;
}

export async function listGamesWithConfiguredTables(
  prisma: PrismaClient,
  event: Pick<Event, "id" | "tables">
): Promise<Game[]> {
  const capacities = await prisma.eventGameCapacity.findMany({
    where: { eventId: event.id, tables: { gt: 0 }, game: { active: true } },
    include: { game: true },
    orderBy: { game: { label: "asc" } }
  });

  if (capacities.length > 0) {
    return capacities.map((capacity) => capacity.game);
  }

  if (event.tables <= 0) {
    return [];
  }

  return listActiveGames(prisma);
}

export function formatGameTableCapacities(capacity: EventTableCapacity): string {
  if (!capacity.usesGameCapacities) {
    return `Total non réparti : ${formatTableCount(capacity.totalTables)}`;
  }

  if (capacity.gameTables.length === 0) {
    return "Aucune table configurée par jeu.";
  }

  return capacity.gameTables
    .map((entry) => `• ${entry.game.label} : ${formatTableCount(entry.tables)}`)
    .join("\n");
}

export function formatTableCount(tables: number): string {
  return tables <= 1 ? `${tables} table` : `${tables} tables`;
}

function parseAllocationChunk(chunk: string): { gameInput: string; tables: number } | null {
  const assignment = chunk.match(/^(.+?)\s*(?:=|:)\s*(\d+)$/);
  if (assignment) {
    return { gameInput: assignment[1].trim(), tables: Number(assignment[2]) };
  }

  const countFirst = chunk.match(/^(\d+)\s+(.+)$/);
  if (countFirst) {
    return { gameInput: countFirst[2].trim(), tables: Number(countFirst[1]) };
  }

  const countLast = chunk.match(/^(.+?)\s+(\d+)$/);
  if (countLast) {
    return { gameInput: countLast[1].trim(), tables: Number(countLast[2]) };
  }

  return null;
}
