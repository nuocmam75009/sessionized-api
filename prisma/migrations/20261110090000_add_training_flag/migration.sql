-- Flag « séance de qualité » sur l'activité réalisée et sur le workout
-- prescrit, pour comparer ces séances entre elles côté front.

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "training" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "training" BOOLEAN NOT NULL DEFAULT false;

-- Même règle qu'à l'import Strava : une activité que Strava libelle WORKOUT est
-- une séance de qualité. Les workouts existants restent à false, le coach les
-- marque lui-même ; aucune activité n'hérite donc de son workout ici.
UPDATE "Activity"
SET "training" = true
WHERE 'WORKOUT'::"ActivityLabel" = ANY ("labels");
