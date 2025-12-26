import { notesApi } from "../api/notes";
import { transcriptionApi } from "../api/transcription";

interface SampleNote {
  title: string;
  description: string;
  transcript: { start: number; end: number; text: string; speaker?: string }[];
}

const SAMPLE_NOTES: SampleNote[] = [
  {
    title: "Weekly Team Standup",
    description:
      "Discussed project progress and blockers. Need to follow up on API integration.",
    transcript: [
      {
        start: 0,
        end: 5,
        text: "Good morning everyone. Let's get started with our weekly standup.",
        speaker: "Sarah",
      },
      {
        start: 5,
        end: 12,
        text: "I'll go first. This week I finished the user authentication module and started on the dashboard redesign.",
        speaker: "Mike",
      },
      {
        start: 12,
        end: 18,
        text: "Any blockers Mike?",
        speaker: "Sarah",
      },
      {
        start: 18,
        end: 28,
        text: "Yes, I'm waiting on the API documentation from the backend team. Without it, I can't complete the data fetching components.",
        speaker: "Mike",
      },
      {
        start: 28,
        end: 35,
        text: "I can help with that. I'll send over the API docs by end of day today.",
        speaker: "Lisa",
      },
    ],
  },
  {
    title: "Product Roadmap Review",
    description: "Q1 planning session with stakeholders.",
    transcript: [
      {
        start: 0,
        end: 8,
        text: "Welcome everyone to our Q1 roadmap review. We have a lot to cover today.",
        speaker: "Jennifer",
      },
      {
        start: 8,
        end: 20,
        text: "Let me start with the customer feedback summary. We've received over 500 feature requests this quarter.",
        speaker: "Tom",
      },
      {
        start: 20,
        end: 32,
        text: "The top request is improved mobile experience. About 60% of our users access the platform from mobile devices.",
        speaker: "Tom",
      },
    ],
  },
  {
    title: "Design Review - Dashboard",
    description: "Reviewed new dashboard mockups. Approved with minor changes.",
    transcript: [
      {
        start: 0,
        end: 10,
        text: "I'm sharing my screen now. You should see the new dashboard design.",
        speaker: "Alex",
      },
      {
        start: 10,
        end: 22,
        text: "I really like the new color scheme. It's much more modern.",
        speaker: "Rachel",
      },
    ],
  },
];

export async function seedNotes(onComplete?: () => void): Promise<void> {
  console.log("Seeding sample notes with transcripts...");

  let created = 0;
  for (let i = 0; i < SAMPLE_NOTES.length; i++) {
    const sample = SAMPLE_NOTES[i];
    try {
      // Create note
      const note = await notesApi.create({
        title: sample.title,
        description: sample.description,
      });

      // Add transcript segments
      for (const segment of sample.transcript) {
        await transcriptionApi.addTranscriptSegment(
          note.id,
          segment.start,
          segment.end,
          segment.text,
          segment.speaker
        );
      }

      // End the note (so it appears as completed)
      await notesApi.end(note.id);

      console.log(
        `Created: ${sample.title} (${sample.transcript.length} segments)`
      );
      created++;
    } catch (error) {
      console.error(`Failed to create "${sample.title}":`, error);
    }
  }

  console.log(`Seeding complete! Created ${created} notes with transcripts.`);

  // Call the completion callback to refresh the UI
  if (created > 0 && onComplete) {
    onComplete();
  }
}
