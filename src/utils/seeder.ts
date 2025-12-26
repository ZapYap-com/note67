import { meetingsApi } from "../api/meetings";

const SAMPLE_MEETINGS = [
  {
    title: "Weekly Team Standup",
    description: "Discussed project progress and blockers. Need to follow up on API integration.",
  },
  {
    title: "Product Roadmap Review",
    description: "Q1 planning session with stakeholders.",
  },
  {
    title: "Design Review - Dashboard",
    description: "Reviewed new dashboard mockups. Approved with minor changes.",
  },
  {
    title: "Client Call - Acme Corp",
    description: "Demo of new features. Client requested additional reporting.",
  },
  {
    title: "Engineering Sync",
    description: "Technical debt discussion and sprint planning.",
  },
  {
    title: "1:1 with Sarah",
    description: "Career development and project feedback.",
  },
  {
    title: "Budget Planning Meeting",
    description: "Q2 budget allocation and resource planning.",
  },
  {
    title: "Interview - Senior Developer",
    description: "Technical interview for backend position.",
  },
];

export async function seedMeetings(): Promise<void> {
  console.log("Seeding sample meetings...");

  let created = 0;
  for (let i = 0; i < SAMPLE_MEETINGS.length; i++) {
    const sample = SAMPLE_MEETINGS[i];
    try {
      // Create meeting
      const meeting = await meetingsApi.create({
        title: sample.title,
        description: sample.description,
      });

      // End the meeting (so it appears as completed)
      await meetingsApi.end(meeting.id);

      console.log(`Created: ${sample.title}`);
      created++;
    } catch (error) {
      console.error(`Failed to create "${sample.title}":`, error);
    }
  }

  console.log(`Seeding complete! Created ${created} meetings.`);

  // Reload the page to show new meetings
  if (created > 0) {
    console.log("Reloading page...");
    window.location.reload();
  }
}

// Export to window for easy console access
if (typeof window !== "undefined") {
  (window as unknown as { seedMeetings: typeof seedMeetings }).seedMeetings = seedMeetings;
}
