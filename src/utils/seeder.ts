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
      {
        start: 35,
        end: 45,
        text: "Perfect. Lisa, what's your update?",
        speaker: "Sarah",
      },
      {
        start: 45,
        end: 58,
        text: "I've been working on the database optimization. Query times are down by 40%. Also fixed three critical bugs in the payment processing flow.",
        speaker: "Lisa",
      },
      {
        start: 58,
        end: 65,
        text: "Great work everyone. Let's sync again next week. Meeting adjourned.",
        speaker: "Sarah",
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
        text: "Let me start with the customer feedback summary. We've received over 500 feature requests this quarter, and I've categorized them into three main themes.",
        speaker: "Tom",
      },
      {
        start: 20,
        end: 32,
        text: "The top request is improved mobile experience. About 60% of our users access the platform from mobile devices.",
        speaker: "Tom",
      },
      {
        start: 32,
        end: 45,
        text: "That aligns with our engineering capacity. We've already started the mobile-first redesign initiative.",
        speaker: "Jennifer",
      },
      {
        start: 45,
        end: 55,
        text: "What about the enterprise features? Our sales team has been pushing for SSO integration.",
        speaker: "David",
      },
      {
        start: 55,
        end: 70,
        text: "SSO is on the roadmap for Q2. We need to finish the security audit first, which is scheduled for early March.",
        speaker: "Jennifer",
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
        text: "I really like the new color scheme. It's much more modern. But I'm concerned about the information density in the top section.",
        speaker: "Rachel",
      },
      {
        start: 22,
        end: 35,
        text: "Good point. We could add a toggle to show or hide the secondary metrics. What do you think about that approach?",
        speaker: "Alex",
      },
      {
        start: 35,
        end: 45,
        text: "That would work. Also, can we make the charts interactive? Users should be able to drill down into the data.",
        speaker: "Rachel",
      },
      {
        start: 45,
        end: 55,
        text: "Absolutely. I'll add hover states and click-through functionality. Let me note that down.",
        speaker: "Alex",
      },
      {
        start: 55,
        end: 68,
        text: "The mobile version looks great. I approve the design with those two changes we discussed.",
        speaker: "Rachel",
      },
    ],
  },
  {
    title: "Client Call - Acme Corp",
    description: "Demo of new features. Client requested additional reporting.",
    transcript: [
      {
        start: 0,
        end: 8,
        text: "Thank you for joining us today. We're excited to show you the new features we've built.",
        speaker: "Sales Rep",
      },
      {
        start: 8,
        end: 18,
        text: "We've been looking forward to this. Our team has been asking about the analytics improvements.",
        speaker: "Client",
      },
      {
        start: 18,
        end: 35,
        text: "Let me walk you through the new analytics dashboard. As you can see, we've added real-time data visualization and custom date range selectors.",
        speaker: "Sales Rep",
      },
      {
        start: 35,
        end: 48,
        text: "This looks promising. Can we export these reports to PDF? Our management team needs weekly summaries.",
        speaker: "Client",
      },
      {
        start: 48,
        end: 60,
        text: "Yes, we have PDF export built in. You can also schedule automated reports to be sent via email.",
        speaker: "Sales Rep",
      },
      {
        start: 60,
        end: 72,
        text: "Perfect. One more thing - we need the ability to compare data across different time periods. Is that possible?",
        speaker: "Client",
      },
      {
        start: 72,
        end: 85,
        text: "That's actually on our roadmap. I'll make a note to prioritize it for your account. We should have it ready within the next sprint.",
        speaker: "Sales Rep",
      },
    ],
  },
  {
    title: "Engineering Sync",
    description: "Technical debt discussion and sprint planning.",
    transcript: [
      {
        start: 0,
        end: 10,
        text: "Let's start by reviewing the technical debt items that have been accumulating.",
        speaker: "Tech Lead",
      },
      {
        start: 10,
        end: 25,
        text: "The biggest issue is the legacy authentication system. It's causing about 20% of our support tickets.",
        speaker: "Developer 1",
      },
      {
        start: 25,
        end: 38,
        text: "I agree. We should allocate at least two sprints to refactor it completely. The current system doesn't scale.",
        speaker: "Developer 2",
      },
      {
        start: 38,
        end: 50,
        text: "What's the impact on our current features if we prioritize this?",
        speaker: "Tech Lead",
      },
      {
        start: 50,
        end: 65,
        text: "We'd need to pause the new feature development for about three weeks. But it would reduce our maintenance burden significantly.",
        speaker: "Developer 1",
      },
      {
        start: 65,
        end: 78,
        text: "Let's present this to the product team. I think they'll understand the long-term benefits.",
        speaker: "Tech Lead",
      },
    ],
  },
  {
    title: "1:1 with Sarah",
    description: "Career development and project feedback.",
    transcript: [
      {
        start: 0,
        end: 8,
        text: "Thanks for meeting with me today. How are things going overall?",
        speaker: "Manager",
      },
      {
        start: 8,
        end: 20,
        text: "Things are going well. I've been enjoying the new project. The team collaboration has been great.",
        speaker: "Sarah",
      },
      {
        start: 20,
        end: 32,
        text: "That's great to hear. I wanted to discuss your career goals. Where do you see yourself in the next year?",
        speaker: "Manager",
      },
      {
        start: 32,
        end: 48,
        text: "I'd like to move into a senior developer role. I've been working on improving my system design skills.",
        speaker: "Sarah",
      },
      {
        start: 48,
        end: 62,
        text: "That's a great goal. I can help you get more exposure to architecture decisions. Would you be interested in leading the next project?",
        speaker: "Manager",
      },
      {
        start: 62,
        end: 72,
        text: "Absolutely! That would be a great opportunity. Thank you for the support.",
        speaker: "Sarah",
      },
    ],
  },
  {
    title: "Budget Planning Meeting",
    description: "Q2 budget allocation and resource planning.",
    transcript: [
      {
        start: 0,
        end: 12,
        text: "Let's review the Q2 budget proposals from each department.",
        speaker: "CFO",
      },
      {
        start: 12,
        end: 28,
        text: "Engineering is requesting a 15% increase for cloud infrastructure. Our user base has grown significantly.",
        speaker: "Engineering Director",
      },
      {
        start: 28,
        end: 42,
        text: "Marketing needs additional budget for the product launch campaign. We're targeting a 30% increase in brand awareness.",
        speaker: "Marketing Director",
      },
      {
        start: 42,
        end: 55,
        text: "These are substantial increases. Can we phase them over two quarters instead?",
        speaker: "CFO",
      },
      {
        start: 55,
        end: 70,
        text: "For infrastructure, phasing would be difficult. We're already experiencing performance issues during peak hours.",
        speaker: "Engineering Director",
      },
      {
        start: 70,
        end: 82,
        text: "I understand. Let's prioritize engineering infrastructure and phase the marketing budget. Does that work for everyone?",
        speaker: "CFO",
      },
    ],
  },
  {
    title: "Interview - Senior Developer",
    description: "Technical interview for backend position.",
    transcript: [
      {
        start: 0,
        end: 10,
        text: "Welcome to the technical interview. Can you start by telling us about your background?",
        speaker: "Interviewer",
      },
      {
        start: 10,
        end: 28,
        text: "I have 7 years of experience in backend development, primarily with Node.js and Python. Most recently, I led a team of 5 developers at a fintech startup.",
        speaker: "Candidate",
      },
      {
        start: 28,
        end: 40,
        text: "Can you describe a challenging technical problem you solved recently?",
        speaker: "Interviewer",
      },
      {
        start: 40,
        end: 62,
        text: "We had a payment processing system that was timing out during peak hours. I redesigned the architecture using message queues and implemented a circuit breaker pattern. This reduced failures by 95%.",
        speaker: "Candidate",
      },
      {
        start: 62,
        end: 75,
        text: "Impressive. How do you approach code reviews and mentoring junior developers?",
        speaker: "Interviewer",
      },
      {
        start: 75,
        end: 92,
        text: "I believe in constructive feedback and pair programming. I typically spend about 2 hours per week on code reviews and hold weekly knowledge-sharing sessions.",
        speaker: "Candidate",
      },
    ],
  },
];

export async function seedNotes(): Promise<void> {
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

  // Reload the page to show new notes
  if (created > 0) {
    console.log("Reloading page...");
    window.location.reload();
  }
}

// Export to window for easy console access
if (typeof window !== "undefined") {
  (window as unknown as { seedNotes: typeof seedNotes }).seedNotes =
    seedNotes;
}
