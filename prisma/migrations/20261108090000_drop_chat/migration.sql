-- Retrait du chat (08/11/2026) : la fonctionnalité a quitté l'application
-- athlète le 03/11 et n'est plus dans le périmètre du projet. Les messages
-- échangés sont supprimés avec leurs tables.

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_athleteId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_coachId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";

-- DropTable
DROP TABLE "Conversation";

-- DropTable
DROP TABLE "Message";
