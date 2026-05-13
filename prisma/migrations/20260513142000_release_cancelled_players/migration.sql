-- Cancelled/refused matches should keep their history without blocking players from rebooking.
DROP INDEX IF EXISTS "Match_eventId_player1Id_key";
DROP INDEX IF EXISTS "Match_eventId_player2Id_key";

CREATE INDEX IF NOT EXISTS "Match_eventId_player1Id_idx" ON "Match"("eventId", "player1Id");
CREATE INDEX IF NOT EXISTS "Match_eventId_player2Id_idx" ON "Match"("eventId", "player2Id");
