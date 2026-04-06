-- CreateTable
CREATE TABLE "EventSubjectReference" (
    "id" TEXT NOT NULL,
    "photographerId" TEXT NOT NULL,
    "eventSlug" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectDisplayName" TEXT NOT NULL,
    "referenceDataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSubjectReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventSubjectReference_photographerId_eventSlug_subjectKey_key" ON "EventSubjectReference"("photographerId", "eventSlug", "subjectKey");

-- CreateIndex
CREATE INDEX "EventSubjectReference_photographerId_eventSlug_idx" ON "EventSubjectReference"("photographerId", "eventSlug");

-- AddForeignKey
ALTER TABLE "EventSubjectReference" ADD CONSTRAINT "EventSubjectReference_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
