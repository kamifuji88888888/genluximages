-- Photographer-verified name spellings for OCR cross-check.
CREATE TABLE "VerifiedSubjectName" (
    "id" TEXT NOT NULL,
    "photographerId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectDisplayName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'catalog',
    "lastEventSlug" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedSubjectName_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerifiedSubjectName_photographerId_subjectKey_key" ON "VerifiedSubjectName"("photographerId", "subjectKey");

CREATE INDEX "VerifiedSubjectName_photographerId_idx" ON "VerifiedSubjectName"("photographerId");

ALTER TABLE "VerifiedSubjectName" ADD CONSTRAINT "VerifiedSubjectName_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
