-- Départ de chaque lap sur la trace, pour le graphe d'allure du front athlète.
-- Les laps déjà en base restent à NULL : il faudrait relire le .fit ou
-- rappeler Strava pour le connaître, et le front se rabat alors sur la somme
-- des durées.

-- AlterTable
ALTER TABLE "Lap" ADD COLUMN     "startElapsedSec" DOUBLE PRECISION;
