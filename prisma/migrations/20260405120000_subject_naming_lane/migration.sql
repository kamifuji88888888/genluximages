-- CreateEnum
CREATE TYPE "SubjectNamingStatus" AS ENUM ('needs_manual', 'from_slate', 'from_match', 'manual_resolved');

-- AlterTable
ALTER TABLE "ImageAsset" ADD COLUMN "subjectNamingStatus" "SubjectNamingStatus",
ADD COLUMN "subjectNamingConfidence" DOUBLE PRECISION,
ADD COLUMN "subjectMatchRetryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ImageAsset_photographerId_subjectNamingStatus_idx" ON "ImageAsset"("photographerId", "subjectNamingStatus");
