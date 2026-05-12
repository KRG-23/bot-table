-- Persist default per-game table counts used when monthly slots are generated.
ALTER TABLE "Game" ADD COLUMN "defaultTables" INTEGER NOT NULL DEFAULT 0;

UPDATE "Game"
SET "defaultTables" = 5
WHERE lower("code") = 'w40k'
   OR lower("label") IN ('warhammer 40000', 'warhammer 40k');

UPDATE "Game"
SET "defaultTables" = 2
WHERE lower("code") = 'aos'
   OR lower("label") = 'age of sigmar';
